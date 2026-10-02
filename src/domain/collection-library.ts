import { AppError } from './errors.js';
import { MEDIA_TYPES, mediaType, pageOffset, type MediaType } from './bangumi.js';

export const COLLECTION_STATUSES = ['wish', 'completed', 'in_progress', 'on_hold', 'dropped'] as const;
export type CollectionStatus = typeof COLLECTION_STATUSES[number];
export const STATUS_IDS: Record<CollectionStatus, number> = { wish: 1, completed: 2, in_progress: 3, on_hold: 4, dropped: 5 };
export function collectionStatus(value: unknown): CollectionStatus {
  if (typeof value !== 'string' || !COLLECTION_STATUSES.includes(value as CollectionStatus)) throw new AppError('INVALID_INPUT', `收藏状态必须为 ${COLLECTION_STATUSES.join('、')}。`);
  return value as CollectionStatus;
}
export interface CollectionEntry {
  subjectId: number; type: MediaType; name: string; nameCn: string; status: CollectionStatus;
  rate: number | null; tags: string[] | null; private: boolean | null;
  chapters: number | null; volumes: number | null; updatedAt: string | null; url: string;
}
export interface CollectionQuery { type?: MediaType; status?: CollectionStatus; limit?: number; offset?: number }
export function collectionQuery(value: CollectionQuery, maximum = 100): Required<Pick<CollectionQuery, 'limit' | 'offset'>> & CollectionQuery {
  const limit = value.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new AppError('INVALID_INPUT', `收藏每页数量须为1～${maximum}。`);
  return { limit, offset: pageOffset(value.offset ?? 0),
    ...(value.type === undefined ? {} : { type: mediaType(value.type) }),
    ...(value.status === undefined ? {} : { status: collectionStatus(value.status) }) };
}
export interface CollectionAccount { id: number; username: string }
export interface CollectionPage {
  account: CollectionAccount; data: CollectionEntry[]; total: number; offset: number; limit: number;
  nextOffset: number | null; complete: boolean; readAt: string; scope: { type?: MediaType; status?: CollectionStatus };
}
export interface CollectionSource {
  currentUser(signal?: AbortSignal): Promise<CollectionAccount>;
  collections(query: CollectionQuery, signal?: AbortSignal): Promise<CollectionPage>;
}
export interface CollectionSnapshot {
  account: CollectionAccount; data: CollectionEntry[]; total: number; complete: true;
  startedAt: string; readAt: string; scope: { type?: MediaType };
}
export interface CollectionCounts {
  total: number; statuses: Record<CollectionStatus, number>;
  ratings: { distribution: Record<string, number>; unrated: number; unknown: number; rated: number; average: number | null };
}
function emptyCounts(): CollectionCounts {
  return { total: 0, statuses: { wish: 0, completed: 0, in_progress: 0, on_hold: 0, dropped: 0 },
    ratings: { distribution: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), 0])), unrated: 0, unknown: 0, rated: 0, average: null } };
}
/** 只在已核实完整的当前收藏上统计；0为未评分，null为未知。 */
export function summarizeCollections(snapshot: CollectionSnapshot) {
  if (snapshot.complete !== true || snapshot.data.length !== snapshot.total || new Set(snapshot.data.map(item => item.subjectId)).size !== snapshot.total) throw new AppError('INCOMPLETE_COLLECTION', '收藏清单不完整，不能统计全部收藏。');
  const overall = emptyCounts();
  const includedTypes = snapshot.scope.type ? [snapshot.scope.type] : [...MEDIA_TYPES];
  const byType = Object.fromEntries(includedTypes.map(type => [type, emptyCounts()])) as Record<MediaType, CollectionCounts>;
  for (const item of snapshot.data) {
    if (!byType[item.type] || !COLLECTION_STATUSES.includes(item.status) || (snapshot.scope.type && snapshot.scope.type !== item.type)) throw new AppError('INVALID_RESPONSE', '收藏类型、状态或统计范围不一致。');
    for (const counts of [overall, byType[item.type]]) {
      counts.total++; counts.statuses[item.status]++;
      if (item.rate === 0) counts.ratings.unrated++;
      else if (item.rate !== null && Number.isInteger(item.rate) && item.rate >= 1 && item.rate <= 10) {
        counts.ratings.rated++; counts.ratings.distribution[String(item.rate)]!++;
      } else counts.ratings.unknown++;
    }
  }
  for (const counts of [overall, ...Object.values(byType)]) {
    const sum = Object.entries(counts.ratings.distribution).reduce((value, [rating, count]) => value + Number(rating) * count, 0);
    counts.ratings.average = counts.ratings.rated ? Math.round(sum / counts.ratings.rated * 100) / 100 : null;
  }
  return { account: snapshot.account, scope: snapshot.scope, includedTypes, complete: true as const, fetched: snapshot.data.length,
    startedAt: snapshot.startedAt, readAt: snapshot.readAt, overall, byType,
    basis: '当前账户可读取的现存条目收藏（含私密）；已完成依据收藏状态，不推断章节完成，不包含已删除历史。评分为个人评分，0为未评分，缺失或异常为未知。',
    consistency: '分页遍历已核对数量、重复及账户；网站不提供原子快照，读取期间总数不变的编辑仍可能无法识别。' };
}
