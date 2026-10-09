import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { PresentationStore } from '../dist/src/output/presentation-store.js';
import { ReplyAssembler, bindReplyAssembler } from '../dist/src/output/reply-assembler.js';
import { createPresentationTools } from '../dist/src/output/presentation-tools.js';
import { ComponentCatalogState } from '../dist/src/output/component-catalog.js';
import { COMPONENT_KINDS, validateMixedContent } from '../dist/src/output/content-schema.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { withContentConstraint } from '../dist/src/output/provider-options.js';
import { extensionComponentCatalog, extensionReplyAssembler, extensionResourceResolver } from '../dist/src/extension.js';
import { createAdvancedBangumiExtension as createBangumiExtension } from './advanced-presentation-fixture.mjs';
import { bindPresentationHistory, projectTranscriptForModel } from '../dist/src/output/model-context.js';
import { presentationPrepareSchema, PREPARE_COMPONENT_SCHEMA } from '../dist/src/output/presentation-contract.js';
import { resourceReferenceSchema, normalizeResourceReference } from '../dist/src/output/resource-content.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { setToolCallArgumentSource } from '@earendil-works/pi-ai';
import { runToolCall } from '@earendil-works/pi-agent-core';
import { fixture, eventually } from './web-fixture.mjs';

const subject = { entity: 'subject', id: 1, name: '作品', subjectType: 2, score: 8.2, image: 'https://example.invalid/cover.jpg',
  url: 'https://bgm.tv/subject/1', tags: ['日常'], ratingDistribution: { 9: 42 }, infobox: [{ key: '原作', value: '作者' }] };
const ref = 'rr_facts';
const single = value => async () => ({ resourceRef: ref, sourceTool: 'get_subject_details', value });

test('prepare成员上限派生引用契约：边界合法且越限在任何缓存读取前拒绝', async () => {
  const kinds = ['SubjectCards', 'InfoBox', 'StatsCard', 'Gallery', 'LinkList', 'ProgressView', 'Timeline', 'DataTable', 'TagCloud'];
  let cacheReads = 0;
  const store = new PresentationStore(async resourceRef => { cacheReads++; return { resourceRef, sourceTool: 'get_subject_details', value: subject }; }); store.begin();
  for (const kind of kinds) {
    const schema = presentationPrepareSchema(kind), maximum = resourceReferenceSchema(kind).properties.items.maxItems;
    assert.equal(schema.properties.subjectIds.maxItems, maximum, kind);
    const subjectIds = Array.from({ length: maximum }, (_, index) => index + 1), args = { component: kind, resourceRef: ref, subjectIds };
    assert.doesNotThrow(() => schemaArguments(schema, args), `${kind}准备边界`);
    assert.doesNotThrow(() => schemaArguments(PREPARE_COMPONENT_SCHEMA, args), `${kind}完整工具边界`);
    assert.doesNotThrow(() => normalizeResourceReference({ resourceRef: ref, items: subjectIds.map(subjectId => ({ subjectId })) }, false, kind), `${kind}引用边界`);
    const oversized = { ...args, subjectIds: [...subjectIds, maximum + 1] };
    assert.throws(() => schemaArguments(schema, oversized), error => error.issues.some(issue => issue.path === '/subjectIds' && issue.rule === 'maxItems'));
    await assert.rejects(store.prepare(oversized), error => error.issues.some(issue => issue.path === '/subjectIds' && issue.rule === 'maxItems'));
    assert.equal(cacheReads, 0, `${kind}越限不得读取缓存`);
  }
  for (const kind of ['InfoBox', 'StatsCard']) assert.equal(presentationPrepareSchema(kind).properties.subjectIds.maxItems, 1);
});

test('全部12组件从各自最简准备参数构建完整块，再由发布工具进入唯一正文', async () => {
  const inputs = {
    SubjectCards: [{ ...subject }, { subjectIds: [1] }],
    Gallery: [{ entity: 'person', id: 2, name: '人物', image: subject.image }, { members: [{ personId: 2 }] }],
    LinkList: [subject, {}], DataTable: [subject, { columns: [{ key: 'name', label: '作品名' }, { key: 'score', label: '评分' }] }],
    InfoBox: [subject, {}], TagCloud: [subject, {}], StatsCard: [subject, {}],
    ProgressView: [{ data: [{ episode: { entity: 'episode', id: 3, sort: 1 }, episodeStatus: 2 }] }, { members: [{ episodeId: 3 }] }],
    Timeline: [{ data: [{ createdAt: '2026-10-08', title: '事件', username: '用户' }] }, {}],
    CompareTable: [{ before: { name: '之前' }, after: { name: '之后' } }, { fields: ['name'] }],
    QuoteBlock: [null, { text: '引用', mono: false }], Callout: [null, { text: '完成', tone: 'success' }],
  };
  const snapshots = [], assembler = new ReplyAssembler(value => snapshots.push(value)); assembler.begin('all-components');
  for (const kind of COMPONENT_KINDS) {
    const [value, options] = inputs[kind], store = new PresentationStore(single(value)); store.begin();
    const catalog = new ComponentCatalogState(); catalog.readIndex({ limit: 12 }); catalog.readPrepareSpecs([kind]);
    const tools = Object.fromEntries(createPresentationTools(store, assembler, catalog).map(tool => [tool.name, tool]));
    const prepared = await tools.prepare_component.execute(`prepare-${kind}`, { component: kind, ...(value ? { resourceRef: ref } : {}), ...options });
    assert.equal(prepared.isError, undefined, JSON.stringify(prepared.details));
    assert.deepEqual(prepared.details.blocks.map(block => [block.blockIndex, block.type]), [[0, kind]]);
    const args = { resourceRef: prepared.details.resourceRef, blockIndex: 0 };
    const published = await tools.present_component.execute(`present-${kind}`, args);
    assert.equal(published.isError, undefined, JSON.stringify(published.details));
    assert.equal(assembler.snapshot().content.at(-1).type, kind);
    assert.equal(assembler.snapshot().content.at(-1).pending, false);
    const retry = await tools.present_component.execute(`retry-${kind}`, args);
    assert.equal(retry.details.reused, true);
  }
  assembler.finish();
  assert.deepEqual(assembler.snapshot().content.map(block => block.type), COMPONENT_KINDS);
  validateMixedContent({ content: assembler.snapshot().content });
  assert.equal(snapshots.at(-1).status, 'completed');
});

test('成员顺序、绝对快照下标、失败不改前缀和重准备幂等', async () => {
  const data = { entity: 'subject', data: [{ ...subject, id: 1 }, { ...subject, id: 2, name: '二' }] };
  const store = new PresentationStore(single(data)); store.begin();
  const prepared = await store.prepare({ component: 'SubjectCards', resourceRef: ref, subjectIds: [2, 1] });
  const part = await store.block(prepared.resourceRef, 0);
  assert.deepEqual(part.props.items.map(item => item.id), [2, 1]);
  const assembler = new ReplyAssembler(() => {}); assembler.begin('order');
  const text = { type: 'text', text: '前言', nextType: null };
  assembler.append(text, 'text'); assembler.append(part, 'first', `component:${prepared.resourceRef}:0`);
  assert.deepEqual(assembler.append(text, 'text-retry'), { replyId: assembler.snapshot().replyId, blockIndex: 0, reused: true });
  assert.equal(assembler.append(assembler.snapshot().content[0], 'text').blockIndex, 0);
  const second = await store.prepare({ component: 'SubjectCards', resourceRef: ref, subjectIds: [2, 1] });
  assert.equal(assembler.append(await store.block(second.resourceRef, 0), 'second', `component:${second.resourceRef}:0`).reused, true);
  await assert.rejects(store.prepare({ component: 'SubjectCards', resourceRef: ref, subjectIds: [999] }));
  await assert.rejects(store.prepare({ component: 'Gallery', resourceRef: ref, subjectIds: [1], members: [{ id: 2 }] }), error => error.code === 'INVALID_INPUT');
  assert.equal(assembler.snapshot().content.length, 2);
  const snapshotRef = 'rr_snapshot', cards = [part, { type: 'Callout', pending: false, props: { tone: 'success', text: '夹在中间' } }, { ...part, props: { ...part.props, title: '第三块' } }];
  const preparedStore = new PresentationStore(async resourceRef => ({ resourceRef, sourceTool: 'prepare_candidate_output', value: { presentation: { content: cards } } })); preparedStore.begin();
  assert.equal((await preparedStore.block(snapshotRef, 2)).props.title, '第三块');
  assert.equal((await preparedStore.block(snapshotRef, 1)).type, 'Callout');
  await assert.rejects(preparedStore.block(snapshotRef, 3));
});

test('取消、新用户轮、账户/NSFW范围和事实版本变化使准备不可发布', async () => {
  let value = subject, denied = false;
  const store = new PresentationStore(async resourceRef => { if (denied) throw Object.assign(new Error('范围改变'), { code: 'RESOURCE_SCOPE_MISMATCH' }); return { resourceRef, sourceTool: 'get_subject_details', value }; }); store.begin();
  const prepared = await store.prepare({ component: 'SubjectCards', resourceRef: ref, subjectIds: [1] });
  value = { ...subject, score: 9 }; await assert.rejects(store.block(prepared.resourceRef, 0), error => error.code === 'RESOURCE_VERSION_CHANGED');
  value = subject; denied = true; await assert.rejects(store.block(prepared.resourceRef, 0)); denied = false;
  await assert.rejects(store.block(prepared.resourceRef, 0, AbortSignal.abort()));
  store.begin(); await assert.rejects(store.block(prepared.resourceRef, 0));
  const assembler = new ReplyAssembler(() => {}); assembler.begin('cancel'); assembler.append({ type: 'text', text: '完成前缀', nextType: null }, 'one'); assembler.finish('aborted');
  assert.throws(() => assembler.append({ type: 'text', text: '旧输出', nextType: null }, 'two'));
  assert.equal(assembler.snapshot().content[0].text, '完成前缀');
});

test('新生成请求保留原生工具/思考配置，不强制全正文JSON', async () => {
  const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }] };
  for (const api of ['openai-completions', 'openai-responses']) {
    const model = { api, id: 'test', provider: 'test', baseUrl: 'https://example.invalid' };
    const payload = { tools: [{ name: 'prepare_component' }], reasoning: { effort: 'high' } };
    assert.deepEqual(await withContentConstraint(model, context, {}).onPayload(payload, model), payload);
  }
});

test('真实Pi工具回合发布与原生文字经Web SSE进入一个回答，持久化回放完全一致', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null,
    client: { call: async () => { throw Error('此测试不访问业务上游'); } }, generateSessionTitle: async () => null,
    channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
  })(pi) });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-live' });
  const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
  faux.setResponses([
    call('read_component_index', { query: 'Callout' }), call('read_component_spec', { names: ['Callout'] }),
    call('present_text', { text: '前言' }), call('prepare_component', { component: 'Callout', tone: 'success', text: '已完成组件' }),
    context => { const result = JSON.parse(context.messages.at(-1).content[0].text); return call('present_component', { resourceRef: result.resourceRef, blockIndex: 0 }); },
    async () => {
      await eventually(() => stream.frames.some(frame => frame.state?.liveContent?.some(part => part.type === 'Callout')));
      const open = await f.state('presentation');
      assert.equal(open.items.filter(item => item.kind === 'assistant').length, 0);
      assert.deepEqual(open.liveContent.map(part => part.type), ['text', 'Callout']);
      return fauxAssistantMessage('结语');
    },
  ]);
  const runtime = f.initial.session.modelRuntime; runtime.registerNativeProvider(withProviderFetch(faux.provider)); await runtime.setRuntimeApiKey('presentation-live', 'offline'); await f.initial.session.setModel(faux.getModel());
  const stream = await f.stream('presentation'), id = (await f.state('presentation')).sessionId;
  await f.post('presentation', 'submit', { input: '展示提示' }, id); await f.initial.session.waitForIdle();
  const state = await f.state('presentation'), answers = state.items.filter(item => item.kind === 'assistant');
  assert.deepEqual(state.liveContent, []);
  assert.equal(answers.length, 1, JSON.stringify(state.items));
  assert.deepEqual(answers[0].content, [{ type: 'text', text: '前言' }, { type: 'Callout', pending: false, props: { tone: 'success', text: '已完成组件' } }, { type: 'text', text: '结语' }]);
  await eventually(() => stream.frames.some(frame => frame.items?.some(item => item.id === answers[0].id && item.content?.length === 3)));
  assert.equal(new Set(stream.frames.flatMap(frame => frame.items?.filter(item => item.kind === 'assistant').map(item => item.id) ?? [])).size, 1);
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
  assert.equal(snapshots.at(-1).data.status, 'completed'); assert.equal(snapshots.at(-1).data.content.length, 3);
  await f.post('presentation', 'session', { action: 'new' }); await f.post('presentation', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual((await f.state('presentation')).items.filter(item => item.kind === 'assistant').map(item => item.content), [answers[0].content]);
});

test('真实取消保留open完成前缀并落aborted快照，回放与终态正文一致', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null,
    client: { call: async () => { throw Error('不联网'); } }, generateSessionTitle: async () => null,
    channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
  })(pi) });
  let waiting = false;
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-cancel' });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('present_text', { text: '已发布前缀' })], { stopReason: 'toolUse' }),
    async (_context, options) => { waiting = true; await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return fauxAssistantMessage('', { stopReason: 'aborted' }); },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey('presentation-cancel', 'offline'); await f.initial.session.setModel(faux.getModel());
  const stream = await f.stream('cancel'), id = (await f.state('cancel')).sessionId; await f.post('cancel', 'submit', { input: '取消测试' }, id);
  await eventually(() => waiting && stream.frames.some(frame => frame.state?.liveContent?.[0]?.text === '已发布前缀'));
  await f.initial.session.abort(); await f.initial.session.waitForIdle();
  const state = await f.state('cancel'), answers = state.items.filter(item => item.kind === 'assistant');
  assert.equal(answers.length, 1); assert.deepEqual(answers[0].content, [{ type: 'text', text: '已发布前缀' }]); assert.deepEqual(state.liveContent, []);
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation'); assert.equal(snapshots.at(-1).data.status, 'aborted');
  await f.post('cancel', 'session', { action: 'new' }); await f.post('cancel', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual((await f.state('cancel')).items.filter(item => item.kind === 'assistant').map(item => item.content), [answers[0].content]);
});

test('真实Pi length和空正文不能把已完成前缀标成completed，工具回合原生过程不进正文', async t => {
  for (const stopReason of ['length', 'stop', 'aborted']) await t.test(stopReason === 'length' ? '长度截断' : stopReason === 'aborted' ? '首块之前取消' : '空正文', async child => {
    const f = await fixture(child, { additionalExtension: pi => createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null,
      client: { call: async () => { throw Error('不联网'); } }, generateSessionTitle: async () => null,
      channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
    })(pi) });
    const faux = fauxProvider({ api: 'openai-completions', provider: `presentation-terminal-${stopReason}` });
    faux.setResponses(stopReason === 'length' ? [
      fauxAssistantMessage([{ type: 'text', text: '过程草稿' }, fauxToolCall('present_text', { text: '已完成前缀' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('被截断的原生文字', { stopReason: 'length' }),
    ] : [fauxAssistantMessage('', { stopReason })]);
    f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
    const id = (await f.state('terminal')).sessionId; await f.post('terminal', 'submit', { input: '终止测试' }, id); await f.initial.session.waitForIdle();
    const entries = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
    assert.equal(entries.at(-1).data.status, stopReason === 'aborted' ? 'aborted' : 'error');
    assert.deepEqual(entries.at(-1).data.content.map(part => part.text), stopReason === 'length' ? ['已完成前缀'] : []);
    const answers = (await f.state('terminal')).items.filter(item => item.kind === 'assistant');
    assert.deepEqual(answers.map(item => item.content), stopReason === 'length' ? [[{ type: 'text', text: '已完成前缀' }]] : []);
  });
});

test('准备容量有界且完整大小在prepare阶段拒绝；恢复预算使用宿主注入值', async () => {
  const store = new PresentationStore(single(subject)); store.begin();
  for (let i = 0; i < 64; i++) await store.prepare({ component: 'Callout', tone: 'success', text: `块${i}` });
  await assert.rejects(store.prepare({ component: 'Callout', tone: 'success', text: '超限' }), error => error.code === 'PRESENTATION_LIMIT');
  store.begin(); await assert.rejects(store.prepare({ component: 'QuoteBlock', text: '大'.repeat(65536), mono: false }));
  const assembler = new ReplyAssembler(() => {}); let remaining = 2; assembler.setRecoveryBudget(() => remaining); assembler.begin('budget');
  assembler.fail('prepare_component'); assert.equal(assembler.recoveryExhausted, false);
  remaining = 0; assert.equal(assembler.recoveryExhausted, true);
  assembler.begin('new-user'); assert.equal(assembler.recoveryExhausted, false);
});

test('真实prepare→异步beforeToolCall→execute之间换轮，三展示工具均不能污染新回答', async () => {
  for (const name of ['prepare_component', 'present_component', 'present_text']) {
    const assembler = new ReplyAssembler(() => {}); assembler.begin('old');
    const store = new PresentationStore(single(subject)); store.begin();
    const catalog = new ComponentCatalogState(); catalog.readIndex({ limit: 12 }); catalog.readPrepareSpecs(['QuoteBlock']);
    const prepared = await store.prepare({ component: 'QuoteBlock', text: '旧引用', mono: false });
    const args = name === 'prepare_component' ? { component: 'QuoteBlock', text: '旧文字', mono: false }
      : name === 'present_component' ? { resourceRef: prepared.resourceRef, blockIndex: 0 } : { text: '旧文字' };
    const toolCall = fauxToolCall(name, args, { id: `owner-${name}` });
    setToolCallArgumentSource(toolCall, { raw: JSON.stringify(args), state: 'complete', source: 'terminal_response' });
    const assistantMessage = assembler.mark(fauxAssistantMessage([toolCall], { stopReason: 'toolUse' }));
    const outcome = await runToolCall(toolCall, { tools: createPresentationTools(store, assembler, catalog), assistantMessage, context: { messages: [], tools: [] },
      beforeToolCall: async () => { assembler.begin('new'); store.begin(); },
    });
    assert.equal(outcome.isError, true, name); assert.equal(outcome.result.details.error.code, 'RESOURCE_SCOPE_MISMATCH');
    assert.equal(assembler.snapshot().turnId, 'new'); assert.deepEqual(assembler.snapshot().content, []);
  }
});

test('原生最终文字追加超总容量保持presentation标记及error终态，不重写16块前缀', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null,
    client: { call: async () => { throw Error('不联网'); } }, generateSessionTitle: async () => null,
    channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
  })(pi) });
  f.initial.session.setAutoRetryEnabled(false);
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-overflow' });
  faux.setResponses([...Array.from({ length: 16 }, (_, index) => fauxAssistantMessage([fauxToolCall('present_text', { text: `完成块${index}` })], { stopReason: 'toolUse' })), fauxAssistantMessage('超出容量的尾文')]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey('presentation-overflow', 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('overflow')).sessionId; await f.post('overflow', 'submit', { input: '容量测试' }, id); await f.initial.session.waitForIdle();
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
  assert.equal(snapshots.at(-1).data.status, 'error'); assert.equal(snapshots.at(-1).data.content.length, 16);
  const state = await f.state('overflow'), answers = state.items.filter(item => item.kind === 'assistant'); assert.equal(answers.length, 1); assert.equal(answers[0].content.length, 16); assert.deepEqual(state.liveContent, []);
  const final = f.initial.session.sessionManager.buildContextEntries().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  assert.equal(final.stopReason, 'error'); assert.ok(final.diagnostics.some(value => value.type === 'bangumi_presentation_source'));
});

test('终态身份投影只关联实际可见末条source，不导入压缩遗失历史且保持签名/工具顺序', () => {
  const snapshot = { version: 1, replyId: 'reply', turnId: 'turn', status: 'completed', content: [{ type: 'Gallery', pending: false, props: { items: [
    { id: 2, name: '乙', image: subject.image, url: subject.url }, { id: 1, name: '甲', subtitle: '完整缓存事实' },
  ] } }] };
  const marker = { type: 'bangumi_presentation_source', details: { replyId: 'reply', turnId: 'turn' } };
  const thinking = { type: 'thinking', thinking: '原生思考', thinkingSignature: 'original-signature' };
  const call = { type: 'toolCall', id: 'one', name: 'present_component', arguments: { resourceRef: 'rr_snapshot', blockIndex: 0 } };
  const model = { api: 'openai-completions', provider: 'test', id: 'test', name: 'test', baseUrl: 'https://example.invalid', reasoning: false,
    input: ['text'], contextWindow: 4096, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const native = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } }, diagnostics: [marker] };
  const context = { messages: [{ ...native, timestamp: 1, stopReason: 'toolUse', content: [thinking, call] },
    { role: 'toolResult', toolCallId: 'one', toolName: 'present_component', timestamp: 2, isError: false, content: [{ type: 'text', text: '{"replyId":"reply","blockIndex":0,"reused":false}' }] },
    { ...native, timestamp: 3, stopReason: 'stop', content: [{ type: 'text', text: '已展示', textSignature: 'text-signature' }] }] };
  const sourceOptions = { sourceMessages: context.messages.filter(message => message.role === 'assistant'), sourceTranscript: context.messages,
    model,
    toolRoles: new Map([['present_component', 'presentation']]) };
  bindPresentationHistory(context, [snapshot], sourceOptions);
  const projected = projectTranscriptForModel(context);
  assert.deepEqual(projected.messages[0].content.slice(0, 2), [thinking, call]);
  assert.equal(projected.messages[0].content[1].arguments.resourceRef, 'rr_snapshot');
  assert.ok(projected.messages[0].content.some(part => part.type === 'text' && part.text.includes('当前请求未验证可复用')));
  assert.equal(projected.messages[1].toolCallId, 'one'); assert.equal(projected.messages[2].content[0].textSignature, 'text-signature');
  assert.match(projected.messages[2].content[1].text, /"id":2,"name":"乙".*"id":1,"name":"甲"/);
  assert.equal(JSON.stringify(projected).includes(subject.image), false); assert.equal(JSON.stringify(projected).includes('完整缓存事实'), true);
  assert.equal(context.messages[2].content.length, 1);
  const compacted = { messages: [{ role: 'user', content: '压缩后追问' }] }; bindPresentationHistory(compacted, [snapshot], sourceOptions);
  assert.deepEqual(projectTranscriptForModel(compacted), compacted);
});

test('真实第二用户回合仅凭canonical展示身份理解追问，工具回执只含引用和数量', async t => {
  const snapshotRef = 'rr_identity_snapshot'; let refOwner;
  const display = { type: 'Gallery', pending: false, props: { items: [
    { id: 2, name: '乙人物', image: 'https://example.invalid/private-image.jpg', url: 'https://example.invalid/private-url' },
    { id: 1, name: '甲人物', image: 'https://example.invalid/private-image-2.jpg' },
  ] } };
  const f = await fixture(t, { additionalExtension: pi => {
    createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null,
      client: { call: async () => { throw Error('不联网'); } }, generateSessionTitle: async () => null,
      channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
    })(pi);
    const assembler = extensionReplyAssembler(pi), catalog = extensionComponentCatalog(pi), resolver = extensionResourceResolver(pi);
    const oldCurrent = resolver.isCurrent; resolver.isCurrent = ref => ref === snapshotRef && refOwner === assembler.snapshot()?.turnId || oldCurrent(ref);
    const store = new PresentationStore(async ref => {
      assert.equal(refOwner, assembler.snapshot().turnId);
      return { resourceRef: ref, sourceTool: 'prepared_snapshot_source', value: { presentation: { content: [display] } } };
    });
    pi.on('input', event => { if (event.source !== 'extension') store.begin(); });
    pi.registerTool(createPresentationTools(store, assembler, catalog).find(tool => tool.name === 'present_component'));
    pi.registerTool({ name: 'prepared_snapshot_source', label: '准备身份快照', description: '离线已准备资源，只向模型返回引用和数量', parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => { refOwner = assembler.snapshot().turnId; const value = { resourceRef: snapshotRef, blocks: [{ blockIndex: 0, type: 'Gallery', itemCount: 2 }] }; return { content: [{ type: 'text', text: JSON.stringify(value) }], details: value }; },
    });
  } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-followup' }); let followupInput;
  const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
  faux.setResponses([call('read_component_index', { query: 'Gallery' }), call('read_component_spec', { names: ['Gallery'] }), call('prepared_snapshot_source', {}),
    context => call('present_component', { resourceRef: JSON.parse(context.messages.at(-1).content[0].text).resourceRef, blockIndex: 0 }), fauxAssistantMessage('已展示两位。'),
    context => {
      followupInput = JSON.stringify(context);
      const summary = context.messages.flatMap(message => message.role === 'assistant' ? message.content : []).find(part => part.type === 'text' && part.text.startsWith('历史已展示回答摘要'));
      const parts = JSON.parse(summary.text.slice(summary.text.indexOf('：') + 1));
      return fauxAssistantMessage(`顺序为${parts.find(part => part.type === 'Gallery').props.items.map(item => item.name).join('、')}。`);
    },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey('presentation-followup', 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('identity')).sessionId; await f.post('identity', 'submit', { input: '展示这份已准备的人物快照' }, id); await f.initial.session.waitForIdle();
  const rawMessages = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'message');
  assert.equal(JSON.stringify(rawMessages).includes('乙人物'), false);
  const firstAnswer = (await f.state('identity')).items.filter(item => item.kind === 'assistant').at(-1);
  assert.deepEqual(firstAnswer.content[0], display, '第一轮必须真实发布完整Gallery，不能用追问伪造展示历史');
  await f.post('identity', 'submit', { input: '刚才这两位按展示顺序叫什么？' }, id); await f.initial.session.waitForIdle();
  assert.ok(followupInput.includes('乙人物')); assert.ok(followupInput.indexOf('乙人物') < followupInput.indexOf('甲人物')); assert.equal(followupInput.includes('private-image'), false); assert.equal(followupInput.includes('private-url'), false);
  const history = JSON.parse(followupInput);
  const preparationCall = history.messages.flatMap(message => message.role === 'assistant' ? message.content : []).find(part => part.type === 'toolCall' && part.name === 'prepared_snapshot_source');
  const preparationResult = history.messages.find(message => message.role === 'toolResult' && message.toolCallId === preparationCall.id);
  assert.equal(preparationResult.toolName, 'prepared_snapshot_source');
  assert.equal(JSON.parse(preparationResult.content[0].text).resourceRef, snapshotRef, '原业务准备回执的历史身份必须保真');
  assert.ok(followupInput.includes('当前请求未验证可复用'));
  assert.equal(history.messages.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'toolCall' && part.name === 'present_component')), false, '已成功发布的纯展示调用不再重复进入追问');
  const answer = (await f.state('identity')).items.filter(item => item.kind === 'assistant').at(-1);
  assert.equal(answer.content[0].text, '顺序为乙人物、甲人物。');
});
