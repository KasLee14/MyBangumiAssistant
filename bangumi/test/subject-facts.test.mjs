import assert from 'node:assert/strict';
import test from 'node:test';
import { durationFacts, durationMinutes, normalizeCandidateDate } from '../dist/src/mcp/subject-facts.js';
import { CandidateReaders } from '../dist/src/mcp/candidate-readers.js';
import { candidateRow } from '../dist/src/mcp/candidate-store.js';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';

test('候选日期拒零值占位与非法日期，合法部分年月保留来源精度且不补造月日', () => {
  for (const value of [null, undefined, 0, '', ' ', '0000', '0000-00', '0000-00-00', '0000-10-06',
    '2026-00-06', '2026-13', '2026-02-29', '2026-04-31', '2026-10-32', '未知']) assert.equal(normalizeCandidateDate(value), null);
  for (const value of ['2026', '2026-10', '2026-10-06', '2024-02-29', '2000-02-29']) assert.equal(normalizeCandidateDate(value), value);
  assert.equal(normalizeCandidateDate(' 2026-10 '), '2026-10');
  assert.equal(normalizeCandidateDate('2026-00'), '2026');
  assert.equal(normalizeCandidateDate('2026-00-00'), '2026');
  assert.equal(normalizeCandidateDate('2026-10-00'), '2026-10');
  assert.equal(normalizeCandidateDate('1900-02-29'), null);
});

test('通用时长解析只接受明确单一值，不替缺失、范围或冲突证据造值', () => {
  assert.equal(durationMinutes('3分30秒'), 3.5);
  assert.equal(durationMinutes('每集 24分钟'), 24);
  assert.equal(durationMinutes('90 seconds'), 1.5);
  for (const value of ['3~5分钟', '约3分钟', '24', '0分钟', '总共30分钟', '']) assert.equal(durationMinutes(value), null);
  assert.deepEqual(durationFacts({ infobox: [{ key: '时长', value: '3分钟' }, { key: '单集时长', value: '4分钟' }] }), { durationMinutes: null });
  assert.deepEqual(durationFacts({ infobox: [{ key: '每集时长', value: [{ v: '180秒' }] }] }), { durationMinutes: 3 });
});

test('时长补字段只展开infobox，保留标签原文而不生成通俗类别布尔值', async () => {
  const requests = [];
  const readers = new CandidateReaders({
    details: async (id, include) => { requests.push({ id, include }); return { id, tags: ['小短篇'], platform: 'TV',
      infobox: [{ key: '时长', value: '3分30秒' }] }; },
    collection: async () => { throw Error('不应读取个人状态'); }, relations: async () => { throw Error('不应展开关系'); },
  });
  const result = await readers.load(candidateRow({ id: 1, facts: {} }), ['durationMinutes'], []);
  assert.deepEqual(requests, [{ id: 1, include: ['infobox'] }]);
  assert.equal(result.facts.durationMinutes, 3.5);
  assert.deepEqual(result.facts.tags, ['小短篇']);
  assert.equal(Object.hasOwn(result.facts, 'isMini'), false);
});

test('未请求infobox的形式补读不能把时长标成已读，后续时长请求仍会取得正确证据', async () => {
  const calls = [], store = new CandidateStore();
  const binding = { turnId: 'duration-lazy', accountId: null, scopeKey: 'public:sfw' };
  const readers = new CandidateReaders({
    details: async (id, include) => { calls.push(include); return { id, subjectType: 2, platform: 'TV',
      ...(include.includes('infobox') ? { infobox: [{ key: '每集时长', value: '3分钟' }] } : {}) }; },
    collection: async () => { throw Error('无个人请求'); }, relations: async () => { throw Error('无关系请求'); },
  });
  const query = new CandidateQuery(store, { loadFacts: (row, fields, include) => readers.load(row, fields, include) });
  const input = store.create({ binding, rows: [{ id: 1, facts: {} }] });
  const first = await query.execute({ candidate_ref: input.ref, filter: { subject_form: ['tv'] }, fields: ['id'] }, binding);
  const later = await query.execute({ candidate_ref: first.resultRef, fields: ['id', 'durationMinutes'] }, binding);
  assert.deepEqual(calls, [[], ['infobox']]); assert.equal(later.data[0].durationMinutes, 3);
});
