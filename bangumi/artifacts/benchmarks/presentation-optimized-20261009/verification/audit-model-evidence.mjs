import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { COMPONENT_KINDS } from '../../../../dist/src/output/content-schema.js';

const directory = resolve(process.argv[2]);
const suite = JSON.parse(readFileSync(join(directory, 'results.json')));
const nativeNames = ['prepare_component', 'present_component', 'present_text',
  ...COMPONENT_KINDS.map(kind => `render_${kind}`), ...COMPONENT_KINDS.map(kind => `prepare_${kind}`)];
const records = [];
for (const run of suite.observations) {
  const requests = [], responseModels = [], routes = [], httpStatuses = [];
  for (const trace of run.traceDirectories) {
    const events = readFileSync(join(trace, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const event of events) {
      if (event.event === 'llm.start') routes.push({ provider: event.data.model?.provider, id: event.data.model?.id,
        api: event.data.model?.api, thinking: event.data.thinking_level });
      if (event.event === 'llm.end' && typeof event.data.response_model === 'string') responseModels.push(event.data.response_model);
      if (event.event === 'llm.http_response') httpStatuses.push(event.data.status);
    }
    for (const event of events.filter(row => row.event === 'llm.provider_request')) {
      const path = join(trace, event.data.payload_ref.path), payload = JSON.parse(readFileSync(path));
      const tools = (payload.tools ?? []).map(tool => tool.function ?? tool), prepare = tools.find(tool => tool.name === 'prepare_component');
      requests.push({ payloadRef: path, requestedModel: payload.model,
        responseFormat: payload.response_format?.type ?? payload.text?.format?.type ?? null,
        declaredNativeTools: tools.map(tool => tool.name).filter(name => nativeNames.includes(name)),
        prepareDeclared: prepare !== undefined, prepareRootType: prepare?.parameters?.type ?? null,
        prepareBranches: prepare?.parameters?.anyOf?.length ?? null,
        displaySchemas: tools.filter(tool => nativeNames.includes(tool.name)).map(tool => ({ name: tool.name,
          type: tool.parameters?.type, schemaBytes: Buffer.byteLength(JSON.stringify(tool.parameters ?? {})),
          hasComponentDiscriminator: Object.hasOwn(tool.parameters?.properties ?? {}, 'component'),
          hasFields: Object.hasOwn(tool.parameters?.properties ?? {}, 'fields'),
          hasColumns: Object.hasOwn(tool.parameters?.properties ?? {}, 'columns') })) });
    }
  }
  records.push({ caseId: run.caseId, variant: run.variant, repeat: run.repeat, outcome: run.outcome,
    requests, successfulNativeCalls: run.turns.flatMap(turn => turn.tools.filter(tool => !tool.error && nativeNames.includes(tool.name)).map(tool => tool.name)),
    canonicalStatuses: run.turns.map(turn => turn.presentationStatus ?? null),
    completeComponents: run.turns.map(turn => (turn.final?.content ?? []).filter(part => part.pending === false).map(part => part.type)),
    providerHttpRequests: run.metrics.providerHttpRequests, modelRequests: run.metrics.modelRequests,
    capturedUsageRequests: run.metrics.requests.filter(request => request.inputTokens !== null).length,
    responseModels: [...new Set(responseModels)], routes, httpStatuses,
    initialDisplaySchemas: run.metrics.userTurnInitialDisplaySchemas, activationSets: run.metrics.activatedDisplaySets,
    loadoutMismatches: run.metrics.displayLoadoutMismatches, afterCommitHttp: run.metrics.requestsAfterTerminalCommit,
    completionProofs: run.turns.map(turn => turn.completionProof), historyProofs: run.historyProofs,
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
    initialDisplayCountMax: Math.max(0, ...runs.flatMap(run => run.initialDisplaySchemas ?? []).map(row => row.names.length)),
    loadoutMismatches: runs.reduce((sum, run) => sum + (run.loadoutMismatches ?? 0), 0),
    afterCommitHttp: runs.reduce((sum, run) => sum + (run.afterCommitHttp ?? 0), 0),
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
