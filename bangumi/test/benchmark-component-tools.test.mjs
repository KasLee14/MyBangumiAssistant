import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArguments, PROJECT_ROOT, runWorker } from '../dist/src/benchmark/cli.js';
import { validateCases } from '../dist/src/benchmark/schema.js';
import { MetricsCollector } from '../dist/src/benchmark/metrics.js';
import { fixtureDefinition } from '../dist/src/benchmark/fixtures.js';
import { gradeCase, canonicalBenchmarkContent, outputText } from '../dist/src/benchmark/scoring.js';
import { validateMixedContent } from '../dist/src/output/content-schema.js';

const suite = validateCases(JSON.parse(readFileSync(new URL('../benchmarks/component-tools-cases.json', import.meta.url), 'utf8')));
test('原生textSignature只留协议层，canonical正文仍严格拒绝组件额外字段', () => {
  const signature = JSON.stringify({ v: 1, id: 'native-response-item', phase: 'final_answer' });
  const native = { type: 'text', text: '评分8.4。', nextType: null, textSignature: signature };
  const raw = [native, { type: 'thinking', thinking: '内部思考' }];
  const canonical = canonicalBenchmarkContent(raw);
  assert.deepEqual(canonical, [{ type: 'text', text: '评分8.4。', nextType: null }]);
  assert.doesNotThrow(() => validateMixedContent({ content: canonical }));
  assert.equal(native.textSignature, signature);
  assert.equal(outputText({ content: raw.filter(part => part.type !== 'thinking') }), '评分8.4。');
  assert.equal(outputText({ content: canonical }), '评分8.4。');
  assert.doesNotThrow(() => validateMixedContent({ content: [{ type: 'Callout', pending: false, props: { tone: 'success', text: '组件' } }] }));
  for (const invalid of [
    { type: 'Callout', pending: false, props: { tone: 'success', text: '组件', unknown: '不能删掉' } },
    { type: 'Callout', pending: false, props: { tone: 'success', text: '组件' }, textSignature: signature },
    { type: 'text', text: 123, nextType: null, textSignature: signature },
  ]) assert.throws(() => validateMixedContent({ content: canonicalBenchmarkContent([invalid]) }));
});
test('新套件严格限制脚本枚举，原26案例未改，CLI recovery需显式取值', () => {
  assert.equal(JSON.parse(readFileSync(new URL('../benchmarks/cases.json', import.meta.url), 'utf8')).length, 26);
  assert.equal(suite.filter(item => item.offlineScript).length, 6);
  assert.deepEqual(parseArguments(['run', '--recovery', 'enabled']).values, { recovery: 'enabled' });
  assert.throws(() => validateCases([{ ...suite[0], offlineScript: 'arbitrary_code' }]));
  assert.ok(suite.find(item => item.id === 'card-style-followup').turns.length === 3);
});
test('metric按实际wire计strict，保留中间错误和恢复stage，不把未启用strict算成功', () => {
  const collector = new MetricsCollector();
  collector.start(0, true);
  collector.payload(123);
  collector.payloadTools({ tools: [{ type: 'function', function: { name: 'x', parameters: {}, strict: true } },
    { type: 'function', name: 'y', parameters: {}, strict: false }] });
  for (const stage of ['scheduled', 'running', 'recovered']) collector.event({ type: 'entry_appended', entry: { type: 'custom', customType: 'bangumi/recovery', data: { stage } } });
  collector.event({ type: 'message_start', message: { role: 'assistant' } });
  collector.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'CONTENT_OUTPUT_EMPTY empty_output' } });
  const metrics = collector.finish([], true);
  assert.equal(metrics.strictToolsSent, 1); assert.equal(metrics.initialToolCount, 2);
  assert.equal(metrics.initialProviderPayloadBytes, 123);
  assert.equal(metrics.modelErrors, 1); assert.equal(metrics.outputErrors, 1); assert.equal(metrics.blankOutputErrors, 1);
  assert.equal(metrics.recoveryScheduled, 1); assert.equal(metrics.recoveryRunning, 1); assert.equal(metrics.recoveryRecovered, 1);
});
test('恢复规则区分预期失败验收与成功回答，不接受缺失遥测', () => {
  const collector = new MetricsCollector();
  Object.assign(collector.value, { outputErrors: 3, modelErrors: 3, terminalModelErrors: 1, recoveryScheduled: 2, recoveryStopped: 1 });
  const sample = { ...suite[0], turns: ['故障'], rules: [{ kind: 'recovery', expectedTerminal: 'error' }] };
  assert.equal(gradeCase(sample, [{ text: '', final: null, tools: [] }], fixtureDefinition('standard'), [], [], null, collector.value).passed, true);
  assert.equal(gradeCase({ ...sample, rules: [{ kind: 'recovery', expectedTerminal: 'success' }] }, [], fixtureDefinition('standard'), [], [], null, collector.value).passed, false);
  assert.equal(gradeCase(sample, [], fixtureDefinition('standard'), [], [], null).passed, false);
});
test('输出分类优先固定诊断code，资源引用Schema错误计数，空白不误计JSON未闭合', () => {
  const collect = (code, reason, errorMessage) => {
    const collector = new MetricsCollector();
    collector.event({ type: 'message_start', message: { role: 'assistant' } });
    collector.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage,
      diagnostics: [{ type: 'bangumi_error', details: { diagnostic: { origin: 'content', code, reason } } }] } });
    return collector.finish([], true);
  };
  const resource = collect('CONTENT_SCHEMA_INVALID', 'resource_reference_invalid', '资源引用未满足契约。');
  assert.equal(resource.outputErrors, 1); assert.equal(resource.schemaOutputErrors, 1);
  assert.equal(resource.blankOutputErrors, 0); assert.equal(resource.jsonOutputErrors, 0);
  const blank = collect('CONTENT_OUTPUT_EMPTY', 'empty_output', '382空白字符，旧描述包含json_incomplete');
  assert.equal(blank.outputErrors, 1); assert.equal(blank.blankOutputErrors, 1);
  assert.equal(blank.schemaOutputErrors, 0); assert.equal(blank.jsonOutputErrors, 0);
  const json = collect('CONTENT_JSON_INCOMPLETE', 'stream_terminal_missing', '正文未完成。');
  assert.equal(json.outputErrors, 1); assert.equal(json.jsonOutputErrors, 1);
  assert.equal(json.blankOutputErrors, 0); assert.equal(json.schemaOutputErrors, 0);
  const legacy = collect(undefined, 'empty_output', 'CONTENT_OUTPUT_EMPTY json incomplete');
  assert.equal(legacy.blankOutputErrors, 1); assert.equal(legacy.jsonOutputErrors, 0);
});
for (const sample of suite.filter(item => item.offlineScript)) test('真实Pi恢复script benchmark：' + sample.id, { timeout: 80000 }, async t => {
  const outputDir = mkdtempSync(join(tmpdir(), 'bangumi-component-tools-bench-'));
  t.after(() => { assert.ok(resolve(outputDir).startsWith(resolve(tmpdir()) + sep)); rmSync(outputDir, { recursive: true, force: true }); });
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir, case: sample, fixture: fixtureDefinition(sample.fixture),
    variant: 'candidate', repeat: 1, protocolHash: 'script-recovery', versionHash: 'script-recovery',
    model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(outputDir, 'unused'), proxy: null, offline: true, recovery: 'enabled' });
  assert.equal(result.outcome, 'passed', JSON.stringify({ error: result.error, grade: result.grade, issues: result.captureIssues, metrics: result.metrics }));
  assert.equal(result.metrics.providerHttpRequests, 0);
  assert.ok(result.metrics.outputErrors > 0); assert.ok(result.metrics.recoveryScheduled > 0);
  if (sample.expectedTerminal !== 'error') {
    assert.ok(result.metrics.recoveryRecovered > 0); assert.equal(result.metrics.terminalModelErrors, 0);
    assert.equal(result.metrics.validatedFinals, 1);
  } else { assert.ok(result.metrics.terminalModelErrors > 0); assert.ok(result.metrics.recoveryStopped > 0); }
  if (sample.offlineScript === 'blank_output') assert.ok(result.metrics.blankOutputErrors > 0);
  if (sample.offlineScript === 'prefix_then_invalid') {
    assert.equal(result.metrics.prefixMonotonic, true); assert.equal(result.metrics.prefixDuplications, 0);
    assert.equal(result.turns[0].text.match(/保留前缀。/gu).length, 1);
  }
});
