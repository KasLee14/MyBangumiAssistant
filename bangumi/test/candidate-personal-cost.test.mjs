import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';

const turnId = 'personal-cost-turn';
const subject = (id, extra = {}) => ({ id, type: 2, name: `作品${id}`, nameCN: '', nsfw: false, eps: 12, volumes: 0,
  summary: '', info: '', redirect: 0, seriesEntry: 0, locked: false, series: false,
  airtime: { date: '2026-10-01' }, collection: {}, platform: {}, rating: {}, infobox: [], metaTags: [], tags: [], ...extra });
const collected = (id, type = 1, extra = {}) => subject(id, { interest: { type, rate: 8, tags: ['个人标签'], comment: '',
  private: false, epStatus: 0, volStatus: 0, updatedAt: 1700000000 }, ...extra });
function fixture(total, options = {}) {
  const calls = [], rows = Array.from({ length: total }, (_, at) => collected(at + 1, at === 0 ? 2 : 1, options.unknownNsfw && at === 0 ? { nsfw: null } : {}));
  let current = { id: 42, username: 'cost_user' }, afterPage = () => {};
  const context = () => ({ mode: 'account', account: current, source: 'p1', nsfwApplied: false,
    nsfw: { preference: false, allowed: false, state: 'disabled' }, checkedAt: new Date().toISOString() });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => context(), currentUser: async () => current,
    ensureNsfw: async () => context(), public: async () => { throw Error('个人索引不额外读取公共接口'); },
    account: async (path, request) => {
      assert.equal(request.expectedAccountId, current.id); calls.push({ path, query: request.query });
      if (path === '/p1/collections/subjects') {
        assert.equal(request.query.type, undefined, '显式全状态快照不限制收藏状态');
        const result = { total: rows.length, data: rows.slice(request.query.offset, request.query.offset + request.query.limit) };
        afterPage(); return result;
      }
      const id = Number(/^\/p1\/subjects\/(\d+)$/.exec(path)?.[1]); assert.ok(id);
      return rows.find(row => row.id === id && row.nsfw !== null) ?? subject(id);
    },
  });
  const binding = (owner = turnId) => ({ turnId: owner, accountId: current.id, scopeKey: `account:${current.id}` });
  const seed = (ids, owner = turnId, extra = () => ({})) => service.candidates.create({ binding: binding(owner),
    rows: ids.map(id => ({ id, facts: { subjectType: 2, nsfw: false, score: 8, ...extra(id) } })),
    sources: [{ tool: 'get_subject_relations', source: 'v0', scope: JSON.stringify({ subject_id: 999 }), complete: true,
      scannedCount: ids.length, total: ids.length, nextOffset: null, privateRecords: 'not_applicable' }] });
  const invoke = (args, owner = turnId) => service.call('refine_subject_candidates', args, undefined, undefined, undefined, { turnId: owner });
  return { service, calls, seed, invoke, binding, setAccount: account => { current = account; }, onPage: action => { afterPage = action; } };
}
const ownArgs = ref => ({ candidate_ref: ref, filter: { exclude_collection_types: [2, 3, 4, 5] }, fields: ['id'], response_view: 'reference' });
const readCollections = (f, extra = {}, owner = turnId) => f.service.call('query_user_collections', {
  username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id'], response_view: 'reference', source_limit: 1000, ...extra,
}, undefined, undefined, undefined, { turnId: owner });

test('个人证据沿候选逐项核实，不自动扫描全历史；廉价淘汰仍先执行', async t => {
  const f = fixture(205); t.after(() => f.service.close());
  const ids = [1, 204, ...Array.from({ length: 18 }, (_, at) => 1000 + at)];
  const origin = f.seed(ids, turnId, id => id === 1017 ? { score: 3 } : {});
  const value = await f.invoke({ ...ownArgs(origin.ref), filter: { rating: { min: 7 }, exclude_collection_types: [2, 3, 4, 5] } });
  assert.ok(f.calls.every(call => call.path !== '/p1/collections/subjects'));
  assert.equal(f.calls.length, 19); assert.equal(value.stage.matchedCount, 18); assert.equal(value.stage.excludedCount, 2);
  assert.equal(value.stage.remainingCount, 0); assert.equal(value.stage.pendingCount, 0);
  assert.equal(f.service.candidates.get(origin.ref, f.binding()).rows.length, 20);
});

test('显式完整collection_ref复用缺席证据，不为相同范围单项取数', async t => {
  const f = fixture(205); t.after(() => f.service.close());
  const collection = await readCollections(f);
  assert.deepEqual(f.calls.map(call => call.query.offset), [0, 100, 200]);
  const origin = f.seed([1, 204, 1000, 1001]); const before = f.calls.length;
  const value = await f.invoke({ ...ownArgs(origin.ref), collection_ref: collection.collectionRef });
  assert.deepEqual(f.service.candidates.get(value.resultRef, f.binding()).rows.map(row => row.id), [204, 1000, 1001]);
  assert.equal(f.calls.length, before); assert.equal(value.stage.pendingCount, 0);
});

test('单窗、充分缓存、已成立OR与reference字段提示不会主动扫描个人来源', async t => {
  const f = fixture(205); t.after(() => f.service.close());
  const one = f.seed([2000, 2001, 2002]);
  const page = await f.invoke({ ...ownArgs(one.ref), response_view: 'page', limit: 1 });
  assert.equal(page.stage.processedCount, 1); assert.equal(page.stage.remainingCount, 2);
  assert.deepEqual(f.calls.map(call => call.path), ['/p1/subjects/2000']);
  const cached = f.seed([20, 21], turnId, () => ({ collectionState: 'collected', collectionStatus: 1 }));
  await f.invoke(ownArgs(cached.ref));
  const branch = f.seed([30, 31]);
  await f.invoke({ candidate_ref: branch.ref, fields: ['id'], response_view: 'reference', filter: { any_of: [{ rating: { min: 7 } }, { collection_types: [2] }] } });
  await f.invoke({ candidate_ref: branch.ref, fields: ['id', 'personalRating'], response_view: 'reference' });
  assert.equal(f.calls.length, 1);
});

test('NSFW来源缺口不提供缺席证明，显式部分索引仍逐项核实必要状态', async t => {
  const f = fixture(110, { unknownNsfw: true }); t.after(() => f.service.close());
  const collection = await readCollections(f);
  const index = f.service.collections.findOwnAllStates({ readContextId: turnId, accountId: 42, source: 'p1' }, 2);
  assert.equal(index.nextOffset, null); assert.equal(index.sourceComplete, false);
  assert.equal(f.service.collections.lookup(collection.collectionRef, [2000], { readContextId: turnId, accountId: 42, source: 'p1' })[0].membership, 'unknown');
  const origin = f.seed([2000, 2001, 2002]); const before = f.calls.length;
  const value = await f.invoke({ ...ownArgs(origin.ref), collection_ref: collection.collectionRef });
  assert.equal(f.calls.length - before, 3); assert.equal(value.stage.matchedCount, 3); assert.equal(value.stage.pendingCount, 0);
  assert.equal(value.coverage.complete, false);
});

test('collection_ref绑定账户、媒体和读取轮次，不复用其他范围证据', async t => {
  const f = fixture(105); t.after(() => f.service.close());
  const collection = await readCollections(f);
  const media = f.seed([2000], turnId, () => ({ subjectType: 1 }));
  const before = f.calls.length;
  await f.invoke({ ...ownArgs(media.ref), collection_ref: collection.collectionRef });
  assert.equal(f.calls.length, before + 1, '不适用媒体的缺席不当作证明，转为单项证据核实');
  assert.equal(f.calls.at(-1).path, '/p1/subjects/2000');
  f.setAccount({ id: 99, username: 'other_user' });
  const other = f.seed([3000]);
  await assert.rejects(f.invoke({ ...ownArgs(other.ref), collection_ref: collection.collectionRef }), error => ['COLLECTION_REF_INVALID', 'COLLECTION_REF_SCOPE_MISMATCH', 'CANDIDATE_SCOPE_MISMATCH'].includes(error.code));
  f.service.endReadContext(turnId);
  const next = f.seed([4000], 'next-cost-turn');
  await assert.rejects(f.invoke({ ...ownArgs(next.ref), collection_ref: collection.collectionRef }, 'next-cost-turn'), error => ['COLLECTION_REF_INVALID', 'COLLECTION_REF_EXPIRED', 'COLLECTION_REF_SCOPE_MISMATCH'].includes(error.code));
});
