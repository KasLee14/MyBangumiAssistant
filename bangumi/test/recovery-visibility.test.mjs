import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrentSystemMessage } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { outputCheckpoint } from '../dist/src/output/recovery-checkpoint.js';
import { ComponentCatalogState, bindComponentCatalog } from '../dist/src/output/component-catalog.js';
import { createComponentReadTools } from '../dist/src/output/component-tools.js';
import { fixture, eventually } from './web-fixture.mjs';

const card = id => ({ type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id, name: `作品${id}`, kind: 'anime' }] } });
const visual = message => message.content.filter(part => !['thinking', 'toolCall'].includes(part.type));

test('正文交付只包含闭合且验证通过的前缀，错误草稿不泄露', async () => {
  const decoder = new ContentDecoder();
  decoder.feed('{"content":[{"type":"text","text":"不得提前显示');
  assert.deepEqual(decoder.completedParts(), []);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'visibility-buffer', tokenSize: { min: 1, max: 2 } });
  const prefix = { type: 'text', nextType: 'Callout', text: '已验证正文' };
  faux.setResponses([fauxAssistantMessage('{"content":[' + JSON.stringify(prefix) + ',{"type":"Callout","props":{"tone":"错误枚举","text":"错误组件"}}]}')]);
  const events = [];
  for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), { messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }] }, {})) events.push(structuredClone(event));
  assert.equal(events.at(-1).type, 'error');
  for (const event of events) {
    const content = visual(event.partial ?? event.error ?? event.message);
    assert.ok(content.every(part => part.type === 'text' && part.text === prefix.text));
  }
  assert.equal(outputCheckpoint(events.at(-1).error).prefix[0].text, prefix.text);
});

test('空白响应独立识别为empty_output，不能作为JSON断点续写', () => {
  const decoder = new ContentDecoder(); decoder.feed(' '.repeat(382));
  assert.throws(() => decoder.finish(), error => error.reason === 'empty_output');
  assert.deepEqual(decoder.recoveryCheckpoint().prefix, []);
});

test('合法组件也必须先读本轮字段，未读组件不能先进入可见快照', async () => {
  const state = new ComponentCatalogState(); state.reset();
  const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }] };
  bindComponentCatalog(context, state);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'gate-visibility', tokenSize: { min: 1, max: 3 } });
  const block = { type: 'Callout', props: { tone: 'success', text: '合法但尚未读取契约' } };
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: [block] })), fauxAssistantMessage(JSON.stringify({ content: [block] }))]);
  const read = async () => {
    const events = [];
    for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), context, {})) events.push(structuredClone(event));
    return events;
  };
  const rejected = await read();
  assert.equal(rejected.at(-1).type, 'error');
  assert.equal(rejected.at(-1).error.diagnostics.find(item => item.type === 'bangumi_error').details.diagnostic.reason, 'component_spec_required');
  assert.ok(rejected.every(event => visual(event.partial ?? event.error ?? event.message).length === 0));
  assert.equal(outputCheckpoint(rejected.at(-1).error).draft.type, 'Callout');
  const index = state.readIndex({ query: 'Callout' }), specs = state.readSpecs(['Callout']);
  for (const [toolName, result] of [['read_component_index', index], ['read_component_spec', specs]])
    context.messages.push({ role: 'toolResult', toolName, toolCallId: toolName, content: [{ type: 'text', text: JSON.stringify(result) }], isError: false, timestamp: 2 });
  bindComponentCatalog(context, state);
  const accepted = await read();
  assert.equal(accepted.at(-1).type, 'done', JSON.stringify(accepted.at(-1).error?.diagnostics));
  assert.equal(visual(accepted.at(-1).message)[0].type, 'Callout');
});

test('字段未读门禁失败可在同轮repair读索引及spec再完成，错误组件从未提前进入正文', async t => {
  const state = new ComponentCatalogState(); state.reset();
  const f = await fixture(t, { additionalExtension: pi => createComponentReadTools(state).forEach(tool => pi.registerTool(tool)) });
  const faux = fauxProvider({ api: 'openai-responses', provider: 'repair-reads-spec', tokenSize: { min: 1, max: 2 } });
  const output = fauxAssistantMessage(JSON.stringify({ content: [card(1)] }));
  faux.setResponses([output,
    fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'SubjectCards' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('read_component_spec', { names: ['SubjectCards'], representation: 'inline' })], { stopReason: 'toolUse' }),
    output]);
  const wrapped = withProviderFetch(faux.provider);
  const provider = { ...faux.provider, streamSimple(model, context, options) {
    const next = { ...context, messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }, ...context.messages] };
    bindComponentCatalog(next, state);
    return wrapped.streamSimple(model, next, options);
  } };
  f.initial.session.modelRuntime.registerNativeProvider(provider);
  await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline-placeholder');
  await f.initial.session.setModel(faux.getModel());
  const updates = [], busyAtMessageEnd = []; let liveId;
  f.initial.session.subscribe(event => {
    if (event.type === 'message_update' || event.type === 'message_end') updates.push(structuredClone(event));
    if (event.type === 'message_end' && event.message.role === 'assistant' && liveId)
      busyAtMessageEnd.push(f.manager.get(liveId).snapshot().busy);
  });
  const stream = await f.stream('spec-repair'), id = (await f.state('spec-repair')).sessionId;
  liveId = id;
  await f.post('spec-repair', 'submit', { input: '组件先读后填' }, id); await f.initial.session.waitForIdle();
  const view = await f.state('spec-repair');
  assert.equal(faux.state.callCount, 4);
  assert.equal(view.items.filter(item => item.kind === 'assistant').length, 1);
  assert.equal(view.items.some(item => ['error', 'notice'].includes(item.kind)), false);
  assert.ok(busyAtMessageEnd.length >= 4);
  assert.ok(busyAtMessageEnd.every(Boolean), 'message_end结束的是模型消息，宿主工具或恢复仍运行时不能提前取消busy');
  assert.deepEqual(view.items.find(item => item.kind === 'assistant').content[0], card(1));
  const firstErrorIndex = updates.findIndex(event => event.type === 'message_end' && event.message.stopReason === 'error');
  assert.ok(firstErrorIndex >= 0);
  assert.ok(updates.slice(0, firstErrorIndex + 1).filter(event => event.message.role === 'assistant').every(event => !visual(event.message).some(part => part.type === 'SubjectCards')));
  assert.equal(stream.frames.some(frame => frame.items?.some(item => item.kind === 'error')), false);
});

for (const success of [true, false]) test(`恢复${success ? '成功' : '耗尽'}正文单调保留，错误只进宿主过程，历史一致`, async t => {
  const f = await fixture(t);
  const faux = fauxProvider({ api: 'openai-responses', provider: `stable-recovery-${success}`, tokenSize: { min: 1, max: 3 } });
  faux.setResponses([fauxAssistantMessage('{"content":[' + JSON.stringify(card(1)) + ',', { stopReason: 'length' }),
    ...Array.from({ length: success ? 1 : 3 }, () => fauxAssistantMessage(JSON.stringify({ content: [card(success ? 2 : 1)] }))) ]);
  const runtime = f.initial.session.modelRuntime;
  runtime.registerNativeProvider(withProviderFetch(faux.provider)); await runtime.setRuntimeApiKey(faux.getModel().provider, 'offline-placeholder');
  await f.initial.session.setModel(faux.getModel());
  f.initial.session.settingsManager.applyOverrides({ retry: { baseDelayMs: 1, maxRetries: 2 } });
  const prepare = f.initial.session.agent.prepareRequest;
  f.initial.session.agent.prepareRequest = async (request, signal) => {
    const result = await prepare(request, signal), context = result?.context ?? request.context, messages = [...context.messages];
    const index = messages.findLast(message => message.role === 'system'), system = getCurrentSystemMessage(messages);
    const instruction = { ...system, role: 'system', content: system?.content ?? '', sections: { ...system?.sections, bangumi_content_output: CONTENT_OUTPUT_INSTRUCTION }, timestamp: Date.now() };
    if (index >= 0) messages[index] = instruction; else messages.unshift(instruction);
    return { ...result, context: { ...context, messages } };
  };
  const stream = await f.stream('visibility-tab'), id = (await f.state('visibility-tab')).sessionId;
  await f.post('visibility-tab', 'submit', { input: '稳定恢复测试' }, id); await f.initial.session.waitForIdle();
  const state = await f.state('visibility-tab'), replies = state.items.filter(item => item.kind === 'assistant');
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].content.flatMap(part => part.props?.items?.map(item => item.id) ?? []), success ? [1, 2] : [1], JSON.stringify({ calls: faux.state.callCount, items: state.items, diagnostics: f.initial.session.messages.filter(message => message.role === 'assistant').map(message => message.diagnostics) }));
  assert.equal(state.items.some(item => ['error', 'notice'].includes(item.kind)), false);
  assert.ok(state.items.some(item => item.kind === 'reasoning' && item.source === 'host' && item.label === '宿主校验过程'));
  assert.equal(state.items.find(item => item.kind === 'turn').status, success ? 'completed' : 'error');
  if (!success) assert.match(replies[0].content.at(-1).text, /未能完整生成/);
  await eventually(() => stream.frames.some(frame => frame.items?.some(item => item.id === replies[0].id)));
  const updates = stream.frames.flatMap(frame => frame.items?.filter(item => item.id === replies[0].id) ?? []);
  let previous = [];
  for (const update of updates) {
    assert.ok(update.content.length >= previous.length);
    assert.deepEqual(update.content.slice(0, previous.length), previous);
    previous = update.content;
  }
  await f.post('visibility-tab', 'session', { action: 'new' }); await f.post('visibility-tab', 'session', { action: 'resume', sessionId: id });
  const restored = (await f.state('visibility-tab')).items;
  assert.deepEqual(restored.filter(item => item.kind === 'assistant').map(item => item.content), replies.map(item => item.content));
  assert.equal(restored.some(item => ['error', 'notice'].includes(item.kind)), false);
  assert.equal(restored.find(item => item.kind === 'turn').status, success ? 'completed' : 'error');
});
