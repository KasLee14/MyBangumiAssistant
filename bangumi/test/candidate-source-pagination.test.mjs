import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';

const subject = (id, extra = {}) => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`, date: '2026-10-01', nsfw: false,
  platform: 'TV', tags: [], meta_tags: ['TV'], rating: { score: 8, total: 100 }, ...extra });
const collected = (id, extra = {}) => ({ subject_id: id, subject: subject(id, extra), type: 2, rate: 8, tags: [], private: false });
const read = async (service, name, args) => {
  const result = await service.call(name, args, undefined, undefined, undefined, { turnId: 'source-pagination' });
  checkAccessResponse(name, result); return result;
};
function fixture(path, rows) {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => { throw Error('公开来源不读取账户'); },
    public: async (actual, options) => {
      assert.equal(actual, path); const { offset, limit } = options.query; calls.push({ offset, limit });
      return { total: rows.length, data: rows.slice(offset, offset + limit), offset, limit };
    },
  });
  return { service, calls };
}
const detail = (service, response) => read(service, 'get_candidate_coverage', { coverage_ref: response.coverage.coverageRef });
const collectionArgs = { username: 'alice', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 2 };

test('search连续空尾同源结束nextnull但estimate不变完整，缓存行不会复活旧游标且旧cov不改', async t => {
  const f = fixture('/v0/search/subjects', Array.from({ length: 20 }, (_, i) => subject(i + 1))); t.after(() => f.service.close());
  const args = { keyword: '作品', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 20 };
  const first = await read(f.service, 'search_subjects', args); assert.equal(first.sourcePage.nextOffset, 20);
  const last = await read(f.service, 'search_subjects', { ...args, offset: 20, merge_ref: first.candidateRef });
  assert.equal(last.sourcePage.nextOffset, null); assert.equal(last.set.resultCount, 20);
  const now = await detail(f.service, last), old = await detail(f.service, first);
  assert.equal(now.sources.length, 1); assert.equal(now.sources[0].scannedCount, 20); assert.equal(now.sources[0].nextOffset, null);
  assert.equal(now.sources[0].complete, false); assert.equal(now.sources[0].readState.pagesRead, 2); assert.equal(now.sources[0].readState.continuous, true);
  assert.equal(now.sources[0].readState.totalKind, 'estimated'); assert.equal(old.sources[0].nextOffset, 20);
  const scope = JSON.parse(now.sources[0].scope);
  for (const key of ['offset', 'limit', 'merge_ref', 'fields', 'response_view', 'result_mode']) assert.equal(Object.hasOwn(scope, key), false);
  assert.equal(scope.keyword, '作品'); assert.equal(scope.subject_type, 2);
});

test('exact收藏从0按正确来源游标连续读完可complete，展示页/旧coverage仍保持各自语义', async t => {
  const f = fixture('/v0/users/alice/collections', [collected(1), collected(2), collected(3)]); t.after(() => f.service.close());
  const first = await read(f.service, 'get_user_collections', collectionArgs);
  const last = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: first.sourcePage.nextOffset, merge_ref: first.candidateRef });
  const source = (await detail(f.service, last)).sources[0];
  assert.equal(source.complete, true); assert.equal(last.coverage.complete, true); assert.equal(source.scannedCount, 3);
  assert.equal(source.readState.firstOffset, 0); assert.equal(source.readState.continuous, true); assert.equal(source.readState.totalKind, 'exact');
  assert.equal(last.set.resultCount, 3); assert.equal(source.nextOffset, null);
  const old = (await detail(f.service, first)).sources[0]; assert.equal(old.complete, false); assert.equal(old.nextOffset, 2); assert.equal(old.scannedCount, 2);
});

test('exact非0起读、跳页和同merge_ref重读不能伪装来源完整', async t => {
  const f = fixture('/v0/users/alice/collections', [collected(1), collected(2), collected(3)]); t.after(() => f.service.close());
  const nonzero = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: 2 });
  const nonzeroSource = (await detail(f.service, nonzero)).sources[0]; assert.equal(nonzeroSource.readState.firstOffset, 2); assert.equal(nonzeroSource.complete, false);
  const first = await read(f.service, 'get_user_collections', collectionArgs);
  const skipped = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: 4, merge_ref: first.candidateRef });
  const skippedSource = (await detail(f.service, skipped)).sources[0]; assert.equal(skippedSource.nextOffset, null); assert.equal(skippedSource.readState.continuous, false); assert.equal(skippedSource.complete, false);
  const repeated = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: 0, merge_ref: first.candidateRef });
  const final = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: 2, merge_ref: repeated.candidateRef });
  assert.equal((await detail(f.service, final)).sources[0].readState.continuous, false); assert.equal(final.coverage.complete, false);
});

test('独立从0一次新读的revision可胜旧多页缓存来源，不借旧merge链也不丢全读证明', async t => {
  const f = fixture('/v0/users/alice/collections', [collected(1), collected(2), collected(3)]); t.after(() => f.service.close());
  const first = await read(f.service, 'get_user_collections', collectionArgs);
  await read(f.service, 'get_user_collections', { ...collectionArgs, offset: 2, merge_ref: first.candidateRef });
  const independent = await read(f.service, 'get_user_collections', { ...collectionArgs, limit: 3 });
  const source = (await detail(f.service, independent)).sources[0];
  assert.equal(source.readState.pagesRead, 1); assert.equal(source.readState.continuous, true); assert.equal(source.complete, true);
});

test('浏览未知日期跨页累计且不改来源身份，200未知ID可审计而末页不能清gap', async t => {
  const rows = Array.from({ length: 201 }, (_, i) => subject(i + 1, { date: i < 200 ? '2026' : '2026-10-01' }));
  const f = fixture('/v0/subjects', rows); t.after(() => f.service.close());
  const args = { subject_type: 2, sort: 'date', year: 2026, month: 10, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 100 };
  const first = await read(f.service, 'browse_subjects', args);
  const second = await read(f.service, 'browse_subjects', { ...args, offset: 100, merge_ref: first.candidateRef });
  const last = await read(f.service, 'browse_subjects', { ...args, offset: 200, merge_ref: second.candidateRef });
  assert.equal(last.coverage.sourceCount, 1); assert.equal(last.coverage.sources, undefined); assert.equal(last.sourcePage.nextOffset, null);
  const source = (await detail(f.service, last)).sources[0], coverage = source.readState.filterCoverage;
  assert.equal(source.complete, false); assert.equal(source.scannedCount, 201); assert.equal(coverage.unknownDateCount, 200);
  assert.deepEqual(coverage.unknownDateSubjectIds, Array.from({ length: 200 }, (_, i) => i + 1)); assert.equal(coverage.complete, false);
  assert.equal(coverage.scannedCount, 201); assert.equal(coverage.matchedCount, 1); assert.equal(source.readState.continuous, true);
  assert.equal(JSON.parse(source.scope).filterCoverage, undefined); assert.equal(JSON.parse(source.scope).month, 10);
  const old = (await detail(f.service, first)).sources[0].readState.filterCoverage; assert.equal(old.unknownDateCount, 100); assert.equal(old.unknownDateSubjectIds.length, 100);
});

test('浏览重读未知ID去重计数且continuous保持false，不能用新末窗掩盖原精度缺口', async t => {
  const f = fixture('/v0/subjects', [subject(1, { date: '2026' }), subject(2, { date: '2026-10-01' })]); t.after(() => f.service.close());
  const args = { subject_type: 2, sort: 'date', year: 2026, month: 10, result_mode: 'candidates', response_view: 'reference', fields: ['id'], limit: 1 };
  const first = await read(f.service, 'browse_subjects', args);
  const repeated = await read(f.service, 'browse_subjects', { ...args, merge_ref: first.candidateRef });
  const last = await read(f.service, 'browse_subjects', { ...args, offset: 1, merge_ref: repeated.candidateRef });
  const source = (await detail(f.service, last)).sources[0]; assert.equal(source.readState.continuous, false); assert.equal(source.complete, false);
  assert.deepEqual(source.readState.filterCoverage.unknownDateSubjectIds, [1]); assert.equal(source.readState.filterCoverage.unknownDateCount, 1);
});

test('NSFW缺口跨exact末页保留，首个有排除页不能被末页完整标记冲掉', async t => {
  const f = fixture('/v0/users/alice/collections', [collected(1), collected(2, { nsfw: true }), collected(3)]); t.after(() => f.service.close());
  const first = await read(f.service, 'get_user_collections', collectionArgs);
  const last = await read(f.service, 'get_user_collections', { ...collectionArgs, offset: first.sourcePage.nextOffset, merge_ref: first.candidateRef });
  const source = (await detail(f.service, last)).sources[0];
  assert.equal(source.readState.excludedNsfwCount, 1); assert.equal(source.nextOffset, null); assert.equal(source.complete, false); assert.equal(last.coverage.complete, false);
  assert.equal(source.scannedCount, 3); assert.equal((await detail(f.service, first)).sources[0].readState.excludedNsfwCount, 1);
});
