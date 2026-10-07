import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateCases } from '../dist/src/benchmark/schema.js';
import { FixtureRouter, fixtureDefinition } from '../dist/src/benchmark/fixtures.js';
import { gradeCase, outputText } from '../dist/src/benchmark/scoring.js';
import { blankMetrics, MetricsCollector } from '../dist/src/benchmark/metrics.js';
import { createPlan, parseArguments, runWorker, PROJECT_ROOT } from '../dist/src/benchmark/cli.js';
import { compareObservations, summarize, writeReport } from '../dist/src/benchmark/report.js';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';

const cases = validateCases(JSON.parse(readFileSync(new URL('../benchmarks/cases.json', import.meta.url), 'utf8')));
const base = cases.find(row => row.id === 'facts-basic');
const fixture = fixtureDefinition('standard');
const temp = t => {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-benchmark-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()))); rmSync(root, { recursive: true, force: true }); });
  return root;
};
function transportFixture(definition = fixture) {
  const router = new FixtureRouter(definition), savedAt = Date.now() - 1000;
  const transport = createMcpTransport({ authDir: 'unused', timeoutMs: 1000, proxy: null,
    loadSession: async () => ({ version: 1, accountId: 42, username: definition.account.username,
      sessionId: 'benchmark-synthetic-session', savedAt, expiresAt: savedAt + 3600000 }), fakeFetch: router.fetch });
  return { router, transport, service: new BangumiMcpService(transport) };
}
function observation(overrides = {}) {
  return { schemaVersion: 1, caseId: base.id, family: base.family, variant: 'candidate', repeat: 1,
    protocolHash: 'protocol', versionHash: 'version', model: 'provider/model', thinking: 'off', mode: 'fixture',
    outcome: 'passed', error: null, turns: [], metrics: { ...blankMetrics(), totalMs: 100, contextInputTokensSum: 100, mcpCalls: 3 },
    grade: { passed: true, checks: [], semanticReview: 'not_required', rubric: null }, confirmations: [], network: [],
    traceDirectories: [], captureIssues: [], ...overrides };
}

test('案例验证拒绝未知规则、非法预算、重复ID、规则轮次越界', () => {
  assert.equal(cases.length, 26); assert.equal(cases.filter(row => row.core).length, 12);
  for (const changed of [
    { ...base, rules: [{ kind: 'made_up' }] }, { ...base, budget: { ...base.budget, timeoutMs: 0 } },
    { ...base, rules: [{ kind: 'text', turn: 9, pattern: 'x' }] }, { ...base, rules: [{ kind: 'subjects' }] },
    { ...base, rules: [{ kind: 'writes', count: 1, subjectIds: ['1001'] }] },
  ]) assert.throws(() => validateCases([changed]));
  assert.throws(() => validateCases([base, base]));
  assert.throws(() => fixtureDefinition('../secret'));
});

test('真实传输与服务执行参数化搜索、详情和尾页收藏，不回放固定MCP结果', async t => {
  const f = transportFixture(); t.after(() => f.service.close());
  const detail = await f.service.call('get_subject_details', { subject_id: 1001, fields: ['score', 'date', 'totalEpisodes'] });
  assert.equal(detail.score, 8.4); assert.equal(detail.date, '2024-01-08'); assert.equal(detail.totalEpisodes, 12);
  const movie = await f.service.call('search_subjects', { keyword: '', subject_type: 2,
    filter: { rating: { min: 7.5 }, tag: ['Movie'] }, fields: ['nameCn', 'score'], limit: 20 });
  assert.deepEqual(movie.data.map(row => row.id), [1002]);
  const collection = await f.service.call('query_user_collections', {
    username: '-', subject_type: 2, collection_type: 1, air_date: { min: '2024-01-01', max: '2024-12-31' },
  });
  assert.ok(collection.data.some(row => row.subjectId === 1011));
  assert.ok(f.router.events.filter(event => event.path === '/p1/collections/subjects').length >= 2);
  assert.equal(collection.coverage.complete, false, '未知日期不能报为全部筛选完成');
  assert.equal(f.router.events.some(event => event.fixtureMiss), false);
});

test('出演固定源含重复作品关系，真实服务按角色条件去重作品', async t => {
  const f = transportFixture(); t.after(() => f.service.close());
  const result = await f.service.call('get_person_characters', { person_id: 71, subject_type: 2,
    subject_form: 'movie', appearance_role: 'main', result_mode: 'candidates', fields: ['nameCn'], limit: 100 });
  assert.deepEqual(result.data.map(row => row.id).sort(), [1002, 1007]);
  assert.equal(f.router.events.some(event => event.fixtureMiss), false);
});

test('社区长评通过真实服务缓存续读，尾段存在且续读不增上游', async t => {
  const f = transportFixture(); t.after(() => f.service.close());
  const first = await f.service.call('get_blog_details', { blog_id: 301, fields: ['content'] });
  const before = f.router.events.length;
  assert.ok(first.content.range.nextOffset !== null);
  const tail = await f.service.call('read_community_content', { content_ref: first.content.contentRef,
    offset: first.content.range.nextOffset, limit: 5000 });
  assert.ok(tail.content.text.includes('记忆保管权'));
  assert.equal(f.router.events.length, before);
});

test('固定上游拒绝未知路径，写入丢回执保留实际状态供判分', async () => {
  const f = new FixtureRouter(fixtureDefinition('write-unknown'));
  await assert.rejects(f.fetch('https://next.bgm.tv/p1/collections/subjects/1001', { method: 'PUT', body: JSON.stringify({ type: 1, rate: 8, comment: '新短评', tags: [], private: false }) }));
  assert.equal(f.subjects.get(1001).interest.comment, '新短评');
  assert.equal(f.events[0].write, true);
  await assert.rejects(f.fetch('https://evil.invalid/anything', {}));
  assert.equal(f.events[1].fixtureMiss, true);
});

test('判分只认最终交付与实际模型可见证据，展示快照和工具候选不冒充交付', () => {
  const row = { prompt: '', final: { content: [] }, text: '', tools: [
    { name: 'get_subject_details', arguments: {}, value: { value: { id: 1001, score: 8.4, date: '2024-01-08', totalEpisodes: 12 } }, error: false },
  ], durationMs: 1 };
  const result = gradeCase(base, [row], fixture, [], [], []);
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(check => check.rule.kind === 'evidence').passed, true);
  const resourceCase = cases.find(row => row.id === 'resource-card');
  const displayOnly = { ...row, text: '山城来信', final: { content: [{ type: 'SubjectCards', pending: false,
    props: { items: [{ id: 1006, name: '山城来信', summary: '宿主补全的剧情' }] } }] }, tools: [] };
  assert.equal(gradeCase(resourceCase, [displayOnly], fixture, [], [], []).passed, false);
});

test('事实判分读取InfoBox数值、DataTable任意列单元格与链接，不漏掉合法组件结果', () => {
  const final = { content: [{ type: 'InfoBox', pending: false, props: { title: '星港追踪', rows: [
    { label: '评分', value: '8.4' }, { label: '首播日期', value: '2024-01-08' }, { label: '集数', value: '12集' },
  ] } }, { type: 'DataTable', pending: false, props: { columns: [{ key: 'arbitrary', label: '备注' }], rows: [{ arbitrary: '表格正文' }] } },
  { type: 'LinkList', pending: false, props: { links: [{ label: '条目链接', url: 'https://bgm.tv/subject/1001' }] } }] };
  const text = outputText(final);
  assert.ok(text.includes('8.4')); assert.ok(text.includes('表格正文')); assert.ok(text.includes('https://bgm.tv/subject/1001'));
  const turn = { prompt: '', final, text, tools: [{ name: 'get_subject_details', arguments: {},
    value: { value: { id: 1001, score: 8.4, date: '2024-01-08', totalEpisodes: 12 } }, error: false }], durationMs: 1 };
  assert.equal(gradeCase(base, [turn], fixture, [], [], []).passed, true);
});

test('未知写入重发、额外对象写入、拒绝授权后写入均不能通过', () => {
  const testCase = cases.find(row => row.id === 'write-decline'), network = [{ write: true, method: 'PUT', path: '/p1/collections/subjects/1001', subjectId: 1001 }];
  assert.equal(gradeCase(testCase, [], fixture, network, [{ accepted: false }], []).passed, false);
  const noRetry = { ...base, rules: [{ kind: 'no_write_retry' }] };
  assert.equal(gradeCase(noRetry, [], fixture, [...network, ...network], [], []).passed, false);
});

test('固定数据经过真实批量预检、一次授权与独立回读，保留其他字段；拒绝不写入', async t => {
  for (const accepted of [true, false]) {
    const f = transportFixture(); t.after(() => f.service.close());
    const confirmations = [], entries = [], input = { text: '修改1001与1003为想看，其他字段保持', generation: 1, requestId: 'benchmark-write-' + accepted };
    const append = (customType, data) => entries.push({ type: 'custom', customType, data });
    const client = { call: (name, args, signal, guard, scope) => f.service.call(name, args, signal, guard, scope), close: () => f.service.close() };
    const boundary = createWriteBoundary(client, () => input, data => append('bangumi/write', data), {
      canConfirm: () => true, confirm: async (_ctx, preview) => { confirmations.push({ preview, accepted, timestampMs: performance.timeOrigin + performance.now() }); return accepted; },
    });
    const batch = createBatchWriteTool(boundary, data => append('bangumi/batch', data));
    await batch.execute('benchmark-write', { operations: [1001, 1003].map(subject_id => ({
      tool: 'update_subject_collection', args: { subject_id, collection_type: 1 },
    })) }, new AbortController().signal, () => {}, { sessionManager: { getEntries: () => entries } });
    const testCase = cases.find(row => row.id === (accepted ? 'write-approve' : 'write-decline'));
    const grade = gradeCase(testCase, [], fixture, f.router.events, confirmations, [...f.router.subjects.values()]);
    assert.equal(grade.passed, true, JSON.stringify(grade));
  }
});

test('作品规则拒绝额外虚构链接，授权时序规则拒绝先提交后确认', () => {
  const testCase = { ...base, rules: [{ kind: 'subjects', exact: [1001] }] };
  const turn = { prompt: '', final: {}, text: 'https://bgm.tv/subject/1001 https://bgm.tv/subject/999999', tools: [], durationMs: 1 };
  assert.equal(gradeCase(testCase, [turn], fixture, [], [], []).passed, false);
  const approve = cases.find(row => row.id === 'write-approve');
  const events = [1001, 1003].map((subjectId, index) => ({ write: true, subjectId, path: '/p1/collections/subjects/' + subjectId,
    method: 'PUT', seq: index + 1, timestampMs: 10, status: 200 }));
  assert.equal(gradeCase(approve, [], fixture, events, [{ accepted: true, timestampMs: 20 }], [...new FixtureRouter(fixture).subjects.values()]).passed, false);
});

test('指标计入缓存上下文、供应商reasoning子集；缺失usage保持null', () => {
  const metric = new MetricsCollector(); metric.start(5, true); metric.payload(900);
  metric.event({ type: 'message_start', message: { role: 'assistant' } });
  metric.event({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '思考' } });
  metric.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [],
    usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 3, totalTokens: 38, reasoning: 2, cost: { total: 0.001 } } } });
  const result = metric.finish([], true);
  assert.equal(result.contextInputTokensSum, 33); assert.equal(result.inputTokensSum, 10);
  assert.equal(result.reasoningTokensSum, 2); assert.equal(result.outputTokensSum, 5);
  assert.equal(result.providerPayloadBytesMax, 900); assert.equal(result.requests[0].thinkingChars, 2);
  assert.equal(result.requests[0].responseModel, null, '未返回实际响应模型不能使用请求模型猜测');
  const missing = new MetricsCollector(); missing.start(0, true);
  missing.event({ type: 'message_start', message: { role: 'assistant' } });
  missing.event({ type: 'message_end', message: { role: 'assistant', content: [], usage: {} } });
  assert.equal(missing.finish([], false).inputTokensSum, null);
});

test('交错计划、失败保留、null与零分开；停止导致的低耗时不能算改进', () => {
  assert.deepEqual(createPlan([base], 3, true).map(task => task.variant), ['control', 'candidate', 'candidate', 'control', 'control', 'candidate']);
  const before = observation(), after = observation({ outcome: 'timeout', metrics: { ...blankMetrics(), totalMs: 1 } });
  const comparison = compareObservations([before], [after]);
  assert.equal(comparison.cases[0].eligiblePairs, 0);
  assert.ok(comparison.cases[0].flags.includes('hard-regression'));
  assert.equal(comparison.cases[0].metrics.totalMs.pairedDeltaMedian, null);
  assert.equal(compareObservations([before], [observation({ protocolHash: 'changed' })]).blockedPairs.length, 1);
  assert.equal(compareObservations([before], [observation({ outcome: 'not_run' })]).blockedPairs.length, 1);
  assert.equal(summarize([observation()]).totals.estimatedCost.total, null);
  assert.throws(() => compareObservations([before, before], [before]));
});

test('HTML转义外部正文，没有注入执行；成本缺失不写成零', async t => {
  const root = temp(t), malicious = '<script>alert("x")</script>';
  const run = observation({ turns: [{ prompt: malicious, text: malicious, final: {}, tools: [], durationMs: 1 }] });
  await writeReport(root, { schemaVersion: 1, startedAt: '', protocolHash: 'protocol', manifest: {}, observations: [run], runPaths: [] });
  const html = readFileSync(join(root, 'report.html'), 'utf8');
  assert.ok(html.includes('&lt;script&gt;')); assert.equal(html.includes(malicious), false);
  assert.equal(JSON.parse(readFileSync(join(root, 'comparison.json'), 'utf8')).summary.totals.estimatedCost.total, null);
});

test('尚未完成的计划在初始报告保留数量与证据层级，不把部分通过显示成完整套件', async t => {
  const root = temp(t);
  await writeReport(root, { schemaVersion: 1, startedAt: '', protocolHash: 'protocol',
    manifest: { plannedRuns: [{ caseId: 'one' }, { caseId: 'two' }], protocol: { offline: true } }, observations: [], runPaths: [] });
  const report = JSON.parse(readFileSync(join(root, 'comparison.json'), 'utf8'));
  assert.equal(report.summary.plannedRuns, 2); assert.equal(report.summary.pendingRuns, 2);
  assert.equal(report.summary.passRate, null);
  assert.ok(readFileSync(join(root, 'report.html'), 'utf8').includes('离线 smoke'));
});

test('CLI严格验证参数；offline完整跑真实Pi与stdio MCP，保存完整trace和自动硬判', async t => {
  assert.throws(() => parseArguments(['run', '--unknown', 'value']));
  assert.throws(() => parseArguments(['run', '--repeats', '1', '--repeats', '2']));
  assert.equal(PROJECT_ROOT, resolve(fileURLToPath(new URL('../..', import.meta.url))));
  const outputDir = temp(t);
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir, case: { ...base, budget: { ...base.budget, timeoutMs: 20000 } },
    fixture, variant: 'candidate', repeat: 1, protocolHash: 'smoke', versionHash: 'smoke',
    model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(outputDir, 'unused'), proxy: null, offline: true });
  assert.equal(result.outcome, 'passed', JSON.stringify({ error: result.error, grade: result.grade, issues: result.captureIssues }));
  assert.equal(result.metrics.providerHttpRequests, 0); assert.equal(result.metrics.upstreamRequests, 1);
  assert.equal(result.metrics.modelRequests, 2); assert.ok(result.traceDirectories.length);
  assert.ok(result.metrics.providerPayloadBytesMax > 0); assert.equal(result.network.some(event => event.fixtureMiss), false);
  const files = readdirSync(outputDir, { recursive: true });
  const configs = files.filter(file => file.endsWith('worker-config.json'));
  assert.equal(configs.length, 1);
});
