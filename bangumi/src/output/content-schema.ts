import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { COMPONENT_KINDS, type ComponentKind, type MixedContent, type MixedPart } from './content-types.js';
import type { DiagnosticIssue } from '../support/error-diagnostic.js';
export * from './content-types.js';

export const MAX_CONTENT_BYTES = 128 * 1024;
export const MAX_CONTENT_PARTS = 16;

export class ContentOutputError extends Error {
  location?: { offset: number; line: number; column: number };
  constructor(message: string, readonly code: 'schema' | 'size' | 'syntax' | 'truncated' | 'unsupported' = 'schema', readonly issues: readonly string[] = [],
    readonly issueDetails: readonly DiagnosticIssue[] = [], readonly reason: string = `${code}_invalid`) {
    super(message);
    this.name = 'ContentOutputError';
  }
  at(prefix: string): ContentOutputError {
    const details = this.issueDetails.map(issue => ({ ...issue, path: `${prefix}${issue.path}` }));
    const error = new ContentOutputError(this.message, this.code, this.issues, details, this.reason);
    if (this.location) error.location = this.location;
    return error;
  }
}

export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  anyOf?: Schema[];
  enum?: (string | boolean | null)[];
  maxItems?: number;
  pattern?: string;
};
const str: Schema = { type: 'string' };
const num: Schema = { type: 'number' };
const bool: Schema = { type: 'boolean' };
const url: Schema = { type: 'string', pattern: '^[Hh][Tt][Tt][Pp][Ss]?://' };
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const array = (items: Schema, maxItems?: number): Schema => ({ type: 'array', items, ...(maxItems === undefined ? {} : { maxItems }) });
const object = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({
  type: 'object', properties, required, additionalProperties: false,
});

/** 同一份组件规则用于 provider schema、完整校验及已闭合字段的部分校验。 */
export const COMPONENT_PAYLOAD_SCHEMAS: Record<ComponentKind, Schema> = {
  SubjectCards: object({
    title: str, layout: choice('grid', 'list'), total: num, hint: str,
    items: array(object({
      id: num, name: str, kind: choice('book', 'anime', 'music', 'game', 'real'),
      nameCn: str, image: url, score: num, scoreCount: num, rank: num, date: str,
      summary: str, tags: array(str), url,
    }, ['id', 'name', 'kind']), 50),
  }, ['items', 'layout']),
  StatsCard: object({
    title: str, headline: object({ value: str, label: str }),
    entries: array(object({ label: str, value: str, ratio: num, hint: str, tone: choice('default', 'primary', 'muted') }, ['label', 'value']), 100),
    mode: choice('list', 'bars', 'histogram'), note: str,
  }, ['entries', 'mode']),
  ProgressView: object({
    title: str, current: num, total: num, unit: str,
    episodes: array(object({ id: num, label: str, state: choice('done', 'current', 'todo') }), 100), note: str,
  }, []),
  InfoBox: object({
    title: str, rows: array(object({ label: str, value: str, tone: choice('default', 'muted') }, ['label', 'value']), 100),
  }, ['rows']),
  DataTable: object({
    title: str,
    columns: array(object({ key: str, label: str, align: choice('left', 'right') }, ['key', 'label'])),
    rows: array({ type: 'object', additionalProperties: str }, 200), note: str,
  }, ['columns', 'rows']),
  Timeline: object({
    title: str, entries: array(object({ time: str, text: str, actor: str }, ['time', 'text']), 100),
  }, ['entries']),
  TagCloud: array(object({ name: str, count: num, selected: bool }, ['name'])),
  Gallery: object({
    title: str, items: array(object({ id: num, name: str, image: url, subtitle: str, url }, ['id', 'name']), 50),
  }, ['items']),
  CompareTable: object({
    title: str, rows: array(object({ label: str, before: str, after: str, changed: bool }), 100), note: str,
  }, ['rows']),
  QuoteBlock: object({ title: str, text: str, mono: bool }, ['text', 'mono']),
  Callout: object({ tone: choice('progress', 'success', 'warning', 'error'), text: str, detail: str }, ['tone', 'text']),
  LinkList: object({ title: str, links: array(object({ label: str, url, hint: str }, ['label', 'url']), 50) }, ['links']),
};
const payloads = COMPONENT_PAYLOAD_SCHEMAS;
const textSchema = object({ type: choice('text'), nextType: { anyOf: [choice('text', ...COMPONENT_KINDS), { type: 'null' }] }, text: str });
const partSchema: Schema = { anyOf: [textSchema, ...COMPONENT_KINDS.map(kind => object({
  type: choice(kind), pending: { type: 'boolean', enum: [false] }, props: payloads[kind],
}))] };
/** 正式结果 schema：占位不属于完整结果，pending 必须为 false。 */
export const CONTENT_OUTPUT_SCHEMA = object({ content: array(partSchema, MAX_CONTENT_PARTS) });

/** 宿主生成、MCP回执、持久化和前端使用严格的内部内容契约。 */
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
// 根结构与具体组件分开检查，避免 anyOf 其他12个分支的噪音掩盖真实字段错误。
const checkContent = ajv.compile(object({ content: array({}, MAX_CONTENT_PARTS) }));
const partChecks = new Map(partSchema.anyOf!.map(branch => [String(branch.properties!.type!.enum![0]), ajv.compile(branch)]));
const fieldChecks = new Map<string, ValidateFunction>();

function checkSize(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { throw new ContentOutputError('输出必须是可序列化的 JSON'); }
  if (json !== undefined && Buffer.byteLength(json, 'utf8') > MAX_CONTENT_BYTES) {
    throw new ContentOutputError(`输出超过 ${MAX_CONTENT_BYTES} 字节`, 'size', [], [], 'content_bytes_limit');
  }
}
function invalid(errors: ErrorObject[] | null | undefined, value?: unknown): never {
  const details: DiagnosticIssue[] = (errors ?? []).slice(0, 8).map(issue => {
    const field = issue.keyword === 'required' ? issue.params.missingProperty : issue.keyword === 'additionalProperties' ? issue.params.additionalProperty : undefined;
    const path = field === undefined ? issue.instancePath : `${issue.instancePath}/${String(field).replaceAll('~', '~0').replaceAll('/', '~1')}`;
    let actual = value;
    for (const token of path.split('/').slice(1)) actual = actual !== null && typeof actual === 'object'
      ? (actual as Record<string, unknown>)[token.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined;
    const expected = issue.params.type ?? issue.params.allowedValues ?? issue.params.allowedValue ?? issue.params.limit;
    return { path, rule: issue.keyword, message: issue.message ?? '字段不合法',
      actualType: actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual,
      ...(expected === undefined ? {} : { expected: JSON.stringify(expected).slice(0, 300) }) };
  });
  const issues = details.map(issue => `${issue.path || '/'} ${issue.message}`);
  const limited = details.some(issue => issue.rule === 'maxItems');
  throw new ContentOutputError(`混合内容不符合组件契约：${issues.join('；')}`, limited ? 'size' : 'schema', issues, details,
    limited ? details.some(issue => issue.path === '/content') ? 'content_parts_limit' : 'component_item_limit' : 'schema_invalid');
}

function branchFor(value: unknown, schema: Schema): Schema {
  const record = value as Record<string, unknown> | null;
  const branch = schema.anyOf?.find(item => item.properties?.type?.enum?.includes(String(record?.type)))
    ?? schema.anyOf?.find(item => item.type === (value === null ? 'null' : typeof value));
  if (!branch) throw new ContentOutputError('未知内容类型');
  return branch;
}
function normalize(value: unknown, schema: Schema): unknown {
  if (schema.anyOf) return normalize(value, branchFor(value, schema));
  if (schema.items) return (value as unknown[]).map(item => normalize(item, schema.items!));
  if (schema.properties) {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      if (record[key] === null && !schema.required?.includes(key)) continue;
      if (Object.hasOwn(record, key)) Object.defineProperty(result, key, {
        value: normalize(record[key], child), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  }
  return value;
}

function tableKeys(columns: unknown, path = '/props/columns'): string[] {
  const keys = (columns as { key: string }[]).map(column => column.key);
  if (new Set(keys).size !== keys.length) throw new ContentOutputError('DataTable.columns.key 不允许重复', 'schema', [],
    [{ path, rule: 'unique_column_keys', message: '列 key 必须唯一' }], 'duplicate_column_key');
  return keys;
}
/** 输入是已闭合的顶层 props 字段；未闭合的子对象/数组不得交给此函数。 */
export function normalizePartialComponentProps(kind: ComponentKind, value: unknown): Record<string, unknown> | unknown[] {
  if (kind === 'TagCloud') {
    checkSize(value);
    const schema = payloads.TagCloud;
    const key = 'TagCloud:props';
    let check = fieldChecks.get(key);
    if (!check) { check = ajv.compile(schema); fieldChecks.set(key, check); }
    if (!check(value)) invalid(check.errors, value);
    return normalize(value, payloads.TagCloud) as unknown[];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentOutputError(`${kind}.props 必须是对象`);
  checkSize(value);
  const source = value as Record<string, unknown>;
  const spec = payloads[kind];
  const result: Record<string, unknown> = {};
  // rows 与 columns 都保持前端对象格式；columns 闭合后检查重复键。
  if (kind === 'DataTable' && Object.hasOwn(source, 'columns')) {
    const schema = spec.properties!.columns!;
    const key = 'table:columns';
    let check = fieldChecks.get(key);
    if (!check) {
      check = ajv.compile(schema);
      fieldChecks.set(key, check);
    }
    if (!check(source.columns)) {
      try { invalid(check.errors, source.columns); } catch (error) { if (error instanceof ContentOutputError) throw error.at('/columns'); throw error; }
    }
    tableKeys(source.columns, '/columns');
  }
  for (const [field, raw] of Object.entries(source)) {
    if (!Object.hasOwn(spec.properties!, field)) throw new ContentOutputError(`${kind}.props 包含未知字段`, 'schema', [],
      [{ path: `/${field.replaceAll('~', '~0').replaceAll('/', '~1')}`, rule: 'additionalProperties', message: 'props包含未允许的字段' }]);
    const child = spec.properties![field]!;
    const key = `${kind}:${field}`;
    let check = fieldChecks.get(key);
    if (!check) {
      check = ajv.compile(child);
      fieldChecks.set(key, check);
    }
    if (!check(raw)) {
      try { invalid(check.errors, raw); } catch (error) { if (error instanceof ContentOutputError) throw error.at(`/${field}`); throw error; }
    }
    result[field] = normalize(raw, child);
    if (kind === 'DataTable' && field === 'columns') tableKeys(result[field], '/columns');
  }
  return result;
}

/** 完整对象校验，返回顺序稳定且无共享输入对象的规范内容。 */
export function validateMixedPart(value: unknown): MixedPart {
  checkSize(value);
  const kind = value !== null && typeof value === 'object' ? String((value as Record<string, unknown>).type) : '';
  const check = partChecks.get(kind);
  if (!check) throw new ContentOutputError('未知或缺失内容类型', 'schema', [], [{ path: '/type', rule: 'enum', message: 'type 必须是已声明的内容类型' }], 'content_type_invalid');
  if (!check(value)) invalid(check.errors, value);
  const part = normalize(value, partSchema) as MixedPart;
  if (part.type === 'DataTable' && part.pending === false) tableKeys(part.props.columns);
  return part;
}
export function validateNextTypes(content: readonly MixedPart[]): void {
  for (let index = 0; index < content.length; index++) {
    const part = content[index]!;
    if (part.type !== 'text') continue;
    const actual = content[index + 1]?.type ?? null;
    if (part.nextType !== actual) throw new ContentOutputError(`content[${index}].nextType 与实际下一项不一致`, 'schema', [],
      [{ path: `/content/${index}/nextType`, rule: 'next_type', message: 'nextType 必须与紧邻下一项类型一致', expected: String(actual) }], 'next_type_mismatch');
  }
}
export function validateMixedContent(value: unknown): MixedContent {
  checkSize(value);
  if (!checkContent(value)) invalid(checkContent.errors, value);
  const answer = { content: (value as { content: unknown[] }).content.map((part, index) => {
    try { return validateMixedPart(part); } catch (error) { if (error instanceof ContentOutputError) throw error.at(`/content/${index}`); throw error; }
  }) };
  validateNextTypes(answer.content);
  return answer;
}

export const CONTENT_OUTPUT_SYSTEM_MARKER = '[bangumi-provider-content-v2]';
