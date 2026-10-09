import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2]);
const suite = JSON.parse(readFileSync(join(directory, 'results.json')));
const nativeNames = ['prepare_component', 'present_component', 'present_text'];
const records = [];
for (const run of suite.observations) {
  const requests = [];
  for (const trace of run.traceDirectories) {
    const events = readFileSync(join(trace, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const event of events.filter(row => row.event === 'llm.provider_request')) {
      const path = join(trace, event.data.payload_ref.path), payload = JSON.parse(readFileSync(path));
      const tools = (payload.tools ?? []).map(tool => tool.function ?? tool), prepare = tools.find(tool => tool.name === 'prepare_component');
      requests.push({ payloadRef: path, requestedModel: payload.model,
        responseFormat: payload.response_format?.type ?? payload.text?.format?.type ?? null,
        declaredNativeTools: tools.map(tool => tool.name).filter(name => nativeNames.includes(name)),
        prepareDeclared: prepare !== undefined, prepareRootType: prepare?.parameters?.type ?? null,
        prepareBranches: prepare?.parameters?.anyOf?.length ?? null });
    }
  }
  records.push({ caseId: run.caseId, variant: run.variant, repeat: run.repeat, outcome: run.outcome,
    requests, successfulNativeCalls: run.turns.flatMap(turn => turn.tools.filter(tool => !tool.error && nativeNames.includes(tool.name)).map(tool => tool.name)),
    canonicalStatuses: run.turns.map(turn => turn.presentationStatus ?? null),
    completeComponents: run.turns.map(turn => (turn.final?.content ?? []).filter(part => part.pending === false).map(part => part.type)),
    providerHttpRequests: run.metrics.providerHttpRequests, modelRequests: run.metrics.modelRequests,
    capturedUsageRequests: run.metrics.requests.filter(request => request.inputTokens !== null).length,
    responseModels: [...new Set(run.metrics.requests.map(request => request.responseModel).filter(Boolean))],
    fixtureMisses: run.network.filter(event => event.fixtureMiss).length, captureIssues: run.captureIssues });
}
const variants = [...new Set(records.map(run => run.variant))];
const summary = variants.map(variant => {
  const runs = records.filter(run => run.variant === variant), requests = runs.flatMap(run => run.requests);
  return { variant, runs: runs.length, providerPayloads: requests.length,
    providerHttpRequests: runs.reduce((sum, run) => sum + (run.providerHttpRequests ?? 0), 0),
    modelRequestStarts: runs.reduce((sum, run) => sum + run.modelRequests, 0),
    preparedPayloadsBeyondHttpCount: requests.length - runs.reduce((sum, run) => sum + (run.providerHttpRequests ?? 0), 0),
    responseFormats: [...new Set(requests.map(request => request.responseFormat))],
    prepareRootTypesWhenDeclared: [...new Set(requests.filter(request => request.prepareDeclared).map(request => request.prepareRootType))],
    prepareBranchesWhenDeclared: [...new Set(requests.filter(request => request.prepareDeclared).map(request => request.prepareBranches))],
    successfulNativeCallCounts: Object.fromEntries(nativeNames.map(name => [name, runs.flatMap(run => run.successfulNativeCalls).filter(call => call === name).length])),
    fixtureMisses: runs.reduce((sum, run) => sum + run.fixtureMisses, 0),
    httpModelRequestCountsMatch: runs.every(run => run.providerHttpRequests === run.modelRequests),
    usageComplete: runs.every(run => run.capturedUsageRequests === run.modelRequests),
    passedRunsHttpCountsMatch: runs.filter(run => run.outcome === 'passed').every(run => run.providerHttpRequests === run.modelRequests),
    passedRunsUsageComplete: runs.filter(run => run.outcome === 'passed').every(run => run.capturedUsageRequests === run.modelRequests) };
});
writeFileSync(join(directory, 'actual-payload-evidence.json'), JSON.stringify({
  note: 'payload_ref records prepared provider payloads. Budget abort may prevent final payload from reaching HTTP; compare counters and only treat fully captured successful runs as performance evidence.',
  summary, records }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
