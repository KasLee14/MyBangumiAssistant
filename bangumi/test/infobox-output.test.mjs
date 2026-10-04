import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeInfobox } from '../dist/src/mcp/infobox-output.js';
import { subjectDetails, checkOutput, SUBJECT_INCLUDES } from '../dist/src/mcp/subject-output.js';
import { resourceResult, checkResourceResponse } from '../dist/src/mcp/resource-output.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/infobox-source-shapes.json', import.meta.url), 'utf8'));
const subject = (source, infobox = fixtures[source]) => ({ id: 101, type: 2, name: '测试作品', nameCN: '测试作品', name_cn: '测试作品', summary: '作品简介',
  airtime: { date: '2026-04-01' }, date: '2026-04-01', platform: source === 'p1' ? { nameCN: 'TV' } : 'TV', nsfw: false,
  infobox, tags: [{ name: '日常', count: 2, total_count: 4 }], rating: { score: 7, total: 3, count: { 1: 0, 7: 3 } } });
const accountContext = () => ({ mode: 'account', account: { id: 42, username: 'offline_user' }, nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });

for (const source of ['p1', 'v0']) {
  test(`${source} 接口字段形状兼容作品、角色和人物，输出只有固定 value 字段`, () => {
    const raw = structuredClone(fixtures[source]);
    const before = structuredClone(raw); const expected = normalizeInfobox(raw);
    const detail = subjectDetails({ ...subject(source), platform: 'TV' }, ['infobox'], 101);
    assert.deepEqual(detail.infobox, expected);
    for (const kind of ['character', 'person']) {
      const name = `get_${kind}_details`; const args = { [`${kind}_id`]: 101, include: ['infobox'] };
      const result = resourceResult(name, { id: 101, type: 1, name: '测试实体', infobox: raw }, args);
      assert.deepEqual(result.infobox, expected);
      checkOutput(findToolDefinition(name).outputSchema, { value: result });
      checkResourceResponse(name, result, args, findToolDefinition(name).outputSchema);
    }
    assert.deepEqual(raw, before);
    assert.ok(expected.every(item => !Object.hasOwn(item, 'values')));
  });

  test(`${source} 服务详情覆盖全部 include 组合，未请求字段不会带出`, async () => {
    const calls = [];
    const service = new BangumiMcpService({ close: async () => {}, currentUser: async () => ({ id: 42, username: 'offline_user' }),
      preflight: async () => source === 'p1' ? accountContext() : anonymousContext(),
      account: async path => { assert.equal(source, 'p1'); assert.equal(path, '/p1/subjects/101'); calls.push(path); return subject(source); },
      public: async path => { assert.equal(source, 'v0'); assert.equal(path, '/v0/subjects/101'); calls.push(path); return subject(source); } });
    for (let mask = 0; mask < 2 ** SUBJECT_INCLUDES.length; mask++) {
      const include = SUBJECT_INCLUDES.filter((_, i) => mask & 2 ** i);
      const value = await service.call('get_subject_details', { subject_id: 101, include });
      assert.deepEqual(value.included, include);
      for (const field of SUBJECT_INCLUDES) assert.equal(Object.hasOwn(value, field), include.includes(field));
      if (include.includes('infobox')) assert.deepEqual(value.infobox, normalizeInfobox(fixtures[source]));
      assert.equal(value.accessContext.source, source);
    }
    assert.equal(calls.length, 16);
  });
}

test('信息栏缺失可为空，但提供非法字段不能被替换为空值或悄悄换源', () => {
  assert.equal(normalizeInfobox(null), null); assert.equal(normalizeInfobox(undefined), null);
  assert.deepEqual(normalizeInfobox([{ key: '空字符串', value: '' }, { key: '回退', value: null, values: [{ v: '' }] }]),
    [{ key: '空字符串', value: '' }, { key: '回退', value: [{ v: '' }] }]);
  for (const raw of [{}, ['非法条目'], [{ key: 1, values: [] }], [{ key: '缺少值' }], [{ key: '非法值', value: false, values: [] }],
    [{ key: '非法数组', values: ['不能将字符串猜成键值对'] }], [{ key: '非法正文', value: [{ v: 1 }] }], [{ key: '非法键', value: [{ k: null, v: '正文' }] }]]) {
    assert.throws(() => normalizeInfobox(raw), { code: 'INVALID_RESPONSE' });
  }
});

test('未请求的信息栏无需解析，请求后严格拒绝非法类型与超限正文', () => {
  const raw = { ...subject('v0'), infobox: '非法信息栏' };
  assert.equal(Object.hasOwn(subjectDetails(raw, [], 101), 'infobox'), false);
  assert.throws(() => subjectDetails(raw, ['infobox'], 101), { code: 'INVALID_RESPONSE' });
  for (const kind of ['character', 'person']) {
    const args = { [`${kind}_id`]: 101, include: [] };
    const value = resourceResult(`get_${kind}_details`, { id: 101, type: 1, name: '测试实体', infobox: raw.infobox }, args);
    assert.equal(Object.hasOwn(value, 'infobox'), false);
  }
  assert.throws(() => subjectDetails({ ...subject('v0'), infobox: [{ key: '超限', value: '文'.repeat(20001) }] }, ['infobox'], 101), { code: 'MCP_INVALID_RESULT' });
});

test('已请求的作品可空字段拒绝非法类型，不将错误数据转为 null 或字符串', () => {
  for (const [include, patch] of [['summary', { summary: 1 }], ['tagStats', { tags: [{ name: '日常', count: '2' }] }],
    ['ratingDistribution', { rating: { count: { 1: -1 } } }], ['ratingDistribution', { rating: { count: { 1: '1' } } }]]) {
    assert.throws(() => subjectDetails({ ...subject('v0'), ...patch }, [include], 101), { code: 'INVALID_RESPONSE' });
  }
});
