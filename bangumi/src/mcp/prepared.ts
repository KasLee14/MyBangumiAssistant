import { object, positiveId, mediaType, type MediaType } from '../support/bangumi.js';
import { AppError } from '../support/errors.js';

/** MCP专用宿主快照；不依赖旧任务、计划或权限状态机。 */
export interface PreparedBaseline {
  type: MediaType;
  collection: { subjectId: number; status: number | null; rate: number | null; comment: string; tags: string[]; private: boolean | null; chapters: number | null; volumes: number | null } | null;
  episodes?: { id: number; type: number | null; status: number | null; sort?: number | null }[];
}

/** 仅宿主通过 _meta 传递已核对快照，模型参数中没有此字段。 */
export function preparedBaseline(value: unknown): PreparedBaseline {
  const raw = object(value, '已核对快照');
  if (Object.keys(raw).some(key => !['type', 'collection', 'episodes'].includes(key))) throw new AppError('INVALID_INPUT', '快照含未知字段。');
  const type = mediaType(raw.type);
  if (raw.collection !== null) {
    const c = object(raw.collection); positiveId(c.subjectId);
    if (Object.keys(c).some(key => !['subjectId', 'status', 'rate', 'comment', 'tags', 'private', 'chapters', 'volumes'].includes(key))
      || typeof c.status !== 'number' || ![1, 2, 3, 4, 5].includes(c.status) || !Number.isInteger(c.rate) || Number(c.rate) < 0 || Number(c.rate) > 10
      || typeof c.comment !== 'string' || c.comment.length > 2000 || typeof c.private !== 'boolean'
      || !Array.isArray(c.tags) || c.tags.length > 40 || c.tags.some(tag => typeof tag !== 'string' || tag.length > 100)
      || !Number.isSafeInteger(c.chapters) || Number(c.chapters) < 0 || !Number.isSafeInteger(c.volumes) || Number(c.volumes) < 0) throw new AppError('INVALID_INPUT', '快照收藏字段不完整。');
  }
  if (raw.episodes !== undefined) {
    if (!Array.isArray(raw.episodes) || raw.episodes.length > 2000) throw new AppError('INVALID_INPUT', '快照章节无效。');
    const seen = new Set<number>();
    for (const value of raw.episodes) {
      const ep = object(value); const id = positiveId(ep.id);
      if (Object.keys(ep).some(key => !['id', 'type', 'status', 'sort'].includes(key))
        || seen.has(id) || typeof ep.status !== 'number' || ![0, 1, 2, 3].includes(ep.status) || !Number.isSafeInteger(ep.type) || Number(ep.type) < 0) throw new AppError('INVALID_INPUT', '快照章节重复或状态无效。');
      if (ep.sort !== undefined && ep.sort !== null && (typeof ep.sort !== 'number' || !Number.isFinite(ep.sort))) throw new AppError('INVALID_INPUT', '快照章节序号无效。');
      seen.add(id);
    }
  }
  return structuredClone({ type, collection: raw.collection, ...(raw.episodes === undefined ? {} : { episodes: raw.episodes }) }) as PreparedBaseline;
}
