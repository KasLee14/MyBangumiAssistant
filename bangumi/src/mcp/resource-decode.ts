import { AppError } from '../support/errors.js';
import { record, type Data } from './resource-output.js';

function self(raw: Data, expected?: number): void {
  if (raw.schemaVersion !== 1 || raw.visibility !== 'self' || !raw.account) throw new AppError('INVALID_RESPONSE', '完整现状必须来自本应用本人读取。');
  if (expected !== undefined && record(raw.account).id !== expected) throw new AppError('ACCOUNT_CHANGED', '现状账户与原操作账户不一致。');
}
/** 只提取稳定业务字段，读取时间/scope/展示字段不参与基线比较。 */
export function collectionRecord(value: unknown, id: number, expected?: number): Data | null {
  if (value === null) return null;
  const raw = record(value); if (raw.schemaVersion === undefined) return raw;
  self(raw, expected);
  if (raw.kind !== 'collectionState' || record(raw.target).kind !== 'subject' || record(raw.target).id !== id) throw new AppError('INVALID_RESPONSE', '作品现状对象不一致。');
  if (raw.state === 'not_collected' && raw.collection === null) return null;
  if (raw.state !== 'collected' || raw.collection === null) throw new AppError('INCOMPLETE_COLLECTION', '个人收藏现状不能用于完整核对。');
  const c = record(raw.collection);
  return { subject_id: c.subjectId, type: c.collectionStatus, rate: c.personalRating, tags: c.personalTags, comment: c.comment, private: c.private, ep_status: c.chapters, vol_status: c.volumes };
}
export function entityCollected(value: unknown, kind: string, id: number, expected: number): boolean {
  if (value === null) return false; const raw = record(value);
  if (raw.schemaVersion === undefined) { if (raw.id !== id) throw new AppError('INVALID_RESPONSE', '收藏实体ID不一致。'); return true; }
  self(raw, expected);
  if (raw.kind !== 'collectionState' || record(raw.target).kind !== kind || record(raw.target).id !== id) throw new AppError('INVALID_RESPONSE', '收藏实体类型或ID不一致。');
  if (raw.state === 'not_collected' && raw.collection === null) return false;
  if (raw.state !== 'collected' || raw.collection === null || record(record(raw.collection).target).id !== id) throw new AppError('INVALID_RESPONSE', '完整实体收藏状态不可用。');
  return true;
}
export function indexRecord(value: unknown, expected?: number): Data {
  const raw = record(value); if (raw.schemaVersion === undefined) return raw;
  self(raw, expected); if (raw.kind !== 'indexState' || raw.complete !== true) throw new AppError('INCOMPLETE_RESPONSE', '目录不是完整本人现状。');
  return { id: raw.id, ownerId: raw.ownerId, title: raw.title, description: raw.description, private: raw.private, collected: raw.collected };
}
export function episodeData(value: unknown): Data {
  const raw = record(value);
  if (raw.entity !== 'episode' || raw.schemaVersion !== 1) return raw;
  return { id: raw.id, subject_id: raw.subjectId, type: raw.episodeType, name: raw.name, name_cn: raw.nameCn, sort: raw.sort, ep: raw.mainSequence, airdate: raw.airDate, duration: raw.duration };
}
export function episodeStateData(value: unknown, expected?: number): Data {
  const raw = record(value);
  if (raw.kind !== 'episodeState') return raw;
  self(raw, expected); const data = record(raw.data);
  return { ...episodeData(data.episode), collection: { type: data.episodeStatus } };
}
export function pageRecord(value: unknown, expected?: number): Data {
  const raw = record(value); if (raw.schemaVersion === undefined) return raw;
  if (expected !== undefined) self(raw, expected);
  const meta = record(raw.page);
  return { ...meta, data: raw.data, ...(raw.account ? { account: raw.account } : {}) };
}
export function submissionId(value: unknown): unknown {
  const raw = record(value); return raw.kind === 'submission' ? raw.createdId : raw.id;
}
