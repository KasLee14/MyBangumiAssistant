import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBrowseDate, matchesBrowseDate } from '../dist/src/mcp/browse-date.js';
import { browseSubjectPage, checkOutput, checkSubjectResponse } from '../dist/src/mcp/subject-output.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { requireBrowseCoverage } from '../dist/src/mcp/search-capabilities.js';
import { findToolDefinition } from '../dist/src/mcp/catalog.js';

const args = { subject_type: 2, cat: 1, year: 2026, month: 10, limit: 3, offset: 0, nsfw: 'exclude' };
const row = (id, patch = {}) => ({ id, type: 2, name: `作品${id}`, platform: 'TV', nsfw: false, date: '2026-10-05', ...patch });
const infobox = value => [{ key: '放送开始', value }];
function value(raw, parameters = args) {
  const context = anonymousContext(); requireBrowseCoverage(parameters.nsfw, context);
  return { ...browseSubjectPage(raw, parameters), accessContext: context };
}
function check(result, parameters = args) {
  checkOutput(findToolDefinition('browse_subjects').outputSchema, { value: result });
  checkSubjectResponse('browse_subjects', result, parameters);
}

test('真实故障条目只有年月，保留未知日并核实年月条件', () => {
  const result = value({ total: 2, data: [row(1), row(666478, { date: null, infobox: infobox('2026年10月') })] });
  check(result); assert.equal(result.data.length, 2);
  assert.equal(result.data[1].date, null);
  assert.deepEqual(result.data[1].dateEvidence, { year: 2026, month: 10, day: null, precision: 'month',
    source: 'infobox', sourceField: '放送开始', sourceValue: '2026年10月' });
  assert.equal(result.filterCoverage.complete, true); assert.equal(result.page.complete, false);
});

test('日期解析保留精度、验证闰年并优先使用date，不从无关字段猜测', () => {
  for (const date of ['2024-02-29', '2026-10', '2026']) {
    const evidence = resolveBrowseDate(row(1, { date, infobox: infobox('2025年1月') }));
    assert.equal(evidence.source, 'date'); assert.equal(evidence.sourceValue, date);
  }
  assert.equal(resolveBrowseDate(row(1, { date: null, infobox: [{ key: '话数', value: '2026' }] })), null);
  assert.equal(resolveBrowseDate(row(1, { type: 4, date: null, infobox: infobox('2026年10月') })), null);
  for (const date of ['2026-02-29', '2026-13', '2026-00-01', '2026-10-05至2026-10-08', 2026])
    assert.throws(() => resolveBrowseDate(row(1, { date })), { code: 'INVALID_RESPONSE' });
  const year = resolveBrowseDate(row(1, { date: null, infobox: infobox('2026年') }));
  assert.equal(matchesBrowseDate(year, { year: 2026 }), 'match');
  assert.equal(matchesBrowseDate(year, args), 'unknown');
  assert.equal(matchesBrowseDate(year, { year: 2025, month: 10 }), 'mismatch');
});

test('冲突、多日期、范围和非法infobox不挑选有利证据', () => {
  for (const info of [infobox('2026年秋'), infobox('2026年10月～12月'), infobox('2026年2月30日'),
    [...infobox('2026年10月'), ...infobox('2026年11月')], infobox([{ v: '2026年10月' }, { v: '2027年10月' }])])
    assert.equal(resolveBrowseDate(row(1, { date: null, infobox: info })), null);
  const compatible = [...infobox('2026年'), ...infobox('2026年10月5日')];
  assert.equal(resolveBrowseDate(row(1, { date: null, infobox: compatible })).precision, 'day');
  assert.throws(() => resolveBrowseDate(row(1, { date: null, infobox: infobox(2026) })), { code: 'INVALID_RESPONSE' });
  const p1 = [{ key: '放送开始', values: [{ v: '2026年10月' }] }];
  assert.equal(resolveBrowseDate(row(1, { date: null, infobox: p1 })).month, 10);
});

test('未知日期隔离成缺口；没有日期条件仍返回未知条目', () => {
  const raw = { total: 3, data: [row(1), row(2, { date: null }), row(3, { date: null, infobox: infobox('2026年') })] };
  const result = value(raw); check(result);
  assert.deepEqual(result.data.map(s => s.id), [1]);
  assert.deepEqual(result.filterCoverage, { scope: 'source_window', scannedCount: 3, matchedCount: 1,
    unknownDateCount: 2, unknownDateSubjectIds: [2, 3], complete: false });
  assert.equal(result.page.total, 3); assert.equal(result.page.nextOffset, 3);
  const { year, month, ...unfiltered } = args;
  const all = value(raw, unfiltered); check(all, unfiltered);
  assert.equal(all.data.length, 3); assert.equal(all.data[1].dateEvidence, null); assert.equal(all.filterCoverage.complete, true);
});

test('过滤后短页与空页均按来源窗口推进；真正耗尽时停止', async t => {
  const windows = [
    { total: 5, limit: 3, offset: 0, data: [row(1, { date: null }), row(2, { date: null }), row(3, { date: null })] },
    { total: 5, limit: 3, offset: 3, data: [row(4), row(5)] },
  ];
  const calls = [];
  const service = new BangumiMcpService({ public: async (path, options) => { calls.push({ path, query: options.query }); return windows.shift(); }, close: async () => {} });
  t.after(() => service.close());
  const first = await service.call('browse_subjects', args);
  assert.equal(first.data.length, 0); assert.equal(first.page.nextOffset, 3); assert.equal(first.page.sourceHasMore, true);
  const second = await service.call('browse_subjects', { ...args, offset: first.page.nextOffset });
  assert.deepEqual(second.data.map(s => s.id), [4, 5]); assert.equal(second.page.nextOffset, null);
  assert.equal(calls.length, 2); assert.equal(calls[1].query.offset, 3);
  const short = value({ total: 10, data: [row(1, { date: null }), row(2)] }); check(short);
  assert.equal(short.page.nextOffset, 2); assert.equal(short.page.returnedCount, 1);
});

test('NSFW过滤与日期过滤共享原始来源游标，不泄漏被排除条目', async t => {
  const service = new BangumiMcpService({ public: async () => ({ total: 5, limit: 3, offset: 0,
    data: [row(1, { nsfw: true }), row(2, { date: null }), row(3)] }), close: async () => {} });
  t.after(() => service.close());
  const result = await service.call('browse_subjects', args); check(result);
  assert.deepEqual(result.data.map(s => s.id), [3]); assert.equal(result.page.nextOffset, 3);
  assert.equal(result.page.excludedNsfwCount, 1); assert.equal(result.filterCoverage.scannedCount, 2);
  assert.deepEqual(result.filterCoverage.unknownDateSubjectIds, [2]);
});

test('双端拒绝伪造精度、来源、媒体字段、匹配条件、覆盖计数及游标', () => {
  const original = value({ total: 2, data: [row(1, { date: null, infobox: infobox('2026年10月') }), row(2, { date: null })] });
  check(original);
  for (const mutate of [
    r => { r.data[0].dateEvidence.day = 1; r.data[0].dateEvidence.precision = 'day'; },
    r => { r.data[0].dateEvidence.sourceField = '发行日期'; },
    r => { r.data[0].dateEvidence.month = 11; },
    r => { r.data[0].date = '2026-10-01'; },
    r => { r.filterCoverage.complete = true; },
    r => { r.filterCoverage.scannedCount = 1; },
    r => { r.filterCoverage.unknownDateSubjectIds = [1]; },
    r => { r.page.nextOffset = 1; },
  ]) { const result = structuredClone(original); mutate(result); assert.throws(() => check(result), { code: 'MCP_INVALID_RESULT' }); }
  assert.throws(() => value({ data: [row(1, { date: '2026-11-01' })] }), error =>
    error.code === 'MCP_INVALID_RESULT' && error.contractIssue.reason === 'browse_date_mismatch' && error.contractIssue.subjectId === 1);
  assert.throws(() => value({ data: [row(1, { date: null, platform: 'OVA' })] }), { code: 'MCP_INVALID_RESULT' });
});

test('搜索精确日范围仍要求完整日期，不借浏览的年月证据绕过校验', () => {
  // 完整搜索值由服务构建；即使infobox给出年月，搜索仍拒绝未知date。
  const service = new BangumiMcpService({ public: async () => ({ total: 1, limit: 1, offset: 0,
    data: [row(1, { date: null, infobox: infobox('2026年10月') })] }), close: async () => {} });
  return assert.rejects(service.call('search_subjects', { keyword: '', subject_type: 2, limit: 1,
    filter: { air_date: { min: '2026-10-01', max: '2026-10-31' } } }), { code: 'MCP_INVALID_RESULT' }).finally(() => service.close());
});
