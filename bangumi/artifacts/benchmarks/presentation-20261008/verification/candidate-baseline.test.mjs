import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateReaders } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/candidate-readers.js';
import { CandidateStore, candidateRow } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/candidate-store.js';
import { CandidateQuery } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/candidate-query.js';
import { checkCandidateResponse } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/candidate-contract.js';
import { anonymousContext } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/access-context.js';
import { AppError } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/support/errors.js';
import { CANDIDATE_SUBJECT_FACT_FIELDS } from 'file:///E:/Project/BangumiAgent-pi-publish/bangumi/artifacts/benchmarks/presentation-20261008/control-runtime/bangumi/dist/src/mcp/candidate-contract.js';

const publicBinding = { turnId: 'readers-turn', accountId: null, scopeKey: 'public:sfw' };
const account = { id: 7, username: 'reader_user' };
const privateBinding = { ...publicBinding, accountId: account.id, scopeKey: 'account:7' };
const ownContext = { ...anonymousContext(), mode: 'account', account, source: 'p1' };
function detail(id, include = []) {
  return { id, name: '动画', nameCn: null, subjectType: 2, date: null, platform: 'TV', nsfw: false, score: 8, rank: 100,
    ratingCount: 3000, tags: null, metaTags: null, url: `https://bgm.tv/subject/${id}`,
    ...(include.includes('summary') ? { summary: '已核实简介' } : {}), ...(include.includes('infobox') ? { infobox: [] } : {}),
    accessContext: anonymousContext() };
}
const baseFacts = id => ({ id, name: `作品${id}`, nameCn: `中文${id}`, subjectType: 2, platform: 'TV', subjectForm: 'tv',
  date: '2025-01-01', nsfw: false, score: 8, rank: 100, ratingCount: 200, tags: ['公开标签'], metaTags: ['TV'], url: `https://bgm.tv/subject/${id}` });

test('候选补证日期收敛零占位为未知并保留真实年月精度，原DTO不改写', async () => {
  for (const [raw, expected] of [['0000-00-00', null], ['2026-00-00', '2026'], ['2026-10-00', '2026-10'], ['2026-00-06', null], ['2026-10-06', '2026-10-06']]) {
    const value = { ...detail(1), date: raw };
    const reader = new CandidateReaders({ details: async () => value, collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
    const patch = await reader.load(candidateRow({ id: 1, facts: {} }), ['date'], []);
    assert.equal(patch.facts.date, expected); assert.equal(value.date, raw);
  }
});

test('内部cache补缺marker保留更新的known基础事实，显式组正常解析且不泄漏marker', async () => {
  const row = candidateRow({ id: 1, facts: { ...baseFacts(1), name: '更新名称', score: 6, platform: 'OVA', metaTags: ['OVA'],
    subjectForm: null, rank: null, durationMinutes: 12 } });
  const readers = new CandidateReaders({ details: async (id, include) => ({ ...detail(id, include), metaTags: ['TV'],
    infobox: [{ key: '每集时长', value: '6分钟' }], candidateCacheSupplementOnly: true }),
    collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
  const patch = await readers.load(row, ['summary', 'infobox', 'rank', 'subjectForm'], ['summary', 'infobox']);
  assert.equal(patch.facts.name, undefined); assert.equal(patch.facts.score, undefined); assert.equal(patch.facts.platform, undefined); assert.equal(patch.facts.metaTags, undefined);
  assert.equal(patch.facts.rank, 100); assert.equal(patch.facts.subjectForm, 'ova'); assert.equal(patch.facts.durationMinutes, undefined);
  assert.equal(patch.facts.summary, '已核实简介'); assert.deepEqual(patch.facts.infobox, [{ key: '每集时长', value: '6分钟' }]);
  assert.equal(JSON.stringify(patch).includes('candidateCacheSupplementOnly'), false); assert.equal(row.facts.score, 6); assert.equal(row.facts.durationMinutes, 12);
});

test('fresh原生HTTP不带cache marker时仍更新known基础事实，供当前filter复核', async () => {
  const row = candidateRow({ id: 1, facts: baseFacts(1) });
  const readers = new CandidateReaders({ details: async (id, include) => ({ ...detail(id, include), score: 6 }),
    collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
  const patch = await readers.load(row, ['summary'], ['summary']);
  assert.equal(patch.facts.score, 6); assert.equal(patch.facts.summary, '已核实简介'); assert.equal(row.facts.score, 8);
});

test('基础字段全已知时复用宿主事实，reader与reference均0 HTTP', async () => {
  let calls = 0; const readers = new CandidateReaders({ details: async () => { calls++; throw Error('已有基础事实无需再读'); },
    collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
  const known = candidateRow({ id: 1, facts: baseFacts(1) });
  const patch = await readers.load(known, [], ['subject_facts']); assert.deepEqual(patch.facts, {}); assert.equal(calls, 0);
  const store = new CandidateStore(), origin = store.create({ binding: publicBinding, rows: [known], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include, signal) => readers.load(row, fields, include, signal) });
  const args = { candidate_ref: origin.ref, fields: ['id', 'summary'], response_view: 'reference' };
  const response = await query.execute(args, publicBinding, anonymousContext()); checkCandidateResponse(response, args);
  assert.deepEqual(response.data, []); assert.equal(response.coverage.unknownFieldCount, 0); assert.equal(response.coverage.complete, true); assert.equal(calls, 0);
});

test('事实filter触发缺失基础资源，附带字段缓存但reference展示提示不展开正文或本人', async () => {
  const calls = [], readers = new CandidateReaders({ details: async (id, include) => { calls.push([id, include]);
    const { subjectForm, ...value } = baseFacts(id); return { ...value, accessContext: anonymousContext() }; },
    collection: async () => { throw Error('基础组不读取本人'); }, relations: async () => { throw Error('基础组不读取关系'); } });
  const store = new CandidateStore(), origin = store.create({ binding: publicBinding, rows: [{ id: 1, facts: {} }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include, signal) => readers.load(row, fields, include, signal) });
  const args = { candidate_ref: origin.ref, fields: ['id', 'summary', 'infobox'], filter: { rating: { min: 0 } }, response_view: 'reference' };
  const response = await query.execute(args, publicBinding, anonymousContext()); checkCandidateResponse(response, args);
  assert.deepEqual(calls, [[1, []]]); assert.deepEqual(response.data, []); assert.equal(response.coverage.complete, true);
  const cached = store.get(response.resultRef, publicBinding).rows[0];
  for (const field of CANDIDATE_SUBJECT_FACT_FIELDS) assert.equal(cached.fieldStates[field], 'known');
  assert.deepEqual(cached.facts.tags, ['公开标签']); assert.equal(cached.facts.subjectForm, 'tv');
  assert.equal(cached.facts.summary, undefined); assert.equal(cached.facts.infobox, undefined); assert.equal(cached.facts.collectionState, undefined);
  assert.deepEqual(JSON.parse(cached.sources[0].scope), { subject_id: 1, include: [] });
  const pageArgs = { candidate_ref: response.resultRef, fields: ['id', 'subjectForm', 'tags', 'score'] };
  const page = await query.execute(pageArgs, publicBinding, anonymousContext()); checkCandidateResponse(page, pageArgs); assert.equal(calls.length, 1);
  assert.deepEqual(page.data, [{ id: 1, subjectForm: 'tv', tags: ['公开标签'], score: 8 }]);
});

test('廉价评分先淘汰，reference仅为必要形式事实补证并保持4个在途上限', async () => {
  let active = 0, maximum = 0; const ids = [], readers = new CandidateReaders({ details: async (id, include) => {
    ids.push(id); assert.deepEqual(include, []); active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    const { subjectForm, ...value } = baseFacts(id); return { ...value, accessContext: anonymousContext() };
  }, collection: async () => { throw Error('基础组不读取本人'); }, relations: async () => { throw Error('基础组不读取关系'); } });
  const store = new CandidateStore(), origin = store.create({ binding: publicBinding,
    rows: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, facts: { score: index === 0 ? 5 : 8 } })), sources: [] });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include, signal) => readers.load(row, fields, include, signal) });
  const args = { candidate_ref: origin.ref, filter: { rating: { min: 7 }, subject_form: ['tv'] }, fields: ['id'], response_view: 'reference', limit: 1 };
  const result = await query.execute(args, publicBinding, anonymousContext()); checkCandidateResponse(result, args);
  assert.deepEqual(ids, [2, 3, 4, 5, 6, 7, 8, 9]); assert.equal(maximum, 4); assert.equal(active, 0);
  assert.equal(result.stage.excludedCount, 1); assert.equal(result.stage.matchedCount, 8); assert.equal(result.stage.processedCount, 9);
  assert.deepEqual(result.data, []); assert.equal(result.coverage.complete, true);
});

test('fields实际缺失保存unknown缺口，同组已查无资料的字段不重复读取', async () => {
  let calls = 0; const readers = new CandidateReaders({ details: async id => { calls++; const { subjectForm, ...value } = baseFacts(id);
    return { ...value, tags: null, accessContext: anonymousContext() }; }, collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
  const store = new CandidateStore(), origin = store.create({ binding: publicBinding, rows: [{ id: 1, facts: {} }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include, signal) => readers.load(row, fields, include, signal) });
  const args = { candidate_ref: origin.ref, fields: ['id', 'tags'] }, first = await query.execute(args, publicBinding, anonymousContext());
  checkCandidateResponse(first, args); assert.equal(first.coverage.unknownFieldCount, 1); assert.equal(first.coverage.complete, false);
  const againArgs = { ...args, candidate_ref: first.candidateRef }, again = await query.execute(againArgs, publicBinding, anonymousContext()); checkCandidateResponse(again, againArgs);
  assert.equal(again.coverage.unknownFieldCount, 1); assert.equal(calls, 1); assert.equal(store.get(again.resultRef, publicBinding).rows[0].fieldStates.tags, 'unknown');
});

test('fields公共读取超时保留failed，下一次明确refine可补全原集合字段', async () => {
  let calls = 0; const readers = new CandidateReaders({ details: async id => {
    if (++calls === 1) throw new AppError('BGM_TIMEOUT', '基础资料读取超时');
    return { ...baseFacts(id), accessContext: anonymousContext() }; },
    collection: async () => { throw Error('不应读本人'); }, relations: async () => { throw Error('不应读关系'); } });
  const store = new CandidateStore(), origin = store.create({ binding: publicBinding, rows: [{ id: 1, facts: {} }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include, signal) => readers.load(row, fields, include, signal) });
  const args = { candidate_ref: origin.ref, fields: [...CANDIDATE_SUBJECT_FACT_FIELDS] };
  const result = await query.execute(args, publicBinding, anonymousContext()); checkCandidateResponse(result, args);
  assert.equal(result.coverage.failedFieldCount, CANDIDATE_SUBJECT_FACT_FIELDS.length - 1); assert.equal(result.coverage.complete, false);
  const cached = store.get(result.resultRef, publicBinding).rows[0]; assert.equal(cached.fieldStates.tags, 'failed'); assert.equal(cached.failureCodes.tags, 'BGM_TIMEOUT');
  const againArgs = { ...args, candidate_ref: result.candidateRef }, again = await query.execute(againArgs, publicBinding, anonymousContext()); checkCandidateResponse(again, againArgs);
  console.log("CANDIDATE_DEBUG", JSON.stringify({ coverage: again.coverage, stage: again.stage, row: store.get(again.resultRef, publicBinding).rows[0] })); assert.equal(calls, 2); assert.equal(again.coverage.failedFieldCount, 0); assert.equal(again.coverage.complete, true);
  assert.equal(store.get(again.resultRef, publicBinding).rows[0].fieldStates.tags, 'known');
  assert.equal(store.get(again.resultRef, publicBinding).rows[0].failureCodes.tags, undefined);
});

test('公共组成功、个人组超时只标个人失败，已取得公共事实可复用且后续只补简介', async () => {
  const calls = [];
  const readers = new CandidateReaders({
    details: async (id, include) => { calls.push({ group: 'details', id, include }); return detail(id, include); },
    collection: async id => { calls.push({ group: 'collection', id }); throw new AppError('BGM_TIMEOUT', '模拟个人读取超时'); },
    relations: async () => { throw Error('本场景不应读取关系'); },
  });
  const store = new CandidateStore();
  const origin = store.create({ binding: privateBinding, rows: [{ id: 1, facts: {} }], sources: [], visibility: 'self', account });
  const requestedGroups = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields, include, signal) => {
    requestedGroups.push([...fields]); return readers.load(row, fields, include, signal);
  } });
  const args = { candidate_ref: origin.ref, fields: ['id', 'score', 'personalRating'] };
  const first = await query.execute(args, privateBinding, ownContext);
  assert.deepEqual(first.data, [{ id: 1, score: 8, personalRating: null, fieldStates: { personalRating: 'failed' } }]);
  const cached = store.get(first.candidateRef, privateBinding).rows[0];
  assert.equal(cached.fieldStates.score, 'known'); assert.equal(cached.fieldStates.personalRating, 'failed');
  assert.equal(cached.failureCodes.personalRating, 'BGM_TIMEOUT'); assert.equal(cached.facts.ratingCount, 3000);
  assert.ok(cached.resolvedFields.includes('nameCn')); assert.ok(cached.resolvedFields.includes('personalRating'));
  assert.deepEqual(calls.map(call => call.group), ['details', 'collection']); checkCandidateResponse(first, args);

  const nextArgs = { candidate_ref: first.candidateRef, fields: ['id', 'score'], filter: { rating: { min: 7.5 } } };
  const scoreOnly = await query.execute(nextArgs, privateBinding, ownContext);
  assert.deepEqual(scoreOnly.data, [{ id: 1, score: 8 }]); assert.equal(calls.length, 2); checkCandidateResponse(scoreOnly, nextArgs);

  const described = await query.execute({ candidate_ref: scoreOnly.candidateRef, fields: ['id', 'score', 'summary'] }, privateBinding, ownContext);
  assert.equal(described.data[0].summary, '已核实简介'); assert.equal(calls.length, 3);
  assert.deepEqual(requestedGroups, [['score', 'personalRating'], ['summary']]);
  assert.deepEqual(calls[2], { group: 'details', id: 1, include: ['summary'] });
});

test('关系仅取得当前100条窗口时保留真实总数及nextOffset，不声称关系来源穷尽', async () => {
  let relationCalls = 0;
  const relations = Array.from({ length: 100 }, (_, index) => ({ id: index + 2, relation: '其他' }));
  const readers = new CandidateReaders({
    details: async () => { throw Error('关系请求不应读取详情'); },
    collection: async () => { throw Error('关系请求不应读取个人收藏'); },
    relations: async id => { relationCalls++; return { data: relations,
      scope: { subject_id: id, limit: 100, offset: 0 }, page: { total: 150, limit: 100, offset: 0, returnedCount: 100, nextOffset: 100, complete: false },
      visibility: 'public', accessContext: anonymousContext() }; },
  });
  const patch = await readers.load(candidateRow({ id: 1, facts: {} }), ['relations'], ['relations']);
  assert.equal(relationCalls, 1); assert.equal(patch.facts.relations.length, 100);
  assert.deepEqual(patch.sources.map(source => ({ tool: source.tool, complete: source.complete, scannedCount: source.scannedCount, total: source.total, nextOffset: source.nextOffset })),
    [{ tool: 'get_subject_relations', complete: false, scannedCount: 100, total: 150, nextOffset: 100 }]);

  const store = new CandidateStore(); const origin = store.create({ binding: publicBinding, rows: [{ id: 1, facts: {} }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: async (row, fields, include) => readers.load(row, fields, include) });
  const args = { candidate_ref: origin.ref, fields: ['id', 'relations'] };
  const result = await query.execute(args, publicBinding, anonymousContext());
  assert.equal(result.page.complete, true); assert.equal(result.coverage.complete, false);
  const coverage = query.readCoverage({ coverage_ref: result.coverage.coverageRef }, publicBinding, anonymousContext());
  assert.equal(coverage.sources[0].nextOffset, 100); assert.equal(result.coverage.sources, undefined); checkCandidateResponse(result, args);
});

test('一次详情附带的null字段保留unknown及已读标记，下次投影同组字段不重复网络读取', async () => {
  const calls = [];
  const readers = new CandidateReaders({
    details: async (id, include) => { calls.push({ id, include }); return detail(id, include); },
    collection: async () => { throw Error('公共字段不应读取个人收藏'); },
    relations: async () => { throw Error('公共字段不应读取关系'); },
  });
  const store = new CandidateStore(); const origin = store.create({ binding: publicBinding, rows: [{ id: 1, facts: {} }], sources: [] });
  const requested = [];
  const query = new CandidateQuery(store, { loadFacts: async (row, fields, include) => { requested.push([...fields]); return readers.load(row, fields, include); } });
  const first = await query.execute({ candidate_ref: origin.ref, fields: ['id', 'score'] }, publicBinding, anonymousContext());
  assert.equal(calls.length, 1);
  const args = { candidate_ref: first.candidateRef, fields: ['id', 'nameCn', 'date', 'tags'] };
  const nulls = await query.execute(args, publicBinding, anonymousContext());
  assert.deepEqual(nulls.data, [{ id: 1, nameCn: null, date: null, tags: null, fieldStates: { nameCn: 'unknown', date: 'unknown', tags: 'unknown' } }]);
  assert.equal(calls.length, 1); checkCandidateResponse(nulls, args);
  const infobox = await query.execute({ candidate_ref: nulls.candidateRef, fields: ['id', 'infobox'] }, publicBinding, anonymousContext());
  assert.deepEqual(infobox.data[0].infobox, []); assert.equal(calls.length, 2);
  assert.deepEqual(requested, [['score'], ['infobox']]); assert.deepEqual(calls[1].include, ['infobox']);
});
