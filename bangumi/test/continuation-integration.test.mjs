import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';

test('服务与桥接只凭resultRef别名及cursor恢复原候选条件，不要求模型重复fields/filter', async t => {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    calls.push(path); const id = Number(path.split('/').at(-1));
    return { id, type: 2, name: `作品${id}`, name_cn: `作品${id}`, platform: 'TV', nsfw: false,
      date: '2026-10-01', tags: [], rating: { score: id === 2 ? 5 : 8, total: 100, rank: 20 } };
  } }); t.after(() => service.close());
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'continue-bridge' });
  const first = await call('refine_subject_candidates', { subject_ids: [1, 2, 3, 4],
    filter: { subject_type: 2, rating: { min: 7 } }, fields: ['id', 'name'], limit: 1 });
  assert.deepEqual(first.data, [{ id: 1, name: '作品1' }]);
  const tool = createReadTools({ call }).find(tool => tool.name === 'continue_subject_query');
  const reply = await tool.execute('continue-fixture', { candidate_ref: first.resultRef, cursor: first.page.nextCursor, limit: 100 }, undefined, undefined, {});
  const parsed = JSON.parse(reply.content[0].text); assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.tool, 'refine_subject_candidates');
  assert.equal(parsed.value.request, undefined, '冻结执行计划留在details，不重复进入模型上下文');
  assert.equal(reply.details.value.request.candidate_ref, first.candidateRef);
  assert.deepEqual(reply.details.value.request.filter, { subject_type: 2, rating: { min: 7 } });
  assert.deepEqual(reply.details.value.request.fields, ['id', 'name']);
  assert.deepEqual(parsed.value.result.data.map(row => row.id), [3, 4]);
  assert.equal(parsed.value.result.stage.excludedCount, 1); assert.equal(parsed.value.result.page.nextCursor, null);
  assert.equal(calls.length, 4);
  await assert.rejects(call('continue_subject_query', { candidate_ref: first.candidateRef, cursor: first.page.nextCursor,
    filter: {} }), error => error.code === 'INVALID_INPUT');
});
