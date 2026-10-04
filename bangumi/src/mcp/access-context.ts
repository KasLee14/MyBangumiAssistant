import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { AppError } from '../support/errors.js';
import { isDeepStrictEqual } from 'node:util';
import { SEARCH_LIMITATIONS, type QueryCoverage } from './search-capabilities.js';

export const submissionRejectionSchema: JsonSchema = { type: 'object', additionalProperties: false, properties: {
  kind: { type: 'string', const: 'rate_limit' }, httpStatus: { type: 'integer', const: 429 },
  upstreamCode: { type: 'string', const: 'RATE_LIMIT_EXCEEDED' },
  retryAfterMs: { anyOf: [{ type: 'integer', minimum: 0, maximum: 86_400_000 }, { type: 'null' }] },
}, required: ['kind', 'httpStatus', 'upstreamCode', 'retryAfterMs'] };

export interface AccessContext {
  mode: 'account' | 'anonymous' | 'unverified';
  account: { id: number; username: string } | null;
  nsfw: { preference: boolean | null; allowed: boolean | null; state: 'enabled' | 'disabled' | 'unknown' };
  source: 'p1' | 'v0' | 'web';
  nsfwApplied: boolean;
  checkedAt: string;
  queryCoverage?: QueryCoverage;
}
const nullableBoolean = { type: ['boolean', 'null'] };
export const accessContextSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { enum: ['account', 'anonymous', 'unverified'] },
    account: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: {
      id: { type: 'integer', minimum: 1 }, username: { type: 'string', minLength: 1, maxLength: 200 },
    }, required: ['id', 'username'] }] },
    nsfw: { type: 'object', additionalProperties: false, properties: {
      preference: nullableBoolean, allowed: nullableBoolean, state: { enum: ['enabled', 'disabled', 'unknown'] },
    }, required: ['preference', 'allowed', 'state'] },
    source: { enum: ['p1', 'v0', 'web'] }, nsfwApplied: { type: 'boolean' }, checkedAt: { type: 'string', maxLength: 50 },
    queryCoverage: { type: 'object', additionalProperties: false, properties: {
      requested: { enum: ['account', 'exclude'] }, actual: { enum: ['account_visible', 'sfw_only', 'public_visible'] },
      nsfw: { enum: ['included', 'excluded', 'unknown'] }, totalKind: { enum: ['estimated', 'exact', 'unknown'] },
      limitations: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', enum: [...SEARCH_LIMITATIONS] } },
    }, required: ['requested', 'actual', 'nsfw', 'totalKind', 'limitations'] },
  }, required: ['mode', 'account', 'nsfw', 'source', 'nsfwApplied', 'checkedAt'],
  allOf: [
    { if: { properties: { queryCoverage: { type: 'object', properties: { nsfw: { const: 'included' } }, required: ['nsfw'] } }, required: ['queryCoverage'] },
      then: { properties: { mode: { const: 'account' }, source: { const: 'p1' }, nsfwApplied: { const: true },
        nsfw: { type: 'object', properties: { allowed: { const: true } } },
        queryCoverage: { type: 'object', properties: { actual: { const: 'account_visible' } } } } } },
    { if: { properties: { queryCoverage: { type: 'object', properties: { actual: { const: 'sfw_only' } }, required: ['actual'] } }, required: ['queryCoverage'] },
      then: { properties: { queryCoverage: { type: 'object', properties: { nsfw: { const: 'excluded' } } } } } },
    { if: { properties: { queryCoverage: { type: 'object', properties: { requested: { const: 'exclude' } }, required: ['requested'] } }, required: ['queryCoverage'] },
      then: { properties: { queryCoverage: { type: 'object', properties: { actual: { const: 'sfw_only' }, nsfw: { const: 'excluded' } } } } } },
    { if: { properties: { mode: { const: 'account' } } }, then: { properties: { account: { type: 'object' } } },
      else: { properties: { account: { type: 'null' } } } },
    ...(['enabled', 'disabled', 'unknown'] as const).map(state => ({
      if: { properties: { nsfw: { type: 'object', properties: { state: { const: state } } } } },
      then: { properties: { nsfw: { type: 'object', properties: { allowed: { const: state === 'unknown' ? null : state === 'enabled' } } } } },
    })),
  ],
};
export function anonymousContext(): AccessContext {
  return { mode: 'anonymous', account: null, nsfw: { preference: null, allowed: false, state: 'disabled' },
    source: 'v0', nsfwApplied: false, checkedAt: new Date().toISOString() };
}
export function unverifiedContext(): AccessContext {
  return { mode: 'unverified', account: null, nsfw: { preference: null, allowed: null, state: 'unknown' },
    source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString() };
}
/** 端点共享的成功结果权限语义；纯DTO辅助函数仍可不携带上下文。 */
export function checkAccessResponse(name: string, value: unknown, requireContext = true): void {
  const record = (raw: unknown): raw is Record<string, unknown> => raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  const invalid = (message: string): never => { throw new AppError('MCP_INVALID_RESULT', message); };
  if (!record(value)) invalid('MCP成功业务结果不是对象。');
  const raw = value as Record<string, unknown>;
  if (raw.accessContext === undefined && !requireContext) return;
  if (!compileSchema(accessContextSchema)(raw.accessContext)) invalid('MCP成功业务结果缺少有效权限上下文。');
  const context = raw.accessContext as AccessContext;
  if (context.mode === 'unverified') invalid('未核实的权限上下文不能作为成功结果。');
  if (context.nsfw.allowed === false || context.queryCoverage?.nsfw === 'excluded') {
    const visit = (item: unknown): void => {
      if (Array.isArray(item)) { item.forEach(visit); return; }
      if (!record(item)) return;
      if (item.nsfw === true) invalid('MCP成功结果含权限或请求范围之外的NSFW资料。');
      Object.values(item).forEach(visit);
    };
    visit(raw);
  }
  if (name === 'get_current_user' && (context.mode !== 'account' || !context.account
    || raw.id !== context.account.id || raw.username !== context.account.username)) invalid('当前账户结果与权限上下文不一致。');
  if (raw.visibility === 'self') {
    if (context.mode !== 'account' || !context.account) invalid('本人成功结果缺少已核实账户。');
    if (name !== 'query_user_collections' && !isDeepStrictEqual(raw.account, context.account)) invalid('本人快照账户与权限上下文不一致。');
  }
  if (raw.kind === 'submission' && (context.mode !== 'account' || !context.account
    || raw.expectedAccountId !== context.account.id)) invalid('提交回执账户与权限上下文不一致。');
  if (name === 'query_user_collections' && record(raw.coverage) && (raw.coverage.source !== context.source
    || raw.coverage.privateRecords !== (raw.visibility === 'self' ? 'included' : 'public_only'))) invalid('收藏覆盖来源或隐私范围与权限上下文不一致。');
}
/** 只扩展最外层业务值与安全错误，嵌套个人快照的原有闭合契约不变。 */
export function withAccessContext(schema: JsonSchema): JsonSchema {
  const result = structuredClone(schema);
  const add = (node: JsonSchema | undefined): void => {
    if (!node) return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      add((result.$defs as Record<string, JsonSchema> | undefined)?.[node.$ref.slice(8)]); return;
    }
    if (node.properties) { const properties = node.properties as Record<string, JsonSchema>; properties.accessContext = accessContextSchema;
      if (properties.code && properties.message) {
        properties.networkAttempted = { type: 'boolean', const: false };
        properties.rejection = submissionRejectionSchema;
        properties.sourceTool = { type: 'string', minLength: 1, maxLength: 100 };
        properties.recovery = { type: 'object', additionalProperties: false, properties: {
          stage: { type: 'string', const: 'response_contract' }, retryable: { type: 'boolean', const: false },
        }, required: ['stage', 'retryable'] };
      } }
    for (const branch of node.oneOf as JsonSchema[] ?? []) add(branch);
    for (const branch of node.anyOf as JsonSchema[] ?? []) if (branch.type !== 'null') add(branch);
    for (const branch of node.allOf as JsonSchema[] ?? []) add(branch);
  };
  for (const branch of result.oneOf as JsonSchema[] ?? [result]) {
    const properties = branch.properties as Record<string, JsonSchema> | undefined;
    add(properties?.value); add(properties?.error);
  }
  return result;
}
