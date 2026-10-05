import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { lazyStream, getCurrentSystemMessage, getSystemMessageText } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime, withProviderFetch } from '../dist/src/pi-host.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { parseLauncherArgs } from '../dist/src/launcher.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { CONTENT_OUTPUT_SYSTEM_MARKER, PROVIDER_CONTENT_SCHEMA, normalizeProviderContent } from '../dist/src/output/content-schema.js';

const textPart = (text, nextType = null) => ({ type: 'text', nextType, text });
const normalized = { content: [
  textPart('文本 A', 'callout'),
  { type: 'callout', pending: false, props: { tone: 'success', text: '有效组件' } },
  textPart('文本 B'),
] };
const context = { messages: [{ role: 'system', content: '应用规则', sections: { bangumi_content_output: CONTENT_OUTPUT_SYSTEM_MARKER }, timestamp: 1 }] };
const makeFaux = (api = 'openai-responses', provider = 'content-offline') => fauxProvider({ api, provider, tokenSize: { min: 1, max: 2 } });
const nativeMessage = (content, options) => ({ ...fauxAssistantMessage(content, options),
  usage: { input: 4, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

function nullableFields(value, schema) {
  if (schema.anyOf) {
    const branch = schema.anyOf.find(item => item.properties?.type?.enum?.includes(value?.type))
      ?? schema.anyOf.find(item => item.type === (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value));
    assert.ok(branch, '测试线路必须匹配 provider schema');
    return nullableFields(value, branch);
  }
  if (schema.items) return value.map(item => nullableFields(item, schema.items));
  if (!schema.properties) return value;
  return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) =>
    [key, value[key] === undefined ? null : nullableFields(value[key], child)]));
}
function wireFor(answer) {
  const source = { content: answer.content.map(part => {
    const value = structuredClone(part); delete value.pending; return value;
  }) };
  const wire = nullableFields(source, PROVIDER_CONTENT_SCHEMA);
  assert.deepEqual(normalizeProviderContent(wire), answer);
  return JSON.stringify(wire);
}
const mixedWire = wireFor(normalized);

async function collected(stream) {
  const events = [];
  for await (const event of stream) events.push(structuredClone(event));
  return events;
}
function assertNoSidecar(events) {
  for (const event of events) {
    assert.equal(Object.hasOwn(event, 'contentOutput'), false);
    const message = event.message ?? event.error ?? event.partial;
    if (message) assert.equal(Object.hasOwn(message, 'contentOutput'), false);
  }
}
function assertEarlyPlaceholder(events, componentType) {
  const textEvents = events.filter(event => event.type === 'text_delta');
  assert.ok(textEvents.some(event => event.partial.content.some(part => part.type === componentType
    && part.pending === true && Object.keys(part.props).length === 0)), '文本增量期间已有下一组件占位');
  assert.ok(events.some(event => event.type === 'content_update'
    && event.partial.content[event.contentIndex]?.type === componentType), '组件变化进入原生内容事件');
  const snapshots = events.flatMap(event => event.partial?.content.filter(part => part.type === componentType) ?? []);
  assert.ok(snapshots.some(part => part.pending === true));
  assert.ok(snapshots.some(part => part.pending === false));
  const states = snapshots.map(part => part.pending).filter((state, index, all) => index === 0 || state !== all[index - 1]);
  assert.deepEqual(states, [true, false]);
}

async function fixture(t, responses, { api = 'openai-responses', provider: providerName = 'content-offline' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-content-'));
  const faux = makeFaux(api, providerName);
  faux.setResponses(responses);
  const captures = [], calls = [], nativeResults = [], events = [];
  const provider = { ...faux.provider, streamSimple: (model, transcript, options) => lazyStream(model, async () => {
    const initial = { model: model.id, input: transcript.messages, stream: true, tools: ['native-tools'], reasoning: { effort: 'low' } };
    const payload = await options?.onPayload?.(initial, model);
    captures.push({ context: structuredClone(transcript), payload: structuredClone(payload ?? initial), maxRetries: options?.maxRetries });
    return { async *[Symbol.asyncIterator]() {
      for await (const event of faux.provider.streamSimple(model, transcript, options)) {
        if (event.type === 'done') nativeResults.push(structuredClone(event.message));
        else if (event.type === 'error') nativeResults.push(structuredClone(event.error));
        yield event;
      }
    } };
  }) };
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(provider);
  await modelRuntime.setRuntimeApiKey(providerName, 'offline-placeholder');
  const manager = SessionManager.create(root, join(root, 'sessions'));
  manager.appendSessionInfo('原生混合内容离线测试');
  const service = new BangumiMcpService({ currentUser: async () => ({ id: 42, username: 'offline_user' }), close: async () => {} });
  const config = { authDir: join(root, 'auth'), timeoutMs: 1000, proxy: null,
    client: { call: async (...args) => { calls.push(args[0]); return service.call(...args); }, close: async () => {} },
    channel: { canConfirm: () => true, confirm: async () => true, canLogin: () => false, notify: () => {} },
  };
  const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, modelRuntime, sessionManager: manager,
    provider: providerName, model: 'faux-1', extension: createBangumiExtension(config) });
  const unsubscribe = runtime.session.subscribe(event => {
    if (['message_start', 'message_update', 'message_end'].includes(event.type)) events.push(structuredClone(event));
  });
  t.after(async () => {
    unsubscribe(); await runtime.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  return { runtime, faux, captures, calls, config, nativeResults, events, manager };
}

test('wrapper decodes native content and text deltas, preserving thinking, usage and terminal reason', async () => {
  const faux = makeFaux();
  faux.setResponses([nativeMessage([fauxThinking('原生思考'), fauxText(mixedWire)])]);
  let nativeUsage;
  const observed = { ...faux.provider, streamSimple: (model, transcript, options) => lazyStream(model, async () => ({
    async *[Symbol.asyncIterator]() {
      for await (const event of faux.provider.streamSimple(model, transcript, options)) {
        if (event.type === 'done') nativeUsage = structuredClone(event.message.usage);
        yield event;
      }
    },
  })) };
  const events = await collected(withProviderFetch(observed).streamSimple(faux.getModel(), context, {}));
  const textEvents = events.filter(event => event.type === 'text_delta');
  assert.ok(textEvents.length > 1);
  assert.equal(textEvents.map(event => event.delta).join(''), '文本 A文本 B');
  assert.deepEqual([...new Set(textEvents.map(event => event.contentIndex))], [1, 3]);
  assert.equal(events.filter(event => event.type === 'thinking_delta').map(event => event.delta).join(''), '原生思考');
  assertEarlyPlaceholder(events, 'callout');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.reason, 'stop');
  assert.deepEqual(done.message.content, [fauxThinking('原生思考'), ...normalized.content]);
  assert.deepEqual(done.message.usage, nativeUsage);
  assertNoSidecar(events);
});

test('real Pi loop defaults to schema, performs exactly two model requests and one fake MCP read', async t => {
  const beforeRead = wireFor({ content: [textPart('先查询当前账户。')] });
  const f = await fixture(t, [nativeMessage([fauxThinking('工具回合'), fauxText(beforeRead),
    fauxToolCall('get_current_user', {}, { id: 'read-1' })], { stopReason: 'toolUse' }), nativeMessage(mixedWire)]);
  await f.runtime.session.prompt('只读查询并给出内容组件');
  await f.runtime.session.waitForIdle();
  assert.equal(f.faux.state.callCount, 2);
  assert.deepEqual(f.calls, ['get_current_user']);
  assert.equal(f.captures.length, 2);
  for (const capture of f.captures) {
    assert.equal(capture.payload.stream, true);
    assert.deepEqual(capture.payload.tools, ['native-tools']);
    assert.deepEqual(capture.payload.reasoning, { effort: 'low' });
    assert.deepEqual(capture.payload.text.format.schema, PROVIDER_CONTENT_SCHEMA);
    assert.equal(capture.payload.text.format.strict, true);
    assert.equal(capture.maxRetries, 0);
    const systemText = getSystemMessageText(getCurrentSystemMessage(capture.context.messages));
    assert.ok(systemText.includes(CONTENT_OUTPUT_SYSTEM_MARKER));
    assert.ok(systemText.includes('默认用 subjects'));
  }
  const assistant = f.runtime.session.messages.findLast(message => message.role === 'assistant');
  assert.deepEqual(assistant.content, normalized.content);
  assert.equal(assistant.stopReason, 'stop');
  assert.deepEqual(assistant.usage, f.nativeResults.at(-1).usage);
  const updates = f.events.filter(event => event.type === 'message_update');
  assert.ok(updates.some(event => event.message.content.some(part => part.type === 'callout' && part.pending === true)));
  assert.ok(updates.some(event => event.message.content.some(part => part.type === 'callout' && part.pending === false)));
  assertEarlyPlaceholder(updates.map(event => event.assistantMessageEvent), 'callout');
  const finalEnd = f.events.findLast(event => event.type === 'message_end' && event.message.role === 'assistant');
  assert.deepEqual(finalEnd.message.content, normalized.content);
  assertNoSidecar(f.events);
  assertNoSidecar(updates.map(event => event.assistantMessageEvent));
});

test('subjects content is native and its facts survive the next real Pi request and saved history', async t => {
  const answer = { content: [textPart('相关条目：', 'subjects'), { type: 'subjects', pending: false, props: {
    title: '相关条目', layout: 'grid', items: [{ id: 123, name: '事实条目', kind: 'anime', score: 8.2 }],
  } }, textPart('理由说明。')] };
  const f = await fixture(t, [nativeMessage(wireFor(answer)), nativeMessage(wireFor({ content: [textPart('刚才条目评分为 8.2。')] }))]);
  await f.runtime.session.prompt('列出相关作品');
  await f.runtime.session.waitForIdle();
  assert.deepEqual(f.runtime.session.messages.findLast(message => message.role === 'assistant').content, answer.content);
  await f.runtime.session.prompt('刚才列表中的条目评分是多少');
  await f.runtime.session.waitForIdle();
  assert.equal(f.faux.state.callCount, 2);
  const prior = f.captures[1].context.messages.find(message => message.role === 'assistant');
  const replayed = prior.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.ok(replayed.includes('事实条目'));
  assert.ok(replayed.includes('8.2'));
  assert.ok(replayed.includes('"props"'));
  assert.ok(replayed.includes('"type":"subjects"'));
  const persisted = f.manager.getBranch().find(entry => entry.type === 'message'
    && entry.message.role === 'assistant' && entry.message.content.some(part => part.type === 'subjects'));
  assert.ok(persisted);
  assert.deepEqual(persisted.message.content, answer.content);
  assertNoSidecar(f.events);
});

test('Completions agent requests default to the declared provider constraint and native component content', async t => {
  for (const provider of ['content-completions', 'deepseek']) {
    await t.test(provider, async child => {
      const f = await fixture(child, [nativeMessage(mixedWire)], { api: 'openai-completions', provider });
      await f.runtime.session.prompt('根据已有事实展示内容组件');
      await f.runtime.session.waitForIdle();
      assert.equal(f.faux.state.callCount, 1);
      assert.deepEqual(f.calls, []);
      const capture = f.captures[0];
      assert.equal(capture.payload.text, undefined);
      if (provider === 'deepseek') assert.deepEqual(capture.payload.response_format, { type: 'json_object' });
      else {
        assert.equal(capture.payload.response_format.type, 'json_schema');
        assert.equal(capture.payload.response_format.json_schema.strict, true);
        assert.deepEqual(capture.payload.response_format.json_schema.schema, PROVIDER_CONTENT_SCHEMA);
      }
      assert.equal(capture.maxRetries, 0);
      assert.deepEqual(capture.payload.tools, ['native-tools']);
      assert.deepEqual(capture.payload.reasoning, { effort: 'low' });
      const last = f.runtime.session.messages.findLast(message => message.role === 'assistant');
      assert.equal(last.stopReason, 'stop');
      assert.deepEqual(last.content, normalized.content);
      const updates = f.events.filter(event => event.type === 'message_update').map(event => event.assistantMessageEvent);
      assertEarlyPlaceholder(updates, 'callout');
      assertNoSidecar(f.events);
    });
  }
});

test('title and compaction requests without application marker preserve ordinary native output', async () => {
  const faux = makeFaux();
  faux.setResponses([nativeMessage('生成标题'), nativeMessage('压缩摘要')]);
  const wrapped = withProviderFetch(faux.provider);
  for (const [index, prompt] of ['标题规则', '压缩规则'].entries()) {
    const events = await collected(wrapped.streamSimple(faux.getModel(), { messages: [{ role: 'system', content: prompt, timestamp: 1 }] }, {}));
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).message.content[0].text, ['生成标题', '压缩摘要'][index]);
    assert.ok(events.every(event => event.type !== 'content_update'));
    assertNoSidecar(events);
  }
});

test('parallel stream and streamSimple requests isolate native content and text deltas', async () => {
  const faux = makeFaux();
  faux.setResponses([nativeMessage(wireFor({ content: [textPart('并发 A')] })), nativeMessage(wireFor({ content: [textPart('并发 B')] }))]);
  const wrapped = withProviderFetch(faux.provider);
  const results = await Promise.all([collected(wrapped.stream(faux.getModel(), context, {})), collected(wrapped.streamSimple(faux.getModel(), context, {}))]);
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(results.map(events => events.at(-1).message.content[0].text).sort(), ['并发 A', '并发 B']);
  for (const events of results) {
    assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.delta).join(''), events.at(-1).message.content[0].text);
    assertNoSidecar(events);
  }
});

test('invalid component response fails once without extra model requests, repair or tools', async t => {
  const f = await fixture(t, [nativeMessage('{"content":[{"type":"unknown","props":{}}]}')]);
  await f.runtime.session.prompt('非法展示输出');
  await f.runtime.session.waitForIdle();
  assert.equal(f.faux.state.callCount, 1);
  assert.deepEqual(f.calls, []);
  const last = f.runtime.session.messages.findLast(message => message.role === 'assistant');
  assert.equal(last.stopReason, 'error');
  assert.match(last.errorMessage, /CONTENT_OUTPUT_INVALID/);
  assert.deepEqual(last.usage, f.nativeResults.at(-1).usage);
  assertNoSidecar(f.events);
});

function scripted(faux, makeEvents) {
  const source = model => lazyStream(model, async () => ({ async *[Symbol.asyncIterator]() { yield* makeEvents(); } }));
  return withProviderFetch({ ...faux.provider, stream: source, streamSimple: source });
}

test('expanding a native text block preserves signatures and remaps following tool index', async () => {
  const faux = makeFaux();
  const thinking = { ...fauxThinking('原生思考'), thinkingSignature: 'thinking-signature' };
  const text = { ...fauxText(mixedWire), textSignature: 'text-signature' };
  const call = { ...fauxToolCall('get_current_user', {}, { id: 'read-signature' }), thoughtSignature: 'tool-signature' };
  const message = nativeMessage([thinking, text, call], { stopReason: 'toolUse', responseId: 'response-1' });
  const wrapped = scripted(faux, () => [
    { type: 'start', partial: message },
    { type: 'thinking_start', contentIndex: 0, partial: message },
    { type: 'thinking_delta', contentIndex: 0, delta: thinking.thinking, partial: message },
    { type: 'thinking_end', contentIndex: 0, content: thinking.thinking, partial: message },
    { type: 'text_start', contentIndex: 1, partial: message },
    { type: 'text_delta', contentIndex: 1, delta: mixedWire, partial: message },
    { type: 'text_end', contentIndex: 1, content: mixedWire, partial: message },
    { type: 'toolcall_start', contentIndex: 2, partial: message },
    { type: 'toolcall_delta', contentIndex: 2, delta: '{}', partial: message },
    { type: 'toolcall_end', contentIndex: 2, toolCall: call, partial: message },
    { type: 'done', reason: 'toolUse', message },
  ]);
  const events = await collected(wrapped.streamSimple(faux.getModel(), context, {}));
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.reason, 'toolUse');
  assert.deepEqual(done.message.content[0], thinking);
  assert.deepEqual(done.message.content[4], call);
  assert.equal(done.message.content[1].textSignature, text.textSignature);
  assert.equal(done.message.content[3].textSignature, text.textSignature);
  assert.equal(done.message.responseId, 'response-1');
  assert.deepEqual(done.message.usage, message.usage);
  assert.ok(events.filter(event => event.type.startsWith('toolcall_')).every(event => event.contentIndex === 4));
  assertNoSidecar(events);
});

test('terminal-only valid response is decoded into native content with no raw JSON leak', async () => {
  const faux = makeFaux();
  const message = nativeMessage(mixedWire);
  const events = await collected(scripted(faux, () => [{ type: 'done', reason: 'stop', message }]).streamSimple(faux.getModel(), context, {}));
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(events.at(-1).message.content, normalized.content);
  assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.delta).join(''), '文本 A文本 B');
  assertNoSidecar(events);
});

test('native network error is terminal and retains usage, without automatic retries', async t => {
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: '原生网络失败' })]);
  await f.runtime.session.prompt('模拟网络失败');
  await f.runtime.session.waitForIdle();
  assert.equal(f.faux.state.callCount, 1);
  assert.deepEqual(f.calls, []);
  const last = f.runtime.session.messages.findLast(message => message.role === 'assistant');
  assert.equal(last.stopReason, 'error');
  assert.equal(last.errorMessage, '原生网络失败');
  assert.deepEqual(last.usage, f.nativeResults[0].usage);
});

test('cancellation retains text and incomplete placeholder but never marks a partial component complete', async () => {
  const faux = makeFaux(), controller = new AbortController();
  const message = nativeMessage('raw');
  let release;
  const visible = new Promise(resolve => { release = resolve; });
  const wrapped = scripted(faux, async function* () {
    yield { type: 'start', partial: message };
    yield { type: 'text_delta', contentIndex: 0, delta: '{"content":[{"type":"text","nextType":"callout","text":"可见草稿', partial: message };
    // 等到消费侧确实看到解码文字，避免同步脚本被预取后过早取消。
    await visible;
    yield { type: 'done', reason: 'stop', message };
  });
  const events = [];
  for await (const event of wrapped.streamSimple(faux.getModel(), context, { signal: controller.signal })) {
    events.push(structuredClone(event));
    if (event.type === 'text_delta') { controller.abort(); release(); }
  }
  const last = events.at(-1);
  assert.equal(last.type, 'error');
  assert.equal(last.reason, 'aborted');
  assert.equal(last.error.stopReason, 'aborted');
  assert.deepEqual(last.error.content, [textPart('可见草稿', 'callout'), { type: 'callout', pending: true, props: {} }]);
  assertNoSidecar(events);
});

test('truncation retains visible draft and partial props, never completing invalid JSON', async () => {
  const faux = makeFaux();
  const raw = '{"content":[{"type":"text","nextType":"subjects","text":"候选"},{"type":"subjects","props":{"title":"相关条目","layout":"grid","items":[';
  const message = nativeMessage(raw);
  const wrapped = scripted(faux, () => [
    { type: 'start', partial: message },
    { type: 'text_delta', contentIndex: 0, delta: raw, partial: message },
    { type: 'done', reason: 'length', message: { ...message, stopReason: 'length' } },
  ]);
  const events = await collected(wrapped.streamSimple(faux.getModel(), context, {}));
  const last = events.at(-1);
  assert.equal(last.type, 'error');
  assert.equal(last.error.stopReason, 'error');
  assert.match(last.error.errorMessage, /CONTENT_OUTPUT_INVALID/);
  assert.deepEqual(last.error.content, [textPart('候选', 'subjects'), { type: 'subjects', pending: true, props: { title: '相关条目', layout: 'grid' } }]);
  assertNoSidecar(events);
});

test('launcher has no opt-in, ignores obsolete environment switch and rejects obsolete CLI flag', () => {
  const env = { LOCALAPPDATA: tmpdir(), BANGUMI_TRACE: 'off' };
  assert.equal(Object.hasOwn(parseLauncherArgs([], env), 'contentOutput'), false);
  assert.deepEqual(parseLauncherArgs([], { ...env, BANGUMI_CONTENT_OUTPUT: 'off' }), parseLauncherArgs([], env));
  assert.deepEqual(parseLauncherArgs([], { ...env, BANGUMI_CONTENT_OUTPUT: 'mixed' }), parseLauncherArgs([], env));
  assert.deepEqual(parseLauncherArgs(['web', '--no-open'], env).web, { port: 8787, open: false });
  for (const args of [['--content-output', 'mixed'], ['--content-output', 'off'], ['--content-output'], ['web', '--no-open', '--content-output', 'mixed']]) {
    assert.throws(() => parseLauncherArgs(args, env), /未支持的参数/);
  }
});

