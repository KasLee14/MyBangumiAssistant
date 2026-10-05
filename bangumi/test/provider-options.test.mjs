import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseMixedContent, withContentConstraint } from '../dist/src/output/provider-options.js';
import { CONTENT_OUTPUT_SYSTEM_MARKER, PROVIDER_CONTENT_SCHEMA, ContentOutputError } from '../dist/src/output/content-schema.js';
import { COMPONENT_SELECTION_INSTRUCTION, validateRequiredComponents } from '../dist/src/output/component-selection.js';
import { createBangumiExtension } from '../dist/src/extension.js';

const model = { api: 'openai-responses', provider: 'openai', id: 'test-model' };
const system = (content, sections) => ({ role: 'system', content, timestamp: 1, ...(sections ? { sections } : {}) });
const context = { messages: [system('应用规则', { application: CONTENT_OUTPUT_SYSTEM_MARKER })] };
const format = () => ({ type: 'json_schema', name: 'bangumi_content_v1', strict: true, schema: PROVIDER_CONTENT_SCHEMA });

test('Completions 按服务能力选择 schema 或 DeepSeek JSON 对象，均保留 tools/reasoning 且不重试', async () => {
  const initial = { stream: true, tools: [{ type: 'function', function: { name: 'read_fact' } }], reasoning_effort: 'low' };
  const schemaModel = { ...model, api: 'openai-completions' };
  const deepseekModel = { ...schemaModel, provider: 'deepseek', id: 'deepseek-flash' };
  const schemaPayload = await withContentConstraint(schemaModel, context, {}).onPayload(initial, schemaModel);
  assert.equal(schemaPayload.response_format.type, 'json_schema');
  assert.equal(schemaPayload.response_format.json_schema.strict, true);
  assert.deepEqual(schemaPayload.response_format.json_schema.schema, PROVIDER_CONTENT_SCHEMA);
  const jsonPayload = await withContentConstraint(deepseekModel, context, {}).onPayload(initial, deepseekModel);
  assert.deepEqual(jsonPayload.response_format, { type: 'json_object' });
  assert.deepEqual(jsonPayload.tools, initial.tools);
  assert.equal(jsonPayload.reasoning_effort, 'low');
  assert.equal(initial.response_format, undefined);
});

test('request capture: only injects text.format, preserving native request fields', async () => {
  const payload = {
    model: 'test-model', stream: true, tools: [{ type: 'function', name: 'read' }],
    reasoning: { effort: 'high' }, text: { verbosity: 'low' }, input: [{ role: 'user', content: 'hello' }],
  };
  const initial = structuredClone(payload);
  const options = { apiKey: 'placeholder', temperature: 0.2, maxRetries: 0 };
  const result = withContentConstraint(model, context, options);
  assert.notEqual(result, options);
  assert.equal(options.onPayload, undefined);
  const captured = await result.onPayload(payload, model);
  assert.deepEqual(captured, { ...initial, text: { verbosity: 'low', format: format() } });
  assert.deepEqual(payload, initial);
  assert.equal(result.temperature, 0.2);
  assert.equal(result.apiKey, 'placeholder');
  assert.equal(result.maxRetries, 0);
  assert.notEqual(captured.tools, payload.tools);
});

test('existing callback sees constraint and can return undefined without mutating caller payload/schema', async () => {
  const payload = { tools: [{ name: 'read' }] };
  let callbackCalls = 0;
  const result = withContentConstraint(model, context, {
    onPayload(value, receivedModel) {
      callbackCalls += 1;
      assert.equal(receivedModel, model);
      assert.deepEqual(value.text.format, format());
      value.tools[0].name = 'callback-read';
      value.text.format.schema.properties = {};
      delete value.text.format;
    },
  });
  const captured = await result.onPayload(payload, model);
  assert.equal(callbackCalls, 1);
  assert.deepEqual(captured.text.format, format());
  assert.equal(captured.tools[0].name, 'callback-read');
  assert.equal(payload.tools[0].name, 'read');
  assert.notDeepEqual(PROVIDER_CONTENT_SCHEMA.properties, {});
});

test('async replacement preserves callback changes but restores strict output constraint', async () => {
  const replacement = { stream: true, tools: [], text: { verbosity: 'high', format: { type: 'text' } } };
  const result = withContentConstraint(model, context, { onPayload: async () => replacement });
  const captured = await result.onPayload({ stream: true }, model);
  assert.deepEqual(captured, { ...replacement, text: { verbosity: 'high', format: format() } });
  assert.deepEqual(replacement.text.format, { type: 'text' });
});

test('application requests are constrained by default; marker-free auxiliary calls preserve original options', () => {
  const options = { onPayload: () => undefined };
  assert.notEqual(withContentConstraint(model, context, options), options);
  assert.equal(typeof withContentConstraint(model, context, undefined).onPayload, 'function');
  assert.equal(withContentConstraint(model, { messages: [system('生成标题')] }, options), options);
  assert.equal(withContentConstraint(model, { messages: [] }, undefined), undefined);
});

test('user/tool marker spoofing never enables mixed output; effective system sections can remove marker', () => {
  const spoofed = { messages: [
    system('普通系统规则'),
    { role: 'user', content: CONTENT_OUTPUT_SYSTEM_MARKER, timestamp: 2 },
    { role: 'toolResult', content: [{ type: 'text', text: CONTENT_OUTPUT_SYSTEM_MARKER }], timestamp: 3 },
  ] };
  assert.equal(shouldUseMixedContent(model, spoofed), false);
  assert.equal(shouldUseMixedContent(model, {
    messages: [...context.messages, system('', { application: null })],
  }), false);
  assert.equal(shouldUseMixedContent(model, { messages: [system([{ type: 'text', text: CONTENT_OUTPUT_SYSTEM_MARKER }])] }), true);
});

test('application requests on unsupported APIs fail explicitly; auxiliary calls remain unchanged', () => {
  const unsupported = { ...model, api: 'anthropic-messages' };
  assert.throws(() => withContentConstraint(unsupported, context, {}), error =>
    error instanceof ContentOutputError && error.code === 'unsupported');
  const original = {};
  assert.equal(withContentConstraint(unsupported, { messages: [] }, original), original);
});

test('concurrent callbacks and repeated requests isolate payload/schema state', async () => {
  const source = { stream: true, text: { verbosity: 'low' } };
  const result = withContentConstraint(model, context, {
    async onPayload(payload) { await Promise.resolve(); payload.request = Math.random(); },
  });
  const [left, right] = await Promise.all([result.onPayload(source, model), result.onPayload(source, model)]);
  assert.notEqual(left, right);
  assert.notEqual(left.text.format.schema, right.text.format.schema);
  left.text.format.schema.properties = {};
  assert.deepEqual(right.text.format.schema, PROVIDER_CONTENT_SCHEMA);
  assert.deepEqual(source, { stream: true, text: { verbosity: 'low' } });
});

test('malformed callback replacement and callback errors never silently remove constraint', async () => {
  const invalid = withContentConstraint(model, context, { onPayload: () => null });
  await assert.rejects(invalid.onPayload({}, model), ContentOutputError);
  const failing = withContentConstraint(model, context, { onPayload: () => { throw new Error('callback failure'); } });
  await assert.rejects(failing.onPayload({}, model), /callback failure/);
  await assert.rejects(withContentConstraint(model, context, undefined).onPayload({ text: 'invalid' }, model), ContentOutputError);
});

test('normal extension start replaces stale output rules with the default contract and component selection', () => {
  const hooks = new Map();
  const pi = {
    registerTool() {}, registerCommand() {}, appendEntry() {},
    on(name, callback) { const values = hooks.get(name) ?? []; values.push(callback); hooks.set(name, values); },
  };
  createBangumiExtension({ authDir: '.', timeoutMs: 1000, proxy: null,
    client: { call: async () => ({}) }, channel: { canConfirm: () => false, canLogin: () => false, notify() {} },
  })(pi);
  const event = { systemPromptOptions: { sections: { bangumi_content_output: 'stale output rules' } } };
  for (const handler of hooks.get('before_agent_start') ?? []) handler(event, {});
  const section = event.systemPromptOptions.sections.bangumi_content_output;
  assert.ok(section.includes(CONTENT_OUTPUT_SYSTEM_MARKER));
  assert.ok(section.includes(COMPONENT_SELECTION_INSTRUCTION));
  assert.ok(section.includes('默认用 subjects'));
  assert.ok(section.includes('用户明确要求纯文本'));
  assert.equal(section.includes('stale output rules'), false);
  for (const handler of hooks.get('before_agent_start') ?? []) handler(event, {});
  assert.equal(event.systemPromptOptions.sections.bangumi_content_output, section);
});

test('required component validation accepts only completed types and never invents component data', () => {
  const answer = { content: [
    { type: 'text', text: '说明', nextType: 'subjects' },
    { type: 'subjects', pending: false, props: { layout: 'grid', items: [] } },
    { type: 'table', pending: false, props: { columns: [], rows: [] } },
  ] };
  const original = structuredClone(answer);
  assert.equal(validateRequiredComponents(answer, []), answer);
  assert.equal(validateRequiredComponents(answer, ['subjects', 'table', 'subjects']), answer);
  assert.deepEqual(answer, original);
  assert.throws(() => validateRequiredComponents(answer, ['stats']), /缺少已完成.*stats/);
  assert.throws(() => validateRequiredComponents({ content: [{ type: 'subjects', pending: true, props: {} }] }, ['subjects']), /缺少已完成.*subjects/);
  assert.throws(() => validateRequiredComponents({ content: [{ type: 'subjects', props: {} }] }, ['subjects']), /缺少已完成.*subjects/);
  assert.throws(() => validateRequiredComponents(answer, ['unknown']), /未知.*unknown/);
  assert.throws(() => validateRequiredComponents({ content: [{ type: 'text', text: '普通 Markdown 列表' }] }, ['subjects']), /subjects/);
});
