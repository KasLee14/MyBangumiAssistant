import { isDeepStrictEqual } from 'node:util';
import { AppError, isSubmissionRejection, type SubmissionReceipt, type SubmissionItem } from '../support/errors.js';
import { record, positive, type Data } from './resource-output.js';
import type { Binding } from './write-boundary.js';
import { WRITE_RECOVERY_KINDS } from './write-recovery.js';

const collectionFields = ['collection_type', 'rating', 'comment', 'tags', 'private'];
const progressFields = ['ep_status', 'vol_status'];
const invalid = (message: string): never => { throw new AppError('MCP_INVALID_RESULT', message); };
function copy(binding: Binding): Binding {
  return { ...binding, target: structuredClone(binding.target), before: structuredClone(binding.before), after: structuredClone(binding.after),
    args: structuredClone(binding.args), guard: structuredClone(binding.guard), effects: [...binding.effects],
    ...(binding.preflightSkipped ? { preflightSkipped: structuredClone(binding.preflightSkipped) } : {}),
    ...(binding.baseline ? { baseline: structuredClone(binding.baseline) } : {}) };
}
function episodeSnapshot(value: unknown, id: number): Data {
  const snapshot = record(value);
  if (!Array.isArray(snapshot.episodes)) return invalid('章节阶段缺少完整原值或目标快照。');
  const episodes = snapshot.episodes.filter(row => record(row).episode_id === id);
  if (episodes.length !== 1) return invalid('章节阶段与原计划对象不一致。');
  return structuredClone({ ...snapshot, episodes });
}

/** 固定网络阶段均在宿主额度等待前拆开，不改变一次完整计划的授权范围。 */
export function splitWriteStages(name: string, binding: Binding): Binding[] {
  if (!WRITE_RECOVERY_KINDS[name]) throw new AppError('UNKNOWN_TOOL', '写工具未登记核实策略，不能拆分或提交。');
  if (name === 'update_episode_collection') {
    const ids = binding.args.episode_ids;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return invalid('章节阶段范围无效。');
    return ids.map(raw => {
      const id = positive(raw); const stage = copy(binding);
      if (!Array.isArray(binding.target.episodeIds) || !binding.target.episodeIds.includes(id)) return invalid('章节阶段不在已冻结对象范围内。');
      stage.args.episode_ids = [id]; stage.target.episodeIds = [id];
      stage.before = episodeSnapshot(binding.before, id); stage.after = episodeSnapshot(binding.after, id);
      if (!stage.guard.prepared?.episodes) return invalid('章节阶段缺少宿主已核实基线。');
      stage.guard.prepared.episodes = stage.guard.prepared.episodes.filter(ep => ep.id === id);
      if (stage.guard.prepared.episodes.length !== 1) return invalid('章节阶段与宿主已核实基线不一致。');
      stage.readback = async (receipt, signal) => episodeSnapshot(await binding.readback(receipt, signal), id);
      return stage;
    });
  }
  if (name === 'update_subject_collection') {
    const fields = collectionFields.filter(key => Object.hasOwn(binding.args, key));
    const progress = progressFields.filter(key => Object.hasOwn(binding.args, key));
    if (fields.length && progress.length) {
      if (binding.before === null) return invalid('复合书籍进度阶段缺少原收藏。');
      const subjectId = positive(binding.args.subject_id);
      if (binding.guard.subjectId !== subjectId || binding.target.id !== subjectId) return invalid('复合收藏阶段与宿主绑定作品不一致。');
      const first = copy(binding), second = copy(binding);
      first.args = { subject_id: subjectId, ...Object.fromEntries(fields.map(key => [key, structuredClone(binding.args[key])])) };
      first.after = { ...record(structuredClone(binding.before)), ...Object.fromEntries(fields.map(key => [key, structuredClone(record(binding.after)[key])])) };
      second.args = { subject_id: subjectId, ...Object.fromEntries(progress.map(key => [key, binding.args[key]])) };
      second.before = structuredClone(first.after);
      // 如果调用者带prepared，它也必须跟随第二阶段已经生效的收藏字段。
      if (second.guard.prepared?.collection) {
        const current = record(second.before), baseline = second.guard.prepared.collection;
        Object.assign(baseline, { status: current.collection_type, rate: current.rating, comment: current.comment, tags: structuredClone(current.tags), private: current.private,
          chapters: current.ep_status, volumes: current.vol_status });
      }
      return [first, second];
    }
  }
  return [copy(binding)];
}

function targetMatches(planned: SubmissionItem['target'], actual: SubmissionItem['target'], tool: string): boolean {
  if (isDeepStrictEqual(planned, actual)) return true;
  if (tool === 'create_index') return planned === null && actual?.kind === 'index' && Number.isSafeInteger(actual.id) && Number(actual.id) > 0;
  if (tool === 'update_single_episode_collection') return planned === null && actual?.kind === 'episode' && Number.isSafeInteger(actual.id) && Number.isSafeInteger(actual.subjectId);
  if (planned?.kind === 'indexSubject' && actual?.kind === 'indexSubject') {
    return planned.indexId === actual.indexId && planned.subjectId === actual.subjectId && (planned.relationId === null || planned.relationId === actual.relationId);
  }
  return false;
}

/** 聚合原操作的固定逐项顺序；每个阶段只记一次，拒绝证据与真实新ID一并保留。 */
export function mergeStageSubmission(originalReceipt: SubmissionReceipt, stageReceipt: SubmissionReceipt, offset: number): SubmissionReceipt {
  if (originalReceipt.tool !== stageReceipt.tool || originalReceipt.expectedAccountId !== stageReceipt.expectedAccountId
    || stageReceipt.schemaVersion !== 1 || stageReceipt.kind !== 'submission' || stageReceipt.verification !== 'pending'
    || !Number.isSafeInteger(offset) || offset < 0 || !stageReceipt.items.length || offset + stageReceipt.items.length > originalReceipt.items.length
    || stageReceipt.requestedFields.some(field => !originalReceipt.requestedFields.includes(field))
    || stageReceipt.requestedCollected !== originalReceipt.requestedCollected || stageReceipt.requestedEpisodeStatus !== originalReceipt.requestedEpisodeStatus) return invalid('网络阶段回执与原操作或范围不一致。');
  if (originalReceipt.items.slice(0, offset).some(item => item.submissionState !== 'acknowledged')) return invalid('网络阶段回执越过了未完成或已停止的原阶段。');
  if (!targetMatches(originalReceipt.target, stageReceipt.target, originalReceipt.tool)) return invalid('网络阶段汇总对象与原操作不一致。');
  const result = structuredClone(originalReceipt);
  for (let index = 0; index < stageReceipt.items.length; index++) {
    const planned = result.items[offset + index]!, item = stageReceipt.items[index]!;
    if (planned.submissionState !== 'not_attempted' || planned.stage !== item.stage || !targetMatches(planned.target, item.target, result.tool)
      || !['acknowledged', 'rejected', 'unknown', 'not_attempted'].includes(item.submissionState)
      || (item.submissionState === 'rejected' ? !isSubmissionRejection(item.rejection) : item.rejection !== undefined)) return invalid('网络阶段逐项事实与原计划不一致或重复。');
    result.items[offset + index] = structuredClone(item);
  }
  for (const key of ['createdId', 'relatedId'] as const) {
    const actual = stageReceipt[key];
    if (actual !== null) {
      const applicable = key === 'createdId' ? result.tool === 'create_index' && stageReceipt.target?.id === actual
        : ['add_subject_to_index', 'update_index_subject', 'remove_subject_from_index'].includes(result.tool) && stageReceipt.target?.relationId === actual;
      if (!applicable || !Number.isSafeInteger(actual) || actual < 1 || result[key] !== null && result[key] !== actual) return invalid('网络阶段新对象ID冲突或属于其他工具。');
      result[key] = actual;
    }
  }
  if (stageReceipt.target !== null) result.target = structuredClone(stageReceipt.target);
  if (result.createdId !== null || result.relatedId !== null || result.tool === 'update_single_episode_collection') {
    // 创建对象、目录关系和提交前才解析的单集父对象必须在整体与逐项回执保持一致。
    for (const item of result.items) item.target = structuredClone(result.target);
  }
  if (stageReceipt.affectedEpisodeIds !== undefined) {
    if (result.affectedEpisodeIds === undefined || stageReceipt.affectedEpisodeIds.some(id => !Number.isSafeInteger(id) || id < 1)
      || new Set(stageReceipt.affectedEpisodeIds).size !== stageReceipt.affectedEpisodeIds.length
      || result.affectedEpisodeIds.length && !isDeepStrictEqual(result.affectedEpisodeIds, stageReceipt.affectedEpisodeIds)) return invalid('网络阶段声明了原操作之外的看到此集范围。');
    result.affectedEpisodeIds = [...stageReceipt.affectedEpisodeIds];
  }
  let stopped = false;
  if (!result.items.every(item => {
    if (stopped) return item.submissionState === 'not_attempted';
    if (item.submissionState !== 'acknowledged') stopped = true;
    return true;
  })) return invalid('网络阶段回执不符合原串行计划。');
  const acknowledged = result.items.filter(item => item.submissionState === 'acknowledged').length;
  const attempted = result.items.filter(item => item.submissionState !== 'not_attempted').length;
  const rejected = result.items.filter(item => item.submissionState === 'rejected').length;
  result.submissionState = acknowledged === result.items.length ? stageReceipt.submissionState === 'unknown' ? 'unknown' : 'acknowledged'
    : attempted === 0 ? 'not_attempted' : acknowledged > 0 ? 'partial' : rejected === attempted ? 'rejected' : 'unknown';
  return result;
}
