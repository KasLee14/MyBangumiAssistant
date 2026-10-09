import { AppError, isContractIssue, type SafeError } from '../support/errors.js';
import { isErrorDiagnostic } from '../support/error-diagnostic.js';
import { isDeepStrictEqual } from 'node:util';
import { compileSchema } from '../support/tool-schema.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';
export type ResourceData = Record<string, unknown>;
export interface CachedResource { schemaVersion: 1; kind: 'cached_resource'; resourceRef: string; sourceTool: string; value: ResourceData; accessContext: AccessContext }
/** 宿主展示读取的明确成员范围；不登记到模型 MCP 工具目录。 */
export interface CachedResourceSelection { subjectIds: number[] }
export type CachedResourceRpcResult = { resource: CachedResource } | { error: SafeError };
export const CACHED_RESOURCE_SELECTION_LIMIT = 200;
export const CACHED_RESOURCE_RPC_OPERATION = 'bangumi.readCachedResource';
export interface CachedRange { offset?: number; limit?: number }
export const RESOURCE_REF_PATTERN = '^rr_[a-f0-9]{32}$';
export function cachedResourceSelection(value: unknown): CachedResourceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'subjectIds'))
    throw new AppError('INVALID_INPUT', '缓存展示范围只允许 subjectIds。');
  const ids = (value as ResourceData).subjectIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > CACHED_RESOURCE_SELECTION_LIMIT
    || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length)
    throw new AppError('INVALID_INPUT', '缓存展示作品须为非空、不重复的正整数列表，最多200项。');
  return { subjectIds: [...ids] as number[] };
}
export function stripResourceRef(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { resourceRef: _ref, ...rest } = value as ResourceData;
  return rest;
}
export const cachedResourceInputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    resource_ref: { type: 'string', pattern: RESOURCE_REF_PATTERN },
    fields: { type: 'array', maxItems: 80, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$', maxLength: 80 } },
    keys: {
      type: 'array', maxItems: 100, uniqueItems:true, items: {
        oneOf: [{ type: 'integer', minimum: 1 }, {
          type: 'object', minProperties: 1, maxProperties: 8,
          properties: {
            ...Object.fromEntries(['id','subjectId','personId','characterId','episodeId','revisionId','blogId','topicId','replyId','relationId','indexId','parentId'].map(key=>[key,{type:'integer',minimum:1}])),
            code:{type:'integer',minimum:0},
            ...Object.fromEntries(['username','userIdentifier','kind','entity'].map(key=>[key,{type:'string',minLength:1,maxLength:100}]))
          }, additionalProperties:false
        }]
      }
    },
    range: { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 5000, default: 500 } } }
  }, required: ['resource_ref']
};
export const cachedResourceOutputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    value: {
      type: 'object', additionalProperties: false, properties: {
        schemaVersion: { const: 1 }, kind: { const: 'cached_resource' }, resourceRef: { type: 'string', pattern: RESOURCE_REF_PATTERN }, sourceTool: { type: 'string' },
        value: { type: 'object' }, accessContext: { type: 'object' }, fields: { type: 'array', items: { type: 'string' } },
        fieldStates: { type: 'object' }, range: { type: 'object' }
      }, required: ['schemaVersion', 'kind', 'resourceRef', 'sourceTool', 'value', 'accessContext']
    }
  }, required: ['value']
};
export function checkCachedResource(value: unknown): asserts value is CachedResource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('MCP_INVALID_RESULT', '缓存资源必须是对象。');
  const row = value as ResourceData;
  if (row.schemaVersion !== 1 || row.kind !== 'cached_resource' || typeof row.resourceRef !== 'string' || !new RegExp(RESOURCE_REF_PATTERN).test(row.resourceRef)
    || typeof row.sourceTool !== 'string' || !row.value || typeof row.value !== 'object' || Array.isArray(row.value) || !row.accessContext) throw new AppError('MCP_INVALID_RESULT', '缓存资源契约无效。');
}
const cachedResourceErrorSchema = withAccessContext({
  type: 'object', additionalProperties: false, required: ['error'], properties: {
    error: { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: {
      code: { type: 'string', pattern: '^[A-Z][A-Z_0-9]{0,79}$' }, message: { type: 'string', maxLength: 20_000 },
    } },
  },
});
/** 成功与错误互斥，不能靠 SDK 丢弃未知字段来掩盖错误信封。 */
export function checkCachedResourceRpcResult(value: unknown): asserts value is CachedResourceRpcResult {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '缓存 RPC 返回不符合固定成功或错误契约。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) invalid();
  const row = value as ResourceData;
  if (Object.hasOwn(row, 'resource')) {
    checkCachedResource(row.resource);
    const resource = row.resource;
    if (Object.keys(resource).length !== 6 || !/^[a-z][a-z_0-9]{0,99}$/.test(resource.sourceTool)
      || !compileSchema(accessContextSchema)(resource.accessContext)
      || !isDeepStrictEqual(resource.accessContext, resource.value.accessContext)) invalid();
    return;
  }
  if (!compileSchema(cachedResourceErrorSchema)(row)) invalid();
  const error = row.error as SafeError;
  if (error.diagnostic !== undefined && (!isErrorDiagnostic(error.diagnostic) || error.diagnostic.code !== error.code
    || error.sourceTool !== undefined && error.diagnostic.operation !== undefined && error.diagnostic.operation !== error.sourceTool)
    || error.sourceTool !== undefined && !/^[a-z][a-z_0-9]{0,99}$/.test(error.sourceTool)
    || error.recovery !== undefined && error.code !== 'MCP_INVALID_RESULT'
    || error.rejection !== undefined || error.submission !== undefined
    || error.contractIssue !== undefined && (error.code !== 'MCP_INVALID_RESULT' || error.sourceTool !== 'browse_subjects' || !isContractIssue(error.contractIssue))) invalid();
}
