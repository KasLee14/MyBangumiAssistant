import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';

const subject = (id, score = 8, date = '2026-10-01') => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`,
  nsfw: false, platform: 'TV', date, rating: { score, total: 100 }, tags: [], meta_tags: ['TV'], summary: `评分版本${score}`, infobox: [] });

test('新鲜详情刷新候选基础事实，缓存扩字段不能把旧评分与新简介拼成合格结果', async t => {
  let score = 8, requests = 0;
  const service = new BangumiMcpService({ close: async () => {}, public: async () => { requests++; return subject(1, score); } });
  t.after(() => service.close());
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'fresh-resource' });
  const initial = await call('refine_subject_candidates', { subject_ids: [1], fields: ['id', 'score'] });
  const qualified = await call('refine_subject_candidates', { candidate_ref: initial.candidateRef, filter: { rating: { min: 7 } }, fields: ['id'] });
  score = 6;
  const direct = await call('get_subject_details', { subject_id: 1, include: [] });
  assert.equal(direct.score, 6);
  const result = await call('refine_subject_candidates', { candidate_ref: qualified.resultRef, fields: ['id', 'score', 'summary'] });
  assert.deepEqual(result.data, []); assert.equal(result.stage.excludedCount, 1);
  assert.equal(requests, 2);
  const origin = await call('refine_subject_candidates', { candidate_ref: initial.candidateRef, fields: ['id', 'score', 'summary'] });
  assert.deepEqual(origin.data, [{ id: 1, score: 6, summary: '评分版本6' }]); assert.equal(requests, 2);
});

test('收藏来源续页按整个已读集合排序，末页更早日期不会只追加在旧顺序之后', async t => {
  const dates = new Map([[1, '2026-10-01'], [2, '2026-09-01'], [101, '2024-01-01']]);
  const all = Array.from({ length: 101 }, (_, index) => ({ subject_id: index + 1,
    subject: subject(index + 1, 8, dates.get(index + 1) ?? '2026-10-01'), type: 2, rate: 8, tags: [], private: false }));
  const service = new BangumiMcpService({ close: async () => {}, public: async (_path, options) => ({
    total: all.length, data: all.slice(options.query.offset, options.query.offset + options.query.limit),
  }) });
  t.after(() => service.close());
  for (const sort of ['date_asc', 'date_desc']) {
    const turnId = `sorted-source:${sort}`;
    const call = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId });
    const args = { username: 'alice', subject_type: 2, result_mode: 'candidates', response_view: 'reference',
      fields: ['id'], sort, source_limit: 100 };
    const first = await call('query_user_collections', args);
    const final = await call('query_user_collections', { ...args, collection_ref: first.collectionRef });
    assert.equal(final.candidateRef, first.candidateRef); assert.equal(final.coverage.complete, true);
    const binding = service.candidates.peekBinding(final.resultRef, turnId).binding;
    const rows = service.candidates.get(final.resultRef, binding).rows;
    const ordered = rows.map(row => [row.id, row.facts.date]);
    assert.deepEqual(ordered, [...ordered].sort((a,b) => (sort === 'date_asc' ? 1 : -1) * a[1].localeCompare(b[1]) || a[0] - b[0]));
    assert.equal(rows.length, 101);
  }
});
