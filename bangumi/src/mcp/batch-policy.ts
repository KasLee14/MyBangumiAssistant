import { AppError, SchemaInputError } from '../support/errors.js';
import type { Data } from './resource-output.js';

export type BatchPhase = 'preflight' | 'execute' | 'verification';
const fatalCodes = new Set([
  'CANCELLED', 'ACCOUNT_CHANGED', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH',
  'BGM_AUTH_REQUIRED', 'BGM_AUTH_EXPIRED', 'BGM_HTTP_401', 'BGM_LOGIN_REJECTED',
  'AUTHORIZATION_REQUIRED', 'WRITE_RECORD_REQUIRED', 'WRITE_RECORD_INVALID', 'WRITE_JOURNAL_INVALID', 'WRITE_RATE_FACT_INVALID',
  'WRITE_PLAN_ALREADY_SUBMITTED', 'BATCH_ALREADY_RECORDED', 'BATCH_CONTEXT_EXPIRED',
  'BATCH_SCOPE_ACTIVE', 'BATCH_SCOPE_INVALID', 'UNKNOWN_TOOL', 'MCP_INVALID_RESULT',
  'MCP_CLOSED', 'MCP_CONNECTION_CLOSED', 'MCP_CATALOG_MISMATCH', 'MCP_START_FAILED',
  'MCP_OUTPUT_LIMIT', 'BGM_OUTPUT_LIMIT',
]);
const localPreflightCodes = new Set([
  'BGM_HTTP_404', 'BGM_HTTP_403', 'PERMISSION_DENIED', 'COLLECTION_REQUIRED',
  'UNSUPPORTED_PROGRESS', 'INVALID_INPUT', 'INCOMPLETE_DATA', 'RESOURCE_UNAVAILABLE',
]);

/** 错误范围与投递事实分开判断；HTTP 写入错误绝不据此推导未生效。 */
export function isBatchFatal(error: unknown, phase: BatchPhase = 'execute'): boolean {
  if (error instanceof SchemaInputError) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const code = error instanceof AppError ? error.code : error && typeof error === 'object' ? (error as Data).code : undefined;
  if (typeof code !== 'string') return true;
  if (fatalCodes.has(String(code))) return true;
  if (phase === 'preflight') return !localPreflightCodes.has(String(code));
  // 缺少合法提交回执的异常由执行边界进一步保守停止。
  return !code || code === 'INTERNAL_ERROR';
}

/** 实际修改粒度不等于共享回读粒度：目录中不同作品各有独立关系。 */
export function batchEffectKeys(name: string, args: Data, target: Data = {}): string[] {
  if (name === 'create_index') return [`new-index:${target.id ?? args.index_id ?? target.stepId ?? ''}`];
  if (name === 'update_subject_collection') return [`subject:${args.subject_id ?? target.id}`];
  if (name.includes('episode_collection')) {
    const ids = args.episode_ids as number[] | undefined ?? (args.episode_id ? [Number(args.episode_id)] : target.episodeIds as number[] | undefined ?? []);
    return ids.map(id => `episode:${id}`);
  }
  if (/^(collect|uncollect)_(character|person)$/.test(name)) {
    const kind = name.endsWith('_character') ? 'character' : 'person';
    return [`${kind}:${args[`${kind}_id`] ?? target.id}`];
  }
  const index = args.index_id ?? target.indexId ?? target.id;
  if (['add_subject_to_index', 'update_index_subject', 'remove_subject_from_index'].includes(name)) {
    return [`relation:${index}:${args.subject_id ?? target.subjectId}`];
  }
  return [`index:${index}`];
}

/** 完整载荷及父收藏使用预测状态，前序失败时不能把它带入后续请求。 */
export function batchDependencyKeys(name: string, args: Data, target: Data = {}): string[] {
  const keys = batchEffectKeys(name, args, target);
  if (name.includes('episode_collection') && (args.subject_id ?? target.subjectId)) keys.push(`subject:${args.subject_id ?? target.subjectId}`);
  if (target.kind === 'indexSubject') keys.push(`index:${args.index_id ?? target.indexId}`);
  return keys;
}
