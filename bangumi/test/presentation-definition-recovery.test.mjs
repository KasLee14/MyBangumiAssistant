import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { createAdvancedBangumiExtension as createBangumiExtension } from './advanced-presentation-fixture.mjs';
import { createBangumiExtension as createProductionBangumiExtension } from '../dist/src/extension.js';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { PRESENTATION_TOOL_NAMES } from '../dist/src/output/presentation-contract.js';
import { fixture } from './web-fixture.mjs';

const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
const config = client => ({ authDir: tmpdir(), timeoutMs: 1000, proxy: null, client, generateSessionTitle: async () => null,
  channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} } });

test('实际生产明确名称直接load，同批取得事实，下一request原子render完成无需index/收尾', async t => {
  let upstreamReads = 0;
  const service = new BangumiMcpService({ close: async () => {}, public: async () => {
    upstreamReads++; return { id: 1, type: 2, name: '已核实作品', name_cn: '', nsfw: false, summary: '', infobox: [], tags: [], images: { large: 'https://example.invalid/cover.jpg' } };
  } });
  const f = await fixture(t, { additionalExtension: pi => createProductionBangumiExtension(config({
    call: (...args) => service.call(...args),
    readCachedResource: (ref, signal, read, selection) => service.readCachedResource(ref, read, signal, selection),
    endReadContext: turnId => service.endReadContext(turnId), close: async () => {},
  }))(pi) });
  t.after(() => service.close());
  f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, provider: { maxRetries: 0 } } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'definition-order-recovery' });
  let resourceRef;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('get_subject_details', { subject_id: 1, fields: ['id', 'name', 'subjectType', 'image'] }),
      fauxToolCall('read_component_spec', { names: ['SubjectCards'] })], { stopReason: 'toolUse' }),
    context => {
      const loaded = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'read_component_spec');
      assert.equal(JSON.parse(loaded.content[0].text).status, 'activated');
      assert.deepEqual(getCurrentTools(context.messages).filter(tool => PRESENTATION_TOOL_NAMES.includes(tool.name)).map(tool => tool.name), ['render_SubjectCards']);
      resourceRef = JSON.parse(context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'get_subject_details').content[0].text).value.resourceRef;
      assert.ok(resourceRef); assert.equal(JSON.stringify(context).includes('停止工具操作'), false);
      return call('render_SubjectCards', { resourceRef, subjectIds: [1], layout: 'grid', final: true });
    },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('order')).sessionId; await f.post('order', 'submit', { input: '查询作品1并用卡片展示' }, id); await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 2); assert.equal(upstreamReads, 1, '展示不重复已完成的业务读取');
  const entries = f.initial.session.sessionManager.buildContextEntries();
  assert.equal(entries.some(entry => entry.type === 'message' && entry.message.role === 'toolResult' && (entry.message.isError || ['read_component_index', 'prepare_component', 'present_component'].includes(entry.message.toolName))), false);
  assert.ok(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation_commit'), JSON.stringify(entries.filter(entry => entry.type === 'message' && entry.message.role === 'assistant').map(entry => ({ stopReason: entry.message.stopReason, errorMessage: entry.message.errorMessage }))));
  assert.equal(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery'), false);
  const snapshot = entries.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').at(-1).data;
  assert.equal(snapshot.status, 'completed'); assert.equal(snapshot.content[0].type, 'SubjectCards'); assert.equal(snapshot.content[0].props.items[0].name, '已核实作品');
  const answers = (await f.state('order')).items.filter(item => item.kind === 'assistant'); assert.equal(answers.length, 1);
  assert.equal(answers[0].content[0].props.items[0].image, 'https://example.invalid/cover.jpg');
});

test('index/spec连续失败共享原生纠参预算，停止时保留prefix且历史不重复', async t => {
  for (const name of ['read_component_index', 'read_component_spec']) await t.test(name, async child => {
    const f = await fixture(child, { additionalExtension: pi => createBangumiExtension(config({ call: async () => { throw Error('不访问上游'); } }))(pi) });
    f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, provider: { maxRetries: 0 } } });
    const faux = fauxProvider({ api: 'openai-completions', provider: `definition-budget-${name}` });
    const args = name === 'read_component_spec' ? { names: ['UnknownComponent'] } : { offset: -1 };
    faux.setResponses([call('present_text', { text: '已完成前缀' }), ...Array.from({ length: 10 }, () => call(name, args))]);
    f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
    const id = (await f.state('budget')).sessionId; await f.post('budget', 'submit', { input: '展示并核实定义' }, id); await f.initial.session.waitForIdle();
    assert.equal(faux.state.callCount, 3, '初始定义失败和一次纠参后停止');
    const entries = f.initial.session.sessionManager.buildContextEntries(); assert.equal(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery'), false);
    const snapshot = entries.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').at(-1).data;
    assert.equal(snapshot.status, 'error'); assert.deepEqual(snapshot.content.map(part => part.text), ['已完成前缀']);
    const state = await f.state('budget'), answers = state.items.filter(item => item.kind === 'assistant'); assert.equal(answers.length, 1); assert.deepEqual(state.liveContent, []);
    await f.post('budget', 'session', { action: 'new' }); await f.post('budget', 'session', { action: 'resume', sessionId: id });
    assert.deepEqual((await f.state('budget')).items.filter(item => item.kind === 'assistant').map(item => item.content), [answers[0].content]);
  });
});

test('展示prepare缺spec的本地错误允许补读定义再发布，不触发停止所有工具', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config({ call: async () => { throw Error('不访问上游'); } }))(pi) });
  f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, provider: { maxRetries: 0 } } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-spec-recovery' });
  const args = { component: 'Callout', tone: 'success', text: '补读定义后发布' };
  faux.setResponses([call('present_text', { text: '完成前缀' }), call('prepare_component', args),
    context => {
      assert.equal(JSON.parse(context.messages.at(-1).content[0].text).error.code, 'COMPONENT_SPEC_REQUIRED');
      assert.equal(JSON.stringify(context).includes('停止工具操作'), false); return call('read_component_index', { query: 'Callout' });
    },
    call('read_component_spec', { names: ['Callout'] }), call('prepare_component', args),
    context => call('present_component', { resourceRef: JSON.parse(context.messages.at(-1).content[0].text).resourceRef, blockIndex: 0 }), fauxAssistantMessage('完成。'),
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('prepare-spec')).sessionId; await f.post('prepare-spec', 'submit', { input: '展示结果提示' }, id); await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 7);
  const entries = f.initial.session.sessionManager.buildContextEntries(); assert.equal(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery'), false);
  const snapshot = entries.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').at(-1).data;
  assert.equal(snapshot.status, 'completed'); assert.deepEqual(snapshot.content.map(part => part.type), ['text', 'Callout', 'text']);
});
