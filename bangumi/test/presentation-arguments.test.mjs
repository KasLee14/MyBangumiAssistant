import assert from 'node:assert/strict';
import test from 'node:test';
import { setToolCallArgumentSource } from '@earendil-works/pi-ai';
import { parsePresentationArguments, preparePresentationArguments } from '../dist/src/output/presentation-arguments.js';

const parse = raw => parsePresentationArguments('prepare_component', raw, 'toolUse');
test('EOF closure preserves every scalar, string, member identity, and order', () => {
  const raw = '{"kind":"SubjectCards","props":{"ids":[101,203,405],"items":[{"id":101,"name":"a,]}\\\""},{"id":203,"name":"二"}],"ok":true,"count":-1.25e+2';
  const result = parse(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, JSON.parse(raw + '}}'));
  assert.deepEqual(result.value.props.ids, [101,203,405]);
  assert.deepEqual(result.value.props.items.map(item => item.id), [101,203]);
  assert.deepEqual(result.repairs.map(row => row.rule), ['close_eof_container','close_eof_container']);
  assert.ok(result.repairs.every(row => row.offset === raw.length));
});
test('only commas immediately before explicit closing symbols are removed', () => {
  const result = parse('{"props":{"ids":[1,2,],"text":"inside,]} string",},}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { props: { ids: [1,2], text: 'inside,]} string' } });
  assert.equal(result.repairs.filter(row => row.rule === 'remove_trailing_comma').length, 3);
});
test('strict valid JSON still rejects duplicate decoded keys at any depth', () => {
  for (const raw of ['{"text":"first","text":"second"}', '{"props":{"id":1,"\\u0069d":2}}']) {
    const result = parse(raw);
    assert.equal(result.ok, false); assert.equal(result.issue.reason, 'duplicate_key');
  }
});
test('truncated arrays do not silently drop an unfinished member', () => {
  for (const raw of ['{"props":{"ids":[1,2,', '{"props":{"items":[{"id":1},{"id":', '{"props":{"ids":[1,2,]']) {
    const result = parse(raw);
    if (raw.endsWith(']')) { assert.equal(result.ok, true); assert.deepEqual(result.value.props.ids, [1,2]); }
    else assert.equal(result.ok, false);
  }
});
test('ambiguous syntax, incomplete strings, numbers, literals, escapes and roots are refused', () => {
  for (const raw of ['{"text":"unfinished', '{"text":"bad\\q"}', '{"text":"bad\\u123"}', '{"n":1.', '{"n":1e+', '{"n":tru',
    '{"n":01}', '{"n":1 "m":2}', '{}{}', '{"a":[1}', '{', '[', '{"a":', '[1,,2]', '{"x":trueX}']) {
    assert.equal(parse(raw).ok, false, raw);
  }
});
test('length, abort, error, missing finish and interrupted calls cannot be accepted or repaired', () => {
  for (const termination of ['length','aborted','interrupted','pending','error','deferred']) {
    for (const raw of ['{"text":"ok"}', '{"text":"ok"']) {
      const result = parsePresentationArguments('present_text', raw, termination);
      assert.equal(result.ok, false); assert.equal(result.issue.reason, 'incomplete_termination');
    }
  }
});
test('scanner rejects unsupported tools and oversized raw arguments', () => {
  assert.equal(parsePresentationArguments('execute_write_batch', '{}', 'toolUse').ok, false);
  assert.equal(parse(' '.repeat(131073)).issue.reason, 'argument_size_limit');
});
test('diagnostics never echo unknown raw keys or values', () => {
  const result = parse('{"secret-field-password":{"a":"raw-secret","a":2}}');
  assert.equal(result.ok, false);
  assert.equal(result.issue.path, '/<field>');
  assert.ok(!JSON.stringify(result).includes('password'));
  assert.ok(!JSON.stringify(result).includes('raw-secret'));
});

const schema = { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] };
function context(raw, stopReason = 'toolUse', state = 'complete') {
  const toolCall = { type: 'toolCall', id: 'one', name: 'present_text', arguments: { text: 'preview is not authoritative' } };
  if (raw !== undefined) setToolCallArgumentSource(toolCall, { raw, state, source: 'output_item_done' });
  return { toolCall, assistantMessage: { stopReason } };
}
test('preparation reads original raw, audits repair positions, and enforces schema without coercion', () => {
  const audits = [], ctx = context('{"text":"final"');
  assert.deepEqual(preparePresentationArguments('present_text', schema, ctx.toolCall.arguments, ctx, { onAudit: audit => audits.push(audit) }), { text: 'final' });
  assert.equal(audits[0].status, 'repaired');
  assert.equal(audits[0].repairs[0].offset, '{"text":"final"'.length);
  assert.ok(!JSON.stringify(audits).includes('final'));
  assert.throws(() => preparePresentationArguments('present_text', schema, {}, context('{"text":1}')), { code: 'INVALID_INPUT' });
  assert.throws(() => preparePresentationArguments('present_text', schema, {}, context('{}')), { code: 'INVALID_INPUT' });
});
test('schema rejection audits fixed field and rule after repaired syntax without exposing values', () => {
  const audits = [];
  assert.throws(() => preparePresentationArguments('present_text', schema, {}, context('{"text":1'), { onAudit: audit => audits.push(audit) }), { code: 'INVALID_INPUT' });
  assert.deepEqual(audits.map(row => [row.stage,row.status]), [['syntax','repaired'],['schema','rejected']]);
  assert.deepEqual(audits[1].issue, { path: '/text', reason: 'type' });
  assert.deepEqual(audits[0].repairs, audits[1].repairs);
});
test('preparation refuses preview-only calls, interruption, and already cancelled signals', () => {
  for (const ctx of [context(undefined), context('{"text":"x"}', 'length'), context('{"text":"x"}', 'toolUse', 'interrupted')]) {
    assert.throws(() => preparePresentationArguments('present_text', schema, ctx.toolCall.arguments, ctx), { code: 'INVALID_INPUT' });
  }
  const controller = new AbortController(); controller.abort();
  assert.throws(() => preparePresentationArguments('present_text', schema, {}, { ...context('{"text":"x"}'), signal: controller.signal }), { code: 'INVALID_INPUT' });
});
test('selected schema diagnostics remain focused while the full union still gates the value', () => {
  const active = { ...schema, properties: { ...schema.properties, kind: { const: 'text' } }, required: ['text','kind'] };
  const full = { oneOf: [active, { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false }] };
  const options = { schemaForValue: () => active };
  assert.throws(() => preparePresentationArguments('present_text', full, {}, context('{"kind":"text"}'), options), error => error.issues.length === 1 && error.issues[0].path === '/text');
  assert.deepEqual(preparePresentationArguments('present_text', full, {}, context('{"kind":"text","text":"hi"}'), options), { kind: 'text', text: 'hi' });
  assert.throws(() => preparePresentationArguments('present_text', { ...full, not: {} }, {}, context('{"kind":"text","text":"hi"}'), options), { code: 'INVALID_INPUT' });
});
