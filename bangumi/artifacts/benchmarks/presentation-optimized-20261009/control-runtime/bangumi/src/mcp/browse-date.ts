import { isDeepStrictEqual } from 'node:util';
import { AppError, ContractError } from '../support/errors.js';
import { normalizeInfobox } from './infobox-output.js';
import type { JsonSchema } from '../support/tool-schema.js';

const dateFields: Record<number, readonly string[]> = {
  1: ['发售日', '发行日期', '出版日期'],
  2: ['放送开始', '上映年度', '上映日期', '发售日'],
  3: ['发售日', '发行日期'],
  4: ['发行日期', '发售日'],
  6: ['放送开始', '上映年度', '上映日期', '开始'],
};
export interface BrowseDateEvidence {
  year: number; month: number | null; day: number | null; precision: 'year' | 'month' | 'day';
  source: 'date' | 'infobox'; sourceField: string; sourceValue: string;
}
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
export const browseDateEvidenceSchema: JsonSchema = nullable({ type: 'object', additionalProperties: false,
  properties: {
    year: { type: 'integer', minimum: 1, maximum: 9999 }, month: nullable({ type: 'integer', minimum: 1, maximum: 12 }),
    day: nullable({ type: 'integer', minimum: 1, maximum: 31 }), precision: { enum: ['year', 'month', 'day'] },
    source: { enum: ['date', 'infobox'] }, sourceField: { type: 'string', enum: ['date', ...new Set(Object.values(dateFields).flat())] },
    sourceValue: { type: 'string', minLength: 1, maxLength: 50, description: '可重新解析的日期原文；不补造月或日。' },
  }, required: ['year', 'month', 'day', 'precision', 'source', 'sourceField', 'sourceValue'],
});

/** 仅接受单一明确日期；范围、季度及自由文本不能猜成日期。 */
function parseDate(value: string): Pick<BrowseDateEvidence, 'year' | 'month' | 'day' | 'precision'> | null {
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value)
    ?? /^(\d{4})年(?:(\d{1,2})月(?:(\d{1,2})日)?)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = match[2] === undefined ? null : Number(match[2]), day = match[3] === undefined ? null : Number(match[3]);
  if (year < 1 || month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === null || day < 1 || day > days[month - 1]!) return null;
  }
  return { year, month, day, precision: day !== null ? 'day' : month !== null ? 'month' : 'year' };
}
export function resolveBrowseDate(raw: Record<string, unknown>): BrowseDateEvidence | null {
  if (raw.date != null) {
    if (typeof raw.date !== 'string') throw new AppError('INVALID_RESPONSE', '作品日期字段必须是字符串或空值。');
    const parsed = parseDate(raw.date);
    if (!parsed) throw new AppError('INVALID_RESPONSE', '作品日期字段不是有效的明确日期。');
    return { ...parsed, source: 'date', sourceField: 'date', sourceValue: raw.date };
  }
  if (raw.infobox == null) return null;
  if (!Array.isArray(raw.infobox)) throw new AppError('INVALID_RESPONSE', '浏览作品信息栏必须是数组或空值。');
  const fields = dateFields[Number(raw.type ?? raw.subjectType)] ?? [];
  const selected = raw.infobox.filter(item => item && typeof item === 'object' && fields.includes(item.key));
  const candidates: BrowseDateEvidence[] = [];
  for (const item of normalizeInfobox(selected) ?? []) {
    const values = typeof item.value === 'string' ? [item.value] : item.value.map(pair => pair.v);
    for (const value of values) {
      const sourceValue = value.trim(), parsed = parseDate(sourceValue);
      // 存在不能解释或过长的日期说明时，不只采纳其中有利的一部分。
      if (!parsed || sourceValue.length > 50) return null;
      candidates.push({ ...parsed, source: 'infobox', sourceField: item.key, sourceValue });
    }
  }
  if (!candidates.length) return null;
  const strongest = [...candidates].sort((a, b) => Number(b.day !== null) + Number(b.month !== null) - Number(a.day !== null) - Number(a.month !== null))[0]!;
  if (candidates.some(item => item.year !== strongest.year || item.month !== null && item.month !== strongest.month
    || item.day !== null && item.day !== strongest.day)) return null;
  return strongest;
}
export function matchesBrowseDate(evidence: BrowseDateEvidence | null, args: Record<string, unknown>): 'match' | 'unknown' | 'mismatch' {
  if (args.year === undefined && args.month === undefined) return 'match';
  if (!evidence) return 'unknown';
  if (args.year !== undefined && evidence.year !== args.year || args.month !== undefined && evidence.month !== null && evidence.month !== args.month) return 'mismatch';
  return args.month !== undefined && evidence.month === null ? 'unknown' : 'match';
}
/** 双端重解析证据；不接受伪造精度、错误媒体字段或改写作品已有日期。 */
export function checkBrowseDateEvidence(subject: Record<string, unknown>): void {
  const evidence = subject.dateEvidence as BrowseDateEvidence | null;
  const invalid = (): never => { throw new ContractError('browse_date_evidence_invalid', '/data/dateEvidence', Number(subject.id)); };
  if (evidence === null) { if (subject.date !== null) invalid(); return; }
  if (!evidence || typeof evidence.sourceValue !== 'string') invalid();
  const parsed = parseDate(evidence.sourceValue);
  if (!parsed || !isDeepStrictEqual(parsed, { year: evidence.year, month: evidence.month, day: evidence.day, precision: evidence.precision })) invalid();
  if (evidence.source === 'date') {
    if (evidence.sourceField !== 'date' || evidence.sourceValue !== subject.date) invalid();
  } else if (evidence.source !== 'infobox' || subject.date !== null || !(dateFields[Number(subject.subjectType)] ?? []).includes(evidence.sourceField)) invalid();
}
