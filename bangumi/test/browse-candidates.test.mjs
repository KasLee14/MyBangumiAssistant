import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';

const row = (id, date = '2026-10-05') => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`,
  platform: 'TV', nsfw: false, date, summary: '不得在召回中返回此简介',
  rating: { score: 8, rank: 50, total: 100 }, meta_tags: ['TV', '日本'], tags: [{ name: '日常', count: 10 }] });
const args = { subject_type: 2, cat: 1, year: 2026, month: 10, sort: 'date', result_mode: 'candidates', fields: ['id', 'name'], limit: 3 };

test('月份浏览候选只返回请求字段，来源页与候选游标独立，后层复用未展示事实', async t => {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async (path, options) => {
    calls.push({ path, query: options.query });
    assert.equal(path, '/v0/subjects');
    return { data: [row(1), row(2)], total: 2, limit: 3, offset: 0 };
  } }); t.after(() => service.close());
  const first = await service.call('browse_subjects', args); checkAccessResponse('browse_subjects', first);
  assert.deepEqual(first.data, [{ id: 1, name: '作品1' }, { id: 2, name: '作品2' }]);
  assert.equal(first.sourcePage.nextOffset, null); assert.equal(first.sourcePage.returnedCount, 2);
  const selected = await service.call('refine_subject_candidates', { candidate_ref: first.resultRef,
    filter: { subject_ids: [2], subject_form: ['tv'] }, fields: ['id', 'date', 'score', 'tags'] });
  assert.equal(selected.data[0].date, '2026-10-05'); assert.equal(selected.data[0].score, 8);
  assert.deepEqual(selected.data[0].tags, ['日常']); assert.equal(calls.length, 1);
});

test('日期未知筛空仍返回真实来源下一页，紧凑投影不能伪造完整覆盖', async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async () => ({ data: [row(1, null), row(2, null), row(3, null)], total: 5, limit: 3, offset: 0 }) });
  t.after(() => service.close());
  const first = await service.call('browse_subjects', { ...args, response_view: 'reference' });
  assert.deepEqual(first.data, []); assert.equal(first.sourcePage.nextOffset, 3);
  assert.equal(first.sourcePage.sourceHasMore, true); assert.equal(first.coverage.complete, false);
  const proof = await service.call('get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
  assert.equal(JSON.parse(proof.sources[0].scope).filterCoverage, undefined);
  assert.equal(JSON.parse(proof.sources[0].scope).month, 10);
  assert.equal(proof.sources[0].readState.filterCoverage.unknownDateCount, 3);
  assert.deepEqual(proof.sources[0].readState.filterCoverage.unknownDateSubjectIds, [1, 2, 3]);
});
