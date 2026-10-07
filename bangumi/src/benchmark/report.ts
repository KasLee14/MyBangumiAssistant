import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { traceHash, traceRedact } from '../tracing/redact.js';
import type { RunMetrics, RunObservation } from './schema.js';
import { record } from './schema.js';

export interface SuiteResult {
  schemaVersion: 1; startedAt: string; protocolHash: string;
  manifest: unknown; observations: RunObservation[]; runPaths: string[];
}
export interface MetricDelta {
  eligiblePairs: number; availablePairs: number; controlMedian: number | null;
  candidateMedian: number | null; pairedDeltaMedian: number | null; ratioDeltaMedian: number | null;
}
export interface CaseComparison {
  caseId: string; family: string; pairs: number; eligiblePairs: number;
  controlPassRate: number; candidatePassRate: number; flags: string[];
  metrics: Record<string, MetricDelta>;
}
export const COMPARISON_METRICS: Array<keyof RunMetrics> = [
  'mcpCalls', 'mcpMs', 'mcpInitializationMs', 'upstreamRequests', 'contextInputTokensMax', 'contextInputTokensSum', 'inputTokensSum', 'outputTokensSum',
  'cacheReadTokensSum', 'modelToolResultBytes', 'totalMs', 'modelMs', 'estimatedCost',
];
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
const infrastructure = new Set(['invalid_fixture', 'incomplete_capture', 'not_run']);
function identity(run: RunObservation): string { return run.caseId + ':' + run.repeat; }
export function compareObservations(control: RunObservation[], candidate: RunObservation[]) {
  const index = (rows: RunObservation[]) => {
    const result = new Map<string, RunObservation>();
    for (const run of rows) { if (result.has(identity(run))) throw new Error('比较中存在重复案例/轮次。'); result.set(identity(run), run); }
    return result;
  };
  const old = index(control), next = index(candidate), all = new Set([...old.keys(), ...next.keys()]);
  const blockedPairs: Array<{ caseId: string; repeat: number; reasons: string[] }> = [];
  const groups = new Map<string, Array<[RunObservation, RunObservation]>>();
  for (const id of all) {
    const a = old.get(id), b = next.get(id), reasons: string[] = [];
    if (!a || !b) reasons.push('missing_run');
    if (a && b) {
      if (a.protocolHash !== b.protocolHash || a.model !== b.model || a.thinking !== b.thinking || a.mode !== b.mode) reasons.push('protocol_mismatch');
      if (infrastructure.has(a.outcome) || infrastructure.has(b.outcome)) reasons.push('incomplete_evidence');
      if (a.error === 'global_model_request_budget_exhausted' || b.error === 'global_model_request_budget_exhausted') reasons.push('global_budget_exhausted');
      const models = (run: RunObservation) => [...new Set(run.metrics.requests.map(request => request.responseModel).filter(Boolean))].sort();
      if (models(a).length && models(b).length && JSON.stringify(models(a)) !== JSON.stringify(models(b))) reasons.push('response_model_mismatch');
    }
    if (reasons.length) { const run = a ?? b!; blockedPairs.push({ caseId: run.caseId, repeat: run.repeat, reasons }); continue; }
    const entries = groups.get(a!.caseId) ?? []; entries.push([a!, b!]); groups.set(a!.caseId, entries);
  }
  const cases: CaseComparison[] = [];
  for (const [caseId, pairs] of groups) {
    const eligible = pairs.filter(([a, b]) => a.outcome === 'passed' && b.outcome === 'passed');
    const metrics: Record<string, MetricDelta> = {};
    for (const key of COMPARISON_METRICS) {
      const measured = eligible.filter(([a, b]) => finite(a.metrics[key]) && finite(b.metrics[key]));
      const values = measured.map(([a, b]) => [Number(a.metrics[key]), Number(b.metrics[key])] as const);
      metrics[key] = { eligiblePairs: eligible.length, availablePairs: measured.length,
        controlMedian: median(values.map(value => value[0])), candidateMedian: median(values.map(value => value[1])),
        pairedDeltaMedian: median(values.map(value => value[1] - value[0])),
        ratioDeltaMedian: median(values.filter(value => value[0] > 0).map(value => (value[1] - value[0]) / value[0])) };
    }
    const flags: string[] = [];
    if (pairs.some(([a, b]) => a.outcome === 'passed' && b.outcome !== 'passed')) flags.push('hard-regression');
    if (pairs.some(([a, b]) => a.outcome !== 'passed' && b.outcome === 'passed')) flags.push('hard-improvement');
    if ((metrics.contextInputTokensSum?.ratioDeltaMedian ?? 0) > 0.15) flags.push('token-growth-review');
    if ((metrics.totalMs?.ratioDeltaMedian ?? 0) > 0.20) flags.push('latency-growth-review');
    if (eligible.length < 3) flags.push('small-sample');
    if (pairs.some(([a, b]) => a.grade.semanticReview === 'pending' || b.grade.semanticReview === 'pending')) flags.push('semantic-review-pending');
    cases.push({ caseId, family: pairs[0]![0].family, pairs: pairs.length, eligiblePairs: eligible.length,
      controlPassRate: pairs.filter(([a]) => a.outcome === 'passed').length / pairs.length,
      candidatePassRate: pairs.filter(([, b]) => b.outcome === 'passed').length / pairs.length, flags, metrics });
  }
  return { cases, blockedPairs, operationalTotals: { control: summarize(control), candidate: summarize(candidate) } };
}
export function summarize(rows: RunObservation[]) {
  const outcomes: Record<string, number> = {}, families = new Map<string, number[]>();
  for (const row of rows) {
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    const values = families.get(row.family) ?? []; values.push(row.outcome === 'passed' ? 1 : 0); families.set(row.family, values);
  }
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const totals = Object.fromEntries(COMPARISON_METRICS.map(key => {
    const values = rows.map(row => row.metrics[key]).filter(finite);
    return [key, { availableRuns: values.length, total: values.length ? values.reduce((a, b) => a + b, 0) : null }];
  }));
  return { runs: rows.length, outcomes, passRate: mean(rows.map(row => row.outcome === 'passed' ? 1 : 0)),
    macroFamilyPassRate: mean([...families.values()].map(values => mean(values)!)),
    semanticPending: rows.filter(row => row.grade.semanticReview === 'pending').length, totals };
}
export async function readSuite(path: string): Promise<SuiteResult> {
  const value = record(JSON.parse(await readFile(path, 'utf8')));
  if (value.schemaVersion !== 1 || typeof value.protocolHash !== 'string' || !Array.isArray(value.observations)) throw new Error('评测结果格式无效。');
  const validOutcomes = ['passed', 'failed', 'timeout', 'budget_exceeded', 'errored', 'invalid_fixture', 'incomplete_capture', 'not_run'];
  for (const raw of value.observations) {
    const row = record(raw), metrics = record(row.metrics);
    if (row.schemaVersion !== 1 || typeof row.caseId !== 'string' || typeof row.variant !== 'string'
      || !Number.isSafeInteger(row.repeat) || Number(row.repeat) < 1 || typeof row.protocolHash !== 'string'
      || !validOutcomes.includes(String(row.outcome)) || !Array.isArray(metrics.requests) || !Array.isArray(row.turns)
      || !Array.isArray(record(row.grade).checks)) throw new Error('评测运行记录格式无效。');
  }
  return value as unknown as SuiteResult;
}
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function sparkline(values: Array<number | null>): string {
  const known = values.filter(finite); if (!known.length) return '<span>不可用</span>';
  const max = Math.max(1, ...known);
  const points = values.map((value, index) => finite(value) ? (values.length === 1 ? 0 : index * 200 / (values.length - 1)) + ',' + (48 - value * 44 / max) : null).filter(Boolean).join(' ');
  return '<svg viewBox="0 0 210 54" width="210" height="54" role="img" aria-label="逐轮实际provider请求字节数"><polyline fill="none" stroke="#2563eb" stroke-width="2" points="' + points + '"/></svg>';
}
export async function writeReport(directory: string, suite: SuiteResult, baseline?: SuiteResult,
  selection: { baselineVariant?: string; candidateVariant?: string } = {}): Promise<void> {
  const variants = [...new Set(suite.observations.map(run => run.variant))];
  const select = (rows: RunObservation[], variant?: string) => {
    if (!rows.length) return [];
    const names = [...new Set(rows.map(row => row.variant))], name = variant ?? (names.includes('candidate') ? 'candidate' : names[0]);
    if (!name || !names.includes(name)) throw new Error('结果中没有所选variant。');
    return rows.filter(row => row.variant === name);
  };
  const control = baseline ? select(baseline.observations, selection.baselineVariant)
    : (variants.length === 2 ? suite.observations.filter(run => run.variant === 'control') : []);
  const candidate = baseline ? select(suite.observations, selection.candidateVariant)
    : suite.observations.filter(run => run.variant === (variants.length === 2 ? 'candidate' : variants[0]));
  const comparison = control.length ? compareObservations(control, candidate) : null;
  const planned = record(suite.manifest).plannedRuns;
  const plannedRuns = Array.isArray(planned) ? planned.length : suite.observations.length;
  const pendingRuns = Math.max(0, plannedRuns - suite.observations.length);
  const protocol = record(record(suite.manifest).protocol);
  const evidence = protocol.offline === true ? '脚本模型＋固定上游（离线 smoke）'
    : suite.observations[0]?.mode === 'live-read' || protocol.mode === 'live-read' ? '真实模型＋在线只读上游' : '真实模型＋固定上游';
  const data = { schemaVersion: 1, protocolHash: suite.protocolHash,
    summary: { ...summarize(suite.observations), plannedRuns, pendingRuns }, comparison };
  await writeFile(join(directory, 'comparison.json'), JSON.stringify(traceRedact(data), null, 2) + '\n');
  const cards = suite.observations.map((run, index) => {
    const root = suite.runPaths[index], links = root ? '<a href="' + escape(relative(directory, join(root, 'result.json')).replaceAll('\\', '/')) + '">原始结果</a>' : '';
    const traces = run.traceDirectories.map(path => '<a href="' + escape(relative(directory, join(path, 'summary.json')).replaceAll('\\', '/')) + '">trace摘要</a>').join(' ');
    const failures = run.grade.checks.filter(check => !check.passed).map(check => check.rule.kind + '：' + check.detail).join('\n');
    return '<details class="run" data-search="' + escape(run.caseId + ' ' + run.family + ' ' + run.outcome + ' ' + run.variant) + '"><summary>'
      + escape(run.caseId) + ' · ' + escape(run.variant) + ' #' + run.repeat + ' <strong>' + escape(run.outcome) + '</strong></summary>'
      + '<p>' + links + ' ' + traces + '</p><p>总耗时 ' + Math.round(run.metrics.totalMs) + 'ms；模型请求 ' + run.metrics.modelRequests
      + '；MCP ' + run.metrics.mcpCalls + '；上游 ' + escape(run.metrics.upstreamRequests ?? '不可用')
      + '；含缓存输入token ' + escape(run.metrics.contextInputTokensSum ?? '不可用') + '</p><p>每轮provider请求字节数</p>'
      + sparkline(run.metrics.requests.map(request => request.providerPayloadBytes))
      + '<p>语义评审：' + escape(run.grade.semanticReview) + ' ' + escape(run.grade.rubric) + '</p><pre>' + escape(failures || run.error || '自动硬判无失败项') + '</pre>'
      + run.turns.map((turn, turnIndex) => '<h3>对话轮次 ' + (turnIndex + 1) + '</h3><p>' + escape(turn.prompt) + '</p><pre>' + escape(turn.text)
        + '</pre><details><summary>实际工具调用与模型可见证据</summary><pre>' + escape(JSON.stringify(turn.tools, null, 2)) + '</pre></details>').join('')
      + '<details><summary>逐轮指标、上游请求及判分</summary><pre>' + escape(JSON.stringify({ metrics: run.metrics, network: run.network, grade: run.grade }, null, 2)) + '</pre></details></details>';
  }).join('\n');
  const comparisonRows = comparison?.cases.map(item => '<tr><td>' + escape(item.caseId) + '</td><td>' + (item.controlPassRate * 100).toFixed(0)
    + '% → ' + (item.candidatePassRate * 100).toFixed(0) + '%</td><td>' + item.eligiblePairs + '/' + item.pairs
    + '</td><td>' + escape(item.metrics.contextInputTokensSum?.pairedDeltaMedian ?? '不可用') + '</td><td>'
    + escape(item.metrics.totalMs?.pairedDeltaMedian === null ? '不可用' : Math.round(item.metrics.totalMs?.pairedDeltaMedian ?? 0))
    + '</td><td>' + escape(item.flags.join(', ')) + '</td></tr>').join('') ?? '';
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Bangumi benchmark</title><style>body{max-width:1100px;margin:32px auto;padding:0 20px;font:15px/1.65 system-ui;color:#172033;background:#f8fafc}table{width:100%;border-collapse:collapse}td,th{padding:9px;border:1px solid #dbe2eb;text-align:left;overflow-wrap:anywhere}details.run{background:white;border:1px solid #dbe2eb;border-radius:8px;padding:12px;margin:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:12px;border-radius:6px}input{width:100%;padding:10px;box-sizing:border-box}a{color:#2563eb}strong{color:#334155}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.stats div{background:white;border:1px solid #dbe2eb;border-radius:8px;padding:14px}.stats b{display:block;font-size:26px}.meta{overflow-wrap:anywhere}</style>'
    + '<h1>Bangumi benchmark</h1><p>自动硬判通过不等于语义评审通过。失败、超时和资料缺失均保留；性能差值只比较双方通过且指标可用的配对。API未返回的思考与token保持不可用。</p>'
    + '<p class="meta">' + escape(record(suite.manifest).label ?? 'benchmark') + ' · ' + escape(suite.observations[0]?.model)
    + ' · thinking=' + escape(suite.observations[0]?.thinking) + ' · ' + escape(suite.startedAt) + '</p>'
    + '<p>' + escape(evidence) + (pendingRuns ? '；尚有' + pendingRuns + '项计划未完成，不能作为完整套件基线。' : '') + '</p>'
    + '<div class="stats"><div>已记录 / 计划<b>' + data.summary.runs + ' / ' + plannedRuns + '</b></div><div>自动硬判通过率<b>'
    + (data.summary.passRate === null ? '不可用' : (data.summary.passRate * 100).toFixed(0) + '%')
    + '</b></div><div>按场景宏平均<b>' + (data.summary.macroFamilyPassRate === null ? '不可用' : (data.summary.macroFamilyPassRate * 100).toFixed(0) + '%')
    + '</b></div><div>待语义评审<b>' + data.summary.semanticPending + '</b></div></div>'
    + '<details><summary>完整资源消耗与结果状态</summary><pre>' + escape(JSON.stringify(data.summary, null, 2)) + '</pre></details>'
    + (comparison ? '<h2>版本对照</h2><table><tr><th>案例</th><th>硬判通过率</th><th>性能配对</th><th>输入token差值中位数</th><th>耗时差值ms</th><th>复核项</th></tr>' + comparisonRows + '</table><pre>' + escape(JSON.stringify(comparison.blockedPairs, null, 2)) + '</pre>' : '')
    + '<h2>逐例证据</h2><input id="filter" placeholder="筛选案例、场景、版本或结果状态" aria-label="筛选运行记录">' + cards
    + '<script>document.getElementById("filter").addEventListener("input",function(){const q=this.value.toLowerCase();document.querySelectorAll(".run").forEach(function(el){el.hidden=!el.dataset.search.toLowerCase().includes(q)})});</script></html>';
  await writeFile(join(directory, 'report.html'), html);
}
