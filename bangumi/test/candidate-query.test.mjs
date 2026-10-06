import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore, candidateRow } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery, evaluateCandidateFacts } from '../dist/src/mcp/candidate-query.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { checkCandidateResponse as checkResponse, refineCandidateInputSchema } from '../dist/src/mcp/candidate-contract.js';
import { AppError } from '../dist/src/support/errors.js';

const binding = { turnId: 'turn', accountId: null, scopeKey: 'public:sfw' };
const source = { tool: 'search_subjects', source: 'v0', scope: JSON.stringify({ keyword: '搞笑' }), complete: false, scannedCount: 4, total: 1000, nextOffset: 4, privateRecords: 'not_applicable' };
const own = { ...anonymousContext(), mode: 'account', account: { id: 7, username: 'tester' }, source: 'p1' };
const ownedBinding = { ...binding, accountId: 7 };
function create(store, rows, options = {}) { return store.create({ binding, rows, sources: [source], ...options }); }
// 保留少量内部兼容参数的unit路径；公开请求仍严格由正式schema校验。
const internalInputSchema = { ...refineCandidateInputSchema, properties: { ...refineCandidateInputSchema.properties,
  include: { type: 'array', items: { type: 'string' } }, hydrate_fields: { type: 'boolean' }, coverage_mode: { enum: ['summary', 'full'] }, subject_type: { type: 'integer' } } };
const checkCandidateResponse = (response, args) => checkResponse(response, args,
  ['include', 'hydrate_fields', 'coverage_mode', 'subject_type'].some(key => Object.hasOwn(args, key)) ? internalInputSchema : undefined);

test('纯事实核对只读已有缓存，不请求HTTP或修改事实、读取状态和来源', t => {
  const row = candidateRow({ id: 1, facts: { subjectType: 2, subjectForm: 'tv', score: 8, tags: ['轻松'] },
    resolvedFields: ['durationMinutes'], sources: [source] });
  const filter = { rating: { min: 7 }, tag: ['轻松'] };
  const before = structuredClone({ row, filter });
  const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } };
  freeze(row); freeze(filter);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => { requests++; throw Error('纯事实核对不应请求网络'); });
  assert.deepEqual(evaluateCandidateFacts(row, filter), { result: 'match', missingFields: [] });
  assert.deepEqual(evaluateCandidateFacts(row, { rating: { max: 7 } }), { result: 'mismatch', missingFields: [] });
  const unknown = evaluateCandidateFacts(row, { duration: { max: 10 } });
  assert.deepEqual(unknown, { result: 'unknown', missingFields: ['durationMinutes'] });
  unknown.missingFields.push('summary');
  assert.deepEqual(evaluateCandidateFacts(row, { duration: { max: 10 } }), { result: 'unknown', missingFields: ['durationMinutes'] });
  assert.deepEqual({ row, filter }, before); assert.equal(requests, 0);
});

test('纯事实核对复用OR三态和廉价淘汰，不把未知分支或低精度日期当通过', () => {
  const row = candidateRow({ id: 1, facts: { subjectType: 2, subjectForm: 'tv', score: 8, date: '2020' } });
  assert.deepEqual(evaluateCandidateFacts(row, { any_of: [{ subject_form: ['tv'] }, { duration: { max: 10 } }] }), { result: 'match', missingFields: [] });
  assert.deepEqual(evaluateCandidateFacts(row, { any_of: [{ subject_form: ['ova'] }, { duration: { max: 10 } }] }), { result: 'unknown', missingFields: ['durationMinutes'] });
  assert.deepEqual(evaluateCandidateFacts(row, { any_of: [{ subject_form: ['ova'] }, { rating: { min: 9 } }] }), { result: 'mismatch', missingFields: [] });
  assert.deepEqual(evaluateCandidateFacts(row, { subject_ids: [2], duration: { max: 10 } }), { result: 'mismatch', missingFields: [] });
  assert.deepEqual(evaluateCandidateFacts(row, { air_date: { min: '2020-01-01' } }), { result: 'unknown', missingFields: ['date'] });
  assert.equal(row.fieldStates.date, 'known'); assert.deepEqual(row.resolvedFields, []);
});

test('纯事实核对保留失败与部分收藏缺席未知，并拒绝不合法硬条件', () => {
  const row = candidateRow({ id: 1, facts: { score: null, collectionState: 'unknown', collectionStatus: null },
    fieldStates: { score: 'failed' }, failureCodes: { score: 'HTTP_FAILED' }, resolvedFields: ['score'], excludesCollectionTypes: [3] });
  const before = structuredClone(row);
  assert.deepEqual(evaluateCandidateFacts(row, { rating: { min: 7 } }), { result: 'unknown', missingFields: ['score'] });
  assert.deepEqual(evaluateCandidateFacts(row, { exclude_collection_types: [3] }), { result: 'match', missingFields: [] });
  assert.deepEqual(evaluateCandidateFacts(row, { exclude_collection_types: [2] }), { result: 'unknown', missingFields: ['collectionStatus', 'collectionState'] });
  for (const filter of [{ rating: { min: 8, max: 7 } }, { subject_ids: [1, 1] }, { any_of: [{ any_of: [{ subject_type: 2 }] }] }, { unrecognized: true }])
    assert.throws(() => evaluateCandidateFacts(row, filter), error => error.code === 'INVALID_INPUT');
  assert.deepEqual(row, before);
});

test('Cref范围缺口为整阶段fatal，不吞成pending也不提交成功候选引用', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: { subjectType: 2 } }]);
  const query = new CandidateQuery(store, { loadFacts: async () => { throw new AppError('CREF_COVERAGE_INSUFFICIENT', '请补全真实来源'); } });
  await assert.rejects(query.execute({ candidate_ref: origin.ref, filter: { personal_rating: { min: 8 } }, fields: ['id'] }, ownedBinding, own),
    error => error.code === 'CREF_COVERAGE_INSUFFICIENT');
  assert.equal(store.sets.size, 1); assert.equal(store.resultViews.size, 0); assert.equal(store.get(origin.ref, binding).rows[0].fieldStates.personalRating, undefined);
});

test('廉价字段先筛掉作品，后续详情只读幸存者且字段不展示仍缓存', async () => {
  const store = new CandidateStore();
  const set = create(store, [1, 2, 3, 4].map(id => ({ id, facts: { name: `作品${id}`, score: id <= 2 ? 8 : 6 } })));
  const calls = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields) => { calls.push({ id: row.id, fields }); return { facts: { summary: `简介${row.id}`, tags: ['搞笑'], score: 8 } }; } });
  const args = { candidate_ref: set.ref, filter: { rating: { min: 7.5 } }, fields: ['id', 'summary'], limit: 50 };
  const result = await query.execute(args, binding, anonymousContext());
  assert.deepEqual(result.data.map(row => row.id), [1, 2]); assert.deepEqual(calls.map(call => call.id), [1, 2]);
  assert.equal(result.stage.excludedCount, 2); assert.equal(result.coverage.complete, false); assert.equal(result.page.complete, true);
  assert.equal(result.data[0].score, undefined); checkCandidateResponse(result, args);
  const supplemented = await query.execute({ candidate_ref: result.candidateRef, fields: ['id', 'score', 'tags', 'summary'] }, binding, anonymousContext());
  assert.equal(calls.length, 2); assert.equal(supplemented.data[0].score, 8);
  assert.equal(store.get(set.ref, binding).rows.length, 4); assert.equal(store.get(result.candidateRef, binding).rows.length, 2);
});

test('未知硬条件先核实，失败者不触发昂贵展示字段', async () => {
  const store = new CandidateStore(); const set = create(store, [1, 2].map(id => ({ id, facts: { score: null } })));
  const calls = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields, include) => { calls.push({ id: row.id, fields, include });
    return fields.includes('score') ? { facts: { score: row.id === 1 ? 6 : 8 } } : { facts: { summary: '简介' } }; } });
  const result = await query.execute({ candidate_ref: set.ref, filter: { rating: { min: 7.5 } }, fields: ['id', 'summary'], include: ['summary'] }, binding);
  assert.deepEqual(calls, [{ id: 1, fields: ['score'], include: [] }, { id: 2, fields: ['score'], include: [] }, { id: 2, fields: ['summary'], include: ['summary'] }]);
  assert.deepEqual(result.data.map(row => row.id), [2]);
});

test('同详情接口补多个筛选字段一次，未知结果和失败结果都记入待核实并不重复补读', async () => {
  const store = new CandidateStore(); const set = create(store, [1, 2, 3].map(id => ({ id, facts: {} })));
  const calls = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields) => { calls.push([row.id, fields]);
    if (row.id === 3) throw new AppError('HTTP_FAILED', '读取失败');
    return { facts: { score: row.id === 1 ? 8 : null, ratingCount: 100, tags: ['搞笑'], summary: '附带简介' } }; } });
  const args = { candidate_ref: set.ref, filter: { rating: { min: 7 }, rating_count: { min: 50 }, tag: ['搞笑'] }, fields: ['id', 'summary'] };
  const result = await query.execute(args, binding);
  assert.equal(calls.length, 3); assert.deepEqual(calls[0][1], ['score', 'ratingCount', 'tags']);
  assert.deepEqual(result.data.map(row => row.id), [1]); assert.deepEqual(result.pending.map(row => row.id), [2, 3]);
  assert.deepEqual(result.pending[1].failedFields, ['score', 'ratingCount', 'tags']); checkCandidateResponse(result, args);
  const again = await query.execute({ ...args, candidate_ref: result.candidateRef }, binding);
  assert.equal(calls.length, 4, '明确refine重试失败字段，但不重复补确实未知的字段'); assert.equal(again.stage.pendingCount, 2);
});

test('未知投影与未请求字段明确区分，include只补事实不隐式展开全部字段', async () => {
  const store = new CandidateStore(); const set = create(store, [{ id: 1, facts: { name: '动画' } }]); let calls = 0;
  const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: { summary: null, infobox: null } }; } });
  const args = { candidate_ref: set.ref, fields: ['id', 'summary'], include: ['infobox'] };
  const result = await query.execute(args, binding);
  assert.deepEqual(result.data, [{ id: 1, summary: null, fieldStates: { summary: 'unknown' } }]); assert.equal(calls, 1);
  assert.equal(result.data[0].infobox, undefined); checkCandidateResponse(result, args);
  const next = await query.execute({ candidate_ref: result.candidateRef, fields: ['id', 'infobox'] }, binding);
  assert.equal(calls, 1); assert.equal(next.data[0].fieldStates.infobox, 'unknown');
});

test('召回精简视图未知名称字段仅投影，不能为了nameCn=null逐项补详情', async () => {
  const store = new CandidateStore(); const set = create(store, [1, 2].map(id => ({ id, facts: { name: '作品', nameCn: null, subjectType: 2 } })));
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('召回不应补读详情'); } });
  const args = { candidate_ref: set.ref };
  const result = await query.execute(args, binding, undefined, undefined, { filterAlreadyApplied: true, hydrateProjection: false });
  assert.equal(result.data.length, 2); assert.deepEqual(result.data[0].fieldStates, { nameCn: 'unknown' }); checkCandidateResponse(result, args);
});

test('空通过页仍推进原输入游标；累计统计与后续幸存集合分离', async () => {
  const store = new CandidateStore(); const set = create(store, [1, 2, 3, 4, 5].map(id => ({ id, facts: { score: id < 3 ? 1 : 8 } })));
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('不应补读'); } });
  const args = { candidate_ref: set.ref, fields: ['id'], filter: { rating: { min: 7 } }, limit: 2 };
  const first = await query.execute(args, binding); assert.equal(first.data.length, 0); assert.equal(first.page.complete, false); assert.ok(first.page.nextCursor); checkCandidateResponse(first, args);
  assert.deepEqual(store.get(first.candidateRef, binding).rows.map(row => row.id), [3, 4, 5]);
  assert.deepEqual(store.get(first.resultRef, binding).rows, []);
  assert.deepEqual(store.get(first.candidateRef, binding).qualification.remainingIds, [3, 4, 5]);
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  const second = await query.execute(nextArgs, binding); assert.deepEqual(second.data.map(row => row.id), [3, 4]); checkCandidateResponse(second, nextArgs);
  const thirdArgs = { ...args, candidate_ref: second.candidateRef, cursor: second.page.nextCursor };
  const third = await query.execute(thirdArgs, binding); assert.deepEqual(third.data.map(row => row.id), [5]);
  assert.equal(third.stage.processedCount, 5); assert.equal(third.stage.matchedCount, 3); assert.equal(third.stage.excludedCount, 2);
  assert.deepEqual(store.get(third.candidateRef, binding).rows.map(row => row.id), [3, 4, 5]); checkCandidateResponse(third, thirdArgs);
  await assert.rejects(query.execute({ ...nextArgs, fields: ['id', 'name'] }, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
});

test('merge入口只输出新或有变化记录，引用保持完整合并集合', async () => {
  const store = new CandidateStore(); const set = create(store, [{ id: 1, facts: { name: '1' } }, { id: 2, facts: { name: '2' } }]);
  const merged = store.merge(set.ref, binding, [{ id: 2, facts: { name: '2' } }, { id: 3, facts: { name: '3' } }]);
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('不应补字段'); } });
  const result = await query.execute({ candidate_ref: merged.ref, fields: ['id', 'name'], filter: { tag: ['搞笑'] } }, binding, undefined, undefined,
    { processIds: merged.changedIds, preserveInput: true, filterAlreadyApplied: true });
  assert.deepEqual(result.data.map(row => row.id), [3]); assert.deepEqual(store.get(result.candidateRef, binding).rows.map(row => row.id), [1, 2, 3]);
});

test('增量窗口续页持久化输入子集，110旧加10新按3条续完只有10新ID一次且保留全部成员', async () => {
  const store = new CandidateStore(); const original = create(store, Array.from({ length: 110 }, (_, index) => ({ id: index + 1, facts: {} })));
  const merged = store.merge(original.ref, binding, Array.from({ length: 10 }, (_, index) => ({ id: index + 111, facts: {} })));
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('ID视图无需补字段'); } });
  let args = { candidate_ref: merged.ref, fields: ['id'], limit: 3 }, response = await query.execute(args, binding, undefined, undefined,
    { processIds: merged.changedIds, preserveInput: true, filterAlreadyApplied: true });
  const seen = response.data.map(row => row.id); checkCandidateResponse(response, args);
  while (response.page.nextCursor) {
    args = { candidate_ref: response.candidateRef, fields: ['id'], limit: 3, cursor: response.page.nextCursor };
    response = await query.execute(args, binding); checkCandidateResponse(response, args); seen.push(...response.data.map(row => row.id));
  }
  assert.deepEqual(seen, Array.from({ length: 10 }, (_, index) => index + 111));
  assert.equal(response.stage.inputCount, 10); assert.equal(response.stage.processedCount, 10);
  assert.equal(store.get(response.candidateRef, binding).rows.length, 120);
  assert.equal(response.set.resultCount, 120); assert.equal(store.get(response.resultRef, binding).rows.length, 120);
});

test('公开集合可升级已核实账户补本人数据，部分收藏缺席仍保持待核实', async () => {
  const store = new CandidateStore(); const set = create(store, [{ id: 1, facts: {} }, { id: 2, facts: {} }]);
  const calls = [];
  const query = new CandidateQuery(store, { loadFacts: async (row) => { calls.push(row.id); return row.id === 1
    ? { facts: { collectionState: 'unknown', collectionStatus: null }, excludesCollectionTypes: [2] }
    : { facts: { collectionState: 'unknown', collectionStatus: null } }; } });
  const args = { candidate_ref: set.ref, fields: ['id'], filter: { exclude_collection_types: [2] } };
  const result = await query.execute(args, ownedBinding, own);
  assert.deepEqual(result.data.map(row => row.id), [1]); assert.deepEqual(result.pending.map(row => row.id), [2]); assert.equal(result.visibility, 'self');
  checkCandidateResponse(result, args); assert.deepEqual(calls, [1, 2]);
  await assert.rejects(query.execute({ ...args, candidate_ref: result.candidateRef }, { ...binding, accountId: 8 }, { ...own, account: { id: 8, username: 'other' } }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  await assert.rejects(query.execute(args, binding, anonymousContext()), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
});

test('第三方公开收藏不能借own_collection把已知个人事实当作本人事实', async () => {
  const store = new CandidateStore(), publicOwnerBinding = { ...binding, scopeKey: 'public:collections:alice' };
  const set = create(store, [{ id: 1, facts: { personalRating: 9, collectionState: 'collected', collectionStatus: 2 } }],
    { binding: publicOwnerBinding, sources: [{ ...source, tool: 'get_user_collections', scope: JSON.stringify({ username: 'alice' }), privateRecords: 'public_only' }] });
  let calls = 0; const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: {} }; } });
  await assert.rejects(query.execute({ candidate_ref: set.ref, fields: ['id', 'personalRating'], include: ['own_collection'] }, { ...publicOwnerBinding, accountId: 7 }, own), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.equal(calls, 0);
  const actual = await query.execute({ candidate_ref: set.ref, fields: ['id', 'personalRating'] }, publicOwnerBinding);
  assert.equal(actual.data[0].personalRating, 9); assert.equal(actual.visibility, 'public');
});

test('第三方父范围来源只作祖先审计，新子候选account绑定能核实本人且不冒用父个人事实', async () => {
  const store = new CandidateStore(), targetBinding = { ...ownedBinding, scopeKey: 'account:7' };
  const ancestor = { ...source, tool: 'get_user_collections', scope: JSON.stringify({ username: 'alice', collection_type: 2 }), privateRecords: 'public_only' };
  const child = create(store, [{ id: 101, facts: { score: 8 } }], { binding: targetBinding, sources: [ancestor] });
  let calls = 0; const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: { personalRating: 7, collectionState: 'collected', collectionStatus: 3 },
    sources: [{ ...source, tool: 'get_user_subject_collection', source: 'p1', privateRecords: 'included', scope: JSON.stringify({ username: '-', subject_id: 101 }),
      complete: true, scannedCount: 1, total: 1, nextOffset: null }] }; } });
  const args = { candidate_ref: child.ref, fields: ['id', 'personalRating', 'collectionState'], include: ['own_collection'] };
  const result = await query.execute(args, targetBinding, own); checkCandidateResponse(result, args);
  assert.equal(calls, 1); assert.equal(result.data[0].personalRating, 7); assert.equal(result.visibility, 'self');
  assert.ok(store.getCoverage(result.coverage.coverageRef, targetBinding).sources.some(item => item.scope === ancestor.scope));
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.incompleteSourceCount, 1);
});

test('真实完整未收藏证明可排除各收藏状态，不因status=null反复请求', async () => {
  const store = new CandidateStore(); const set = create(store, [{ id: 1, facts: {} }]); let count = 0;
  const query = new CandidateQuery(store, { loadFacts: async () => { count++; return { facts: { collectionState: 'not_collected', collectionStatus: null } }; } });
  const result = await query.execute({ candidate_ref: set.ref, filter: { exclude_collection_types: [2, 3] }, fields: ['id', 'collectionState', 'collectionStatus'] }, ownedBinding, own);
  assert.equal(result.data[0].collectionState, 'not_collected'); assert.equal(count, 1);
  await query.execute({ candidate_ref: result.candidateRef, fields: ['id', 'collectionStatus'] }, ownedBinding, own); assert.equal(count, 1);
});

test('完整未收藏证明中的个人null值不适用，不能把不存在的收藏状态当coverage缺口', async () => {
  const store = new CandidateStore(), set = create(store, [{ id: 1, facts: {} }],
    { sources: [{ ...source, complete: true, total: 1, scannedCount: 1, nextOffset: null }] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: { collectionState: 'not_collected', collectionStatus: null, personalRating: null } }) });
  const args = { candidate_ref: set.ref, fields: ['id', 'collectionState', 'collectionStatus', 'personalRating'], include: ['own_collection'], filter: { exclude_collection_types: [2] } };
  const result = await query.execute(args, ownedBinding, own); checkCandidateResponse(result, args);
  assert.equal(result.coverage.unknownFieldCount, 0); assert.equal(result.coverage.failedFieldCount, 0); assert.equal(result.coverage.complete, true);
  assert.equal(result.data[0].collectionStatus, null); assert.equal(result.data[0].collectionState, 'not_collected');
});

test('派生结果已排掉NSFW成员仍保留全部来源的权限要求，权限失效不得读取coverage详情', async () => {
  const store = new CandidateStore(), set = create(store, [{ id: 1, facts: { nsfw: true, score: 1 } }, { id: 2, facts: { nsfw: false, score: 8 } }],
    { binding: ownedBinding, sources: [{ ...source, complete: true, total: 2, scannedCount: 2, nextOffset: null }] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('现有筛选事实已够'); } });
  const result = await query.execute({ candidate_ref: set.ref, fields: ['id'], filter: { rating: { min: 7 } } }, ownedBinding);
  assert.deepEqual(store.get(result.resultRef, ownedBinding).rows.map(row => row.id), [2]);
  assert.equal(store.peekCoverageBinding(result.coverage.coverageRef, 'turn').requiresNsfw, true);
  assert.throws(() => query.readCoverage({ coverage_ref: result.coverage.coverageRef }, ownedBinding, own), error => error.code === 'NSFW_SCOPE_CHANGED');
});

test('明确ID入口使用同一漏斗，低精度日期不能冒充完整日期匹配', async () => {
  const store = new CandidateStore(); let calls = 0;
  const query = new CandidateQuery(store, { loadFacts: async row => { calls++; return { facts: { date: row.id === 1 ? '2026-10' : '2026-10-01', subjectType: 2 } }; } });
  const args = { subject_ids: [1, 2], filter: { air_date: { min: '2026-10-01' } }, fields: ['id', 'subjectType'] };
  const result = await query.execute(args, binding); assert.equal(calls, 2); assert.deepEqual(result.pending.map(row => row.id), [1]); assert.deepEqual(result.data.map(row => row.id), [2]);
  checkCandidateResponse(result, args);
});

test('明确ID入口连续新建集合复用同绑定事实，第二次相同字段不会重新读取', async () => {
  const store = new CandidateStore(); const calls = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields) => { calls.push([row.id, fields]);
    return { facts: { score: 8, summary: `简介${row.id}`, nsfw: false }, sources: [{ ...source, tool: 'get_subject_details',
      scope: JSON.stringify({ subject_id: row.id, include: ['summary'] }), scannedCount: 1, total: 1, complete: true, nextOffset: null }] }; } });
  const args = { subject_ids: [1, 2], fields: ['id', 'score', 'summary'], include: ['summary'] };
  const first = await query.execute(args, binding); const second = await query.execute(args, binding);
  assert.deepEqual(first.data, second.data); assert.equal(calls.length, 2); checkCandidateResponse(second, args);
});

test('公开SFW召回后按明确ID补本人字段，复用公共评分与简介且不复制个人事实', async () => {
  const store = new CandidateStore(); const publicSource = { ...source, scope: JSON.stringify({ keyword: '搞笑', subject_type: 2 }) };
  create(store, [{ id: 1, facts: { nsfw: false, score: 8, summary: '公共简介' } }], { sources: [publicSource] });
  const calls = []; const query = new CandidateQuery(store, { loadFacts: async (row, fields) => { calls.push(fields);
    return { facts: { personalRating: 7, collectionStatus: 2, collectionState: 'collected' }, sources: [{ ...source, tool: 'get_user_subject_collection', source: 'p1',
      privateRecords: 'included', scope: JSON.stringify({ username: '-', subject_id: row.id }), scannedCount: 1, total: 1, complete: true, nextOffset: null }] }; } });
  const args = { subject_ids: [1], fields: ['id', 'score', 'summary', 'personalRating'], include: ['own_collection'] };
  const targetBinding = { ...ownedBinding, scopeKey: 'account:7' };
  const result = await query.execute(args, targetBinding, own);
  assert.deepEqual(result.data, [{ id: 1, score: 8, summary: '公共简介', personalRating: 7 }]);
  assert.deepEqual(calls, [['personalRating', 'collectionState', 'collectionStatus']]);
  assert.ok(store.getCoverage(result.coverage.coverageRef, targetBinding).sources.some(item => item.source === 'v0' && item.scope === publicSource.scope));
  assert.equal(result.coverage.sources, undefined); checkCandidateResponse(result, args);
  const again = await query.execute(args, targetBinding, own); assert.deepEqual(again.data, result.data); assert.equal(calls.length, 1);
});

test('账户或认证范围变化终止整个候选阶段，不产生成功子引用或跨账户事实缓存', async () => {
  for (const code of ['ACCOUNT_CHANGED', 'CANDIDATE_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED', 'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED']) {
    const store = new CandidateStore({ maxRefs: 2 });
    const origin = create(store, [{ id: 1, facts: { nsfw: false, score: 8 } }]);
    let loads = 0;
    const query = new CandidateQuery(store, { loadFacts: async () => { loads++; throw new AppError(code, '模拟全局读取绑定变化'); } });
    await assert.rejects(query.execute({ candidate_ref: origin.ref, fields: ['id', 'personalRating'], include: ['own_collection'] }, ownedBinding, own),
      error => error.code === code);
    assert.equal(loads, 1); assert.equal(store.get(origin.ref, binding).rows[0].fieldStates.personalRating, undefined);
    // 只有原引用占一个槽；若异常被吞并生成成功子集，以下创建会触发容量拒绝。
    const remaining = store.create({ binding, rows: [{ id: 2, facts: {} }], sources: [] }); assert.ok(remaining.ref);
  }
});

test('宿主时间窗口处理两条后yield准确续查剩余候选，既不失败也不限制总量', async () => {
  const store = new CandidateStore(); const origin = create(store, [1, 2, 3, 4, 5].map(id => ({ id, facts: {} })));
  let loads = 0; const loaded = [], dependencies = {
    loadFacts: async row => { loads++; loaded.push(row.id); return { facts: { score: 8 } }; },
    shouldYield: () => loads >= 2,
  };
  const query = new CandidateQuery(store, dependencies); const args = { candidate_ref: origin.ref, fields: ['id', 'score'], limit: 50 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args);
  assert.deepEqual(first.data.map(row => row.id), [1, 2]); assert.deepEqual(first.pending, []);
  assert.equal(first.stage.processedCount, 2); assert.equal(first.stage.remainingCount, 3); assert.ok(first.page.nextCursor);
  assert.ok(store.get(first.candidateRef, binding).rows.every(row => Object.keys(row.failureCodes).length === 0));
  dependencies.shouldYield = () => false;
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  const second = await query.execute(nextArgs, binding); checkCandidateResponse(second, nextArgs);
  assert.deepEqual(second.data.map(row => row.id), [3, 4, 5]); assert.deepEqual(loaded, [1, 2, 3, 4, 5]);
  assert.equal(second.stage.processedCount, 5); assert.equal(second.page.complete, true);
});

test('筛选组完成后到期不执行展示组，当前行未consumed但已取得筛选事实可在续查复用', async () => {
  const store = new CandidateStore(); const origin = create(store, [{ id: 1, facts: {} }, { id: 2, facts: {} }]);
  let yieldNow = false; const calls = [], dependencies = {
    loadFacts: async (row, fields) => { calls.push([row.id, [...fields]]); if (fields.includes('score')) { yieldNow = true; return { facts: { score: 8 } }; }
      return { facts: { summary: `简介${row.id}` } }; },
    shouldYield: () => yieldNow,
  };
  const query = new CandidateQuery(store, dependencies); const args = { candidate_ref: origin.ref, fields: ['id', 'summary'], filter: { rating: { min: 7 } }, limit: 50 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args);
  assert.deepEqual(first.data, []); assert.deepEqual(first.pending, []); assert.equal(first.stage.processedCount, 0); assert.equal(first.stage.remainingCount, 2);
  assert.equal(store.get(first.candidateRef, binding).rows[0].facts.score, 8); assert.ok(first.page.nextCursor);
  dependencies.shouldYield = () => false;
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  const second = await query.execute(nextArgs, binding); checkCandidateResponse(second, nextArgs);
  assert.deepEqual(second.data.map(row => row.id), [1, 2]);
  assert.deepEqual(calls, [[1, ['score']], [1, ['summary']], [2, ['score']], [2, ['summary']]]);
  assert.equal(second.stage.processedCount, 2); assert.equal(second.page.complete, true);
});

test('动画形式必须由动画媒体事实支持，元标签排除延续现有负标签语义', async () => {
  const store = new CandidateStore(); const set = create(store, [{ id: 1, facts: { subjectType: 2, subjectForm: 'tv', metaTags: ['日本'] } },
    { id: 2, facts: { subjectType: 6, subjectForm: 'tv', metaTags: ['日本'] } }, { id: 3, facts: { subjectType: 2, subjectForm: 'movie', metaTags: ['日本', '续作'] } }]);
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('现有字段已足够'); } });
  const result = await query.execute({ candidate_ref: set.ref, fields: ['id'], filter: { subject_form: ['tv', 'movie'], meta_tags: ['日本', '-续作'] } }, binding);
  assert.deepEqual(result.data.map(row => row.id), [1]); assert.equal(result.stage.excludedCount, 2);
});

test('1201完整来源保留宿主，默认只汇总变化组，full兼容与按需分页可回溯全部证据', async () => {
  const store = new CandidateStore(), sources = Array.from({ length: 1201 }, (_, index) => ({ tool: 'get_subject_details', source: 'v0',
    scope: JSON.stringify({ subject_id: index + 1, include: ['summary', 'infobox'], fields: ['id', 'score', 'date', 'summary', 'infobox'] }),
    complete: index !== 1200, scannedCount: 1, total: index === 1200 ? null : 1, nextOffset: index === 1200 ? 1 : null, privateRecords: 'not_applicable' }));
  const origin = store.create({ binding, rows: Array.from({ length: 17 }, (_, index) => ({ id: index + 1, facts: {}, sources: [sources[index]] })), sources });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('ID引用无需新读'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], response_view: 'reference', limit: 1 };
  const summary = await query.execute(args, binding); checkCandidateResponse(summary, args);
  assert.deepEqual(summary.data, []); assert.deepEqual(summary.pending, []); assert.equal(summary.stage.processedCount, 17);
  assert.equal(summary.coverage.sourceCount, 1201); assert.equal(summary.coverage.incompleteSourceCount, 1); assert.equal(summary.coverage.unknownTotalSourceCount, 1);
  assert.equal(summary.coverage.sources, undefined); assert.equal(summary.coverage.sourceChanges.length, 1);
  assert.equal(summary.coverage.sourceChanges[0].addedCount, 1201); assert.equal(JSON.stringify(summary).includes('subject_id'), false);
  assert.ok(JSON.stringify(summary.coverage).length < 850); assert.deepEqual(store.getCoverage(summary.coverage.coverageRef, binding).sources, sources);
  const fullArgs = { ...args, candidate_ref: summary.candidateRef, coverage_mode: 'full' }, full = await query.execute(fullArgs, binding); checkCandidateResponse(full, fullArgs);
  assert.deepEqual(full.coverage.sources, sources); assert.deepEqual(full.coverage.sourceChanges, []);
  assert.ok(JSON.stringify(full.coverage).length > JSON.stringify(summary.coverage).length * 100);
  const seen = []; let offset = 0;
  for (;;) {
    const detail = query.readCoverage({ coverage_ref: summary.coverage.coverageRef, offset, limit: 100 }, binding);
    seen.push(...detail.sources); if (detail.page.complete) break; offset = detail.page.nextOffset;
  }
  assert.equal(seen.length, sources.length); assert.equal(new Set(seen.map(item => item.sourceRef)).size, sources.length);
  assert.deepEqual(seen.map(({ sourceRef, ...item }) => item), sources);
});

test('变化摘要仅包含新增/继续读取的来源，原scope历史不重复重发', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: {} }]);
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('ID引用无需新读'); } });
  const first = await query.execute({ candidate_ref: origin.ref, fields: ['id'] }, binding);
  const again = await query.execute({ candidate_ref: first.candidateRef, fields: ['id'] }, binding);
  assert.deepEqual(again.coverage.sourceChanges, []);
  const advanced = { ...source, scannedCount: 100, nextOffset: 100 }, merged = store.merge(again.candidateRef, binding, [], [advanced]);
  const args = { candidate_ref: merged.ref, fields: ['id'] }, changed = await query.execute(args, binding); checkCandidateResponse(changed, args);
  assert.equal(changed.coverage.sourceCount, 1); assert.equal(changed.coverage.sourceChanges.length, 1);
  assert.equal(changed.coverage.sourceChanges[0].addedCount, 0); assert.equal(changed.coverage.sourceChanges[0].updatedCount, 1);
  assert.equal(changed.coverage.sourceChanges[0].scannedCount, 100); assert.equal(changed.coverage.sourceChanges[0].scope, undefined);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).sources[0].scannedCount, 4);
  assert.equal(store.getCoverage(changed.coverage.coverageRef, binding).sources[0].scannedCount, 100);
});

test('reference扫描917候选而不被展示limit=1提前结束，模型只见计数和已核结果引用', async () => {
  const store = new CandidateStore(), rows = Array.from({ length: 917 }, (_, index) => ({ id: index + 1, facts: { score: 8, name: `父作品${index + 1}`, nameCn: null, subjectType: 2 } }));
  const origin = create(store, rows, { sources: [{ ...source, complete: true, total: 917, scannedCount: 917, nextOffset: null }] });
  let reads = 0; const query = new CandidateQuery(store, { loadFacts: async () => { reads++; throw Error('既有筛选事实足够'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, response_view: 'reference', limit: 1 };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(result.data, []); assert.deepEqual(result.pending, []); assert.equal(result.stage.inputCount, 917);
  assert.equal(result.stage.processedCount, 917); assert.equal(result.set.resultCount, 917); assert.equal(result.page.nextCursor, null);
  assert.equal(result.coverage.complete, true); assert.equal(store.get(result.resultRef, binding).rows.length, 917);
  assert.ok(JSON.stringify(result).length < 2000); assert.equal(JSON.stringify(result).includes('父作品'), false);
  const defaultArgs = { candidate_ref: origin.ref, filter: { rating: { min: 7 } }, response_view: 'reference', limit: 1 };
  const defaultFields = await query.execute(defaultArgs, binding); checkCandidateResponse(defaultFields, defaultArgs);
  assert.deepEqual(defaultFields.fields, ['id', 'name', 'nameCn', 'subjectType']); assert.equal(defaultFields.stage.processedCount, 917);
  assert.equal(defaultFields.coverage.complete, true); assert.equal(defaultFields.coverage.unknownFieldCount, 0); assert.equal(reads, 0);
});

test('reference显式include仍按需补证据，展示字段提示不触发读取或制造未知缺口', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: { name: '作品', nameCn: null, subjectType: 2 } }],
    { sources: [{ ...source, complete: true, total: 1, scannedCount: 1, nextOffset: null }] });
  const calls = [], query = new CandidateQuery(store, { loadFacts: async (row, fields, include) => { calls.push([fields, include]); return { facts: { summary: null } }; } });
  const args = { candidate_ref: origin.ref, include: ['summary'], response_view: 'reference' };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(calls, [[['summary'], ['summary']]]); assert.equal(result.coverage.unknownFieldCount, 1); assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.data, []); assert.equal(store.get(result.resultRef, binding).rows[0].fieldStates.summary, 'unknown');
});

test('LLM按语义选好ID后在原引用内白名单裁切，事实/来源/祖先保留且不重新读HTTP', async () => {
  const store = new CandidateStore(), relationSource = { ...source, tool: 'get_subject_relations', scope: JSON.stringify({ subject_id: 90, relation: ['番外篇'] }),
    complete: true, scannedCount: 3, total: 3, nextOffset: null };
  const origin = create(store, [1, 2, 3].map(id => ({ id, facts: { name: `子作品${id}`, score: 8, summary: `证据${id}` } })), { sources: [relationSource] });
  let loads = 0; const query = new CandidateQuery(store, { loadFacts: async () => { loads++; throw Error('选择集合应复用宿主事实'); } });
  const args = { candidate_ref: origin.ref, filter: { subject_ids: [1, 3], rating: { min: 7 } }, fields: ['id', 'name', 'summary'], response_view: 'reference' };
  const selected = await query.execute(args, binding); checkCandidateResponse(selected, args);
  assert.equal(selected.stage.inputCount, 3); assert.equal(selected.stage.excludedCount, 1); assert.equal(selected.set.resultCount, 2);
  const set = store.get(selected.resultRef, binding); assert.deepEqual(set.rows.map(row => row.id), [1, 3]); assert.equal(set.rows[0].facts.summary, '证据1');
  assert.equal(store.get(selected.candidateRef, binding).parentRef, origin.ref); assert.deepEqual(set.sources, [relationSource]); assert.equal(loads, 0);
  const pageArgs = { candidate_ref: selected.resultRef, fields: ['id', 'name', 'summary'] }, page = await query.execute(pageArgs, binding); checkCandidateResponse(page, pageArgs);
  assert.deepEqual(page.data, [{ id: 1, name: '子作品1', summary: '证据1' }, { id: 3, name: '子作品3', summary: '证据3' }]); assert.equal(loads, 0);
  const orArgs = { candidate_ref: origin.ref, fields: ['id'], filter: { any_of: [{ subject_ids: [2] }, { subject_ids: [3] }] } };
  const or = await query.execute(orArgs, binding); checkCandidateResponse(or, orArgs); assert.deepEqual(or.data.map(row => row.id), [2, 3]); assert.equal(loads, 0);
});

test('reference宿主让出保留剩余/pending与累计pass集合，窗口结束不能声称全量完成', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2, 3, 4, 5].map(id => ({ id, facts: {} })),
    { sources: [{ ...source, complete: true, total: 5, scannedCount: 5, nextOffset: null }] });
  let calls = 0; const dependencies = { loadFacts: async row => { calls++; return { facts: { score: row.id === 2 ? null : 8 } }; }, shouldYield: () => calls >= 3 };
  const query = new CandidateQuery(store, dependencies), args = { candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, response_view: 'reference', limit: 1 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args);
  assert.equal(first.stage.processedCount, 3); assert.equal(first.stage.pendingCount, 1); assert.equal(first.stage.remainingCount, 2);
  assert.equal(first.coverage.complete, false); assert.deepEqual(first.pending, []);
  assert.deepEqual(store.get(first.candidateRef, binding).rows.map(row => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(store.get(first.resultRef, binding).rows.map(row => row.id), [1, 3]);
  assert.equal(store.get(first.resultRef, binding).refRole, 'result'); assert.equal(store.get(first.candidateRef, binding).refRole, 'working');
  dependencies.shouldYield = () => false;
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor }, last = await query.execute(nextArgs, binding); checkCandidateResponse(last, nextArgs);
  assert.equal(last.page.complete, true); assert.equal(last.stage.processedCount, 5); assert.equal(last.stage.pendingCount, 1); assert.equal(last.coverage.complete, false);
  assert.deepEqual(store.get(last.resultRef, binding).rows.map(row => row.id), [1, 3, 4, 5]);
  const supplemented = store.updateFacts(last.candidateRef, binding, 2, { facts: { score: 8 } });
  const finalArgs = { ...args, candidate_ref: supplemented.ref }, final = await query.execute(finalArgs, binding); checkCandidateResponse(final, finalArgs);
  assert.equal(final.coverage.complete, true); assert.equal(final.stage.pendingCount, 0); assert.equal(final.set.resultCount, 5); assert.equal(calls, 5);
  assert.equal(first.candidateRef, last.candidateRef); assert.equal(first.resultRef, last.resultRef);
  assert.deepEqual(store.get(first.resultRef, binding).rows.map(row => row.id), [1, 3, 4, 5]);
  assert.deepEqual(store.get(first.candidateRef, binding).qualification.remainingIds, []);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).qualification.remainingCount, 2, '历史coverage保留早期计数');
});

test('通用OR采用三态且按分支补缺，形式已足够时不补时长，未知数值不当false', async () => {
  const store = new CandidateStore(), origin = create(store, [
    { id: 1, facts: { subjectType: 2, score: 8 } },
    { id: 2, facts: { subjectType: 2, subjectForm: 'tv', score: 8 } },
    { id: 3, facts: { subjectType: 2, subjectForm: 'web', score: 8 } },
    { id: 4, facts: { subjectType: 2, subjectForm: 'tv', durationMinutes: 10, score: 8 } },
    { id: 5, facts: { subjectType: 6, subjectForm: 'ova', durationMinutes: 4, score: 8 } },
  ]);
  const calls = [], query = new CandidateQuery(store, { loadFacts: async (row, fields) => {
    calls.push([row.id, fields]); if (row.id === 1) return { facts: { subjectForm: 'ova' } };
    return { facts: { durationMinutes: row.id === 2 ? 3 : null }, ...(row.id === 2 ? { sources: [{ ...source, tool: 'get_subject_details',
      scope: JSON.stringify({ subject_id: row.id, include: ['infobox'] }), complete: true, total: 1, scannedCount: 1, nextOffset: null }] } : {}) };
  } });
  const args = { candidate_ref: origin.ref, fields: ['id'], filter: { subject_type: 2, rating: { min: 7 }, any_of: [{ subject_form: ['ova'] }, { duration: { max: 5 } }] } };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(result.data.map(row => row.id), [1, 2]); assert.deepEqual(result.pending, [{ id: 3, missingFields: ['durationMinutes'], failedFields: [] }]);
  assert.deepEqual(calls, [[1, ['subjectForm']], [2, ['durationMinutes']], [3, ['durationMinutes']]]); assert.equal(result.stage.excludedCount, 2);
  assert.equal(store.get(result.candidateRef, binding).rows.find(row => row.id === 3).fieldStates.durationMinutes, 'unknown');
  assert.deepEqual(store.get(result.resultRef, binding).rows.map(row => row.id), [1, 2]);
});

test('918父中35资格未知不会在resultRef/关系子集/再次refine中被完整sources冲成全量complete', async () => {
  const store = new CandidateStore(), parentSource = { ...source, tool: 'get_user_collections', source: 'p1', privateRecords: 'included',
    scope: JSON.stringify({ username: '-', subject_type: 2 }), complete: true, scannedCount: 918, total: 918, nextOffset: null };
  const parents = store.create({ binding: ownedBinding, rows: Array.from({ length: 918 }, (_, index) => ({ id: index + 1,
    facts: { subjectType: 2, subjectForm: index < 525 ? 'tv' : index < 883 ? 'ova' : null }, resolvedFields: ['subjectForm'] })),
    sources: [parentSource], visibility: 'self', account: own.account });
  let reads = 0; const query = new CandidateQuery(store, { loadFacts: async () => { reads++; throw Error('现有事实不应重复读取'); } });
  const parentArgs = { candidate_ref: parents.ref, filter: { subject_form: ['tv'] }, fields: ['id'], response_view: 'reference' };
  const qualified = await query.execute(parentArgs, ownedBinding, own); checkCandidateResponse(qualified, parentArgs);
  assert.deepEqual(qualified.stage, { inputCount: 918, processedCount: 918, matchedCount: 525, excludedCount: 358, pendingCount: 35, remainingCount: 0 });
  const selectedArgs = { candidate_ref: qualified.resultRef, fields: ['id'], response_view: 'reference' };
  const selected = await query.execute(selectedArgs, ownedBinding, own); checkCandidateResponse(selected, selectedArgs);
  assert.equal(selected.stage.pendingCount, 0); assert.equal(selected.stage.remainingCount, 0); assert.equal(selected.coverage.incompleteSourceCount, 0);
  assert.equal(selected.coverage.dependencyPendingCount, 35); assert.equal(selected.coverage.dependencyIncompleteCount, 1); assert.equal(selected.coverage.complete, false);
  const relationSource = { ...source, tool: 'get_subject_relations', scope: JSON.stringify({ subject_id: 1 }), complete: true, scannedCount: 6661, total: 6661, nextOffset: null };
  const children = store.create({ binding: ownedBinding, parentRef: selected.resultRef, rows: Array.from({ length: 6661 }, (_, index) => ({ id: index + 1001,
    facts: { subjectType: 2, collectionState: 'not_collected', collectionStatus: null }, sources: [relationSource] })),
    sources: [parentSource, relationSource], visibility: 'self', account: own.account });
  const childArgs = { candidate_ref: children.ref, filter: { exclude_collection_types: [2, 3, 4, 5] }, fields: ['id'], response_view: 'reference' };
  const child = await query.execute(childArgs, ownedBinding, own); checkCandidateResponse(child, childArgs);
  assert.equal(child.stage.processedCount, 6661); assert.equal(child.set.resultCount, 6661); assert.equal(child.page.complete, true);
  assert.equal(child.coverage.pendingCount, 0); assert.equal(child.coverage.unknownFieldCount, 0); assert.equal(child.coverage.incompleteSourceCount, 0);
  assert.equal(child.coverage.dependencyPendingCount, 35); assert.equal(child.coverage.dependencyIncompleteCount, 1); assert.equal(child.coverage.complete, false); assert.equal(reads, 0);
  const detailArgs = { coverage_ref: child.coverage.coverageRef }, detail = query.readCoverage(detailArgs, ownedBinding, own);
  assert.equal(detail.dependencies.length, 1); assert.equal(detail.dependencies[0].coverageRef, qualified.coverage.coverageRef);
  assert.equal(detail.dependencies[0].pendingCount, 35); assert.equal(detail.dependencies[0].kind, 'qualification');
});

test('同阶段cursor/working复核会完成旧remaining，而取部分resultRef仍保留原全量资格缺口', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2, 3].map(id => ({ id, facts: { score: 8 } })),
    { sources: [{ ...source, complete: true, scannedCount: 3, total: 3, nextOffset: null }] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('现有事实足够'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, limit: 1 };
  const first = await query.execute(args, binding); assert.equal(first.coverage.dependencyIncompleteCount, 0);
  const partialArgs = { candidate_ref: first.resultRef, fields: ['id'], response_view: 'reference' }, partial = await query.execute(partialArgs, binding); checkCandidateResponse(partial, partialArgs);
  assert.equal(partial.page.complete, true); assert.equal(partial.coverage.dependencyRemainingCount, 2); assert.equal(partial.coverage.complete, false);
  const rerunArgs = { ...args, candidate_ref: first.candidateRef, limit: 100 }, rerun = await query.execute(rerunArgs, binding); checkCandidateResponse(rerun, rerunArgs);
  assert.equal(rerun.coverage.complete, true); assert.equal(rerun.coverage.dependencyIncompleteCount, 0);
  assert.equal(rerun.candidateRef, first.candidateRef); assert.equal(rerun.resultRef, first.resultRef);
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor, limit: 100 };
  await assert.rejects(query.execute(nextArgs, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).qualification.remainingCount, 2);
});

test('关系来源阶段失败作为通用source依赖保留，展示字段重算不能洗掉失败证明', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: {} }], { sources: [{ ...source, complete: true, scannedCount: 1, total: 1, nextOffset: null }],
    scopeCoverage: { complete: false, pendingCount: 0, remainingCount: 2, unknownCount: 0, failedCount: 1 } });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('ID视图不取字段'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], response_view: 'reference' }, result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.equal(result.coverage.unknownFieldCount, 0); assert.equal(result.coverage.failedFieldCount, 0);
  assert.equal(result.coverage.dependencyRemainingCount, 2); assert.equal(result.coverage.dependencyFailedCount, 1); assert.equal(result.coverage.complete, false);
  const gap = query.readCoverage({ coverage_ref: result.coverage.coverageRef }, binding).dependencies[0];
  assert.equal(gap.kind, 'source'); assert.equal(gap.coverageRef, origin.coverageRef); assert.equal(gap.failedCount, 1);
});

test('reference最多4在途、page仍串行，廉价不匹配者不触发任何补字段', async () => {
  for (const [view, expected] of [['reference', 4], ['page', 1]]) {
    const store = new CandidateStore(), origin = create(store, Array.from({ length: 10 }, (_, index) => ({ id: index + 1, facts: index < 2 ? { score: 1 } : {} })));
    let active = 0, maximum = 0; const loaded = [], query = new CandidateQuery(store, { loadFacts: async row => {
      loaded.push(row.id); active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--; return { facts: { score: 8 } };
    } });
    const args = { candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, response_view: view, limit: 100 };
    const result = await query.execute(args, binding); checkCandidateResponse(result, args);
    assert.equal(maximum, expected); assert.equal(active, 0); assert.deepEqual(loaded, [3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(result.stage.processedCount, 10); assert.equal(result.stage.matchedCount, 8); assert.equal(result.stage.excludedCount, 2);
  }
  for (const concurrency of [0, 5, 1.5]) assert.throws(() => new CandidateQuery(new CandidateStore(), { concurrency, loadFacts: async () => ({ facts: {} }) }), error => error.code === 'INVALID_INPUT');
});

test('reference让出只推进连续完成前缀，已完成尾行事实保留并在续查不重读', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2, 3, 4, 5, 6].map(id => ({ id, facts: {} })),
    { sources: [{ ...source, complete: true, scannedCount: 6, total: 6, nextOffset: null }] });
  let releaseHead, tailDone, shouldYield = false, summaries = 0;
  const slowHead = new Promise(resolve => releaseHead = resolve), tailsReady = new Promise(resolve => tailDone = resolve);
  const calls = [], dependencies = { shouldYield: () => shouldYield, loadFacts: async (row, fields) => {
    calls.push([row.id, fields[0]]);
    if (fields.includes('score')) { if (row.id === 2) await slowHead; return { facts: { score: 8 } }; }
    if ([1, 3, 4].includes(row.id) && ++summaries === 3) tailDone();
    return { facts: { summary: `简介${row.id}` } };
  } };
  const query = new CandidateQuery(store, dependencies), args = { candidate_ref: origin.ref, fields: ['id'],
    filter: { rating: { min: 7 } }, include: ['summary'], response_view: 'reference' };
  const running = query.execute(args, binding); await tailsReady; shouldYield = true; releaseHead();
  const first = await running; checkCandidateResponse(first, args);
  assert.equal(first.stage.processedCount, 1); assert.equal(first.stage.remainingCount, 5); assert.equal(first.set.resultCount, 1);
  assert.deepEqual(calls.filter(([id, field]) => field === 'score').map(([id]) => id), [1, 2, 3, 4]);
  const rows = store.get(first.candidateRef, binding).rows;
  assert.equal(rows.find(row => row.id === 2).facts.score, 8); assert.equal(rows.find(row => row.id === 3).facts.summary, '简介3');
  assert.equal(rows.find(row => row.id === 4).facts.summary, '简介4'); assert.equal(first.coverage.complete, false);
  shouldYield = false;
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor }, next = await query.execute(nextArgs, binding); checkCandidateResponse(next, nextArgs);
  assert.equal(next.stage.processedCount, 6); assert.equal(next.set.resultCount, 6); assert.equal(next.coverage.complete, true);
  for (const id of [1, 2, 3, 4]) assert.equal(calls.filter(([subjectId, field]) => subjectId === id && field === 'score').length, 1);
  for (const id of [1, 3, 4]) assert.equal(calls.filter(([subjectId, field]) => subjectId === id && field === 'summary').length, 1);
  assert.equal(calls.filter(([id, field]) => id === 2 && field === 'summary').length, 1);
});

test('reference任一在途账户fatal等待其余任务settle后整体拒绝，不提交事实或成功引用', async () => {
  const store = new CandidateStore({ maxRefs: 2 }), origin = create(store, [1, 2, 3, 4, 5, 6].map(id => ({ id, facts: {} })));
  let active = 0, settled = 0; const loaded = [], query = new CandidateQuery(store, { loadFacts: async row => {
    loaded.push(row.id); active++;
    try {
      await new Promise(resolve => setTimeout(resolve, row.id === 1 ? 1 : 10));
      if (row.id === 1) throw new AppError('ACCOUNT_CHANGED', '模拟在途账户变化');
      return { facts: { score: 8 } };
    } finally { active--; settled++; }
  } });
  await assert.rejects(query.execute({ candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, response_view: 'reference' }, binding), error => error.code === 'ACCOUNT_CHANGED');
  assert.deepEqual(loaded, [1, 2, 3, 4]); assert.equal(active, 0); assert.equal(settled, 4);
  assert.ok(store.get(origin.ref, binding).rows.every(row => row.fieldStates.score === undefined));
  assert.ok(store.create({ binding, rows: [{ id: 7, facts: {} }] }).ref, 'fatal不得创建成功子集合或消费额外引用容量');
});

test('cached page100投影缺失时长和中文名0读取，选中ID再hydrate复用原事实/祖先引用/依赖', async () => {
  const store = new CandidateStore(), relationSource = { ...source, tool: 'get_subject_relations', scope: JSON.stringify({ subject_id: 90 }),
    complete: true, scannedCount: 100, total: 100, nextOffset: null };
  const origin = create(store, Array.from({ length: 100 }, (_, index) => ({ id: index + 1, facts: { name: `作品${index + 1}`, nameCn: null } })),
    { sources: [relationSource], scopeCoverage: { complete: false, pendingCount: 0, remainingCount: 0, unknownCount: 0, failedCount: 1 } });
  const loads = [], query = new CandidateQuery(store, { loadFacts: async (row, fields) => { loads.push([row.id, fields]);
    return { facts: { nameCn: `中文${row.id}`, durationMinutes: 4 } }; } });
  const fields = ['id', 'name', 'nameCn', 'durationMinutes'], args = { candidate_ref: origin.ref, fields, hydrate_fields: false, limit: 100 };
  const cached = await query.execute(args, binding, undefined, undefined, { hydrateProjection: true }); checkCandidateResponse(cached, args);
  assert.equal(cached.data.length, 100); assert.deepEqual(loads, []); assert.equal(cached.coverage.unknownFieldCount, 0);
  assert.deepEqual(cached.data[0].fieldStates, { nameCn: 'unknown', durationMinutes: 'unknown' });
  assert.equal(cached.coverage.dependencyFailedCount, 1); assert.equal(cached.coverage.complete, false);
  const selectedArgs = { candidate_ref: cached.resultRef, filter: { subject_ids: [1, 50] }, fields, hydrate_fields: true, limit: 100 };
  const selected = await query.execute(selectedArgs, binding); checkCandidateResponse(selected, selectedArgs);
  assert.deepEqual(loads, [[1, ['nameCn', 'durationMinutes']], [50, ['nameCn', 'durationMinutes']]]);
  assert.deepEqual(selected.data.map(row => [row.id, row.durationMinutes, row.nameCn]), [[1, 4, '中文1'], [50, 4, '中文50']]);
  assert.equal(selected.coverage.unknownFieldCount, 0); assert.equal(selected.coverage.dependencyFailedCount, 1);
  const selectedSet = store.get(selected.resultRef, binding); assert.deepEqual(selectedSet.sources, [relationSource]);
  assert.equal(store.get(selected.candidateRef, binding).parentRef, cached.resultRef);
  assert.equal(cached.candidateRef, origin.ref); assert.equal(store.get(cached.candidateRef, binding).parentRef, origin.parentRef);
  assert.equal(selectedSet.coverageDependencies[0].coverageRef, origin.coverageRef);
});

test('hydrate_fields=false仍补硬条件与显式include，不为展示提示缺失制造覆盖缺口', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: { name: '作品', nameCn: null } }],
    { sources: [{ ...source, complete: true, scannedCount: 1, total: 1, nextOffset: null }] });
  const calls = [], query = new CandidateQuery(store, { loadFacts: async (row, fields, include) => {
    calls.push([fields, include]); return fields.includes('score') ? { facts: { score: 8 } } : { facts: { summary: '必要证据' } };
  } });
  const args = { candidate_ref: origin.ref, fields: ['id', 'nameCn', 'durationMinutes'], filter: { rating: { min: 7 } }, include: ['summary'], hydrate_fields: false };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(calls, [[['score'], []], [['summary'], ['summary']]]); assert.equal(result.coverage.complete, true); assert.equal(result.coverage.unknownFieldCount, 0);
  assert.deepEqual(result.data[0].fieldStates, { nameCn: 'unknown', durationMinutes: 'unknown' });
  const hinted = await query.execute({ candidate_ref: result.resultRef, fields: ['id', 'durationMinutes'], response_view: 'reference', hydrate_fields: true }, binding,
    undefined, undefined, { hydrateProjection: true });
  assert.equal(calls.length, 2); assert.equal(hinted.coverage.unknownFieldCount, 0); assert.equal(hinted.coverage.complete, true);
});

test('hydrate_fields补取策略冻结在cursor签名中，续页不能静默由缓存投影变为HTTP补取', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: {} }, { id: 2, facts: {} }]);
  let calls = 0; const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: { durationMinutes: 4 } }; } });
  const args = { candidate_ref: origin.ref, fields: ['id', 'durationMinutes'], hydrate_fields: false, limit: 1 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args); assert.equal(calls, 0);
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  await assert.rejects(query.execute({ ...nextArgs, hydrate_fields: true }, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const next = await query.execute(nextArgs, binding); checkCandidateResponse(next, nextArgs); assert.equal(calls, 0); assert.equal(next.stage.processedCount, 2);
});

test('展示补取返回新事实后复核硬条件，score8变6须排除并缓存供旧引用复核不重读', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: { score: 8 } }],
    { sources: [{ ...source, complete: true, scannedCount: 1, total: 1, nextOffset: null }] });
  let calls = 0; const evidence = { ...source, tool: 'get_subject_details', scope: JSON.stringify({ subject_id: 1, include: ['summary'] }),
    complete: true, scannedCount: 1, total: 1, nextOffset: null };
  const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: { score: 6, summary: '最新证据' }, sources: [evidence] }; } });
  const args = { candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id', 'score', 'summary'], include: ['summary'] };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(result.data, []); assert.equal(result.stage.excludedCount, 1); assert.equal(result.set.resultCount, 0);
  assert.equal(store.get(origin.ref, binding).rows[0].facts.score, 6); assert.equal(store.get(origin.ref, binding).rows[0].facts.summary, '最新证据');
  assert.ok(store.getCoverage(result.coverage.coverageRef, binding).sources.some(item => item.scope === evidence.scope));
  const repeated = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'], response_view: 'reference' }, binding);
  assert.equal(repeated.stage.excludedCount, 1); assert.equal(repeated.stage.matchedCount, 0); assert.equal(calls, 1);
});

test('默认64MB快照缓存支持6661成员完整67页，不重复保存全体事实或提前拒绝容量', async () => {
  const store = new CandidateStore(), complete = { ...source, tool: 'get_subject_relations', scope: JSON.stringify({ subject_id: 1 }),
    complete: true, scannedCount: 6661, total: 6661, nextOffset: null };
  const origin = create(store, Array.from({ length: 6661 }, (_, index) => ({ id: index + 1,
    facts: { name: `作品${index + 1}`, nameCn: null, subjectType: 2, score: 8, tags: ['公开标签'], metaTags: ['元标签'], date: '2025-01-01', nsfw: false }, sources: [complete] })), { sources: [complete] });
  let reads = 0; const query = new CandidateQuery(store, { loadFacts: async () => { reads++; throw Error('缓存浏览不应读HTTP'); } });
  let args = { candidate_ref: origin.ref, fields: ['id', 'name', 'nameCn', 'durationMinutes'], hydrate_fields: false, limit: 100 };
  const ids = []; let pages = 0, response, firstRef, firstCoverage;
  do {
    response = await query.execute(args, binding); checkCandidateResponse(response, args); pages++; ids.push(...response.data.map(row => row.id));
    if (pages === 1) { firstRef = response.resultRef; firstCoverage = response.coverage.coverageRef; }
    args = { ...args, candidate_ref: response.candidateRef, cursor: response.page.nextCursor };
  } while (response.page.nextCursor);
  assert.equal(pages, 67); assert.equal(ids.length, 6661); assert.equal(new Set(ids).size, 6661); assert.equal(response.coverage.complete, true);
  assert.equal(response.stage.processedCount, 6661); assert.equal(store.get(response.resultRef, binding).rows.length, 6661); assert.equal(reads, 0);
  assert.equal(firstRef, origin.ref, '纯字段分页沿原成员集合读取'); assert.equal(store.get(firstRef, binding).rows.length, 6661);
  assert.equal(store.getCoverage(firstCoverage, binding).qualification.remainingCount, 6561);
  assert.deepEqual(store.getCoverage(firstCoverage, binding).sources, [complete]); assert.ok(store.bytes < 64 * 1024 * 1024);
});

test('宿主从resultRef安全恢复真实working游标及冻结条件，不靠模型重拼fields/filter/collection_ref', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2, 3, 4].map(id => ({ id, facts: { subjectType: 2, score: id === 3 ? 5 : 8, name: `作品${id}` } })),
    { sources: [{ ...source, complete: true, scannedCount: 4, total: 4, nextOffset: null }] });
  let calls = 0; const query = new CandidateQuery(store, { loadFacts: async () => { calls++; throw Error('冻结缓存查询不应读取HTTP'); } });
  const args = { candidate_ref: origin.ref, fields: ['id', 'name', 'durationMinutes'], filter: { rating: { min: 7 } },
    collection_ref: 'collection_scope', include: [], hydrate_fields: false, limit: 1 };
  const first = await query.execute(args, binding); checkCandidateResponse(first, args); assert.deepEqual(first.data.map(row => row.id), [1]);
  await assert.rejects(query.execute({ candidate_ref: first.resultRef, cursor: first.page.nextCursor }, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const resumed = store.continuation(first.resultRef, first.page.nextCursor, binding);
  assert.equal(resumed.tool, 'refine_subject_candidates'); assert.equal(resumed.request.candidate_ref, first.candidateRef);
  assert.deepEqual(resumed.request.filter, args.filter); assert.deepEqual(resumed.request.fields, args.fields); assert.equal(resumed.request.collection_ref, args.collection_ref);
  assert.equal(resumed.request.hydrate_fields, false); assert.equal(resumed.request.limit, 1); assert.equal(resumed.request.coverage_mode, undefined);
  const second = await query.execute(resumed.request, binding); checkCandidateResponse(second, resumed.request); assert.deepEqual(second.data.map(row => row.id), [2]);
  const showOnly = store.continuationArgs(second.resultRef, second.page.nextCursor, binding, { response_view: 'reference', limit: 100 });
  const untouched = store.continuationArgs(second.candidateRef, second.page.nextCursor, binding); resumed.request.filter.rating.min = 0;
  assert.equal(untouched.filter.rating.min, 7); assert.equal(store.continuationArgs(second.resultRef, second.page.nextCursor, binding).filter.rating.min, 7);
  assert.throws(() => store.continuationArgs(first.candidateRef, first.page.nextCursor, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const final = await query.execute(showOnly, binding); checkCandidateResponse(final, showOnly);
  assert.deepEqual(final.data, []); assert.equal(final.stage.processedCount, 4); assert.equal(final.stage.excludedCount, 1);
  assert.deepEqual(store.get(final.resultRef, binding).rows.map(row => row.id), [1, 2, 4]); assert.equal(calls, 0);
});

test('宿主续查规范默认值/源subject_type，错误cursor、owner和任意条件override均在读取前拒绝', async () => {
  const store = new CandidateStore(), owned = { ...ownedBinding, scopeKey: 'account:7' };
  const origin = create(store, [{ id: 1, facts: { subjectType: 2 } }, { id: 2, facts: { subjectType: 1 } }, { id: 3, facts: { subjectType: 2 } }],
    { binding: owned, visibility: 'self', account: own.account });
  let yielding = true; const query = new CandidateQuery(store, { shouldYield: () => yielding, loadFacts: async () => { throw Error('reference不补展示字段'); } });
  const args = { candidate_ref: origin.ref, subject_type: 2, response_view: 'reference' };
  const first = await query.execute(args, owned, own);
  const restored = store.continuationArgs(first.resultRef, first.page.nextCursor, owned);
  assert.deepEqual(restored.filter, { subject_type: 2 }); assert.deepEqual(restored.fields, ['id', 'name', 'nameCn', 'subjectType']);
  assert.equal(restored.include, undefined); assert.equal(restored.limit, 50); assert.equal(restored.hydrate_fields, undefined);
  for (const wrong of [{ ...owned, accountId: 8 }, { ...owned, scopeKey: 'other' }, { ...owned, turnId: 'other' }])
    assert.throws(() => store.continuationArgs(first.resultRef, first.page.nextCursor, wrong), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.throws(() => store.continuationArgs(first.candidateRef, 'wrong', owned), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.throws(() => store.continuationArgs(origin.ref, first.page.nextCursor, owned), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.throws(() => store.continuationArgs(first.candidateRef, first.page.nextCursor, owned, { filter: {} }), error => error.code === 'INVALID_INPUT');
  yielding = false; const final = await query.execute(restored, owned, own); checkCandidateResponse(final, restored);
  assert.equal(final.stage.processedCount, 3); assert.equal(final.stage.excludedCount, 1); assert.deepEqual(store.get(final.resultRef, owned).rows.map(row => row.id), [1, 3]);
  await assert.rejects(query.execute({ candidate_ref: first.candidateRef, cursor: first.page.nextCursor, response_view: 'reference' }, owned, own),
    error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  await assert.rejects(query.execute({ candidate_ref: first.candidateRef, cursor: first.page.nextCursor, response_view: 'reference', filter: { subject_type: 1 } }, owned, own), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
});

test('cursor签名冻结收藏证据引用，不能换collection_ref悄然改变缺席证明来源', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2].map(id => ({ id, facts: {} })));
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('id视图无需读取'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], collection_ref: 'scope_one', limit: 1 };
  const first = await query.execute(args, binding);
  await assert.rejects(query.execute({ ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor, collection_ref: 'scope_two' }, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const restored = store.continuationArgs(first.candidateRef, first.page.nextCursor, binding);
  assert.equal(restored.collection_ref, 'scope_one'); const final = await query.execute(restored, binding); checkCandidateResponse(final, restored); assert.equal(final.stage.processedCount, 2);
});

test('跨阶段补字段更新评分后统一复核祖先硬条件，不输出失效资格', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: { score: 8 } }],
    { sources: [{ ...source, complete: true, scannedCount: 1, total: 1, nextOffset: null }] });
  let calls = 0;
  const query = new CandidateQuery(store, { loadFacts: async () => { calls++; return { facts: { score: 6, summary: '最新简介' } }; } });
  const qualified = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'] }, binding);
  const args = { candidate_ref: qualified.resultRef, fields: ['id', 'summary'] };
  const result = await query.execute(args, binding); checkCandidateResponse(result, args);
  assert.deepEqual(result.data, []); assert.equal(result.set.resultCount, 0); assert.equal(result.stage.excludedCount, 1);
  assert.deepEqual(store.get(result.resultRef, binding).factFilters, [{ rating: { min: 7 } }]);
  assert.equal(store.get(origin.ref, binding).rows[0].facts.score, 6); assert.equal(calls, 1);
});

test('暂时失败每次refine只尝试一次，后续明确调用可以恢复原集合证据', async () => {
  const store = new CandidateStore(), origin = create(store, [{ id: 1, facts: {} }]);
  let calls = 0;
  const query = new CandidateQuery(store, { loadFacts: async () => {
    if (++calls === 1) throw new AppError('HTTP_TIMEOUT', '暂时失败');
    return { facts: { score: 8 } };
  } });
  const first = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'] }, binding);
  assert.equal(calls, 1); assert.equal(first.stage.pendingCount, 1);
  const args = { candidate_ref: first.candidateRef, filter: { rating: { min: 7 } }, fields: ['id'] };
  const recovered = await query.execute(args, binding); checkCandidateResponse(recovered, args);
  assert.equal(calls, 2); assert.deepEqual(recovered.data, [{ id: 1 }]); assert.equal(recovered.stage.pendingCount, 0);
  assert.equal(store.get(recovered.resultRef, binding).rows[0].failureCodes.score, undefined);
});

test('10000候选字段分页沿原引用补缓存且仅保存紧凑覆盖，过期字段游标明确拒绝', async () => {
  const store = new CandidateStore({ maxRefs: 3 }), size = 10000;
  const complete = { ...source, complete: true, scannedCount: size, total: size, nextOffset: null };
  const origin = create(store, Array.from({ length: size }, (_, index) => ({ id: index + 1, facts: { name: `作品${index + 1}` } })), { sources: [complete] });
  let loads = 0;
  const query = new CandidateQuery(store, { loadFacts: async row => { loads++; return { facts: { summary: `简介${row.id}`, score: 8 } }; } });
  let args = { candidate_ref: origin.ref, fields: ['id', 'summary'], limit: 50 }, response;
  const ids = []; let oldArgs, oldCoverage;
  do {
    response = await query.execute(args, binding); checkCandidateResponse(response, args);
    assert.equal(response.candidateRef, origin.ref); assert.equal(response.resultRef, origin.ref);
    ids.push(...response.data.map(row => row.id));
    if (!oldCoverage) oldCoverage = response.coverage.coverageRef;
    if (ids.length === 50) oldArgs = { ...args, cursor: response.page.nextCursor };
    args = { ...args, cursor: response.page.nextCursor };
  } while (response.page.nextCursor);
  assert.equal(loads, size); assert.equal(new Set(ids).size, size); assert.equal(response.stage.processedCount, size);
  assert.equal(store.sets.size, 1); assert.equal(store.resultViews.size, 0); assert.equal(store.projectionWindows.size, 0);
  assert.equal(store.getCoverage(oldCoverage, binding).qualification.remainingCount, size - 50);
  assert.ok(store.bytes < 12 * 1024 * 1024, `字段分页缓存为${store.bytes}字节`);
  await assert.rejects(query.execute(oldArgs, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const projected = await query.execute({ candidate_ref: origin.ref, fields: ['id', 'summary'], response_view: 'reference' }, binding);
  assert.equal(projected.candidateRef, origin.ref); assert.equal(loads, size);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0);
});

test('4300候选附带逐项详情来源时历史覆盖共享证据，字段分页不会引用或字节耗尽', async () => {
  const size = 4300, store = new CandidateStore({ maxRefs: 3, maxBytes: 12 * 1024 * 1024 });
  const complete = { ...source, complete: true, scannedCount: size, total: size, nextOffset: null };
  const origin = create(store, Array.from({ length: size }, (_, index) => ({ id: index + 1, facts: { name: `作品${index + 1}` } })), { sources: [complete] });
  let loads = 0;
  const query = new CandidateQuery(store, { loadFacts: async row => {
    loads++;
    return { facts: { summary: `完整简介${row.id}`, score: 8 }, sources: [{ ...complete, tool: 'get_subject_details',
      scope: JSON.stringify({ subject_id: row.id }), total: 1, scannedCount: 1 }] };
  } });
  let args = { candidate_ref: origin.ref, fields: ['id', 'summary'], limit: 50 }, response;
  let firstCoverage;
  do {
    response = await query.execute(args, binding); checkCandidateResponse(response, args);
    firstCoverage ??= response.coverage.coverageRef;
    args = { ...args, cursor: response.page.nextCursor };
  } while (response.page.nextCursor);
  assert.equal(loads, size); assert.equal(response.coverage.complete, true); assert.equal(response.coverage.sourceCount, size + 1);
  assert.equal(store.sets.size, 1); assert.ok(store.bytes < 12 * 1024 * 1024);
  assert.equal(store.getCoverage(firstCoverage, binding).sources.length, 51);
  assert.equal(store.getCoverage(response.coverage.coverageRef, binding).sources.length, size + 1);
  const cached = await query.execute({ candidate_ref: origin.ref, fields: ['id', 'summary'] }, binding);
  assert.equal(cached.candidateRef, origin.ref); assert.equal(loads, size);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0); assert.equal(store.projectionSources.size, 0);
});

test('200候选逐项硬筛共享阶段引用，历史coverage不变，旧cursor过期，新filter另建阶段', async () => {
  const size = 200, store = new CandidateStore({ maxRefs: 5 });
  const complete = { ...source, complete: true, scannedCount: size, total: size, nextOffset: null };
  const origin = create(store, Array.from({ length: size }, (_, index) => ({ id: index + 1, facts: { score: index % 2 ? 8 : 6 } })), { sources: [complete] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('硬筛已有事实无需读取'); } });
  let args = { candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'], limit: 1 }, response;
  let first, firstContinuation; const ids = [];
  do {
    response = await query.execute(args, binding); checkCandidateResponse(response, args);
    if (!first) { first = response; firstContinuation = { ...args, candidate_ref: response.candidateRef, cursor: response.page.nextCursor }; }
    assert.equal(response.candidateRef, first.candidateRef); assert.equal(response.resultRef, first.resultRef);
    assert.equal(store.sets.size, 2); assert.equal(store.resultViews.size, 1);
    ids.push(...response.data.map(row => row.id)); args = { ...args, candidate_ref: response.candidateRef, cursor: response.page.nextCursor };
  } while (response.page.nextCursor);
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, index) => (index + 1) * 2));
  assert.equal(response.coverage.complete, true); assert.equal(response.stage.processedCount, size); assert.equal(response.stage.excludedCount, 100);
  assert.equal(store.get(first.resultRef, binding).rows.length, 100); assert.equal(store.get(first.candidateRef, binding).parentRef, origin.ref);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).qualification.remainingCount, size - 1);
  await assert.rejects(query.execute(firstContinuation, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const changed = await query.execute({ candidate_ref: first.resultRef, filter: { rating: { min: 9 } }, fields: ['id'] }, binding);
  assert.notEqual(changed.candidateRef, first.candidateRef); assert.equal(store.get(changed.candidateRef, binding).parentRef, first.resultRef);
  assert.equal(store.get(origin.ref, binding).rows.length, size);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0);
});

test('硬筛续页重新核对已处理前缀缓存，更新评分或新未知证据不会沿用旧matched结论', async () => {
  const store = new CandidateStore(), complete = { ...source, complete: true, scannedCount: 3, total: 3, nextOffset: null };
  const origin = create(store, [1, 2, 3].map(id => ({ id, facts: { score: 8 } })), { sources: [complete] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('本测试只核对当前缓存'); } });
  const args = { candidate_ref: origin.ref, fields: ['id'], filter: { rating: { min: 7 } }, limit: 1 };
  const first = await query.execute(args, binding);
  store.cacheFacts(origin.ref, binding, [{ id: 1, facts: { score: 6 } }]);
  const continuedArgs = store.continuationArgs(first.resultRef, first.page.nextCursor, binding, { limit: 100 });
  const last = await query.execute(continuedArgs, binding); checkCandidateResponse(last, continuedArgs);
  assert.equal(last.candidateRef, first.candidateRef); assert.equal(last.resultRef, first.resultRef);
  assert.equal(last.coverage.complete, true); assert.equal(last.stage.matchedCount, 2); assert.equal(last.stage.excludedCount, 1);
  assert.deepEqual(store.get(last.resultRef, binding).rows.map(row => row.id), [2, 3]);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).qualification.matchedCount, 1);
  const dated = create(store, [4, 5].map(id => ({ id, facts: { date: '2020-01-01' } })),
    { sources: [{ ...complete, scannedCount: 2, total: 2 }] });
  const datedArgs = { candidate_ref: dated.ref, fields: ['id'], filter: { air_date: { min: '2019-01-01' } }, limit: 1 };
  const datedFirst = await query.execute(datedArgs, binding);
  store.cacheFacts(dated.ref, binding, [{ id: 4, facts: { date: '2020' } }]);
  const datedContinuation = store.continuationArgs(datedFirst.resultRef, datedFirst.page.nextCursor, binding, { limit: 100 });
  const datedLast = await query.execute(datedContinuation, binding); checkCandidateResponse(datedLast, datedContinuation);
  assert.equal(datedLast.page.complete, true); assert.equal(datedLast.coverage.complete, false); assert.equal(datedLast.stage.pendingCount, 1);
  assert.deepEqual(store.get(datedLast.resultRef, binding).rows.map(row => row.id), [5]);
});

test('阶段替换将历史coverage成本纳入一次容量预检，拒绝后原成员与cursor保持可用', async () => {
  const options = { maxRefs: 3, maxBytes: 1024 * 1024 }, store = new CandidateStore(options);
  const complete = { ...source, complete: true, scannedCount: 3, total: 3, nextOffset: null };
  const origin = create(store, [1, 2, 3].map(id => ({ id, facts: { score: 8 } })), { sources: [complete] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('本测试只读既有事实'); } });
  const args = { candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'], limit: 1 };
  const first = await query.execute(args, binding), beforeBytes = store.bytes;
  const nextArgs = store.continuationArgs(first.resultRef, first.page.nextCursor, binding);
  options.maxBytes = beforeBytes + 128;
  await assert.rejects(query.execute(nextArgs, binding), error => error.code === 'CANDIDATE_CAPACITY');
  assert.equal(store.bytes, beforeBytes); assert.ok(store.bytes <= options.maxBytes);
  assert.deepEqual(store.get(first.resultRef, binding).rows.map(row => row.id), [1]);
  assert.deepEqual(store.continuationArgs(first.resultRef, first.page.nextCursor, binding), nextArgs);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).qualification.remainingCount, 2);
  options.maxBytes = beforeBytes + 4096;
  const next = await query.execute(nextArgs, binding); checkCandidateResponse(next, nextArgs);
  assert.equal(next.candidateRef, first.candidateRef); assert.deepEqual(store.get(first.resultRef, binding).rows.map(row => row.id), [1, 2]);
  assert.ok(store.bytes <= options.maxBytes);
});

test('继续稳定工作阶段也检查原输入新产生的NSFW权限要求，不能借已排除成员绕过', async () => {
  const store = new CandidateStore(), origin = create(store, [1, 2, 3].map(id => ({ id, facts: { score: id === 1 ? 6 : 8, nsfw: false } })),
    { sources: [{ ...source, complete: true, scannedCount: 3, total: 3, nextOffset: null }] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('只需宿主缓存'); } });
  const first = await query.execute({ candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'], limit: 1 }, binding, anonymousContext());
  assert.equal(store.get(first.candidateRef, binding).requiresNsfw, false);
  store.cacheFacts(origin.ref, binding, [{ id: 1, facts: { nsfw: true } }]);
  const continued = store.continuationArgs(first.resultRef, first.page.nextCursor, binding);
  await assert.rejects(query.execute(continued, binding, anonymousContext()), error => error.code === 'NSFW_SCOPE_CHANGED');
  assert.deepEqual(store.continuationArgs(first.resultRef, first.page.nextCursor, binding), continued);
});

test('4300缺失评分候选逐页补证并硬筛，共享历史来源且小引用与字节预算能完整完成', async () => {
  const size = 4300, store = new CandidateStore({ maxRefs: 3, maxBytes: 12 * 1024 * 1024 });
  const complete = { ...source, complete: true, scannedCount: size, total: size, nextOffset: null };
  const origin = create(store, Array.from({ length: size }, (_, index) => ({ id: index + 1, facts: { name: `作品${index + 1}` } })), { sources: [complete] });
  let loads = 0;
  const query = new CandidateQuery(store, { loadFacts: async row => {
    loads++; return { facts: { score: row.id % 2 ? 6 : 8, summary: `附带简介${row.id}` }, sources: [{ ...complete,
      tool: 'get_subject_details', scope: JSON.stringify({ subject_id: row.id }), total: 1, scannedCount: 1 }] };
  } });
  let args = { candidate_ref: origin.ref, filter: { rating: { min: 7 } }, fields: ['id'], limit: 50 }, response;
  let first; const ids = [];
  do {
    response = await query.execute(args, binding); checkCandidateResponse(response, args);
    first ??= response; assert.equal(response.candidateRef, first.candidateRef); assert.equal(response.resultRef, first.resultRef);
    ids.push(...response.data.map(row => row.id)); args = { ...args, candidate_ref: response.candidateRef, cursor: response.page.nextCursor };
  } while (response.page.nextCursor);
  assert.equal(loads, size); assert.equal(ids.length, size / 2); assert.equal(new Set(ids).size, size / 2);
  assert.equal(response.stage.processedCount, size); assert.equal(response.coverage.complete, true); assert.equal(response.coverage.sourceCount, size + 1);
  assert.equal(store.sets.size, 2); assert.equal(store.resultViews.size, 1); assert.ok(store.bytes <= 12 * 1024 * 1024);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).sources.length, 51);
  assert.equal(store.get(first.resultRef, binding).rows.length, size / 2);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0);
});

test('200个来源页稳定更新raw input及producer stage，小引用预算不随来源页数增长', async () => {
  const size = 200, store = new CandidateStore({ maxRefs: 3, maxBytes: 2 * 1024 * 1024 });
  let raw = store.create({ binding, rows: [], sources: [] }), stageRef, resultRef, firstRawCoverage, firstStageCoverage;
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('来源投影无需新读'); } });
  for (let id = 1; id <= size; id++) {
    const sources = [{ ...source, total: size, scannedCount: id, complete: id === size, nextOffset: id === size ? null : id }];
    raw = store.create({ binding, replaceRef: raw.ref, refRole: 'input', parentRef: raw.parentRef,
      rows: [...store.get(raw.ref, binding).rows, { id, facts: { name: `作品${id}` } }], sources });
    firstRawCoverage ??= raw.coverageRef;
    const args = { candidate_ref: raw.ref, fields: ['id'], limit: 1 };
    const response = await query.execute(args, binding, undefined, undefined, { stageRef, processIds: [id], preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false });
    checkCandidateResponse(response, args);
    if (id > 1) assert.equal(response.coverage.sourceChanges[0].updatedCount, 1);
    if (stageRef) { assert.equal(response.candidateRef, stageRef); assert.equal(response.resultRef, resultRef); }
    stageRef = response.candidateRef; resultRef = response.resultRef; firstStageCoverage ??= response.coverage.coverageRef;
    assert.equal(store.sets.size, 2); assert.equal(store.resultViews.size, 1);
    assert.equal(store.get(stageRef, binding).parentRef, raw.ref);
  }
  assert.equal(store.get(raw.ref, binding).rows.length, size); assert.equal(store.get(resultRef, binding).rows.length, size);
  assert.equal(store.getCoverage(firstRawCoverage, binding).sources[0].scannedCount, 1);
  assert.equal(store.getCoverage(firstStageCoverage, binding).sources[0].scannedCount, 1);
  assert.equal(store.get(stageRef, binding).sources[0].complete, true);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0);
});

test('raw input新页使旧cp及producer cc失效，字段变化另开阶段，input替换拒绝资格或self parent', async () => {
  const store = new CandidateStore({ maxRefs: 5 }), query = new CandidateQuery(store, { loadFacts: async () => { throw Error('只读来源事实'); } });
  const sources = [{ ...source, total: 4, scannedCount: 3, complete: false, nextOffset: 3 }];
  let raw = store.create({ binding, rows: [1, 2, 3].map(id => ({ id, facts: { name: `作品${id}` } })), sources });
  const args = { candidate_ref: raw.ref, fields: ['id'], limit: 1 };
  const first = await query.execute(args, binding, undefined, undefined, { processIds: [1, 2, 3], preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false });
  const projection = await query.execute(args, binding);
  const stageProjection = await query.execute({ candidate_ref: first.candidateRef, fields: ['id'], limit: 1 }, binding);
  const beforeBytes = store.bytes;
  assert.throws(() => store.create({ binding, replaceRef: raw.ref, parentRef: raw.ref, rows: raw.rows }), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => store.create({ binding, replaceRef: raw.ref, rows: raw.rows, resultIds: [] }), error => error.code === 'INVALID_RESPONSE');
  assert.equal(store.bytes, beforeBytes);
  raw = store.create({ binding, replaceRef: raw.ref, parentRef: raw.parentRef, rows: [...raw.rows, { id: 4, facts: { name: '作品4' } }],
    sources: [{ ...sources[0], scannedCount: 4, complete: true, nextOffset: null }] });
  assert.throws(() => store.continuationArgs(first.resultRef, first.page.nextCursor, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  await assert.rejects(query.execute({ ...args, cursor: projection.page.nextCursor }, binding), error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  await assert.rejects(query.execute({ candidate_ref: first.candidateRef, fields: ['id'], limit: 1, cursor: stageProjection.page.nextCursor }, binding),
    error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  const changedArgs = { candidate_ref: raw.ref, fields: ['id', 'name'], limit: 1 };
  const changed = await query.execute(changedArgs, binding, undefined, undefined, { stageRef: first.candidateRef, processIds: [4], preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false });
  assert.notEqual(changed.candidateRef, first.candidateRef); assert.equal(store.get(changed.candidateRef, binding).parentRef, raw.ref);
  assert.deepEqual(changed.data, [{ id: 4, name: '作品4' }]);
});
