import { AppError } from '../support/errors.js';
import { object } from '../support/bangumi.js';
import type { JsonSchema } from '../support/tool-schema.js';
import type { SubjectSummary } from './subject-output.js';

export interface DateBounds { min?: string; max?: string }
export function fullDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:^|\s)(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})(?:日|(?=$|\s|T))/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
export function dateMatches(date: string, bounds: DateBounds): boolean {
  return (bounds.min === undefined || date >= bounds.min) && (bounds.max === undefined || date <= bounds.max);
}
export function collectionMatch(subject: SubjectSummary, status: number, rating: unknown, explicit = false) {
  if (rating !== undefined && rating !== null && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 10)) throw new AppError('INVALID_RESPONSE', '收藏评分类型或范围无效，不能转为未知。');
  return { subjectId: subject.id, subjectType: subject.subjectType, name: subject.name, nameCn: subject.nameCn,
    date: fullDate(subject.date), nsfw: subject.nsfw, platform: subject.platform, metaTags: subject.metaTags, collectionStatus: status,
    personalRating: typeof rating === 'number' && Number.isInteger(rating) && rating >= 0 && rating <= 10 ? rating : null,
    url: subject.url, matchBasis: explicit ? 'explicit_subject' : 'air_date' };
}
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export function collectionQuerySchema(input: JsonSchema): JsonSchema {
  const match = closed({ subjectId: { ...count, minimum: 1 }, subjectType: { enum: [1, 2, 3, 4, 6] },
    name: { type: 'string', minLength: 1, maxLength: 300 }, nameCn: nullable({ type: 'string', maxLength: 300 }),
    date: nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), nsfw: nullable({ type: 'boolean' }),
    platform: nullable({ type: 'string', maxLength: 100 }), metaTags: nullable({ type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } }),
    collectionStatus: { enum: [1, 2, 3, 4, 5] }, personalRating: nullable({ type: 'integer', minimum: 0, maximum: 10 }),
    url: { type: 'string', pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' }, matchBasis: { enum: ['air_date', 'explicit_subject'] },
  });
  return { type: 'object', oneOf: [closed({ value: closed({ schemaVersion: { const: 1 }, kind: { const: 'collectionQuery' },
    data: { type: 'array', maxItems: 10000, items: match }, matchedCount: count,
    scope: closed(structuredClone(input.properties as Record<string, JsonSchema>), []),
    coverage: closed({ complete: { type: 'boolean' }, source: { enum: ['p1', 'v0', 'web'] }, scannedCount: count,
      pagesRead: count, collectionTotal: count, unknownDateCount: count,
      stopReason: { enum: ['exhausted', 'date_boundary'] }, privateRecords: { enum: ['included', 'public_only'] } }),
    missingExtraSubjectIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { ...count, minimum: 1 } },
    visibility: { enum: ['self', 'public'] }, readAt: { type: 'string', maxLength: 50 },
  }) }), closed({ error: closed({ code: { type: 'string', maxLength: 80 }, message: { type: 'string', maxLength: 3000 } }) })] };
}

export interface WebCollectionPage { rows: { id: number; name: string; date: string | null }[]; total: number; page: number; pageCount: number }
/** 网页只作公开读取；结构、分页身份或日期缺失时拒绝提前终止，不能忽略异常条目。 */
export function parseWebCollectionPage(html: string, username: string, media: string, status: string, page: number): WebCollectionPage {
  const path = `/${media}/list/${username}/${status}`;
  if (/cf-chl-|challenge-platform|Just a moment/i.test(html)) throw new AppError('BGM_CHALLENGE_REQUIRED', '收藏网页要求人机验证，未绕过或自动换接口。');
  if (!html.includes(path)) throw new AppError('WEB_COLLECTION_INVALID', '收藏网页身份或结构无效。');
  const totalMatch = html.match(new RegExp(`href=["'][^"']*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?[^"']*)?["'][^>]*>[\\s\\S]*?\\((\\d+)\\)`));
  const pager = html.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
  if (!totalMatch || !pager || Number(pager[1]) !== page) throw new AppError('WEB_COLLECTION_INVALID', '收藏网页缺少总数或分页身份。');
  const rows = [...html.matchAll(/<li\b[^>]*\bid=["']item_(\d+)["'][^>]*>([\s\S]*?)<\/li>/g)].map(match => {
    const info = match[2]!.match(/<p\b[^>]*class=["']info[^"']*["'][^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    const title = match[2]!.match(/<a\b[^>]*href=["']\/subject\/\d+["'][^>]*>([\s\S]*?)<\/a>/g)?.at(-1) ?? '';
    return { id: Number(match[1]), date: fullDate(info.replace(/<[^>]*>/g, ' ')), name: title.replace(/<[^>]*>/g, '').trim() };
  });
  const total = Number(totalMatch[1]); const pageCount = Number(pager[2]);
  if (!Number.isSafeInteger(total) || total < 0 || pageCount !== Math.max(1, Math.ceil(total / 24))
    || rows.length !== Math.min(24, Math.max(0, total - (page - 1) * 24)) || new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => !Number.isSafeInteger(row.id) || row.id < 1 || !row.name || row.name.includes('&'))) throw new AppError('WEB_COLLECTION_INVALID', '收藏网页数量、名称或分页结构异常，不能认定完整。');
  return { rows, total, page, pageCount };
}

export function checkCollectionQuery(value: unknown, args: Record<string, unknown>): void {
  const result = object(value); const data = result.data as Record<string, unknown>[];
  const scope = object(result.scope); const coverage = object(result.coverage);
  if (JSON.stringify(scope) !== JSON.stringify(args) || result.matchedCount !== data.length || new Set(data.map(row => row.subjectId)).size !== data.length
    || result.visibility !== (args.username === '-' ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '收藏范围查询返回范围或数量不一致。');
  const bounds = args.air_date as DateBounds; const extras = args.extra_subject_ids as number[] ?? [];
  for (const row of data) if (row.subjectType !== args.subject_type || args.collection_type !== undefined && row.collectionStatus !== args.collection_type
    || row.url !== `https://bgm.tv/subject/${row.subjectId}` || (row.matchBasis === 'explicit_subject' ? !extras.includes(Number(row.subjectId))
      : typeof row.date !== 'string' || !dateMatches(row.date, bounds))) throw new AppError('MCP_INVALID_RESULT', '收藏范围查询包含不符合明确条件的作品。');
  if (coverage.complete !== (coverage.unknownDateCount === 0) || (coverage.scannedCount as number) < data.length
    || (coverage.scannedCount as number) > (coverage.collectionTotal as number)
    || args.username === '-' && coverage.privateRecords !== 'included') throw new AppError('MCP_INVALID_RESULT', '收藏范围查询覆盖声明不一致。');
  const direction = args.sort === 'date_asc' ? 1 : -1;
  for (let index = 1; index < data.length; index++) { const a = data[index - 1]!, b = data[index]!;
    if (direction * String(a.date ?? '').localeCompare(String(b.date ?? '')) > 0 || a.date === b.date && Number(a.subjectId) > Number(b.subjectId)) throw new AppError('MCP_INVALID_RESULT', '收藏范围查询排序不符合请求或同日顺序不稳定。'); }
}
