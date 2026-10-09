import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { normalizeContext } from '@earendil-works/pi-ai';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { convertResponsesTools } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { runToolCall } from '@earendil-works/pi-agent-core';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { createPresentationTools } from '../dist/src/output/presentation-tools.js';
import { PREPARE_COMPONENT_SCHEMA } from '../dist/src/output/presentation-contract.js';
import { COMPONENT_KINDS } from '../dist/src/output/content-schema.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';
import { toolConstraintState } from '../dist/src/support/provider-tool-arguments.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { ComponentCatalogState } from '../dist/src/output/component-catalog.js';
import { PresentationStore } from '../dist/src/output/presentation-store.js';
import { ReplyAssembler, bindReplyAssembler } from '../dist/src/output/reply-assembler.js';

test('prepare根对象保留12个严格分支及完整本地校验，复杂union明确fallback', () => {
  assert.equal(PREPARE_COMPONENT_SCHEMA.type, 'object');
  assert.equal(PREPARE_COMPONENT_SCHEMA.anyOf.length, 12);
  assert.deepEqual(PREPARE_COMPONENT_SCHEMA.anyOf.map(branch => branch.properties.component.enum[0]), COMPONENT_KINDS);
  for (const branch of PREPARE_COMPONENT_SCHEMA.anyOf) {
    assert.equal(branch.type, 'object'); assert.equal(branch.additionalProperties, false); assert.ok(branch.required.includes('component'));
  }
  assert.deepEqual(schemaArguments(PREPARE_COMPONENT_SCHEMA, { component: 'QuoteBlock', text: '引用', mono: false }), { component: 'QuoteBlock', text: '引用', mono: false });
  for (const invalid of [
    { component: 'Unknown', resourceRef: 'rr_facts' },
    { component: 'SubjectCards', resourceRef: 'rr_facts', subjectIds: [1], tone: 'success' },
    { component: 'Callout', resourceRef: 'rr_facts', tone: 'success', text: '错误混入引用' },
    { component: 'InfoBox', resourceRef: 'rr_facts', subjectIds: [1, 2] },
    { component: 'QuoteBlock', text: '缺少mono' },
  ]) assert.throws(() => schemaArguments(PREPARE_COMPONENT_SCHEMA, invalid));
  const constraint = toolConstraintState(PREPARE_COMPONENT_SCHEMA, { api: 'openai-completions', compat: { supportsStrictMode: true } });
  assert.equal(constraint.schema, 'fallback'); assert.match(constraint.reason, /object and array unions are unsupported/);
});

test('实际HTTP提供方载荷要求根type=object：旧形状400，新形状保留union并可执行原生prepare', async t => {
  const requests = [], args = { component: 'Callout', tone: 'success', text: '原生准备成功' };
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body); requests.push(payload);
    const parameters = payload.tools.find(tool => tool.function?.name === 'prepare_component').function.parameters;
    if (parameters.type !== 'object') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'schema must type object got type null', type: 'invalid_request_error' } })); return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => ({ id: 'request-schema', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason }] });
    response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'prepare-http', type: 'function', function: { name: 'prepare_component', arguments: JSON.stringify(args) } }] }))}\n\n`);
    response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`); response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const model = { id: 'deepseek-flash', name: 'deepseek-flash', api: 'openai-completions', provider: 'deepseek', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStrictMode: false } };
  const assembler = new ReplyAssembler(() => {}); assembler.begin('http-schema');
  const store = new PresentationStore(async () => { throw Error('文字组件不访问缓存或业务上游'); }); store.begin();
  const catalog = new ComponentCatalogState(); catalog.readIndex({ limit: 12 }); catalog.readPrepareSpecs(['Callout']);
  const tools = createPresentationTools(store, assembler, catalog), prepare = tools.find(tool => tool.name === 'prepare_component');
  const provider = withProviderFetch({ id: 'deepseek', stream, streamSimple });
  const contextFor = tool => { const context = normalizeContext({ systemPrompt: CONTENT_OUTPUT_INSTRUCTION, tools: [tool], messages: [{ role: 'user', content: '准备业务提示', timestamp: 1 }] }); bindReplyAssembler(context, assembler); return context; };
  const legacyShape = structuredClone(prepare.parameters); delete legacyShape.type;
  const failed = await provider.streamSimple(model, contextFor({ ...prepare, parameters: legacyShape }), { apiKey: 'offline-placeholder', maxRetries: 0 }).result();
  assert.equal(failed.stopReason, 'error'); assert.match(failed.errorMessage, /schema must type object/);
  const context = contextFor(prepare), message = await provider.streamSimple(model, context, { apiKey: 'offline-placeholder', maxRetries: 0 }).result();
  assert.equal(message.stopReason, 'toolUse', message.errorMessage); assert.equal(requests.length, 2);
  const wireTool = requests[1].tools.find(tool => tool.function.name === 'prepare_component').function;
  assert.deepEqual(wireTool.parameters, PREPARE_COMPONENT_SCHEMA); assert.equal(wireTool.strict, undefined);
  assert.equal(requests[1].response_format, undefined);
  const call = message.content.find(part => part.type === 'toolCall');
  const outcome = await runToolCall(call, { tools, assistantMessage: message, context: { messages: context.messages, tools } });
  assert.equal(outcome.isError, false, JSON.stringify(outcome.result)); assert.equal(outcome.result.details.blocks[0].type, 'Callout');
  // Responses非strict转换同样原样保留顶层对象和全部闭合分支，没有凭空补properties。
  const responsesTool = convertResponsesTools([prepare], { supportsStrictMode: false })[0];
  assert.deepEqual(responsesTool.parameters, PREPARE_COMPONENT_SCHEMA);
});
