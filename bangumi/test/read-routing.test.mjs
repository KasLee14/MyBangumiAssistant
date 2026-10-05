import assert from 'node:assert/strict';
import test from 'node:test';
import { planRead } from '../dist/src/mcp/read-routing.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { PersonCharactersQuery } from '../dist/src/mcp/person-characters.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { resourceResult, checkResourceResponse } from '../dist/src/mcp/resource-output.js';
import { collectionPage, checkSubjectResponse } from '../dist/src/mcp/subject-output.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
import { checkCollectionQuery } from '../dist/src/mcp/collection-query.js';

test('公开默认和社区匿名读不要求身份，仅明确搜索懒检查NSFW', () => {
  for (const name of ['get_subject_details', 'get_person_characters', 'search_subjects', 'browse_subjects', 'get_user_collections']) {
    const plan = planRead(name, { username: 'public_user' });
    assert.equal(plan.source, 'v0'); assert.equal(plan.requiresIdentity, false); assert.equal(plan.requiresNsfw, false);
  }
  for (const tool of TOOL_DEFINITIONS.filter(tool => tool.name.includes('community') || tool.name === 'get_subject_topics')) assert.equal(planRead(tool.name, {}).source, 'community');
  assert.equal(planRead('search_subjects', { filter: { nsfw: 'account' } }).requiresNsfw, true);
  for (const filter of [{ air_date: { min: '2026-04-01' } }, { rating: { min: 7.5 } }, { rating_count: { min: 100 } }, { tag: ['slice of life'] }])
    assert.equal(planRead('search_subjects', { filter: { nsfw: 'account', ...filter } }).requiresNsfw, false);
  assert.equal(planRead('browse_subjects', { nsfw: 'account' }).requiresNsfw, false);
});
test('本人标记、章节收藏及所有写入要求身份', () => {
  for (const [name, args] of [['get_current_user', {}], ['get_user_collections', { username: '-' }], ['get_index', { own: true }],
    ['get_user_episode_collection', {}], ['get_single_episode_collection', {}], ['get_person_characters', { include: ['own_collection'] }],
    ...TOOL_DEFINITIONS.filter(tool => tool.effect === 'write').map(tool => [tool.name, {}])]) {
    const plan = planRead(name, args); assert.equal(plan.source, 'p1', name); assert.equal(plan.requiresIdentity, true, name); assert.equal(plan.requiresNsfw, false, name);
  }
});
test('对象404仅允许固定映射账户补读，搜索和第三方列表不盲补', () => {
  for (const name of ['get_subject_details', 'get_person_image', 'get_subject_relations', 'get_episodes', 'get_person_characters']) assert.equal(planRead(name, {}).canFallbackToAccount, true);
  for (const name of ['search_subjects', 'browse_subjects', 'get_user_collections', 'get_user_character_collections', 'query_user_collections']) assert.equal(planRead(name, {}).canFallbackToAccount, false);
});
test('人物公共来源使用实际source，权限检查升级不破坏同范围快照', async () => {
  let calls = 0;
  const query = new PersonCharactersQuery({ public: async () => { calls++; return [{ id: 11, type: 1, name: '角色', subject_id: 101, subject_name: '作品', subject_type: 2, staff: '主角' }]; } });
  const args = { person_id: 71, include: [], limit: 1, offset: 0 };
  const initial = anonymousContext(); initial.nsfw = { preference: null, allowed: null, state: 'not_checked' };
  const first = await query.call(args, initial, undefined, { scopeKey: 'not_checked', readAccount: async () => { throw Error('不得请求账户'); } });
  const checked = { ...anonymousContext(), nsfw: { preference: null, allowed: false, state: 'disabled' } };
  const second = await query.call({ ...args, snapshot_ref: first.snapshotRef }, checked, undefined, { scopeKey: 'checked', readAccount: async () => { throw Error('不得请求账户'); } });
  assert.equal(calls, 1); assert.deepEqual(second.data, first.data);
  const account = { ...checked, mode: 'account', account: { id: 42, username: 'tester' }, source: 'p1' };
  await assert.rejects(query.call({ ...args, snapshot_ref: first.snapshotRef }, account, undefined, { scopeKey: 'checked', readAccount: async () => [] }), error => error.code === 'SNAPSHOT_SCOPE_MISMATCH');
});
test('本人列表筛除R18后保留原来源游标与数量，未知总数不宣称完整', () => {
  const args = { username: '-', limit: 20, offset: 0 }, account = { id: 42, username: 'tester' };
  const metadata = { total: null, totalKind: 'unknown', sourceNextOffset: 20, sourceHasMore: true, excludedNsfwCount: 1, unknownNsfwCount: 0, account };
  const collection = collectionPage({ ...metadata, data: [{ type: 2, subject_id: 1, subject: { id: 1, type: 2, name: '作品', nsfw: false } }] }, args);
  assert.equal(collection.page.nextOffset, 20); assert.equal(collection.page.excludedNsfwCount, 1); assert.equal(collection.page.complete, false);
  checkSubjectResponse('get_user_collections', collection, args);
  const resource = resourceResult('get_user_character_collections', { ...metadata, data: [{ id: 1, type: 1, name: '角色', nsfw: false, collectedAt: 1700000000 }] }, args);
  assert.equal(resource.page.nextOffset, 20); assert.equal(resource.page.excludedNsfwCount, 1);
  checkResourceResponse('get_user_character_collections', resource, args, findToolDefinition('get_user_character_collections').outputSchema);
});
test('收藏查询只要筛除R18或未知事实即报告覆盖未完整', () => {
  const args = { username: '-', subject_type: 2, air_date: { min: '2026-04-01', max: '2026-04-30' }, sort: 'date_asc' };
  const create = (excluded, unknown, complete) => ({ data: [], matchedCount: 0, scope: args, visibility: 'self',
    coverage: { complete, source: 'p1', scannedCount: 2, collectionTotal: 2, unknownDateCount: 0, excludedNsfwCount: excluded,
      unknownNsfwCount: unknown, privateRecords: 'included' } });
  for (const [excluded, unknown] of [[1, 0], [0, 1]]) {
    checkCollectionQuery(create(excluded, unknown, false), args);
    assert.throws(() => checkCollectionQuery(create(excluded, unknown, true), args), error => error.code === 'MCP_INVALID_RESULT');
  }
});
