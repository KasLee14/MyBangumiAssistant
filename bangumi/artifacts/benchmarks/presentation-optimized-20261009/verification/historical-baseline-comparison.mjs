import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('artifacts/benchmarks');
const currentDir = join(root, 'presentation-optimized-20261009/model-paired-r4-final');
const read = async (dir, name) => JSON.parse(await readFile(join(dir, name), 'utf8'));
const current = await read(currentDir, 'results.json');
const currentManifest = await read(currentDir, 'manifest.json');
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const equal = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const key = row => `${row.caseId}:${row.repeat}`;
const currentRuns = new Map(current.observations.filter(row => row.variant === 'candidate').map(row => [key(row), row]));
const median = values => { const ordered = values.slice().sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };
const cohorts = [];
for (const [label, relative] of [
  ['earliest-all-tools-json', 'component-tools-20261008-paired-accepted'],
  ['pre-presentation-mixed-json', 'presentation-20261008/model-paired-final-r3'],
  ['prepare-present-latest-direct-control', 'presentation-optimized-20261009/model-paired-r4-final'],
]) {
  const dir = join(root, relative), previous = await read(dir, 'results.json'), manifest = await read(dir, 'manifest.json');
  const original = previous.observations.filter(row => row.variant === 'control');
  const caseChecks = manifest.protocol.cases.filter(row => original.some(run => run.caseId === row.id)).map(row => {
    const counterpart = currentManifest.protocol.cases.find(item => item.id === row.id);
    return { caseId: row.id, samePrompts: !!counterpart && equal(row.turns, counterpart.turns),
      sameRules: !!counterpart && equal(row.rules, counterpart.rules), sameBudget: !!counterpart && equal(row.budget, counterpart.budget) };
  });
  const eligibleIds = new Set(caseChecks.filter(row => row.samePrompts && row.sameRules && row.sameBudget).map(row => row.caseId));
  const matched = original.flatMap(before => {
    const after = currentRuns.get(key(before));
    return after && eligibleIds.has(before.caseId) && before.outcome === 'passed' && after.outcome === 'passed'
      && !before.captureIssues?.length && !after.captureIssues?.length ? [{ before, after }] : [];
  });
  const metrics = {};
  for (const metric of ['modelRequests', 'contextInputTokensSum', 'contextInputTokensMax', 'totalMs', 'modelMs', 'initialToolCount', 'initialToolSchemaBytes']) {
    const available = matched.filter(pair => typeof pair.before.metrics[metric] === 'number' && typeof pair.after.metrics[metric] === 'number');
    const oldValues = available.map(pair => pair.before.metrics[metric]), newValues = available.map(pair => pair.after.metrics[metric]);
    const oldSum = oldValues.reduce((a, b) => a + b, 0), newSum = newValues.reduce((a, b) => a + b, 0);
    metrics[metric] = { pairs: available.length, originalSum: oldSum, currentSum: newSum,
      originalMedian: median(oldValues), currentMedian: median(newValues), sumDeltaPercent: oldSum ? (newSum / oldSum - 1) * 100 : null };
  }
  cohorts.push({ label, evidence: label === 'prepare-present-latest-direct-control' ? 'formal same-batch paired comparison' : 'historical cross-batch comparison only',
    originalDirectory: relative, originalVersion: manifest.versions.control.hash, currentVersion: currentManifest.versions.candidate.hash,
    originalRuns: original.length, originalPassed: original.filter(row => row.outcome === 'passed').length,
    matchedPairs: matched.length, matchedIds: matched.map(pair => key(pair.before)),
    sameModel: manifest.protocol.model === currentManifest.protocol.model, sameThinking: manifest.protocol.thinking === currentManifest.protocol.thinking,
    sameModelConfig: manifest.protocol.modelConfigHash === currentManifest.protocol.modelConfigHash,
    sameHarness: manifest.protocol.harnessHash === currentManifest.protocol.harnessHash,
    sameFixtures: equal(manifest.protocol.fixtures, currentManifest.protocol.fixtures), caseChecks, metrics });
}
const output = { note: 'No new model or upstream requests. Original observations and grades were not modified. Historical comparisons do not establish a same-harness randomized causal A/B result.', cohorts };
await writeFile(join(root, 'presentation-optimized-20261009/historical-baseline-comparison.json'), JSON.stringify(output, null, 2) + '\n');
for (const cohort of cohorts) process.stdout.write(JSON.stringify({ label: cohort.label, pairs: cohort.matchedPairs,
  sameModelConfig: cohort.sameModelConfig, sameHarness: cohort.sameHarness, sameFixtures: cohort.sameFixtures,
  modelRequests: cohort.metrics.modelRequests, context: cohort.metrics.contextInputTokensSum,
  peak: cohort.metrics.contextInputTokensMax, totalMs: cohort.metrics.totalMs }) + '\n');
