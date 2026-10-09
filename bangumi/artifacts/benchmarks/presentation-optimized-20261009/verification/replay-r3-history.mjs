import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getCurrentSystemMessage } from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import * as current from '../../../../dist/src/output/model-context.js';
import { PRESENTATION_MODEL_TOOL_ROLES } from '../../../../dist/src/output/presentation-contract.js';
import { inspectHistoryOccurrences } from '../../../../dist/src/benchmark/history.js';
import { traceHash, traceRedact } from '../../../../dist/src/tracing/redact.js';

process.on('uncaughtException', error => { console.error(JSON.stringify({ error: error.name,
  message: error.message.split('\n')[0], at: error.stack?.split('\n').find(line => line.includes('replay-r3-history.mjs:')),
  actual: typeof error.actual === 'object' ? '[object]' : error.actual,
  expected: typeof error.expected === 'object' ? '[object]' : error.expected })); process.exit(1); });

const verification = dirname(fileURLToPath(import.meta.url)), artifact = resolve(verification, '..');
const host = resolve(verification, '../../../../'), repo = resolve(host, '..');
const oldVersion = JSON.parse(readFileSync(join(artifact, 'candidate-fingerprint-r3-final.json')));
const newVersion = JSON.parse(readFileSync(join(artifact, 'candidate-fingerprint-r4-final.json')));
const suite = JSON.parse(readFileSync(join(artifact, 'model-paired-r3-final/results.json')));
const observation = suite.observations.find(run => run.variant === 'candidate' && run.caseId === 'followup-filter' && run.repeat === 1);
const read = (directory, ref) => JSON.parse(readFileSync(join(directory, ref.path)));
const hashFile = path => traceHash(readFileSync(path, 'utf8'));
const dependencies = [];
for (const [key, base] of [['bangumi/dist/src', join(host, 'dist/src')], ['pi/packages/ai/dist', join(repo, 'pi/packages/ai/dist')]]) {
  for (const [path, hash] of Object.entries(oldVersion.files[key])) {
    if (key === 'bangumi/dist/src' && ['output/presentation-history.js', 'output/presentation-history.d.ts',
      'output/model-context.js', 'output/model-context.d.ts'].includes(path)) continue;
    assert.equal(hashFile(join(base, path)), hash, 'Replay dependency drift: ' + key + '/' + path);
    dependencies.push(key + '/' + path);
  }
}
function oldModule(name, override) {
  const path = join(verification, 'r3-projection-control', name), source = readFileSync(path, 'utf8');
  assert.equal(traceHash(source), oldVersion.files['bangumi/dist/src']['output/' + name]);
  const js = source.replace(/(from\s*['"])([^'"]+)(['"])/g, (_all, before, specifier, after) => {
    const target = specifier === './presentation-history.js' && override ? override
      : specifier.startsWith('.') ? pathToFileURL(resolve(host, 'dist/src/output', specifier)).href : import.meta.resolve(specifier);
    return before + target + after;
  });
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
const oldHistoryUrl = oldModule('presentation-history.js');
const previous = await import(oldModule('model-context.js', oldHistoryUrl));
const agentDir = join(process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local/share'), 'MyBangumiAssistant-Pi'), 'pi');
const modelsPath = join(agentDir, 'models.json');
assert.equal(traceHash(traceRedact(JSON.parse(readFileSync(modelsPath)))), suite.manifest.protocol.modelConfigHash);
const runtime = await ModelRuntime.create({ authPath: join(verification, 'replay-unused-auth.json'), modelsPath,
  modelsStorePath: join(verification, 'replay-unused-models-store.json'), allowModelNetwork: false });
const model = runtime.getModel('deepseek', 'deepseek-flash');
assert.equal(model.api, 'openai-completions');
let httpAttempts = 0;
async function encode(context) {
  let payload;
  const events = stream(model, context, { apiKey: 'offline-replay-placeholder', reasoningEffort: 'high',
    fetch: async () => { httpAttempts++; throw new Error('REPLAY_HTTP_FORBIDDEN'); },
    onPayload: value => { payload = value; throw new Error('OFFLINE_REPLAY_CAPTURE_COMPLETE'); } });
  await events.result();
  assert.ok(payload, 'Real encoder must capture before HTTP');
  assert.equal(httpAttempts, 0);
  return payload;
}
const all = observation.traceDirectories.flatMap(directory => readFileSync(join(directory, 'events.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(line => ({ directory, event: JSON.parse(line) })))
  .sort((a, b) => a.event.ts.localeCompare(b.event.ts) || a.event.seq - b.event.seq);
const starts = all.filter(row => row.event.event === 'llm.start');
const sourceSnapshot = all.filter(row => row.event.event === 'presentation.snapshot')
  .map(row => ({ ...row, snapshot: read(row.directory, row.event.data.record_ref) }))
  .findLast(row => row.snapshot.replyId === observation.historyProofs[3].texts[0].replyId && row.snapshot.status === 'completed').snapshot;
const snapshotHash = traceHash(sourceSnapshot), sources = sourceSnapshot.content.flatMap((part, partIndex) =>
  part.type === 'text' ? [{ userTurn: 1, replyId: sourceSnapshot.replyId, partIndex, text: part.text }] : []);
function summaries(context) {
  return context.messages.filter(message => message.role === 'assistant').flatMap(message => message.content)
    .filter(part => part.type === 'text' && part.text.startsWith('历史已展示回答摘要'))
    .flatMap(part => JSON.parse(part.text.slice(part.text.indexOf('：') + 1)));
}
const rows = [];
function normalizeWire(messages) {
  return messages.map(message => {
    const value = structuredClone(message);
    if (value.tool_calls) for (const call of value.tool_calls) call.function.arguments = JSON.parse(call.function.arguments);
    if (value.role === 'tool' && typeof value.content === 'string') {
      try { value.content = JSON.parse(value.content); } catch { /* authored non-JSON text stays exact */ }
    }
    if (value.role === 'assistant' && typeof value.content === 'string') {
      const prefix = '历史已展示回答摘要', offset = value.content.indexOf(prefix);
      if (offset >= 0) {
        const colon = value.content.indexOf('：', offset);
        value.content = { prefix: value.content.slice(0, colon + 1), content: JSON.parse(value.content.slice(colon + 1)) };
      }
    }
    return value;
  });
}
for (const requestIndex of [4, 5]) {
  const start = starts[requestIndex - 1], manifest = read(start.directory, start.event.data.effective_prompt_ref);
  const originalMessages = manifest.messages.map(ref => read(start.directory, ref));
  const provider = all.find(row => row.directory === start.directory && row.event.event === 'llm.provider_request'
    && row.event.span_id === start.event.span_id);
  const actual = read(provider.directory, provider.event.data.payload_ref);
  const capturedAudit = observation.historyProofs[requestIndex - 1].projectionAudits
    .find(row => row.replyId === sourceSnapshot.replyId);
  assert.ok(capturedAudit.sourceComplete && capturedAudit.retainedSignedCallCount === 0 && capturedAudit.foldedCallCount === 1);
  let rebuiltCodecLabels = 0;
  for (const message of originalMessages.filter(message => message.role === 'assistant')) {
    const thoughts = message.content.filter(part => part.type === 'thinking');
    if (!thoughts.length) continue;
    const thinking = thoughts.map(part => part.thinking).join('\n');
    assert.ok(actual.messages.some(row => row.role === 'assistant' && row.reasoning_content === thinking),
      'Only positively observed plain reasoning codec text can reconstruct a redacted codec label');
    for (const part of thoughts) {
      assert.equal(part.thinkingSignature, '[REDACTED]'); assert.ok(!part.redacted);
      part.thinkingSignature = 'reasoning_content'; rebuiltCodecLabels++;
    }
    assert.ok(message.content.filter(part => part.type === 'toolCall').every(call => !call.thoughtSignature),
      'Opaque/thought signatures may never be reconstructed');
  }
  const latest = new Map();
  for (const row of all.filter(row => row.event.event === 'presentation.snapshot' && row.event.ts <= start.event.ts)) {
    const snapshot = read(row.directory, row.event.data.record_ref); latest.set(snapshot.replyId, snapshot);
  }
  const snapshots = [...latest.values()], sourceMessages = originalMessages.filter(message => message.role === 'assistant'
    && message.diagnostics?.some(item => item.type === 'bangumi_presentation_source'));
  const currentRefs = new Set(), latestUser = originalMessages.findLastIndex(message => message.role === 'user');
  const collectRefs = value => {
    if (Array.isArray(value)) { value.forEach(collectRefs); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'resourceRef' && typeof item === 'string') currentRefs.add(item); else collectRefs(item);
    }
  };
  for (const message of originalMessages.slice(latestUser + 1).filter(message => message.role === 'toolResult' && !message.isError))
    for (const part of message.content) if (part.type === 'text') {
      try { collectRefs(JSON.parse(part.text)); } catch { /* non-resource tool text */ }
    }
  const resolver = Object.assign(async () => { throw new Error('REPLAY_RESOURCE_FETCH_FORBIDDEN'); },
    { isCurrent: ref => currentRefs.has(ref) });
  const branchHash = traceHash(originalMessages), snapshotsHash = traceHash(snapshots);
  function project(module) {
    // Trace hook precedes Pi's forced-system projection; replay its recorded request-bound text
    // while deriving current declarations from the complete original native transcript.
    const currentSystem = getCurrentSystemMessage(originalMessages);
    const head = { role: 'system', content: actual.messages[0].content,
      toolsAdded: structuredClone(currentSystem.toolsAdded), timestamp: currentSystem.timestamp };
    const context = { messages: [head, ...structuredClone(originalMessages.filter(message => message.role !== 'system'))] };
    module.bindPresentationHistory(context, snapshots, { sourceMessages, sourceTranscript: originalMessages,
      model, toolRoles: PRESENTATION_MODEL_TOOL_ROLES });
    return { context: module.projectTranscriptForModel(context, resolver), audits: module.inspectPresentationHistory(context, resolver) };
  }
  const before = project(previous), after = project(current), oldPayload = await encode(before.context), newPayload = await encode(after.context);
  if (!isDeepStrictEqual(normalizeWire(oldPayload.messages), normalizeWire(actual.messages))) console.error(JSON.stringify({ calibrationDifference:
    oldPayload.messages.map((message, index) => ({ index, role: message.role, expectedRole: actual.messages[index]?.role,
      fields: [...new Set([...Object.keys(message), ...Object.keys(actual.messages[index] ?? {})])]
        .filter(key => !isDeepStrictEqual(message[key], actual.messages[index]?.[key])).map(key => ({ key,
          actualType: typeof message[key], expectedType: typeof actual.messages[index]?.[key],
          actualBytes: Buffer.byteLength(JSON.stringify(message[key]) ?? ''),
          expectedBytes: Buffer.byteLength(JSON.stringify(actual.messages[index]?.[key]) ?? '') })) })).filter(row => row.fields.length),
    actualMessages: oldPayload.messages.length, expectedMessages: actual.messages.length }));
  assert.deepEqual(normalizeWire(oldPayload.messages), normalizeWire(actual.messages),
    'Old projection must calibrate authors, call/result IDs, errors, facts, status and array order; JSON object order is non-author metadata');
  const oldCounts = inspectHistoryOccurrences(oldPayload, sources, new Map([[sourceSnapshot.replyId, false]]));
  const newCounts = inspectHistoryOccurrences(newPayload, sources, new Map([[sourceSnapshot.replyId, false]]));
  assert.ok(oldCounts.every(count => count.nativeOccurrences + count.displayArgumentOccurrences === 2));
  assert.ok(newCounts.every(count => count.nativeOccurrences + count.displayArgumentOccurrences === 1));
  const failure = originalMessages.find(message => message.role === 'toolResult' && message.toolName === 'render_SubjectCards' && message.isError);
  const failedCall = originalMessages.filter(message => message.role === 'assistant').flatMap(message => message.content)
    .find(part => part.type === 'toolCall' && part.id === failure.toolCallId);
  const wirePair = payload => ({ call: payload.messages.filter(message => message.role === 'assistant')
    .flatMap(message => message.tool_calls ?? []).find(call => call.id === failedCall.id),
    result: payload.messages.find(message => message.role === 'tool' && message.tool_call_id === failure.toolCallId) });
  const beforePair = wirePair(oldPayload), afterPair = wirePair(newPayload);
  assert.ok(beforePair.call && beforePair.result); assert.deepEqual(beforePair, afterPair);
  assert.deepEqual(summaries(before.context).filter(part => !['text', 'text_ref'].includes(part.type)),
    summaries(after.context).filter(part => !['text', 'text_ref'].includes(part.type)), 'Canonical component facts must stay identical');
  assert.equal(traceHash(originalMessages), branchHash); assert.equal(traceHash(snapshots), snapshotsHash);
  const sourceAudit = after.audits.find(row => row.replyId === sourceSnapshot.replyId);
  assert.equal(sourceAudit.sourceComplete, true); assert.equal(sourceAudit.foldedCallCount, 1);
  assert.equal(sourceAudit.textSourceRefs.length, 2);
  assert.ok(sourceAudit.textSourceRefs.every(ref => ref.operationOutcome === 'error'));
  const textRefParts = summaries(after.context).filter(part => part.type === 'text' && part.source);
  assert.equal(textRefParts.length, 2); assert.ok(JSON.stringify(textRefParts).includes('"operationOutcome":"error"'));
  rows.push({ originalRequestIndex: requestIndex, originalContextRef: join(start.directory, start.event.data.effective_prompt_ref.path),
    originalWireRef: join(provider.directory, provider.event.data.payload_ref.path), oldProjectionSemanticallyMatchesActualWire: true,
    rebuiltPlainCodecLabels: rebuiltCodecLabels, capturedAudit,
    branchHash, originalNativeMessages: originalMessages.length, sourceAssistantMessages: sourceMessages.length,
    forcedSystemSource: 'Recorded actual wire head; Pi forced prompt projection occurs after context_with_system trace hook',
    currentReferenceScopeSource: 'Successful original tool results after current real-user boundary', currentReferenceCount: currentRefs.size,
    canonicalStatus: sourceSnapshot.status, canonicalSnapshotHash: snapshotHash, canonicalFactsUnchanged: true,
    failedCallId: failedCall.id, failedResultCallId: failure.toolCallId, failedArgumentsUnchanged: true, failedErrorUnchanged: true,
    failedPairHash: traceHash(beforePair), operationOutcome: 'error', sourceAudit, before: oldCounts, after: newCounts });
}
assert.equal(traceHash(sourceSnapshot), snapshotHash); assert.equal(httpAttempts, 0);
const result = { evidence: 'Artifact-only offline replay of exact r3 native trace branch/context and canonical sources through r4 real projection + same API encoder. No new model invocation, no HTTP, no rewrite of r3 payload/results/grade/cost.',
  reconstructionLimits: 'Trace masks signature fields and sorts object keys. Only plain reasoning_content codec labels reconstructed when actual wire thinking text exactly matches and captured original history audit proves sourceComplete/retainedSignedCallCount0/folded1. No opaque/encrypted/thought signature or thinking content reconstructed. JSON object ordering normalized; author strings, IDs, pairs, errors, facts, status and array order stay exact. Not original branch byte recovery.',
  oldVersion: oldVersion.hash, newVersion: newVersion.hash, modelConfigHash: suite.manifest.protocol.modelConfigHash,
  dependenciesHashVerified: dependencies.length, provider: model.provider, model: model.id, api: model.api,
  httpAttempts, originalFourDuplicateObservations: 4, replaySingleCopyObservations: rows.flatMap(row => row.after).length, rows };
writeFileSync(join(artifact, 'r4-projection-replay.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ saved: join(artifact, 'r4-projection-replay.json'), dependencies: dependencies.length,
  calibratedSemantic: rows.every(row => row.oldProjectionSemanticallyMatchesActualWire), singleCopy: result.replaySingleCopyObservations,
  failedPairPreserved: true, canonicalFactsUnchanged: true, operationOutcome: 'error', httpAttempts }));
