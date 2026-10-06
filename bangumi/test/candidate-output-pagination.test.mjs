import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { prepareCandidateOutput } from '../dist/src/mcp/candidate-output.js';
import { checkCandidateOutputResponse, candidateOutputOutputSchema } from '../dist/src/mcp/candidate-output-contract.js';
import { compileSchema } from '../dist/src/support/tool-schema.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
const binding = { turnId: 'output-pages', accountId: null, scopeKey: 'public:sfw' };
function fixture(count, extra = {}) {
  const store = new CandidateStore();
  const set = store.create({ binding, refRole: 'result', rows: Array.from({ length: count }, (_, index) => ({ id: index + 1,
    facts: { name: `作品${index + 1}`, subjectType: 2, score: 8, ...extra } })), sources: [] });
  const read = (args, lineage) => {
    const input = { candidate_ref: set.ref, ...args }, value = prepareCandidateOutput(store, input, binding, anonymousContext(), lineage);
    checkCandidateOutputResponse(value, input); assert.equal(compileSchema(candidateOutputOutputSchema)({ value }), true); return value;
  };
  return { store, set, read };
}
test('4300成员超整根可沿同一ref分页交付，所有ID及必要字段完整且覆盖不变', () => {
  const f = fixture(4300), old = f.read({ fields: ['id', 'displayName', 'url', 'score'] });
  assert.equal(old.kind, 'candidate_output_plan'); assert.ok(old.guidance.message.includes('offset'));
  const seen = []; let offset = 0;
  do {
    const page = f.read({ fields: ['id', 'displayName', 'url', 'score'], offset, limit: 100 });
    assert.equal(page.candidateRef, f.set.ref); assert.ok(page.bytes <= 40000); assert.deepEqual(page.coverage, old.coverage);
    const rows = page.presentation.content.filter(part => part.type === 'DataTable').flatMap(part => part.props.rows);
    for (const row of rows) {
      const id = Number(row.id); seen.push(id); assert.equal(row.score, '8'); assert.equal(row.displayName, `作品${id}`);
      assert.equal(row.url, `https://bgm.tv/subject/${id}`);
    }
    assert.equal(page.counts.preparedCount, rows.length); assert.equal(page.counts.memberCount, 4300);
    assert.equal(page.counts.remainingCount, 4300 - offset - rows.length);
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(seen, Array.from({ length: 4300 }, (_, index) => index + 1));
  assert.equal(f.store.sets.size, 1);
});
test('卡片整项装入容量窗，不截summary，理由仅当前页，外部ID拒绝', () => {
  const summary = '完整正文'.repeat(400), f = fixture(30, { summary });
  const reasons = [{ subject_id: 1, reason: '首项解释' }, { subject_id: 30, reason: '末项解释' }];
  const first = f.read({ format: 'subject_cards', card_fields: ['summary'], reasons, offset: 0, limit: 30 });
  assert.ok(first.counts.preparedCount > 0 && first.counts.preparedCount < 30); assert.ok(first.bytes <= 40000);
  assert.ok(first.presentation.content.at(-1).text.includes('首项解释'));
  assert.equal(JSON.stringify(first.presentation).includes('末项解释'), false);
  let offset = 0, ids = [];
  do {
    const page = f.read({ format: 'subject_cards', card_fields: ['summary'], reasons, offset, limit: 30 });
    const cards = page.presentation.content.filter(part => part.type === 'SubjectCards').flatMap(part => part.props.items);
    for (const card of cards) { assert.equal(card.summary, summary); ids.push(card.id); }
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => index + 1));
  assert.throws(() => f.read({ format: 'subject_cards', offset: 0, reasons: [{ subject_id: 999, reason: '外部' }] }), error => error.code === 'INVALID_INPUT');
});
test('分页保留完整关联字段，复用格式化器只读取本窗关联', () => {
  const f = fixture(250), windows = [];
  const page = f.read({ offset: 100, limit: 30, lineage: 'all', lineage_format: 'full' }, (_ref, ids) => {
    windows.push(ids); return ids.map(subjectId => ({ subjectId, parentCount: 1,
      parents: [{ parentId: 900, relation: '续集', name: '父作品' }] }));
  });
  assert.deepEqual(windows.flat(), Array.from({ length: 30 }, (_, index) => index + 101));
  for (const row of page.presentation.content[0].props.rows) assert.equal(row.lineage, '父作品 https://bgm.tv/subject/900（续集）');
  assert.equal(page.page.nextOffset, 130); assert.equal(page.counts.memberCount, 250);
});
test('单项超40KB明确失败；空窗与末窗完整性独立于集合覆盖，checker拒绝伪造进度', () => {
  const huge = fixture(1, { summary: '字'.repeat(15000) });
  assert.throws(() => huge.read({ format: 'subject_cards', card_fields: ['summary'], offset: 0 }), error => error.code === 'CANDIDATE_OUTPUT_ITEM_TOO_LARGE');
  const f = fixture(3), page = f.read({ offset: 2, limit: 50 });
  assert.equal(page.page.complete, true); assert.equal(page.page.nextOffset, null); assert.equal(page.counts.preparedCount, 1);
  const empty = f.read({ offset: 3, limit: 50 }); assert.equal(empty.counts.preparedCount, 0); assert.equal(empty.page.complete, true);
  assert.throws(() => f.read({ offset: 4 }), error => error.code === 'INVALID_INPUT');
  const forged = structuredClone(page); forged.page.nextOffset = 3;
  assert.throws(() => checkCandidateOutputResponse(forged, { candidate_ref: f.set.ref, offset: 2, limit: 50 }), error => error.code === 'MCP_INVALID_RESULT');
});
test('选集分页交付结束不把未完整母源的coverage洗成完整', () => {
  const store = new CandidateStore(), set = store.create({ binding, refRole: 'result',
    rows: [{ id: 1, facts: { name: '已选作品', subjectType: 2 } }],
    sources: [{ tool: 'search_subjects', source: 'v0', scope: '{}', complete: false, scannedCount: 1,
      total: 200, nextOffset: 1, privateRecords: 'not_applicable' }] });
  const input = { candidate_ref: set.ref, format: 'subject_cards', offset: 0, limit: 50 };
  const value = prepareCandidateOutput(store, input, binding, anonymousContext());
  checkCandidateOutputResponse(value, input);
  assert.equal(value.page.complete, true); assert.equal(value.page.nextOffset, null);
  assert.equal(value.counts.remainingCount, 0); assert.equal(value.coverage.complete, false);
  assert.equal(value.coverage.incompleteSourceCount, 1);
  assert.ok(value.presentation.content.at(-1).text.includes('母池仍有覆盖缺口'));
});
