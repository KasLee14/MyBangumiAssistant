import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { lazyStream } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/content-schema.js';
import { fixture, eventually } from './web-fixture.mjs';

test('原生组件经实际 Web SSE 显示前后文字、false占位和true完成，end及历史无重复', async t => {
  const f = await fixture(t);
  const faux = fauxProvider({ api: 'openai-responses', provider: 'web-native-offline', tokenSize: { min: 2, max: 4 } });
  const wire = JSON.stringify({ content: [
    { type: 'text', nextType: 'callout', text: '正文前段' },
    { type: 'callout', props: { tone: 'success', text: '有效组件', detail: null } },
    { type: 'text', nextType: null, text: '正文后段' },
  ] });
  faux.setResponses([fauxAssistantMessage(wire)]);
  const source = { ...faux.provider, streamSimple: (model, context, options) => lazyStream(model, async () => ({
    async *[Symbol.asyncIterator]() {
      for await (const event of faux.provider.streamSimple(model, context, options)) {
        yield event;
        if (event.type === 'text_delta') await delay(3);
      }
    },
  })) };
  const provider = withProviderFetch(source);
  f.initial.session.agent.streamFunction = (_model, context, options) => provider.streamSimple(faux.getModel(), {
    messages: [{ role: 'system', content: '', sections: { bangumi_content_output: CONTENT_OUTPUT_INSTRUCTION }, timestamp: 1 }, ...context.messages],
  }, options);
  const stream = await f.stream('native-tab');
  const id = (await f.state('native-tab')).sessionId;
  await f.post('native-tab', 'submit', { input: '正文和组件交错' }, id);
  await eventually(() => stream.frames.some(frame => frame.type === 'state'
    && frame.state.liveContent?.some(part => part.type === 'callout' && part.pending === false)));
  await f.initial.session.waitForIdle();
  await eventually(() => stream.frames.some(frame => frame.type === 'state' && frame.items.some(item => item.kind === 'callout')));
  const state = await f.state('native-tab');
  const body = state.items.filter(item => item.kind === 'assistant' || item.kind === 'callout');
  assert.deepEqual(body.map(item => item.kind), ['assistant', 'callout', 'assistant']);
  assert.equal(body[0].text, '正文前段');
  assert.equal(body[1].callout.text, '有效组件');
  assert.equal(body[2].text, '正文后段');
  assert.equal(state.liveText, '');
  assert.equal(body.some(item => item.text?.includes('"content"')), false);
  assert.ok(stream.frames.some(frame => frame.type === 'state'
    && frame.state.liveContent?.some(part => part.type === 'callout' && part.pending === true)));
  await f.post('native-tab', 'session', { action: 'new' });
  await f.post('native-tab', 'session', { action: 'resume', sessionId: id });
  const restored = (await f.state('native-tab')).items.filter(item => item.kind === 'assistant' || item.kind === 'callout');
  assert.deepEqual(restored.map(item => item.kind), ['assistant', 'callout', 'assistant']);
  assert.equal(restored[1].callout.text, '有效组件');
});
