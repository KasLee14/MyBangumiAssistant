import assert from 'node:assert/strict';
import test from 'node:test';
import { lazyStream, getCurrentSystemMessage } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { LEGACY_CONTENT_OUTPUT_INSTRUCTION as CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { fixture, eventually } from './web-fixture.mjs';
import { sectionsModule, providerPart, validateMessageBlock } from './frontend-content-fixture.mjs';

test('宿主SSE在恢复时更新同一回答ID，失败停止后历史仍保留完成部分', async t => {
  for (const success of [true, false]) await t.test(success ? '恢复成功' : '预算耗尽', async child => {
    const f = await fixture(child);
    const faux = fauxProvider({ api: 'openai-responses', provider: `web-recovery-${success}` });
    const card = { type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id: 1, name: '保留作品', kind: 'anime' }] } };
    const suffix = { type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id: 2, name: '新增作品', kind: 'anime' }] } };
    faux.setResponses([fauxAssistantMessage('{"content":[' + JSON.stringify(card) + ',', { stopReason: 'length' }),
      ...Array.from({ length: success ? 1 : 3 }, () => fauxAssistantMessage(JSON.stringify({ content: [success ? suffix : card] }))) ]);
    const runtime = f.initial.session.modelRuntime;
    runtime.registerNativeProvider(withProviderFetch(faux.provider)); await runtime.setRuntimeApiKey(faux.getModel().provider, 'offline-placeholder');
    await f.initial.session.setModel(faux.getModel());
    f.initial.session.settingsManager.applyOverrides({ retry: { baseDelayMs: 1, maxRetries: 2 } });
    const prepare = f.initial.session.agent.prepareRequest;
    f.initial.session.agent.prepareRequest = async (request, signal) => {
      const result = await prepare(request, signal), context = result?.context ?? request.context, messages = [...context.messages];
      const index = messages.findLastIndex(message => message.role === 'system'), system = getCurrentSystemMessage(messages);
      const instruction = { ...system, role: 'system', content: system?.content ?? '', sections: { ...system?.sections, bangumi_content_output: CONTENT_OUTPUT_INSTRUCTION }, timestamp: Date.now() };
      if (index >= 0) messages[index] = instruction; else messages.unshift(instruction);
      return { ...result, context: { ...context, messages } };
    };
    const stream = await f.stream('recovery-tab'), id = (await f.state('recovery-tab')).sessionId;
    await f.post('recovery-tab', 'submit', { input: '恢复测试' }, id); await f.initial.session.waitForIdle();
    const state = await f.state('recovery-tab'), replies = state.items.filter(item => item.kind === 'assistant');
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].content.flatMap(part => part.props?.items?.map(item => item.id) ?? []), success ? [1, 2] : [1]);
    await eventually(() => stream.frames.some(frame => frame.items?.some(item => item.id === replies[0].id)));
    const replyIds = new Set(stream.frames.flatMap(frame => frame.items?.filter(item => item.kind === 'assistant').map(item => item.id) ?? []));
    assert.equal(replyIds.size, 1);
    await f.post('recovery-tab', 'session', { action: 'new' }); await f.post('recovery-tab', 'session', { action: 'resume', sessionId: id });
    const restored = (await f.state('recovery-tab')).items.filter(item => item.kind === 'assistant');
    assert.equal(restored.length, 1); assert.deepEqual(restored[0].content, replies[0].content);
  });
});

test('结构化错误诊断经实际Web SSE和历史恢复保留，原文debug不发送浏览器', async t => {
  const f = await fixture(t); f.initial.session.setAutoRetryEnabled(false);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'web-diagnostic-offline' });
  faux.setResponses([fauxAssistantMessage('{"content":[{"type":"Callout","pending":false,"props":{"tone":"invalid","text":"模拟"}}]}')]);
  const wrapped = withProviderFetch(faux.provider);
  f.initial.session.agent.streamFunction = (_model, context, options) => wrapped.streamSimple(faux.getModel(), {
    messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }, ...context.messages],
  }, options);
  const stream = await f.stream('diagnostic-tab'), id = (await f.state('diagnostic-tab')).sessionId;
  await f.post('diagnostic-tab', 'submit', { input: '模拟组件错误' }, id); await f.initial.session.waitForIdle();
  const state = await f.state('diagnostic-tab'), error = state.items.find(item => item.kind === 'reasoning' && item.source === 'host');
  assert.match(error.text, /CONTENT_SCHEMA_INVALID/);
  assert.match(error.text, /\/content\/0\/props\/tone/);
  assert.equal(state.items.some(item => item.kind === 'error'), false);
  await eventually(() => stream.frames.some(frame => frame.items?.some(item => item.id === error.id)));
  assert.equal(JSON.stringify(state).includes('responseText'), false);
  await f.post('diagnostic-tab', 'session', { action: 'new' }); await f.post('diagnostic-tab', 'session', { action: 'resume', sessionId: id });
  const restored = (await f.state('diagnostic-tab')).items.find(item => item.kind === 'reasoning' && item.source === 'host');
  assert.equal(restored.text, error.text);
});

function webStream(provider, model, context, options, stream) {
  return lazyStream(model, async () => ({
    async *[Symbol.asyncIterator]() {
      const observed = new Set();
      for await (const event of provider.streamSimple(model, {
        messages: [{ role: 'system', content: '', sections: { bangumi_content_output: CONTENT_OUTPUT_INSTRUCTION }, timestamp: 1 }, ...context.messages],
      }, options)) {
        yield event;
        // faux 不模拟网络延迟；让占位和完成态实际经过 SSE 后再继续，避免广播合帧掩盖过渡态。
        for (const part of event.partial?.content ?? []) {
          if (part.pending === undefined) continue;
          const key = `${part.type}:${part.pending}`;
          if (observed.has(key)) continue;
          observed.add(key);
          await eventually(() => stream.frames.some(frame => frame.type === 'state'
            && frame.state.liveContent.some(block => block.type === part.type && block.pending === part.pending)));
        }
      }
    },
  }));
}

test('模型输入规范化经真实SSE更新占位，最终和历史不残留预测组件或错误', async t => {
  const f = await fixture(t);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'web-normalized' });
  const table = { type: 'DataTable', props: { columns: [{ key: 'day', label: '星期' }], rows: [{ day: '周一' }] } };
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ type: 'json_object', content: [
    { type: 'text', text: '前言', nextType: 'StatsCard' }, table, { type: 'text', text: '结语', nextType: 'Gallery' },
  ] }))]);
  const provider = withProviderFetch(faux.provider);
  f.initial.session.agent.streamFunction = (_model, context, options) => webStream(provider, faux.getModel(), context, options, stream);
  const stream = await f.stream('normalized'); const id = (await f.state('normalized')).sessionId;
  await f.post('normalized', 'submit', { input: '周历规范化' }, id); await f.initial.session.waitForIdle();
  const state = await f.state('normalized'), answer = state.items.find(item => item.kind === 'assistant');
  assert.deepEqual(answer.content, [{ type: 'text', text: '前言' }, { ...table, pending: false }, { type: 'text', text: '结语' }]);
  assert.equal(state.items.some(item => item.kind === 'error'), false); assert.equal(faux.state.callCount, 1);
  assert.equal(stream.frames.some(frame => frame.state?.liveContent?.some(part => part.type === 'DataTable' && part.pending === true)), false);
  await f.post('normalized', 'session', { action: 'new' }); await f.post('normalized', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual((await f.state('normalized')).items.find(item => item.kind === 'assistant').content, answer.content);
});

test('原生组件经实际 Web SSE 保留前后文字、true占位和false完成，end及历史无重复', async t => {
  const f = await fixture(t);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'web-native-offline', tokenSize: { min: 2, max: 4 } });
  const wire = JSON.stringify({ content: [
    { type: 'text', nextType: 'Callout', text: '正文前段' },
    { type: 'Callout', pending: false, props: { tone: 'success', text: '有效组件' } },
    { type: 'text', nextType: null, text: '正文后段' },
  ] });
  faux.setResponses([fauxAssistantMessage(wire)]);
  const provider = withProviderFetch(faux.provider);
  f.initial.session.agent.streamFunction = (_model, context, options) => webStream(provider, faux.getModel(), context, options, stream);
  const stream = await f.stream('native-tab');
  const id = (await f.state('native-tab')).sessionId;
  await f.post('native-tab', 'submit', { input: '正文和组件交错' }, id);
  await eventually(() => stream.frames.some(frame => frame.type === 'state'
    && frame.state.liveContent?.some(part => part.type === 'Callout' && part.pending === false)));
  await f.initial.session.waitForIdle();
  await eventually(() => stream.frames.some(frame => frame.type === 'state'
    && frame.items.some(item => item.kind === 'assistant' && item.content.some(part => part.type === 'Callout'))));
  const state = await f.state('native-tab');
  const body = state.items.filter(item => item.kind === 'assistant');
  assert.equal(body.length, 1);
  const expected = [
    { type: 'text', text: '正文前段' },
    { type: 'Callout', pending: false, props: { tone: 'success', text: '有效组件' } },
    { type: 'text', text: '正文后段' },
  ];
  assert.deepEqual(body[0].content, expected);
  assert.deepEqual(state.liveContent, []);
  assert.equal(body[0].content.some(part => part.type === 'text' && part.text.includes('"content"')), false);
  assert.equal(stream.frames.some(frame => frame.type === 'state'
    && frame.state.liveContent?.some(part => part.type === 'Callout' && part.pending === true)), false);
  await f.post('native-tab', 'session', { action: 'new' });
  await f.post('native-tab', 'session', { action: 'resume', sessionId: id });
  const restored = (await f.state('native-tab')).items.filter(item => item.kind === 'assistant');
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].content, expected);
});

test('全部12种前端样例经 Provider 解码、Web SSE 和历史回放可被前端校验器直接识别', async t => {
  const f = await fixture(t);
  const components = sectionsModule.LIBRARY_SECTIONS.map(section => ({ type: section.kind, pending: false, props: section.payload }));
  const faux = fauxProvider({ api: 'openai-responses', provider: 'web-all-components-offline' });
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: components.map(providerPart) }))]);
  const provider = withProviderFetch(faux.provider);
  f.initial.session.agent.streamFunction = (_model, context, options) => webStream(provider, faux.getModel(), context, options, stream);
  const stream = await f.stream('all-components');
  const id = (await f.state('all-components')).sessionId;
  await f.post('all-components', 'submit', { input: '展示全部组件' }, id);
  await f.initial.session.waitForIdle();
  await eventually(() => stream.frames.some(frame => frame.type === 'state'
    && frame.items.some(item => item.kind === 'assistant' && item.content.length === 12)));
  const assertComponents = state => {
    const items = state.items.filter(item => item.kind === 'assistant');
    assert.equal(items.length, 1);
    const blocks = items[0].content;
    assert.deepEqual(blocks.map(block => block.type), components.map(part => part.type));
    for (const block of blocks) {
      assert.equal(block.pending, false);
      assert.equal(validateMessageBlock(block).status, 'ok', block.type);
    }
    assert.ok(Array.isArray(blocks.find(block => block.type === 'TagCloud').props));
    assert.ok(blocks.find(block => block.type === 'DataTable').props.rows.every(row => !Array.isArray(row)));
    return blocks;
  };
  const expected = assertComponents(await f.state('all-components'));
  for (const part of components) {
    assert.equal(stream.frames.some(frame => frame.type === 'state'
      && frame.state.liveContent.some(block => block.type === part.type && block.pending === true)), false, part.type);
  }
  await f.post('all-components', 'session', { action: 'new' });
  await f.post('all-components', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual(assertComponents(await f.state('all-components')), expected);
});
