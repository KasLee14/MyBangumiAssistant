import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { PersonCandidates, checkPersonCandidateResponse } from '../dist/src/mcp/person-candidates.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';
const turnId = 'source-lifecycle', binding = { turnId, accountId: null, scopeKey: 'public:sfw' };
const subject = id => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`, nsfw: false, platform: 'TV',
  date: '2026-10-01', tags: [], meta_tags: ['TV'], rating: { score: 8, total: 100 } });
const collection = id => ({ subject_id: id, subject: subject(id), type: 2, rate: 8, tags: [], private: false });
const call = (service, name, args) => service.call(name, args, undefined, undefined, undefined, { turnId });
function serviceFixture(total = 105) {
  const paths = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async (path, options) => {
    paths.push(path); const { offset, limit } = options.query;
    return { total, data: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, index) =>
      path.includes('/collections') ? collection(offset + index + 1) : subject(offset + index + 1)) };
  } });
  service.candidates.options.maxRefs = 3;
  return { service, paths };
}
test('search/browse/getcollections超过100来源页保持3个ref，全成员原句柄累计且旧cv保留来源进度', async t => {
  for (const name of ['search_subjects', 'browse_subjects', 'get_user_collections']) {
    const f = serviceFixture(); t.after(() => f.service.close());
    const args = { ...(name === 'search_subjects' ? { keyword: '作品' } : name === 'get_user_collections' ? { username: 'alice' } : {}),
      subject_type: 2, result_mode: 'candidates', fields: ['id'], response_view: 'reference', limit: 1 };
    let page = await call(f.service, name, args), first = page;
    while (page.sourcePage.nextOffset !== null) {
      page = await call(f.service, name, { ...args, offset: page.sourcePage.nextOffset, merge_ref: page.candidateRef });
      assert.equal(page.candidateRef, first.candidateRef); assert.equal(page.resultRef, first.resultRef);
      assert.equal(f.service.candidates.sets.size + f.service.candidates.resultViews.size, 3);
    }
    const stored = f.service.candidates.get(first.resultRef, f.service.candidates.peekBinding(first.resultRef, turnId).binding);
    assert.deepEqual(stored.rows.map(row => row.id), Array.from({ length: 105 }, (_, index) => index + 1));
    const old = await call(f.service, 'get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
    assert.equal(old.sources[0].scannedCount, 1); assert.equal(old.sources[0].nextOffset, 1); assert.equal(old.coverage.complete, false);
    const latest = await call(f.service, 'get_candidate_coverage', { coverage_ref: page.coverage.coverageRef });
    assert.equal(latest.sources[0].scannedCount, 105); assert.equal(latest.sources[0].nextOffset, null);
    assert.equal(page.coverage.complete, name === 'get_user_collections');
    assert.equal(latest.sources[0].readState.totalKind, name === 'get_user_collections' ? 'exact' : name === 'browse_subjects' ? 'unknown' : 'estimated');
  }
});
test('来源与候选窗口交错：来源推进使旧cc失效，原集合仍累计全部200项', async t => {
  const f = serviceFixture(200); t.after(() => f.service.close());
  const args = { username: 'alice', subject_type: 2, result_mode: 'candidates', fields: ['id'], response_view: 'reference', limit: 100 };
  const first = await call(f.service, 'get_user_collections', args);
  const window = await call(f.service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, fields: ['id'], limit: 1 });
  assert.equal(window.candidateRef, first.resultRef); assert.equal(window.resultRef, first.resultRef);
  assert.equal(window.scope.candidate_ref, first.candidateRef);
  assert.match(window.page.nextCursor, /^cp_/);
  assert.equal(f.service.candidates.sets.size + f.service.candidates.resultViews.size, 3);
  const second = await call(f.service, 'get_user_collections', { ...args, offset: 100, merge_ref: window.candidateRef });
  assert.equal(second.candidateRef, first.candidateRef); assert.equal(second.resultRef, first.resultRef);
  await assert.rejects(call(f.service, 'continue_subject_query', { candidate_ref: window.candidateRef, cursor: window.page.nextCursor }),
    error => error.code === 'CANDIDATE_CURSOR_MISMATCH');
  assert.equal(second.set.resultCount, 200);
  assert.equal(f.service.candidates.sets.size + f.service.candidates.resultViews.size, 3);
});
test('query_user_collections小来源窗口重复续读复用3refs，完整集合及旧覆盖保持', async t => {
  const f = serviceFixture(301); t.after(() => f.service.close());
  const args = { username: 'alice', subject_type: 2, result_mode: 'candidates', fields: ['id'], response_view: 'reference', source_limit: 100 };
  let page = await call(f.service, 'query_user_collections', args), first = page;
  while (page.coverage.incompleteSourceCount) {
    page = await call(f.service, 'query_user_collections', { ...args, collection_ref: page.collectionRef });
    assert.equal(page.candidateRef, first.candidateRef); assert.equal(page.resultRef, first.resultRef);
    assert.equal(f.service.candidates.sets.size + f.service.candidates.resultViews.size, 3);
  }
  assert.equal(page.set.resultCount, 301); assert.equal(page.coverage.complete, true);
  const old = await call(f.service, 'get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
  assert.equal(old.sources[0].scannedCount, 100); assert.equal(old.sources[0].nextOffset, 100);
});
test('独立搜索分支合并仍保留两来源；本人source续读账户改变拒绝', async t => {
  const f = serviceFixture(2); f.service.candidates.options.maxRefs = 12; t.after(() => f.service.close());
  const a = await call(f.service, 'search_subjects', { keyword: 'A', result_mode: 'candidates', fields: ['id'], limit: 1 });
  const b = await call(f.service, 'search_subjects', { keyword: 'B', result_mode: 'candidates', fields: ['id'], limit: 1, merge_ref: a.candidateRef });
  assert.notEqual(a.candidateRef, b.candidateRef); assert.equal(b.coverage.sourceCount, 2);
  let id = 7;
  const own = () => ({ ...anonymousContext(), mode: 'account', account: { id, username: 'viewer' }, source: 'p1' });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => own(), currentUser: async () => own().account,
    account: async () => ({ total: 2, data: [{ ...subject(1), nameCN: '作品1', interest: { type: 2, rate: 8, tags: [], private: false } }] }) });
  t.after(() => service.close());
  const args = { username: '-', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 1 };
  const first = await call(service, 'get_user_collections', args); id = 8;
  await assert.rejects(call(service, 'get_user_collections', { ...args, offset: 1, merge_ref: first.candidateRef }),
    error => ['CANDIDATE_SCOPE_MISMATCH', 'ACCOUNT_CHANGED'].includes(error.code));
});
test('出演原快照200页维持3refs，未知资格gap/旧cv及owner守卫不丢', async () => {
  const store = new CandidateStore({ maxRefs: 3 }), total = 200, snapshotRef = 'a'.repeat(32);
  const query = new PersonCandidates(store, { readPage: async args => {
    const offset = Number(args.offset), edge = { subject: subject(offset + 1) };
    const coverage = { complete: false, sourceComplete: false, sourceTotal: total, sourceReturnedCount: total,
      sourceUnit: 'appearance', relationTotal: total, matchedRelationTotal: total, matchedSubjectTotal: total,
      unknownSubjectFormIds: [199], unavailableSubjectIds: [], unavailableCollectionSubjectIds: [] };
    return { data: [edge], total, limit: 1, offset, nextOffset: offset + 1 < total ? offset + 1 : null,
      snapshotRef, coverage, candidateEvidence: { unknownRoleSubjectIds: [] } };
  } });
  const args = { person_id: 7, result_mode: 'candidates', fields: ['id'], limit: 1 };
  let page = await query.execute(args, binding, anonymousContext()), first = page;
  await assert.rejects(query.execute({ ...args, merge_ref: page.candidateRef, snapshot_ref: snapshotRef, offset: 1 }, { ...binding, accountId: 8 }, anonymousContext()),
    error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  while (page.sourcePage.nextOffset !== null) {
    const next = { ...args, merge_ref: page.candidateRef, snapshot_ref: snapshotRef, offset: page.sourcePage.nextOffset };
    page = await query.execute(next, binding, anonymousContext()); checkPersonCandidateResponse(page, next, findToolDefinition('get_person_characters').inputSchema);
    assert.equal(page.candidateRef, first.candidateRef); assert.equal(page.resultRef, first.resultRef);
    assert.equal(store.sets.size + store.resultViews.size, 3);
  }
  assert.equal(page.set.resultCount, total); assert.equal(page.appearanceStage.qualificationGapCount, 1);
  assert.equal(page.coverage.complete, false); assert.equal(page.appearanceStage.sourcePaginationComplete, true);
  assert.equal(store.getCoverage(first.coverage.coverageRef, binding).sources[0].scannedCount, 1);
});
