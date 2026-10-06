import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { prepareCandidateTable } from '../dist/src/mcp/candidate-presentation.js';
import { candidatePresentationInputSchema, candidatePresentationOutputSchema, checkCandidatePresentationResponse,
  validateCandidatePresentationArgs } from '../dist/src/mcp/candidate-presentation-contract.js';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { compileSchema, schemaArguments } from '../dist/src/support/tool-schema.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';

const binding = { turnId: 'presentation', accountId: null, scopeKey: 'public:sfw' };
const seeds = count => Array.from({ length: count }, (_, index) => ({ id: index + 1,
  facts: { name: `作品 ${index + 1}`, nameCn: `中文作品 ${index + 1}`, subjectType: 2 } }));
function result(rows, extra = {}) {
  const store = new CandidateStore();
  const set = store.create({ binding, rows, sources: [], refRole: 'result', ...extra });
  return { store, set };
}

test('小输入契约只允许显示字段和窗口，默认最少两列', () => {
  const args = schemaArguments(candidatePresentationInputSchema, { candidate_ref: 'ref' });
  assert.deepEqual(args.fields, ['displayName', 'url']);
  assert.equal(args.lineage, 'none'); assert.equal(args.lineage_format, 'names'); assert.equal(args.limit, 200); assert.equal(args.max_bytes, 16000);
  for (const input of [{}, { candidate_ref: 'x', fields: [] }, { candidate_ref: 'x', fields: ['summary'] },
    { candidate_ref: 'x', fields: ['name', 'name'] }, { candidate_ref: 'x', limit: 201 },
    { candidate_ref: 'x', max_bytes: 1023 }, { candidate_ref: 'x', max_bytes: 65537 },
    { candidate_ref: 'x', filter: {} }, { candidate_ref: 'x', lineage: 'short' }, { candidate_ref: 'x', lineage_format: 'compact' }])
    assert.throws(() => validateCandidatePresentationArgs(input), error => error.code === 'INVALID_INPUT');
});

test('默认缓存名称与真ID链接可直接经过现有provider解码器，原集合不改', () => {
  const { store, set } = result(seeds(3));
  const before = store.get(set.ref, binding);
  const args = { candidate_ref: set.ref };
  const value = prepareCandidateTable(store, args, binding, anonymousContext(), () => { throw new Error('默认不得读取lineage'); });
  assert.equal(compileSchema(candidatePresentationOutputSchema)({ value }), true);
  checkCandidatePresentationResponse(value, args);
  assert.deepEqual(value.presentation.props.rows[0], { displayName: '中文作品 1', url: 'https://bgm.tv/subject/1' });
  assert.equal(value.counts.unknownFieldCount, 0);
  assert.equal(value.wholePlan.fit, true);
  assert.equal(value.wholePlan.maxWholeWireBytes, 40000);
  assert.equal(value.page.complete, true);
  assert.equal(Object.hasOwn(value, 'data'), false);
  assert.equal(value.presentation.pending, false);
  const decoder = new ContentDecoder(); decoder.feed(JSON.stringify({ content: [value.presentation] }));
  const canonical = decoder.finish();
  assert.equal(canonical.content[0].pending, false);
  assert.equal(canonical.content[0].props.rows[0].displayName, '中文作品 1');
  assert.deepEqual(store.get(set.ref, binding), before);
});

test('名称回退、数值0和缺失单元格不编造事实', () => {
  const { store, set } = result([{ id: 7, facts: { score: 0, rank: 1, ratingCount: 0 } }]);
  const value = prepareCandidateTable(store, { candidate_ref: set.ref,
    fields: ['displayName', 'id', 'name', 'date', 'score', 'rank', 'ratingCount', 'collectionStatus'] }, binding);
  assert.deepEqual(value.presentation.props.rows, [{ displayName: '#7', id: '7', name: '', date: '', score: '0', rank: '1', ratingCount: '0', collectionStatus: '' }]);
  assert.equal(value.counts.unknownFieldCount, 4);
});

test('每块最多200行，后续offset保持成员与顺序且无丢失', () => {
  const { store, set } = result(seeds(205));
  const first = prepareCandidateTable(store, { candidate_ref: set.ref, max_bytes: 65536 }, binding);
  assert.equal(first.page.returnedCount, 200); assert.equal(first.page.nextOffset, 200);
  const last = prepareCandidateTable(store, { candidate_ref: set.ref, offset: first.page.nextOffset, max_bytes: 65536 }, binding);
  assert.equal(last.page.returnedCount, 5); assert.equal(last.page.complete, true);
  assert.equal(last.presentation.props.rows[0].displayName, '中文作品 201');
  assert.equal(first.counts.preparedCount + last.counts.preparedCount, first.counts.memberCount);
  assert.equal(store.get(set.ref, binding).rows.length, 205);
});

test('字节预算只在完整行间停止，无法容纳首行时明确报错且保留引用', () => {
  const rows = seeds(20).map(row => ({ ...row, facts: { name: '行'.repeat(100) + row.id } }));
  const { store, set } = result(rows);
  const first = prepareCandidateTable(store, { candidate_ref: set.ref, fields: ['name', 'url'], max_bytes: 1024 }, binding);
  assert.ok(first.page.returnedCount > 0 && first.page.returnedCount < 20);
  assert.equal(first.bytes, Buffer.byteLength(JSON.stringify(first.presentation), 'utf8'));
  assert.ok(first.bytes <= 1024);
  assert.equal(first.presentation.props.rows[0].name, rows[0].facts.name);
  const { store: largeStore, set: largeSet } = result([{ id: 99, facts: { name: '巨'.repeat(300), nameCn: '大'.repeat(300) } }]);
  const oversized = prepareCandidateTable(largeStore, { candidate_ref: largeSet.ref,
    fields: ['name', 'nameCn'], max_bytes: 1024 }, binding);
  assert.equal(oversized.kind, 'candidate_table_plan'); assert.equal(oversized.status, 'projection_required');
  assert.ok(oversized.wholePlan.reasons.includes('row_bytes'));
  assert.equal(Object.hasOwn(oversized, 'presentation'), false);
  assert.equal(largeStore.get(largeSet.ref, binding).rows[0].facts.name.length, 300);
});

test('工作集、未完成本层、可续来源及未完成祖先不能借格式化绕过', async () => {
  const store = new CandidateStore(), source = store.create({ binding, rows: seeds(3), sources: [] });
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: source.ref }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const partial = await query.execute({ candidate_ref: source.ref, fields: ['id'], limit: 1, hydrate_fields: false }, binding);
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: partial.resultRef }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const unread = result(seeds(1), { sources: [{ tool: 'search_subjects', source: 'v0', scope: '{}', complete: false,
    scannedCount: 1, total: 2, nextOffset: 1, privateRecords: 'not_applicable' }] });
  assert.throws(() => prepareCandidateTable(unread.store, { candidate_ref: unread.set.ref }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const unfinished = result(seeds(1), { coverageDependencies: [{ candidateRef: 'ancestor', coverageRef: 'ancestor-coverage',
    kind: 'qualification', complete: false, pendingCount: 0, remainingCount: 1, unknownCount: 0, failedCount: 0 }] });
  assert.throws(() => prepareCandidateTable(unfinished.store, { candidate_ref: unfinished.set.ref }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
});

test('扫描结束但有pending或祖先缺口可展示已核部分，coverage不能洗成完整', async () => {
  const store = new CandidateStore(), source = store.create({ binding, rows: [
    { id: 1, facts: { name: '已核实', score: 9 } }, { id: 2, facts: { name: '评分未知' } }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const page = await query.execute({ candidate_ref: source.ref, filter: { rating: { min: 8 } }, fields: ['id'], hydrate_fields: false }, binding);
  assert.equal(page.page.complete, true); assert.equal(page.stage.pendingCount, 1);
  const value = prepareCandidateTable(store, { candidate_ref: page.resultRef }, binding);
  assert.equal(value.page.returnedCount, 1); assert.equal(value.page.complete, true);
  assert.equal(value.coverage.complete, false); assert.equal(value.coverage.pendingCount, 1);
  const gap = result(seeds(1), { coverageDependencies: [{ candidateRef: 'ancestor', coverageRef: 'ancestor-coverage',
    kind: 'qualification', complete: false, pendingCount: 2, remainingCount: 0, unknownCount: 0, failedCount: 0 }] });
  const shown = prepareCandidateTable(gap.store, { candidate_ref: gap.set.ref }, binding);
  assert.equal(shown.coverage.complete, false); assert.equal(shown.coverage.dependencyPendingCount, 2);
});

test('witness展示一条父边和实际总数，all保留全部边且使用缓存名', () => {
  const { store, set } = result(seeds(1));
  const getLineage = (_ref, ids) => ids.map(subjectId => ({ subjectId, parentCount: 2, parents: [
    { parentId: 12, relation: '外传', name: 'parent', nameCn: '已看父乙' },
    { parentId: 11, relation: '番外', name: '已看父甲' }] }));
  const witness = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'witness' }, binding, undefined, getLineage);
  assert.equal(Object.keys(witness.presentation.props.rows[0]).length, 4);
  assert.equal(witness.presentation.props.rows[0].lineage, '已看父甲');
  assert.equal(witness.presentation.props.rows[0].parentCount, '2');
  const all = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all' }, binding, undefined, getLineage);
  assert.ok(all.presentation.props.rows[0].lineage.includes('已看父甲'));
  assert.ok(all.presentation.props.rows[0].lineage.includes('已看父乙'));
  assert.equal(Object.keys(all.presentation.props.rows[0]).length, 4);
  const ids = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all', lineage_format: 'ids' }, binding, undefined, getLineage);
  assert.equal(ids.presentation.props.rows[0].lineage, '#11；#12');
  const full = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all', lineage_format: 'full' }, binding, undefined, getLineage);
  assert.ok(full.presentation.props.rows[0].lineage.includes('https://bgm.tv/subject/11（番外）'));
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all' }, binding), error => error.code === 'CANDIDATE_LINEAGE_UNAVAILABLE');
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all' }, binding, undefined,
    () => []), error => error.code === 'MCP_INVALID_RESULT');
});

test('全集合在任何offset返回页面前规划；单页合法但总wire超界只返回成功投影回执', () => {
  const { store, set } = result(seeds(354).map(row => ({ ...row, facts: { name: '较长作品'.repeat(4) + row.id, date: '2026-10-01', subjectForm: 'tv' } })));
  const fields = ['displayName', 'id', 'name', 'date', 'subjectForm', 'url'];
  const first = prepareCandidateTable(store, { candidate_ref: set.ref, fields, limit: 200, max_bytes: 60000 }, binding);
  assert.equal(first.kind, 'candidate_table_plan'); assert.equal(first.status, 'projection_required');
  assert.ok(first.wholePlan.wholeWireBytes > 40000);
  assert.equal(first.counts.memberCount, 354); assert.equal(first.counts.preparedCount, 0);
  assert.equal(first.counts.remainingCount, 354); assert.equal(Object.hasOwn(first, 'presentation'), false);
  assert.deepEqual(first.scope.fields, fields);
  assert.equal(first.guidance.keepCandidateRef, true); assert.equal(first.guidance.preserveRequiredFields, true);
  const later = prepareCandidateTable(store, { candidate_ref: set.ref, fields, offset: 200, max_bytes: 60000 }, binding);
  assert.equal(later.kind, 'candidate_table_plan'); assert.equal(later.wholePlan.wholeWireBytes, first.wholePlan.wholeWireBytes);
  assert.equal(store.get(set.ref, binding).rows.length, 354);
});

test('短字段的354条全部保留、真实whole wire量与所有200行部件一致且现有decoder闭环', () => {
  const { store, set } = result(seeds(354)); const parts = []; let offset = 0; let plan;
  do {
    const value = prepareCandidateTable(store, { candidate_ref: set.ref, fields: ['displayName', 'url'], offset }, binding);
    assert.equal(value.kind, 'candidate_table'); assert.equal(value.wholePlan.fit, true);
    plan ??= value.wholePlan;
    assert.deepEqual(value.wholePlan, plan); parts.push(value.presentation); offset = value.page.nextOffset;
  } while (offset !== null);
  const wire = JSON.stringify({ content: parts });
  assert.equal(Buffer.byteLength(wire, 'utf8'), plan.wholeWireBytes);
  assert.equal(parts.length, plan.tablePartsCount); assert.ok(plan.tablePartsCount <= 14);
  assert.equal(parts.reduce((count, part) => count + part.props.rows.length, 0), 354);
  const ids = parts.flatMap(part => part.props.rows.map(row => row.url));
  assert.equal(new Set(ids).size, 354); assert.equal(ids.at(-1), 'https://bgm.tv/subject/354');
  const decoder = new ContentDecoder(); decoder.feed(wire); assert.equal(decoder.finish().content.length, parts.length);
});

test('用户要求的展示字段不被最少投影默认值自动删除', () => {
  const { store, set } = result(seeds(354).map(row => ({ ...row, facts: { ...row.facts, date: '2026-10-01' } })));
  const fields = ['displayName', 'date', 'url'];
  const value = prepareCandidateTable(store, { candidate_ref: set.ref, fields }, binding);
  assert.equal(value.kind, 'candidate_table');
  assert.deepEqual(value.fields, fields); assert.deepEqual(value.presentation.props.columns.map(column => column.key), fields);
  assert.deepEqual(value.presentation.props.rows[0], { displayName: '中文作品 1', date: '2026-10-01', url: 'https://bgm.tv/subject/1' });
});

test('名字简写保留父总数且同名父追加真ID辨识，不返回重复URL或关系长文本', () => {
  const { store, set } = result(seeds(1));
  const lookup = (_ref, ids) => ids.map(subjectId => ({ subjectId, parentCount: 2,
    parents: [{ parentId: 10, relation: '关系甲', name: '同名父' }, { parentId: 20, relation: '关系乙', name: '同名父' }] }));
  const value = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'all' }, binding, undefined, lookup);
  assert.equal(value.presentation.props.rows[0].lineage, '同名父 #10；同名父 #20');
  assert.equal(value.presentation.props.rows[0].parentCount, '2');
});

test('全量规划给现有16内容项预留2项覆盖文本，不以候选数量硬cap', () => {
  const { store, set } = result(seeds(15));
  const value = prepareCandidateTable(store, { candidate_ref: set.ref, limit: 1 }, binding);
  assert.equal(value.kind, 'candidate_table_plan'); assert.equal(value.wholePlan.tablePartsCount, 15);
  assert.ok(value.wholePlan.reasons.includes('table_parts'));
  assert.equal(value.wholePlan.maxTableParts, 14); assert.equal(value.wholePlan.reservedTextParts, 2);
  assert.equal(store.get(set.ref, binding).rows.length, 15);
});

test('200行lineage按100分窗，只调用缓存回溯；账户/权限不能越界', () => {
  const { store, set } = result(seeds(200)); const windows = [];
  const value = prepareCandidateTable(store, { candidate_ref: set.ref, lineage: 'witness', max_bytes: 65536 }, binding, undefined,
    (_ref, ids, owner) => { windows.push(ids); assert.deepEqual(owner, binding); return ids.map(subjectId => ({ subjectId, parentCount: 0, parents: [] })); });
  assert.deepEqual(windows.map(ids => ids.length), [100, 100]); assert.equal(value.page.returnedCount, 200);
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: set.ref }, { ...binding, turnId: 'other' }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const ownBinding = { turnId: binding.turnId, accountId: 7, scopeKey: 'account:7' };
  const privateSet = store.create({ binding: ownBinding, rows: seeds(1), sources: [], refRole: 'result',
    visibility: 'self', account: { id: 7, username: 'tester' } });
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: privateSet.ref }, ownBinding), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const context = { mode: 'account', account: { id: 7, username: 'tester' }, source: 'p1', nsfwApplied: true,
    nsfw: { preference: true, allowed: true, state: 'enabled' }, checkedAt: new Date().toISOString() };
  assert.equal(prepareCandidateTable(store, { candidate_ref: privateSet.ref }, ownBinding, context).visibility, 'self');
  const protectedSet = store.create({ binding: ownBinding, rows: [{ id: 9, facts: { name: '受限条目', nsfw: true }, requiresNsfw: true }],
    sources: [], refRole: 'result', visibility: 'self', account: context.account });
  const denied = { ...context, nsfw: { preference: false, allowed: false, state: 'disabled' } };
  assert.throws(() => prepareCandidateTable(store, { candidate_ref: protectedSet.ref }, ownBinding, denied), error => error.code === 'NSFW_SCOPE_CHANGED');
  assert.equal(prepareCandidateTable(store, { candidate_ref: protectedSet.ref }, ownBinding, context).page.returnedCount, 1);
});

test('返回校验拒绝额外raw数据、错字节量、洗白窗口或非法既有wire', () => {
  const { store, set } = result(seeds(2)); const args = { candidate_ref: set.ref, limit: 1 };
  const value = prepareCandidateTable(store, args, binding);
  for (const mutate of [copy => copy.data = [], copy => copy.bytes++, copy => copy.page.complete = true,
    copy => copy.page.nextOffset = null, copy => copy.counts.remainingCount = 0,
    copy => copy.presentation.pending = true, copy => copy.presentation.props.rows[0].extra = '多余单元格',
    copy => copy.presentation.props.columns[0].key = 'summary']) {
    const copy = structuredClone(value); mutate(copy);
    assert.throws(() => checkCandidatePresentationResponse(copy, args), error => error.code === 'MCP_INVALID_RESULT');
  }
});
