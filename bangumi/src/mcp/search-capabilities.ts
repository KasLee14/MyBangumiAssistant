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
  'public_revision_source', 'nsfw_permission_unknown'] as const;

export function queryMode(value: unknown, context: AccessContext): { requested: NsfwQueryMode; includeNsfw: boolean } {
  const requested = value === undefined ? 'account' : value;
  if (requested !== 'account' && requested !== 'exclude') throw new AppError('INVALID_INPUT', 'NSFW范围仅允许account或exclude。');
  if (requested === 'exclude') return { requested, includeNsfw: false };
  if (context.mode === 'account' && context.nsfw.allowed === null) {
    throw new AppError('NSFW_PERMISSION_UNKNOWN', '未核实账户NSFW权限，不能声称完整账户查询；请核实权限或明确限定非R18范围。');
  }
  return { requested, includeNsfw: context.account !== null && context.nsfw.allowed === true };
}
/** 标签是字面值，不允许利用上游未引用的字符串拼接注入过滤表达式。 */
export function p1SafeTag(value: string): boolean {
  return !/[\s"'\\[\](){}<>=]/.test(value) && !/^(?:AND|OR|NOT)$/i.test(value);
}
export function compileSubjectSearch(body: Record<string, unknown>, context: AccessContext): SubjectSearchPlan {
  const filter = body.filter === undefined ? {} : body.filter as Record<string, unknown>;
  const policy = queryMode(filter.nsfw, context); const limitations: string[] = [];
  if (filter.air_date !== undefined) limitations.push('p1_date_type_mismatch');
  if (filter.rating_count !== undefined) limitations.push('p1_rating_count_missing');
  if (filter.rating !== undefined && (filter.rating as string[]).some(condition => !/^(?:>=|<=)[0-9]$/.test(condition))) limitations.push('p1_decimal_rating');
  for (const field of ['tag', 'meta_tags']) if (filter[field] !== undefined && (filter[field] as string[]).some(tag => !p1SafeTag(tag))) limitations.push('p1_tag_literal_unsafe');
  if (policy.includeNsfw && limitations.length) {
    context.source = 'p1'; context.nsfwApplied = false;
    context.queryCoverage = { requested: policy.requested, actual: 'account_visible', nsfw: 'unknown', totalKind: 'unknown', limitations };
    throw new AppError('SEARCH_CAPABILITY_UNSUPPORTED', `当前账户全站搜索不能可靠执行这些条件：${limitations.join('、')}。未改用匿名结果或忽略条件；NSFW完整范围依赖上游修复。`);
  }
  const source = context.account !== null && limitations.length === 0 ? 'p1' : 'v0';
  const targetFilter = source === 'p1' ? { type: filter.type, tags: filter.tag, metaTags: filter.meta_tags, rank: filter.rank,
    rating: filter.rating, nsfw: policy.includeNsfw ? true : false }
    : { ...filter, nsfw: false };
  const { nsfw: _mode, ...publicFilter } = filter;
  const compiled = source === 'v0' ? { ...publicFilter, nsfw: false } : targetFilter;
  return { source, body: { ...body, filter: Object.fromEntries(Object.entries(compiled).filter(([, value]) => value !== undefined)) },
    coverage: { requested: policy.requested, actual: policy.includeNsfw ? 'account_visible' : 'sfw_only',
      nsfw: policy.includeNsfw ? 'included' : 'excluded', totalKind: 'estimated',
      limitations: [...new Set([...limitations, ...(source === 'v0' ? ['v0_anonymous_source'] : []), 'estimated_search_total'])] } };
}
export function applySearchPlan(context: AccessContext, plan: SubjectSearchPlan): void {
  context.source = plan.source; context.nsfwApplied = plan.source === 'p1'; context.queryCoverage = plan.coverage;
}
export function requireBrowseCoverage(value: unknown, context: AccessContext, publicSource = false): void {
  const policy = queryMode(value, context);
  context.queryCoverage = { requested: policy.requested, actual: 'sfw_only', nsfw: 'excluded', totalKind: 'unknown', limitations: ['p1_browse_nsfw_omitted', ...(publicSource ? ['v0_anonymous_source'] : [])] };
  context.nsfwApplied = false;
  if (policy.includeNsfw) throw new AppError('SEARCH_CAPABILITY_UNSUPPORTED', '上游全站浏览摘要未完整应用NSFW权限，不能返回完整账户范围；未把缺项结果当作完整列表。可明确限定非R18范围，或查询本人收藏范围。');
}
/** 双端依据本次固定条件重新核对来源与覆盖，远端不能删去限制或将估计总数改称精确。 */
export function checkSubjectQueryCoverage(name: string, args: Record<string, unknown>, value: Record<string, unknown>): void {
  if (name !== 'search_subjects' && name !== 'browse_subjects') return;
  const context = value.accessContext as AccessContext | undefined;
  if (!context?.queryCoverage) throw new AppError('MCP_INVALID_RESULT', '全站查询缺少可见范围和总数性质。');
  const expected = structuredClone(context);
  try {
    if (name === 'browse_subjects') {
      const publicSource = !expected.account || args.platform !== undefined;
      requireBrowseCoverage(args.nsfw, expected, publicSource);
      expected.source = publicSource ? 'v0' : 'p1';
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
