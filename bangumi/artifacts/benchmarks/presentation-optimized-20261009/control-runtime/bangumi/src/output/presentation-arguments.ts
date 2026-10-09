import { getToolCallArgumentSource, type ToolArgumentContext } from '@earendil-works/pi-ai';
import { SchemaInputError } from '../support/errors.js';
import { schemaArguments, validateSchema, type JsonSchema } from '../support/tool-schema.js';

const presentationTools = new Set(['prepare_component', 'present_component', 'present_text']);
export interface PresentationArgumentRepair {
  rule: 'remove_trailing_comma' | 'close_eof_container'; path: string; offset: number;
}
export interface PresentationArgumentIssue { path: string; reason: string; offset?: number }
export type PresentationArgumentResult =
  | { ok: true; value: unknown; repairs: PresentationArgumentRepair[] }
  | { ok: false; issue: PresentationArgumentIssue };
export interface PresentationArgumentAudit {
  toolName: string; stage: 'syntax' | 'schema'; status: 'accepted' | 'repaired' | 'rejected';
  repairs: PresentationArgumentRepair[]; issue?: PresentationArgumentIssue;
}
export interface PresentationArgumentOptions {
  onAudit?: (audit: PresentationArgumentAudit) => void;
  schemaForValue?: (value: unknown) => JsonSchema;
  normalize?: (schema: JsonSchema, value: unknown) => unknown;
}

// 未知字段名也可能包含凭据；诊断只显示固定字段或占位符，不回显原始键和值。
const safeKeys = new Set(['component', 'blockIndex', 'members', 'kind', 'props', 'style', 'facts', 'presentationRef', 'componentRef', 'text', 'afterRef',
  'title', 'layout', 'subjectIds', 'ids', 'items', 'id', 'name', 'columns', 'rows', 'resultRef', 'resourceRef', 'preparedRef']);
function childPath(path: string, key: string): string { return `${path}/${safeKeys.has(key) ? key : '<field>'}`; }
function diagnosticPath(path: string): string { return path.length > 200 ? `${path.slice(0, 197)}...` : path; }

class ScanFailure extends Error {
  readonly issue: PresentationArgumentIssue;
  constructor(reason: string, path: string, offset: number) {
    super(reason); this.issue = { reason, path: diagnosticPath(path), offset };
  }
}

/** 单次扫描只删除字符串外的尾逗号、补 EOF 闭合符；不修改任何键、值或成员。 */
function scanJson(raw: string, repair: boolean): { json: string; repairs: PresentationArgumentRepair[] } {
  let position = 0;
  const stack: { close: '}' | ']'; path: string }[] = [];
  const repairs: PresentationArgumentRepair[] = [];
  const removed = new Set<number>();
  let suffix = '';
  const fail = (reason: string, path: string): never => { throw new ScanFailure(reason, path, position); };
  const whitespace = (): void => { while (' \t\r\n'.includes(raw[position] ?? '\0')) position++; };
  const digit = (character: string | undefined): boolean => character !== undefined && character >= '0' && character <= '9';
  const string = (path: string): string => {
    const start = position++;
    while (position < raw.length) {
      const character = raw[position++]!;
      if (character === '"') return JSON.parse(raw.slice(start, position)) as string;
      if (character.charCodeAt(0) < 32) fail('invalid_string_control', path);
      if (character !== '\\') continue;
      const escape = raw[position++];
      if (escape === 'u') {
        for (let count = 0; count < 4; count++) {
          const hex = raw[position++];
          if (!hex || !('0123456789abcdefABCDEF'.includes(hex))) fail('invalid_escape', path);
        }
      } else if (!escape || !('"\\/bfnrt'.includes(escape))) fail('invalid_escape', path);
    }
    return fail('unclosed_string', path);
  };
  const scalar = (path: string): void => {
    const character = raw[position];
    if (character === 't' || character === 'f' || character === 'n') {
      const literal = character === 't' ? 'true' : character === 'f' ? 'false' : 'null';
      if (raw.slice(position, position + literal.length) !== literal) fail('incomplete_literal', path);
      position += literal.length;
      return;
    }
    if (character === '-') position++;
    if (!digit(raw[position])) fail('invalid_value', path);
    if (raw[position] === '0') position++;
    else while (digit(raw[position])) position++;
    if (raw[position] === '.') {
      position++; if (!digit(raw[position])) fail('incomplete_number', path);
      while (digit(raw[position])) position++;
    }
    if (raw[position] === 'e' || raw[position] === 'E') {
      position++; if (raw[position] === '+' || raw[position] === '-') position++;
      if (!digit(raw[position])) fail('incomplete_number', path);
      while (digit(raw[position])) position++;
    }
  };
  const close = (expected: '}' | ']', path: string): void => {
    if (raw[position] === expected) position++;
    else if (position === raw.length && repair) {
      suffix += expected; repairs.push({ rule: 'close_eof_container', path: diagnosticPath(path), offset: raw.length });
    } else fail(position === raw.length ? 'missing_eof_close' : 'mismatched_close', path);
    stack.pop();
  };
  const value = (path: string): void => {
    whitespace();
    const character = raw[position];
    if (character === '"') { string(path); return; }
    if (character !== '{' && character !== '[') { scalar(path); return; }
    if (stack.length >= 128) fail('nesting_limit', path);
    const object = character === '{', expected = object ? '}' : ']';
    stack.push({ close: expected, path }); position++; whitespace();
    if (raw[position] === expected) { close(expected, path); return; }
    const keys = new Set<string>();
    let index = 0;
    while (true) {
      let itemPath = `${path}/${index++}`;
      if (object) {
        if (raw[position] !== '"') fail('missing_object_key', path);
        const key = string(path);
        if (keys.has(key)) fail('duplicate_key', path);
        keys.add(key); itemPath = childPath(path, key); whitespace();
        if (raw[position] !== ':') fail('missing_colon', itemPath);
        position++;
      }
      value(itemPath); whitespace();
      if (raw[position] === expected || position === raw.length) { close(expected, path); return; }
      if (raw[position] !== ',') fail('expected_separator', path);
      const comma = position++; whitespace();
      if (raw[position] === expected) {
        if (!repair) fail('trailing_comma', path);
        removed.add(comma); repairs.push({ rule: 'remove_trailing_comma', path: diagnosticPath(path), offset: comma });
        close(expected, path); return;
      }
      // EOF 紧随逗号意味着还有未完成成员，不能通过闭合数组静默丢失它。
      if (position === raw.length) fail('missing_member', path);
    }
  };
  value(''); whitespace();
  if (position !== raw.length) fail('multiple_roots_or_trailing_data', '');
  let json = '';
  for (let index = 0; index < raw.length; index++) if (!removed.has(index)) json += raw[index];
  return { json: json + suffix, repairs };
}

export function parsePresentationArguments(toolName: string, raw: unknown, termination: string): PresentationArgumentResult {
  if (!presentationTools.has(toolName)) return { ok: false, issue: { path: '', reason: 'unsupported_tool' } };
  if (termination !== 'stop' && termination !== 'toolUse') return { ok: false, issue: { path: '', reason: 'incomplete_termination' } };
  if (typeof raw !== 'string') return { ok: false, issue: { path: '', reason: 'missing_raw_arguments' } };
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) return { ok: false, issue: { path: '', reason: 'argument_size_limit' } };
  let strictlyParsed = false;
  try { JSON.parse(raw); strictlyParsed = true; } catch { /* 仅允许下一次确定性修复尝试。 */ }
  try {
    const scanned = scanJson(raw, !strictlyParsed);
    const value: unknown = JSON.parse(scanned.json);
    // 修复后严格重解析和重复键重检；不复用宽松解析器的结果。
    if (scanned.repairs.length) scanJson(scanned.json, false);
    return { ok: true, value, repairs: scanned.repairs };
  } catch (error) {
    return { ok: false, issue: error instanceof ScanFailure ? error.issue : { path: '', reason: 'invalid_json' } };
  }
}

export function preparePresentationArguments(
  toolName: string, schema: JsonSchema, _args: unknown, context?: ToolArgumentContext, options?: PresentationArgumentOptions,
): Record<string, unknown> {
  const source = context && getToolCallArgumentSource(context.toolCall);
  const termination = context?.signal?.aborted || source?.state === 'interrupted' ? 'interrupted' : context?.assistantMessage.stopReason ?? 'pending';
  const result = parsePresentationArguments(toolName, source?.raw, termination);
  if (!result.ok) {
    options?.onAudit?.({ toolName, stage: 'syntax', status: 'rejected', repairs: [], issue: result.issue });
    throw new SchemaInputError([{ path: result.issue.path, rule: result.issue.reason, hint: '展示参数格式不完整或无效，请完整重新提供参数。' }]);
  }
  // 语法修复只证明 JSON 成立；完整对象与业务契约仍由既有校验负责。
  options?.onAudit?.({ toolName, stage: 'syntax', status: result.repairs.length ? 'repaired' : 'accepted', repairs: result.repairs });
  try {
    const active = options?.schemaForValue?.(result.value) ?? schema;
    const value = options?.normalize ? options.normalize(active, result.value) : result.value;
    const args = schemaArguments(active, value);
    if (active !== schema) validateSchema(schema, value);
    return args;
  } catch (error) {
    const issue = error instanceof SchemaInputError ? error.issues[0] : undefined;
    options?.onAudit?.({ toolName, stage: 'schema', status: 'rejected', repairs: result.repairs,
      issue: { path: issue?.path ?? '', reason: issue?.rule ?? 'schema_invalid' } });
    throw error;
  }
}
