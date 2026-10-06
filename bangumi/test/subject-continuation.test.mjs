import assert from 'node:assert/strict';
import test from 'node:test';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { RelationQuery } from '../dist/src/mcp/relation-query.js';
import { checkCandidateContinuationResponse, continueSubjectQueryInputSchema } from '../dist/src/mcp/continuation-contract.js';
import { compileSchema } from '../dist/src/support/tool-schema.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { pageMetadata } from '../dist/src/mcp/subject-output.js';

const binding = { turnId: 'continuation-test', accountId: null, scopeKey: 'public:sfw' };
const context = anonymousContext();
const noFacts = async () => { throw Error('缓存事实无需补取'); };
function wrap(plan, result, input) { return { schemaVersion: 1, kind: 'candidate_continuation', ...plan, result, scope: input, accessContext: context }; }
function seed(store, ids) {
  return store.create({ binding, rows: ids.map(id => ({ id, facts: { name: `条目${id}`, subjectType: 2, subjectForm: 'tv', nsfw: false, score: 8 } })),
    sources: [{ tool: 'search_subjects', source: 'v0', scope: '{}', complete: true, scannedCount: ids.length, total: ids.length, nextOffset: null, privateRecords: 'not_applicable' }] });
}

test('关联来源阶段用resultRef别名恢复原计划，不重新输入父/子filter、fields、收藏范围', async () => {
  const store = new CandidateStore(), parent = seed(store, [1]), calls = [];
  const rows = [10, 11, 12].map(id => ({ id, name: `子${id}`, subjectType: 2, platform: 'OVA', nsfw: false, score: 8, relation: '番外篇' }));
  const query = new RelationQuery(store, { concurrency: 1, loadFacts: noFacts, readRelations: async (id, offset, limit) => {
    calls.push([id, offset]); const data = rows.slice(offset, offset + limit);
    return { data, page: pageMetadata({ total: rows.length }, data.length, limit, offset), accessContext: context, scope: { subject_id: id } };
  } });
  const args = { candidate_ref: parent.ref, parent_filter: { subject_form: ['tv'] }, filter: { subject_type: 2, rating: { min: 7 } },
    relations: ['番外篇'], fields: ['id', 'name'], collection_ref: 'collection:original', source_limit: 1, limit: 1 };
  let current = await query.execute(args, binding, context);
  assert.equal(current.relationStage.phase, 'relations');
  const input = { candidate_ref: current.resultRef, cursor: current.page.nextCursor };
  const plan = query.continuation(input.candidate_ref, input.cursor, binding);
  assert.equal(plan.tool, 'expand_subject_relations'); assert.equal(plan.request.candidate_ref, current.candidateRef);
  for (const key of ['filter', 'parent_filter', 'relations', 'fields', 'collection_ref', 'source_limit']) assert.deepEqual(plan.request[key], args[key]);
  current = await query.execute(plan.request, binding, context); checkCandidateContinuationResponse(wrap(plan, current, input), input);
  while (current.page.nextCursor) {
    const input = { candidate_ref: current.resultRef, cursor: current.page.nextCursor, response_view: 'reference', limit: 50 };
    const plan = query.continuation(input.candidate_ref, input.cursor, binding, { response_view: 'reference', limit: 50 });
    current = await query.execute(plan.request, binding, context); checkCandidateContinuationResponse(wrap(plan, current, input), input);
  }
  assert.equal(current.stage.matchedCount, 3); assert.equal(current.coverage.complete, true); assert.deepEqual(calls, [[1, 0], [1, 1], [1, 2]]);
});

test('关联子扫描cursor允许展示切reference，原条件与字段冻结且错误cursor/账号拒绝', async () => {
  const store = new CandidateStore(), parent = seed(store, [1]);
  const rows = [10, 11, 12].map(id => ({ id, name: `子${id}`, subjectType: 2, platform: 'OVA', nsfw: false, relation: '番外篇' }));
  const query = new RelationQuery(store, { loadFacts: noFacts, readRelations: async (_id, offset, limit) => {
    const data = rows.slice(offset, offset + limit); return { data, page: pageMetadata({ total: rows.length }, data.length, limit, offset), accessContext: context };
  } });
  const original = { candidate_ref: parent.ref, filter: { subject_form: ['ova'] }, fields: ['id', 'name'], limit: 1 };
  const first = await query.execute(original, binding, context); assert.equal(first.stage.remainingCount, 2);
  const input = { candidate_ref: first.resultRef, cursor: first.page.nextCursor, response_view: 'reference', limit: 100 };
  const plan = query.continuation(input.candidate_ref, input.cursor, binding, { response_view: 'reference', limit: 100 });
  const last = await query.execute(plan.request, binding, context); checkCandidateContinuationResponse(wrap(plan, last, input), input);
  assert.equal(last.stage.matchedCount, 3); assert.equal(last.page.complete, true); assert.deepEqual(last.data, []);
  assert.throws(() => query.continuation(first.resultRef, 'rc_wrong', binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.throws(() => query.continuation(first.resultRef, first.page.nextCursor, { ...binding, turnId: 'other' }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.throws(() => query.continuation(first.resultRef, first.page.nextCursor, binding, { filter: { subject_type: 1 } }), error => error.code === 'INVALID_INPUT');
  const fake = wrap(plan, last, input); fake.request = { ...plan.request, fields: ['id'] };
  assert.throws(() => checkCandidateContinuationResponse(fake, input), error => error.code === 'MCP_INVALID_RESULT');
});

test('通用wrapper按宿主恢复request校验候选结果，不用continue当前默认fields/filter', async () => {
  const store = new CandidateStore(), source = seed(store, [1, 2, 3]), query = new CandidateQuery(store, { loadFacts: noFacts });
  const args = { candidate_ref: source.ref, filter: { rating: { min: 7 } }, fields: ['id', 'name'], limit: 1 };
  const first = await query.execute(args, binding, context);
  const input = { candidate_ref: first.resultRef, cursor: first.page.nextCursor };
  const plan = store.continuation(input.candidate_ref, input.cursor, binding);
  const result = await query.execute(plan.request, binding, context); checkCandidateContinuationResponse(wrap(plan, result, input), input);
  assert.equal(result.data[0].name, '条目2'); assert.deepEqual(result.filter, args.filter);
  assert.equal(compileSchema(continueSubjectQueryInputSchema)({ ...input, fields: ['id'] }), false);
});
