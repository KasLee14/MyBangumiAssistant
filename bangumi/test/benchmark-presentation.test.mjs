import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PROJECT_ROOT, runWorker } from '../dist/src/benchmark/cli.js';
import { validateCases } from '../dist/src/benchmark/schema.js';
import { gradeCase } from '../dist/src/benchmark/scoring.js';
import { fixtureDefinition } from '../dist/src/benchmark/fixtures.js';
import { MetricsCollector } from '../dist/src/benchmark/metrics.js';
import { comparisonEvidence } from '../dist/src/benchmark/report.js';
import { inspectHistoryOccurrences } from '../dist/src/benchmark/history.js';

const suite = validateCases(JSON.parse(readFileSync(new URL('../benchmarks/presentation-cases.json', import.meta.url), 'utf8')));

test('单次wire正文重复核对区分display args、native、业务证据与signed fallback', () => {
  const text = '已完成正文\n第二行。';
  const sources = [{ userTurn: 1, replyId: 'reply', partIndex: 0, text }];
  const payload = { messages: [{ role: 'assistant', content: text, tool_calls: [{ function: {
    name: 'render_SubjectCards', arguments: JSON.stringify({ before: text }) } }] },
    { role: 'tool', content: '业务证据也引用：' + text }] };
  const proof = inspectHistoryOccurrences(payload, sources, new Map([['reply', false]]))[0];
  assert.equal(proof.nativeOccurrences, 1); assert.equal(proof.displayArgumentOccurrences, 1);
  assert.equal(proof.otherOccurrences, 1); assert.equal(proof.signedFallback, false);
  payload.messages[0].tool_calls = [];
  assert.equal(inspectHistoryOccurrences(payload, sources)[0].displayArgumentOccurrences, 0);
  assert.equal(inspectHistoryOccurrences(payload, sources)[0].signedFallback, null, 'wire缺签名不证明可归并');
  assert.equal(inspectHistoryOccurrences(payload, sources, new Map([['reply', true]]))[0].signedFallback, true);
});

test('多行正文完整JSON表示计数保留原表示，不依赖逐行命中', () => {
  const text = '已完成正文\n第二行含"引用"和\\路径。';
  const source = [{ userTurn: 1, replyId: 'reply', partIndex: 0, text }];
  const inspect = content => inspectHistoryOccurrences({ messages: [{ role: 'assistant', content }] }, source)[0];
  const summary = '历史摘要：' + JSON.stringify([{ type: 'text', text }]);
  assert.deepEqual(inspect(text).nativeRepresentations, { raw: 1, jsonEncoded: 0 });
  assert.deepEqual(inspect(summary).nativeRepresentations, { raw: 0, jsonEncoded: 1 });
  assert.equal(inspect(summary + '\n' + summary).nativeOccurrences, 2);
  assert.deepEqual(inspect(text + '\n' + summary).nativeRepresentations, { raw: 1, jsonEncoded: 1 });
  assert.equal(inspect('已完成正文\n第二行含其它内容。').nativeOccurrences, 0, '部分行命中不证明完整正文');
});

test('同一raw与JSON span不doublecount，转义字面量和实际换行保持区别', () => {
  const inspect = (text, content) => inspectHistoryOccurrences({ messages: [{ role: 'assistant', content }] },
    [{ userTurn: 1, replyId: 'reply', partIndex: 0, text }])[0];
  const plain = '正文只有一份';
  const quoted = inspect(plain, JSON.stringify({ text: plain }));
  assert.equal(quoted.nativeOccurrences, 1);
  assert.deepEqual(quoted.nativeRepresentations, { raw: 0, jsonEncoded: 1 }, '同一个JSON字面量内部raw span不另算');
  const newline = '一\n二', literal = '一\\n二';
  assert.equal(inspect(newline, JSON.stringify({ text: literal })).nativeOccurrences, 0);
  assert.equal(inspect(literal, JSON.stringify({ text: newline })).nativeOccurrences, 0);
  assert.equal(inspect(newline, JSON.stringify({ text: newline })).nativeOccurrences, 1);
  assert.equal(inspect(literal, JSON.stringify({ text: literal })).nativeOccurrences, 1);
  assert.equal(inspect(literal, literal).nativeOccurrences, 1);
  assert.equal(inspect('\n', JSON.stringify('\\n')).nativeOccurrences, 0, '不得从另一转义序列中间开始匹配');
  assert.equal(inspect('\\n', JSON.stringify('\n')).nativeOccurrences, 0);
  assert.equal(inspect('\\n', JSON.stringify('\\n')).nativeOccurrences, 1);
  assert.equal(inspect('"', JSON.stringify('"')).nativeOccurrences, 1, 'JSON字面量边界引号不当作两份正文');
  assert.deepEqual(inspect('"原样引用"', '"原样引用"').nativeRepresentations, { raw: 1, jsonEncoded: 0 });
});

test('完整plannedRuns和冻结版本都是配对资格条件，部分通过不算eligible', () => {
  const run = { caseId: 'facts-basic', variant: 'candidate', repeat: 1, versionHash: 'frozen', protocolHash: 'same',
    outcome: 'passed', captureIssues: [] };
  const result = { protocolHash: 'same', observations: [run], manifest: { protocolHash: 'same',
    versions: { candidate: { hash: 'frozen' } }, plannedRuns: [{ caseId: 'facts-basic', variant: 'candidate', repeat: 1 }] } };
  assert.equal(comparisonEvidence(result)[0].outcome, 'passed');
  result.manifest.plannedRuns.push({ caseId: 'another', variant: 'candidate', repeat: 1 });
  assert.ok(comparisonEvidence(result)[0].captureIssues.includes('incomplete_planned_runs'));
  result.manifest.plannedRuns.pop(); result.observations[0].versionHash = 'drift';
  assert.ok(comparisonEvidence(result)[0].captureIssues.includes('runtime_version_mismatch'));
});

test('准备工具结果不算已交付组件，卡片缺字段或交错顺序错误必须失败', () => {
  const sample = suite.find(row => row.id === 'facts-card-complete');
  const rows = [{ prompt: '', text: '', final: { content: [] }, tools: [{ name: 'prepare_component', value: {
    resourceRef: 'rr_ready', blocks: [{ blockIndex: 0, type: 'SubjectCards' }] }, error: false }], durationMs: 1 }];
  assert.equal(gradeCase(sample, rows, fixtureDefinition('standard'), [], [], null).passed, false);
  rows[0].final.content = [{ type: 'SubjectCards', pending: false, props: { layout: 'grid', items: [{ id: 1001, name: '星港追踪', kind: 'anime' }] } }];
  assert.equal(gradeCase(sample, rows, fixtureDefinition('standard'), [], [], null).checks.find(row => row.rule.kind === 'delivered_fields').passed, false);
  const fact = fixtureDefinition('standard').subjects.find(row => row.id === 1001);
  rows[0].final.content[0].props.items[0] = { id: fact.id, name: fact.name, kind: 'anime', score: fact.score, date: fact.date,
    summary: fact.summary, image: 'https://example.invalid/benchmark/1001.png', url: 'https://bgm.tv/subject/1001' };
  assert.equal(gradeCase(sample, rows, fixtureDefinition('standard'), [], [], null).checks.find(row => row.rule.kind === 'delivered_fields').passed, true);
  rows[0].final.content[0].props.items[0].score = 9.9;
  assert.equal(gradeCase(sample, rows, fixtureDefinition('standard'), [], [], null).checks.find(row => row.rule.kind === 'delivered_fields').passed, false);
  const order = { ...sample, rules: [{ kind: 'sequence', types: ['text', 'SubjectCards', 'text'] }] };
  assert.equal(gradeCase(order, rows, fixtureDefinition('standard'), [], [], null).passed, false);
  rows[0].final.content = [{ type: 'text', text: '条件' }, ...rows[0].final.content, { type: 'text', text: '理由' }];
  assert.equal(gradeCase(order, rows, fixtureDefinition('standard'), [], [], null).passed, true);
});

test('空表格或空信息框不能借框外文字的正确事实通过组件内部字段断言', () => {
  for (const [id, type, props] of [['facts-data-table', 'DataTable', { columns: [], rows: [] }], ['facts-info-box', 'InfoBox', { rows: [] }]]) {
    const sample = suite.find(row => row.id === id);
    const final = { content: [{ type, pending: false, props }, { type: 'text', text: '星港追踪 8.4 2024-01-08 12；玻璃海的回声 8.1 2024-04-12' }] };
    const checks = gradeCase(sample, [{ final, text: final.content[1].text, tools: [], durationMs: 1 }], fixtureDefinition('standard'), [], [], null).checks;
    assert.ok(checks.filter(row => row.rule.kind === 'component_text').every(row => row.passed === false));
  }
});

test('本地语法修复、拒绝和模型纠参分别按真实审计和后续工具结果计数', () => {
  const collector = new MetricsCollector();
  collector.event({ type: 'message_start', message: { role: 'assistant' } });
  collector.event({ type: 'entry_appended', entry: { type: 'custom', customType: 'bangumi/presentation_arguments', data: { status: 'repaired' } } });
  collector.event({ type: 'entry_appended', entry: { type: 'custom', customType: 'bangumi/presentation_arguments', data: { status: 'rejected' } } });
  collector.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'present_text', isError: true } });
  collector.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'present_text', isError: false } });
  const metrics = collector.finish([], true);
  assert.equal(metrics.firstRoundFailed, true); assert.equal(metrics.localArgumentRepairs, 1);
  assert.equal(metrics.argumentRejections, 1); assert.equal(metrics.modelArgumentCorrections, 1);
});

test('provider文字和准备回执不提前计用户交付，canonical发布才记录首正文', () => {
  const collector = new MetricsCollector(); collector.start(0, true);
  const snapshot = (status, content) => collector.event({ type: 'entry_appended', entry: {
    type: 'custom', customType: 'bangumi/presentation', data: { status, content } } });
  snapshot('open', []);
  collector.event({ type: 'message_start', message: { role: 'assistant' } });
  collector.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '研究草稿' } });
  collector.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'prepare_component', isError: false,
    content: [{ type: 'text', text: '{"blocks":[{"type":"SubjectCards"}]}' }] } });
  assert.equal(collector.value.firstTextMs, null); assert.equal(collector.value.firstPublishedBlockMs, null);
  assert.notEqual(collector.value.providerFirstTextMs, null);
  snapshot('open', [{ type: 'SubjectCards', pending: false, props: {} }]);
  assert.notEqual(collector.value.firstPublishedBlockMs, null); assert.equal(collector.value.firstCompleteResultMs, null);
  snapshot('completed', [{ type: 'text', text: '真正正文' }]);
  assert.notEqual(collector.value.firstTextMs, null); assert.notEqual(collector.value.firstCompleteResultMs, null);
});

test('先检索多轮再首次展示失败计firstOutputAttempt，不混成首请求失败或本地修复失败', () => {
  const collector = new MetricsCollector();
  for (let request = 0; request < 3; request++) {
    collector.event({ type: 'message_start', message: { role: 'assistant' } });
    collector.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'read-' + request, name: 'get_subject_details' }] } });
  }
  collector.event({ type: 'message_start', message: { role: 'assistant' } });
  collector.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse',
    content: [{ type: 'toolCall', id: 'first-display', name: 'prepare_component' }] } });
  collector.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'prepare_component', toolCallId: 'first-display', isError: true } });
  assert.equal(collector.value.firstRoundFailed, false); assert.equal(collector.value.firstOutputAttemptFailed, true);
  const repaired = new MetricsCollector();
  repaired.event({ type: 'entry_appended', entry: { type: 'custom', customType: 'bangumi/presentation_arguments', data: { stage: 'syntax', status: 'repaired' } } });
  repaired.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'present_text', isError: false } });
  assert.equal(repaired.value.localArgumentRepairs, 1); assert.equal(repaired.value.firstOutputAttemptFailed, false);
});

test('wire展示声明按真实用户轮退役，activation后只所选集合，重发历史仅计prefix成本', () => {
  const collector = new MetricsCollector(); collector.startUserTurn(1);
  const user = { role: 'user', content: '同一用户输入' };
  collector.payloadTools({ messages: [user], tools: [] });
  assert.deepEqual(collector.value.userTurnInitialDisplaySchemas, [{ userTurn: 1, names: [], bytes: 0 }]);
  collector.event({ type: 'message_end', message: { role: 'toolResult', toolName: 'read_component_spec', content: [
    { type: 'text', text: JSON.stringify({ version: 'v', status: 'activated', tools: ['render_SubjectCards'] }) } ] } });
  collector.payloadTools({ messages: [user], tools: [{ type: 'function', function: { name: 'render_SubjectCards', parameters: { type: 'object' } } }] });
  assert.equal(collector.value.displayLoadoutMismatches, 0);
  assert.equal(collector.value.activatedDisplaySets[0].containsSchema, false);
  assert.ok(collector.value.repeatedMessageBytesSum > 0);
  collector.payloadTools({ messages: [user], tools: [{ name: 'render_DataTable', parameters: { type: 'object' } }] });
  assert.equal(collector.value.displayLoadoutMismatches, 1);
  collector.startUserTurn(2); collector.payloadTools({ messages: [user], tools: [] });
  assert.deepEqual(collector.value.userTurnInitialDisplaySchemas[1], { userTurn: 2, names: [], bytes: 0 });
});

test('host canonical commit后的额外HTTP独立计数，下一真实用户请求不误计', () => {
  const collector = new MetricsCollector(); collector.start(0, false); collector.startUserTurn(1);
  collector.providerHttpRequest();
  collector.event({ type: 'entry_appended', entry: { type: 'custom', customType: 'bangumi/presentation', data: { status: 'completed', content: [] } } });
  collector.providerHttpRequest(); assert.equal(collector.value.requestsAfterTerminalCommit, 1);
  collector.startUserTurn(2); collector.providerHttpRequest();
  assert.equal(collector.value.requestsAfterTerminalCommit, 1); assert.equal(collector.value.providerHttpRequests, 3);
});

for (const sample of suite.filter(row => row.offlineScript)) test('原生展示工具参数离线验收：' + sample.id, { timeout: 80000 }, async t => {
  const outputDir = mkdtempSync(join(tmpdir(), 'bangumi-native-benchmark-'));
  t.after(() => { assert.ok(resolve(outputDir).startsWith(resolve(tmpdir()) + sep)); rmSync(outputDir, { recursive: true, force: true }); });
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir, case: sample, fixture: fixtureDefinition(sample.fixture),
    variant: 'candidate', repeat: 1, protocolHash: 'native-arguments', versionHash: 'native-arguments',
    model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(outputDir, 'unused'), proxy: null, offline: true,
    recovery: sample.expectedTerminal === 'error' ? 'disabled' : 'enabled' });
  assert.equal(result.outcome, 'passed', JSON.stringify({ error: result.error, grade: result.grade, issues: result.captureIssues, metrics: result.metrics }));
  assert.equal(result.metrics.providerHttpRequests, 0);
  if (sample.expectedTerminal === 'error') {
    assert.equal(result.metrics.validatedFinals, 0); assert.equal(result.metrics.terminalModelErrors, 1);
    assert.ok(['error', 'aborted'].includes(result.turns[0].presentationStatus));
    assert.equal(result.turns[0].text.split('保留前缀。').length - 1, 1);
  } else {
    assert.equal(result.metrics.validatedFinals, 1); assert.equal(result.metrics.terminalModelErrors, 0);
    const contract = await import('../dist/src/output/presentation-contract.js');
    if (Array.isArray(contract.RENDER_TOOL_NAMES)) {
      assert.equal(result.turns[0].completionProof.source, 'tool_finish_turn');
      assert.equal(result.turns[0].completionProof.allBatchResultsSuccessful, true);
      assert.equal(result.turns[0].completionProof.modelAtCommit, result.turns[0].completionProof.modelAtSettled);
      assert.equal(result.metrics.requestsAfterTerminalCommit, 0);
      assert.deepEqual(result.metrics.userTurnInitialDisplaySchemas[0].names, []);
      assert.equal(result.metrics.displayLoadoutMismatches, 0);
      assert.equal(result.metrics.activatedDisplaySets[0].containsSchema, false);
      assert.equal(result.metrics.modelRequests, sample.offlineScript === 'native_trailing_comma' ? 2 : 3,
        '明确final整批成功应直接settled，不能再请求模型ack');
    }
  }
});

test('禁用模型纠参时首个参数拒绝必须停止，不能借normal tool loop绕过零预算', { timeout: 80000 }, async t => {
  const outputDir = mkdtempSync(join(tmpdir(), 'bangumi-native-no-recovery-'));
  t.after(() => { assert.ok(resolve(outputDir).startsWith(resolve(tmpdir()) + sep)); rmSync(outputDir, { recursive: true, force: true }); });
  const sample = suite.find(row => row.offlineScript === 'native_duplicate_key');
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir, case: sample, fixture: fixtureDefinition(sample.fixture),
    variant: 'candidate', repeat: 1, protocolHash: 'native-no-recovery', versionHash: 'native-no-recovery',
    model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(outputDir, 'unused'), proxy: null, offline: true, recovery: 'disabled' });
  assert.equal(result.outcome, 'errored', JSON.stringify({ error: result.error, metrics: result.metrics, turns: result.turns }));
  assert.equal(result.metrics.modelArgumentCorrections, 0); assert.equal(result.metrics.argumentRejections, 1);
  assert.equal(result.metrics.validatedFinals, 0); assert.equal(result.metrics.terminalModelErrors, 1);
  assert.equal(result.turns[0].presentationStatus, 'error');
  assert.equal(result.turns[0].text, '');
});

test('达到模型预算必须有限停止并保留canonical前缀，预算耗尽不能算成功回答', { timeout: 80000 }, async t => {
  const outputDir = mkdtempSync(join(tmpdir(), 'bangumi-native-budget-'));
  t.after(() => { assert.ok(resolve(outputDir).startsWith(resolve(tmpdir()) + sep)); rmSync(outputDir, { recursive: true, force: true }); });
  const sample = suite.find(row => row.offlineScript === 'native_terminal_abort');
  const contract = await import('../dist/src/output/presentation-contract.js');
  // 新架构先用一次请求加载renderer，再发布前缀；负向预算卡在下一请求，真实核心案例18/300不变。
  const stopBudget = Array.isArray(contract.RENDER_TOOL_NAMES) ? 2 : 1;
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir, case: { ...sample, budget: { ...sample.budget, modelRequests: stopBudget } },
    fixture: fixtureDefinition(sample.fixture), variant: 'candidate', repeat: 1, protocolHash: 'native-stop', versionHash: 'native-stop',
    model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(outputDir, 'unused'), proxy: null, offline: true, recovery: 'disabled' });
  assert.equal(result.outcome, 'budget_exceeded', JSON.stringify({ error: result.error, metrics: result.metrics, turns: result.turns }));
  assert.equal(result.metrics.validatedFinals, 0); assert.equal(result.metrics.terminalModelErrors, 1);
  assert.equal(result.turns[0].presentationStatus, 'aborted');
  assert.equal(result.turns[0].text.split('保留前缀。').length - 1, 1);
});
