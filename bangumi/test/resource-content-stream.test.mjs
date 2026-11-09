import assert from 'node:assert/strict';
import test from 'node:test';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { normalizeContext } from '@earendil-works/pi-ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { withProviderFetch, createBangumiRuntime } from '../dist/src/pi-host.js';
import { createLegacyBangumiExtension as createBangumiExtension } from './legacy-provider-fixture.mjs';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { bindResourceResolver, expandResourceContent } from '../dist/src/output/resource-content.js';
import { LEGACY_CONTENT_OUTPUT_INSTRUCTION as CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { outputCheckpoint } from '../dist/src/output/recovery-checkpoint.js';
import { projectTranscriptForModel } from '../dist/src/output/model-context.js';

const ref = 'rr_stream_test';
const subject = { entity: 'subject', id: 1, name: '作品', subjectType: 2, image: 'https://example.invalid/1.jpg', summary: '只留缓存的简介', url: 'https://bgm.tv/subject/1', tags: ['日常'], ratingDistribution: { 10: 12, 9: 20 }, infobox: [{ key: '原作', value: '作者' }] };
const resource = value => ({ resourceRef: ref, sourceTool: 'get_subject_details', value });
const context = () => ({ messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }] });

test('引用输入任意二分、逐字符及字段乱序一致，解码器不会自行完成引用组件', () => {
  const wire = JSON.stringify({ content: [{ type: 'SubjectCards', props: { items: [{ id: 1 }], layout: 'grid', resourceRef: ref } }] });
  for (const chunks of [wire.split(''), ...Array.from({ length: wire.length + 1 }, (_, split) => [wire.slice(0, split), wire.slice(split)])]) {
    const decoder = new ContentDecoder(); chunks.forEach(chunk => decoder.feed(chunk));
    assert.equal(decoder.finish().content[0].pending, true);
    assert.deepEqual(decoder.resourceReferences(), [[0, { kind: 'SubjectCards', props: { items: [{ id: 1 }], layout: 'grid', resourceRef: ref } }]]);
  }
});

for (const api of ['openai-responses', 'openai-completions']) test(`${api}真正provider边界先pending后缓存展开完成，正文思考及成员顺序不丢失`, async () => {
  const faux = fauxProvider({ api, provider: `resource-stream-${api}`, tokenSize: { min: 1, max: 2 } });
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: [{ type: 'text', text: '选择理由' }, { type: 'SubjectCards', props: { resourceRef: ref, items: [{ id: 1 }] } }] }))]);
  const transcript = context(); let reads = 0;
  bindResourceResolver(transcript, async () => { reads++; return resource(subject); });
  const events = [];
  for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), transcript, {})) events.push(structuredClone(event));
  assert.equal(reads, 1); assert.equal(events.at(-1).type, 'done');
  const answer = events.at(-1).message.content;
  assert.equal(answer[0].text, '选择理由'); assert.equal(answer[0].nextType, 'SubjectCards');
  assert.equal(answer[1].pending, false); assert.equal(answer[1].props.items[0].image, subject.image);
  assert.equal(events.some(event => event.partial?.content.some(part => part.type === 'SubjectCards' && part.pending === true)), false);
  assert.ok(events.some(event => event.partial?.content.some(part => part.type === 'SubjectCards' && part.pending === false)));
  assert.equal(JSON.stringify(answer).includes(ref), false);
});

test('资源展开失败不发布完成态，已完成展开前缀以canonical快照用于恢复', async () => {
  const faux = fauxProvider({ api: 'openai-responses', provider: 'resource-recovery', tokenSize: { min: 1, max: 2 } });
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: [
    { type: 'SubjectCards', props: { resourceRef: ref, items: [{ id: 1 }] } },
    { type: 'SubjectCards', props: { resourceRef: ref, items: [{ id: 999 }] } },
  ] }))]);
  const transcript = context(); bindResourceResolver(transcript, async () => resource(subject));
  let terminal;
  for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), transcript, {})) terminal = event;
  assert.equal(terminal.type, 'error'); const checkpoint = outputCheckpoint(terminal.error);
  assert.equal(checkpoint.prefix.length, 1); assert.equal(checkpoint.prefix[0].props.items[0].summary, subject.summary);
  assert.deepEqual(checkpoint.draft.props.items, [{ id: 999 }]);
});

test('全部资源组件有确定映射，关系复合身份、章节进度与评分分布来自缓存事实', async () => {
  const single = async () => resource(subject), props = { resourceRef: ref };
  for (const kind of ['SubjectCards', 'Gallery', 'LinkList', 'DataTable', 'InfoBox', 'TagCloud', 'StatsCard']) assert.equal((await expandResourceContent(kind, props, single)).pending, false);
  const relations = async () => resource({ scope: { person_id: 100 }, data: [
    { character: { entity: 'character', id: 2, name: '角色', image: subject.image }, subject: { entity: 'subject', id: 1, name: '作品', subjectType: 2 }, staff: '声优' },
    { character: { entity: 'character', id: 2, name: '角色', image: subject.image }, subject: { entity: 'subject', id: 3, name: '另一作品', subjectType: 2 }, staff: '声优' },
  ] });
  await assert.rejects(expandResourceContent('Gallery', { ...props, items: [{ id: 2 }] }, relations));
  const gallery = await expandResourceContent('Gallery', { ...props, items: [{ characterId: 2, subjectId: 1 }] }, relations);
  assert.equal(gallery.props.items[0].id, 2); assert.equal(gallery.props.items[0].name, '角色');
  assert.equal((await expandResourceContent('Gallery', { ...props, items: [{ personId: 2 }] }, async () => resource({ entity: 'person', id: 2, name: '人物' }))).props.items[0].name, '人物');
  await assert.rejects(expandResourceContent('Gallery', { ...props, layout: 'grid' }, relations));
  const episodes = async () => resource({ data: [0, 1, 2, 3].map((state, index) => ({ episode: { entity: 'episode', id: index + 1, sort: index + 1 }, episodeStatus: state })) });
  assert.deepEqual((await expandResourceContent('ProgressView', props, episodes)).props.episodes.map(row => row.state), ['todo', 'todo', 'done', 'todo']);
  assert.equal((await expandResourceContent('Timeline', props, async () => resource({ data: [{ createdAt: '2026-10-07', title: '事件' }] }))).props.entries[0].text, '事件');
  assert.equal((await expandResourceContent('CompareTable', { ...props, fields: ['name'] }, async () => resource({ before: { name: '前' }, after: { name: '后' } }))).props.rows[0].changed, true);
  for (const part of [{ type: 'Callout', pending: false, props: { tone: 'success', text: '完成' } }, { type: 'QuoteBlock', pending: false, props: { mono: false, text: '引用' } }]) assert.deepEqual(await expandResourceContent(part.type, props, async () => resource({ presentation: { content: [part] } })), part);
});

test('模型请求保留原工具配对及必填引用，过期只作历史说明且不改变canonical历史', () => {
  const transcript = { messages: [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'cached-read', name: 'read_cached_resource', arguments: { resource_ref: ref, fields: ['name'] } }] },
    { role: 'toolResult', toolCallId: 'cached-read', toolName: 'read_cached_resource', isError: false, content: [{ type: 'text', text: JSON.stringify({ value: { resourceRef: ref, id: 1 } }) }] },
  ] };
  const original = structuredClone(transcript);
  const resolver = Object.assign(async () => resource(subject), { isCurrent: value => value === ref });
  const current = projectTranscriptForModel(transcript, resolver), historical = projectTranscriptForModel(transcript);
  for (const projected of [current, historical]) {
    assert.deepEqual(projected.messages[0].content[0].arguments, original.messages[0].content[0].arguments);
    assert.equal(projected.messages[1].toolCallId, 'cached-read');
    assert.deepEqual(JSON.parse(projected.messages[1].content[0].text), JSON.parse(original.messages[1].content[0].text));
  }
  assert.equal(JSON.stringify(current).includes('当前请求未验证可复用'), false);
  assert.match(JSON.stringify(historical), /历史引用仅标识原操作.*当前请求未验证可复用/);
  assert.deepEqual(transcript, original);
});

test('provider上下文去除本地完整结果及诊断快照，canonical会话仍保存原对象', () => {
  const sentinel = 'DISPLAY_ONLY_FULL_SNAPSHOT_SENTINEL';
  const transcript = { messages: [
    { role: 'toolResult', details: { summary: sentinel }, structuredContent: { presentation: sentinel }, content: [{ type: 'text', text: '{"value":{"id":1}}' }] },
    { role: 'assistant', diagnostics: [{ type: 'checkpoint', details: { prefix: sentinel } }], content: [{ type: 'text', text: '解释' }] },
  ] };
  const projected = projectTranscriptForModel(transcript);
  assert.equal(JSON.stringify(projected).includes(sentinel), false); assert.ok(JSON.stringify(transcript).includes(sentinel));
});

test('Pi已将canonical组件序列化为JSON text时仍精简展示事实，普通JSON解释保持原样', () => {
  const card = { type: 'SubjectCards', pending: false, props: { layout: 'grid', items: [{ id: 1, kind: 'anime', name: '作品', summary: '完整简介不可重入', image: subject.image }] } };
  const ordinary = '{"type":"other","summary":"用户解释内容"}';
  const transcript = { messages: [{ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(card) }, { type: 'text', text: ordinary }] }] };
  const projected = projectTranscriptForModel(transcript);
  assert.equal(JSON.stringify(projected).includes('完整简介不可重入'), false);
  assert.equal(JSON.stringify(projected).includes(subject.image), false);
  assert.ok(JSON.stringify(projected).includes('作品')); assert.equal(projected.messages[0].content[1].text, ordinary);
  assert.ok(JSON.stringify(transcript).includes('完整简介不可重入'));
});

test('ModelRuntime重新规范化请求信封后仍取得当前请求的resolver，不串其他会话', async () => {
  const faux = fauxProvider({ api: 'openai-responses', provider: 'resource-context-copy' });
  const response = fauxAssistantMessage(JSON.stringify({ content: [{ type: 'SubjectCards', props: { resourceRef: ref } }] }));
  faux.setResponses([response, response]);
  const transcript = context(), resolver = async () => resource(subject);
  bindResourceResolver(transcript, resolver);
  const normalized = normalizeContext(transcript); assert.notEqual(normalized, transcript);
  let terminal; for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), normalized, {})) terminal = event;
  assert.equal(terminal.type, 'done'); assert.equal(terminal.message.content[0].pending, false);
  for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), context(), {})) terminal = event;
  assert.equal(terminal.type, 'error');
});

test('真实会话宿主在轮次缓存清理前保存展开快照，重开会话仍可重放且下一轮模型不收到展示大字段', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-resource-runtime-'));
  const faux = fauxProvider({ api: 'openai-responses', provider: 'resource-runtime' });
  let returnedRef, readContext, thirdAudit;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'SubjectCards' }, { id: 'component-index' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('read_component_spec', { names: ['SubjectCards'], representation: 'reference' }, { id: 'component-spec' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('get_subject_details', { subject_id: 1 }, { id: 'read-resource' })], { stopReason: 'toolUse' }),
    transcript => {
      const toolText = transcript.messages.findLast(message => message.role === 'toolResult').content[0].text;
      if (!toolText.startsWith('{')) throw new Error(toolText);
      returnedRef = JSON.parse(toolText).value.resourceRef;
      assert.ok(returnedRef);
      return fauxAssistantMessage(JSON.stringify({ content: [{ type: 'SubjectCards', props: { resourceRef: returnedRef, items: [{ id: 1 }], layout: 'grid' } }, { type: 'text', text: '模型选择理由' }] }));
    },
    transcript => {
      const wire = JSON.stringify(transcript);
      const matches = []; const visit = (value, path = '') => {
        if (typeof value === 'string') { for (const needle of ['缓存独有简介', 'example.invalid/cover', returnedRef]) if (value.includes(needle)) matches.push({ path, needle, value: value.slice(0, 300) }); }
        else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, `${path}/${key}`);
      }; visit(transcript); thirdAudit = { matches };
      assert.equal(wire.includes('缓存独有简介'), false); assert.equal(wire.includes('example.invalid/cover'), false);
      const sourceCall = transcript.messages.flatMap(message => message.role === 'assistant' ? message.content : [])
        .find(part => part.type === 'toolCall' && part.id === 'read-resource');
      const sourceResult = transcript.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'read-resource');
      assert.deepEqual(sourceCall.arguments, { subject_id: 1 });
      assert.equal(sourceResult.toolName, 'get_subject_details');
      assert.equal(JSON.parse(sourceResult.content[0].text).value.resourceRef, returnedRef);
      assert.match(wire, /历史引用仅标识原操作.*当前请求未验证可复用/);
      assert.ok(wire.includes('模型选择理由')); assert.ok(wire.includes('缓存作品'));
      return fauxAssistantMessage('{"content":[{"type":"text","text":"继续讨论"}]}');
    },
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider); await modelRuntime.setRuntimeApiKey('resource-runtime', 'offline-placeholder');
  const manager = SessionManager.create(root, join(root, 'sessions'));
  manager.appendSessionInfo('资源引用持久化验证');
  const service = new BangumiMcpService({ close: async () => {}, public: async () => ({ id: 1, type: 2, name: '缓存作品', name_cn: '', nsfw: false, summary: '缓存独有简介', infobox: [], tags: [], images: { large: 'https://example.invalid/cover.jpg' } }) });
  const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, modelRuntime, sessionManager: manager, provider: 'resource-runtime', model: 'faux-1',
    extension: createBangumiExtension({ authDir: join(root, 'auth'), timeoutMs: 1000, proxy: null,
      client: { call: (...args) => service.call(...args), readCachedResource: async (...args) => { readContext = args[2]; return service.readCachedResource(args[0], args[2]); }, endReadContext: async turnId => service.endReadContext(turnId), close: async () => {} },
      channel: { canConfirm: () => true, confirm: async () => true, canLogin: () => false, notify: () => {} },
    }) });
  t.after(async () => { await runtime.dispose(); await service.close(); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  await runtime.session.prompt('展示作品1的卡片'); await runtime.session.waitForIdle();
  const answer = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  assert.equal(answer.stopReason, 'stop', JSON.stringify({ errorMessage: answer.errorMessage, diagnostics: answer.diagnostics })); assert.equal(answer.content[0].pending, false);
  assert.equal(answer.content[0].props.items[0].summary, '缓存独有简介');
  assert.equal(answer.content[0].props.items[0].image, 'https://example.invalid/cover.jpg');
  await assert.rejects(service.readCachedResource(returnedRef, readContext));
  const restored = SessionManager.open(manager.getSessionFile());
  const reloaded = restored.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  assert.deepEqual(reloaded.content, answer.content);
  await runtime.session.prompt('继续讨论这部作品'); await runtime.session.waitForIdle();
  assert.equal(faux.state.callCount, 5, JSON.stringify({ thirdAudit, errors: manager.getBranch().filter(entry => entry.type === 'message' && entry.message.errorMessage).map(entry => entry.message.errorMessage) }));
});
