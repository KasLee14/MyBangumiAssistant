import { AppError } from '../support/errors.js';
import { positive, record, type Data } from './resource-output.js';

function self(raw: Data, expected?: number): void {
  if (raw.schemaVersion !== 1 || raw.visibility !== 'self' || !raw.account) throw new AppError('INVALID_RESPONSE', '完整现状必须来自本应用本人读取。');
  const account = record(raw.account);
  positive(account.id);
  if (typeof account.username !== 'string' || !account.username.trim()) throw new AppError('INVALID_RESPONSE', '完整现状缺少有效本人账户身份。');
  if (expected !== undefined && account.id !== expected) throw new AppError('ACCOUNT_CHANGED', '现状账户与原操作账户不一致。');
}
const count = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** 只提取稳定业务字段，读取时间/scope/展示字段不参与基线比较。 */
export function collectionRecord(value: unknown, id: number, expected?: number): Data | null {
  if (value === null) return null;
  const raw = record(value); if (raw.schemaVersion === undefined) { if (raw.subject_id !== id) throw new AppError('INVALID_RESPONSE', '作品现状对象不一致。'); return raw; }
  self(raw, expected);
  if (raw.kind !== 'collectionState' || record(raw.target).kind !== 'subject' || record(raw.target).id !== id) throw new AppError('INVALID_RESPONSE', '作品现状对象不一致。');
  if (raw.state === 'not_collected' && raw.collection === null) return null;
  if (raw.state !== 'collected' || raw.collection === null) throw new AppError('INCOMPLETE_COLLECTION', '个人收藏现状不能用于完整核对。');
  const c = record(raw.collection);
  if (c.subjectId !== id || c.complete !== true || typeof c.collectionStatus !== 'number' || ![1, 2, 3, 4, 5].includes(c.collectionStatus)
    || !count(c.personalRating) || Number(c.personalRating) > 10 || !Array.isArray(c.personalTags) || c.personalTags.some(value => typeof value !== 'string')
    || typeof c.comment !== 'string' || typeof c.private !== 'boolean' || !count(c.chapters) || !count(c.volumes)) throw new AppError('INCOMPLETE_COLLECTION', '个人收藏现状字段不完整或与目标不一致。');
  return { subject_id: c.subjectId, type: c.collectionStatus, rate: c.personalRating, tags: c.personalTags, comment: c.comment, private: c.private, ep_status: c.chapters, vol_status: c.volumes };
}
export function entityCollected(value: unknown, kind: string, id: number, expected: number): boolean {
  if (value === null) return false; const raw = record(value);
  if (raw.schemaVersion === undefined) { if (raw.id !== id) throw new AppError('INVALID_RESPONSE', '收藏实体ID不一致。'); return true; }
  self(raw, expected);
  if (raw.kind !== 'collectionState' || record(raw.target).kind !== kind || record(raw.target).id !== id) throw new AppError('INVALID_RESPONSE', '收藏实体类型或ID不一致。');
  if (raw.state === 'not_collected' && raw.collection === null) return false;
  if (raw.state !== 'collected' || raw.collection === null || record(raw.collection).collected !== true
    || record(record(raw.collection).target).id !== id || record(record(raw.collection).target).entity !== kind) throw new AppError('INVALID_RESPONSE', '完整实体收藏状态不可用。');
  return true;
}
export function indexRecord(value: unknown, expected?: number): Data {
  const raw = record(value); if (raw.schemaVersion === undefined) return raw;
  self(raw, expected); if (raw.kind !== 'indexState' || raw.complete !== true || !count(raw.id) || Number(raw.id) < 1 || !count(raw.ownerId) || Number(raw.ownerId) < 1
    || typeof raw.title !== 'string' || typeof raw.description !== 'string' || typeof raw.private !== 'boolean' || typeof raw.collected !== 'boolean') throw new AppError('INCOMPLETE_RESPONSE', '目录不是完整本人现状。');
  return { id: raw.id, ownerId: raw.ownerId, title: raw.title, description: raw.description, private: raw.private, collected: raw.collected };
}
export function episodeData(value: unknown): Data {
  const raw = record(value);
  if (raw.schemaVersion === undefined) return raw;
  if (raw.entity !== 'episode' || raw.schemaVersion !== 1 || !count(raw.id) || Number(raw.id) < 1 || !count(raw.subjectId) || Number(raw.subjectId) < 1
    || typeof raw.episodeType !== 'number' || ![0, 1, 2, 3, 4, 5, 6].includes(raw.episodeType)) throw new AppError('INVALID_RESPONSE', '章节资料不是有效的固定DTO。');
  return { id: raw.id, subject_id: raw.subjectId, type: raw.episodeType, name: raw.name, name_cn: raw.nameCn, sort: raw.sort, ep: raw.mainSequence, airdate: raw.airDate, duration: raw.duration };
}
export function episodeStateData(value: unknown, expected?: number): Data {
  const raw = record(value);
  if (raw.schemaVersion === undefined) return raw;
  if (raw.kind !== 'episodeState' || raw.complete !== true) throw new AppError('INCOMPLETE_COLLECTION', '个人章节不是完整本人现状。');
  self(raw, expected); const data = record(raw.data);
  if (typeof data.episodeStatus !== 'number' || ![0, 1, 2, 3].includes(data.episodeStatus)) throw new AppError('INVALID_RESPONSE', '个人章节状态无效。');
  return { ...episodeData(data.episode), collection: { type: data.episodeStatus } };
}
export function pageRecord(value: unknown, expected?: number): Data {
  const raw = record(value); if (raw.schemaVersion === undefined) return raw;
  if (expected !== undefined) self(raw, expected);
  if (raw.schemaVersion !== 1 || raw.kind !== 'page' || !Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '现状分页不是有效的固定DTO。');
  const meta = record(raw.page);
  if (!count(meta.total) || !count(meta.limit) || Number(meta.limit) < 1 || !count(meta.offset) || meta.returnedCount !== raw.data.length
    || raw.data.length !== Math.min(Number(meta.limit), Math.max(0, Number(meta.total) - Number(meta.offset)))) throw new AppError('INCOMPLETE_DATA', '现状分页总数或记录不完整。');
  return { ...meta, data: raw.data, ...(raw.account ? { account: raw.account } : {}) };
}
export function submissionId(value: unknown): unknown {
  const raw = record(value); return raw.kind === 'submission' ? raw.createdId : raw.id;
}
