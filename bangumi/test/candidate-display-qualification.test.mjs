import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { prepareCandidateOutput } from '../dist/src/mcp/candidate-output.js';
import { expandResourceContent } from '../dist/src/output/resource-content.js';

const chosen = [218707, 218708, 1453, 72266, 531, 1940];
const binding = { turnId: 'display-qualification', accountId: null, scopeKey: 'public:sfw' };
const rawSubject = id => ({ id, type: 2, name: `原名${id}`, name_cn: `中文${id}`, date: '2020-01-01', nsfw: false,
  platform: 'TV', eps: 12, volumes: 0, rating: { score: 8.5, total: 100, rank: 5 },
  tags: [{ name: '百合', count: 10 }], meta_tags: ['TV'], summary: `简介${id}`, infobox: [],
  images: { large: `https://example.invalid/${id}.jpg` } });

test('真实subject_ids六部filter为空的MCP链路生成合法结果引用，prepare成功并保留六张封面和原顺序', async t => {
  const account = { id: 42, username: 'reader' }, reads = [];
  const context = () => ({ ...anonymousContext(), mode: 'account', source: 'p1', account });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => context(), currentUser: async () => account,
    public: async path => {
      reads.push(path); assert.match(path, /^\/v0\/subjects\/\d+$/); return rawSubject(Number(path.split('/').at(-1)));
    },
    account: async path => {
      reads.push(path); assert.match(path, /^\/p1\/subjects\/\d+$/);
      const raw = rawSubject(Number(path.split('/').at(-1)));
      return { ...raw, nameCN: raw.name_cn, info: '已核实完整作品', redirect: 0, seriesEntry: 0, locked: false, series: false,
        airtime: { date: raw.date }, collection: {}, platform: { name: 'TV' }, metaTags: raw.meta_tags, interest: null };
    } });
  t.after(() => service.close());
  const turn = { turnId: binding.turnId };
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, turn);
  const selected = await call('refine_subject_candidates', { subject_ids: chosen, filter: {},
    fields: ['id', 'name', 'nameCn', 'score', 'ratingCount', 'date', 'tags', 'summary', 'collectionStatus'], response_view: 'page', limit: 50 });
  assert.equal(selected.stage.remainingCount, 0); assert.equal(selected.stage.processedCount, 6);
  assert.notEqual(selected.resultRef, selected.candidateRef);
  const owner = service.candidates.peekBinding(selected.resultRef, turn.turnId).binding;
  const set = service.candidates.get(selected.resultRef, owner);
  assert.equal(set.refRole, 'result'); assert.ok(set.rows.every(row => row.facts.collectionState === 'not_collected'));
  assert.deepEqual(set.rows.map(row => row.id), chosen);
  const beforePrepare = reads.length;
  const prepared = await call('prepare_candidate_output', { candidate_ref: selected.resultRef, format: 'subject_cards', layout: 'grid',
    card_fields: ['nameCn', 'score', 'scoreCount', 'date', 'tags', 'image'], title: '已核推荐' });
  const cards = await expandResourceContent('SubjectCards', { resourceRef: prepared.resourceRef },
    (ref, signal, selection) => service.readCachedResource(ref, turn, signal, selection));
  assert.equal(cards.pending, false); assert.equal(cards.props.layout, 'grid');
  assert.equal(cards.props.title, '已核推荐'); assert.equal(cards.props.total, 6);
  assert.deepEqual(cards.props.items.map(item => item.id), chosen);
  assert.deepEqual(cards.props.items.map(item => item.image), chosen.map(id => `https://example.invalid/${id}.jpg`));
  assert.equal(reads.length, beforePrepare, '同一候选已取得的封面无需追加API读取');
  await assert.rejects(call('prepare_candidate_output', { candidate_ref: selected.candidateRef, format: 'subject_cards', card_fields: ['image'] }), error => {
    assert.equal(error.code, 'CANDIDATE_STAGE_INCOMPLETE');
    assert.equal(error.sourceTool, 'prepare_candidate_output');
    assert.equal(error.diagnostic.operation, 'prepare_candidate_output');
    assert.equal(error.diagnostic.issues.find(issue => issue.path === '/candidate_ref').expected, selected.resultRef);
    return true;
  });
  assert.equal(reads.length, beforePrepare, '错误引用不先补图片或改动来源');
});

test('首次原input和无真实resultRef的working字段读取创建资格，已通过result随后投影保持句柄', async () => {
  for (const refRole of ['input', 'working']) {
    const store = new CandidateStore(), origin = store.create({ binding, refRole, rows: chosen.map(id => ({ id,
      facts: { name: `作品${id}`, subjectType: 2, score: 8.5, image: `https://example.invalid/${id}.jpg` } })) });
    const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('已有事实不得重复补读'); } });
    const qualified = await query.execute({ candidate_ref: origin.ref, fields: ['id'], filter: {}, limit: 50 }, binding);
    assert.notEqual(qualified.resultRef, origin.ref); assert.equal(store.get(qualified.resultRef, binding).refRole, 'result');
    const projected = await query.execute({ candidate_ref: qualified.resultRef, fields: ['id', 'name', 'score'], filter: {}, limit: 50 }, binding);
    assert.equal(projected.candidateRef, qualified.resultRef); assert.equal(projected.resultRef, qualified.resultRef);
    assert.deepEqual(projected.data.map(row => row.id), chosen);
  }
});

test('尚未处理完的无筛选候选仍不能prepare，明确所选卡片读取保留原成员门禁', async () => {
  const store = new CandidateStore(), query = new CandidateQuery(store, { loadFacts: async row => ({ facts: {
    name: `作品${row.id}`, subjectType: 2, image: `https://example.invalid/${row.id}.jpg` } }) });
  const partial = await query.execute({ subject_ids: chosen, fields: ['id', 'name', 'subjectType'], filter: {}, limit: 2 }, binding);
  assert.equal(partial.stage.remainingCount, 4); assert.equal(store.get(partial.resultRef, binding).refRole, 'result');
  assert.throws(() => prepareCandidateOutput(store, { candidate_ref: partial.resultRef, format: 'subject_cards' }, binding), { code: 'CANDIDATE_STAGE_INCOMPLETE' });
});

test('未完成working字段续查沿真实stage推进，计数与result成员一致且resultRef上的续查游标有效', async () => {
  const store = new CandidateStore(), query = new CandidateQuery(store, { loadFacts: async row => ({ facts: {
    name: `作品${row.id}`, subjectType: 2, score: 8.5, image: `https://example.invalid/${row.id}.jpg` } }) });
  const first = await query.execute({ subject_ids: chosen, fields: ['id'], filter: {}, limit: 2 }, binding);
  const projected = await query.execute({ candidate_ref: first.candidateRef, fields: ['id', 'name'], filter: {}, limit: 2 }, binding);
  assert.equal(projected.candidateRef, first.candidateRef); assert.equal(projected.resultRef, first.resultRef);
  assert.match(projected.page.nextCursor, /^cc_/);
  assert.equal(projected.set.resultCount, store.get(projected.resultRef, binding).rows.length);
  const next = store.continuationArgs(projected.resultRef, projected.page.nextCursor, binding, { limit: 100 });
  const complete = await query.execute(next, binding);
  assert.equal(complete.stage.remainingCount, 0); assert.equal(complete.stage.matchedCount, 6);
  assert.equal(complete.set.resultCount, 6); assert.deepEqual(store.get(complete.resultRef, binding).rows.map(row => row.id), chosen);
  assert.equal(prepareCandidateOutput(store, { candidate_ref: complete.resultRef, format: 'subject_cards' }, binding).counts.preparedCount, 6);
});

test('完成的producer工作句柄仅在全部成员等价时转真实result，字段分页持续复用3ref且cp绑定返回结果', async () => {
  const store = new CandidateStore({ maxRefs: 3 }), source = { tool: 'search_subjects', source: 'v0', scope: '{"keyword":"百合"}',
    complete: false, scannedCount: 6, total: 12, nextOffset: 6, privateRecords: 'not_applicable' };
  const raw = store.create({ binding, rows: chosen.map(id => ({ id, facts: { name: `作品${id}`, subjectType: 2, score: 8.5 } })), sources: [source] });
  let reads = 0;
  const query = new CandidateQuery(store, { loadFacts: async () => { reads++; throw Error('全部事实已在同一来源缓存'); } });
  const producer = await query.execute({ candidate_ref: raw.ref, fields: ['id'], response_view: 'reference' }, binding, undefined, undefined,
    { processIds: chosen, preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false });
  assert.equal(producer.stage.remainingCount, 0); assert.equal(producer.stage.pendingCount, 0);
  assert.equal(store.get(producer.candidateRef, binding).rows.length, store.get(producer.resultRef, binding).rows.length);
  const args = { candidate_ref: producer.candidateRef, fields: ['id', 'name'], limit: 2 };
  let page = await query.execute(args, binding);
  assert.equal(page.candidateRef, producer.resultRef); assert.equal(page.resultRef, producer.resultRef);
  assert.equal(page.scope.candidate_ref, producer.candidateRef);
  assert.match(page.page.nextCursor, /^cp_/);
  assert.equal(store.projectionWindows.has(producer.candidateRef), false);
  assert.equal(store.projectionWindows.has(producer.resultRef), true);
  const ids = [];
  do {
    ids.push(...page.data.map(row => row.id));
    assert.equal(store.sets.size + store.resultViews.size, 3);
    assert.equal(page.coverage.complete, false, '当前成员处理完成不能抹掉母源未耗尽的缺口');
    if (page.page.nextCursor) page = await query.execute(store.continuationArgs(page.resultRef, page.page.nextCursor, binding), binding);
    else break;
  } while (true);
  assert.deepEqual(ids, chosen); assert.equal(reads, 0);
  const again = await query.execute(args, binding);
  assert.equal(again.candidateRef, producer.resultRef); assert.equal(store.sets.size + store.resultViews.size, 3);
});

test('pending或工作/结果成员不同的句柄不能按完成别名投影，必须重核资格而不扩大已通过成员', async () => {
  const store = new CandidateStore({ maxRefs: 3 });
  const raw = store.create({ binding, rows: [{ id: 1, facts: { name: '已通过', subjectType: 2, score: 8.5 } },
    { id: 2, facts: { name: '必要评分未知', subjectType: 2, score: null }, fieldStates: { score: 'unknown' } }], factFilters: [{ rating: { min: 8 } }] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const first = await query.execute({ candidate_ref: raw.ref, fields: ['id'], filter: {}, limit: 50 }, binding);
  assert.equal(first.stage.remainingCount, 0); assert.equal(first.stage.pendingCount, 1);
  const projected = await query.execute({ candidate_ref: first.candidateRef, fields: ['id', 'name'], filter: {}, limit: 50 }, binding);
  assert.equal(projected.candidateRef, first.candidateRef); assert.notEqual(projected.candidateRef, projected.resultRef);
  assert.equal(projected.stage.pendingCount, 1); assert.deepEqual(projected.data.map(row => row.id), [1]);
  assert.deepEqual(store.get(projected.resultRef, binding).rows.map(row => row.id), [1]);
  assert.equal(store.sets.size + store.resultViews.size, 3);
});

test('仅complete计数不足以规范工作引用，工作与真实result成员不相等时沿cc重建一致资格', async () => {
  const store = new CandidateStore({ maxRefs: 3 });
  const rows = [1, 2].map(id => ({ id, facts: { name: `作品${id}`, subjectType: 2 } }));
  const raw = store.create({ binding, rows });
  const working = store.create({ binding, rows, parentRef: raw.ref, refRole: 'working', resultIds: [1], qualification: {
    inputCount: 2, processedCount: 2, matchedCount: 1, excludedCount: 1, pendingCount: 0, remainingCount: 0,
    filter: {}, originRef: raw.ref, matchedIds: [1], pendingIds: [], remainingIds: [], complete: true } });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('缓存名称已取得'); } });
  const page = await query.execute({ candidate_ref: working.ref, fields: ['id', 'name'], filter: {}, limit: 1 }, binding);
  assert.equal(page.candidateRef, working.ref); assert.equal(page.resultRef, working.resultRef);
  assert.match(page.page.nextCursor, /^cc_/); assert.equal(page.stage.remainingCount, 1);
  assert.equal(page.set.resultCount, store.get(page.resultRef, binding).rows.length);
  assert.equal(store.sets.size + store.resultViews.size, 3);
});

test('默认或未请求image的准备卡片自动保留同一候选的known封面，未知地址不捏造且其他字段投影仍闭合', () => {
  const store = new CandidateStore(), set = store.create({ binding, refRole: 'result', rows: [
    { id: 1, facts: { name: '有图', subjectType: 2, score: 8.5, image: 'https://example.invalid/1.jpg' } },
    { id: 2, facts: { name: '未知封面', subjectType: 2, image: null }, fieldStates: { image: 'unknown' } },
  ] });
  for (const cardFields of [undefined, [], ['score']]) {
    const output = prepareCandidateOutput(store, { candidate_ref: set.ref, format: 'subject_cards', ...(cardFields ? { card_fields: cardFields } : {}) }, binding);
    const items = output.presentation.content.find(part => part.type === 'SubjectCards').props.items;
    assert.equal(items[0].image, 'https://example.invalid/1.jpg'); assert.equal(items[1].image, undefined);
    assert.equal(items[0].score, cardFields?.includes('score') ? 8.5 : undefined);
  }
});
