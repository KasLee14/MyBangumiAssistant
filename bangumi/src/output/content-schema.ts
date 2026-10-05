import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { COMPONENT_KINDS, type ComponentKind, type MixedContent, type MixedPart } from './content-types.js';
export * from './content-types.js';

export const MAX_CONTENT_BYTES = 128 * 1024;
export const MAX_CONTENT_PARTS = 16;

export class ContentOutputError extends Error {
  constructor(message: string, readonly code: 'schema' | 'size' | 'syntax' | 'truncated' | 'unsupported' = 'schema', readonly issues: readonly string[] = []) {
    super(message);
    this.name = 'ContentOutputError';
  }
}

type Schema = {
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
const payloads: Record<ComponentKind, Schema> = {
  subjects: object({
    title: str, layout: choice('grid', 'list'), total: num, hint: str,
    items: array(object({
      id: num, name: str, kind: choice('book', 'anime', 'music', 'game', 'real'),
      nameCn: str, image: url, score: num, scoreCount: num, rank: num, date: str,
      summary: str, tags: array(str), url,
    }, ['id', 'name', 'kind']), 50),
  }, ['items', 'layout']),
  stats: object({
    title: str, headline: object({ value: str, label: str }),
    entries: array(object({ label: str, value: str, ratio: num, hint: str, tone: choice('default', 'primary', 'muted') }, ['label', 'value']), 100),
    mode: choice('list', 'bars', 'histogram'), note: str,
  }, ['entries', 'mode']),
  progress: object({
    title: str, current: num, total: num, unit: str,
    episodes: array(object({ id: num, label: str, state: choice('done', 'current', 'todo') }), 100), note: str,
  }, []),
  infobox: object({
    title: str, rows: array(object({ label: str, value: str, tone: choice('default', 'muted') }, ['label', 'value']), 100),
  }, ['rows']),
  table: object({
    title: str,
    columns: array(object({ key: str, label: str, align: choice('left', 'right') }, ['key', 'label'])),
    rows: array({ type: 'object', additionalProperties: str }, 200), note: str,
  }, ['columns', 'rows']),
  timeline: object({
    title: str, entries: array(object({ time: str, text: str, actor: str }, ['time', 'text']), 100),
  }, ['entries']),
  tags: object({ tags: array(object({ name: str, count: num, selected: bool }, ['name'])) }),
  gallery: object({
    title: str, items: array(object({ id: num, name: str, image: url, subtitle: str, url }, ['id', 'name']), 50),
  }, ['items']),
  compare: object({
    title: str, rows: array(object({ label: str, before: str, after: str, changed: bool }), 100), note: str,
  }, ['rows']),
  quote: object({ title: str, text: str, mono: bool }, ['text', 'mono']),
  callout: object({ tone: choice('progress', 'success', 'warning', 'error'), text: str, detail: str }, ['tone', 'text']),
  links: object({ title: str, links: array(object({ label: str, url, hint: str }, ['label', 'url']), 50) }, ['links']),
};
const textSchema = object({ type: choice('text'), nextType: { anyOf: [choice('text', ...COMPONENT_KINDS), { type: 'null' }] }, text: str });
const partSchema: Schema = { anyOf: [textSchema, ...COMPONENT_KINDS.map(kind => object({
  type: choice(kind), pending: { type: 'boolean', enum: [false] }, props: payloads[kind],
}))] };
/** 正式结果 schema：占位不属于完整结果，pending 必须为 false。 */
export const CONTENT_OUTPUT_SCHEMA = object({ content: array(partSchema, MAX_CONTENT_PARTS) });

function providerSchema(schema: Schema, kind?: ComponentKind, path: string[] = []): Schema {
  // strict 对象不支持依赖 columns 的动态键，用矩阵保留列顺序。
  if (kind === 'table' && path.join('.') === 'props.rows') return array(array(str), schema.maxItems);
  if (schema.properties) {
    const properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      const converted = providerSchema(value, kind, [...path, key]);
      return [key, schema.required?.includes(key) ? converted : { anyOf: [converted, { type: 'null' }] }];
    }));
    return object(properties);
  }
  if (schema.anyOf) return { anyOf: schema.anyOf.map(branch => providerSchema(branch, kind, path)) };
  if (schema.items) return { ...schema, items: providerSchema(schema.items, kind, path) };
  return { ...schema };
}
const providerPartSchema: Schema = { anyOf: [providerSchema(textSchema), ...COMPONENT_KINDS.map(kind =>
  providerSchema(object({ type: choice(kind), props: payloads[kind] }), kind))] };
/** Provider 不生成 pending；完成状态只由运行时设置。 */
export const PROVIDER_CONTENT_SCHEMA = object({ content: array(providerPartSchema, MAX_CONTENT_PARTS) });
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const checkContent = ajv.compile(CONTENT_OUTPUT_SCHEMA);
const checkPart = ajv.compile(partSchema);
const checkProviderContent = ajv.compile(PROVIDER_CONTENT_SCHEMA);
const checkProviderPart = ajv.compile(providerPartSchema);
const fieldChecks = new Map<string, ValidateFunction>();

function checkSize(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { throw new ContentOutputError('输出必须是可序列化的 JSON'); }
  if (json !== undefined && Buffer.byteLength(json, 'utf8') > MAX_CONTENT_BYTES) {
    throw new ContentOutputError(`输出超过 ${MAX_CONTENT_BYTES} 字节`, 'size');
  }
}
function invalid(errors: ErrorObject[] | null | undefined): never {
  const issues = (errors ?? []).slice(0, 24).map(issue => `${issue.instancePath || '/'} ${issue.message ?? '字段不合法'}`);
  throw new ContentOutputError(`混合内容不符合组件契约：${issues.join('；')}`, 'schema', issues);
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

function tableKeys(columns: unknown): string[] {
  const keys = (columns as { key: string }[]).map(column => column.key);
  if (new Set(keys).size !== keys.length) throw new ContentOutputError('table.columns.key 不允许重复');
  return keys;
}
function tableRows(rows: unknown, columns: unknown): Record<string, string>[] {
  const keys = tableKeys(columns);
  return (rows as string[][]).map((cells, index) => {
    if (cells.length !== keys.length) throw new ContentOutputError(`table.rows[${index}] 的单元格数量必须与 columns 一致`);
    return Object.fromEntries(keys.map((key, position) => [key, cells[position]!]));
  });
}

/** 输入是已闭合的顶层 props 字段；未闭合的子对象/数组不得交给此函数。 */
export function normalizePartialComponentProps(kind: ComponentKind, value: unknown, mode: 'provider' | 'canonical' = 'provider'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentOutputError(`${kind}.props 必须是对象`);
  checkSize(value);
  const source = value as Record<string, unknown>;
  const spec = payloads[kind];
  const result: Record<string, unknown> = {};
  // rows 可能先于 columns；在映射动态键之前先验证 columns，避免读取未校验的值。
  if (kind === 'table' && Object.hasOwn(source, 'columns')) {
    const schema = spec.properties!.columns!;
    const key = `${mode}:table:columns`;
    let check = fieldChecks.get(key);
    if (!check) {
      check = ajv.compile(mode === 'provider' ? providerSchema(schema, kind, ['props', 'columns']) : schema);
      fieldChecks.set(key, check);
    }
    if (!check(source.columns)) invalid(check.errors);
    tableKeys(source.columns);
  }
  for (const [field, raw] of Object.entries(source)) {
    if (!Object.hasOwn(spec.properties!, field)) throw new ContentOutputError(`${kind}.props 包含未知字段 ${field}`);
    const child = spec.properties![field]!;
    if (mode === 'provider' && raw === null && !spec.required?.includes(field)) continue;
    const key = `${mode}:${kind}:${field}`;
    let check = fieldChecks.get(key);
    if (!check) {
      check = ajv.compile(mode === 'provider' ? providerSchema(child, kind, ['props', field]) : child);
      fieldChecks.set(key, check);
    }
    if (!check(raw)) invalid(check.errors);
    if (kind === 'table' && field === 'rows' && mode === 'provider') {
      // 字段乱序时先验证矩阵，等 columns 完成后再发布实际行对象。
      if (!Object.hasOwn(source, 'columns')) continue;
      result[field] = tableRows(raw, source.columns);
    } else {
      result[field] = normalize(raw, child);
      if (kind === 'table' && field === 'columns') tableKeys(result[field]);
    }
  }
  return result;
}

/** 完整对象校验，返回顺序稳定且无共享输入对象的规范内容。 */
export function validateMixedPart(value: unknown): MixedPart {
  checkSize(value);
  if (!checkPart(value)) invalid(checkPart.errors);
  const part = normalize(value, partSchema) as MixedPart;
  if (part.type === 'table' && part.pending === false) tableKeys(part.props.columns);
  return part;
}
export function validateNextTypes(content: readonly MixedPart[]): void {
  for (let index = 0; index < content.length; index++) {
    const part = content[index]!;
    if (part.type !== 'text') continue;
    const actual = content[index + 1]?.type ?? null;
    if (part.nextType !== actual) throw new ContentOutputError(`content[${index}].nextType 声明 ${String(part.nextType)}，实际下一项为 ${String(actual)}`);
  }
}
export function validateMixedContent(value: unknown): MixedContent {
  checkSize(value);
  if (!checkContent(value)) invalid(checkContent.errors);
  const answer = { content: (value as { content: unknown[] }).content.map(validateMixedPart) };
  validateNextTypes(answer.content);
  return answer;
}

function normalizedPart(value: unknown): MixedPart {
  const raw = value as Record<string, unknown>;
  if (raw.type === 'text') return validateMixedPart(normalize(raw, textSchema));
  const kind = raw.type as ComponentKind;
  return validateMixedPart({ type: kind, pending: false, props: normalizePartialComponentProps(kind, raw.props) });
}
export function normalizeProviderPart(value: unknown): MixedPart {
  checkSize(value);
  if (!checkProviderPart(value)) invalid(checkProviderPart.errors);
  return normalizedPart(value);
}
export function normalizeProviderContent(value: unknown): MixedContent {
  checkSize(value);
  if (!checkProviderContent(value)) invalid(checkProviderContent.errors);
  return validateMixedContent({ content: (value as { content: unknown[] }).content.map(normalizedPart) });
}

export const CONTENT_OUTPUT_SYSTEM_MARKER = '[bangumi-provider-content-v2]';
export const CONTENT_OUTPUT_INSTRUCTION = `${CONTENT_OUTPUT_SYSTEM_MARKER}
助手文字输出必须是单个 JSON 对象，content 数组按阅读顺序包含 text 和具体组件类型。
text 项按 type、nextType、text 顺序生成；nextType 是紧邻下一项的类型，末项文本必须填 null。
组件项按 type、props 顺序生成，全部组件参数放在 props 对象中。不要生成 pending，运行时以 pending:true 表示生成中，pending:false 表示完成且通过校验。
text 内允许 Markdown，文本与组件可以交错；不要输出代码围栏或 JSON 外正文。
组件事实来自已获得的信息，不补造字段，不重复用 Markdown 展示同一份组件数据。
工具调用仍使用原生工具通道；思考仍使用原生思考通道，不写进 content。
所有属性必须提供，可选属性未知时填 null；普通解释/澄清可以只有 text。
table.props.rows 使用二维字符串数组，每行严格按照 columns 顺序提供全部单元格，空单元格用空字符串；columns.key 不得重复。
infobox.props 直接包含 rows；tags.props 是包含 tags 数组的对象。
URL 必须是 http/https 绝对地址；整个输出最多 ${MAX_CONTENT_BYTES} UTF-8 字节、${MAX_CONTENT_PARTS} 项。数值和枚举遵守以下组件契约：
${JSON.stringify(PROVIDER_CONTENT_SCHEMA)}`;
