import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { checkCandidateResponse } from '../dist/src/mcp/candidate-contract.js';
const binding = { turnId: 'independent-projection-audit', accountId: null, scopeKey: 'public:sfw' };
const source = count => ({ tool: 'browse_subjects', source: 'v0', scope: '{}', complete: true,
  scannedCount: count, total: count, nextOffset: null, privateRecords: 'not_applicable' });
const seed = (store, count) => store.create({ binding, rows: Array.from({ length: count }, (_, i) => ({ id: i + 1, facts: { score: 8 } })), sources: [source(count)] });

test('cp字段续页遇独立读取改变未读成员资格时明确拒绝，重新筛选保留正确成员', async () => {
  const store = new CandidateStore(), origin = seed(store, 2);
  const query = new CandidateQuery(store, { loadFacts: async row => ({ facts: { summary: `简介${row.id}`, score: row.id === 2 ? 6 : 8 } }) });
  const qualified = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'] }, binding);
  const args = { candidate_ref: qualified.resultRef, fields: ['id', 'summary'], limit: 1 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args);
  assert.ok(first.page.nextCursor.startsWith('cp_')); assert.equal(first.coverage.complete, false);
  await query.execute({ subject_ids: [2], fields: ['id', 'summary'] }, binding);
  const resumed = store.continuationArgs(first.resultRef, first.page.nextCursor, binding);
  await assert.rejects(query.execute(resumed, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const repairedArgs = { candidate_ref: qualified.resultRef, fields: ['id', 'summary'], limit: 100 };
  const repaired = await query.execute(repairedArgs, binding); checkCandidateResponse(repaired, repairedArgs);
  assert.deepEqual(repaired.data.map(row => row.id), [1]); assert.equal(repaired.stage.excludedCount, 1);
  assert.equal(repaired.coverage.complete, true);
});

test('字段窗口自身补详情使祖先条件失效后，转事实续页不漏其余成员或误保留失效项', async () => {
  const store = new CandidateStore(), origin = seed(store, 3);
  const query = new CandidateQuery(store, { loadFacts: async row => ({ facts: { summary: `简介${row.id}`, score: row.id === 2 ? 8 : 6 } }) });
  const qualified = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'] }, binding);
  let args = { candidate_ref: qualified.resultRef, fields: ['id', 'summary'], limit: 1 }, result;
  const ids = [];
  do {
    result = await query.execute(args, binding); checkCandidateResponse(result, args); ids.push(...result.data.map(row => row.id));
    if (result.page.nextCursor) args = store.continuationArgs(result.resultRef, result.page.nextCursor, binding);
  } while (result.page.nextCursor);
  assert.deepEqual(ids, [2]); assert.deepEqual(store.get(result.resultRef, binding).rows.map(row => row.id), [2]);
  assert.equal(result.stage.processedCount, 3); assert.equal(result.stage.excludedCount, 2); assert.equal(result.stage.matchedCount, 1);
  assert.equal(result.coverage.complete, true);
});
