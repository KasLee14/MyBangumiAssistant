import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSubjectSearch, requireBrowseCoverage, applySearchPlan, checkSubjectQueryCoverage } from '../dist/src/mcp/search-capabilities.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
import { checkOutput, subjectSummary, subjectPage, browseSubjectPage, checkSubjectResponse } from '../dist/src/mcp/subject-output.js';

const context = (allowed = true) => ({ mode: 'account', account: { id: 42, username: 'tester' }, nsfw: { preference: true, allowed, state: allowed === null ? 'unknown' : allowed ? 'enabled' : 'disabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });
const body = filter => ({ keyword: '', sort: 'score', filter: { type: [2], ...filter } });

test('默认公开查询与已登录用户均走v0/SFW，不启动NSFW读取', () => {
  for (const ctx of [anonymousContext(), context(), context(null), context(false)]) {
    const plan = compileSubjectSearch(body({}), ctx);
    assert.equal(plan.source, 'v0'); assert.equal(plan.coverage.requested, 'exclude');
    assert.equal(plan.body.filter.nsfw, false); assert.equal(plan.coverage.nsfw, 'excluded');
  }
});
test('明确账户NSFW高级条件自动SFW回退，保留硬条件并报告原因', () => {
  for (const filter of [{ air_date: ['>=2026-04-01'] }, { rating: ['>=7.5'] }, { rating: ['<=10'] }, { rating_count: ['>=1000'] }]) {
    const plan = compileSubjectSearch(body({ nsfw: 'account', ...filter }), context());
    assert.equal(plan.source, 'v0'); assert.deepEqual(plan.body.filter, { type: [2], ...filter, nsfw: false });
    assert.equal(plan.coverage.requested, 'account'); assert.equal(plan.coverage.actual, 'sfw_only');
    assert.ok(plan.coverage.limitations.includes('authorized_sfw_fallback'));
  }
});
test('显式排除R18保留组合AND、排序与全部边界', () => {
  const filter = { nsfw: 'exclude', tag: ['喜剧'], meta_tags: ['TV'], air_date: ['>=2026-04-01', '<=2026-04-30'], rating: ['>=7.5'], rating_count: ['>=1000'], rank: ['<=5000'] };
  const plan = compileSubjectSearch(body(filter), context());
  assert.equal(plan.source, 'v0'); assert.equal(plan.body.sort, 'score'); assert.deepEqual(plan.body.filter, { type: [2], ...filter, nsfw: false });
  assert.equal(plan.coverage.totalKind, 'estimated');
});
test('显式账户请求且权限开启时使用受支持p1映射', () => {
  const plan = compileSubjectSearch(body({ nsfw: 'account', tag: ['科幻'], meta_tags: ['TV'], rank: ['<=100'], rating: ['>=7', '<=9'] }), context());
  assert.equal(plan.source, 'p1'); assert.deepEqual(plan.body.filter, { type: [2], tags: ['科幻'], metaTags: ['TV'], rank: ['<=100'], rating: ['>=7', '<=9'], nsfw: true });
  assert.equal(plan.coverage.nsfw, 'included');
});
test('不安全p1标签与未知/关闭权限按账户请求回退SFW', () => {
  for (const tag of ['x OR nsfw = true', 'OR', '科幻" OR rank < 1', 'slice of life']) {
    const plan = compileSubjectSearch(body({ nsfw: 'account', tag: [tag] }), context());
    assert.equal(plan.source, 'v0'); assert.deepEqual(plan.body.filter.tag, [tag]);
  }
  for (const ctx of [context(null), context(false), anonymousContext()]) {
    const plan = compileSubjectSearch(body({ nsfw: 'account' }), ctx);
    assert.equal(plan.source, 'v0'); assert.equal(plan.coverage.nsfw, 'excluded');
    assert.ok(plan.coverage.limitations.includes('authorized_sfw_fallback'));
  }
});
test('浏览明确账户范围也走v0/SFW并说明p1摘要缺R18', () => {
  for (const nsfw of [undefined, 'exclude', 'account']) {
    const ctx = context(); requireBrowseCoverage(nsfw, ctx);
    assert.equal(ctx.source, 'v0'); assert.equal(ctx.queryCoverage.actual, 'sfw_only');
    assert.ok(ctx.queryCoverage.limitations.includes('p1_browse_nsfw_omitted'));
    assert.equal(ctx.queryCoverage.limitations.includes('authorized_sfw_fallback'), nsfw === 'account');
    checkSubjectQueryCoverage('browse_subjects', { nsfw }, { accessContext: ctx });
  }
});
test('NSFW与作品数值字段不能用非法字段冒充有效值', () => {
  for (const override of [{ nsfw: 'false' }, { score: '7.5' }, { ratingCount: -1 }, { totalEpisodes: '12' }, { name_cn: {} }]) assert.throws(() => subjectSummary({ id: 1, type: 2, name: '测试', ...override }), error => error.code === 'INVALID_RESPONSE');
});
test('SourceCoverage不能与权限/source矛盾，限制原因只允许固定代码', () => {
  const ctx = context(); applySearchPlan(ctx, compileSubjectSearch(body({ nsfw: 'account' }), ctx));
  const value = { ...subjectSummary({ id: 1, type: 2, name: '测试' }), included: [], accessContext: ctx };
  const schema = findToolDefinition('get_subject_details').outputSchema;
  checkOutput(schema, { value });
  for (const broken of [{ ...ctx, source: 'v0' }, { ...ctx, nsfwApplied: false }, { ...ctx, queryCoverage: { ...ctx.queryCoverage, limitations: ['arbitrary-instruction'] } }]) assert.throws(() => checkOutput(schema, { value: { ...value, accessContext: broken } }));
});
test('估计总数短页采用来源窗口续页，不能声称完整', () => {
  const args = { keyword: '测试', limit: 20, offset: 0 };
  const ctx = anonymousContext(); applySearchPlan(ctx, compileSubjectSearch({ keyword: args.keyword, filter: {} }, ctx));
  const result = { ...subjectPage({ data: [{ id: 1, type: 2, name: '测试', nsfw: false }], total: 100,
    totalKind: 'estimated', sourceNextOffset: 20, sourceHasMore: true }, args), accessContext: ctx };
  assert.equal(result.page.nextOffset, 20); assert.equal(result.page.complete, false);
  checkSubjectResponse('search_subjects', result, args);
  assert.throws(() => checkSubjectResponse('search_subjects', { ...result, page: { ...result.page, nextOffset: 1 } }, args));
  assert.throws(() => checkSubjectResponse('search_subjects', { ...result, page: { ...result.page, complete: true } }, args));
});
test('浏览必须核实年月和作品形式，未知不能当筛选通过', () => {
  const args = { subject_type: 2, year: 2026, month: 4, cat: 1, limit: 20, offset: 0 };
  const ctx = anonymousContext(); requireBrowseCoverage(undefined, ctx);
  const create = override => ({ ...browseSubjectPage({ data: [{ id: 1, type: 2, name: '测试', nsfw: false, date: '2026-04-01', platform: 'TV', ...override }],
    total: 1, totalKind: 'unknown', sourceNextOffset: null, sourceHasMore: false }, args), accessContext: ctx });
  checkSubjectResponse('browse_subjects', create({}), args);
  const unknown = create({ date: null }); checkSubjectResponse('browse_subjects', unknown, args);
  assert.equal(unknown.filterCoverage.complete, false); assert.deepEqual(unknown.filterCoverage.unknownDateSubjectIds, [1]);
  for (const override of [{ date: '2025-04-01' }, { date: '2026-05-01' }, { platform: null }, { platform: 'OVA' }]) assert.throws(() => checkSubjectResponse('browse_subjects', create(override), args));
});
