import { AppError } from '../support/errors.js';
import type { AccessContext } from './access-context.js';
import { isDeepStrictEqual } from 'node:util';

export type NsfwQueryMode = 'account' | 'exclude';
export interface QueryCoverage {
  requested: NsfwQueryMode;
  actual: 'account_visible' | 'sfw_only' | 'public_visible';
  nsfw: 'included' | 'excluded' | 'unknown';
  totalKind: 'estimated' | 'exact' | 'unknown';
  limitations: string[];
}
export interface SubjectSearchPlan { source: 'p1' | 'v0'; body: Record<string, unknown>; coverage: QueryCoverage }
export const SEARCH_LIMITATIONS = ['p1_date_type_mismatch', 'p1_decimal_rating', 'p1_rating_count_missing',
  'p1_tag_literal_unsafe', 'p1_browse_nsfw_omitted', 'v0_anonymous_source', 'estimated_search_total',
  'public_revision_source', 'nsfw_permission_unknown', 'authorized_sfw_fallback'] as const;

export function queryMode(value: unknown, context: AccessContext): { requested: NsfwQueryMode; includeNsfw: boolean } {
  const requested = value === undefined ? 'exclude' : value;
  if (requested !== 'account' && requested !== 'exclude') throw new AppError('INVALID_INPUT', 'NSFW范围仅允许account或exclude。');
  if (requested === 'exclude') return { requested, includeNsfw: false };
  return { requested, includeNsfw: context.mode === 'account' && context.account !== null && context.nsfw.allowed === true && context.nsfw.preference !== false };
}
/** 标签是字面值，不允许利用上游未引用的字符串拼接注入过滤表达式。 */
export function p1SafeTag(value: string): boolean {
  return !/[\s"'\\[\](){}<>=]/.test(value) && !/^(?:AND|OR|NOT)$/i.test(value);
}
/** 输入边界形式和编译后的条件数组使用同一能力判断。 */
export function subjectSearchLimitations(filter: Record<string, unknown>): string[] {
  const limitations: string[] = [];
  if (filter.air_date !== undefined) limitations.push('p1_date_type_mismatch');
  if (filter.rating_count !== undefined) limitations.push('p1_rating_count_missing');
  if (filter.rating !== undefined) {
    const rating = filter.rating as { min?: number; max?: number } | string[];
    const conditions = Array.isArray(rating) ? rating : [rating.min === undefined ? undefined : `>=${rating.min}`, rating.max === undefined ? undefined : `<=${rating.max}`].filter((value): value is string => value !== undefined);
    if (conditions.some(condition => !/^(?:>=|<=)[0-9]$/.test(condition))) limitations.push('p1_decimal_rating');
  }
  for (const field of ['tag', 'meta_tags']) if (filter[field] !== undefined && (filter[field] as string[]).some(tag => !p1SafeTag(tag))) limitations.push('p1_tag_literal_unsafe');
  return limitations;
}
export function compileSubjectSearch(body: Record<string, unknown>, context: AccessContext): SubjectSearchPlan {
  const filter = body.filter === undefined ? {} : body.filter as Record<string, unknown>;
  const policy = queryMode(filter.nsfw, context), limitations = subjectSearchLimitations(filter);
  const source = policy.includeNsfw && limitations.length === 0 ? 'p1' : 'v0';
  const included = source === 'p1';
  if (policy.requested === 'account' && !included) limitations.push('authorized_sfw_fallback');
  if (policy.requested === 'account' && context.nsfw.allowed === null) limitations.push('nsfw_permission_unknown');
  const targetFilter = source === 'p1' ? { type: filter.type, tags: filter.tag, metaTags: filter.meta_tags, rank: filter.rank,
    rating: filter.rating, nsfw: policy.includeNsfw ? true : false }
    : { ...filter, nsfw: false };
  const { nsfw: _mode, ...publicFilter } = filter;
  const compiled = source === 'v0' ? { ...publicFilter, nsfw: false } : targetFilter;
  return { source, body: { ...body, filter: Object.fromEntries(Object.entries(compiled).filter(([, value]) => value !== undefined)) },
    coverage: { requested: policy.requested, actual: included ? 'account_visible' : 'sfw_only',
      nsfw: included ? 'included' : 'excluded', totalKind: 'estimated',
      limitations: [...new Set([...limitations, ...(source === 'v0' ? ['v0_anonymous_source'] : []), 'estimated_search_total'])] } };
}
export function applySearchPlan(context: AccessContext, plan: SubjectSearchPlan): void {
  context.source = plan.source; context.nsfwApplied = plan.source === 'p1'; context.queryCoverage = plan.coverage;
}
export function requireBrowseCoverage(value: unknown, context: AccessContext, _publicSource = true): void {
  const policy = queryMode(value, context);
  context.source = 'v0';
  context.queryCoverage = { requested: policy.requested, actual: 'sfw_only', nsfw: 'excluded', totalKind: 'unknown', limitations: ['p1_browse_nsfw_omitted', 'v0_anonymous_source', ...(policy.requested === 'account' ? ['authorized_sfw_fallback'] : []), ...(policy.requested === 'account' && context.nsfw.allowed === null ? ['nsfw_permission_unknown'] : [])] };
  context.nsfwApplied = false;
}
/** 双端依据本次固定条件重新核对来源与覆盖，远端不能删去限制或将估计总数改称精确。 */
export function checkSubjectQueryCoverage(name: string, args: Record<string, unknown>, value: Record<string, unknown>): void {
  if (name !== 'search_subjects' && name !== 'browse_subjects') return;
  const context = value.accessContext as AccessContext | undefined;
  if (!context?.queryCoverage) throw new AppError('MCP_INVALID_RESULT', '全站查询缺少可见范围和总数性质。');
  const expected = structuredClone(context);
  try {
    if (name === 'browse_subjects') {
      requireBrowseCoverage(args.nsfw, expected);
    } else {
      const input = (args.filter ?? {}) as Record<string, unknown>;
      const filter: Record<string, unknown> = { type: args.subject_type === undefined ? undefined : [args.subject_type], tag: input.tag, meta_tags: input.meta_tags, nsfw: input.nsfw };
      for (const field of ['rating', 'rating_count', 'rank', 'air_date']) {
        if (input[field] === undefined) continue;
        const bounds = input[field] as { min?: unknown; max?: unknown };
        filter[field] = [bounds.min === undefined ? undefined : `>=${bounds.min}`, bounds.max === undefined ? undefined : `<=${bounds.max}`].filter(value => value !== undefined);
      }
      applySearchPlan(expected, compileSubjectSearch({ keyword: args.keyword, sort: args.sort, filter }, expected));
    }
  } catch { throw new AppError('MCP_INVALID_RESULT', '全站查询声称成功，但此账户范围与条件不能可靠执行。'); }
  if (context.source !== expected.source || context.nsfwApplied !== expected.nsfwApplied || !isDeepStrictEqual(context.queryCoverage, expected.queryCoverage)) {
    throw new AppError('MCP_INVALID_RESULT', '全站查询来源或覆盖事实与本次请求不一致。');
  }
}
