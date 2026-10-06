import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaArguments, compileSchema } from '../dist/src/support/tool-schema.js';
import { candidateValueSchema, candidateCoverageInputSchema, candidateCoverageOutputSchema, refineCandidateInputSchema,
  validateCandidateArguments, validateCandidateCoverageArguments, checkCandidateResponse, checkCandidateCoverageResponse } from '../dist/src/mcp/candidate-contract.js';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
const binding = { turnId: 'turn', accountId: null, scopeKey: 'public:sfw' };

test('固定Schema拒绝任意字段、表达式与双入口，默认只有4个基本字段', () => {
  const args = schemaArguments(refineCandidateInputSchema, { subject_ids: [1] });
  assert.deepEqual(args.fields, ['id', 'name', 'nameCn', 'subjectType']); assert.equal(args.limit, 50);
  assert.equal(args.response_view, 'page');
  for (const retired of [{ include: ['summary'] }, { hydrate_fields: false }, { coverage_mode: 'full' }])
    assert.throws(() => schemaArguments(refineCandidateInputSchema, { subject_ids: [1], ...retired }));
  for (const input of [{ subject_ids: [1], fields: ['raw'] }, { subject_ids: [1], filter: { expression: 'true' } }, { subject_ids: [1], candidate_ref: 'c1' }, { subject_ids: [1, 1] }, {}])
    assert.throws(() => schemaArguments(refineCandidateInputSchema, input));
});

test('时长和无递归OR契约拒绝任意分支、空分支和非法响应模式', () => {
  const valid = { subject_ids: [1], fields: ['id', 'durationMinutes'],
    filter: { rating: { min: 7 }, any_of: [{ subject_form: ['ova'] }, { duration: { max: 5 } }] }, response_view: 'reference' };
  assert.doesNotThrow(() => validateCandidateArguments(schemaArguments(refineCandidateInputSchema, valid)));
  for (const filter of [{ any_of: [] }, { any_of: [{}] }, { any_of: [{ any_of: [{ duration: { max: 5 } }] }] },
    { any_of: [{ duration: { min: 20, max: 15 } }] }, { duration: { min: -1 } }, { duration: { min: 'short' } },
    { subject_ids: [] }, { subject_ids: [1, 1] }, { subject_ids: [0] }, { subject_ids: Array.from({ length: 10001 }, (_, index) => index + 1) }])
    assert.throws(() => validateCandidateArguments({ filter }), error => error.code === 'INVALID_INPUT');
  for (const input of [{ ...valid, coverage_mode: 'raw' }, { ...valid, response_view: 'all' }, { ...valid, hydrate_fields: 'false' }, { ...valid, filter: { any_of: Array.from({ length: 11 }, () => ({ duration: { max: 5 } })) } }])
    assert.throws(() => schemaArguments(refineCandidateInputSchema, input));
});

test('上下界、真实日期和收藏条件矛盾在网络调用前拒绝', () => {
  for (const filter of [{ rating: {} }, { rating: { min: 9, max: 7 } }, { air_date: { min: '2026-02-30' } }, { collection_types: [2], exclude_collection_types: [2] }])
    assert.throws(() => validateCandidateArguments({ filter }), error => error.code === 'INVALID_INPUT');
});

test('字段投影和分页、覆盖、URL、未知状态可在客户端语义检查', async () => {
  const store = new CandidateStore(); const set = store.create({ binding, rows: [{ id: 1, facts: { name: '动画', url: 'https://bgm.tv/subject/1' } }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) }); const args = { candidate_ref: set.ref, fields: ['id', 'name', 'url'] };
  const result = await query.execute(args, binding); assert.equal(compileSchema(candidateValueSchema())(result), true); checkCandidateResponse(result, args);
  const bad = [value => value.data[0].summary = '泄漏', value => value.data[0].url = 'https://bgm.tv/subject/2', value => value.stage.matchedCount = 2,
    value => value.page.complete = false, value => value.coverage.complete = false, value => value.fields.push('summary'), value => value.scope.limit = 5,
    value => value.data[0].name = null, value => value.accessContext = {}, value => value.coverage.incompleteSourceCount = 1,
    value => value.coverage.sources = [], value => value.set.resultCount = 2, value => value.responseView = 'reference'];
  for (const change of bad) { const value = structuredClone(result); change(value); assert.throws(() => checkCandidateResponse(value, args), error => error.code === 'MCP_INVALID_RESULT'); }
});

test('collectionScope按真实来源核验，新省略来源不能伪成单状态，旧Cref恢复不冒充全状态', async () => {
  const store = new CandidateStore(), set = store.create({ binding, rows: [{ id: 1, facts: {} }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const value = await query.execute({ candidate_ref: set.ref, fields: ['id'] }, binding);
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 50 };
  const schema = findToolDefinition('query_user_collections').inputSchema;
  value.scope = args; value.collectionRef = 'collection:fixture'; value.collectionScope = { username: '-', subject_type: 2, sourceComplete: true };
  checkCandidateResponse(value, args, schema, value.collectionScope);
  const narrowed = structuredClone(value); narrowed.collectionScope.collection_type = 2;
  assert.throws(() => checkCandidateResponse(narrowed, args, schema), error => error.code === 'MCP_INVALID_RESULT');
  const restoredArgs = { ...args, collection_ref: 'collection:fixture' }; narrowed.scope = restoredArgs;
  checkCandidateResponse(narrowed, restoredArgs, schema, { username: '-', subject_type: 2, collection_type: 2, sourceComplete: true });
  assert.throws(() => checkCandidateResponse(narrowed, restoredArgs, schema, { username: '-', subject_type: 2, sourceComplete: true }), error => error.code === 'MCP_INVALID_RESULT');
  const wrong = structuredClone(narrowed); wrong.collectionScope.sourceComplete = false;
  assert.throws(() => checkCandidateResponse(wrong, restoredArgs, schema, narrowed.collectionScope), error => error.code === 'MCP_INVALID_RESULT');
});

test('覆盖详情只在按需分页时返回完整来源，来源计数、引用与完整性都可核对', async () => {
  const store = new CandidateStore(), sources = [1, 2, 3].map(id => ({ tool: 'get_subject_details', source: 'v0', scope: JSON.stringify({ subject_id: id }),
    complete: id !== 3, scannedCount: 1, total: id === 3 ? null : 1, nextOffset: id === 3 ? 1 : null, privateRecords: 'not_applicable' }));
  const set = store.create({ binding, rows: [{ id: 1, facts: {}, sources: [sources[0]] }], sources });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const result = await query.execute({ candidate_ref: set.ref, fields: ['id'] }, binding);
  const args = schemaArguments(candidateCoverageInputSchema, { coverage_ref: result.coverage.coverageRef, limit: 2 });
  const detail = query.readCoverage(args, binding); checkCandidateCoverageResponse(detail, args);
  assert.equal(compileSchema(candidateCoverageOutputSchema)({ value: detail }), true);
  assert.equal(detail.sources.length, 2); assert.equal(detail.page.nextOffset, 2); assert.equal(detail.page.complete, false);
  assert.equal(detail.coverage.complete, false); assert.equal(detail.coverage.sourceCount, 3); assert.equal(detail.coverage.incompleteSourceCount, 1);
  assert.equal(detail.coverage.unknownTotalSourceCount, 1); assert.deepEqual(detail.coverage.sourceChanges, []);
  const lastArgs = { ...args, offset: detail.page.nextOffset }, last = query.readCoverage(lastArgs, binding); checkCandidateCoverageResponse(last, lastArgs);
  assert.deepEqual(last.sources[0], { ...sources[2], sourceRef: last.sources[0].sourceRef }); assert.equal(last.page.complete, true); assert.equal(last.coverage.complete, false);
  for (const change of [value => value.coverageRef = 'other', value => value.page.nextOffset = null, value => value.coverage.complete = true,
    value => value.sources[0].scope = '[]', value => value.sources[0].nextOffset = 99, value => value.sources[1].sourceRef = value.sources[0].sourceRef,
    value => value.coverage.dependencyPendingCount = 1, value => value.coverage.dependencyIncompleteCount = 1]) {
    const bad = structuredClone(detail); change(bad); assert.throws(() => checkCandidateCoverageResponse(bad, args), error => error.code === 'MCP_INVALID_RESULT');
  }
  for (const value of [{}, { coverage_ref: result.coverage.coverageRef, limit: 101 }, { coverage_ref: result.coverage.coverageRef, extra: true }])
    assert.throws(() => validateCandidateCoverageArguments(value), error => error.code === 'INVALID_INPUT');
  assert.throws(() => query.readCoverage({ coverage_ref: result.coverage.coverageRef, offset: 4 }, binding), error => error.code === 'INVALID_INPUT');
});

test('召回sourcePage与候选处理cursor分离，来源原分页元数据必须自洽', async () => {
  const store = new CandidateStore(), set = store.create({ binding, rows: [{ id: 1, facts: {} }, { id: 2, facts: {} }], sources: [] });
  const args = { candidate_ref: set.ref, fields: ['id'], limit: 1 }, query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const result = await query.execute(args, binding);
  result.sourcePage = { total: 3, limit: 2, offset: 0, returnedCount: 2, nextOffset: 2, complete: false };
  checkCandidateResponse(result, args); assert.ok(result.page.nextCursor); assert.equal(result.sourcePage.nextOffset, 2); assert.equal(result.data.length, 1);
  for (const change of [value => value.sourcePage.nextOffset = 1, value => value.sourcePage.complete = true,
    value => value.sourcePage.returnedCount = 3, value => value.sourcePage.sourceHasMore = true]) {
    const bad = structuredClone(result); change(bad); assert.throws(() => checkCandidateResponse(bad, args), error => error.code === 'MCP_INVALID_RESULT');
  }
  result.sourcePage = { total: null, totalKind: 'unknown', limit: 2, offset: 100, returnedCount: 1, nextOffset: 102,
    sourceNextOffset: 102, sourceHasMore: true, complete: false, excludedNsfwCount: 1, unknownNsfwCount: 0 };
  checkCandidateResponse(result, args);
});
