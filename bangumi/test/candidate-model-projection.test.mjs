import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { projectModelResult } from '../dist/src/mcp/model-projection.js';

const raw = id => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`, nsfw: false, platform: 'TV',
  date: '2026-01-01', rating: { score: 8, total: 100, rank: 20 }, tags: [], meta_tags: ['TV'],
  summary: `缓存正文${id}`, infobox: [{ key: '每集时长', value: '24分钟' }] });
function fixture() {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async (path, options) => {
    calls.push(path);
    if (path === '/v0/search/subjects') return { data: [raw(1), raw(2)], total: 2 };
    return raw(Number(path.split('/').at(-1)));
  } });
  const call = (name, args, turnId = 'projection-test') => service.call(name, args, undefined, undefined, undefined, { turnId });
  return { calls, service, call };
}

test('明确详情读取保存完整原生资源，后续fields补正文/时长复用同轮次缓存', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const direct = await f.call('get_subject_details', { subject_id: 1, include: [] });
  assert.equal(direct.summary, undefined);
  const candidate = await f.call('refine_subject_candidates', { subject_ids: [1], fields: ['id', 'summary', 'durationMinutes'] });
  assert.deepEqual(candidate.data, [{ id: 1, summary: '缓存正文1', durationMinutes: 24 }]);
  assert.deepEqual(f.calls, ['/v0/subjects/1']);
  await f.call('refine_subject_candidates', { subject_ids: [1], fields: ['id', 'summary'] }, 'different-turn');
  assert.equal(f.calls.length, 2);
  f.service.endReadContext('projection-test');
  await f.call('refine_subject_candidates', { subject_ids: [1], fields: ['id', 'summary'] });
  assert.equal(f.calls.length, 3);
});

test('缓存隐藏extras依然按本次fields校验，畸形infobox不使公开基础详情失败', async t => {
  let reads = 0;
  const service = new BangumiMcpService({ close: async () => {}, public: async () => {
    reads++; return { ...raw(1), infobox: '畸形信息栏' };
  } });
  t.after(() => service.close());
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'invalid-extra-test' });
  await call('get_subject_details', { subject_id: 1, include: [] });
  const value = await call('refine_subject_candidates', { subject_ids: [1], fields: ['id', 'infobox'] });
  assert.deepEqual(value.data, [{ id: 1, infobox: null, fieldStates: { infobox: 'failed' } }]);
  assert.equal(value.coverage.failedFieldCount, 1); assert.equal(reads, 1);
});

test('账号realm候选可复用其匿名SFW资源，NSFW权限改变重新读取隐藏正文', async t => {
  let reads = 0, allowed = true;
  const context = () => ({ mode: 'account', account: { id: 7, username: 'fixture' }, source: 'p1', nsfwApplied: false,
    nsfw: { preference: allowed, allowed, state: allowed ? 'enabled' : 'disabled' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => context(), ensureNsfw: async () => context(),
    public: async () => { reads++; return raw(1); } });
  t.after(() => service.close());
  const call = args => service.call('refine_subject_candidates', args, undefined, undefined, undefined, { turnId: 'account-cache-test' });
  const first = await call({ subject_ids: [1], filter: { nsfw: 'account' }, fields: ['id', 'score'] });
  const next = await call({ candidate_ref: first.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'summary'] });
  assert.equal(next.data[0].summary, '缓存正文1'); assert.equal(reads, 1);
  allowed = false;
  await call({ candidate_ref: next.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'infobox'] });
  assert.equal(reads, 2);
});

test('Pi上下文保留本次fields和续查进度，完整scope及审计数据仅在结构化结果', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const tools = createReadTools({ call: f.call });
  const recalled = await f.call('search_subjects', { keyword: 'test', result_mode: 'candidates', fields: ['id'], limit: 2 });
  const refine = tools.find(tool => tool.name === 'refine_subject_candidates');
  const reply = await refine.execute('call-1', { candidate_ref: recalled.resultRef, fields: ['id', 'summary'], limit: 1 }, undefined, undefined, {});
  const model = JSON.parse(reply.content[0].text).value;
  assert.deepEqual(model.data, [{ id: 1, summary: '缓存正文1' }]);
  assert.equal(model.scope, undefined); assert.equal(model.filter, undefined); assert.equal(model.include, undefined);
  assert.equal(model.lineage, undefined); assert.equal(model.coverage.sources, undefined);
  assert.equal(model.accessContext.mode, 'anonymous'); assert.ok(model.candidateRef); assert.ok(model.page.nextCursor);
  assert.ok(reply.structuredContent.value.scope); assert.deepEqual(reply.structuredContent.value, reply.details.value);
  const continuation = tools.find(tool => tool.name === 'continue_subject_query');
  const next = await continuation.execute('call-2', { candidate_ref: model.candidateRef, cursor: model.page.nextCursor }, undefined, undefined, {});
  const continued = JSON.parse(next.content[0].text).value;
  assert.equal(continued.request, undefined); assert.equal(continued.scope, undefined);
  assert.equal(continued.result.scope, undefined); assert.deepEqual(continued.result.data, [{ id: 2, summary: '缓存正文2' }]);
  assert.ok(next.structuredContent.value.request); assert.ok(next.structuredContent.value.result.scope);
});

test('输出模型只拿引用回执，宿主保留完整交付；显式审计保留来源证据', () => {
  const output = { kind: 'candidate_output', presentation: { content: [{ text: '完整交付' }] }, scope: { format: 'table' } };
  assert.equal(projectModelResult(output).presentation,undefined);
  assert.deepEqual(output.presentation,{content:[{text:'完整交付'}]});
  const sources = [{ tool: 'search_subjects', scope: '显式请求的来源' }];
  const audit = { kind: 'candidate_coverage', sources, dependencies: [], coverage: { complete: false, sources } };
  const projected = projectModelResult(audit);
  assert.deepEqual(projected.sources, sources); assert.equal(projected.coverage.sources, undefined);
  assert.deepEqual(audit.coverage.sources, sources);
});
