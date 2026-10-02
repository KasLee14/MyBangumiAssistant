import { AppError } from './errors.js';

export const MEDIA_TYPES = ['book', 'anime', 'music', 'game', 'real'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_LABELS: Record<MediaType, string> = {
  book: '书籍', anime: '动画', music: '音乐', game: '游戏', real: '三次元',
};

export function object(value: unknown, label = '响应'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', `${label}应为对象。`);
  return value as Record<string, unknown>;
}

export function mediaType(value: unknown): MediaType {
  if (typeof value !== 'string' || !MEDIA_TYPES.includes(value as MediaType)) {
    throw new AppError('INVALID_INPUT', `类型必须为 ${MEDIA_TYPES.join('、')}。`);
  }
  return value as MediaType;
}

export function positiveId(value: unknown): number {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('INVALID_INPUT', '条目 ID 必须为正整数。');
  return id;
}

export function pageLimit(value: unknown = 5): number {
  const limit = positiveId(value);
  if (limit > 20) throw new AppError('INVALID_INPUT', '每次查询数量必须为 1～20。');
  return limit;
}

export function pageOffset(value: unknown = 0): number {
  const offset = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError('INVALID_INPUT', '分页偏移必须为非负整数。');
  return offset;
}

export function keyword(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('-') || /[\u0000-\u001f\u007f]/.test(value) || value.length > 200) {
    throw new AppError('INVALID_INPUT', '关键词须为 1～200 字的普通文本，不能以减号开头或包含控制字符。');
  }
  return value.trim();
}

export interface Subject {
  id: number;
  name: string;
  nameCn: string;
  type: MediaType;
  summary: string;
  date: string;
  score: number | null;
  ratingCount?: number | null;
  rank: number | null;
  totalEpisodes: number | null;
  totalVolumes?: number | null;
  url: string;
}

export interface Episode {
  id: number;
  number: number | null;
  type: number | null;
  name: string;
  status: number | null;
  url: string;
}

export interface EpisodePage {
  data: Episode[];
  total: number | null;
  offset: number;
  limit: number;
  nextOffset: number | null;
  /** 仅从零开始且覆盖全部章节时为 true；读完尾页不代表持有完整清单。 */
  complete: boolean;
}

export interface CompleteEpisodes {
  data: Episode[];
  total: number;
  complete: true;
}

export interface Collection {
  subjectId: number;
  status: number | null;
  rate: number | null;
  comment: string;
  tags: string[];
  private: boolean | null;
  chapters: number | null;
  volumes: number | null;
}

/** 条目收藏状态与章节状态是两套枚举，给模型明确语义以免混淆。 */
export function collectionMeaning(collection: Collection) {
  const meanings: Record<number, string> = { 1: '计划（想看/想读/想听/想玩）', 2: '已完成（看过/读过/听过/玩过）',
    3: '进行中（在看/在读/在听/在玩）', 4: '搁置', 5: '抛弃' };
  return { ...collection, statusMeaning: collection.status === null ? '未知' : meanings[collection.status] ?? '未知' };
}

export function progressCapability(type: MediaType): { supported: boolean; units: string[]; reason: string } {
  if (type === 'book') return { supported: true, units: ['chapter', 'volume'], reason: '书籍使用章数与卷数。' };
  if (type === 'anime' || type === 'real') return { supported: true, units: ['episode'], reason: '使用网站的主线或明确指定的特殊章节。' };
  return { supported: false, units: [], reason: '当前 Bangumi p1 服务端拒绝此类型的细粒度进度写入；可管理条目收藏状态。' };
}
