import assert from 'node:assert/strict';
import test from 'node:test';
import { lazyStream } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { fixture, eventually } from './web-fixture.mjs';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { bindResourceResolver } from '../dist/src/output/resource-content.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';

test('部分候选页的已选封面经过真实Web SSE占位、完成与历史恢复', async t => {
  const f = await fixture(t);
  const context = anonymousContext(), read = { turnId: 'selected-web' };
  const binding = { turnId: read.turnId, accountId: null, scopeKey: 'public:sfw' };
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, facts: {
    name: `百合动画${i + 1}`, subjectType: 2, score: 8.4, tags: ['百合'],
    image: `https://example.invalid/web-${i + 1}.jpg`, url: `https://bgm.tv/subject/${i + 1}`,
  } }));
  const service = new BangumiMcpService({ close: async () => {}, public: async () => { throw Error('缓存展示不能联网'); } });
  t.after(() => service.close());
  const stage = { inputCount: 68, processedCount: 51, matchedCount: 23, excludedCount: 28, pendingCount: 0, remainingCount: 17 };
  const set = service.candidates.create({ binding, rows, sources: [], refRole: 'working', resultIds: rows.map(row => row.id),
    qualification: { ...stage, filter: { rating: { min: 8 } }, originRef: 'selected-web-source', matchedIds: rows.map(row => row.id), pendingIds: [], remainingIds: [], complete: false } });
  const ref = service.resources.put('refine_subject_candidates', {
    schemaVersion: 1, kind: 'candidate_page', entity: 'subject_candidate', candidateRef: set.ref, resultRef: set.resultRef,
    data: rows.map(row => ({ id: row.id, ...row.facts })), stage, accessContext: context,
  }, null, read.turnId, context);
  const faux = fauxProvider({ api: 'openai-completions', provider: 'selected-web' });
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: [
    { type: 'text', text: '这些成员已核实，候选池其他条目尚未处理。' },
    { type: 'SubjectCards', props: { resourceRef: ref, layout: 'grid', items: [1, 2, 3, 4, 5, 6].map(id => ({ id })) } },
  ] }))]);
  const wrapped = withProviderFetch(faux.provider);
  f.initial.session.modelRuntime.registerNativeProvider(wrapped);
  await f.initial.session.modelRuntime.setRuntimeApiKey('selected-web', 'offline-placeholder');
  await f.initial.session.setModel(faux.getModel());
  const stream = await f.stream('selected-web-tab');
  f.initial.session.agent.streamFunction = (_model, context, options) => lazyStream(faux.getModel(), async () => ({
    async *[Symbol.asyncIterator]() {
      const transcript = { ...context, messages: [
        { role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }, ...context.messages,
      ] };
      bindResourceResolver(transcript, (ref, signal, selection) => service.readCachedResource(ref, read, signal, selection));
      const seen = new Set();
      for await (const event of wrapped.streamSimple(faux.getModel(), transcript, options)) {
        yield event;
        for (const part of event.partial?.content ?? []) {
          if (part.type !== 'SubjectCards' || seen.has(part.pending)) continue;
          seen.add(part.pending);
          await eventually(() => stream.frames.some(frame => frame.type === 'state'
            && frame.state.liveContent.some(block => block.type === 'SubjectCards' && block.pending === part.pending)));
        }
      }
    },
  }));
  const sessionId = (await f.state('selected-web-tab')).sessionId;
  await f.post('selected-web-tab', 'submit', { input: '展示这六部已核实动画的封面卡片' }, sessionId);
  await f.initial.session.waitForIdle();
  const state = await f.state('selected-web-tab');
  assert.equal(state.items.some(item => item.kind === 'error'), false);
  const reply = state.items.find(item => item.kind === 'assistant');
  const cards = reply.content.find(part => part.type === 'SubjectCards');
  assert.equal(cards.pending, false); assert.equal(cards.props.layout, 'grid');
  assert.equal(cards.props.items.length, 6);
  assert.ok(cards.props.items.every(item => item.image?.startsWith('https://example.invalid/web-')));
  assert.ok(stream.frames.some(frame => frame.state?.liveContent?.some(part => part.type === 'SubjectCards' && part.pending === true)));
  assert.ok(stream.frames.some(frame => frame.state?.liveContent?.some(part => part.type === 'SubjectCards' && part.pending === false && part.props.items.every(item => item.image))));
  await f.post('selected-web-tab', 'session', { action: 'new' });
  await f.post('selected-web-tab', 'session', { action: 'resume', sessionId });
  const restored = (await f.state('selected-web-tab')).items.find(item => item.kind === 'assistant');
  assert.deepEqual(restored.content, reply.content);
});
