import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { getCurrentTools, createProvider } from '@earendil-works/pi-ai';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createBangumiExtension } from '../dist/src/extension.js';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { ComponentCatalogState } from '../dist/src/output/component-catalog.js';
import { createPresentationTools } from '../dist/src/output/presentation-tools.js';
import { PresentationStore } from '../dist/src/output/presentation-store.js';
import { ReplyAssembler } from '../dist/src/output/reply-assembler.js';
import { RENDER_TOOL_DEFINITIONS, PRESENTATION_TOOL_NAMES, PRESENTATION_MODEL_TOOL_ROLES, componentToolSchema } from '../dist/src/output/presentation-contract.js';
import { COMPONENT_KINDS } from '../dist/src/output/content-types.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';
import { resourceSelectionIdentities } from '../dist/src/output/resource-content.js';
import { fixture, eventually } from './web-fixture.mjs';

const base = id => ({ entity: 'subject', id, name: `作品${id}`, subjectType: 2, score: id + 7 });
const config = { authDir: tmpdir(), timeoutMs: 1000, proxy: null, client: { call: async () => { throw Error('不访问上游'); } }, generateSessionTitle: async () => null,
  channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} } };
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
function unit(resolver) {
  const saved = [], assembler = new ReplyAssembler(value => saved.push(value)); assembler.begin('atomic');
  const store = new PresentationStore(resolver); store.begin();
  const catalog = new ComponentCatalogState(); catalog.readIndex({ limit: 12 }); catalog.readPrepareSpecs(['SubjectCards', 'DataTable', 'Gallery', 'ProgressView']);
  return { saved, assembler, store, catalog, tools: Object.fromEntries(createPresentationTools(store, assembler, catalog).map(tool => [tool.name, tool])) };
}

test('12种固定render均真实materialize/严格校验/原子append，模型无需第二次publish', async () => {
  const subject = { ...base(1), url: 'https://bgm.tv/subject/1', tags: ['日常'], ratingDistribution: { 9: 42 }, infobox: [{ key: '原作', value: '作者' }] };
  const samples = {
    SubjectCards: [subject, { subjectIds: [1] }], StatsCard: [subject, {}], InfoBox: [subject, {}], DataTable: [subject, { columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }] }],
    TagCloud: [subject, {}], LinkList: [subject, {}], Gallery: [{ entity: 'person', id: 2, name: '人物' }, { members: [{ personId: 2 }] }],
    ProgressView: [{ entity: 'episode', id: 3, sort: 1, episodeStatus: 2 }, {}], Timeline: [{ data: [{ id: 4, createdAt: '2026-10-09', title: '事件' }] }, {}],
    CompareTable: [{ before: { name: '前' }, after: { name: '后' } }, { fields: ['name'] }], QuoteBlock: [null, { text: '引用', mono: false }], Callout: [null, { tone: 'success', text: '提示' }],
  };
  for (const component of COMPONENT_KINDS) {
    const [value, options] = samples[component], f = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value }));
    f.catalog.readPrepareSpecs([component]);
    const result = await f.tools[`render_${component}`].execute(`atomic-${component}`, { ...(value ? { resourceRef: 'rr_facts' } : {}), ...options, before: '前', after: '后', final: true });
    assert.equal(result.isError, undefined, `${component} ${JSON.stringify(result.details)}`);
    assert.equal(f.saved.length, 1); assert.deepEqual(f.assembler.snapshot().content.map(part => part.type), ['text', component, 'text']);
    assert.equal(f.assembler.completionOperation(), `atomic-${component}`);
  }
});

test('render同源Schema完整source选择：空、双来源形式、sources混顶层ID都拒绝', () => {
  const schema = componentToolSchema('SubjectCards');
  assert.equal(schema.type, 'object'); assert.equal(RENDER_TOOL_DEFINITIONS.length, 12);
  for (const args of [{}, { resourceRef: 'rr_one', sources: [{ resourceRef: 'rr_one' }] }, { sources: [{ resourceRef: 'rr_one' }], subjectIds: [1] }, { sources: [{}] }])
    assert.throws(() => schemaArguments(schema, args));
  for (const args of [{ resourceRef: 'rr_one', subjectIds: [1] }, { sources: [{ resourceRef: 'rr_one', subjectIds: [1] }] }]) assert.doesNotThrow(() => schemaArguments(schema, args));
  for (const kind of ['InfoBox', 'StatsCard', 'CompareTable', 'TagCloud', 'Timeline']) assert.equal(componentToolSchema(kind).properties.sources.maxItems, 1);
});

test('默认DataTable只接受columns，拒绝fields不读缓存；高级prepare保留fields事实投影', async () => {
  let reads = 0;
  const f = unit(async resourceRef => { reads++; return { resourceRef, sourceTool: 'get_subject_details', value: base(1) }; });
  assert.equal(Object.hasOwn(componentToolSchema('DataTable').properties, 'fields'), false);
  assert.equal(Object.hasOwn(componentToolSchema('DataTable', false).properties, 'fields'), true);
  for (const args of [{ resourceRef: 'rr_one', fields: ['id', 'name', 'score'] }, { resourceRef: 'rr_one', fields: ['name'], columns: [{ key: 'name', label: '名称' }] }]) {
    assert.throws(() => schemaArguments(f.tools.render_DataTable.parameters, args));
    const result = await f.tools.render_DataTable.execute('reject-fields', args); assert.equal(result.isError, true);
  }
  assert.equal(reads, 0); assert.deepEqual(f.assembler.snapshot().content, []);
  const columns = [{ key: 'id', label: '编号' }, { key: 'name', label: '名称' }, { key: 'score', label: '评分', align: 'right' }];
  const result = await f.tools.render_DataTable.execute('table', { resourceRef: 'rr_one', columns });
  assert.equal(result.isError, undefined); assert.deepEqual(f.assembler.snapshot().content[0].props.columns, columns);
  assert.deepEqual(f.assembler.snapshot().content[0].props.rows, [{ id: '1', name: '作品1', score: '8' }]);
  const prepared = await f.tools.prepare_DataTable.execute('advanced', { resourceRef: 'rr_one', fields: ['id', 'name', 'score'] });
  assert.equal(prepared.isError, undefined);
  const block = await f.store.block(prepared.details.resourceRef, 0);
  assert.deepEqual(block.props.rows, [{ id: '1', name: '作品1', score: '8' }]);
  const generic = await f.tools.prepare_component.execute('legacy', { component: 'DataTable', resourceRef: 'rr_one', fields: ['name'] });
  assert.equal(generic.isError, undefined); assert.deepEqual((await f.store.block(generic.details.resourceRef, 0)).props.rows, [{ name: '作品1' }]);
});

test('既有有序引用合并：ID/名称/事实同源，不同实体裸ID不误去重，wrongsource/重复/变化整体拒绝', async () => {
  const values = { rr_one: base(1), rr_two: base(2), rr_person: { entity: 'person', id: 1, name: '人物1' } };
  const f = unit(async resourceRef => ({ resourceRef, sourceTool: resourceRef === 'rr_person' ? 'get_person_details' : 'get_subject_details', value: values[resourceRef], accessContext: { account: 'same' } }));
  const sources = [{ resourceRef: 'rr_two', subjectIds: [2] }, { resourceRef: 'rr_one', subjectIds: [1] }];
  const good = await f.tools.render_SubjectCards.execute('good', { sources, before: '前言', after: '结论', final: true });
  assert.equal(good.isError, undefined, JSON.stringify(good.details));
  assert.deepEqual(f.assembler.snapshot().content.map(part => part.type), ['text', 'SubjectCards', 'text']);
  assert.deepEqual(f.assembler.snapshot().content[1].props.items.map(item => [item.id, item.name, item.score]), [[2, '作品2', 9], [1, '作品1', 8]]);
  assert.equal(f.saved.length, 1, 'before/component/after一次快照发布'); assert.equal(f.assembler.snapshot().status, 'open');
  const count = f.saved.length;
  const bad = await f.tools.render_SubjectCards.execute('bad', { sources: [{ resourceRef: 'rr_one', subjectIds: [2] }], before: '不能泄露前言' });
  assert.equal(bad.isError, true); assert.equal(bad.details.error.issues[0].path, '/sources/0/subjectIds'); assert.equal(f.saved.length, count);
  const duplicate = await f.tools.render_SubjectCards.execute('dup', { sources: [{ resourceRef: 'rr_one' }, { resourceRef: 'rr_one' }] });
  assert.equal(duplicate.isError, true); assert.equal(f.saved.length, count);
  const table = await f.store.materialize('DataTable', { sources: [{ resourceRef: 'rr_one', subjectIds: [1] }, { resourceRef: 'rr_person', members: [{ personId: 1 }] }], fields: ['id', 'name'] });
  assert.deepEqual(table.props.rows.map(row => row.name), ['作品1', '人物1']);
  let reads = 0;
  const changed = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value: resourceRef === 'rr_two' && ++reads > 1 ? { ...base(2), score: 99 } : base(resourceRef === 'rr_one' ? 1 : 2) }));
  const refused = await changed.tools.render_SubjectCards.execute('changed', { sources, before: '不能先发布' });
  assert.equal(refused.isError, true); assert.equal(refused.details.error.code, 'RESOURCE_VERSION_CHANGED'); assert.deepEqual(changed.assembler.snapshot().content, []);
});

test('未知实体仅唯一别名可证明身份，歧义双来源整体拒绝且不发布前言', async () => {
  const ambiguous = { entity: 'relation', id: 1, personId: 1, characterId: 1, name: '关系条目' };
  const props = { resourceRef: 'rr_ambiguous' };
  assert.throws(() => resourceSelectionIdentities(ambiguous, props, 'DataTable'), /缓存没有可核实的实体身份/);
  assert.deepEqual(resourceSelectionIdentities({ ...ambiguous, characterId: 2 }, props, 'Gallery'), [JSON.stringify({ entity: 'person', id: 1 })]);
  assert.deepEqual(resourceSelectionIdentities({ ...ambiguous, entity: 'person' }, props, 'Gallery'), [JSON.stringify({ entity: 'person', id: 1 })]);
  const f = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value: resourceRef === 'rr_ambiguous' ? ambiguous : { entity: 'character', id: 1, name: '角色' } }));
  const args = { sources: [{ resourceRef: 'rr_ambiguous' }, { resourceRef: 'rr_character' }], fields: ['id', 'name'] };
  await assert.rejects(f.store.materialize('DataTable', args), /缓存没有可核实的实体身份/);
  const { fields: _fields, ...sourceArgs } = args;
  const result = await f.tools.render_DataTable.execute('ambiguous', { ...sourceArgs, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }], before: '不得先发布' });
  assert.equal(result.isError, true);
  assert.equal(result.details.error.code, 'CONTENT_SCHEMA_INVALID');
  assert.equal(result.details.error.diagnostic.reason, 'resource_reference_invalid');
  assert.equal(result.details.error.diagnostic.issues[0].path, '/sources/0/props/resourceRef');
  assert.notEqual(result.details.error.diagnostic.issues[0].rule, 'duplicate_member');
  assert.deepEqual(f.assembler.snapshot().content, []); assert.equal(f.saved.length, 0);
});

test('同宿主prepared rr可原子render复用，所有依赖变化/换轮/重复身份仍拒绝', async () => {
  let value = base(1);
  const f = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value }));
  const prepared = await f.store.prepareSelected('SubjectCards', { resourceRef: 'rr_one', subjectIds: [1] });
  const good = await f.tools.render_SubjectCards.execute('reuse', { resourceRef: prepared.resourceRef, blockIndex: 0 });
  assert.equal(good.isError, undefined, JSON.stringify(good.details));
  const duplicate = await f.tools.render_SubjectCards.execute('duplicates', { sources: [{ resourceRef: prepared.resourceRef, blockIndex: 0 }, { resourceRef: prepared.resourceRef, blockIndex: 0 }] });
  assert.equal(duplicate.isError, true);
  value = { ...base(1), score: 10 };
  const stale = await f.tools.render_SubjectCards.execute('stale', { resourceRef: prepared.resourceRef, blockIndex: 0 });
  assert.equal(stale.details.error.code, 'RESOURCE_VERSION_CHANGED');
  f.store.begin();
  const expired = await f.tools.render_SubjectCards.execute('expired', { resourceRef: prepared.resourceRef, blockIndex: 0 });
  assert.equal(expired.isError, true);
});

test('进度网格可以多源，数值快照冲突和合并容量失败不发布任何batch部分', async () => {
  const f = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_episode_collection', value: { entity: 'episode', id: resourceRef === 'rr_one' ? 1 : 2, sort: 1, episodeStatus: 2 } }));
  const part = await f.store.materialize('ProgressView', { sources: [{ resourceRef: 'rr_one' }, { resourceRef: 'rr_two' }] });
  assert.deepEqual(part.props.episodes.map(row => row.id), [1, 2]);
  const numeric = unit(async resourceRef => ({ resourceRef, sourceTool: 'fixture', value: { entity: 'episode', id: resourceRef === 'rr_one' ? 1 : 2,
    presentation: { content: [{ type: 'ProgressView', pending: false, props: { current: 1, total: 2, episodes: [{ id: resourceRef === 'rr_one' ? 1 : 2, label: '一', state: 'done' }] } }] } } }));
  const denied = await numeric.tools.render_ProgressView.execute('numeric', { sources: [{ resourceRef: 'rr_one', blockIndex: 0 }, { resourceRef: 'rr_two', blockIndex: 0 }], before: '不发布' });
  assert.equal(denied.isError, true); assert.deepEqual(numeric.assembler.snapshot().content, []);
  const rows = Array.from({ length: 51 }, (_, index) => base(index + 1));
  const overflow = unit(async resourceRef => ({ resourceRef, sourceTool: 'get_subjects', value: { entity: 'subject', data: resourceRef === 'rr_one' ? rows.slice(0, 50) : rows.slice(50) } }));
  const tooMany = await overflow.tools.render_SubjectCards.execute('overflow', { sources: [{ resourceRef: 'rr_one' }, { resourceRef: 'rr_two' }], before: '不发布' });
  assert.equal(tooMany.isError, true); assert.equal(tooMany.details.error.code, 'CONTENT_LIMIT_EXCEEDED'); assert.deepEqual(overflow.assembler.snapshot().content, []);
});

test('实际HTTP：初始display=0，loader下一request只声明选中Schema，final成功省去收尾并保留Web/回放', async t => {
  const payloads = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body); payloads.push(payload);
    const tools = payload.tools.map(tool => tool.function.name);
    let calls;
    if (payloads.length === 1) {
      assert.equal(tools.some(name => PRESENTATION_TOOL_NAMES.includes(name)), false);
      calls = [['read_component_spec', { names: ['Callout'] }]];
    } else if (payloads.length === 2) {
      assert.deepEqual(tools.filter(name => PRESENTATION_TOOL_NAMES.includes(name)), ['render_Callout']);
      assert.deepEqual(payload.tools.find(tool => tool.function.name === 'render_Callout').function.parameters, RENDER_TOOL_DEFINITIONS.find(tool => tool.name === 'render_Callout').inputSchema);
      calls = [['render_Callout', { tone: 'success', text: '组件', before: '前言', after: '结论', final: true }]];
    } else {
      assert.equal(tools.some(name => PRESENTATION_TOOL_NAMES.includes(name)), false);
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => ({ id: `http-${payloads.length}`, object: 'chat.completion.chunk', created: 1, model: 'atomic-wire', choices: [{ index: 0, delta, finish_reason }] });
    if (calls) {
      response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: calls.map(([name, args], index) => ({ index, id: `call-${payloads.length}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
    } else {
      response.write(`data: ${JSON.stringify(chunk({ content: '普通文字' }))}\n\n`); response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  const model = { id: 'atomic-wire', name: 'atomic-wire', api: 'openai-completions', provider: 'atomic-wire', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoning: false,
    input: ['text'], contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStrictMode: false } };
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: 'Local wire fixture', resolve: async () => ({ auth: { apiKey: 'offline' } }) } }, api: { stream, streamSimple } })));
  await f.initial.session.modelRuntime.setRuntimeApiKey(model.provider, 'offline'); await f.initial.session.setModel(model);
  const events = await f.stream('wire'), id = (await f.state('wire')).sessionId;
  await f.post('wire', 'submit', { input: '用提示组件展示并结束' }, id); await f.initial.session.waitForIdle();
  assert.equal(payloads.length, 2);
  const state = await f.state('wire'), answers = state.items.filter(item => item.kind === 'assistant'); assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].content.map(part => part.type), ['text', 'Callout', 'text']); assert.deepEqual(state.liveContent, []);
  const entries = f.initial.session.sessionManager.buildContextEntries(), snapshot = entries.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').at(-1).data;
  assert.equal(snapshot.status, 'completed'); assert.equal(entries.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message.stopReason, 'toolUse');
  const commit = entries.find(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation_commit');
  assert.ok(commit); assert.equal(commit.data.evidence, 'all_tools_succeeded'); assert.equal(commit.data.batch.at(-1).name, 'render_Callout');
  const ack = entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read_component_spec').message;
  assert.deepEqual(Object.keys(JSON.parse(ack.content[0].text)).sort(), ['status', 'tools', 'version']);
  assert.equal(entries.some(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read_component_index'), false);
  await f.post('wire', 'submit', { input: '现在仅回答普通文字' }, id); await f.initial.session.waitForIdle(); assert.equal(payloads.length, 3);
  await f.post('wire', 'session', { action: 'new' }); await f.post('wire', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual((await f.state('wire')).items.filter(item => item.kind === 'assistant')[0].content, answers[0].content);
});

test('load与新render同批不可执行；final前其他错误或final后操作不能提前commit，纠正后同一正文完成', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 2 } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-batch' });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'Callout' }), fauxToolCall('read_component_spec', { names: ['Callout'] }),
      fauxToolCall('render_Callout', { tone: 'success', text: '不应同批执行', final: true })], { stopReason: 'toolUse' }),
    context => {
      assert.equal(context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'render_Callout').isError, true); assert.equal(getCurrentTools(context.messages).filter(tool => tool.name.startsWith('render_')).length, 1);
      return fauxAssistantMessage([fauxToolCall('render_Callout', { tone: 'success', text: '成功前缀', final: true }), fauxToolCall('read_component_index', { offset: -1 })], { stopReason: 'toolUse' });
    },
    call('render_Callout', { tone: 'success', text: '最终有效', final: true }),
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('batch')).sessionId; await f.post('batch', 'submit', { input: '测试原子完成' }, id); await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 3);
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
  assert.equal(snapshots.at(-1).data.status, 'completed'); assert.deepEqual(snapshots.at(-1).data.content.map(part => part.props.text), ['成功前缀', '最终有效']);
});

test('多组件只加载所选集合，下一真实用户退役，visible同版本ack可单loader复用', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-cache' });
  const displays = context => getCurrentTools(context.messages).filter(tool => PRESENTATION_TOOL_NAMES.includes(tool.name)).map(tool => tool.name).sort();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_component_index', { limit: 12 }), fauxToolCall('read_component_spec', { names: ['Callout', 'QuoteBlock'] })], { stopReason: 'toolUse' }),
    context => { assert.deepEqual(displays(context), ['render_Callout', 'render_QuoteBlock']); return call('render_Callout', { tone: 'success', text: '第一轮', final: true }); },
    context => { assert.deepEqual(displays(context), []); return fauxAssistantMessage('普通解释'); },
    context => { assert.deepEqual(displays(context), []); return call('read_component_spec', { names: ['Callout'] }); },
    context => { assert.deepEqual(displays(context), ['render_Callout']); return call('render_Callout', { tone: 'success', text: '复用定义', final: true }); },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('cache')).sessionId;
  for (const input of ['展示两种组件定义中的一种', '普通解释', '再次展示提示']) { await f.post('cache', 'submit', { input }, id); await f.initial.session.waitForIdle(); }
  assert.equal(faux.state.callCount, 5);
  const indexCalls = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read_component_index');
  assert.equal(indexCalls.length, 1, '有效定义缓存不重读索引');
});

test('压缩移除loader后无隐式active，明确合法名称可重新load下一request', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-compression' });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'Callout' }), fauxToolCall('read_component_spec', { names: ['Callout'] })], { stopReason: 'toolUse' }),
    call('render_Callout', { tone: 'success', text: '已展示', final: true }),
    context => { assert.equal(getCurrentTools(context.messages).some(tool => tool.name === 'render_Callout'), false); return call('read_component_spec', { names: ['Callout'] }); },
    context => { const ack = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'read_component_spec'); assert.notEqual(ack.isError, true);
      assert.equal(JSON.parse(ack.content[0].text).status, 'activated'); assert.deepEqual(getCurrentTools(context.messages).filter(tool => PRESENTATION_TOOL_NAMES.includes(tool.name)).map(tool => tool.name), ['render_Callout']);
      return call('render_Callout', { tone: 'success', text: '重新加载后发布', final: true }); },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('compression')).sessionId; await f.post('compression', 'submit', { input: '先展示' }, id); await f.initial.session.waitForIdle();
  const oldCalls = new Set(f.initial.session.sessionManager.buildContextEntries().flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult'
    && ['read_component_index', 'read_component_spec'].includes(entry.message.toolName) ? [entry.message.toolCallId] : []));
  const original = f.initial.session.agent.transformContext;
  f.initial.session.agent.transformContext = async (messages, signal) => (await original?.(messages, signal) ?? messages).filter(message => message.role !== 'toolResult' || !oldCalls.has(message.toolCallId));
  await f.post('compression', 'submit', { input: '压缩后再用旧定义' }, id); await f.initial.session.waitForIdle(); assert.equal(faux.state.callCount, 4);
});

test('render成功后晚取消不得final commit，完成前缀只落aborted终态', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-cancel' });
  faux.setResponses([fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'Callout' }), fauxToolCall('read_component_spec', { names: ['Callout'] })], { stopReason: 'toolUse' }),
    call('render_Callout', { tone: 'success', text: '已完成前缀', final: true })]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const unsub = f.initial.session.subscribe(event => { if (event.type === 'tool_execution_end' && event.toolName === 'render_Callout') f.initial.session.agent.abort(); }); t.after(unsub);
  const id = (await f.state('cancel-final')).sessionId; await f.post('cancel-final', 'submit', { input: '晚取消' }, id); await f.initial.session.waitForIdle();
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
  assert.equal(snapshots.some(entry => entry.data.status === 'completed'), false); assert.equal(snapshots.at(-1).data.status, 'aborted');
  assert.equal(snapshots.at(-1).data.content[0].props.text, '已完成前缀');
});

test('final遇追加输入不会跳过后续真实处理，queued消息处理后才收敛', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension(config)(pi) });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-queued' });
  faux.setResponses([fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'Callout' }), fauxToolCall('read_component_spec', { names: ['Callout'] })], { stopReason: 'toolUse' }),
    call('render_Callout', { tone: 'success', text: '先前完成前缀', final: true }),
    context => { assert.equal(context.messages.findLast(message => message.role === 'user').content, '追加要求'); return fauxAssistantMessage('已处理追加要求'); },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const unsub = f.initial.session.subscribe(event => { if (event.type === 'tool_execution_end' && event.toolName === 'render_Callout') f.initial.session.agent.steer({ role: 'user', content: '追加要求', timestamp: Date.now() }); }); t.after(unsub);
  const id = (await f.state('queued')).sessionId; await f.post('queued', 'submit', { input: '展示结果' }, id); await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 3);
  assert.equal(f.initial.session.sessionManager.buildContextEntries().some(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation_commit'), false);
});

test('同批未知写入回执不能借render final绕过既有报告保护', async t => {
  const f = await fixture(t, { additionalExtension: pi => {
    createBangumiExtension(config)(pi);
    // 仅注入模拟已执行回执，不调用任何写接口；真实策略仍由既有业务测试覆盖。
    pi.registerTool({ name: 'execute_write_batch', label: '模拟未知回执', description: '离线保护回归', parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: 'text', text: '{"value":{"state":"unknown","summary":{"unknown":1}}}' }], details: { value: { state: 'unknown', summary: { unknown: 1 } } } }) });
  } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'atomic-unknown' });
  faux.setResponses([fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'Callout' }), fauxToolCall('read_component_spec', { names: ['Callout'] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('execute_write_batch', {}), fauxToolCall('render_Callout', { tone: 'warning', text: '状态待核实', final: true })], { stopReason: 'toolUse' }),
    context => { const names = getCurrentTools(context.messages).map(tool => tool.name); assert.ok(names.length > 0);
      assert.ok(names.every(name => PRESENTATION_MODEL_TOOL_ROLES.has(name))); return fauxAssistantMessage('写入结果未知，停止并等待核实。'); },
  ]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider)); await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('unknown')).sessionId; await f.post('unknown', 'submit', { input: '未知回执保护测试' }, id); await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 3);
  const entries = f.initial.session.sessionManager.buildContextEntries();
  assert.equal(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation_commit'), false);
  assert.ok(entries.some(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery' && entry.data.stage === 'write_unknown'));
});
