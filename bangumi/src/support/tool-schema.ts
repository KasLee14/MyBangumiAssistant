import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { SchemaInputError, type InputIssue } from './errors.js';

export type JsonSchema = Record<string, unknown>;
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validators = new WeakMap<JsonSchema, ValidateFunction>();
export function compileSchema(schema: JsonSchema): ValidateFunction {
  let validator = validators.get(schema);
  if (!validator) { validator = ajv.compile(schema); validators.set(schema, validator); }
  return validator;
}
export function schemaAt(schema: JsonSchema, path: string): JsonSchema | null {
  let current = schema;
  for (const token of path.split('/').slice(1)) {
    const properties = current.properties as Record<string, JsonSchema> | undefined;
    const next = properties && Object.hasOwn(properties, token) ? properties[token] : /^\d+$/.test(token) ? current.items as JsonSchema | undefined : undefined;
    if (!next) return null;
    current = next;
  }
  return current;
}
/** hint/allowed 只来自固定schema；远端不能借校验反馈注入任意文本。 */
export function inputIssue(schema: JsonSchema, path: string, rule: string): InputIssue | null {
  const node = schemaAt(schema, path);
  if (!node) {
    const media = (schema.properties as Record<string, JsonSchema> | undefined)?.subject_type?.const;
    if (rule === 'forbidden' && path === '/series' && media !== undefined && media !== 1) return { path, rule, hint: 'series仅书籍可提供；此媒体必须省略，包括false' };
    if (rule === 'forbidden' && path === '/platform' && media !== undefined && media !== 4) return { path, rule, hint: 'platform仅游戏可提供；此媒体必须省略，动画形式使用cat' };
    return null;
  }
  const structural = ['enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'pattern', 'anyOf', 'oneOf'];
  if (structural.includes(rule) && !Object.hasOwn(node, rule)) return null;
  if (['blank', 'control', 'date'].includes(rule) && node.type !== 'string' || rule === 'safeInteger' && node.type !== 'integer') return null;
  if (rule === 'rangeOrder' && (node.type !== 'object' || !Object.hasOwn(node.properties as object ?? {}, 'min') || !Object.hasOwn(node.properties as object ?? {}, 'max'))) return null;
  const hints: Record<string, string> = {
    type: `必须是${node.type ?? '声明的类型'}，不自动转换类型`,
    enum: `仅允许${JSON.stringify(node.enum ?? [node.const])}${node.description ? `；${node.description}` : ''}`, const: `仅允许${JSON.stringify(node.const)}`,
    required: '缺少必填字段', additionalProperties: '含未声明字段；请仅使用此对象声明的字段',
    minimum: `不得小于${node.minimum}`, maximum: `不得大于${node.maximum}`,
    minLength: `长度至少${node.minLength}字`, maxLength: `长度最多${node.maxLength}字`,
    minItems: `至少${node.minItems}项`, maxItems: `最多${node.maxItems}项`, uniqueItems: '数组项不能重复',
    minProperties: '至少提供一个筛选条件', pattern: '格式不符合声明的要求',
    rangeOrder: '下界不得大于上界', date: '必须是有效的YYYY-MM-DD日期',
    blank: '文本不能全为空白', control: '文本不能含控制字符', safeInteger: '必须是安全整数',
    anyOf: '至少指定一个允许的修改字段', oneOf: '必须符合一种已声明的参数分支',
  };
  if (!Object.hasOwn(hints, rule)) return null;
  const allowed = rule === 'enum' ? node.enum as unknown[] : rule === 'const' ? [node.const]
    : rule === 'additionalProperties' ? Object.keys(node.properties as object ?? {}) : undefined;
  return { path, rule, hint: hints[rule]!, ...(allowed === undefined ? {} : { allowed }) };
}
export function selectedSchema(schema: JsonSchema, value: unknown): JsonSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return schema;
  const branches = schema.oneOf as JsonSchema[] | undefined;
  const type = (value as Record<string, unknown>).subject_type;
  return branches?.find(branch => {
    const media = (branch.properties as Record<string, JsonSchema> | undefined)?.subject_type;
    return media && Object.hasOwn(media, 'const') && media.const === type;
  }) ?? branches?.find(branch => compileSchema(branch)(value)) ?? schema;
}
export function validateSchema(schema: JsonSchema, value: unknown): void {
  const active = selectedSchema(schema, value);
  const validator = compileSchema(schema);
  if (!validator(value)) {
    // 完整schema始终执行；仅用匹配媒体的分支错误替代其他媒体的噪音。
    const branch = compileSchema(active);
    const errors = active !== schema && !branch(value) ? branch.errors : validator.errors;
    const issues = (errors ?? []).map((error: ErrorObject) => {
      // 未知键名可能含敏感数据，只返回固定的父对象路径及白名单。
      const path = error.keyword === 'required' ? `${error.instancePath}/${String(error.params.missingProperty)}` : error.instancePath;
      const extra = error.params.additionalProperty;
      const forbidden = error.keyword === 'additionalProperties' && error.instancePath === '' && (extra === 'series' || extra === 'platform')
        ? inputIssue(active, `/${String(extra)}`, 'forbidden') : null;
      return forbidden ?? inputIssue(active, path, error.keyword) ?? inputIssue(schema, path, error.keyword);
    }).filter((issue): issue is InputIssue => issue !== null);
    throw new SchemaInputError(issues.length ? [...new Map(issues.map(issue => [issue.path + issue.rule, issue])).values()].slice(0, 8)
      : [{ path: '', rule: 'type', hint: '参数必须符合已声明的工具契约' }]);
  }
  const issues: InputIssue[] = [];
  const check = (node: JsonSchema, item: unknown, path: string): void => {
    if (node.type === 'integer' && !Number.isSafeInteger(item)) issues.push(inputIssue(active, path, 'safeInteger')!);
    if (typeof item === 'string' && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(item)) issues.push(inputIssue(active, path, 'control')!);
    if (node.type === 'object' && item && typeof item === 'object') {
      for (const [key, child] of Object.entries(node.properties as Record<string, JsonSchema> ?? {})) {
        if (Object.hasOwn(item, key)) check(child, (item as Record<string, unknown>)[key], `${path}/${key}`);
      }
    } else if (node.type === 'array' && Array.isArray(item)) item.forEach((child, index) => check(node.items as JsonSchema, child, `${path}/${index}`));
  };
  check(active, value, '');
  if (issues.length) throw new SchemaInputError(issues.slice(0, 8));
}
/** default只在严格验证成功后填入，不删除字段或强制转换。 */
export function schemaArguments(schema: JsonSchema, value: unknown): Record<string, unknown> {
  validateSchema(schema, value);
  const output = structuredClone(value) as Record<string, unknown>;
  const active = selectedSchema(schema, value);
  for (const [key, node] of Object.entries(active.properties as Record<string, JsonSchema> ?? {})) {
    if (!Object.hasOwn(output, key) && Object.hasOwn(node, 'default')) output[key] = structuredClone(node.default);
  }
  return output;
}
