import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runWorker, PROJECT_ROOT, versionFingerprint } from '../../../../dist/src/benchmark/cli.js';
import { fixtureDefinition } from '../../../../dist/src/benchmark/fixtures.js';

const cases = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'bangumi/benchmarks/presentation-cases.json')));
const contract = await import('../../../../dist/src/output/presentation-contract.js');
const stopBudget = Array.isArray(contract.RENDER_TOOL_NAMES) ? 2 : 1;
const output = process.argv[2] && process.argv[2] !== '--describe' ? resolve(process.argv[2])
  : resolve(PROJECT_ROOT, 'bangumi/artifacts/benchmarks/presentation-optimized-20261009/development-negative-native');
if (process.argv[2] === '--describe') {
  console.log('离线负向：禁用纠参后首次拒绝→errored；模型预算1→budget_exceeded；均非成功正文。');
  process.exit(0);
}
mkdirSync(output, { recursive: true });
if (existsSync(join(output, 'negative-manifest.json'))) throw new Error('负向证据目录已有运行，不能覆盖。');
const fingerprint = versionFingerprint(PROJECT_ROOT), observations = [];
const plans = [
  { id: 'disabled-correction', script: 'native_duplicate_key', expectedOutcome: 'errored', expectedStatus: 'error' },
  { id: 'budget-stop', script: 'native_terminal_abort', expectedOutcome: 'budget_exceeded', expectedStatus: 'aborted', modelBudget: stopBudget },
];
writeFileSync(join(output, 'negative-manifest.json'), JSON.stringify({ evidence: 'offline expected failures; not successful-answer baseline',
  startedAt: new Date().toISOString(), versionHash: fingerprint.hash, plannedRuns: plans }, null, 2) + '\n');
for (const plan of plans) {
  const sample = cases.find(row => row.offlineScript === plan.script), runDir = join(output, plan.id);
  const result = await runWorker({ runtimeRoot: PROJECT_ROOT, outputDir: runDir,
    case: { ...sample, budget: { ...sample.budget, ...(plan.modelBudget ? { modelRequests: plan.modelBudget } : {}) } },
    fixture: fixtureDefinition(sample.fixture), variant: 'candidate', repeat: 1, protocolHash: 'offline-native-negative-' + plan.id,
    versionHash: fingerprint.hash, model: 'faux/faux-1', thinking: 'off', mode: 'fixture', agentDir: join(runDir, 'unused'),
    proxy: null, offline: true, recovery: 'disabled' });
  const verified = result.outcome === plan.expectedOutcome && result.turns[0]?.presentationStatus === plan.expectedStatus
    && result.metrics.validatedFinals === 0 && result.metrics.terminalModelErrors === 1 && result.metrics.providerHttpRequests === 0
    && (plan.id !== 'disabled-correction' || result.metrics.argumentRejections === 1 && result.metrics.modelArgumentCorrections === 0)
    && (plan.id !== 'budget-stop' || result.turns[0]?.text.split('保留前缀。').length - 1 === 1);
  observations.push({ id: plan.id, verified, expectedOutcome: plan.expectedOutcome, observation: result });
  console.log(JSON.stringify({ id: plan.id, verified, outcome: result.outcome, status: result.turns[0]?.presentationStatus,
    completedAnswers: result.metrics.validatedFinals, terminalErrors: result.metrics.terminalModelErrors, evidence: runDir }));
  if (!verified) process.exitCode = 1;
}
const stable = versionFingerprint(PROJECT_ROOT).hash === fingerprint.hash;
writeFileSync(join(output, 'negative-results.json'), JSON.stringify({ stableRuntime: stable, observations }, null, 2) + '\n');
if (!stable) { console.log('incomplete_capture: runtime_version_changed'); process.exitCode = 1; }
