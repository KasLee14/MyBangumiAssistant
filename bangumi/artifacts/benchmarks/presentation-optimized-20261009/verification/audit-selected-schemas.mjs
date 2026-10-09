import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPONENT_KINDS } from '../../../../dist/src/output/content-schema.js';

const directory = resolve(process.argv[2]);
const suite = JSON.parse(readFileSync(join(directory, 'results.json')));
const displayNames = new Set(['prepare_component', 'present_component', 'present_text',
  ...COMPONENT_KINDS.map(kind => 'render_' + kind), ...COMPONENT_KINDS.map(kind => 'prepare_' + kind)]);
const rows = [], activations = [];
for (const run of suite.observations.filter(run => run.variant === 'candidate')) {
  for (const trace of run.traceDirectories) {
    const events = readFileSync(join(trace, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.filter(event => event.event === 'input.delivered').length, 1, 'Selection scope must be one true user run');
    const selected = new Set();
    for (const event of events) {
      if (event.event === 'tool.result' && event.data.tool_name === 'read_component_spec' && !event.data.is_error) {
        const result = JSON.parse(readFileSync(join(trace, event.data.result_ref.path)));
        let ack = result.details;
        if (!ack?.tools && Array.isArray(result.content)) ack = JSON.parse(result.content.find(part => part.type === 'text').text);
        assert.equal(ack.status, 'activated'); assert.ok(ack.tools.every(name => displayNames.has(name)));
        const before = [...selected]; ack.tools.forEach(name => selected.add(name));
        activations.push({ caseId: run.caseId, repeat: run.repeat, trace, sequence: event.seq,
          acknowledgmentRef: join(trace, event.data.result_ref.path), priorSelected: before, delta: ack.tools, cumulativeSelected: [...selected] });
      }
      if (event.event === 'llm.provider_request') {
        const payloadRef = join(trace, event.data.payload_ref.path), payload = JSON.parse(readFileSync(payloadRef));
        const declared = payload.tools.map(tool => tool.function ?? tool).map(tool => tool.name).filter(name => displayNames.has(name));
        rows.push({ caseId: run.caseId, repeat: run.repeat, trace, sequence: event.seq, payloadRef,
          selected: [...selected], declared, unselected: declared.filter(name => !selected.has(name)),
          missing: [...selected].filter(name => !declared.includes(name)) });
      }
    }
  }
}
const mismatchLocations = suite.observations.filter(run => run.variant === 'candidate' && run.metrics.displayLoadoutMismatches > 0)
  .map(run => ({ caseId: run.caseId, repeat: run.repeat, rawCount: run.metrics.displayLoadoutMismatches,
    additiveActivations: activations.filter(row => row.caseId === run.caseId && row.repeat === run.repeat && row.priorSelected.length > 0) }));
const proof = { definition: 'Successful spec ack is an activation delta; within one true user turn declarations accumulate selected names and reset for the next user. Raw harness replaces its expected set with latest delta, causing one false mismatch. No gate exception or rewrite of observations/grade/hash.',
  rawMetricMismatches: suite.observations.filter(run => run.variant === 'candidate').reduce((sum, run) => sum + run.metrics.displayLoadoutMismatches, 0),
  actualCumulativeSelectionMismatches: rows.filter(row => row.unselected.length || row.missing.length).length,
  mismatchLocations, activations, rows };
writeFileSync(join(directory, 'selected-schema-activation-audits.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ requests: rows.length, raw: proof.rawMetricMismatches, audited: proof.actualCumulativeSelectionMismatches,
  mismatchLocations: mismatchLocations.map(row => ({ caseId: row.caseId, repeat: row.repeat, rawCount: row.rawCount,
    cumulativeChanges: row.additiveActivations.map(value => ({ before: value.priorSelected, delta: value.delta, after: value.cumulativeSelected })) })) }));
