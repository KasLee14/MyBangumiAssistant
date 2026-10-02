import { object, positiveId, type MediaType, type Subject, type Episode, type Collection } from '../../domain/bangumi.js';
import { AppError } from '../../domain/errors.js';
import { COLLECTION_STATUSES, STATUS_IDS, collectionStatus, type CollectionEntry } from '../../domain/collection-library.js';
import { mediaType } from '../../domain/bangumi.js';

const TYPE_IDS: Record<number, MediaType> = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function subjectFrom(value: unknown): Subject {
  const item = object(value, '条目'); const id = positiveId(item.id);
  const type = TYPE_IDS[Number(item.type)];
  if (!type) throw new AppError('INVALID_RESPONSE', '条目类型不受支持。');
  const rating = item.rating && typeof item.rating === 'object' ? object(item.rating) : {};
  const rank = finite(rating.rank ?? item.rank);
  return {
    id, type, name: text(item.name, 300), nameCn: text(item.name_cn ?? item.nameCN, 300),
    summary: text(item.summary, 5000), date: text(item.date, 50),
    score: finite(rating.score ?? item.score), rank: rank !== null && rank > 0 ? rank : null,
    totalEpisodes: finite(item.total_episodes ?? item.eps), totalVolumes: finite(item.volumes), url: `https://bgm.tv/subject/${id}`,
  };
}

export function episodeFrom(value: unknown): Episode {
  const item = object(value, '章节'); const id = positiveId(item.id);
  const collection = item.collection && typeof item.collection === 'object' ? object(item.collection) : {};
  return {
    id, number: finite(item.ep ?? item.sort), type: finite(item.type),
    name: text(item.name_cn ?? item.nameCN ?? item.name, 300),
    status: finite(collection.type ?? collection.status), url: `https://bgm.tv/ep/${id}`,
  };
}

export function collectionFrom(value: unknown, subjectId: number): Collection {
  const item = object(value, '收藏');
  return {
    subjectId, status: finite(item.type), rate: finite(item.rate), comment: text(item.comment, 2000),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0,40) : [],
    private: typeof item.private === 'boolean' ? item.private : null,
    chapters: finite(item.ep_status ?? item.epStatus), volumes: finite(item.vol_status ?? item.volStatus),
  };
}

/** p1列表为带interest的作品；领域记录不附带短评或作品简介。 */
export function collectionEntryFrom(value: unknown): CollectionEntry {
  const item = object(value, '收藏列表条目'); const compact = Object.hasOwn(item, 'subjectId');
  const interest = compact ? item : object(item.interest, '个人收藏字段');
  const id = positiveId(compact ? item.subjectId : item.id);
  const type = compact ? mediaType(item.type) : TYPE_IDS[Number(item.type)];
  if (!type) throw new AppError('INVALID_RESPONSE', '收藏条目媒体类型未知。');
  const status = compact ? collectionStatus(item.status) : COLLECTION_STATUSES.find(value => STATUS_IDS[value] === interest.type);
  if (!status) throw new AppError('INVALID_RESPONSE', '收藏条目缺少有效收藏状态。');
  const rate = interest.rate;
  const counter = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const updated = compact ? item.updatedAt : interest.updatedAt ?? interest.updated_at;
  return { subjectId: id, type, status, name: text(item.name, 300), nameCn: text(compact ? item.nameCn : item.nameCN ?? item.name_cn, 300),
    rate: typeof rate === 'number' && Number.isInteger(rate) && rate >= 0 && rate <= 10 ? rate : null,
    tags: Array.isArray(interest.tags) && interest.tags.every(tag => typeof tag === 'string') ? interest.tags.slice(0, 40).map(tag => text(tag, 100)) : null,
    private: typeof interest.private === 'boolean' ? interest.private : null,
    chapters: counter(compact ? item.chapters : interest.epStatus ?? interest.ep_status), volumes: counter(compact ? item.volumes : interest.volStatus ?? interest.vol_status),
    updatedAt: typeof updated === 'string' && updated.length <= 100 ? updated : null, url: `https://bgm.tv/subject/${id}` };
}
