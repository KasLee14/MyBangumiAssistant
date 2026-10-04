import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSubjectSearch, requireBrowseCoverage, applySearchPlan } from '../dist/src/mcp/search-capabilities.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
import { checkOutput, subjectSummary } from '../dist/src/mcp/subject-output.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';

const context = (allowed = true) => ({ mode: 'account', account: { id: 42, username: 'tester' }, nsfw: { preference: true, allowed, state: allowed === null ? 'unknown' : allowed ? 'enabled' : 'disabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });
const body = filter => ({ keyword: '', sort: 'score', filter: { type: [2], ...filter } });
test('完整NSFW高级条件明确unsupported，不能忽略条件或静默匿名降级', () => {
  for (const filter of [{ air_date: ['>=2026-04-01'] }, { rating: ['>=7.5'] }, { rating: ['<=10'] }, { rating_count: ['>=1000'] }]) {
    const ctx = context(); assert.throws(() => compileSubjectSearch(body(filter), ctx), error => error.code === 'SEARCH_CAPABILITY_UNSUPPORTED');
    assert.equal(ctx.nsfwApplied, false); assert.equal(ctx.queryCoverage.nsfw, 'unknown'); assert.ok(ctx.queryCoverage.limitations.length);
  }
});
test('显式排除R18保留组合AND、排序和全部边界，使用可执行的公开源', () => {
  const filter = { nsfw: 'exclude', tag: ['喜剧'], meta_tags: ['TV'], air_date: ['>=2026-04-01', '<=2026-04-30'], rating: ['>=7.5'], rating_count: ['>=1000'], rank: ['<=5000'] };
  const plan = compileSubjectSearch(body(filter), context());
  assert.equal(plan.source, 'v0'); assert.equal(plan.body.sort, 'score'); assert.deepEqual(plan.body.filter, { type: [2], ...filter, nsfw: false });
  assert.equal(plan.coverage.actual, 'sfw_only'); assert.equal(plan.coverage.nsfw, 'excluded'); assert.equal(plan.coverage.totalKind, 'estimated');
});
test('整数评分、标签与排名走账户映射，小数筛选不影响评分排序能力', () => {
  const plan = compileSubjectSearch(body({ tag: ['科幻'], meta_tags: ['TV'], rank: ['<=100'], rating: ['>=7', '<=9'] }), context());
  assert.equal(plan.source, 'p1'); assert.deepEqual(plan.body.filter, { type: [2], tags: ['科幻'], metaTags: ['TV'], rank: ['<=100'], rating: ['>=7', '<=9'], nsfw: true });
  assert.equal(plan.body.sort, 'score'); assert.equal(plan.coverage.nsfw, 'included');
});
test('未引用的p1标签不能成为任意过滤表达式；未知权限不能当关闭', () => {
  for (const tag of ['x OR nsfw = true', 'OR', '科幻" OR rank < 1', 'slice of life']) assert.throws(() => compileSubjectSearch(body({ tag: [tag] }), context()), error => error.code === 'SEARCH_CAPABILITY_UNSUPPORTED');
  assert.throws(() => compileSubjectSearch(body({}), context(null)), error => error.code === 'NSFW_PERMISSION_UNKNOWN');
  assert.equal(compileSubjectSearch(body({ nsfw: 'exclude' }), context(null)).coverage.nsfw, 'excluded');
});
test('未登录与已关闭权限的默认查询均为SFW，未伪造账户权限', () => {
  const anon = compileSubjectSearch(body({ air_date: ['>=2026-04-01'] }), anonymousContext());
  assert.equal(anon.source, 'v0'); assert.equal(anon.coverage.nsfw, 'excluded');
  const off = compileSubjectSearch(body({ rating: ['>=7.5'] }), context(false)); assert.equal(off.source, 'v0');
});
test('p1浏览NSFW缺页不能包装成完整账户列表，明确SFW范围才允许读取', () => {
  assert.throws(() => requireBrowseCoverage(undefined, context()), error => error.code === 'SEARCH_CAPABILITY_UNSUPPORTED');
  const ctx = context(); requireBrowseCoverage('exclude', ctx); assert.equal(ctx.queryCoverage.actual, 'sfw_only');
});
test('unsupported服务路径不请求v0、不把零项成功当全站无匹配', async () => {
  let calls = 0;
  const service = new BangumiMcpService({ preflight: async () => context(), currentUser: async () => ({ id: 42, username: 'tester' }), close: async () => {},
    account: async () => { calls++; throw Error('不能发请求'); }, public: async () => { calls++; throw Error('不能降级'); } });
  await assert.rejects(service.call('search_subjects', { keyword: '', subject_type: 2, filter: { air_date: { min: '2026-04-01' } } }), error => error.code === 'SEARCH_CAPABILITY_UNSUPPORTED' && error.accessContext.queryCoverage.nsfw === 'unknown');
  assert.equal(calls, 0);
});
test('NSFW关闭不能通过缺失或非法作品字段冒充有效结果', () => {
  for (const override of [{ nsfw: 'false' }, { score: '7.5' }, { ratingCount: -1 }, { totalEpisodes: '12' }, { name_cn: {} }]) assert.throws(() => subjectSummary({ id: 1, type: 2, name: '测试', ...override }), error => error.code === 'INVALID_RESPONSE');
});
test('SourceCoverage不能与权限/source相矛盾，限制原因只允许固定代码', () => {
  const ctx = context(); applySearchPlan(ctx, compileSubjectSearch(body({}), ctx));
  const value = { ...subjectSummary({ id: 1, type: 2, name: '测试' }), included: [], accessContext: ctx };
  const schema = findToolDefinition('get_subject_details').outputSchema;
  checkOutput(schema, { value });
  for (const broken of [{ ...ctx, source: 'v0' }, { ...ctx, nsfwApplied: false }, { ...ctx, queryCoverage: { ...ctx.queryCoverage, limitations: ['arbitrary-instruction'] } }]) assert.throws(() => checkOutput(schema, { value: { ...value, accessContext: broken } }));
});
