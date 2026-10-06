import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore, candidateRow, candidateSourceRef, mergeCandidateSources } from '../dist/src/mcp/candidate-store.js';

const binding = { turnId: 'turn', accountId: null, scopeKey: 'public:sfw' };
const source = { tool: 'search_subjects', source: 'v0', scope: '{}', complete: false, scannedCount: 2, total: 1, nextOffset: 2, privateRecords: 'not_applicable' };
const create = (store, rows, extra = {}) => store.create({ binding, rows, sources: [source], ...extra });

test('ID去重、更新事实、祖先成员不变，已取且未展示事实跨阶段复用', () => {
  const store = new CandidateStore(); const initial = create(store, [{ id: 1, facts: { score: 7 } }]);
  const next = store.merge(initial.ref, binding, [{ id: 1, facts: { score: 8, summary: '简介' } }, { id: 2, facts: { name: '新作品' } }]);
  assert.equal(next.duplicateCount, 1); assert.deepEqual(next.changedIds, [1, 2]); assert.deepEqual(store.get(initial.ref, binding).rows.map(row => row.id), [1]);
  assert.equal(store.get(initial.ref, binding).rows[0].facts.summary, '简介'); assert.equal(store.get(initial.ref, binding).rows[0].facts.score, 8);
  next.rows[0].facts.score = 1; assert.equal(store.get(next.ref, binding).rows[0].facts.score, 8);
});

test('未知/失败不能覆盖已核实事实，未知、未读取和失败分别保存', () => {
  const store = new CandidateStore(); const first = create(store, [{ id: 1, facts: { score: 8, summary: null }, fieldStates: { name: 'failed' }, failureCodes: { name: 'HTTP_ERROR' } }]);
  const next = store.merge(first.ref, binding, [{ id: 1, facts: { score: null } }]); const row = next.rows[0];
  assert.equal(row.fieldStates.score, 'known'); assert.equal(row.fieldStates.summary, 'unknown'); assert.equal(row.fieldStates.name, 'failed'); assert.equal(row.fieldStates.infobox, undefined);
  assert.equal(row.failureCodes.name, 'HTTP_ERROR'); assert.equal(row.facts.score, 8);
});

test('读取轮次、权限范围和个人账户引用隔离，可public升级账户', () => {
  const store = new CandidateStore(); const publicSet = create(store, [{ id: 1, facts: {} }]);
  assert.equal(store.get(publicSet.ref, { ...binding, accountId: 7 }).rows.length, 1);
  assert.throws(() => store.get(publicSet.ref, { ...binding, turnId: 'other' }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.throws(() => store.get(publicSet.ref, { ...binding, scopeKey: 'account:nsfw' }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const privateSet = create(store, [{ id: 2, facts: { collectionState: 'collected', collectionStatus: 2 } }], { binding: { ...binding, accountId: 7 }, visibility: 'self', account: { id: 7, username: 'tester' } });
  assert.throws(() => store.get(privateSet.ref, binding), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.throws(() => store.get(privateSet.ref, { ...binding, accountId: 8 }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.equal(store.peekBinding(privateSet.ref, binding.turnId).binding.accountId, 7);
});

test('公开第三方收藏事实须有对应来源范围；个人事实不能落无账户任意源', () => {
  const store = new CandidateStore();
  assert.throws(() => create(store, [{ id: 1, facts: { personalRating: 8 } }]), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const set = create(store, [{ id: 2, facts: { personalRating: 8 } }], { sources: [{ ...source, tool: 'get_user_collections', scope: JSON.stringify({ username: 'alice' }), privateRecords: 'public_only' }] });
  assert.equal(set.rows[0].facts.personalRating, 8);
  assert.throws(() => store.merge(set.ref, binding, [{ id: 2, facts: { personalRating: 1 } }], [{ ...source, tool: 'query_user_collections',
    scope: JSON.stringify({ username: 'bob' }), privateRecords: 'public_only' }]), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
});

test('写入失效清空账户集合，轮次结束和close释放引用；容量拒绝不会截断', () => {
  const store = new CandidateStore({ maxRefs: 3 }); const publicSet = create(store, [{ id: 1, facts: {} }]);
  const ownSet = create(store, [{ id: 2, facts: {} }], { binding: { ...binding, accountId: 7 } });
  store.invalidateAccount(7); assert.throws(() => store.get(ownSet.ref, { ...binding, accountId: 7 }), error => error.code === 'CANDIDATE_REF_EXPIRED');
  const other = create(store, [{ id: 3, facts: {} }], { binding: { ...binding, turnId: 'other' } });
  store.endReadContext('turn'); assert.throws(() => store.get(publicSet.ref, binding), error => error.code === 'CANDIDATE_REF_EXPIRED');
  assert.equal(store.get(other.ref, { ...binding, turnId: 'other' }).rows[0].id, 3); store.close();
  assert.throws(() => store.get(other.ref, { ...binding, turnId: 'other' }), error => error.code === 'CANDIDATE_REF_EXPIRED');
  const tiny = new CandidateStore({ maxRefs: 1 }); const saved = create(tiny, [{ id: 4, facts: {} }]);
  assert.throws(() => create(tiny, [{ id: 5, facts: {} }]), error => error.code === 'CANDIDATE_CAPACITY'); assert.equal(tiny.get(saved.ref, binding).rows.length, 1);
});

test('非法字段或对象身份拒绝，估算总数小于实际窗口不等同契约失效', () => {
  const store = new CandidateStore(); assert.equal(create(store, [{ id: 1, facts: {} }]).sources[0].total, 1);
  for (const seed of [{ id: 0, facts: {} }, { id: 1, facts: { id: 2 } }, { id: 1, facts: { leaked: true } }, { id: 1, facts: { score: 11 } },
    { id: 1, facts: { durationMinutes: -1 } }, { id: 1, facts: { durationMinutes: 'short' } },
    { id: 1, facts: { summary: null }, fieldStates: { summary: 'known' } }])
    assert.throws(() => candidateRow(seed), error => error.code === 'INVALID_RESPONSE');
});

test('sourceRef跨参数顺序/同来源继续分页稳定，内部完整scope与source flags仍保留', () => {
  const first = { ...source, scope: JSON.stringify({ keyword: '搞笑', filter: { type: [2], tag: ['漫画改'] } }) };
  const second = { ...source, scope: JSON.stringify({ filter: { tag: ['漫画改'], type: [2] }, keyword: '搞笑' }), scannedCount: 4, nextOffset: 4 };
  assert.equal(candidateSourceRef(first), candidateSourceRef(second));
  assert.deepEqual(mergeCandidateSources([first], [second]), [second]);
  assert.notEqual(candidateSourceRef(first), candidateSourceRef({ ...first, privateRecords: 'included' }));
  assert.notEqual(candidateSourceRef(first), candidateSourceRef({ ...first, source: 'p1' }));
});

test('同source空尾按host revision保留关闭游标，缓存旧行来源和旧cov不能回盖最新窗口', () => {
  const state = { revision: 1, firstOffset: 0, pagesRead: 1, continuous: true, totalKind: 'estimated', excludedNsfwCount: 0, unknownNsfwCount: 0 };
  const firstSource = { ...source, scannedCount: 20, total: 20, nextOffset: 20, readState: state };
  const closed = { ...firstSource, nextOffset: null, readState: { ...state, revision: 2, pagesRead: 2 } };
  assert.equal(candidateSourceRef(firstSource), candidateSourceRef(closed));
  assert.deepEqual(mergeCandidateSources([firstSource], [closed], [firstSource]), [closed]);
  const store = new CandidateStore(), first = create(store, [{ id: 1, facts: { nsfw: false }, sources: [firstSource] }], { sources: [firstSource] });
  const last = store.merge(first.ref, binding, [], [closed]);
  assert.equal(last.sources.length, 1); assert.equal(last.sources[0].nextOffset, null); assert.equal(last.sources[0].complete, false);
  assert.equal(store.getCoverage(first.coverageRef, binding).sources[0].nextOffset, 20);
  const legacyClosed = { ...source, nextOffset: null, complete: false };
  const legacy = mergeCandidateSources([source], [legacyClosed], [source]);
  assert.equal(legacy[0].nextOffset, null); assert.equal(legacy[0].complete, false, 'legacy闭窗不等于来源从0完整');
  const proven = { ...legacyClosed, complete: true };
  assert.deepEqual(mergeCandidateSources([source], [proven], [legacyClosed], [source]), [proven], 'producer明确完整证明不会被旧partial回盖');
});

test('新独立完整读取revision胜过旧多页行来源，累计日期ID不受单页100上限且snapshot不可变', () => {
  const old = { ...source, tool: 'get_user_collections', scope: JSON.stringify({ username: 'alice', subject_type: 2 }), scannedCount: 2, total: 2, nextOffset: null,
    readState: { revision: 1, firstOffset: 0, pagesRead: 2, continuous: true, totalKind: 'exact', excludedNsfwCount: 1, unknownNsfwCount: 0 } };
  const fresh = { ...old, complete: true, readState: { ...old.readState, revision: 2, pagesRead: 1, excludedNsfwCount: 0 } };
  assert.deepEqual(mergeCandidateSources([fresh], [old]), [fresh]);
  const ids = Array.from({ length: 201 }, (_, i) => i + 1);
  const uncertain = { ...source, tool: 'browse_subjects', scope: JSON.stringify({ subject_type: 2, year: 2026, month: 10 }), scannedCount: 201, total: 201, nextOffset: null,
    readState: { revision: 3, firstOffset: 0, pagesRead: 3, continuous: true, totalKind: 'unknown', excludedNsfwCount: 0, unknownNsfwCount: 0,
      filterCoverage: { scope: 'source_sequence', scannedCount: 201, matchedCount: 0, unknownDateCount: 201, unknownDateSubjectIds: ids, complete: false } } };
  const store = new CandidateStore(), set = create(store, [], { sources: [uncertain] });
  uncertain.readState.filterCoverage.unknownDateSubjectIds.pop();
  assert.equal(store.getCoverage(set.coverageRef, binding).sources[0].readState.filterCoverage.unknownDateSubjectIds.length, 201);
  for (const patch of [{ firstOffset: 1 }, { continuous: false }, { totalKind: 'unknown' }, { unknownNsfwCount: 1 }, { excludedNsfwCount: 1 }, { revision: Infinity }])
    assert.throws(() => mergeCandidateSources([{ ...fresh, readState: { ...fresh.readState, ...patch } }]), error => error.code === 'INVALID_RESPONSE');
});

test('coverage与result轻量引用同样账户隔离、成员不可变，并随任务结束或账户写入失效', () => {
  const store = new CandidateStore(), ownBinding = { ...binding, accountId: 7, scopeKey: 'account:7' };
  const first = create(store, [{ id: 1, facts: { nsfw: false }, requiresNsfw: true }, { id: 2, facts: {} }], {
    binding: ownBinding, visibility: 'self', account: { id: 7, username: 'tester' }, refRole: 'working', resultIds: [1],
  });
  assert.deepEqual(store.get(first.resultRef, ownBinding).rows.map(row => row.id), [1]);
  assert.equal(store.peekCoverageBinding(first.coverageRef, 'turn').requiresNsfw, true);
  assert.equal(store.peekBinding(first.resultRef, 'turn').binding.accountId, 7);
  for (const wrong of [{ ...ownBinding, accountId: 8 }, { ...ownBinding, scopeKey: 'different' }, { ...ownBinding, turnId: 'different' }]) {
    assert.throws(() => store.get(first.resultRef, wrong), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
    assert.throws(() => store.getCoverage(first.coverageRef, wrong), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  }
  const originalScope = store.getCoverage(first.coverageRef, ownBinding).sources;
  store.merge(first.ref, ownBinding, [{ id: 3, facts: {} }], [{ ...source, scope: JSON.stringify({ keyword: '新来源' }) }]);
  assert.deepEqual(store.get(first.resultRef, ownBinding).rows.map(row => row.id), [1]); assert.deepEqual(store.getCoverage(first.coverageRef, ownBinding).sources, originalScope);
  store.invalidateAccount(7);
  assert.throws(() => store.get(first.resultRef, ownBinding), error => error.code === 'CANDIDATE_REF_EXPIRED');
  assert.throws(() => store.getCoverage(first.coverageRef, ownBinding), error => error.code === 'CANDIDATE_REF_EXPIRED');
  const next = create(store, [{ id: 4, facts: {} }], { resultIds: [4] }); store.endReadContext('turn');
  assert.throws(() => store.get(next.resultRef, binding), error => error.code === 'CANDIDATE_REF_EXPIRED');
  assert.throws(() => store.getCoverage(next.coverageRef, binding), error => error.code === 'CANDIDATE_REF_EXPIRED');
});

test('公事实迁移只允许同轮次明确SFW与v0作品证据，不带其它账户或用户记录', () => {
  const store = new CandidateStore(); const v0 = { ...source, tool: 'get_subject_details', scope: JSON.stringify({ subject_id: 1 }) };
  create(store, [{ id: 1, facts: { nsfw: false, score: 8, summary: '公共资料', personalRating: 10, personalTags: ['个人标签'], personalComment: '个人短评', collectionStatus: 2, collectionState: 'collected' },
    excludesCollectionTypes: [3], resolvedFields: ['score', 'personalRating', 'personalComment'] }], { binding: { ...binding, accountId: 7 }, visibility: 'self', account: { id: 7, username: 'one' }, sources: [v0] });
  const safe = store.publicFacts(1, 'turn'); assert.equal(safe.facts.summary, '公共资料'); assert.equal(safe.facts.personalRating, undefined);
  assert.equal(safe.facts.personalTags, undefined); assert.equal(safe.facts.personalComment, undefined); assert.equal(safe.facts.collectionState, undefined);
  assert.equal(safe.fieldStates.personalRating, undefined); assert.equal(safe.resolvedFields.includes('personalRating'), false); assert.equal(safe.excludesCollectionTypes, undefined);
  assert.deepEqual(safe.sources, [v0]); assert.equal(store.publicFacts(1, 'other-turn'), undefined);
  const copied = create(store, [{ id: 1, facts: {} }], { binding: { ...binding, accountId: 8, scopeKey: 'account:8' } });
  assert.equal(copied.rows[0].facts.score, 8); assert.equal(copied.rows[0].facts.personalRating, undefined); assert.equal(copied.rows[0].facts.collectionStatus, undefined);
  for (const [id, nsfw, origin] of [[2, true, v0], [3, null, v0], [4, false, { ...v0, source: 'p1' }], [5, false, { ...v0, tool: 'get_user_collections', scope: JSON.stringify({ username: 'alice' }), privateRecords: 'public_only' }]]) {
    create(store, [{ id, facts: { nsfw, score: 9 } }], { binding: { ...binding, accountId: 7 }, sources: [origin] });
    assert.equal(store.publicFacts(id, 'turn'), undefined);
  }
});

test('含R18关系的宿主权限标记在派生和缓存中保留，SFW父作品也不能公共迁移', () => {
  const store = new CandidateStore(); const first = create(store, [{ id: 1, facts: { nsfw: false, score: 8 }, requiresNsfw: true }]);
  const second = store.merge(first.ref, binding, [{ id: 1, facts: {}, requiresNsfw: false }]);
  assert.equal(second.rows[0].requiresNsfw, true); assert.equal(store.get(first.ref, binding).rows[0].requiresNsfw, true);
  assert.equal(store.publicFacts(1, 'turn'), undefined);
  const rebuilt = create(store, [{ id: 1, facts: {} }]); assert.equal(rebuilt.rows[0].requiresNsfw, true);
});

test('账户已有部分收藏事实时也能补公共缓存缺口，不覆盖已核实个人评分', () => {
  const store = new CandidateStore(); const owner = { ...binding, accountId: 7, scopeKey: 'account:7' };
  create(store, [{ id: 1, facts: { score: null, personalRating: 9, collectionState: 'collected', collectionStatus: 2 } }],
    { binding: owner, visibility: 'self', account: { id: 7, username: 'one' }, sources: [{ ...source, tool: 'get_user_collections', source: 'p1',
      privateRecords: 'included', scope: JSON.stringify({ username: '-' }) }] });
  create(store, [{ id: 1, facts: { nsfw: false, score: 8, summary: '公共简介' } }]);
  const rebuilt = create(store, [{ id: 1, facts: {} }], { binding: owner });
  assert.equal(rebuilt.rows[0].facts.score, 8); assert.equal(rebuilt.rows[0].facts.summary, '公共简介');
  assert.equal(rebuilt.rows[0].facts.personalRating, 9); assert.equal(rebuilt.rows[0].facts.collectionStatus, 2);
  store.endReadContext('turn'); assert.equal(store.publicFacts(1, 'turn'), undefined);
});

test('快照只保存成员与元数据，共享唯一事实/来源仍保持返回副本、来源历史和真实容量计账', () => {
  const store = new CandidateStore({ maxBytes: 1024 * 1024, maxRefs: 128 }), evidence = { ...source, scope: JSON.stringify({ keyword: '长范围'.repeat(200) }) };
  const seeds = Array.from({ length: 300 }, (_, index) => ({ id: index + 1, facts: { name: `作品${index + 1}` }, sources: [evidence] }));
  const initial = create(store, seeds, { sources: [evidence] }); let current = initial;
  for (let index = 0; index < 40; index++) current = store.create({ binding, parentRef: current.ref, rows: seeds, sources: [evidence] });
  const view = store.get(initial.ref, binding); view.rows.length = 0; view.sources[0].scope = '{}';
  assert.equal(store.get(initial.ref, binding).rows.length, 300); assert.equal(store.getCoverage(initial.coverageRef, binding).sources[0].scope, evidence.scope);
  assert.ok(store.bytes < 1024 * 1024);
  store.endReadContext('turn'); assert.equal(store.bytes, 0); assert.equal(store.sourceSnapshots.size, 0); assert.equal(store.factCache.size, 0);
});

const detailSource = { tool: 'get_subject_details', source: 'v0', scope: JSON.stringify({ subject_id: 1 }),
  complete: true, scannedCount: 1, total: 1, nextOffset: null, privateRecords: 'not_applicable' };

test('新资源已知基础值同步现有事实且不创建引用，未知不覆盖known，不存在的ID不创建缓存', () => {
  const store = new CandidateStore(), initial = create(store, [{ id: 1, facts: { nsfw: false, score: 8, summary: '版本8' } }]);
  const refs = store.sets.size + store.resultViews.size;
  store.cacheResourceFacts(binding, { id: 1, facts: { nsfw: false, score: 6, summary: '版本6' }, sources: [detailSource] });
  assert.equal(store.get(initial.ref, binding).rows[0].facts.score, 6);
  assert.equal(store.get(initial.ref, binding).rows[0].facts.summary, '版本6');
  assert.equal(store.sets.size + store.resultViews.size, refs);
  assert.deepEqual(store.getCoverage(initial.coverageRef, binding).sources, [source], '资源事实更新不篡改旧来源覆盖');
  store.cacheResourceFacts(binding, { id: 1, facts: { nsfw: false, score: null, summary: null }, sources: [detailSource] });
  assert.equal(store.get(initial.ref, binding).rows[0].facts.score, 6);
  assert.equal(store.get(initial.ref, binding).rows[0].facts.summary, '版本6');
  const before = store.bytes;
  store.cacheResourceFacts(binding, { id: 2, facts: { nsfw: false, score: 9 }, sources: [{ ...detailSource, scope: JSON.stringify({ subject_id: 2 }) }] });
  assert.equal(store.bytes, before); assert.equal(store.factCache.size, 1);
  store.endReadContext(binding.turnId); assert.equal(store.bytes, 0); assert.equal(store.factIndex.size, 0);
});

test('v0/SFW新资源只跨当前turn已知SFW域同步公共基础字段，个人与保护域保留原值', () => {
  const store = new CandidateStore(), owner = { ...binding, accountId: 7 }, otherOwner = { ...binding, accountId: 8 };
  const original = create(store, [{ id: 1, facts: { nsfw: false, score: 8 } }]);
  const own = create(store, [{ id: 1, facts: { nsfw: false, score: 8, personalRating: 9 }, excludesCollectionTypes: [2] }],
    { binding: owner, visibility: 'self', account: { id: 7, username: 'owner' } });
  const other = create(store, [{ id: 1, facts: { nsfw: false, score: 8, personalRating: 4 }, excludesCollectionTypes: [4] }],
    { binding: otherOwner, visibility: 'self', account: { id: 8, username: 'other' } });
  const protectedBinding = { ...owner, scopeKey: 'account:nsfw' };
  const protectedSet = create(store, [{ id: 1, facts: { nsfw: false, score: 10, summary: '受保护资料' }, requiresNsfw: true }], { binding: protectedBinding });
  const otherTurnBinding = { ...binding, turnId: 'other-turn' };
  const otherTurn = create(store, [{ id: 1, facts: { nsfw: false, score: 9 } }], { binding: otherTurnBinding });
  store.cacheResourceFacts(owner, { id: 1, facts: { nsfw: false, score: 6, summary: '公开新资料', personalRating: 10, relations: [] },
    resolvedFields: ['summary', 'personalRating', 'relations'], excludesCollectionTypes: [3], sources: [detailSource] });
  assert.equal(store.get(original.ref, binding).rows[0].facts.score, 6);
  assert.equal(store.get(original.ref, binding).rows[0].facts.personalRating, undefined);
  assert.equal(store.get(original.ref, binding).rows[0].facts.relations, undefined);
  assert.equal(store.get(own.ref, owner).rows[0].facts.personalRating, 10);
  const otherRow = store.get(other.ref, otherOwner).rows[0];
  assert.equal(otherRow.facts.score, 6); assert.equal(otherRow.facts.summary, '公开新资料'); assert.equal(otherRow.facts.personalRating, 4);
  assert.equal(otherRow.facts.relations, undefined); assert.deepEqual(otherRow.excludesCollectionTypes, [4]);
  assert.equal(otherRow.resolvedFields.includes('personalRating'), false); assert.equal(otherRow.resolvedFields.includes('relations'), false);
  assert.equal(store.get(protectedSet.ref, protectedBinding).rows[0].facts.score, 10);
  assert.equal(store.get(protectedSet.ref, protectedBinding).rows[0].facts.summary, '受保护资料');
  assert.equal(store.get(otherTurn.ref, otherTurnBinding).rows[0].facts.score, 9);
  store.cacheResourceFacts(owner, { id: 1, facts: { nsfw: false, score: 7, summary: '账户来源' },
    sources: [{ ...detailSource, source: 'p1', privateRecords: 'included' }] });
  assert.equal(store.get(own.ref, owner).rows[0].facts.score, 7); assert.equal(store.get(other.ref, otherOwner).rows[0].facts.score, 6);
  store.close(); assert.equal(store.bytes, 0);
});

test('新资源跨域同步先做总容量预检，拒绝或非法seed不会部分更新事实', () => {
  const options = { maxBytes: 1024 * 1024 }, store = new CandidateStore(options), otherBinding = { ...binding, scopeKey: 'public:other' };
  const first = create(store, [{ id: 1, facts: { nsfw: false, score: 8 } }]);
  const second = create(store, [{ id: 1, facts: { nsfw: false, score: 8 } }], { binding: otherBinding });
  const before = store.bytes; options.maxBytes = before + 128;
  assert.throws(() => store.cacheResourceFacts(binding, { id: 1, facts: { nsfw: false, score: 6, summary: '新资料'.repeat(1000) }, sources: [detailSource] }),
    error => error.code === 'CANDIDATE_CAPACITY');
  assert.equal(store.bytes, before); assert.ok(store.bytes <= options.maxBytes);
  assert.equal(store.get(first.ref, binding).rows[0].facts.score, 8); assert.equal(store.get(second.ref, otherBinding).rows[0].facts.score, 8);
  assert.throws(() => store.cacheResourceFacts(binding, { id: 1, facts: { score: 11 }, sources: [detailSource] }), error => error.code === 'INVALID_RESPONSE');
  assert.equal(store.bytes, before); assert.equal(store.get(first.ref, binding).rows[0].facts.score, 8);
});
