import { object, positiveId, mediaType } from '../../domain/bangumi.js';
import { AppError } from '../../domain/errors.js';
import type { PlannedAction } from '../../domain/permissions.js';

export type PreparedBaseline = NonNullable<PlannedAction['baseline']>;

/** 仅宿主通过 _meta 传递已核对快照，模型参数中没有此字段。 */
export function preparedBaseline(value: unknown): PreparedBaseline {
  const raw = object(value, '已核对快照');
  if (Object.keys(raw).some(key => !['type', 'collection', 'episodes'].includes(key))) throw new AppError('INVALID_INPUT', '快照含未知字段。');
  const type = mediaType(raw.type);
  if (raw.collection !== null) {
    const c = object(raw.collection); positiveId(c.subjectId);
    if (![1, 2, 3, 4, 5].includes(Number(c.status)) || !Number.isInteger(c.rate) || Number(c.rate) < 0 || Number(c.rate) > 10
      || typeof c.comment !== 'string' || c.comment.length > 2000 || typeof c.private !== 'boolean'
      || !Array.isArray(c.tags) || c.tags.length > 40 || c.tags.some(tag => typeof tag !== 'string')) throw new AppError('INVALID_INPUT', '快照收藏字段不完整。');
  }
  if (raw.episodes !== undefined) {
    if (!Array.isArray(raw.episodes) || raw.episodes.length > 2000) throw new AppError('INVALID_INPUT', '快照章节无效。');
    const seen = new Set<number>();
    for (const value of raw.episodes) {
      const ep = object(value); const id = positiveId(ep.id);
      if (seen.has(id) || typeof ep.status !== 'number' || ![0, 1, 2, 3].includes(ep.status) || !Number.isInteger(ep.type)) throw new AppError('INVALID_INPUT', '快照章节重复或状态无效。');
      seen.add(id);
    }
  }
  return structuredClone({ type, collection: raw.collection, ...(raw.episodes === undefined ? {} : { episodes: raw.episodes }) }) as PreparedBaseline;
}

export function usesPreparedBaseline(action: PlannedAction): boolean {
  return Boolean(action.baseline && (action.kind === 'collection' && action.changes.every(change => change.field === 'status')
    || action.kind === 'progress' && ['anime', 'real'].includes(action.baseline.type) && action.baseline.episodes));
}
