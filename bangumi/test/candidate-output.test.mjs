import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { prepareCandidateOutput } from '../dist/src/mcp/candidate-output.js';
import { candidateOutputInputSchema, candidateOutputOutputSchema, checkCandidateOutputResponse, validateCandidateOutputArgs }
  from '../dist/src/mcp/candidate-output-contract.js';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { compileSchema, schemaArguments } from '../dist/src/support/tool-schema.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';

const binding = { turnId: 'output', accountId: null, scopeKey: 'public:sfw' };
const seeds = count => Array.from({ length: count }, (_, index) => ({ id: index + 1,
  facts: { name: `原名 ${index + 1}`, nameCn: `中文名 ${index + 1}`, subjectType: 2 } }));
function result(rows, extra = {}) {
  const store = new CandidateStore(), set = store.create({ binding, rows, sources: [], refRole: 'result', ...extra });
  return { store, set };
}
function decode(value) { const decoder = new ContentDecoder(); decoder.feed(JSON.stringify(value.presentation)); return decoder.finish(); }
function checked(store, input, getLineage) {
  const value = prepareCandidateOutput(store, input, binding, anonymousContext(), getLineage);
  assert.equal(compileSchema(candidateOutputOutputSchema)({ value }), true);
  checkCandidateOutputResponse(value, input); return value;
}

test('根准备契约默认表格；两种格式闭合且限制解释文字', () => {
  assert.equal(candidateOutputInputSchema.type, 'object');
  assert.deepEqual(candidateOutputInputSchema.properties.format.enum, ['table', 'subject_cards']);
  assert.ok(candidateOutputInputSchema.properties.candidate_ref); assert.ok(candidateOutputInputSchema.properties.card_fields);
  assert.ok(Object.values(candidateOutputInputSchema.properties).every(property => !Object.hasOwn(property, 'default')));
  const args = schemaArguments(candidateOutputInputSchema, { candidate_ref: 'r' });
  assert.equal(args.format, 'table'); assert.deepEqual(args.fields, ['displayName', 'url']);
  assert.equal(args.completion_scope, 'exhaustive');
  const cards = schemaArguments(candidateOutputInputSchema, { candidate_ref: 'r', format: 'subject_cards' });
  assert.equal(cards.layout, 'list'); assert.deepEqual(cards.card_fields, ['nameCn']); assert.deepEqual(cards.reasons, []);
  assert.equal(cards.completion_scope, 'selected');
  for (const input of [{}, { candidate_ref: 'r', format: 'cards' }, { candidate_ref: 'r', offset: -1 },
    { candidate_ref: 'r', format: 'subject_cards', fields: ['name'] }, { candidate_ref: 'r', reasons: [] },
    { candidate_ref: 'r', format: 'subject_cards', card_fields: ['reason'] },
    { candidate_ref: 'r', format: 'subject_cards', card_fields: ['date', 'date'] },
    { candidate_ref: 'r', introduction: '字'.repeat(4001) }, { candidate_ref: 'r', completion_scope: 'sample' },
    { candidate_ref: 'r', format: 'subject_cards', reasons: [{ subject_id: 1, reason: '字'.repeat(4001) }] }])
    assert.throws(() => validateCandidateOutputArgs(input), error => error.code === 'INVALID_INPUT');
});

test('完整表格根含宿主nextType；引号反斜杠换行均经过真实解码器且不改变集合', () => {
  const { store, set } = result(seeds(3)), before = store.get(set.ref, binding);
  const introduction = '这是一段“解释”。英文"双引号"、\\路径\n下一行：\t内容', conclusion = '本次3项；未知仍明确。';
  const value = checked(store, { candidate_ref: set.ref, introduction, conclusion });
  assert.equal(value.kind, 'candidate_output'); assert.equal(value.counts.preparedCount, 3); assert.equal(value.counts.remainingCount, 0);
  assert.deepEqual(value.presentation.content.map(part => part.type), ['text', 'DataTable', 'text']);
  assert.deepEqual(value.presentation.content[0], { type: 'text', nextType: 'DataTable', text: introduction });
  assert.deepEqual(value.presentation.content[2], { type: 'text', nextType: null, text: conclusion });
  assert.equal(Object.hasOwn(value.presentation.content[0], 'hint'), false);
  assert.equal(Object.hasOwn(value.presentation.content[1], 'nextType'), false);
  assert.equal(value.presentation.content[1].pending, false);
  const canonical = decode(value);
  assert.equal(canonical.content[0].text, introduction); assert.equal(canonical.content[1].pending, false);
  assert.equal(canonical.content[1].props.rows[2].displayName, '中文名 3');
  assert.equal(value.bytes, Buffer.byteLength(JSON.stringify(value.presentation), 'utf8'));
  assert.equal(value.wholePlan.wholeWireBytes, value.bytes); assert.deepEqual(store.get(set.ref, binding), before);
});

test('354成员表格遍历内部所有页；必要显示与witness父名称/实际边数都完整', () => {
  const { store, set } = result(seeds(354)), windows = [];
  const value = checked(store, { candidate_ref: set.ref, lineage: 'witness' }, (_ref, ids) => {
    windows.push(ids.length); return ids.map(subjectId => ({ subjectId, parentCount: 2,
      parents: [{ parentId: 800, relation: '关联', nameCn: '父作品甲' }, { parentId: 801, relation: '另一关联', nameCn: '父作品乙' }] }));
  });
  assert.equal(value.kind, 'candidate_output'); assert.equal(value.counts.memberCount, 354);
  const tables = value.presentation.content.filter(part => part.type === 'DataTable'), rows = tables.flatMap(part => part.props.rows);
  assert.equal(rows.length, 354); assert.equal(new Set(rows.map(row => row.url)).size, 354);
  assert.ok(tables.length >= 2 && tables.every(table => table.props.rows.length <= 200));
  assert.ok(rows.every(row => row.lineage === '父作品甲' && row.parentCount === '2'));
  assert.ok(windows.every(count => count <= 100)); assert.ok(value.bytes <= 40000);
  assert.equal(decode(value).content.reduce((count, part) => count + part.props.rows.length, 0), 354);
});

test('全父边与用户必要日期在混合根中原样保留，full不被自动替换为names', () => {
  const { store, set } = result([{ id: 3, facts: { name: '目标', subjectType: 2, date: '2026-10-06' } }]);
  const value = checked(store, { candidate_ref: set.ref, fields: ['displayName', 'url', 'date'], lineage: 'all', lineage_format: 'full' },
    (_ref, ids) => ids.map(subjectId => ({ subjectId, parentCount: 2,
      parents: [{ parentId: 10, relation: '第一关系', name: '父甲' }, { parentId: 11, relation: '第二关系', name: '父乙' }] })));
  const row = value.presentation.content[0].props.rows[0];
  assert.equal(row.date, '2026-10-06'); assert.ok(row.lineage.includes('父甲 https://bgm.tv/subject/10（第一关系）'));
  assert.ok(row.lineage.includes('父乙 https://bgm.tv/subject/11（第二关系）')); assert.equal(row.parentCount, '2');
  assert.equal(decode(value).content[0].props.rows[0].lineage, row.lineage);
});

test('空已核集仍产生合法空组件；没有文字时不生成多余Text', () => {
  for (const format of ['table', 'subject_cards']) {
    const { store, set } = result([]), value = checked(store, { candidate_ref: set.ref, format });
    assert.equal(value.counts.preparedCount, 0); assert.equal(value.presentation.content.length, 1);
    assert.equal(decode(value).content.length, 1);
  }
});

test('卡片理由单独转Text并转义，不能覆盖summary或添加未知reason属性', () => {
  const { store, set } = result([{ id: 9, facts: { name: '事实"作品', nameCn: '中文名', subjectType: 2,
    summary: '已获得的事实简介', date: '2026-10-06', score: 0, ratingCount: 0, rank: 1, tags: ['标签'] } }]);
  const reason = '适配判断"括号"：\\保留路径\n下一行，不当作作品简介。';
  const value = checked(store, { candidate_ref: set.ref, format: 'subject_cards', card_fields: ['summary', 'date', 'score', 'scoreCount', 'tags'],
    introduction: '推荐1项', reasons: [{ subject_id: 9, reason }], conclusion: '基于本次证据。' });
  const item = value.presentation.content[1].props.items[0];
  assert.equal(item.summary, '已获得的事实简介'); assert.equal(item.nameCn, undefined); assert.equal(item.image, undefined);
  assert.equal(item.score, 0); assert.equal(item.scoreCount, 0); assert.deepEqual(item.tags, ['标签']); assert.equal(item.rank, undefined);
  assert.equal(item.url, 'https://bgm.tv/subject/9'); assert.equal(Object.hasOwn(item, 'reason'), false);
  assert.deepEqual(value.presentation.content.map(part => part.type), ['text', 'SubjectCards', 'text']);
  assert.ok(value.presentation.content[2].text.includes(reason)); assert.ok(value.presentation.content[2].text.endsWith('基于本次证据。'));
  const canonical = decode(value); assert.equal(canonical.content[1].props.items[0].summary, '已获得的事实简介');
  assert.equal(canonical.content[2].text, value.presentation.content[2].text);
});

test('卡片每块50项且未知可选项省略并统计缺口；不发网络补图/补字段，不把数字0丢失', () => {
  const { store, set } = result(seeds(51)), value = checked(store, { candidate_ref: set.ref, format: 'subject_cards', card_fields: ['score', 'date'] });
  const components = value.presentation.content.filter(part => part.type === 'SubjectCards');
  assert.deepEqual(components.map(part => part.props.items.length), [50, 1]);
  const items = components.flatMap(part => part.props.items);
  assert.equal(new Set(items.map(item => item.id)).size, 51);
  assert.ok(items.every(item => ['image', 'nameCn', 'score', 'date', 'summary'].every(field => !Object.hasOwn(item, field))));
  assert.equal(value.counts.unknownFieldCount, 102); assert.equal(decode(value).content[1].pending, false);
  assert.ok(value.presentation.content.at(-1).text.includes('展示字段缺失102处'));
});

test('只映射已核实媒体kind；理由外部ID和重复ID都拒绝而不截集合', () => {
  const { store, set } = result(seeds(2));
  for (const reasons of [[{ subject_id: 99, reason: '不在选集' }], [{ subject_id: 1, reason: '一' }, { subject_id: 1, reason: '二' }]])
    assert.throws(() => prepareCandidateOutput(store, { candidate_ref: set.ref, format: 'subject_cards', reasons }, binding), error => error.code === 'INVALID_INPUT');
  const unknown = result([{ id: 7, facts: { name: '媒体未知' } }]);
  assert.throws(() => prepareCandidateOutput(unknown.store, { candidate_ref: unknown.set.ref, format: 'subject_cards' }, binding),
    error => error.code === 'CANDIDATE_REQUIRED_FACTS_MISSING');
  const all = result([1, 2, 3, 4, 6].map((subjectType, index) => ({ id: index + 1, facts: { subjectType } })));
  const value = checked(all.store, { candidate_ref: all.set.ref, format: 'subject_cards', card_fields: [] });
  assert.deepEqual(value.presentation.content[0].props.items.map(item => item.kind), ['book', 'anime', 'music', 'game', 'real']);
  assert.deepEqual(value.presentation.content[0].props.items.map(item => item.name), ['#1', '#2', '#3', '#4', '#5']);
});

test('来源/工作集/未完成扫描均沿用原守卫；扫描完的pending/祖先缺口仍报告部分', async () => {
  const store = new CandidateStore(), source = store.create({ binding, rows: [
    { id: 1, facts: { name: '通过', subjectType: 2, score: 9 } }, { id: 2, facts: { name: '未知', subjectType: 2 } }], sources: [] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  for (const format of ['table', 'subject_cards']) assert.throws(() => prepareCandidateOutput(store, { candidate_ref: source.ref, format }, binding),
    error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const partial = await query.execute({ candidate_ref: source.ref, filter: { rating: { min: 8 } }, fields: ['id'], hydrate_fields: false, limit: 1 }, binding);
  assert.throws(() => prepareCandidateOutput(store, { candidate_ref: partial.resultRef }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const complete = await query.execute({ candidate_ref: source.ref, filter: { rating: { min: 8 } }, fields: ['id'], hydrate_fields: false }, binding);
  for (const format of ['table', 'subject_cards']) {
    const value = checked(store, { candidate_ref: complete.resultRef, format });
    assert.equal(value.counts.preparedCount, 1); assert.equal(value.coverage.complete, false); assert.equal(value.coverage.pendingCount, 1);
    assert.ok(value.presentation.content.at(-1).text.includes('本层待核1项'));
  }
  const gap = result(seeds(1), { coverageDependencies: [{ candidateRef: 'ancestor', coverageRef: 'ancestor-coverage', kind: 'qualification',
    complete: false, pendingCount: 2, remainingCount: 0, unknownCount: 0, failedCount: 0 }] });
  const shown = checked(gap.store, { candidate_ref: gap.set.ref });
  assert.equal(shown.coverage.dependencyPendingCount, 2);
  assert.ok(shown.presentation.content.at(-1).text.includes('本层待核0项'));
  assert.ok(shown.presentation.content.at(-1).text.includes('依赖待核2项'));
  assert.ok(shown.presentation.content.at(-1).text.includes('不是去重作品总数'));
  const unread = result(seeds(1), { sources: [{ tool: 'search_subjects', source: 'v0', scope: '{}', complete: false,
    scannedCount: 1, total: 2, nextOffset: 1, privateRecords: 'not_applicable' }] });
  assert.throws(() => prepareCandidateOutput(unread.store, { candidate_ref: unread.set.ref }, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
});

test('账户和NSFW权限守卫不能被混合根准备绕过', () => {
  const owner = { ...binding, accountId: 7, scopeKey: 'self:7' }, store = new CandidateStore();
  const set = store.create({ binding: owner, rows: seeds(1), sources: [], refRole: 'result', visibility: 'self', account: { id: 7, username: 'owner' } });
  assert.throws(() => prepareCandidateOutput(store, { candidate_ref: set.ref, format: 'subject_cards' }, owner, anonymousContext()),
    error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  const nsfw = result([{ id: 1, facts: { name: '受权限约束', subjectType: 2, nsfw: true } }]);
  for (const format of ['table', 'subject_cards']) assert.throws(() => prepareCandidateOutput(nsfw.store, { candidate_ref: nsfw.set.ref, format }, binding, anonymousContext()),
    error => error.code === 'NSFW_SCOPE_CHANGED');
});

test('少量推荐选集自身已完成时允许母池来源和未选祖先未耗尽，覆盖提示仍保留', async () => {
  const source = { tool: 'search_subjects', source: 'v0', scope: '{}', complete: false,
    scannedCount: 4, total: 12, nextOffset: 4, privateRecords: 'not_applicable' };
  const { store, set } = result(seeds(4), { sources: [source] });
  const query = new CandidateQuery(store, { loadFacts: async () => { throw Error('所有必要事实已在缓存'); } });
  const mother = await query.execute({ candidate_ref: set.ref, filter: { subject_type: 2 }, fields: ['id'], limit: 1, hydrate_fields: false }, binding);
  assert.equal(mother.stage.remainingCount, 3);
  const selected = await query.execute({ candidate_ref: mother.candidateRef, filter: { subject_ids: [1, 2], subject_type: 2 },
    fields: ['id'], limit: 100, hydrate_fields: false }, binding);
  assert.equal(selected.stage.remainingCount, 0); assert.equal(selected.stage.pendingCount, 0);
  assert.equal(selected.coverage.dependencyRemainingCount, 3);
  const args = { candidate_ref: selected.resultRef, format: 'subject_cards', card_fields: [], reasons: [{ subject_id: 1, reason: '已核实选中理由' }] };
  const value = checked(store, args);
  assert.equal(value.scope.completion_scope, 'selected'); assert.equal(value.counts.preparedCount, 2);
  assert.equal(value.coverage.complete, false); assert.equal(value.coverage.incompleteSourceCount, 1);
  assert.equal(value.coverage.dependencyRemainingCount, 3);
  assert.ok(value.presentation.content.at(-1).text.includes('母池仍有覆盖缺口'));
  assert.ok(value.presentation.content.at(-1).text.includes('上游未完整依赖1项'));
  assert.deepEqual(decode(value).content[0].props.items.map(item => item.id), [1, 2]);
  for (const request of [{ ...args, completion_scope: 'exhaustive' }, { candidate_ref: selected.resultRef }])
    assert.throws(() => prepareCandidateOutput(store, request, binding), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const table = checked(store, { candidate_ref: selected.resultRef, completion_scope: 'selected' });
  assert.equal(table.counts.preparedCount, 2); assert.equal(table.coverage.complete, false);
});

test('selected仍拒绝未完成自身的resultRef和已选当前事实不再满足必要硬条件', async () => {
  const { store, set } = result(seeds(4).map(row => ({ ...row, facts: { ...row.facts, score: 8 } })));
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) });
  const partial = await query.execute({ candidate_ref: set.ref, filter: { rating: { min: 8 } }, fields: ['id'], limit: 2, hydrate_fields: false }, binding);
  assert.throws(() => prepareCandidateOutput(store, { candidate_ref: partial.resultRef, format: 'subject_cards' }, binding),
    error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const selected = await query.execute({ candidate_ref: set.ref, filter: { subject_ids: [1, 2], rating: { min: 8 } }, fields: ['id'], hydrate_fields: false }, binding);
  assert.equal(checked(store, { candidate_ref: selected.resultRef, format: 'subject_cards' }).counts.preparedCount, 2);
  store.updateFacts(selected.resultRef, binding, 1, { facts: { score: 4 } });
  assert.throws(() => prepareCandidateOutput(store, { candidate_ref: selected.resultRef, format: 'subject_cards' }, binding),
    error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  const missing = result([{ id: 1, facts: { name: '缺必要评分', subjectType: 2 } }], { qualification: {
    inputCount: 1, processedCount: 1, matchedCount: 1, excludedCount: 0, pendingCount: 0, remainingCount: 0,
    filter: { rating: { min: 8 } }, originRef: 'origin', matchedIds: [1], pendingIds: [], remainingIds: [], complete: true } });
  assert.throws(() => prepareCandidateOutput(missing.store, { candidate_ref: missing.set.ref, format: 'subject_cards' }, binding),
    error => error.code === 'CANDIDATE_REQUIRED_FACTS_MISSING');
});

test('整root超40KB只返回成功规划receipt，字段/解释/理由均不能自动删掉', () => {
  const rows = seeds(300).map(row => ({ ...row, facts: { ...row.facts, nameCn: '用户作品名'.repeat(30), date: '2026-10-06' } }));
  const { store, set } = result(rows), input = { candidate_ref: set.ref, fields: ['displayName', 'url', 'date'], max_bytes: 65536,
    introduction: '来源介绍', conclusion: '用户要求的结尾' }, value = checked(store, input);
  assert.equal(value.kind, 'candidate_output_plan'); assert.equal(value.status, 'projection_required'); assert.ok(value.wholePlan.wholeWireBytes > 40000);
  assert.equal(value.counts.preparedCount, 0); assert.equal(value.counts.remainingCount, 300); assert.equal(Object.hasOwn(value, 'presentation'), false);
  assert.deepEqual(value.scope.fields, input.fields); assert.equal(value.scope.conclusion, input.conclusion);
  assert.ok(value.guidance.preserveRequiredFields); assert.ok(value.guidance.keepCandidateRef);
  assert.equal(store.get(set.ref, binding).rows.length, 300);
  const short = result(seeds(1)), reasons = [{ subject_id: 1, reason: '解释'.repeat(2000) }];
  const cards = checked(short.store, { candidate_ref: short.set.ref, format: 'subject_cards', reasons,
    introduction: '😀'.repeat(4000), conclusion: '😀'.repeat(4000) });
  assert.equal(cards.kind, 'candidate_output_plan'); assert.deepEqual(cards.scope.reasons, reasons); assert.equal(Object.hasOwn(cards, 'presentation'), false);
});

test('仅表格本身fit也要计算所有文字后的整root预算，不交付半份表格', () => {
  const { store, set } = result(seeds(200));
  const bare = checked(store, { candidate_ref: set.ref }); assert.equal(bare.kind, 'candidate_output');
  const expanded = checked(store, { candidate_ref: set.ref, introduction: '😀'.repeat(4000), conclusion: '😀'.repeat(4000) });
  assert.equal(expanded.kind, 'candidate_output_plan'); assert.ok(expanded.wholePlan.wholeWireBytes > 40000);
  assert.equal(expanded.counts.remainingCount, 200); assert.equal(Object.hasOwn(expanded, 'presentation'), false);
});

test('表格块数超保守预留或整行无法装入仍只返回完整规划', () => {
  const { store, set } = result(seeds(500));
  const narrow = checked(store, { candidate_ref: set.ref, max_bytes: 1024 });
  assert.equal(narrow.kind, 'candidate_output_plan'); assert.ok(narrow.wholePlan.reasons.includes('table_parts'));
  const oversized = result([{ id: 99, facts: { name: '巨'.repeat(300), nameCn: '大'.repeat(300), subjectType: 2 } }]);
  const row = checked(oversized.store, { candidate_ref: oversized.set.ref, fields: ['name', 'nameCn'], max_bytes: 1024 });
  assert.equal(row.kind, 'candidate_output_plan'); assert.ok(row.wholePlan.reasons.includes('row_bytes'));
  assert.equal(Object.hasOwn(row, 'presentation'), false);
});

test('卡片整根超过16项时不返回前16块或自动切出部分推荐', () => {
  const { store, set } = result(seeds(801)), value = checked(store, { candidate_ref: set.ref, format: 'subject_cards', card_fields: [] });
  assert.equal(value.kind, 'candidate_output_plan'); assert.equal(value.wholePlan.contentPartsCount, 17);
  assert.ok(value.wholePlan.reasons.includes('content_parts')); assert.ok(value.wholePlan.reasons.includes('whole_bytes'));
  assert.equal(value.counts.remainingCount, 801); assert.equal(Object.hasOwn(value, 'presentation'), false);
  assert.equal(store.get(set.ref, binding).rows.length, 801);
});

test('checker拒绝非法Text.hint、错误nextType、遗漏行、未选理由ID和私加卡片reason', () => {
  const { store, set } = result(seeds(2)), input = { candidate_ref: set.ref, introduction: '说明' }, value = checked(store, input);
  const hint = structuredClone(value); hint.presentation.content[0].hint = null;
  const next = structuredClone(value); next.presentation.content[0].nextType = null;
  const missing = structuredClone(value); missing.presentation.content[1].props.rows.pop();
  for (const changed of [hint, next, missing]) assert.throws(() => checkCandidateOutputResponse(changed, input), error => error.code === 'MCP_INVALID_RESULT');
  const cardsInput = { candidate_ref: set.ref, format: 'subject_cards', reasons: [{ subject_id: 1, reason: '适配' }] }, cards = checked(store, cardsInput);
  const extra = structuredClone(cards); extra.presentation.content[0].props.items[0].reason = '未知字段';
  assert.throws(() => checkCandidateOutputResponse(extra, cardsInput), error => error.code === 'MCP_INVALID_RESULT');
  const wrong = structuredClone(cards); wrong.presentation.content[0].props.items[0].url = 'https://bgm.tv/subject/99';
  assert.throws(() => checkCandidateOutputResponse(wrong, cardsInput), error => error.code === 'MCP_INVALID_RESULT');
});
