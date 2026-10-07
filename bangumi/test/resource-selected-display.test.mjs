import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { candidatePresentationSet } from '../dist/src/mcp/candidate-presentation.js';
import { expandResourceContent } from '../dist/src/output/resource-content.js';

const turn = { turnId: 'selected-candidate-cards' };
const chosen = [23, 1, 6, 17, 3, 10];
const filter = { subject_type: 2, rating: { min: 8 }, tag: ['百合'], exclude_collection_types: [2, 3, 4, 5] };
const seed = id => ({ id, facts: { name: `作品${id}`, subjectType: 2, score: 8.5, tags: ['百合'], nsfw: false,
  ...(id >= 24 && id <= 51 ? { collectionState: 'collected', collectionStatus: 2 } : { collectionState: 'not_collected' }),
  image: `https://example.invalid/${id}.jpg` } });
function fixture(t, mutateSeed = value => value, options = {}) {
  let current = { ...anonymousContext(), mode: 'account', source: 'p1', account: { id: 42, username: 'reader' },
    ...(options.nsfw ? { nsfwApplied: true, nsfw: { state: 'enabled', preference: true, allowed: true } } : {}) };
  let apiReads = 0;
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(current),
    public: async () => { apiReads++; throw Error('展示不能新增公共API读取'); },
    account: async () => { apiReads++; throw Error('展示不能新增账户API读取'); } });
  t.after(() => service.close());
  service.currentViewer = structuredClone(current);
  const binding = { ...turn, accountId: 42, scopeKey: 'account:42' };
  const matchedIds = Array.from({ length: 23 }, (_, index) => index + 1);
  const remainingIds = Array.from({ length: 17 }, (_, index) => index + 52);
  const set = service.candidates.create({ binding, rows: Array.from({ length: 68 }, (_, index) => mutateSeed(seed(index + 1))),
    visibility: 'self', account: current.account, refRole: 'working', resultIds: matchedIds, factFilters: [filter],
    qualification: { inputCount: 68, processedCount: 51, matchedCount: 23, excludedCount: 28, pendingCount: 0, remainingCount: 17,
      filter, originRef: 'fixture-origin', matchedIds, pendingIds: [], remainingIds, complete: false } });
  const result = service.candidates.get(set.resultRef, binding);
  const page = { kind: 'candidate_page', entity: 'subject_candidate', candidateRef: set.ref, resultRef: set.resultRef,
    data: result.rows.map(row => ({ ...row.facts, fieldStates: row.fieldStates })), accessContext: structuredClone(current) };
  const ref = service.resources.put('refine_subject_candidates', page, {}, turn.turnId, current);
  const resolver = (resourceRef, signal, selection) => service.readCachedResource(resourceRef, turn, signal, selection);
  return { service, binding, result, page, ref, resolver, access: () => current,
    setAccess: value => { current = value; }, apiReads: () => apiReads };
}
const cardProps = ref => ({ resourceRef: ref, layout: 'grid', items: chosen.map(id => ({ id })) });

test('68候选已处理51、已通过23、剩余17时，显式6部卡片保持原顺序和封面且不新增API读取', async t => {
  const f = fixture(t);
  const seen = [];
  const cards = await expandResourceContent('SubjectCards', cardProps(f.ref), async (ref, signal, selection) => {
    seen.push(selection); return f.resolver(ref, signal, selection);
  });
  assert.deepEqual(seen, [{ subjectIds: chosen }]);
  assert.equal(cards.pending, false); assert.equal(cards.props.layout, 'grid');
  assert.deepEqual(cards.props.items.map(item => item.id), chosen);
  assert.deepEqual(cards.props.items.map(item => item.image), chosen.map(id => `https://example.invalid/${id}.jpg`));
  assert.ok(cards.props.items.every(item => item.kind === 'anime' && item.name && item.score >= 8));
  assert.equal(f.apiReads(), 0);
  assert.equal(f.service.candidates.get(f.result.ref, f.binding).qualification.remainingCount, 17);
  assert.equal(f.service.resources.get(f.ref, turn.turnId).value.data.length, 23);
});

test('同一未完成引用不带明确成员或传空成员时，仍不能展示完整候选集合', async t => {
  const f = fixture(t);
  for (const items of [undefined, []]) {
    await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: f.ref, ...(items ? { items } : {}) }, f.resolver), error => {
      assert.equal(error.reason, 'resource_reference_stage_incomplete');
      assert.equal(error.cause.code, 'CANDIDATE_STAGE_INCOMPLETE');
      assert.equal(error.sourceTool, 'refine_subject_candidates'); return true;
    });
  }
});

test('id、id+entity、subjectId三种明确成员键都可按原候选窗口展示', async t => {
  const f = fixture(t);
  for (const items of [[{ id: 1 }], [{ id: 1, entity: 'subject' }], [{ subjectId: 1 }]]) {
    const cards = await expandResourceContent('SubjectCards', { resourceRef: f.ref, items }, f.resolver);
    assert.equal(cards.props.items[0].image, 'https://example.invalid/1.jpg');
    const table = await expandResourceContent('DataTable', { resourceRef: f.ref, items, fields: ['name', 'score'] }, f.resolver);
    assert.deepEqual(table.props.rows, [{ name: '作品1', score: '8.5' }]);
  }
});

test('只能选择原缓存成员窗口中的已通过结果，工作集成员、别页成员和重复成员均拒绝', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.readCachedResource(f.ref, turn, undefined, { subjectIds: [52] }), { code: 'CANDIDATE_ID_MISMATCH' });
  assert.throws(() => candidatePresentationSet(f.service.candidates, f.result.ref, f.binding, f.access(), 'selected', [52]), { code: 'CANDIDATE_ID_MISMATCH' });
  const window = f.service.resources.put('refine_subject_candidates', { ...f.page, data: f.page.data.slice(0, 3) }, {}, turn.turnId, f.access());
  await assert.rejects(f.service.readCachedResource(window, turn, undefined, { subjectIds: [6] }), { code: 'CANDIDATE_ID_MISMATCH' });
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: f.ref, items: [{ id: 1 }, { id: 1 }] }, f.resolver), { reason: 'resource_reference_invalid' });
});

for (const missing of ['score', 'tags', 'collectionState']) test(`所选作品的${missing}未知时仍拒绝，不能把缺少条件或个人收藏证据当作符合`, async t => {
  const f = fixture(t, value => {
    if (value.id === 1) { delete value.facts[missing]; value.fieldStates = { [missing]: 'unknown' }; }
    return value;
  });
  await assert.rejects(f.service.readCachedResource(f.ref, turn, undefined, { subjectIds: [1] }), { code: 'CANDIDATE_REQUIRED_FACTS_MISSING' });
});

test('事实明确不符合原条件时不能因为ID已在结果引用里而跳过筛选复核', async t => {
  const f = fixture(t, value => { if (value.id === 1) value.facts.score = 7; return value; });
  await assert.rejects(f.service.readCachedResource(f.ref, turn, undefined, { subjectIds: [1] }), { code: 'CANDIDATE_STAGE_INCOMPLETE' });
});

test('所选作品的名称或媒体类型缺少已核事实时，不输出猜测的卡片', async t => {
  for (const missing of ['name', 'subjectType']) {
    const f = fixture(t, value => { if (value.id === 1) { delete value.facts[missing]; value.fieldStates = { [missing]: 'unknown' }; } return value; });
    await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: f.ref, items: [{ id: 1 }] }, f.resolver), error => {
      assert.equal(error.reason, 'resource_reference_stage_incomplete');
      assert.equal(error.cause.code, 'CANDIDATE_REQUIRED_FACTS_MISSING'); return true;
    });
  }
});

test('选中作品事实更新后旧页版本仍拒绝，恢复分类为事实刷新', async t => {
  const f = fixture(t);
  f.service.candidates.cacheFacts(f.result.ref, f.binding, [{ id: 1, facts: { score: 9 } }]);
  await assert.rejects(expandResourceContent('SubjectCards', cardProps(f.ref), f.resolver), error => {
    assert.equal(error.reason, 'resource_reference_refresh_required');
    assert.equal(error.cause.code, 'RESOURCE_VERSION_CHANGED'); return true;
  });
});

test('账户、NSFW权限及轮次边界不能用显式成员绕过', async t => {
  const account = fixture(t);
  account.setAccess({ ...account.access(), account: { id: 43, username: 'other' } });
  await assert.rejects(expandResourceContent('SubjectCards', cardProps(account.ref), account.resolver), error => {
    assert.equal(error.reason, 'resource_reference_access_denied'); assert.equal(error.cause.code, 'ACCOUNT_CHANGED'); return true;
  });
  const nsfw = fixture(t, undefined, { nsfw: true });
  nsfw.setAccess({ ...nsfw.access(), nsfw: { state: 'disabled', allowed: false, preference: false } });
  await assert.rejects(nsfw.service.readCachedResource(nsfw.ref, turn, undefined, { subjectIds: [1] }), { code: 'NSFW_SCOPE_CHANGED' });
  const otherTurn = fixture(t);
  await assert.rejects(otherTurn.service.readCachedResource(otherTurn.ref, { turnId: 'other-turn' }, undefined, { subjectIds: [1] }), { code: 'RESOURCE_SCOPE_MISMATCH' });
});

test('准备的presentation快照不接受selection绕过整集合完成校验', async t => {
  const f = fixture(t);
  const ref = f.service.resources.put('prepare_candidate_output', { kind: 'candidate_output', candidateRef: f.result.ref,
    presentation: { content: [{ type: 'SubjectCards', pending: false, props: { layout: 'grid', items: [{ id: 1, name: '作品1', kind: 'anime' }] } }] } }, {}, turn.turnId, f.access());
  await assert.rejects(f.service.readCachedResource(ref, turn, undefined, { subjectIds: [1] }), { code: 'CANDIDATE_STAGE_INCOMPLETE' });
});

test('准备快照保留其exhaustive或selected完成范围，显式成员不能覆盖原来的全量边界', async t => {
  const f = fixture(t);
  const set = f.service.candidates.create({ binding: f.binding, rows: [seed(1)], visibility: 'self', account: f.access().account,
    refRole: 'working', resultIds: [1], sources: [{ tool: 'search_subjects', source: 'v0', scope: '{}', complete: false,
      scannedCount: 1, total: 2, nextOffset: 1, privateRecords: 'not_applicable' }] });
  const value = { kind: 'candidate_output', candidateRef: set.resultRef, presentation: { content: [
    { type: 'SubjectCards', pending: false, props: { layout: 'grid', items: [{ id: 1, name: '作品1', kind: 'anime' }] } },
  ] } };
  const exhaustive = f.service.resources.put('prepare_candidate_output', { ...value, scope: { completion_scope: 'exhaustive' } }, {}, turn.turnId, f.access());
  const selected = f.service.resources.put('prepare_candidate_output', { ...value, scope: { completion_scope: 'selected' } }, {}, turn.turnId, f.access());
  await assert.rejects(f.service.readCachedResource(exhaustive, turn, undefined, { subjectIds: [1] }), { code: 'CANDIDATE_STAGE_INCOMPLETE' });
  assert.equal((await f.service.readCachedResource(selected, turn)).value.candidateRef, set.resultRef);
});

test('candidate_continuation固定result包装沿原引用和成员规则展开，仍保留6张封面', async t => {
  const f = fixture(t);
  const ref = f.service.resources.put('continue_subject_query', { kind: 'candidate_continuation', tool: 'refine_subject_candidates', result: f.page }, {}, turn.turnId, f.access());
  const cards = await expandResourceContent('SubjectCards', cardProps(ref), f.resolver);
  assert.deepEqual(cards.props.items.map(item => item.id), chosen);
  assert.ok(cards.props.items.every(item => item.image));
  await assert.rejects(f.service.readCachedResource(ref, turn), { code: 'CANDIDATE_STAGE_INCOMPLETE' });
});
