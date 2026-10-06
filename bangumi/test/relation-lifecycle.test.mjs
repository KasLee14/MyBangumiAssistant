import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { RelationQuery } from '../dist/src/mcp/relation-query.js';
import { pageMetadata } from '../dist/src/mcp/subject-output.js';
import { checkRelationResponse } from '../dist/src/mcp/relation-contract.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
const binding = { turnId: 'relation-lifecycle', accountId: null, scopeKey: 'public:sfw' };
const subject = id => ({ id, name: `作品${id}`, subjectType: 2, subjectForm: 'tv', nsfw: false, relation: '续集' });
function fixture(parents, graph, maxRefs = 12) {
  const store = new CandidateStore({ maxRefs }), calls = [];
  const input = store.create({ binding, rows: parents.map(id => ({ id, facts: { name: `父${id}`, subjectType: 2, subjectForm: 'tv', nsfw: false } })), sources: [] });
  const query = new RelationQuery(store, { concurrency: 1, loadFacts: async () => { throw Error('事实已有'); },
    readRelations: async (id, offset, limit) => {
      calls.push({ id, offset, limit }); const all = (graph.get(id) ?? []).map(subject), data = all.slice(offset, offset + limit);
      return { data, page: pageMetadata({ total: all.length }, data.length, limit, offset), accessContext: anonymousContext(), scope: { subject_id: id } };
    } });
  return { store, input, query, calls };
}
async function finish(f, options) {
  let args = { candidate_ref: f.input.ref, fields: ['id'], ...options }, response, first;
  const data = [], covers = []; let windows = 0;
  do {
    response = await f.query.execute(args, binding, anonymousContext()); checkRelationResponse(response, args);
    first ??= response;
    assert.equal(response.candidateRef, first.candidateRef); assert.equal(response.resultRef, first.resultRef);
    data.push(...response.data.map(row => row.id)); covers.push(response.coverage.coverageRef);
    assert.ok(f.store.sets.size + f.store.resultViews.size <= 12);
    if (args.cursor) assert.throws(() => f.query.continuation(response.candidateRef, args.cursor, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
    args = { ...args, candidate_ref: response.candidateRef, cursor: response.page.nextCursor };
    windows++; assert.ok(windows < 1000);
  } while (!response.page.complete);
  return { response, first, data, covers, windows };
}
test('200目标逐项筛选续200窗只保留稳定关联阶段引用，旧覆盖可审计且lineage真实', async () => {
  const ids = Array.from({ length: 200 }, (_, index) => index + 1000), f = fixture([1], new Map([[1, ids]]));
  const { response, first, data, covers, windows } = await finish(f, { limit: 1 });
  assert.equal(windows, 200); assert.deepEqual(data, ids); assert.equal(response.coverage.complete, true);
  assert.deepEqual(f.store.get(response.resultRef, binding).rows.map(row => row.id), ids);
  const old = f.store.getCoverage(covers[0], binding);
  assert.equal(old.qualification.processedCount, 1); assert.equal(old.qualification.remainingCount, 199);
  assert.equal(f.store.getCoverage(covers.at(-1), binding).qualification.remainingCount, 0);
  assert.equal(f.query.lineage(first.resultRef, [1000], binding)[0].parents[0].parentId, 1);
  assert.equal(f.calls.length, 2);
});
test('多父小来源窗复用preview和外部stage，去重全部子项并保留每条父边', async () => {
  const parents = [1, 2, 3], graph = new Map(parents.map(id => [id, Array.from({ length: 30 }, (_, index) => 1000 + index)]));
  const f = fixture(parents, graph);
  const { response, data, covers, windows } = await finish(f, { source_limit: 1, limit: 1 });
  assert.ok(windows >= 90); assert.deepEqual(data, Array.from({ length: 30 }, (_, index) => 1000 + index));
  assert.equal(response.relationStage.relationScannedCount, 90); assert.equal(response.relationStage.duplicateChildCount, 60);
  assert.equal(response.coverage.complete, true);
  assert.ok(f.store.getCoverage(covers[0], binding).coverageDependencies.some(gap => gap.kind === 'source'));
  for (const row of f.query.lineage(response.resultRef, data, binding)) assert.deepEqual(row.parents.map(parent => parent.parentId), parents);
  assert.equal(f.calls.length, 90);
});
test('父事实在后补资料中失效或日期精度变未知，旧rc继续与后层下钻均先拒绝而不追加关系读取', async () => {
  for (const scenario of [
    { before: { score: 8 }, after: { score: 6 }, filter: { rating: { min: 7 } }, code: 'CANDIDATE_STAGE_INCOMPLETE' },
    { before: { date: '2026-10-01' }, after: { date: '2026' }, filter: { air_date: { min: '2026-10-01', max: '2026-10-01' } }, code: 'CANDIDATE_REQUIRED_FACTS_MISSING' },
  ]) {
    const f = fixture([1], new Map([[1, [1000, 1001, 1002]]]));
    f.store.cacheFacts(f.input.ref, binding, [{ id: 1, facts: scenario.before }]);
    const args = { candidate_ref: f.input.ref, parent_filter: scenario.filter, fields: ['id'], source_limit: 1, limit: 1 };
    const first = await f.query.execute(args, binding, anonymousContext());
    f.store.cacheFacts(f.input.ref, binding, [{ id: 1, facts: scenario.after }]);
    const before = f.calls.length;
    await assert.rejects(f.query.execute({ ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor }, binding, anonymousContext()),
      error => error.code === scenario.code);
    assert.equal(f.calls.length, before);
    const done = fixture([1], new Map([[1, [1000]]]));
    done.store.cacheFacts(done.input.ref, binding, [{ id: 1, facts: scenario.before }]);
    const complete = await done.query.execute({ candidate_ref: done.input.ref, parent_filter: args.parent_filter, fields: ['id'] }, binding, anonymousContext());
    done.store.cacheFacts(done.input.ref, binding, [{ id: 1, facts: scenario.after }]);
    const readBefore = done.calls.length;
    await assert.rejects(done.query.execute({ candidate_ref: complete.resultRef, fields: ['id'] }, binding, anonymousContext()),
      error => error.code === scenario.code);
    assert.equal(done.calls.length, readBefore);
  }
});
