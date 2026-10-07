import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { validateMixedContent } from '../dist/src/output/content-schema.js';

test('未完成候选池的六个已选成员经Pi宿主展开封面，流式完成并保存可重放快照', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-selected-runtime-'));
  const subjects = Array.from({ length: 68 }, (_, i) => ({
    id: i + 1, type: 2, name: `动画${i + 1}`, name_cn: '', nsfw: false,
    platform: 'TV', date: '2020-01-01', tags: [{ name: '百合', count: 100 }], meta_tags: ['TV'],
    rating: { score: 8.4, total: 100, rank: 100 },
    images: { large: `https://example.invalid/selected-${i + 1}.jpg` },
  }));
  let runtime, selectedRef, selectedPage, receivedSelection, readsBeforeDisplay;
  const requests = [], updates = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async (path, options = {}) => {
    requests.push(path);
    assert.equal(path, '/v0/search/subjects', '所有展示事实已经召回，不能额外请求资料');
    const offset = Number(options.query?.offset ?? 0), limit = Number(options.query?.limit ?? 100);
    return { data: subjects.slice(offset, offset + limit), total: subjects.length };
  } });
  t.after(async () => {
    await runtime?.dispose(); await service.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'selected-runtime', tokenSize: { min: 1, max: 2 } });
  const modelValue = transcript => {
    const result = JSON.parse(transcript.messages.findLast(message => message.role === 'toolResult').content[0].text);
    assert.ok(result.value, JSON.stringify(result));
    return result.value;
  };
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('search_subjects', {
      keyword: '百合', subject_type: 2, limit: 68, result_mode: 'candidates',
      fields: ['id', 'name', 'subjectType', 'score', 'image'],
    })], { stopReason: 'toolUse' }),
    transcript => fauxAssistantMessage([fauxToolCall('refine_subject_candidates', {
      candidate_ref: modelValue(transcript).resultRef, filter: { rating: { min: 8 } },
      fields: ['id', 'name', 'subjectType', 'score', 'image'], limit: 6,
    })], { stopReason: 'toolUse' }),
    transcript => {
      selectedPage = modelValue(transcript); selectedRef = selectedPage.resourceRef;
      assert.ok(selectedPage.stage.remainingCount > 0);
      assert.equal(selectedPage.data.length, 6);
      readsBeforeDisplay = requests.length;
      return fauxAssistantMessage(JSON.stringify({ content: [
        { type: 'text', text: '推荐已核实的六部；候选池仍有其他成员未处理。' },
        { type: 'SubjectCards', props: { resourceRef: selectedRef, layout: 'grid', items: selectedPage.data.map(({ id }) => ({ id })) } },
      ] }));
    },
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey('selected-runtime', 'offline-placeholder');
  const manager = SessionManager.create(root, join(root, 'sessions'));
  runtime = await createBangumiRuntime({ cwd: root, agentDir: root, modelRuntime, sessionManager: manager,
    provider: 'selected-runtime', model: 'faux-1', extension: createBangumiExtension({
      authDir: join(root, 'auth'), timeoutMs: 1000, proxy: null,
      channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
      client: {
        call: (...args) => service.call(...args),
        readCachedResource: async (ref, signal, read, selection) => {
          receivedSelection = selection;
          return service.readCachedResource(ref, read, signal, selection);
        },
        endReadContext: async turnId => service.endReadContext(turnId), close: async () => {},
      },
    }),
  });
  runtime.session.subscribe(event => {
    if (event.type === 'message_update') updates.push(structuredClone(event.message));
  });
  await runtime.session.prompt('推荐六部评分八分以上的动画，用卡片展示');
  await runtime.session.waitForIdle();
  const answer = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  assert.equal(answer.stopReason, 'stop', answer.errorMessage);
  const content = answer.content.filter(part => part.type !== 'thinking');
  assert.doesNotThrow(() => validateMixedContent({ content }));
  const cards = content.find(part => part.type === 'SubjectCards');
  assert.equal(cards.pending, false); assert.equal(cards.props.layout, 'grid');
  assert.deepEqual(cards.props.items.map(({ id }) => id), [1, 2, 3, 4, 5, 6]);
  assert.ok(cards.props.items.every(item => item.image?.startsWith('https://example.invalid/selected-')));
  assert.deepEqual(receivedSelection, { subjectIds: [1, 2, 3, 4, 5, 6] });
  assert.equal(faux.state.callCount, 3, '无需恢复模型调用或重做召回');
  assert.ok(readsBeforeDisplay > 0);
  assert.equal(requests.length, readsBeforeDisplay, '缓存卡片展开不追加上游读取');
  assert.ok(updates.some(message => message?.content?.some(part => part.type === 'SubjectCards' && part.pending === true)));
  assert.ok(updates.some(message => message?.content?.some(part => part.type === 'SubjectCards' && part.pending === false && part.props.items.every(item => item.image))));
  const restored = SessionManager.open(manager.getSessionFile());
  assert.deepEqual(restored.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message.content, answer.content);
});
