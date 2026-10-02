import { object, positiveId, progressCapability, type Subject, type Collection, type CompleteEpisodes } from './bangumi.js';
import { AppError } from './errors.js';
import { planEpisodeTargets } from './progress.js';
import type { PlannedAction, FieldChange } from './permissions.js';

export type ProgressRequest = { mode: 'through'; number: number } | { mode: 'single' | 'ordinal'; number: number; status?: number } | { mode: 'explicit'; episodeId: number; status?: number }
  | { mode: 'book'; chapters?: number; volumes?: number } | { mode: 'rollback'; number: number } | { mode: 'clear' };
const nonnegative = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 };
const episodeStatus = { type: 'integer', minimum: 0, maximum: 3, description: '0清空、1想看、2看过、3抛弃；省略为2。清空或降低进度需确认。' };
function branch(mode: string, properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties: { mode: { type: 'string', enum: [mode] }, ...properties }, required: ['mode', ...required], additionalProperties: false };
}
export const progressSchema = { oneOf: [
  branch('through', { number: positive }, ['number']),
  branch('single', { number: { ...positive, description: '网站章节编号，非本季序号。' }, status: episodeStatus }, ['number']),
  branch('ordinal', { number: { ...positive, description: '已绑定条目的本季主线第N项，由宿主完整读取后映射。' }, status: episodeStatus }, ['number']),
  branch('explicit', { episodeId: { ...positive, description: '属于当前作品的普通或特殊章节ID。' }, status: episodeStatus }, ['episodeId']),
  branch('rollback', { number: nonnegative }, ['number']),
  { ...branch('book', { chapters: nonnegative, volumes: nonnegative }, []), anyOf: [{ required: ['chapters'] }, { required: ['volumes'] }] },
  branch('clear', {}, []),
] };
function statusFrom(item: Record<string, unknown>): { status?: number } {
  if (item.status === undefined) return {};
  if (!Number.isInteger(item.status) || ![0, 1, 2, 3].includes(Number(item.status))) throw new AppError('INVALID_INPUT', '章节状态须为0～3整数。');
  return { status: item.status as number };
}
export function progressRequest(value: unknown): ProgressRequest {
  const item = object(value, '进度参数');
  if (item.mode === 'clear') {
    if (Object.keys(item).some(key => key !== 'mode')) throw new AppError('INVALID_INPUT', '清空参数包含未知字段。');
    return { mode: 'clear' };
  }
  if (item.mode === 'through' || item.mode === 'single' || item.mode === 'ordinal' || item.mode === 'rollback') {
    const single = item.mode === 'single' || item.mode === 'ordinal';
    if (Object.keys(item).some(key => !['mode','number', ...(single ? ['status'] : [])].includes(key))) throw new AppError('INVALID_INPUT', `${item.mode}需要number，不能携带episodeId；按章节ID指定请使用explicit。`);
    if (item.mode === 'rollback' && item.number === 0) return { mode: 'rollback', number: 0 };
    return { mode: item.mode, number: positiveId(item.number), ...(single ? statusFrom(item) : {}) };
  }
  if (item.mode === 'explicit') {
    if (Object.keys(item).some(key => !['mode','episodeId','status'].includes(key))) throw new AppError('INVALID_INPUT', 'explicit只接受episodeId及可选status，不能携带number。');
    return { mode: 'explicit', episodeId: positiveId(item.episodeId), ...statusFrom(item) };
  }
  if (item.mode === 'book') {
    const keys = Object.keys(item).filter(key => key !== 'mode');
    if (!keys.length || keys.some(key => !['chapters','volumes'].includes(key) || !Number.isSafeInteger(item[key]) || Number(item[key]) < 0)) throw new AppError('INVALID_INPUT', '书籍章数/卷数须为非负整数。');
    return { mode: 'book', ...(item.chapters === undefined ? {} : { chapters: item.chapters as number }), ...(item.volumes === undefined ? {} : { volumes: item.volumes as number }) };
  }
  throw new AppError('INVALID_INPUT', '不支持此进度模式。');
}
export function progressAction(subject: Subject, current: Collection | null, request: ProgressRequest, episodes?: CompleteEpisodes): PlannedAction {
  if (!progressCapability(subject.type).supported) throw new AppError('UNSUPPORTED_PROGRESS', progressCapability(subject.type).reason);
  if (!current || current.status === null) throw new AppError('COLLECTION_REQUIRED', '请先选择此作品的收藏状态，再重新预览进度；不自动创建或联动收藏。');
  const changes: FieldChange[] = [];
  let notice: string | undefined;
  if (request.mode === 'book' || (request.mode === 'clear' && subject.type === 'book')) {
    if (subject.type !== 'book') throw new AppError('UNSUPPORTED_PROGRESS', '章数/卷数只适用于书籍。');
    for (const field of ['chapters','volumes'] as const) {
      const after = request.mode === 'clear' ? 0 : request[field]; if (after === undefined) continue;
      const before = current[field];
      if (before === null) throw new AppError('INCOMPLETE_COLLECTION', '书籍现有进度未知。');
      if (field === 'chapters' && subject.totalEpisodes !== null && subject.totalEpisodes > 0 && after > subject.totalEpisodes) throw new AppError('PROGRESS_OUT_OF_RANGE', '章数超过已知总数。');
      if (field === 'volumes' && subject.totalVolumes != null && subject.totalVolumes > 0 && after > subject.totalVolumes) throw new AppError('PROGRESS_OUT_OF_RANGE', '卷数超过已知总数。');
      if (after !== before) changes.push({ field, before, after });
    }
  } else {
    if (!episodes) throw new AppError('INCOMPLETE_EPISODES', '需要完整个人章节清单。');
    if (!episodes.complete) throw new AppError('INCOMPLETE_EPISODES', '章节清单不完整。');
    const clearing = request.mode === 'clear' || request.mode === 'rollback';
    if (request.mode === 'rollback' && request.number > 0) planEpisodeTargets(subject.type, episodes.data, episodes.complete, { mode: 'single', number: request.number });
    const targets = request.mode === 'clear' ? episodes.data.map(ep => ep.id)
      : request.mode === 'rollback' ? episodes.data.filter(ep => ep.type === 0 && ep.number !== null && ep.number > request.number && ep.status === 2).map(ep => ep.id)
      : planEpisodeTargets(subject.type, episodes.data, episodes.complete, request);
    for (const id of targets) {
      const episode = episodes.data.find(ep => ep.id === id)!;
      if (episode.status === null || ![0,1,2,3].includes(episode.status)) throw new AppError('INCOMPLETE_EPISODES', '个人章节状态未知。');
      const after = clearing ? 0 : 'status' in request ? request.status ?? 2 : 2;
      if (episode.status !== after) changes.push({ field: `episode:${id}`, before: episode.status, after });
    }
    const main = episodes.data.filter(ep => ep.type === 0 && ep.number !== null && ep.number >= 1);
    if (!clearing && (!('status' in request) || request.status === undefined || request.status === 2) && main.length && main.every(ep => ep.status === 2 || targets.includes(ep.id))) notice = '主线已全部看过，是否将收藏状态改为看过？当前操作保留已有收藏状态。';
    if (request.mode === 'ordinal') {
      const target = episodes.data.find(ep => ep.id === targets[0])!;
      notice = `本季第${request.number}集 / 网站编号${target.number} / 章节${target.id} ${target.name}。\n${notice ?? '保留其他章节与收藏状态。'}`;
    }
    if (request.mode === 'rollback') notice = '只移除目标之后的主线已看状态；不补齐此前未看章节，不改特殊章节/想看/抛弃状态。';
    if (request.mode === 'clear') notice = '清空完整清单中的全部章节状态，包含特殊章节、想看与抛弃；保留父条目收藏字段。';
  }
  if (!changes.length) throw new AppError('NO_CHANGE', '进度已与请求一致，无需修改。');
  return { subjectId: subject.id, title: subject.nameCn || subject.name, kind: 'progress', changes, effects: [],
    baseline: { type: subject.type, collection: structuredClone(current), ...(episodes ? { episodes: structuredClone(episodes.data) } : {}) },
    notice: request.mode === 'book' ? notice ?? '书籍章数与卷数独立更新。' : `明确进度语义：${JSON.stringify(request)}\n${notice ?? '只修改列出的章节，保留其他进度与收藏状态。'}` };
}
