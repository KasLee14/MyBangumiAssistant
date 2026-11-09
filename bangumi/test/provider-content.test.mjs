import { PROVIDER_CONTENT_SCHEMA, normalizeProviderContent } from '../dist/src/output/provider-content.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { lazyStream, getCurrentSystemMessage, getSystemMessageText, getCurrentTools } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime, withProviderFetch } from '../dist/src/pi-host.js';
import { createLegacyBangumiExtension as createBangumiExtension } from './legacy-provider-fixture.mjs';
import { parseLauncherArgs } from '../dist/src/launcher.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';
import { CONTENT_OUTPUT_SYSTEM_MARKER } from '../dist/src/output/content-schema.js';
import { COMPONENT_KINDS } from '../dist/src/output/content-types.js';

const textPart = (text, nextType = null) => ({ type: 'text', nextType, text });
const normalized = { content: [
  textPart('文本 A', 'Callout'),
  { type: 'Callout', pending: false, props: { tone: 'success', text: '有效组件' } },
  textPart('文本 B'),
] };
const context = { messages: [{ role: 'system', content: '应用规则', sections: { bangumi_content_output: CONTENT_OUTPUT_SYSTEM_MARKER }, timestamp: 1 }] };
const makeFaux = (api = 'openai-responses', provider = 'content-offline') => fauxProvider({ api, provider, tokenSize: { min: 1, max: 2 } });
const nativeMessage = (content, options) => ({ ...fauxAssistantMessage(content, options),
  usage: { input: 4, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

function wireFor(answer) {
  assert.deepEqual(normalizeProviderContent(answer), answer);
  return JSON.stringify(answer);
}
const mixedWire = wireFor(normalized);
function recoveryFeedback(context) {
  const text = context.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content
    : message.content.filter(part => part.type === 'text').map(part => part.text).join('')).findLast(text => text.includes('host_recovery_feedback'));
  return text ? JSON.parse(text) : undefined;
}
const recoveryRecords = f => f.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery').map(entry => entry.data);
const rawLastAssistant = f => f.manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;

test('合法正文带外层元数据一次完成，不启动恢复；状态字段由宿主生成', async t => {
  const wire = { type: 'json_object', metadata: { note: '不消费元数据' }, content: [
    { type: 'text', text: '周历', nextType: 'StatsCard' },
    { type: 'DataTable', pending: true, props: { columns: [{ key: 'day', label: '星期' }], rows: [{ day: '周一' }] } },
    { type: 'text', text: '说明', nextType: 'LinkList' },
  ] };
  const f = await fixture(t, [nativeMessage(JSON.stringify(wire))]);
  await f.runtime.session.prompt('帮我整理一下我在看的本季度新番的播出时间，整理成一个表格，展现周一到周日每天有哪些动画更新。同一天更新的动画放到同一行');
  const last = rawLastAssistant(f);
  assert.equal(last.stopReason, 'stop'); assert.equal(f.scriptedCalls, 1);
  assert.deepEqual(last.content.map(part => part.type), ['text', 'DataTable', 'text']);
  assert.equal(last.content[0].nextType, 'DataTable'); assert.equal(last.content[1].pending, false); assert.equal(last.content[2].nextType, null);
  assert.equal(recoveryRecords(f).length, 0); assert.ok(last.diagnostics.some(item => item.type === 'bangumi_output_normalized'));
});

test('已完成末段声明结束也可续接合法后缀，不改写前缀事实', async t => {
  const first = textPart('保留前缀');
  const f = await fixture(t, [nativeMessage('{"content":[' + JSON.stringify(first) + ',{"type":"text","text":"未闭合', { stopReason: 'length' }), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.checkpoint.resumeAt, 1);
    assert.equal(feedback.checkpoint.failureScope, 'json'); assert.equal('expectedNextType' in feedback.checkpoint, false);
    return nativeMessage(JSON.stringify({ content: [{ type: 'text', text: '合法后缀' }] }));
  }]);
  await f.runtime.session.prompt('测试文本续接');
  const last = rawLastAssistant(f); assert.equal(last.stopReason, 'stop');
  assert.deepEqual(last.content, [textPart('保留前缀', 'text'), textPart('合法后缀')]); assert.equal(f.scriptedCalls, 2);
});

test('仅JSON尾部缺失时用独立空后缀完成，不丢失已交付内容', async t => {
  const first = textPart('已经交付');
  const f = await fixture(t, [nativeMessage('{"content":[' + JSON.stringify(first), { stopReason: 'length' }), nativeMessage('{"content":[]}')]);
  await f.runtime.session.prompt('测试JSON尾部恢复');
  assert.equal(rawLastAssistant(f).stopReason, 'stop'); assert.deepEqual(rawLastAssistant(f).content, [first]); assert.equal(f.scriptedCalls, 2);
});

test('多个文字源的错误索引投影到同一后缀坐标，保留之前完整源', async t => {
  const first = textPart('第一个源的事实');
  const bad = { type: 'Callout', props: { tone: 'wrong', text: '坏字段' } };
  const fixed = { type: 'Callout', pending: false, props: { tone: 'success', text: '修复后' } };
  const response = nativeMessage([fauxText(JSON.stringify({ content: [first] })), fauxThinking('原生思考'), fauxText(JSON.stringify({ content: [bad] }))]);
  const f = await fixture(t, [response, context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.checkpoint.resumeAt, 1); assert.equal(feedback.checkpoint.failedPartIndex, 1);
    assert.ok(feedback.error.issues.some(issue => issue.path === '/content/1/props/tone'));
    return nativeMessage(JSON.stringify({ content: [fixed] }));
  }]);
  await f.runtime.session.prompt('测试多个文字源恢复');
  assert.equal(rawLastAssistant(f).stopReason, 'stop'); assert.deepEqual(rawLastAssistant(f).content, [textPart(first.text, 'Callout'), fixed]);
});

test('长度截断保留50张卡片，模型收到断点后只补71张且完整结果无重复', async t => {
  const cards = (first, count) => ({ type: 'SubjectCards', pending: false, props: { layout: 'list', items: Array.from({ length: count }, (_, index) => ({ id: first + index, name: `模拟作品${first + index}`, kind: 'anime' })) } });
  const first = cards(1, 50), rest = [cards(51, 50), cards(101, 21)];
  const cut = '{"content":[' + JSON.stringify(first) + ',';
  const f = await fixture(t, [nativeMessage(cut, { stopReason: 'length', rawStopReason: 'length' }), context => {
    const feedback = recoveryFeedback(context);
    assert.equal(feedback.error.code, 'LLM_OUTPUT_TRUNCATED'); assert.equal(feedback.goal.strategy, 'continue_output');
    assert.ok(getSystemMessageText(getCurrentSystemMessage(context.messages)).includes('当前处于宿主定向恢复'));
    assert.deepEqual(feedback.checkpoint.completedSubjectIds, Array.from({ length: 50 }, (_, index) => index + 1));
    assert.equal(feedback.checkpoint.resumeAt, 1);
    return nativeMessage(wireFor({ content: rest }));
  }]);
  await f.runtime.session.prompt('完整整理121部模拟作品'); await f.runtime.session.waitForIdle();
  const last = rawLastAssistant(f);
  assert.equal(last.stopReason, 'stop'); assert.deepEqual(last.content, [first, ...rest]);
  assert.equal(new Set(last.content.flatMap(part => part.props.items.map(item => item.id))).size, 121);
  assert.equal(f.scriptedCalls, 2); assert.deepEqual(f.calls, []);
});

test('坏字段只修复后缀，已完成组件不重新生成；恢复阶段拒绝工具调用', async t => {
  const first = { type: 'Callout', pending: false, props: { tone: 'success', text: '保留已有事实' } };
  const bad = { type: 'StatsCard', pending: false, props: { mode: 'wrong', entries: [] } };
  const fixed = { ...bad, props: { mode: 'list', entries: [] } };
  const f = await fixture(t, [nativeMessage(JSON.stringify({ content: [first, bad] })), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.goal.strategy, 'repair_component');
    assert.ok(feedback.error.issues.some(issue => issue.path === '/content/1/props/mode'));
    return nativeMessage([fauxToolCall('get_current_user', {}, { id: 'forbidden-repair' })], { stopReason: 'toolUse' });
  }, nativeMessage(wireFor({ content: [fixed] }))]);
  await f.runtime.session.prompt('展示两个模拟组件'); await f.runtime.session.waitForIdle();
  assert.deepEqual(f.calls, []); assert.equal(f.scriptedCalls, 3);
  assert.deepEqual(f.runtime.session.messages.findLast(message => message.role === 'assistant').content, [first, fixed]);
});

test('网络恢复经过成功工具回合也不能重置原用户任务的恢复预算', async t => {
  const invalid = nativeMessage('{"content":[{"type":"unknown","props":{}}]}');
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: 'fetch failed' }),
    nativeMessage([fauxToolCall('get_current_user', {}, { id: 'budget-read' })], { stopReason: 'toolUse' }), invalid, invalid, nativeMessage(mixedWire)]);
  await f.runtime.session.prompt('验证跨工具恢复预算'); await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 4); assert.deepEqual(f.calls, ['get_current_user']);
  assert.deepEqual(recoveryRecords(f).filter(row => row.stage === 'scheduled').map(row => row.attempt), [1, 2]);
  assert.ok(recoveryRecords(f).some(row => row.stage === 'stopped' && row.attempt === 2));
});

test('恢复不能重复交付既有卡片，收到相同错误且无进展时有界停止', async t => {
  const card = { type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id: 1, name: '模拟作品', kind: 'anime' }] } };
  const f = await fixture(t, [nativeMessage('{"content":[' + JSON.stringify(card) + ',', { stopReason: 'length' }),
    nativeMessage(wireFor({ content: [card] })), nativeMessage(wireFor({ content: [card] }))]);
  await f.runtime.session.prompt('不能重复作品'); await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 3); assert.deepEqual(f.calls, []);
  const last = rawLastAssistant(f);
  assert.equal(last.stopReason, 'error'); assert.deepEqual(last.content, [card]);
});

test('MCP参数诊断反馈到模型，认证失败只允许说明结果；新用户任务清除旧反馈', async t => {
  const f = await fixture(t, [nativeMessage([fauxToolCall('get_current_user', { unexpected: true }, { id: 'bad-params' })], { stopReason: 'toolUse' }), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.error.code, 'INVALID_INPUT'); assert.equal(feedback.goal.strategy, 'replan_read');
    return nativeMessage(wireFor({ content: [textPart('本轮参数问题已说明。')] }));
  }, context => { assert.equal(recoveryFeedback(context), undefined); return nativeMessage(wireFor({ content: [textPart('新任务独立回答。')] })); }]);
  await f.runtime.session.prompt('模拟错误参数'); await f.runtime.session.waitForIdle();
  await f.runtime.session.prompt('一个全新的任务'); await f.runtime.session.waitForIdle();
  assert.deepEqual(f.calls, []); assert.equal(f.scriptedCalls, 3);
});

test('卡片均已完成但尾部文字未闭合时只补收尾，不重新生成卡片', async t => {
  const card = { type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id: 1, name: '模拟作品', kind: 'anime' }] } };
  const cut = '{"content":[' + JSON.stringify(card) + ',{"type":"text","nextType":null,"text":"覆盖说明未完';
  const f = await fixture(t, [nativeMessage(cut, { stopReason: 'length' }), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.checkpoint.draft.type, 'text');
    assert.equal(feedback.checkpoint.draft.text, '覆盖说明未完');
    return nativeMessage(wireFor({ content: [textPart('覆盖说明完整。')] }));
  }]);
  await f.runtime.session.prompt('展示作品和覆盖说明'); await f.runtime.session.waitForIdle();
  assert.deepEqual(f.runtime.session.messages.findLast(message => message.role === 'assistant').content, [card, textPart('覆盖说明完整。')]);
  assert.equal(f.scriptedCalls, 2);
});

test('认证失败只允许报告缺口，恢复期间不再调用工具', async t => {
  const f = await fixture(t, [nativeMessage([fauxToolCall('get_current_user', {}, { id: 'auth-failure' })], { stopReason: 'toolUse' }), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.error.code, 'BGM_AUTH_REQUIRED'); assert.equal(feedback.goal.strategy, 'report_failure');
    return nativeMessage(wireFor({ content: [textPart('需要重新登录，本轮已停止。')] }));
  }]);
  let calls = 0; f.config.client.call = async () => { calls++; throw new AppError('BGM_AUTH_REQUIRED', '需要登录'); };
  await f.runtime.session.prompt('只读账户诊断'); await f.runtime.session.waitForIdle();
  assert.equal(calls, 1); assert.equal(f.scriptedCalls, 2);
  assert.equal(f.runtime.session.messages.findLast(message => message.role === 'assistant').stopReason, 'stop');
});

test('未知批次写入回执只进入报告流程，不重新提交或追加写入', async t => {
  const args = { operations: [{ tool: 'collect_person', args: { person_id: 1 } }] };
  const f = await fixture(t, [nativeMessage([fauxToolCall('execute_write_batch', args, { id: 'unknown-write' })], { stopReason: 'toolUse' }), context => {
    const feedback = recoveryFeedback(context); assert.equal(feedback.error.code, 'WRITE_OUTCOME_UNKNOWN'); assert.equal(feedback.goal.strategy, 'report_failure');
    return nativeMessage(wireFor({ content: [textPart('模拟回执为未知，未重发写入。')] }));
  }]);
  let writes = 0; const definition = f.runtime.session.getToolDefinition('execute_write_batch');
  definition.execute = async () => { writes++; const value = { state: 'unknown', summary: { unknown: 1 }, items: [] };
    return { content: [{ type: 'text', text: JSON.stringify({ value }) }], details: { value }, structuredContent: { value } }; };
  await f.runtime.session.prompt('只验证模拟回执'); await f.runtime.session.waitForIdle();
  assert.equal(writes, 1); assert.deepEqual(f.calls, []); assert.equal(f.scriptedCalls, 2);
  assert.ok(recoveryRecords(f).some(row => row.stage === 'write_unknown'));
});

test('提供方拒绝生成额度时明确停止，不用相同额度抽卡重试', async t => {
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: 'max_tokens exceeds maximum' }), nativeMessage(mixedWire)]);
  await f.runtime.session.prompt('模拟额度配置被拒绝'); await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 1); assert.deepEqual(f.calls, []);
  assert.ok(recoveryRecords(f).some(row => row.stage === 'stopped'));
});

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
  assert.ok(events.some(event => event.type === 'content_update'
    && event.partial.content[event.contentIndex]?.type === componentType), '组件变化进入原生内容事件');
  const snapshots = events.flatMap(event => event.partial?.content.filter(part => part.type === componentType) ?? []);
  assert.equal(snapshots.some(part => part.pending === true), false, '草稿占位留在解码器内部');
  assert.ok(snapshots.some(part => part.pending === false));
  const states = snapshots.map(part => part.pending).filter((state, index, all) => index === 0 || state !== all[index - 1]);
  assert.deepEqual(states, [false]);
}

async function fixture(t, responses, { api = 'openai-responses', provider: providerName = 'content-offline', retryDelayMs = 1 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-content-'));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ retry: { enabled: false, maxRetries: 2, baseDelayMs: retryDelayMs } }));
  const faux = makeFaux(api, providerName);
  let scriptedCalls = 0, supportCalls = 0, pendingScript;
  // 真实执行目录读取/工具发现；原故障脚本步数独立计数，恢复预算断言仍对应业务响应。
  const choose = async transcript => {
    const userIndex = transcript.messages.findLastIndex(message => message.role === 'user'
      && !JSON.stringify(message.content).includes('host_recovery_feedback'));
    const current = transcript.messages.slice(userIndex + 1);
    const hasSpec = current.some(message => message.role === 'toolResult' && message.toolName === 'read_component_spec' && !message.isError);
    if (!hasSpec) {
      const hasIndex = current.some(message => message.role === 'toolResult' && message.toolName === 'read_component_index' && !message.isError);
      supportCalls++;
      return { support: true, message: nativeMessage([fauxToolCall(hasIndex ? 'read_component_spec' : 'read_component_index',
        hasIndex ? { names: COMPONENT_KINDS, representation: 'inline' } : { limit: 12 })], { stopReason: 'toolUse' }) };
    }
    if (!pendingScript) {
      const response = responses[scriptedCalls];
      if (!response) throw new Error('离线故障脚本响应已耗尽。');
      pendingScript = typeof response === 'function' ? await response(transcript) : response;
    }
    const available = new Set(getCurrentTools(transcript.messages).map(tool => tool.name));
    const missing = pendingScript.content.filter(part => part.type === 'toolCall' && !available.has(part.name)).map(part => part.name);
    if (missing.length && (!recoveryFeedback(transcript) || recoveryFeedback(transcript).goal.strategy === 'retry_request')) {
      supportCalls++;
      return { support: true, message: nativeMessage([fauxToolCall('discover_bangumi_tools', { tool_names: missing, load: true })], { stopReason: 'toolUse' }) };
    }
    const message = pendingScript; pendingScript = undefined; scriptedCalls++;
    return { support: false, message };
  };
  let prepared;
  faux.setResponses(Array.from({ length: 100 }, () => () => prepared.message));
  const captures = [], calls = [], nativeResults = [], events = [];
  const provider = { ...faux.provider, streamSimple: (model, transcript, options) => lazyStream(model, async () => {
    prepared = await choose(transcript);
    const initial = { model: model.id, input: transcript.messages, stream: true, tools: ['native-tools'], reasoning: { effort: 'low' } };
    const payload = await options?.onPayload?.(initial, model);
    if (!prepared.support) captures.push({ context: structuredClone(transcript), payload: structuredClone(payload ?? initial), maxRetries: options?.maxRetries });
    return { async *[Symbol.asyncIterator]() {
      for await (const event of faux.provider.streamSimple(model, transcript, options)) {
        if (!prepared.support && event.type === 'done') nativeResults.push(structuredClone(event.message));
        else if (!prepared.support && event.type === 'error') nativeResults.push(structuredClone(event.error));
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
    if (['message_start', 'message_update', 'message_end', 'auto_retry_start', 'auto_retry_end'].includes(event.type)) events.push(structuredClone(event));
  });
  t.after(async () => {
    unsubscribe(); await runtime.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  return { runtime, faux, captures, calls, config, nativeResults, events, manager,
    get scriptedCalls() { return scriptedCalls; }, get supportCalls() { return supportCalls; } };
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
  assertEarlyPlaceholder(events, 'Callout');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.reason, 'stop');
  assert.deepEqual(done.message.content, [fauxThinking('原生思考'), ...normalized.content]);
  assert.deepEqual(done.message.usage, nativeUsage);
  assertNoSidecar(events);
});

test('real Pi loop uses JSON object contract, performs exactly two model requests and one fake MCP read', async t => {
  const beforeRead = wireFor({ content: [textPart('先查询当前账户。')] });
  const f = await fixture(t, [nativeMessage([fauxThinking('工具回合'), fauxText(beforeRead),
    fauxToolCall('get_current_user', {}, { id: 'read-1' })], { stopReason: 'toolUse' }), nativeMessage(mixedWire)]);
  await f.runtime.session.prompt('只读查询并给出内容组件');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 2);
  assert.deepEqual(f.calls, ['get_current_user']);
  assert.equal(f.captures.length, 2);
  for (const capture of f.captures) {
    assert.equal(capture.payload.stream, true);
    assert.deepEqual(capture.payload.tools, ['native-tools']);
    assert.deepEqual(capture.payload.reasoning, { effort: 'low' });
    assert.deepEqual(capture.payload.text.format, { type: 'json_object' });
    assert.equal(capture.maxRetries, 0);
    const systemText = getSystemMessageText(getCurrentSystemMessage(capture.context.messages));
    assert.ok(systemText.includes(CONTENT_OUTPUT_SYSTEM_MARKER));
    assert.ok(systemText.includes('read_component_index'));
  }
  const assistant = f.runtime.session.messages.findLast(message => message.role === 'assistant');
  assert.deepEqual(assistant.content, normalized.content);
  assert.equal(assistant.stopReason, 'stop');
  assert.deepEqual(assistant.usage, f.nativeResults.at(-1).usage);
  const updates = f.events.filter(event => event.type === 'message_update');
  assert.equal(updates.some(event => event.message.content.some(part => part.type === 'Callout' && part.pending === true)), false);
  assert.ok(updates.some(event => event.message.content.some(part => part.type === 'Callout' && part.pending === false)));
  assertEarlyPlaceholder(updates.map(event => event.assistantMessageEvent), 'Callout');
  const finalEnd = f.events.findLast(event => event.type === 'message_end' && event.message.role === 'assistant');
  assert.deepEqual(finalEnd.message.content, normalized.content);
  assertNoSidecar(f.events);
  assertNoSidecar(updates.map(event => event.assistantMessageEvent));
});

test('subjects content is native and its facts survive the next real Pi request and saved history', async t => {
  const answer = { content: [textPart('相关条目：', 'SubjectCards'), { type: 'SubjectCards', pending: false, props: {
    title: '相关条目', layout: 'grid', items: [{ id: 123, name: '事实条目', kind: 'anime', score: 8.2, scoreCount: 345, rank: 12,
      date: '2026-10-09', tags: ['日常'], summary: '长简介只保留在canonical会话', image: 'https://example.invalid/history-cover.jpg', url: 'https://bgm.tv/subject/123' }],
  } }, textPart('理由说明。')] };
  const f = await fixture(t, [nativeMessage(wireFor(answer)), transcript => {
    const part = transcript.messages.flatMap(message => message.role === 'assistant' ? message.content : [])
      .find(part => part.type === 'text' && part.text.startsWith('历史展示摘要：') && part.text.includes('"type":"SubjectCards"'));
    const history = JSON.parse(part.text.slice('历史展示摘要：'.length));
    assert.equal(history.props.items[0].score, 8.2);
    return nativeMessage(wireFor({ content: [textPart(`刚才条目评分为 ${history.props.items[0].score}。`)] }));
  }]);
  await f.runtime.session.prompt('列出相关作品');
  await f.runtime.session.waitForIdle();
  assert.deepEqual(f.runtime.session.messages.findLast(message => message.role === 'assistant').content, answer.content);
  await f.runtime.session.prompt('刚才列表中的条目评分是多少');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 2);
  const prior = f.captures[1].context.messages.find(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.includes('事实条目')));
  const replayed = prior.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.ok(replayed.includes('事实条目'));
  assert.ok(replayed.includes('8.2'));
  const card = JSON.parse(prior.content.find(part => part.type === 'text' && part.text.startsWith('历史展示摘要：')).text.slice('历史展示摘要：'.length));
  assert.deepEqual(card.props.items[0], { id: 123, name: '事实条目', kind: 'anime', score: 8.2, scoreCount: 345, rank: 12, date: '2026-10-09', tags: ['日常'] });
  assert.equal(replayed.includes('长简介只保留在canonical会话'), false); assert.equal(replayed.includes('history-cover.jpg'), false);
  assert.equal(replayed.includes('https://bgm.tv/subject/123'), false);
  assert.ok(replayed.includes('"props"'));
  assert.ok(replayed.includes('"type":"SubjectCards"'));
  const persisted = f.manager.getBranch().find(entry => entry.type === 'message'
    && entry.message.role === 'assistant' && entry.message.content.some(part => part.type === 'SubjectCards'));
  assert.ok(persisted);
  assert.deepEqual(persisted.message.content, answer.content);
  assert.equal(rawLastAssistant(f).content[0].text, '刚才条目评分为 8.2。');
  assertNoSidecar(f.events);
});

test('Completions agent requests default to the declared provider constraint and native component content', async t => {
  for (const provider of ['content-completions', 'deepseek']) {
    await t.test(provider, async child => {
      const f = await fixture(child, [nativeMessage(mixedWire)], { api: 'openai-completions', provider });
      await f.runtime.session.prompt('根据已有事实展示内容组件');
      await f.runtime.session.waitForIdle();
      assert.equal(f.scriptedCalls, 1);
      assert.deepEqual(f.calls, []);
      const capture = f.captures[0];
      assert.equal(capture.payload.text, undefined);
      assert.deepEqual(capture.payload.response_format, { type: 'json_object' });
      assert.equal(capture.maxRetries, 0);
      assert.deepEqual(capture.payload.tools, ['native-tools']);
      assert.deepEqual(capture.payload.reasoning, { effort: 'low' });
      const last = f.runtime.session.messages.findLast(message => message.role === 'assistant');
      assert.equal(last.stopReason, 'stop');
      assert.deepEqual(last.content, normalized.content);
      const updates = f.events.filter(event => event.type === 'message_update').map(event => event.assistantMessageEvent);
      assertEarlyPlaceholder(updates, 'Callout');
      assertNoSidecar(f.events);
    });
  }
});

test('DataTable历史进入模型时仅保留展示摘要，新生成和持久化仍保持完整对象行', async t => {
  const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const table = { type: 'DataTable', pending: false, props: {
    columns: ['weekday', 'count', 'subjects', 'date', 'url'].map(key => ({ key, label: key })),
    rows: weekdays.map((weekday, index) => ({ weekday, count: '1', subjects: `示例动画${index + 1}`,
      date: '2026-10-01', url: `https://bgm.tv/subject/${index + 1}` })),
  } };
  const edited = { ...table, props: { columns: table.props.columns.slice(0, 3),
    rows: table.props.rows.map(({ weekday, count, subjects }) => ({ weekday, count, subjects })) } };
  const f = await fixture(t, [nativeMessage(wireFor({ content: [table] })), transcript => {
    const previous = transcript.messages.findLast(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.startsWith('历史展示摘要：')));
    const replayed = previous.content.find(part => part.type === 'text' && part.text.startsWith('历史展示摘要：'));
    const summary = JSON.parse(replayed.text.slice('历史展示摘要：'.length));
    assert.equal(summary.type, 'DataTable');
    assert.equal(summary.props.rows.length, 7);
    assert.ok(summary.props.rows.every(row => row && typeof row === 'object' && !Array.isArray(row)));
    assert.deepEqual(summary.props.columns, table.props.columns);
    assert.deepEqual(summary.props.rows, table.props.rows);
    assert.equal(replayed.text.includes('2026-10-01'), true);
    assert.equal(replayed.text.includes('https://bgm.tv/subject'), true);
    return nativeMessage(wireFor({ content: [edited] }));
  }], { api: 'openai-completions', provider: 'deepseek' });
  await f.runtime.session.prompt('整理周一到周日每天更新的动画');
  await f.runtime.session.waitForIdle();
  await f.runtime.session.prompt('去掉开播日期和URL，只留星期、部数和作品名');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 2);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.runtime.session.messages.findLast(message => message.role === 'assistant').content, [edited]);
  const original = f.manager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'assistant'
    && entry.message.content.some(part => part.type === 'DataTable' && part.props.columns.length === 5));
  assert.ok(original); assert.deepEqual(original.message.content, [table]);
  assert.equal(f.events.some(event => event.type === 'message_update'
    && event.message.content.some(part => part.type === 'DataTable' && part.pending === true)), false);
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

test('invalid component response automatically retries in Pi without repeating completed tools', async t => {
  const beforeRead = wireFor({ content: [textPart('先查询当前账户。')] });
  const f = await fixture(t, [nativeMessage([fauxText(beforeRead), fauxToolCall('get_current_user', {}, { id: 'read-retry' })],
    { stopReason: 'toolUse' }), nativeMessage('{"content":[{"type":"unknown","props":{}}]}'), nativeMessage(mixedWire)]);
  assert.deepEqual(f.runtime.session.settingsManager.getRetrySettings(), { enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 60000 });
  await f.runtime.session.prompt('非法展示输出');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 3);
  assert.deepEqual(f.calls, ['get_current_user']);
  const last = f.runtime.session.messages.findLast(message => message.role === 'assistant');
  assert.equal(last.stopReason, 'stop');
  assert.deepEqual(last.content, normalized.content);
  const recoveries = f.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery').map(entry => entry.data);
  assert.deepEqual(recoveries.filter(record => record.stage === 'scheduled').map(record => record.attempt), [1]);
  assert.ok(recoveries.some(record => record.stage === 'recovered'));
  const feedback = f.captures[2].context.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('')).find(text => text.includes('host_recovery_feedback'));
  assert.equal(JSON.parse(feedback).error.code, 'CONTENT_SCHEMA_INVALID');
  assert.ok(f.manager.getBranch().some(entry => entry.type === 'message' && entry.message.errorMessage?.startsWith('CONTENT_OUTPUT_INVALID')));
  assert.equal(f.captures[2].context.messages.some(message => message.errorMessage?.startsWith('CONTENT_OUTPUT_INVALID')), false);
  assert.equal(f.captures[2].context.messages.filter(message => message.role === 'toolResult' && !['read_component_index', 'read_component_spec', 'discover_bangumi_tools'].includes(message.toolName)).length, 1);
  assert.deepEqual(last.usage, f.nativeResults.at(-1).usage);
  assertNoSidecar(f.events);
});

test('invalid output stops after the configured Pi retry budget', async t => {
  const f = await fixture(t, Array.from({ length: 3 }, () => nativeMessage('{"content":[{"type":"unknown","props":{}}]}')));
  await f.runtime.session.prompt('持续非法展示输出');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 3);
  assert.deepEqual(f.calls, []);
  const records = f.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery').map(entry => entry.data);
  assert.deepEqual(records.filter(record => record.stage === 'scheduled').map(record => record.attempt), [1, 2]);
  assert.ok(records.some(record => record.stage === 'stopped' && record.attempt === 2));
  assert.match(rawLastAssistant(f).errorMessage, /^CONTENT_OUTPUT_INVALID/);
});

test('Pi content-output retry backoff can be cancelled without another model request', async t => {
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: 'fetch failed' }), nativeMessage(mixedWire)], { retryDelayMs: 10000 });
  const unsubscribe = f.runtime.session.subscribe(event => {
    if (event.type === 'entry_appended' && event.entry.type === 'custom' && event.entry.customType === 'bangumi/recovery' && event.entry.data.stage === 'scheduled') setTimeout(() => { void f.runtime.session.abort(); }, 25);
  });
  t.after(unsubscribe);
  await f.runtime.session.prompt('取消展示重试');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 1);
  assert.ok(f.manager.getBranch().some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery' && entry.data.stage === 'cancelled'));
});

test('Pi automatically retries transient network errors as well as content errors', async t => {
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: 'fetch failed' }), nativeMessage(mixedWire)]);
  await f.runtime.session.prompt('模拟临时网络失败');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 2);
  assert.ok(f.manager.getBranch().some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery' && entry.data.stage === 'recovered'));
  assert.equal(f.runtime.session.messages.findLast(message => message.role === 'assistant').stopReason, 'stop');
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

test('unclassified native error is terminal and retains usage', async t => {
  const f = await fixture(t, [nativeMessage('', { stopReason: 'error', errorMessage: '原生网络失败' })]);
  await f.runtime.session.prompt('模拟网络失败');
  await f.runtime.session.waitForIdle();
  assert.equal(f.scriptedCalls, 1);
  assert.deepEqual(f.calls, []);
  const last = rawLastAssistant(f);
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
    yield { type: 'text_delta', contentIndex: 0, delta: '{"content":[{"type":"text","nextType":"Callout","text":"可见草稿', partial: message };
    // 等到消费侧确实看到解码文字，避免同步脚本被预取后过早取消。
    await visible;
    yield { type: 'done', reason: 'stop', message };
  });
  const events = [];
  for await (const event of wrapped.streamSimple(faux.getModel(), context, { signal: controller.signal })) {
    events.push(structuredClone(event));
    if (event.type === 'start') { controller.abort(); release(); }
  }
  const last = events.at(-1);
  assert.equal(last.type, 'error');
  assert.equal(last.reason, 'aborted');
  assert.equal(last.error.stopReason, 'aborted');
  assert.deepEqual(last.error.content, []);
  assertNoSidecar(events);
});

test('truncation retains visible draft and partial props, never completing invalid JSON', async () => {
  const faux = makeFaux();
  const raw = '{"content":[{"type":"text","nextType":"SubjectCards","text":"候选"},{"type":"SubjectCards","pending":false,"props":{"title":"相关条目","layout":"grid","items":[';
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
  assert.deepEqual(last.error.content, [textPart('候选', 'SubjectCards')]);
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
