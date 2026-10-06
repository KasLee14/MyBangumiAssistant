import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { RelationQuery } from '../dist/src/mcp/relation-query.js';
import { checkCandidateLineageResponse, checkRelationResponse, relationInputSchema, relationValueSchema } from '../dist/src/mcp/relation-contract.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { pageMetadata } from '../dist/src/mcp/subject-output.js';
import { compileSchema } from '../dist/src/support/tool-schema.js';
import { AppError } from '../dist/src/support/errors.js';

const binding = { turnId: 'relation-audit', accountId: null, scopeKey: 'public:sfw' };
const account = { id: 7, username: 'viewer' };
const own = { ...anonymousContext(), mode: 'account', account, source: 'p1' };
const ownedBinding = { ...binding, accountId: account.id, scopeKey: 'account:sfw' };
function source(rows, options = {}) {
  return { tool: 'search_subjects', source: 'v0', scope: JSON.stringify({ keyword: 'parent' }), complete: true,
    scannedCount: rows.length, total: rows.length, nextOffset: null, privateRecords: 'not_applicable', ...options };
}
function create(store, ids, options = {}) {
  const rows = ids.map(value => typeof value === 'number' ? { id: value, facts: { name: `父${value}`, subjectType: 2, subjectForm: 'tv', nsfw: false } } : value);
  return store.create({ binding, rows, sources: [source(rows)], ...options });
}
const child = (id, overrides = {}) => ({ id, name: `子${id}`, nameCn: '', subjectType: 2, platform: 'OVA', nsfw: false, relation: '番外篇', ...overrides });
function relationReads(graph, calls = [], options = {}) {
  return async (parentId, offset, limit, signal) => {
    signal?.throwIfAborted(); calls.push({ parentId, offset, limit });
    const all = graph.get(parentId) ?? [], data = all.slice(offset, offset + limit);
    return { data, page: pageMetadata({ total: all.length, ...options }, data.length, limit, offset),
      scope: { subject_id: parentId }, accessContext: anonymousContext() };
  };
}
const noFacts = async () => { throw Error('已有事实足够，不应额外读取'); };
async function finish(query, args, first, activeBinding = binding, context = anonymousContext()) {
  const pages = [first]; let current = first;
  while (!current.page.complete) {
    assert.ok(pages.length < 100, '测试来源有限，不能不推进游标');
    const nextArgs = { ...args, candidate_ref: current.candidateRef, cursor: current.page.nextCursor };
    current = await query.execute(nextArgs, activeBinding, context); checkRelationResponse(current, nextArgs); pages.push(current);
  }
  return { current, pages };
}

test('关系父子资格Query透传真实窗口成本规划；补事实使用已准备缓存，原条件和来源仍保留', async () => {
  const store = new CandidateStore(), input = create(store, [1]), plans = [], prepared = new Set(), loads = [];
  const signal = new AbortController().signal;
  const query = new RelationQuery(store, {
    readRelations: relationReads(new Map([[1, [child(101), child(102)]]])),
    prepareWindow: async (rows, args, actualSignal) => {
      assert.equal(actualSignal, signal); plans.push({ ids: rows.map(row => row.id), filter: structuredClone(args.filter), fields: args.fields });
      rows.forEach(row => prepared.add(row.id));
      return [{ tool: 'get_subject_details', source: 'v0', scope: JSON.stringify({ prepared_ids: rows.map(row => row.id) }),
        complete: true, scannedCount: rows.length, total: rows.length, nextOffset: null, privateRecords: 'not_applicable' }];
    },
    loadFacts: async (row, fields) => {
      assert.equal(prepared.has(row.id), true); loads.push([row.id, fields]);
      return { facts: { durationMinutes: row.id === 101 ? 3 : 24 } };
    },
  });
  const args = { candidate_ref: input.ref, filter: { duration: { max: 5 } }, fields: ['id'] };
  const result = await query.execute(args, binding, anonymousContext(), signal); checkRelationResponse(result, args);
  assert.deepEqual(plans.map(plan => plan.ids), [[1], [101, 102]]);
  assert.deepEqual(plans[1].filter, args.filter); assert.deepEqual(plans[1].fields, ['id']);
  assert.deepEqual(loads, [[101, ['durationMinutes']], [102, ['durationMinutes']]]);
  assert.deepEqual(result.data.map(row => row.id), [101]); assert.equal(result.coverage.complete, true);
  assert.equal(store.get(result.resultRef, binding).sources.some(item => item.tool === 'get_subject_details'), true);
});

test('父条件与子条件分开，形式或时长OR分支三态，批量收藏事实先排掉已看与跨媒体子项', async () => {
  const store = new CandidateStore(), calls = [], hydrated = [], linked = [];
  const rows = [
    { id: 1, facts: { subjectType: 2, subjectForm: 'tv', nsfw: false, collectionStatus: 2, collectionState: 'collected' } },
    { id: 2, facts: { subjectType: 2, subjectForm: 'ova', nsfw: false, collectionStatus: 2, collectionState: 'collected' } },
    { id: 3, facts: { subjectType: 2, subjectForm: 'tv', nsfw: false, collectionStatus: 1, collectionState: 'collected' } },
  ];
  const input = create(store, rows, { binding: ownedBinding, visibility: 'self', account });
  const graph = new Map([[1, [child(101), child(102, { subjectType: 1, platform: '小说' }), child(103),
    child(104, { platform: 'TV', durationMinutes: 5 }), child(105, { platform: 'WEB' })]]]);
  const query = new RelationQuery(store, { readRelations: relationReads(graph, calls), loadFacts: async (row, fields) => {
    hydrated.push([row.id, fields]); return { facts: { durationMinutes: null } };
  }, lookupCollection: (_ref, subjects) => {
    linked.push(subjects.map(row => row.id));
    return subjects.filter(row => row.facts.subjectType === 2).map(row => ({ id: row.id,
      facts: row.id === 103 ? { collectionState: 'collected', collectionStatus: 2 } : { collectionState: 'not_collected' },
      excludesCollectionTypes: row.id === 103 ? [] : [1, 2, 3, 4, 5] }));
  } });
  const args = { candidate_ref: input.ref, parent_filter: { subject_type: 2, subject_form: ['tv'], collection_types: [2] },
    filter: { subject_type: 2, exclude_collection_types: [2, 3, 4, 5], any_of: [{ subject_form: ['ova'] }, { duration: { max: 10 } }] },
    collection_ref: 'collection:fixture', fields: ['id', 'name', 'subjectForm'], limit: 100 };
  const result = await query.execute(args, ownedBinding, own); checkRelationResponse(result, args);
  assert.deepEqual(calls.map(call => call.parentId), [1]); assert.deepEqual(linked, [[101, 102, 103, 104, 105]]);
  assert.deepEqual(result.data.map(row => row.id), [101, 104]); assert.deepEqual(result.pending.map(row => row.id), [105]);
  assert.deepEqual(hydrated.map(([id]) => id), [105]);
  assert.equal(result.relationStage.parentMatchedCount, 1); assert.equal(result.relationStage.parentExcludedCount, 2);
  assert.equal(result.stage.inputCount, 5); assert.equal(result.stage.excludedCount, 2); assert.equal(result.stage.pendingCount, 1);
  assert.equal(result.coverage.complete, false); assert.equal(result.page.complete, true);
  assert.deepEqual(store.get(result.resultRef, ownedBinding).rows.map(row => row.id), [101, 104]);
  assert.ok(!JSON.stringify(result).includes('子102')); assert.ok(!JSON.stringify(result).includes('子103'));
});

test('完整读取每父多页关系、去重共享子ID；子分页不能把第一批当成全任务完整', async () => {
  const store = new CandidateStore(), calls = [];
  const input = create(store, [1, 2]);
  const graph = new Map([[1, Array.from({ length: 151 }, (_, i) => child(i + 1000))],
    [2, Array.from({ length: 80 }, (_, i) => child(i + 1120))]]);
  const query = new RelationQuery(store, { readRelations: relationReads(graph, calls), loadFacts: noFacts });
  const args = { candidate_ref: input.ref, fields: ['id'], filter: { subject_type: 2, subject_form: ['ova'] }, limit: 30 };
  const first = await query.execute(args, binding, anonymousContext()); checkRelationResponse(first, args);
  assert.equal(first.relationStage.childCount, 200); assert.equal(first.relationStage.relationScannedCount, 231);
  assert.equal(first.relationStage.duplicateChildCount, 31); assert.equal(first.stage.processedCount, 30);
  assert.equal(first.page.complete, false); assert.equal(first.coverage.complete, false); assert.equal(first.stage.remainingCount, 170);
  assert.equal(store.get(first.candidateRef, binding).rows.length, 200); assert.equal(store.get(first.resultRef, binding).rows.length, 30);
  const { current, pages } = await finish(query, args, first);
  assert.equal(current.coverage.complete, true); assert.equal(current.stage.matchedCount, 200);
  assert.equal(new Set(pages.flatMap(page => page.data.map(row => row.id))).size, 200); assert.equal(calls.length, 3);
  assert.deepEqual(query.lineage(current.resultRef, [1125], binding), [{ subjectId: 1125, parentCount: 2,
    parents: [{ parentId: 1, relation: '番外篇' }, { parentId: 2, relation: '番外篇' }] }]);
  assert.equal(current.coverage.mode, 'summary'); assert.equal(current.coverage.sources, undefined);
});

test('来源资源窗口续页保存父offset；未完整父不提交半张子图，不设总关系预算', async () => {
  const store = new CandidateStore(), calls = [];
  const input = create(store, [1, 2]);
  const graph = new Map([[1, Array.from({ length: 151 }, (_, i) => child(i + 1000))], [2, [child(2000)]]]);
  const query = new RelationQuery(store, { readRelations: relationReads(graph, calls), loadFacts: noFacts, concurrency: 1 });
  const args = { candidate_ref: input.ref, fields: ['id'], source_limit: 100, limit: 100 };
  const first = await query.execute(args, binding, anonymousContext()); checkRelationResponse(first, args);
  assert.equal(first.relationStage.phase, 'relations'); assert.equal(first.relationStage.childCount, 0);
  assert.equal(first.relationStage.relationScannedCount, 100); assert.equal(first.data.length, 0); assert.equal(first.coverage.complete, false);
  const { current } = await finish(query, args, first);
  assert.equal(current.stage.matchedCount, 152); assert.equal(current.coverage.complete, true);
  assert.deepEqual(calls.map(({ parentId, offset }) => [parentId, offset]), [[1, 0], [1, 100], [2, 0]]);
});

test('未知关系标签保留资格缺口，共享子有明确匹配边可通过；继续下钻只用确证结果', async () => {
  const store = new CandidateStore(), calls = [];
  const input = create(store, [1, 2]);
  const graph = new Map([[1, [child(100, { relation: null }), child(101, { relation: null }), child(102, { relation: '续集' }),
    child(103, { relation: '' }), child(104, { relation: '   ' })]],
    [2, [child(100)]], [100, [child(200)]]]);
  const query = new RelationQuery(store, { readRelations: relationReads(graph, calls), loadFacts: noFacts });
  const args = { candidate_ref: input.ref, relations: ['番外篇'], fields: ['id'], limit: 100 };
  const first = await query.execute(args, binding, anonymousContext()); checkRelationResponse(first, args);
  assert.deepEqual(first.data.map(row => row.id), [100]); assert.deepEqual(first.pending.map(row => row.id), [101, 103, 104]);
  assert.equal(first.stage.pendingCount, 3); assert.equal(first.relationStage.unknownRelationChildCount, 3);
  assert.deepEqual(store.get(first.candidateRef, binding).rows.map(row => row.id), [100, 101, 103, 104]);
  assert.deepEqual(store.get(first.resultRef, binding).rows.map(row => row.id), [100]); assert.equal(first.coverage.complete, false);
  const nextArgs = { ...args, candidate_ref: first.candidateRef };
  const second = await query.execute(nextArgs, binding, anonymousContext()); checkRelationResponse(second, nextArgs);
  assert.equal(second.relationStage.depth, 2); assert.deepEqual(second.data.map(row => row.id), [200]);
  assert.equal(calls.some(call => call.parentId === 101), false); assert.equal(second.coverage.complete, false);
  assert.deepEqual(query.lineage(second.resultRef, [200], binding)[0].parents, [{ parentId: 100, relation: '番外篇' }]);
});

test('父工作集继承资格条件，待核父不发关系请求且全任务覆盖保持缺口', async () => {
  const store = new CandidateStore(), calls = [];
  const input = create(store, [{ id: 1, facts: { subjectType: 2, subjectForm: 'tv', nsfw: false } },
    { id: 2, facts: { subjectType: 2, subjectForm: null, nsfw: false } }]);
  const qualify = new CandidateQuery(store, { loadFacts: async () => ({ facts: { subjectForm: null } }) });
  const parents = await qualify.execute({ candidate_ref: input.ref, filter: { subject_form: ['tv'] }, fields: ['id'], response_view: 'reference' }, binding);
  assert.equal(parents.stage.pendingCount, 1);
  const query = new RelationQuery(store, { readRelations: relationReads(new Map([[1, [child(100)]]]), calls), loadFacts: noFacts });
  const args = { candidate_ref: parents.candidateRef, fields: ['id'] };
  const result = await query.execute(args, binding, anonymousContext()); checkRelationResponse(result, args);
  assert.deepEqual(calls.map(call => call.parentId), [1]); assert.deepEqual(result.data.map(row => row.id), [100]);
  assert.equal(result.relationStage.parentPendingCount, 1); assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.unknownFieldCount, 0); assert.equal(result.coverage.failedFieldCount, 0);
  assert.equal(result.coverage.dependencyPendingCount, 1, '父资格缺口须独立保存，不能混成展示字段缺失或重复计算');
  const derived = await new CandidateQuery(store, { loadFacts: noFacts }).execute({ candidate_ref: result.resultRef, fields: ['id'], response_view: 'reference' }, binding);
  assert.equal(derived.coverage.complete, false); assert.equal(derived.coverage.dependencyPendingCount, 1);
  const coverage = new CandidateQuery(store, { loadFacts: noFacts }).readCoverage({ coverage_ref: derived.coverage.coverageRef }, binding);
  assert.equal(coverage.dependencies.some(dependency => dependency.kind === 'qualification' && dependency.pendingCount === 1), true);
  const fromResultArgs = { ...args, candidate_ref: parents.resultRef };
  const fromResult = await query.execute(fromResultArgs, binding, anonymousContext()); checkRelationResponse(fromResult, fromResultArgs);
  assert.equal(fromResult.relationStage.parentPendingCount, 1);
  assert.equal(fromResult.coverage.complete, false, '结果引用不能遗忘原父阶段尚有资格未知条目');
});

test('reference模式扫描全部子而返回计数与引用；后续refine可分页展示全结果并回溯', async () => {
  const store = new CandidateStore(), input = create(store, [1]);
  const query = new RelationQuery(store, { readRelations: relationReads(new Map([[1, Array.from({ length: 250 }, (_, i) => child(i + 100))]])), loadFacts: noFacts });
  const args = { candidate_ref: input.ref, response_view: 'reference', fields: ['id'], limit: 20 };
  const result = await query.execute(args, binding, anonymousContext()); checkRelationResponse(result, args);
  assert.deepEqual(result.data, []); assert.deepEqual(result.pending, []); assert.deepEqual(result.lineage, []);
  assert.equal(result.stage.matchedCount, 250); assert.equal(result.page.complete, true); assert.equal(result.coverage.complete, true);
  assert.equal(store.get(result.resultRef, binding).rows.length, 250);
  const show = await new CandidateQuery(store, { loadFacts: noFacts }).execute({ candidate_ref: result.resultRef, fields: ['id'], limit: 20 }, binding);
  assert.equal(show.data.length, 20); assert.equal(query.lineage(show.candidateRef, show.data.map(row => row.id), binding).length, 20);
  assert.equal(JSON.stringify(result).length < 10000, true);
});

test('并发只限制在途来源读取；父失败保留缺口并继续其他父，不把失败作为空关系', async () => {
  const store = new CandidateStore(), input = create(store, [1, 2, 3, 4, 5]);
  let active = 0, maximum = 0; const completed = [];
  const query = new RelationQuery(store, { concurrency: 3, loadFacts: noFacts, readRelations: async (parentId, offset, limit, signal) => {
    active++; maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5)); signal?.throwIfAborted();
      if (parentId === 2) throw new AppError('READ_FAILED', '此父资料暂不可读');
      completed.push(parentId); return relationReads(new Map([[parentId, [child(parentId + 100)]]]))(parentId, offset, limit, signal);
    } finally { active--; }
  } });
  const args = { candidate_ref: input.ref, fields: ['id'], limit: 100 };
  const result = await query.execute(args, binding, anonymousContext()); checkRelationResponse(result, args);
  assert.equal(maximum, 3); assert.equal(active, 0); assert.equal(completed.length, 4);
  assert.equal(result.relationStage.failedParentCount, 1); assert.equal(result.relationStage.relationSourceComplete, false);
  assert.equal(result.coverage.complete, false); assert.equal(result.data.length, 4);
});

test('关系页缺记录与错误父scope原子拒绝为来源缺口，账号/NSFW变化为整个阶段fatal', async () => {
  const store = new CandidateStore(), input = create(store, [1]);
  for (const mutate of [value => { value.page.total = 2; }, value => { value.scope.subject_id = 999; }]) {
    const query = new RelationQuery(store, { loadFacts: noFacts, readRelations: async (parentId, offset, limit, signal) => {
      const value = await relationReads(new Map([[1, [child(100)]]]))(parentId, offset, limit, signal); mutate(value); return value;
    } });
    const args = { candidate_ref: input.ref, fields: ['id'] };
    const result = await query.execute(args, binding, anonymousContext()); checkRelationResponse(result, args);
    assert.equal(result.relationStage.failedParentCount, 1); assert.equal(result.data.length, 0); assert.equal(result.coverage.complete, false);
  }
  const restricted = new RelationQuery(store, { loadFacts: noFacts, readRelations: relationReads(new Map([[1, [child(100, { nsfw: true, name: '受限名称' })]]])) });
  await assert.rejects(restricted.execute({ candidate_ref: input.ref, fields: ['id', 'name'] }, binding, anonymousContext()), error => error.code === 'NSFW_SCOPE_CHANGED');
  const accountChanged = new RelationQuery(store, { loadFacts: noFacts, readRelations: async (parentId, offset, limit) => {
    const value = await relationReads(new Map([[1, [child(100)]]]))(parentId, offset, limit);
    value.accessContext = { ...own, account: { id: 99, username: 'other' } }; return value;
  } });
  await assert.rejects(accountChanged.execute({ candidate_ref: input.ref, fields: ['id'] }, binding, anonymousContext()), error => error.code === 'ACCOUNT_CHANGED');
});

test('关系游标冻结条件和账户/轮次；同阶段引用稳定推进且旧覆盖保持原进度', async () => {
  const store = new CandidateStore(), input = create(store, [1]);
  const query = new RelationQuery(store, { concurrency: 1, loadFacts: noFacts,
    readRelations: relationReads(new Map([[1, Array.from({ length: 3 }, (_, i) => child(i + 100))]])) });
  const args = { candidate_ref: input.ref, fields: ['id'], source_limit: 1, limit: 1 };
  const first = await query.execute(args, binding, anonymousContext());
  await assert.rejects(query.execute({ ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor, relations: ['续集'] }, binding),
    error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  await assert.rejects(query.execute({ ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor }, { ...binding, turnId: 'different' }),
    error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const oldCoverage = first.coverage.coverageRef;
  const { current } = await finish(query, args, first);
  assert.equal(current.candidateRef, first.candidateRef); assert.equal(current.resultRef, first.resultRef);
  assert.deepEqual(store.get(first.candidateRef, binding).rows.map(row => row.id), [100, 101, 102]);
  assert.equal(store.getCoverage(oldCoverage, binding).qualification.processedCount, 0);
  await assert.rejects(query.execute({ ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor }, binding),
    error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.equal(query.lineage(current.resultRef, [100, 101, 102], binding).length, 3);
});

test('关系契约拒绝父子混用参数、标签重叠与无效OR分支，并校验虚假的完整声明', async () => {
  assert.equal(compileSchema(relationInputSchema)({ candidate_ref: 'c', subject_type: 2 }), false);
  assert.equal(compileSchema(relationInputSchema)({ candidate_ref: 'c', parent_filter: { subject_form: ['tv'] },
    filter: { any_of: [{ subject_form: ['ova'] }, { duration: { max: 10 } }] } }), true);
  assert.equal(compileSchema(relationInputSchema)({ candidate_ref: 'c', filter: { any_of: [{ any_of: [{ duration: { max: 10 } }] }] } }), false);
  const store = new CandidateStore(), input = create(store, [1]);
  const query = new RelationQuery(store, { loadFacts: noFacts, readRelations: relationReads(new Map([[1, [child(100)]]])) });
  await assert.rejects(query.execute({ candidate_ref: input.ref, relations: ['番外篇'], exclude_relations: ['番外篇'] }, binding), error => error.code === 'INVALID_INPUT');
  const args = { candidate_ref: input.ref, source_limit: 1, fields: ['id'] };
  const result = await query.execute(args, binding, anonymousContext()); assert.equal(compileSchema(relationValueSchema())(result), true);
  const fake = structuredClone(result); fake.relationStage.parentQualificationComplete = false; fake.coverage.complete = true;
  assert.throws(() => checkRelationResponse(fake, args), error => error.code === 'MCP_INVALID_RESULT');
  const extra = structuredClone(result); extra.data[0].summary = '未请求的展示字段';
  assert.throws(() => checkRelationResponse(extra, args), error => error.code === 'MCP_INVALID_RESULT');
  const wrongFilter = structuredClone(result); wrongFilter.filter = { subject_type: 1 };
  assert.throws(() => checkRelationResponse(wrongFilter, args), error => error.code === 'MCP_INVALID_RESULT');
  const wrongView = structuredClone(result); wrongView.responseView = 'reference';
  assert.throws(() => checkRelationResponse(wrongView, args), error => error.code === 'MCP_INVALID_RESULT');
});

test('按需回溯支持结果与派生引用、ID成员校验和独立分页，父名称复用已读事实', async () => {
  const store = new CandidateStore(), input = create(store, [1, 2]), calls = [];
  const query = new RelationQuery(store, { loadFacts: noFacts,
    readRelations: relationReads(new Map([[1, [child(100), child(101), child(102)]], [2, [child(101)]]]), calls) });
  const result = await query.execute({ candidate_ref: input.ref, fields: ['id'], response_view: 'reference' }, binding, anonymousContext());
  const args = { candidate_ref: result.resultRef, subject_ids: [101, 100], limit: 1 };
  const first = query.readLineage(args, binding, anonymousContext()); checkCandidateLineageResponse(first, args);
  assert.equal(first.page.complete, false); assert.equal(first.page.nextOffset, 1); assert.equal(first.page.totalCount, 2);
  assert.deepEqual(first.data[0].parents.map(parent => [parent.parentId, parent.name, parent.url]),
    [[1, '父1', 'https://bgm.tv/subject/1'], [2, '父2', 'https://bgm.tv/subject/2']]);
  const nextArgs = { ...args, offset: first.page.nextOffset };
  const second = query.readLineage(nextArgs, binding, anonymousContext()); checkCandidateLineageResponse(second, nextArgs);
  assert.equal(second.page.complete, true); assert.deepEqual(second.data.map(row => row.subjectId), [100]);
  assert.equal(calls.length, 2);
  const derived = await new CandidateQuery(store, { loadFacts: noFacts }).execute({ candidate_ref: result.resultRef, filter: { subject_ids: [101] }, fields: ['id'], limit: 100 }, binding);
  const derivedArgs = { candidate_ref: derived.resultRef };
  const lineage = query.readLineage(derivedArgs, binding, anonymousContext()); checkCandidateLineageResponse(lineage, derivedArgs);
  assert.equal(lineage.data.length, 1);
  assert.throws(() => query.readLineage({ candidate_ref: result.resultRef, subject_ids: [999] }, binding), error => error.code === 'CANDIDATE_ID_MISMATCH');
  assert.throws(() => query.readLineage({ candidate_ref: input.ref }, binding), error => error.code === 'CANDIDATE_LINEAGE_UNAVAILABLE');
  const fake = structuredClone(first); fake.data[0].parents[0].url = 'https://bgm.tv/subject/999';
  assert.throws(() => checkCandidateLineageResponse(fake, args), error => error.code === 'MCP_INVALID_RESULT');
});

test('受保护父权限在空子结果仍传承，回溯与覆盖不能因筛空结果绕过当前NSFW权限', async () => {
  const store = new CandidateStore();
  const permitted = { ...own, nsfw: { preference: true, allowed: true, state: 'enabled' }, nsfwApplied: true };
  const input = create(store, [{ id: 1, facts: { name: '受保护父名称', subjectType: 2, subjectForm: 'tv', nsfw: true } }],
    { binding: ownedBinding, visibility: 'self', account, requiresNsfw: true });
  const query = new RelationQuery(store, { loadFacts: noFacts, readRelations: relationReads(new Map()) });
  const result = await query.execute({ candidate_ref: input.ref, fields: ['id'] }, ownedBinding, permitted);
  assert.equal(result.set.resultCount, 0); assert.equal(store.get(result.candidateRef, ownedBinding).requiresNsfw, true);
  assert.equal(store.get(result.resultRef, ownedBinding).requiresNsfw, true);
  const denied = { ...permitted, nsfw: { preference: false, allowed: false, state: 'disabled' }, nsfwApplied: false };
  await assert.rejects(query.execute({ candidate_ref: result.resultRef, fields: ['id'] }, ownedBinding, denied), error => error.code === 'NSFW_SCOPE_CHANGED');
  assert.throws(() => query.readLineage({ candidate_ref: result.resultRef }, ownedBinding, denied), error => error.code === 'NSFW_SCOPE_CHANGED');
  assert.throws(() => query.readLineage({ candidate_ref: result.resultRef }, ownedBinding, { ...permitted, account: { id: 99, username: 'other' } }),
    error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
});

test('父核实期限和关系读取期限都保留准确阶段，下一窗口继续而不重读已完成父', async () => {
  const store = new CandidateStore(), calls = []; let yieldNow = false, stopRelations = true;
  const input = create(store, [1, 2, 3].map(id => ({ id, facts: { subjectType: 2, subjectForm: null, nsfw: false } })));
  const reads = relationReads(new Map([1, 2, 3].map(id => [id, [child(id + 100)]])), calls);
  const query = new RelationQuery(store, { concurrency: 1, shouldYield: () => yieldNow,
    loadFacts: async row => { if (row.id === 1) yieldNow = true; return { facts: { subjectForm: 'tv' } }; },
    readRelations: async (...args) => { const value = await reads(...args); if (stopRelations) { yieldNow = true; stopRelations = false; } return value; },
  });
  const args = { candidate_ref: input.ref, parent_filter: { subject_form: ['tv'] }, fields: ['id'], response_view: 'reference' };
  const first = await query.execute(args, binding, anonymousContext()); checkRelationResponse(first, args);
  assert.equal(first.relationStage.phase, 'parents'); assert.equal(first.relationStage.parentProcessedCount, 1);
  assert.equal(first.relationStage.parentRemainingCount, 2); assert.equal(calls.length, 0);
  yieldNow = false;
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  const second = await query.execute(nextArgs, binding, anonymousContext()); checkRelationResponse(second, nextArgs);
  assert.equal(second.relationStage.phase, 'relations'); assert.equal(second.relationStage.relationParentsProcessedCount, 1);
  assert.equal(second.relationStage.childCount, 1); assert.equal(calls.length, 1);
  yieldNow = false;
  const lastArgs = { ...args, candidate_ref: second.candidateRef, cursor: second.page.nextCursor };
  const last = await query.execute(lastArgs, binding, anonymousContext()); checkRelationResponse(last, lastArgs);
  assert.equal(last.page.complete, true); assert.equal(last.coverage.complete, true); assert.equal(last.stage.matchedCount, 3);
  assert.deepEqual(calls.map(call => call.parentId), [1, 2, 3]);
});

test('关联来源超过一万条仍按原父游标读取末项，reference不把候选总量当预算', async () => {
  const total = 10001, store = new CandidateStore(), calls = [], input = create(store, [1]);
  const query = new RelationQuery(store, { concurrency: 1, loadFacts: noFacts,
    readRelations: relationReads(new Map([[1, Array.from({ length: total }, (_, i) => child(i + 100))]]), calls) });
  const args = { candidate_ref: input.ref, fields: ['id'], response_view: 'reference', source_limit: 10000 };
  const first = await query.execute(args, binding, anonymousContext()); checkRelationResponse(first, args);
  assert.equal(first.relationStage.relationScannedCount, 10000); assert.equal(first.relationStage.childCount, 0);
  assert.equal(first.page.complete, false);
  const nextArgs = { ...args, candidate_ref: first.candidateRef, cursor: first.page.nextCursor };
  const last = await query.execute(nextArgs, binding, anonymousContext()); checkRelationResponse(last, nextArgs);
  assert.equal(last.stage.matchedCount, total); assert.equal(last.set.resultCount, total); assert.equal(last.coverage.complete, true);
  assert.equal(store.get(last.resultRef, binding).rows.some(row => row.id === total + 99), true);
  assert.equal(calls.at(-1).offset, 10000); assert.equal(calls.length, 101); assert.deepEqual(last.data, []);
});

test('fields按需补资料并复用缓存，reference仅处理事实条件', async () => {
  const store = new CandidateStore(), input = create(store, [1]), calls = [];
  const query = new RelationQuery(store, { readRelations: relationReads(new Map([[1, [child(100)]]])),
    loadFacts: async (_row, fields, include) => {
      calls.push({ fields, include });
      return { facts: { ...(fields.includes('score') ? { score: 8 } : {}), ...(fields.includes('summary') ? { summary: '明确证据' } : {}) } };
    },
  });
  const args = { candidate_ref: input.ref, fields: ['id', 'name', 'summary'], response_view: 'reference' };
  const view = await query.execute(args, binding, anonymousContext()); checkRelationResponse(view, args);
  assert.deepEqual(calls, []); assert.deepEqual(view.data, []);
  const proofArgs = { ...args, response_view: 'page', filter: { rating: { min: 7 } } };
  const proof = await query.execute(proofArgs, binding, anonymousContext()); checkRelationResponse(proof, proofArgs);
  assert.deepEqual(calls.map(call => call.fields), [['score'], ['summary']]);
  assert.equal(proof.data[0].summary, '明确证据'); assert.equal(proof.stage.matchedCount, 1);
  const repeated = await new CandidateQuery(store, { loadFacts: noFacts }).execute({ candidate_ref: proof.resultRef, fields: ['id', 'summary'] }, binding);
  assert.equal(repeated.data[0].summary, '明确证据');
  assert.deepEqual(calls.map(call => call.fields), [['score'], ['summary']]);
});
