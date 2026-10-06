import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionReader, matchCollectionCheapFields } from '../dist/src/mcp/collection-reader.js';
import { collectionPage } from '../dist/src/mcp/subject-output.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';

const account = { id: 42, username: 'fixture_user' };
const binding = { readContextId: 'turn:collection-funnel', accountId: 42, source: 'p1' };
const scope = { username: '-', subject_type: 2 };
const rawRow = (id, extra = {}) => ({ subject_id: id, type: 2, rate: 0, tags: [], private: false,
  subject: { id, type: 2, name: `作品${id}`, name_cn: '', date: null, nsfw: false, platform: null,
    rating: { score: 7.2, total: 80 }, tags: [], meta_tags: [] }, ...extra });
function fixture(rows, options = {}) {
  const calls = [];
  const readPage = async (offset, limit) => {
    calls.push({ offset, limit });
    const args = { ...(options.scope ?? scope), offset, limit };
    const raw = { data: rows.slice(offset, offset + limit), total: rows.length, limit, offset,
      ...(args.username === '-' ? { account } : {}) };
    const value = collectionPage(raw, args);
    if (options.comments) value.data.forEach((row, index) => { row.personalComment = raw.data[index].comment ?? null; });
    return options.page ? options.page(value, offset) : value;
  };
  return { readPage, calls };
}

test('收藏漏斗仅把个人字段筛过的ID交给后续补字段，原始大集合留在宿主', async () => {
  const rows = Array.from({ length: 1200 }, (_, i) => rawRow(i + 1, { rate: i === 1100 ? 9 : 4, tags: i === 1100 ? ['搞笑', '轻松'] : ['其他'] }));
  const f = fixture(rows); const reader = new CollectionReader();
  const value = await reader.read({ ...scope, source_limit: 1200, filter: { personal_rating: { min: 8 }, personal_tags: ['搞笑'] } }, binding, f.readPage);
  assert.deepEqual(value.rows.map(row => row.subjectId), [1101]);
  assert.equal(value.unknownRows.length, 0); assert.equal(value.coverage.rejectedCount, 1199);
  assert.equal(value.coverage.scannedCount, 1200); assert.equal(value.coverage.sourceComplete, true);
  assert.equal(value.coverage.filterComplete, true); assert.equal(f.calls.length, 12);
  const detailReads = [];
  for (const row of value.rows) detailReads.push(row.subjectId);
  assert.deepEqual(detailReads, [1101]);
  assert.equal(reader.snapshot(value.collectionRef, binding).rows.length, 1200);
  assert.equal(reader.lookup(value.collectionRef, [1], binding)[0].personalFacts.personalRating, 4);
  assert.ok(JSON.stringify({ rows: value.rows, coverage: value.coverage }).length < 1500);
  assert.equal(value.rows[0].subject.date, null, '没有日期条件时未知日期不影响匹配或完整性');
});

test('来源预算和结果分页分离，空匹配页照常续读且固定100条来源窗口', async () => {
  const rows = Array.from({ length: 260 }, (_, i) => rawRow(i + 1, { rate: i === 259 ? 9 : 1 }));
  const f = fixture(rows); const reader = new CollectionReader();
  const args = { ...scope, source_limit: 150, filter: { personal_rating: { min: 9 } } };
  const first = await reader.read(args, binding, f.readPage);
  assert.equal(first.rows.length, 0); assert.equal(first.coverage.scannedCount, 200);
  assert.equal(first.coverage.sourceNextOffset, 200); assert.equal(first.coverage.sourceExhausted, false);
  assert.equal(first.coverage.sourceComplete, false); assert.equal(first.coverage.stopReason, 'source_budget');
  assert.deepEqual(f.calls, [{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }]);
  const last = await reader.read({ ...args, collection_ref: first.collectionRef }, binding, f.readPage);
  assert.deepEqual(last.rows.map(row => row.subjectId), [260]); assert.equal(last.collectionRef, first.collectionRef);
  assert.equal(last.coverage.sourceNextOffset, null); assert.equal(last.coverage.sourceComplete, true);
  assert.equal(last.coverage.scannedCount, 260); assert.equal(last.coverage.collectionTotal, 260);
  assert.deepEqual(f.calls.at(-1), { offset: 200, limit: 100 });
  await reader.read({ ...args, collection_ref: last.collectionRef }, binding, f.readPage);
  assert.equal(f.calls.length, 3, '来源耗尽后复用快照不再请求');
});

test('运行时间窗口只在完整来源页后让出，保存精确续页并在下一调用完成', async () => {
  const rows = Array.from({ length: 260 }, (_, i) => rawRow(i + 1, { rate: i === 259 ? 9 : 1 }));
  const f = fixture(rows), reader = new CollectionReader();
  const args = { ...scope, source_limit: 1000, filter: { personal_rating: { min: 9 } } };
  const first = await reader.read(args, binding, f.readPage, undefined, () => f.calls.length >= 1);
  assert.deepEqual(first.rows, []); assert.deepEqual(first.unknownRows, []);
  assert.equal(first.coverage.stopReason, 'work_budget'); assert.equal(first.coverage.scannedCount, 100);
  assert.equal(first.coverage.pagesRead, 1); assert.equal(first.coverage.collectionTotal, 260);
  assert.equal(first.coverage.sourceNextOffset, 100); assert.equal(first.coverage.sourceExhausted, false);
  assert.equal(first.coverage.sourceComplete, false); assert.equal(first.coverage.filterComplete, false);
  assert.equal(first.coverage.unknownFilterCount, 0); assert.equal(first.coverage.rejectedCount, 100);
  assert.deepEqual(f.calls, [{ offset: 0, limit: 100 }]);
  assert.equal(reader.lookup(first.collectionRef, [260], binding)[0].membership, 'unknown');
  const last = await reader.read({ ...args, collection_ref: first.collectionRef }, binding, f.readPage, undefined, () => false);
  assert.equal(last.collectionRef, first.collectionRef); assert.equal(last.coverage.stopReason, 'exhausted');
  assert.equal(last.coverage.sourceComplete, true); assert.equal(last.coverage.sourceNextOffset, null);
  assert.equal(last.coverage.scannedCount, 260); assert.equal(last.coverage.pagesRead, 3);
  assert.deepEqual(last.rows.map(row => row.subjectId), [260]);
  assert.deepEqual(f.calls, [{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }, { offset: 200, limit: 100 }]);
});

test('首次来源页开始前让出也保留可用引用，不请求来源且可继续原始offset0', async () => {
  const f = fixture([rawRow(1)]), reader = new CollectionReader();
  const first = await reader.read(scope, binding, f.readPage, undefined, () => true);
  assert.equal(first.coverage.stopReason, 'work_budget'); assert.equal(first.coverage.pagesRead, 0);
  assert.equal(first.coverage.collectionTotal, null, '尚未读取来源不能把总数声明为实际0');
  assert.equal(first.coverage.scannedCount, 0); assert.equal(first.coverage.sourceNextOffset, 0);
  assert.equal(first.coverage.sourceComplete, false); assert.equal(first.coverage.sourceExhausted, false);
  assert.deepEqual(first.unknownRows, []); assert.equal(f.calls.length, 0);
  const continued = await reader.read({ ...scope, collection_ref: first.collectionRef }, binding, f.readPage);
  assert.deepEqual(continued.rows.map(row => row.subjectId), [1]); assert.equal(continued.coverage.sourceComplete, true);
  assert.equal(continued.coverage.collectionTotal, 1);
  assert.deepEqual(f.calls, [{ offset: 0, limit: 100 }]);
});

test('完整来源快照可换个人条件重新筛选，前一阶段不会丢弃原始行', async () => {
  const f = fixture([rawRow(1, { rate: 10 }), rawRow(2, { rate: 2 }), rawRow(3, { rate: 0 })]);
  const reader = new CollectionReader();
  const first = await reader.read({ ...scope, filter: { personal_rating: { min: 8 } } }, binding, f.readPage);
  const second = await reader.read({ ...scope, collection_ref: first.collectionRef, filter: { personal_rating: { max: 2 } } }, binding, f.readPage);
  assert.deepEqual(first.rows.map(row => row.subjectId), [1]);
  assert.deepEqual(second.rows.map(row => row.subjectId), [2, 3]); assert.equal(f.calls.length, 1);
});

test('个人字段未知不当作不符合；未评分0保留原值而不是偏好结论', async () => {
  const f = fixture([rawRow(1, { rate: undefined }), rawRow(2, { rate: 0 }), rawRow(3, { rate: 9 })]);
  const reader = new CollectionReader();
  const value = await reader.read({ ...scope, filter: { personal_rating: { min: 8 } } }, binding, f.readPage);
  assert.deepEqual(value.rows.map(row => row.subjectId), [3]);
  assert.deepEqual(value.unknownRows.map(row => row.subjectId), [1]);
  assert.equal(value.coverage.rejectedCount, 1); assert.equal(value.coverage.sourceComplete, true);
  assert.equal(value.coverage.filterComplete, false);
  const base = reader.snapshot(value.collectionRef, binding).rows[1];
  assert.equal(base.personalRating, 0);
  assert.equal(matchCollectionCheapFields(base, { personal_rating: { min: 0, max: 0 } }), 'matched');
  const unknownTags = { ...base, personalTags: null };
  assert.equal(matchCollectionCheapFields(unknownTags, { personal_tags: ['搞笑'] }), 'unknown');
  assert.equal(matchCollectionCheapFields(unknownTags, { collection_types: [3], personal_tags: ['搞笑'] }), 'rejected');
});

test('个人标签精确AND匹配；状态包含与排除先于其他字段', async () => {
  const rows = [rawRow(1, { type: 2, tags: ['搞笑', '轻松'] }), rawRow(2, { type: 3, tags: ['搞笑'] }), rawRow(3, { type: 1, tags: ['搞笑', '轻松'] })];
  const f = fixture(rows); const reader = new CollectionReader();
  const value = await reader.read({ ...scope, filter: { personal_tags: ['搞笑', '轻松'], collection_types: [1, 2], exclude_collection_types: [1] } }, binding, f.readPage);
  assert.deepEqual(value.rows.map(row => row.subjectId), [1]);
  assert.equal(value.coverage.rejectedCount, 2); assert.deepEqual(value.coverage.collectionTypes, [1, 2, 3, 4, 5]);
});

test('部分收藏、完整单状态与完整本人全状态的缺席证明不同', async () => {
  const reader = new CollectionReader(); const rows = Array.from({ length: 101 }, (_, i) => rawRow(i + 1));
  const f = fixture(rows);
  const first = await reader.read(scope, binding, f.readPage);
  assert.equal(reader.lookup(first.collectionRef, [101, 999], binding)[0].membership, 'unknown');
  assert.deepEqual(reader.lookup(first.collectionRef, [999], binding)[0].excludesCollectionTypes, []);
  const last = await reader.read({ ...scope, collection_ref: first.collectionRef }, binding, f.readPage);
  const absent = reader.lookup(last.collectionRef, [999], binding)[0];
  assert.equal(absent.membership, 'not_collected'); assert.equal(absent.personalFacts.collectionState, 'not_collected');
  assert.deepEqual(absent.excludesCollectionTypes, [1, 2, 3, 4, 5]);
  const watchedScope = { ...scope, collection_type: 2 }; const onlyWatched = fixture([rawRow(1)], { scope: watchedScope });
  const watched = await reader.read(watchedScope, binding, onlyWatched.readPage);
  const other = reader.lookup(watched.collectionRef, [999], binding)[0];
  assert.equal(other.membership, 'not_in_scope'); assert.equal(other.personalFacts.collectionState, 'unknown');
  assert.equal(other.fieldStates.collectionState, 'unknown'); assert.deepEqual(other.excludesCollectionTypes, [2]);
});

test('第三方公开全状态缺席不能证明未收藏，私密范围不得混入公开快照', async () => {
  const publicScope = { username: 'public_user', subject_type: 2 };
  const publicBinding = { ...binding, accountId: null, source: 'v0' };
  const reader = new CollectionReader(); const f = fixture([rawRow(1)], { scope: publicScope });
  const value = await reader.read(publicScope, publicBinding, f.readPage);
  const lookup = reader.lookup(value.collectionRef, [999], publicBinding)[0];
  assert.equal(lookup.membership, 'not_in_scope'); assert.equal(lookup.privateRecords, 'public_only');
  assert.equal(lookup.personalFacts.collectionState, 'unknown'); assert.equal(value.coverage.sourceComplete, true);
  for (const privateValue of [true, null]) {
    const privatePage = fixture([rawRow(1, { private: privateValue })], { scope: publicScope });
    await assert.rejects(reader.read(publicScope, publicBinding, privatePage.readPage), error => error.code === 'PRIVATE_SCOPE');
  }
  await assert.rejects(reader.read(publicScope, binding, f.readPage), error => error.code === 'INVALID_INPUT');
});

test('被NSFW筛空的来源页继续推进且缺席保持未知', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => rawRow(i + 1));
  const reader = new CollectionReader();
  const f = fixture(rows, { page: (value, offset) => {
    if (offset !== 0) return value;
    return { ...value, data: [], page: { ...value.page, returnedCount: 0, complete: false,
      sourceNextOffset: 100, sourceHasMore: true, excludedNsfwCount: 100, unknownNsfwCount: 0 } };
  } });
  const first = await reader.read(scope, binding, f.readPage);
  assert.equal(first.rows.length, 0); assert.equal(first.coverage.sourceNextOffset, 100);
  const last = await reader.read({ ...scope, collection_ref: first.collectionRef }, binding, f.readPage);
  assert.deepEqual(last.rows.map(row => row.subjectId), [101]); assert.equal(last.coverage.sourceExhausted, true);
  assert.equal(last.coverage.sourceComplete, false); assert.equal(last.coverage.excludedNsfwCount, 100);
  assert.equal(reader.lookup(last.collectionRef, [1], binding)[0].membership, 'unknown');
  assert.equal(reader.lookup(last.collectionRef, [101], binding)[0].membership, 'collected');
});

test('来源异常页原子拒绝：重复、跨页重复、总数漂移、残缺窗口和异状态', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => rawRow(i + 1));
  for (const page of [value => ({ ...value, data: [...value.data.slice(1), value.data[1]] }),
    value => ({ ...value, scope: { ...value.scope, username: 'another_user' } }),
    (value, offset) => offset ? { ...value, data: [value.data[0], { ...value.data[0], subjectId: 1, subject: { ...value.data[0].subject, id: 1 } }] } : value,
    (value, offset) => offset ? { ...value, page: { ...value.page, total: 102 } } : value,
    value => ({ ...value, data: value.data.slice(1) }),
    value => ({ ...value, data: value.data.map((row, i) => i ? row : { ...row, subjectId: 999 }) })]) {
    const reader = new CollectionReader(); const f = fixture(rows, { page });
    await assert.rejects(reader.read({ ...scope, source_limit: 200 }, binding, f.readPage), error => ['INCOMPLETE_DATA', 'INVALID_RESPONSE'].includes(error.code));
  }
  const reader = new CollectionReader(); const f = fixture([rawRow(1)], { scope: { ...scope, collection_type: 2 },
    page: value => ({ ...value, data: value.data.map(row => ({ ...row, collectionStatus: 3 })) }) });
  await assert.rejects(reader.read({ ...scope, collection_type: 2 }, binding, f.readPage), error => error.code === 'INCOMPLETE_DATA');
});

test('引用绑定轮次账户来源及读取scope，写后失效、结束清理且peek不暴露记录', async () => {
  const reader = new CollectionReader(); const f = fixture([rawRow(1, { private: true })]);
  const value = await reader.read(scope, binding, f.readPage);
  assert.deepEqual(reader.peek(value.collectionRef, binding.readContextId), { binding, scope });
  assert.throws(() => reader.lookup(value.collectionRef, [1], { ...binding, accountId: 99 }), error => error.code === 'COLLECTION_REF_INVALID');
  assert.throws(() => reader.snapshot(value.collectionRef, { ...binding, source: 'v0' }), error => error.code === 'COLLECTION_REF_INVALID');
  assert.throws(() => reader.peek(value.collectionRef, 'another-turn'), error => error.code === 'COLLECTION_REF_INVALID');
  await assert.rejects(reader.read({ ...scope, collection_type: 2, collection_ref: value.collectionRef }, binding, f.readPage), error => error.code === 'COLLECTION_REF_SCOPE_MISMATCH');
  reader.invalidateAccount(42);
  assert.throws(() => reader.snapshot(value.collectionRef, binding), error => error.code === 'COLLECTION_REF_INVALID');
  const next = await reader.read(scope, binding, f.readPage); reader.clearReadContext(binding.readContextId);
  assert.throws(() => reader.snapshot(next.collectionRef, binding), error => error.code === 'COLLECTION_REF_INVALID');
  const final = await reader.read(scope, binding, f.readPage); reader.clear();
  assert.throws(() => reader.lookup(final.collectionRef, [1], binding), error => error.code === 'COLLECTION_REF_INVALID');
});

test('已取得个人字段与comment可批量关联复用，评分0和空标签是已知事实', async () => {
  const reader = new CollectionReader(); const f = fixture([rawRow(1, { comment: '轻松搞笑' }), rawRow(2)], { comments: true });
  const value = await reader.read(scope, binding, f.readPage);
  const first = reader.lookup(value.collectionRef, [1], binding)[0];
  assert.equal(first.personalFacts.personalComment, '轻松搞笑'); assert.equal(first.personalFacts.personalRating, 0);
  assert.equal(first.fieldStates.personalComment, 'known'); assert.equal(first.fieldStates.personalRating, 'known');
  assert.equal(first.fieldStates.personalTags, 'known'); assert.deepEqual(first.personalFacts.personalTags, []);
  assert.equal(f.calls.length, 1); first.personalFacts.personalTags.push('修改外部副本');
  assert.deepEqual(reader.lookup(value.collectionRef, [1], binding)[0].personalFacts.personalTags, []);
});

test('来源预算不限制总集合；一万条以上继续原游标读取', async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => rawRow(i + 1, { rate: i === 10000 ? 9 : 0 }));
  const reader = new CollectionReader(); const f = fixture(rows);
  const args = { ...scope, source_limit: 10000, filter: { personal_rating: { min: 9 } } };
  const first = await reader.read(args, binding, f.readPage);
  assert.equal(first.coverage.scannedCount, 10000); assert.equal(first.coverage.sourceNextOffset, 10000);
  const last = await reader.read({ ...args, collection_ref: first.collectionRef }, binding, f.readPage);
  assert.equal(last.coverage.sourceComplete, true); assert.equal(last.coverage.scannedCount, 10001);
  assert.deepEqual(last.rows.map(row => row.subjectId), [10001]); assert.equal(f.calls.length, 101);
});

test('取消不继续来源请求；请求结束后原子保留已完整校验的来源页', async () => {
  const reader = new CollectionReader(); const f = fixture([rawRow(1)]); const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader.read(scope, binding, f.readPage, controller.signal));
  assert.equal(f.calls.length, 0);
});

const coverageSources = async (service, value) => (await serviceRead(service, 'get_candidate_coverage', { coverage_ref: value.coverage.coverageRef, limit: 100 })).sources;
const serviceRead = (service, name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'collection-funnel-audit' });

function stateSourceService(rows, publicOwner = false) {
  const calls = [];
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const page = options => {
    const { type, offset, limit } = options.query;
    calls.push({ ...options.query });
    const scoped = type === undefined ? rows : rows.filter(row => row.type === type);
    return { total: scoped.length, data: scoped.slice(offset, offset + limit) };
  };
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { assert.equal(publicOwner, false, '第三方公开来源不应核本人账户'); return identity(); }, currentUser: async () => account,
    ensureNsfw: async () => ({ ...identity(), nsfw: { preference: false, allowed: false, state: 'disabled' } }),
    public: async (path, options) => {
      if (!publicOwner && path === '/v0/search/subjects') {
        const { offset, limit } = options.query;
        const results = [1, 2, 3].map(id => rawRow(id).subject);
        return { total: results.length, data: results.slice(offset, offset + limit) };
      }
      assert.equal(publicOwner, true); assert.equal(path, '/v0/users/public_user/collections'); return page(options);
    },
    account: async (path, options) => {
      assert.equal(publicOwner, false); assert.equal(path, '/p1/collections/subjects'); assert.equal(options.expectedAccountId, account.id);
      const value = page(options);
      return { ...value, data: value.data.map(row => ({ ...row.subject, nameCN: row.subject.name_cn,
        interest: { type: row.type, rate: row.rate, tags: row.tags, comment: '', private: row.private,
          epStatus: 0, volStatus: 0, updatedAt: 1700000000 } })) };
    },
  });
  const readerBinding = { ...binding, readContextId: 'collection-funnel-audit', ...(publicOwner ? { accountId: null, source: 'v0' } : {}) };
  return { service, calls, readerBinding };
}

test('新来源省略collection_type始终读全状态，filter筛结果不缩窄可复用收藏证据', async t => {
  const rows = Array.from({ length: 156 }, (_, i) => rawRow(i + 1, { type: i < 38 ? 3 : 2 }));
  const f = stateSourceService(rows); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', source_limit: 1000, filter: { collection_types: [3] }, fields: ['id'], limit: 100 };
  const value = await serviceRead(f.service, 'query_user_collections', args);
  assert.deepEqual(value.data.map(row => row.id), Array.from({ length: 38 }, (_, i) => i + 1));
  assert.deepEqual(f.calls, [{ subjectType: 2, limit: 100, offset: 0 }, { subjectType: 2, limit: 100, offset: 100 }]);
  assert.equal(value.scope.collection_type, undefined); assert.deepEqual(value.filter, args.filter);
  assert.deepEqual(JSON.parse((await coverageSources(f.service, value))[0].scope), { username: '-', subject_type: 2 });
  assert.deepEqual(value.collectionScope, { username: '-', subject_type: 2, sourceComplete: true });
  assert.equal((await coverageSources(f.service, value))[0].total, 156); assert.equal((await coverageSources(f.service, value))[0].scannedCount, 156); assert.equal((await coverageSources(f.service, value))[0].complete, true);
  const lookup = f.service.collections.lookup(value.collectionRef, [39], f.readerBinding)[0];
  assert.equal(lookup.membership, 'collected'); assert.equal(lookup.personalFacts.collectionStatus, 2);
  const absent = f.service.collections.lookup(value.collectionRef, [999], f.readerBinding)[0];
  assert.equal(absent.membership, 'not_collected'); assert.deepEqual(absent.excludesCollectionTypes, [1, 2, 3, 4, 5]);
  const before = f.calls.length;
  const same = await serviceRead(f.service, 'query_user_collections', { ...args, collection_ref: value.collectionRef });
  assert.equal(same.collectionRef, value.collectionRef); assert.equal(f.calls.length, before);
  await assert.rejects(serviceRead(f.service, 'query_user_collections', { ...args, collection_ref: value.collectionRef, collection_type: 3 }), error => error.code === 'COLLECTION_REF_SCOPE_MISMATCH');
  assert.equal(f.calls.length, before, '明确改变来源范围须另起来源');
});

test('显式窄状态来源按原snapshot恢复，省略状态和新增filter都不能升级来源scope', async t => {
  const f = stateSourceService([rawRow(1, { type: 3 }), rawRow(2, { type: 2 })]); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, collection_type: 3, result_mode: 'candidates', filter: { collection_types: [3] }, fields: ['id'], limit: 100 };
  const first = await serviceRead(f.service, 'query_user_collections', args);
  const { collection_type, ...restoredArgs } = args;
  for (const filter of [{ collection_types: [3], any_of: [{ tag: ['不存在的标签'] }, { rating: { min: 7 } }] },
    { collection_types: [3], exclude_collection_types: [2] }]) {
    const reused = await serviceRead(f.service, 'query_user_collections', { ...restoredArgs, collection_ref: first.collectionRef, filter });
    assert.deepEqual(reused.data, [{ id: 1 }]); assert.deepEqual(reused.filter, filter); assert.equal(reused.collectionRef, first.collectionRef);
    assert.equal(JSON.parse((await coverageSources(f.service, reused))[0].scope).collection_type, 3); assert.equal((await coverageSources(f.service, reused))[0].total, 1);
    assert.deepEqual(reused.collectionScope, { username: '-', subject_type: 2, collection_type: 3, sourceComplete: true });
  }
  const otherFilter = await serviceRead(f.service, 'query_user_collections', { ...restoredArgs, collection_ref: first.collectionRef, filter: { collection_types: [2] } });
  assert.deepEqual(otherFilter.data, []); assert.equal(otherFilter.collectionScope.collection_type, 3);
  await assert.rejects(serviceRead(f.service, 'query_user_collections', { ...restoredArgs, collection_ref: first.collectionRef, collection_type: 2 }), error => error.code === 'COLLECTION_REF_SCOPE_MISMATCH');
  assert.deepEqual(f.calls, [{ subjectType: 2, type: 3, limit: 100, offset: 0 }]);
  const absent = f.service.collections.lookup(first.collectionRef, [2], f.readerBinding)[0];
  assert.equal(absent.membership, 'not_in_scope'); assert.equal(absent.personalFacts.collectionState, 'unknown'); assert.deepEqual(absent.excludesCollectionTypes, [3]);
});

test('单状态来源续读恢复真实scope与连续offset，旧coverage快照保持原进度', async t => {
  const rows = Array.from({ length: 220 }, (_, i) => rawRow(i + 1, { type: i < 205 ? 3 : 2 }));
  const f = stateSourceService(rows); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, collection_type: 3, result_mode: 'candidates', response_view: 'reference',
    filter: { collection_types: [3] }, fields: ['id'], source_limit: 100 };
  const first = await serviceRead(f.service, 'query_user_collections', { ...args, response_view: 'page', limit: 50 });
  assert.equal(first.stage.inputCount, 100); assert.equal(first.stage.matchedCount, 50); assert.equal(first.stage.remainingCount, 50);
  assert.equal((await coverageSources(f.service, first))[0].total, 205); assert.equal((await coverageSources(f.service, first))[0].scannedCount, 100);
  assert.equal((await coverageSources(f.service, first))[0].nextOffset, 100); assert.equal((await coverageSources(f.service, first))[0].complete, false);
  const last = await serviceRead(f.service, 'query_user_collections', { ...args, collection_ref: first.collectionRef, source_limit: 1000 });
  assert.equal(last.collectionRef, first.collectionRef); assert.equal(last.set.workingCount, 205); assert.equal(last.set.resultCount, 205);
  assert.equal(last.stage.inputCount, 205); assert.equal(last.stage.processedCount, 205);
  assert.equal(last.coverage.dependencyRemainingCount, 0, '本来源旧窗口remaining不冻成祖先缺口');
  assert.equal((await coverageSources(f.service, last))[0].total, 205); assert.equal((await coverageSources(f.service, last))[0].scannedCount, 205);
  assert.equal((await coverageSources(f.service, last))[0].nextOffset, null); assert.equal((await coverageSources(f.service, last))[0].complete, true);
  assert.deepEqual(f.calls.map(call => [call.type, call.offset]), [[3, 0], [3, 100], [3, 200]]);
  const qualified = await serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: last.candidateRef,
    filter: { collection_types: [3] }, fields: ['id'], response_view: 'reference' });
  assert.equal(qualified.set.resultCount, 205); assert.equal(qualified.stage.processedCount, 205); assert.equal(f.calls.length, 3);
  const old = await serviceRead(f.service, 'get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
  assert.equal(old.sources[0].scannedCount, 100); assert.equal(old.sources[0].nextOffset, 100); assert.equal(old.sources[0].complete, false);
  assert.equal(old.stage.remainingCount, 50);
  assert.equal(last.candidateRef, first.candidateRef); assert.equal(last.resultRef, first.resultRef);
  assert.deepEqual(f.service.candidates.get(first.resultRef, f.service.candidates.peekBinding(first.resultRef, 'collection-funnel-audit').binding).rows.map(row => row.id), Array.from({ length: 205 }, (_, i) => i + 1));
});

test('显式单状态来源的候选cursor冻结实际Cref并返回collectionScope，不重新读取来源', async t => {
  const f = stateSourceService(Array.from({ length: 38 }, (_, i) => rawRow(i + 1, { type: 3 }))); t.after(() => f.service.close());
  const first = await serviceRead(f.service, 'query_user_collections', { username: '-', subject_type: 2, collection_type: 3, result_mode: 'candidates',
    filter: { collection_types: [3] }, fields: ['id'], limit: 5 });
  assert.equal(first.stage.remainingCount, 33); assert.ok(first.page.nextCursor);
  const resumed = await serviceRead(f.service, 'continue_subject_query', { candidate_ref: first.resultRef, cursor: first.page.nextCursor, limit: 100 });
  assert.deepEqual(resumed.request.filter, { subject_type: 2, collection_types: [3] }); assert.deepEqual(resumed.request.fields, ['id']);
  assert.equal(resumed.result.stage.remainingCount, 0); assert.equal(resumed.result.stage.matchedCount, 38); assert.equal(resumed.result.set.resultCount, 38);
  assert.equal(resumed.request.collection_ref, first.collectionRef); assert.deepEqual(resumed.result.collectionScope, first.collectionScope);
  assert.deepEqual(f.calls.map(call => [call.type, call.offset]), [[3, 0]]);
});

test('已有全状态collection_ref不因单状态filter改窄，源总数与未收藏证明保持原范围', async t => {
  const rows = Array.from({ length: 156 }, (_, i) => rawRow(i + 1, { type: i < 38 ? 3 : 2 }));
  const f = stateSourceService(rows); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', source_limit: 1000, response_view: 'reference', fields: ['id'] };
  const full = await serviceRead(f.service, 'query_user_collections', args);
  const before = f.calls.length;
  const selected = await serviceRead(f.service, 'query_user_collections', { ...args, filter: { collection_types: [3] }, collection_ref: full.collectionRef });
  assert.equal(selected.collectionRef, full.collectionRef); assert.equal(selected.stage.matchedCount, 38); assert.equal(f.calls.length, before);
  assert.deepEqual(f.calls.map(call => [call.type, call.offset]), [[undefined, 0], [undefined, 100]]);
  assert.deepEqual(JSON.parse((await coverageSources(f.service, selected))[0].scope), { username: '-', subject_type: 2 });
  assert.equal((await coverageSources(f.service, selected))[0].total, 156); assert.equal((await coverageSources(f.service, selected))[0].scannedCount, 156);
  const [present, absent] = f.service.collections.lookup(full.collectionRef, [39, 999], f.readerBinding);
  assert.equal(present.personalFacts.collectionStatus, 2); assert.equal(absent.membership, 'not_collected');
  assert.deepEqual(absent.excludesCollectionTypes, [1, 2, 3, 4, 5]);
});

test('单状态、多状态、排除与OR filter都不改变来源，只有显式collection_type约束native读取', async t => {
  const rows = [rawRow(1, { type: 3 }), rawRow(2, { type: 2 })];
  for (const extra of [{ filter: { collection_types: [3] } }, { filter: { collection_types: [2, 3] } }, { filter: { exclude_collection_types: [2] } },
    { filter: { collection_types: [3], exclude_collection_types: [2] } },
    { filter: { any_of: [{ collection_types: [3] }, { collection_types: [2] }] } },
    { filter: { collection_types: [3], any_of: [{ personal_rating: { min: 0 } }] } },
    { collection_type: 2, filter: { collection_types: [3] } }]) {
    const f = stateSourceService(rows); t.after(() => f.service.close());
    const value = await serviceRead(f.service, 'query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 100, ...extra });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].type, extra.collection_type);
    assert.equal(JSON.parse((await coverageSources(f.service, value))[0].scope).collection_type, extra.collection_type);
    if (extra.collection_type !== undefined) assert.deepEqual(value.data, []);
  }
});

test('显式单状态来源保留NSFW缺口，已耗尽可见页不能生成缺席证明', async t => {
  const rows = [rawRow(1, { type: 3 }), rawRow(2, { type: 3, subject: { ...rawRow(2).subject, nsfw: true } }),
    rawRow(3, { type: 3, subject: { ...rawRow(3).subject, nsfw: null } })];
  const f = stateSourceService(rows); t.after(() => f.service.close());
  const value = await serviceRead(f.service, 'query_user_collections', { username: '-', subject_type: 2, collection_type: 3, result_mode: 'candidates',
    filter: { collection_types: [3] }, fields: ['id'], limit: 100 });
  assert.deepEqual(value.data, [{ id: 1 }]); assert.equal(f.calls[0].type, 3);
  assert.equal((await coverageSources(f.service, value))[0].total, 3); assert.equal((await coverageSources(f.service, value))[0].scannedCount, 3);
  assert.equal((await coverageSources(f.service, value))[0].nextOffset, null); assert.equal((await coverageSources(f.service, value))[0].complete, false); assert.equal(value.coverage.complete, false);
  const snapshot = f.service.collections.snapshot(value.collectionRef, f.readerBinding);
  assert.equal(snapshot.coverage.excludedNsfwCount, 1); assert.equal(snapshot.coverage.unknownNsfwCount, 1);
  const missing = f.service.collections.lookup(value.collectionRef, [2, 3, 999], f.readerBinding);
  assert.ok(missing.every(row => row.membership === 'unknown' && row.personalFacts.collectionState === 'unknown' && row.excludesCollectionTypes.length === 0));
});

test('第三方显式单状态仍只读取公开源，窄状态缺席不外推用户全部收藏', async t => {
  const f = stateSourceService([rawRow(1, { type: 3 }), rawRow(2, { type: 2 })], true); t.after(() => f.service.close());
  const value = await serviceRead(f.service, 'query_user_collections', { username: 'public_user', subject_type: 2, collection_type: 3, result_mode: 'candidates',
    filter: { collection_types: [3] }, fields: ['id'], limit: 100 });
  assert.deepEqual(value.data, [{ id: 1 }]); assert.deepEqual(f.calls, [{ subject_type: 2, type: 3, limit: 100, offset: 0 }]);
  assert.equal(value.visibility, 'public'); assert.equal((await coverageSources(f.service, value))[0].privateRecords, 'public_only');
  const absent = f.service.collections.lookup(value.collectionRef, [2], f.readerBinding)[0];
  assert.equal(absent.membership, 'not_in_scope'); assert.equal(absent.personalFacts.collectionState, 'unknown'); assert.deepEqual(absent.excludesCollectionTypes, [3]);
});

test('同collection_ref续查只报告真实来源delta，旧source snapshots与资格进度保留', async t => {
  const f = stateSourceService([rawRow(1)]); t.after(() => f.service.close());
  const own = await serviceRead(f.service, 'query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const found = await serviceRead(f.service, 'search_subjects', { keyword: '范围', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 3 });
  const args = { candidate_ref: found.resultRef, collection_ref: own.collectionRef, filter: { exclude_collection_types: [2] }, fields: ['id'], limit: 1 };
  const first = await serviceRead(f.service, 'refine_subject_candidates', args);
  assert.equal(first.coverage.sourceChanges.reduce((n, source) => n + source.addedCount, 0), 1); assert.equal(first.stage.remainingCount, 2);
  const next = await serviceRead(f.service, 'continue_subject_query', { candidate_ref: first.candidateRef, cursor: first.page.nextCursor, limit: 1 });
  assert.deepEqual(next.result.coverage.sourceChanges, []); assert.equal(next.result.coverage.sourceCount, first.coverage.sourceCount);
  assert.equal(next.result.stage.remainingCount, 1); assert.deepEqual(next.result.collectionScope, own.collectionScope);
  const last = await serviceRead(f.service, 'continue_subject_query', { candidate_ref: next.result.candidateRef, cursor: next.result.page.nextCursor, limit: 1 });
  assert.deepEqual(last.result.coverage.sourceChanges, []); assert.equal(last.result.stage.remainingCount, 0); assert.equal(last.result.stage.matchedCount, 2);
  const old = await serviceRead(f.service, 'get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
  assert.equal(old.stage.remainingCount, 2); assert.equal(f.calls.length, 1, '完整批量Cref能直接复用，不补逐项HTTP');
});

test('窄Cref缺少实际个人谓词证据时全阶段明确中止，补全全状态后原母范围可完整复筛', async t => {
  const f = stateSourceService([rawRow(1), rawRow(4, { type: 3 })]); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'] };
  const narrow = await serviceRead(f.service, 'query_user_collections', { ...args, collection_type: 2 });
  const mother = await serviceRead(f.service, 'search_subjects', { keyword: '范围', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 3 });
  const filter = { exclude_collection_types: [2, 3, 4, 5] };
  await assert.rejects(serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: mother.resultRef, collection_ref: narrow.collectionRef, filter, fields: ['id'], response_view: 'reference' }), error => {
    assert.equal(error.code, 'CREF_COVERAGE_INSUFFICIENT'); assert.equal(error.diagnosis.category, 'input');
    assert.deepEqual(error.diagnosis.blockedFields, ['/collection_ref']); assert.equal(error.diagnosis.retryable, false);
    assert.ok(error.message.includes('原母candidate_ref')); return true;
  });
  assert.equal(f.calls.length, 1, '拒绝前不逐项访问p1');
  const full = await serviceRead(f.service, 'query_user_collections', { ...args, filter: { collection_types: [2] } });
  assert.deepEqual(full.collectionScope, { username: '-', subject_type: 2, sourceComplete: true });
  const repaired = await serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: mother.resultRef, collection_ref: full.collectionRef, filter, fields: ['id'], response_view: 'reference' });
  assert.equal(repaired.stage.inputCount, 3); assert.equal(repaired.stage.processedCount, 3); assert.equal(repaired.stage.pendingCount, 0); assert.equal(repaired.set.resultCount, 2);
  assert.deepEqual(repaired.collectionScope, full.collectionScope); assert.equal(f.calls.length, 2);
  assert.equal(f.service.collections.peek(narrow.collectionRef, 'collection-funnel-audit').scope.collection_type, 2);
});

test('窄Cref不会阻塞已cached足够或OR其他支路通过，但已知status不冒充缺失个人评分', async t => {
  const f = stateSourceService([rawRow(1), rawRow(2, { type: 1, rate: null })]); t.after(() => f.service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'] };
  const known = await serviceRead(f.service, 'query_user_collections', { ...args, collection_type: 1 });
  const narrow = await serviceRead(f.service, 'query_user_collections', { ...args, collection_type: 2 });
  const cached = await serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: known.resultRef, collection_ref: narrow.collectionRef,
    filter: { exclude_collection_types: [2, 3, 4, 5] }, fields: ['id'], response_view: 'reference' });
  assert.equal(cached.set.resultCount, 1); assert.equal(cached.stage.pendingCount, 0);
  const mother = await serviceRead(f.service, 'search_subjects', { keyword: '范围', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 3 });
  const union = await serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: mother.resultRef, collection_ref: narrow.collectionRef,
    filter: { any_of: [{ rating: { min: 7 } }, { exclude_collection_types: [2, 3, 4, 5] }] }, fields: ['id'], response_view: 'reference' });
  assert.equal(union.set.resultCount, 3); assert.equal(union.stage.pendingCount, 0); assert.equal(f.calls.length, 2);
  await assert.rejects(serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: known.resultRef, collection_ref: narrow.collectionRef,
    filter: { personal_rating: { min: 8 } }, fields: ['id'], response_view: 'reference' }), error => error.code === 'CREF_COVERAGE_INSUFFICIENT');
  assert.equal(f.calls.length, 2);
});

test('不同公开用户的收藏引用不能覆盖候选原用户个人事实', async t => {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { throw Error('公开引用不得核本人身份'); },
    public: async path => {
      calls.push(path);
      return { data: [rawRow(1, { rate: path.includes('/alice/') ? 9 : 2 })], total: 1 };
    },
  });
  t.after(() => service.close());
  const args = { subject_type: 2, result_mode: 'candidates', fields: ['id', 'personalRating'], limit: 100 };
  const alice = await serviceRead(service, 'query_user_collections', { ...args, username: 'alice' });
  const bob = await serviceRead(service, 'query_user_collections', { ...args, username: 'bob' });
  assert.equal(alice.data[0].personalRating, 9); assert.equal(bob.data[0].personalRating, 2);
  await assert.rejects(serviceRead(service, 'refine_subject_candidates', {
    candidate_ref: alice.candidateRef, collection_ref: bob.collectionRef, fields: ['id', 'personalRating'], limit: 100,
  }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const preserved = await serviceRead(service, 'refine_subject_candidates', { candidate_ref: alice.candidateRef, fields: ['id', 'personalRating'], limit: 100 });
  assert.equal(preserved.data[0].personalRating, 9); assert.equal(calls.length, 2);
});

test('已缓存R18候选不投影nsfw时仍核实权限，关闭权限后不能返回受限名称', async t => {
  let allowed = true, permissionChecks = 0;
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => account,
    ensureNsfw: async () => { permissionChecks++; return { ...identity(), nsfw: { preference: true, allowed, state: allowed ? 'enabled' : 'disabled' }, nsfwApplied: allowed }; },
    public: async () => { throw Error('本人R18读取不得降级'); },
    account: async path => {
      assert.equal(path, '/p1/collections/subjects');
      return { data: [{ id: 1, type: 2, name: 'R18缓存名称', nameCN: '', nsfw: true,
        interest: { type: 2, rate: 9, tags: [], comment: '', private: false, epStatus: 0, volStatus: 0, updatedAt: 1700000000 } }], total: 1 };
    },
  });
  t.after(() => service.close());
  const first = await serviceRead(service, 'query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id', 'name'], limit: 100 });
  assert.equal(first.data[0].name, 'R18缓存名称'); assert.equal(first.accessContext.nsfw.state, 'enabled');
  const initialPermissionChecks = permissionChecks;
  allowed = false;
  let reused, failure;
  try { reused = await serviceRead(service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, fields: ['id', 'name'], limit: 100 }); }
  catch (error) { failure = error; }
  if (failure) assert.ok(['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN', 'CANDIDATE_SCOPE_MISMATCH'].includes(failure.code), `${failure.code}: ${failure.message}`);
  else assert.deepEqual(reused.data, []);
  assert.ok(permissionChecks > initialPermissionChecks, '不能让field投影隐藏宿主中的NSFW事实并跳过权限读取');
});

test('collection_ref保存完整来源scope，评分筛后子集不妨碍原低分记录的批量关联', async t => {
  const calls = [];
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => account,
    ensureNsfw: async () => { throw Error('明确SFW收藏无需NSFW检查'); },
    public: async (path, options) => {
      calls.push(path); assert.equal(path, '/v0/search/subjects');
      return { data: [rawRow(1).subject], total: 1, limit: options.query.limit, offset: options.query.offset };
    },
    account: async path => {
      calls.push(path); assert.equal(path, '/p1/collections/subjects', '完整来源已取个人字段不应逐项读取');
      return { data: [1, 2].map(id => ({ ...rawRow(id).subject, nameCN: `作品${id}`,
        interest: { type: 2, rate: id === 1 ? 4 : 9, tags: [], comment: '', private: false, epStatus: 0, volStatus: 0, updatedAt: 1700000000 } })), total: 2 };
    },
  });
  t.after(() => service.close());
  const selected = await serviceRead(service, 'query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates',
    filter: { personal_rating: { min: 8 } }, fields: ['id', 'personalRating'], limit: 100 });
  assert.deepEqual(selected.data.map(row => row.id), [2]);
  const recalled = await serviceRead(service, 'search_subjects', { keyword: '作品1', subject_type: 2, result_mode: 'candidates', fields: ['id', 'subjectType'], limit: 1 });
  const before = calls.length;
  const linked = await serviceRead(service, 'refine_subject_candidates', { candidate_ref: recalled.candidateRef,
    collection_ref: selected.collectionRef, fields: ['id', 'personalRating', 'collectionStatus', 'collectionState'], limit: 100 });
  assert.deepEqual(linked.data, [{ id: 1, personalRating: 4, collectionStatus: 2, collectionState: 'collected' }]);
  assert.equal(calls.length, before); assert.equal(linked.visibility, 'self'); assert.deepEqual(linked.account, account);
});

test('本人候选与收藏引用不能跨登录账户续用，拒绝前不读取新账户收藏', async t => {
  let current = account;
  const calls = [];
  const identity = () => ({ mode: 'account', account: current, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => current,
    public: async () => { throw Error('本人引用不得转公开源'); },
    account: async (path, options) => {
      calls.push(path); assert.equal(path, '/p1/collections/subjects'); assert.equal(options.expectedAccountId, account.id);
      return { data: [{ ...rawRow(1).subject, nameCN: '作品1', interest: { type: 2, rate: 8, tags: [], comment: '', private: true, epStatus: 0, volStatus: 0, updatedAt: 1700000000 } }], total: 1 };
    },
  });
  t.after(() => service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id', 'personalRating'], limit: 100 };
  const first = await serviceRead(service, 'query_user_collections', args);
  current = { id: 99, username: 'other_account' };
  const before = calls.length;
  await assert.rejects(serviceRead(service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, fields: ['id', 'personalRating'], limit: 100 }),
    error => ['CANDIDATE_SCOPE_MISMATCH', 'ACCOUNT_CHANGED'].includes(error.code));
  await assert.rejects(serviceRead(service, 'query_user_collections', { ...args, collection_ref: first.collectionRef }),
    error => ['COLLECTION_REF_INVALID', 'ACCOUNT_CHANGED'].includes(error.code));
  assert.equal(calls.length, before);
});

test('真实服务内部来源续读可越过公开分页offset上限，一万条后继续到10401条末项', async t => {
  const total = 10401, offsets = [];
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { throw Error('公开来源不得核本人身份'); },
    public: async (path, options) => {
      assert.equal(path, '/v0/users/public_user/collections');
      const { offset, limit } = options.query; offsets.push(offset);
      assert.equal(limit, 100);
      return { total, data: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => {
        const id = offset + i + 1; return rawRow(id, { rate: id === total ? 9 : 0 });
      }) };
    },
  });
  t.after(() => service.close());
  const args = { username: 'public_user', subject_type: 2, result_mode: 'candidates', source_limit: 10000,
    filter: { personal_rating: { min: 9 } }, fields: ['id'], limit: 1 };
  const first = await serviceRead(service, 'query_user_collections', args);
  assert.deepEqual(first.data, []); assert.equal((await coverageSources(service, first))[0].nextOffset, 10000);
  const last = await serviceRead(service, 'query_user_collections', { ...args, source_limit: 1000, collection_ref: first.collectionRef });
  assert.deepEqual(last.data, [{ id: total }]); assert.equal((await coverageSources(service, last))[0].complete, true);
  assert.equal((await coverageSources(service, last))[0].scannedCount, total); assert.equal((await coverageSources(service, last))[0].nextOffset, null);
  assert.deepEqual(offsets, Array.from({ length: 105 }, (_, i) => i * 100));
});

function restrictedRelationFixture() {
  let allowed = true, permissionChecks = 0;
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => account,
    ensureNsfw: async () => { permissionChecks++; return { ...identity(), nsfw: { preference: true, allowed, state: allowed ? 'enabled' : 'disabled' }, nsfwApplied: allowed }; },
    public: async () => { throw new AppError('BGM_HTTP_404', '公开关系不可见'); },
    account: async path => {
      assert.equal(path, '/p1/subjects/1/relations');
      return { data: [{ subject: { id: 2, type: 2, name: 'R18关联作品名称', nameCN: '', nsfw: true }, relation: { cn: '续集' } }], total: 1 };
    },
  });
  return { service, disable: () => { allowed = false; }, get permissionChecks() { return permissionChecks; } };
}

test('关系补字段不得剥掉nsfw标记后把账户保护的子作品名称放入匿名候选', async t => {
  const f = restrictedRelationFixture(); t.after(() => f.service.close());
  const result = await serviceRead(f.service, 'refine_subject_candidates', { subject_ids: [1], fields: ['id', 'relations'] });
  assert.equal(result.accessContext.mode, 'anonymous');
  assert.equal(result.data[0].relations, null);
  assert.equal(result.data[0].fieldStates.relations, 'failed');
  assert.ok(!JSON.stringify(result).includes('R18关联作品名称'));
});

test('父作品nsfw未知时已缓存R18关系仍绑定权限，不能在权限关闭后复用受限子作品名称', async t => {
  const f = restrictedRelationFixture(); t.after(() => f.service.close());
  const first = await serviceRead(f.service, 'refine_subject_candidates', { subject_ids: [1], filter: { nsfw: 'account' }, fields: ['id', 'relations'] });
  assert.equal(first.data[0].relations[0].name, 'R18关联作品名称');
  const before = f.permissionChecks; f.disable();
  let reused, failure;
  try { reused = await serviceRead(f.service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, fields: ['id', 'relations'] }); }
  catch (error) { failure = error; }
  if (failure) assert.ok(['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN', 'CANDIDATE_SCOPE_MISMATCH'].includes(failure.code), `${failure.code}: ${failure.message}`);
  else assert.ok(!JSON.stringify(reused).includes('R18关联作品名称'));
  assert.ok(f.permissionChecks > before, '关系子作品的权限依赖不能因父作品nsfw未知而消失');
});

test('仅补个人字段的R18记录也保留权限依赖与实际上下文，权限关闭后不能复用个人标签', async t => {
  let allowed = true, permissionChecks = 0;
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => account,
    ensureNsfw: async () => { permissionChecks++; return { ...identity(), nsfw: { preference: true, allowed, state: allowed ? 'enabled' : 'disabled' }, nsfwApplied: allowed }; },
    public: async () => { throw Error('明确本人字段无公共读取'); },
    account: async path => {
      assert.equal(path, '/p1/subjects/1');
      return { id: 1, type: 2, name: 'R18本人作品', nameCN: '', nsfw: true, eps: 12, volumes: 0,
        interest: { type: 2, rate: 9, tags: ['R18个人标签'], comment: '', private: true, epStatus: 12, volStatus: 0, updatedAt: 1700000000 } };
    },
  });
  t.after(() => service.close());
  const fields = ['id', 'personalRating', 'personalTags'];
  const first = await serviceRead(service, 'refine_subject_candidates', { subject_ids: [1], fields });
  assert.equal(first.data[0].personalRating, 9); assert.deepEqual(first.data[0].personalTags, ['R18个人标签']);
  assert.equal(first.accessContext.nsfw.allowed, true); assert.equal(first.accessContext.nsfwApplied, true);
  const before = permissionChecks; allowed = false;
  let reused, failure;
  try { reused = await serviceRead(service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, fields }); }
  catch (error) { failure = error; }
  if (failure) assert.ok(['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN', 'CANDIDATE_SCOPE_MISMATCH'].includes(failure.code), `${failure.code}: ${failure.message}`);
  else assert.ok(!JSON.stringify(reused).includes('R18个人标签'));
  assert.ok(permissionChecks > before, '不能因未补公开subject.nsfw而忘记个人记录的NSFW权限依赖');
});

test('补字段内部读取期间账户变更必须拒绝，不能把新账户私密事实绑定到旧账户', async t => {
  let current = account, identities = 0;
  const other = { id: 99, username: 'new_viewer' };
  const identity = () => ({ mode: 'account', account: current, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { if (++identities > 1) current = other; return identity(); }, currentUser: async () => current,
    public: async () => { throw Error('明确本人事实无需公开读取'); },
    account: async (path, options) => {
      assert.equal(path, '/p1/subjects/1'); assert.equal(options.expectedAccountId, other.id);
      return { id: 1, type: 2, name: 'SFW作品', nameCN: '', nsfw: false, eps: 12, volumes: 0,
        interest: { type: 2, rate: 9, tags: ['新账户私密标签'], comment: '', private: true, epStatus: 12, volStatus: 0, updatedAt: 1700000000 } };
    },
  });
  t.after(() => service.close());
  await assert.rejects(serviceRead(service, 'refine_subject_candidates', { subject_ids: [1], fields: ['id', 'personalRating', 'personalTags'] }),
    error => ['ACCOUNT_CHANGED', 'CANDIDATE_SCOPE_MISMATCH'].includes(error.code));
});
