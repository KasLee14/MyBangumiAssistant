import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { checkSubjectQueryCoverage, compileSubjectSearch, applySearchPlan, requireBrowseCoverage } from '../dist/src/mcp/search-capabilities.js';
import { AppError } from '../dist/src/support/errors.js';
import { subjectDetails } from '../dist/src/mcp/subject-output.js';
import { resourceResult, checkResourceResponse } from '../dist/src/mcp/resource-output.js';
import { findToolDefinition, validateToolArguments } from '../dist/src/mcp/catalog.js';

const context = () => ({ mode: 'account', account: { id: 42, username: 'tester' }, nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });
test('成功搜索覆盖事实绑定本次条件，缺失、换来源、范围和精确总数伪报均拒绝', () => {
  const args = { keyword: '作品', subject_type: 2, filter: { nsfw: 'exclude', rating: { min: 7.5 } } };
  const ctx = context(); applySearchPlan(ctx, compileSubjectSearch({ keyword: args.keyword, filter: { type: [2], nsfw: 'exclude', rating: ['>=7.5'] } }, ctx));
  checkSubjectQueryCoverage('search_subjects', args, { accessContext: ctx });
  for (const patch of [{ queryCoverage: undefined }, { source: 'p1' }, { queryCoverage: { ...ctx.queryCoverage, requested: 'account' } }, { queryCoverage: { ...ctx.queryCoverage, actual: 'account_visible' } }, { queryCoverage: { ...ctx.queryCoverage, totalKind: 'exact' } }, { queryCoverage: { ...ctx.queryCoverage, limitations: [] } }]) {
    assert.throws(() => checkSubjectQueryCoverage('search_subjects', args, { accessContext: { ...ctx, ...patch } }), error => error.code === 'MCP_INVALID_RESULT');
  }
});
test('游戏平台公开浏览保留来源限制，不因已登录而错误要求p1', () => {
  const ctx = context(); requireBrowseCoverage('exclude', ctx, true); ctx.source = 'v0';
  checkSubjectQueryCoverage('browse_subjects', { subject_type: 4, platform: 'PC', nsfw: 'exclude' }, { accessContext: ctx });
  assert.ok(ctx.queryCoverage.limitations.includes('v0_anonymous_source'));
});
test('所有普通账户读取在发布前核实不可变范围，失败也关闭独立scope', async () => {
  let verified = 0, closed = 0;
  const service = new BangumiMcpService({ preflight: async () => context(), close: async () => {},
    bindReadScope: async () => ({ key: 'fixed', verify: async () => { verified++; throw new AppError('NSFW_SCOPE_CHANGED', '权限变化'); }, close: async () => { closed++; }, account: async () => { throw Error('不能作为业务请求'); } }) });
  await assert.rejects(service.call('get_current_user', {}), error => error.code === 'NSFW_SCOPE_CHANGED');
  assert.equal(verified, 1); assert.equal(closed, 1);
});
test('公开收藏列表与范围查询拒绝私密字段非法类型，评分人数不能转换为未知', async () => {
  for (const scopeTool of ['get_user_collections', 'query_user_collections']) for (const patch of [{ private: true }, { private: 'false' }, { private: 0 }, { rating: { total: '10', score: 7 } }]) {
    const row = { id: 123, type: 2, name: '测试', nameCN: '测试', airtime: { date: '2026-04-01' }, nsfw: false, eps: 12, volumes: 0, rating: { total: 10, score: 7 }, interest: { type: 2, rate: 0, tags: [], comment: '', epStatus: 0, volStatus: 0 }, ...patch };
    const service = new BangumiMcpService({ preflight: async () => context(), close: async () => {}, account: async () => ({ data: [row], total: 1 }) });
    const args = { username: 'someone', subject_type: 2, collection_type: 2, ...(scopeTool === 'query_user_collections' ? { air_date: { min: '2026-04-01', max: '2026-04-30' } } : {}) };
    await assert.rejects(service.call(scopeTool, args), error => ['PRIVATE_SCOPE', 'INVALID_RESPONSE'].includes(error.code));
  }
});
test('账户十档评分数组与公开字典等价，非法档数和计数明确拒绝', () => {
  const count = Array.from({ length: 10 }, (_, index) => index * 3);
  const raw = { id: 123, type: 2, name: '测试', nsfw: true, rating: { count } };
  const value = subjectDetails(raw, ['ratingDistribution'], 123);
  assert.deepEqual(Object.values(value.ratingDistribution), count);
  assert.deepEqual(subjectDetails({ ...raw, rating: { count: value.ratingDistribution } }, ['ratingDistribution'], 123).ratingDistribution, value.ratingDistribution);
  for (const broken of [count.slice(1), [...count, 1], count.map((value, index) => index === 1 ? '3' : value), count.map((value, index) => index === 1 ? -1 : value)]) assert.throws(() => subjectDetails({ ...raw, rating: { count: broken } }, ['ratingDistribution'], 123), error => error.code === 'INVALID_RESPONSE');
});
test('角色搜索明确排除NSFW时，未知或超范围作品不能满足条件', () => {
  const args = validateToolArguments('search_characters', { keyword: '测试', nsfw_filter: false });
  const schema = findToolDefinition('search_characters').outputSchema;
  for (const nsfw of [true, null]) {
    const value = resourceResult('search_characters', { data: [{ id: 1, name: '测试', type: 1, nsfw }], total: 1 }, args);
    assert.throws(() => checkResourceResponse('search_characters', value, args, schema), error => error.code === 'MCP_INVALID_RESULT');
  }
});
test('非AppError异常保留来源工具和已完成的账户预检，取消采用明确分类', async () => {
  const transport = { preflight: async () => context(), close: async () => {}, bindReadScope: async () => ({ key: 'fixed', account: async () => {}, verify: async () => { throw new TypeError('内部异常不可回显'); }, close: async () => {} }) };
  await assert.rejects(new BangumiMcpService(transport).call('get_current_user', {}), error => error.code === 'INTERNAL_ERROR' && error.sourceTool === 'get_current_user' && error.accessContext.mode === 'account' && !error.message.includes('不可回显'));
  const abort = new AbortController();
  const cancelled = { ...transport, preflight: async () => { abort.abort(); throw new DOMException('原始取消原因', 'AbortError'); } };
  await assert.rejects(new BangumiMcpService(cancelled).call('get_current_user', {}, abort.signal), error => error.code === 'CANCELLED' && error.accessContext.mode === 'unverified');
});
