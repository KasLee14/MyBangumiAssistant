import { isDeepStrictEqual } from 'node:util';
import { TOOL_DEFINITIONS } from './catalog.js';
import { AppError, isSubmissionRejection } from '../support/errors.js';
import { record, type Data } from './resource-output.js';

export const WRITE_RECOVERY_KINDS: Readonly<Record<string, string>> = Object.freeze({
  update_subject_collection: 'subject', update_episode_collection: 'episodes', update_single_episode_collection: 'episodes',
  collect_character: 'character', uncollect_character: 'character', collect_person: 'person', uncollect_person: 'person',
  create_index: 'create', update_index: 'index', add_subject_to_index: 'relation', update_index_subject: 'relation',
  remove_subject_from_index: 'relation', collect_index: 'indexCollection', uncollect_index: 'indexCollection',
});
for (const tool of TOOL_DEFINITIONS.filter(tool => tool.effect === 'write')) {
  if (!WRITE_RECOVERY_KINDS[tool.name]) throw new Error(`写工具${tool.name}未登记独立核实策略。`);
}

/** 操作身份属于一次执行；相同参数的新真实用户请求不是原调用重放。 */
export function writeFactIdentity(fact: Data): string {
  if (typeof fact.operationId === 'string') return fact.operationId;
  if (typeof fact.toolCallId === 'string') return `legacy:${fact.accountId}:${fact.toolCallId}`;
  return `legacy-fingerprint:${fact.accountId}:${fact.fingerprint}`;
}
export function latestWriteFacts(facts: readonly Data[], accountId: number): Data[] {
  const latest = new Map<string, Data>();
  for (const fact of facts) {
    if (fact.accountId !== accountId || fact.kind !== 'bangumi-write' && !fact.tool && !fact.fingerprint) continue;
    const key = writeFactIdentity(fact);
    latest.set(key, { ...latest.get(key), ...fact });
  }
  return [...latest.values()];
}
export function pendingWriteFact(fact: Data): boolean {
  // submission 只说明投递阶段结束；即便局部阶段被拒绝或取消，也尚未独立核实前序提交。
  return fact.phase === 'started' || fact.phase === 'submission' || fact.phase === 'submitted' || fact.state === 'unknown' || fact.state === 'submitted'
    || fact.phase !== 'reconciled' && fact.writeNetworkAttempted === true && record(fact.verification ?? {}).readbackCompleted === false && !definiteWriteRejection(fact);
}

export function recoveryTool(fact: Data): string {
  const explicit = fact.tool ?? (fact.submission ? record(fact.submission).tool : undefined);
  if (typeof explicit === 'string' && WRITE_RECOVERY_KINDS[explicit]) return explicit;
  // 旧 started 未记录 tool；只推导能唯一确定的固定契约，绝不猜 collect/uncollect。
  const args = record(fact.args);
  if (Object.hasOwn(args, 'title') && !Object.hasOwn(args, 'index_id')) return 'create_index';
  if (Object.hasOwn(args, 'episode_ids')) return 'update_episode_collection';
  if (Object.hasOwn(args, 'episode_id')) return 'update_single_episode_collection';
  if (Object.hasOwn(args, 'subject_id') && !Object.hasOwn(args, 'index_id')) return 'update_subject_collection';
  throw new AppError('WRITE_RECOVERY_METADATA_REQUIRED', '旧修改缺少可核实的操作类型；请保留记录并提供原操作及对象，未重发。');
}

/** 冲突域包括目标及受保护的父对象；未知目录结果不会永久封锁无关联的评分/人物操作。 */
export function writeConflictKeys(name: string, args: Data, target: Data = {}): string[] {
  const kind = WRITE_RECOVERY_KINDS[name];
  if (!kind) return ['account'];
  if (kind === 'subject') return [`subject:${args.subject_id ?? target.id}`];
  if (kind === 'episodes') {
    const parent = args.subject_id ?? target.subjectId;
    const ids = args.episode_ids as unknown[] | undefined ?? (args.episode_id ? [args.episode_id] : target.episodeIds as unknown[] | undefined ?? []);
    return [...(parent ? [`subject:${parent}`] : ['account']), ...ids.map(id => `episode:${id}`)];
  }
  if (kind === 'person' || kind === 'character') return [`${kind}:${args[`${kind}_id`] ?? target.id}`];
  if (kind === 'create') return ['index-new', target.id ? `index:${target.id}` : 'index:*'];
  const id = args.index_id ?? target.indexId ?? target.id;
  return id && Number(id) > 0 ? [`index:${id}`] : ['index-new'];
}

/** 混合或多阶段中断只允许原值/目标值组合；任何范围外变化都不能自动结案。 */
export function allowedWriteSnapshot(before: unknown, after: unknown, actual: unknown): boolean {
  if (isDeepStrictEqual(actual, before) || isDeepStrictEqual(actual, after)) return true;
  if (!before || !after || !actual || typeof before !== 'object' || typeof after !== 'object' || typeof actual !== 'object') return false;
  if (Array.isArray(before) || Array.isArray(after) || Array.isArray(actual)) {
    return Array.isArray(before) && Array.isArray(after) && Array.isArray(actual) && before.length === after.length && after.length === actual.length
      && after.every((value, i) => allowedWriteSnapshot(before[i], value, actual[i]));
  }
  const a = record(before), b = record(after), c = record(actual); const keys = Object.keys(b).sort();
  return isDeepStrictEqual(Object.keys(a).sort(), keys) && isDeepStrictEqual(Object.keys(c).sort(), keys)
    && keys.every(key => allowedWriteSnapshot(a[key], b[key], c[key]));
}

export function definiteWriteRejection(fact: Data): boolean {
  const receipt = fact.submission ? record(fact.submission) : undefined;
  const error = fact.submissionError ? record(fact.submissionError) : undefined;
  const rejection = error?.rejection;
  const items = receipt?.items;
  return receipt?.submissionState === 'rejected' && Array.isArray(items) && items.some(item => record(item).submissionState === 'rejected' && isSubmissionRejection(record(item).rejection))
    || isSubmissionRejection(rejection);
}

/** 未发送或明确拒绝的后续阶段没有目标变化；核实已经尝试的前段，不要求补写才能结案。 */
export function submittedWriteTarget(name: string, fact: Data): unknown {
  const after = structuredClone(fact.after);
  const items = record(fact.submission ?? {}).items;
  if (!Array.isArray(items) || !Object.hasOwn(fact, 'before')) return after;
  const skipped = items.filter(raw => ['not_attempted', 'rejected'].includes(String(record(raw).submissionState))).map(record);
  if (!skipped.length) return after;
  if (name === 'update_episode_collection') {
    const planned = record(after), original = record(fact.before);
    planned.episodes = (planned.episodes as Data[]).map(ep => skipped.some(item => record(item.target).id === ep.episode_id)
      ? structuredClone((original.episodes as Data[]).find(value => value.episode_id === ep.episode_id)) : ep);
  } else if (name === 'update_subject_collection' && after && fact.before) {
    const planned = record(after), original = record(fact.before);
    for (const item of skipped) {
      const fields = item.stage === 'book_progress' ? ['ep_status', 'vol_status'] : ['collection_type', 'rating', 'comment', 'tags', 'private'];
      for (const key of fields) planned[key] = structuredClone(original[key]);
    }
  }
  return after;
}
