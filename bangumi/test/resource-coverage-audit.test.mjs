import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { resourceFields, assertResourceFields, registerResourcePolicy } from '../dist/src/mcp/resource-policy.js';
import { projectModelResult } from '../dist/src/mcp/model-projection.js';
import { ResourceStore } from '../dist/src/mcp/resource-store.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { convertMessages } from '@earendil-works/pi-ai/api/openai-completions';

const sentinel = 'LOCAL_DISPLAY_FACT_SHOULD_NOT_ENTER_UNREQUESTED_MODEL_CONTENT';
const fixture = () => ({ schemaVersion: 1, kind: 'subject_details', entity: 'subject', id: 253,
  resourceRef: `rr_${'a'.repeat(32)}`, name: sentinel, summary: sentinel, image: `https://example.invalid/${sentinel}.jpg`,
  url: `https://example.invalid/${sentinel}`, images: { large: sentinel }, raw: { secret: sentinel },
  data: [{ id: 253, name: sentinel, summary: sentinel, image: sentinel }],
  page: { complete: true, nextOffset: null }, accessContext: anonymousContext() });

test('全工具目录均登记资源策略，未知工具与任意原始路径不能兜底投影', () => {
  assert.equal(TOOL_DEFINITIONS.length, 71);
  assert.equal(TOOL_DEFINITIONS.filter(tool => tool.effect === 'read').length, 57);
  assert.equal(TOOL_DEFINITIONS.filter(tool => tool.effect === 'write').length, 14);
  assert.ok(TOOL_DEFINITIONS.some(tool => tool.name === 'read_cached_resource'));
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(resourceFields(tool.name) instanceof Set, tool.name);
    assert.doesNotThrow(() => projectModelResult(fixture(), tool.name, {}), tool.name);
    assert.throws(() => assertResourceFields(tool.name, ['raw']), { code: 'INVALID_INPUT' }, tool.name);
    assert.throws(() => assertResourceFields(tool.name, ['summary.secret']), { code: 'INVALID_INPUT' }, tool.name);
    if (tool.name !== 'read_cached_resource') for (const field of ['data', 'presentation']) {
      assert.throws(() => assertResourceFields(tool.name, [field]), { code: 'INVALID_INPUT' }, `${tool.name}:${field}不能整体绕过字段投影`);
    }
  }
  assert.throws(() => resourceFields('unregistered_tool'), { code: 'MCP_POLICY_MISSING' });
  assert.throws(() => registerResourcePolicy('unregistered_tool', {}), { code: 'MCP_POLICY_MISSING' });
  assert.throws(() => projectModelResult(fixture()), { code: 'MCP_POLICY_MISSING' });
});

test('模型结果契约拒绝未知顶层业务字段，完整与模型契约不能仅保留宽松object', () => {
  for (const tool of TOOL_DEFINITIONS.filter(tool => tool.name !== 'read_cached_resource')) {
    assert.ok(tool.modelOutputSchema, tool.name);
    assert.throws(() => checkOutput(tool.modelOutputSchema, { value: { arbitrary_undeclared_field: sentinel } }),
      { code: 'MCP_INVALID_RESULT' }, `${tool.name}:模型结果必须依据登记字段约束`);
  }
});

test('所有listTools固定目录都符合真实MCP SDK工具元数据契约', () => {
  for (const tool of TOOL_DEFINITIONS) {
    const result = ToolSchema.safeParse({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}) });
    assert.equal(result.success, true, `${tool.name}: ${result.success ? '' : JSON.stringify(result.error.issues)}`);
  }
});

test('所有登记工具默认投影不泄露正文、名称与图片，保留身份和分页状态', () => {
  for (const tool of TOOL_DEFINITIONS) {
    if (tool.name === 'read_cached_resource') continue; // 此工具已经由服务按 sourceTool 投影，桥接保留指定事实。
    const projected = projectModelResult(fixture(), tool.name, {});
    assert.equal(JSON.stringify(projected).includes(sentinel), false, tool.name);
    assert.equal(projected.id, 253, tool.name);
    assert.equal(projected.resourceRef, `rr_${'a'.repeat(32)}`, tool.name);
    assert.equal(projected.page.complete, true, tool.name);
    assert.deepEqual(projected.data.map(row => row.id), [253], tool.name);
  }
  const explicit = projectModelResult(fixture(), 'get_subject_details', { fields: ['name', 'summary'] });
  assert.equal(explicit.name, sentinel); assert.equal(explicit.summary, sentinel);
  assert.equal(explicit.image, undefined); assert.equal(explicit.raw, undefined);
});

test('主键投影仍保留候选缺失字段、处理计数及来源覆盖，模型可以据此继续处理', () => {
  const value = { ...fixture(), kind: 'candidate_page', pending: [{ id: 253, missingFields: ['summary'], failedFields: ['durationMinutes'] }],
    stage: { inputCount: 10, processedCount: 6, matchedCount: 3, excludedCount: 2, pendingCount: 1, remainingCount: 4 },
    coverage: { complete: false, sourceCount: 2, completeSourceCount: 1, incompleteSourceCount: 1, unknownTotalSourceCount: 0,
      pendingCount: 1, remainingCount: 4, unknownFieldCount: 1, failedFieldCount: 1 } };
  const projected = projectModelResult(value, 'refine_subject_candidates', { fields: [] });
  assert.deepEqual(projected.pending, value.pending, '缺失/失败字段是恢复状态，不能只剩ID');
  assert.deepEqual(projected.stage, value.stage, '处理全集与剩余计数不能丢失');
  assert.deepEqual(projected.coverage, value.coverage, '来源分页与未知总数不能只压成complete');
  assert.equal(JSON.stringify(projected).includes(sentinel), false);
});

test('资源引用保持读取轮次隔离、不可变快照、清理与容量失效语义', () => {
  const store = new ResourceStore(10000), full = fixture(), context = anonymousContext();
  const ref = store.put('get_subject_details', full, { summary: sentinel }, 'turn-a', context);
  full.summary = '外部修改'; context.source = 'web';
  const first = store.get(ref, 'turn-a'); assert.equal(first.value.summary, sentinel); assert.equal(first.accessContext.source, 'v0');
  first.value.summary = '读取副本修改'; assert.equal(store.get(ref, 'turn-a').value.summary, sentinel);
  assert.throws(() => store.get(ref, 'turn-b'), { code: 'RESOURCE_SCOPE_MISMATCH' });
  store.clear('turn-b'); assert.equal(store.get(ref, 'turn-a').value.summary, sentinel);
  store.clear('turn-a'); assert.throws(() => store.get(ref, 'turn-a'), { code: 'RESOURCE_EXPIRED' });
  const constrained = new ResourceStore(10);
  assert.throws(() => constrained.put('get_subject_details', fixture(), {}, 'turn-a', anonymousContext()), { code: 'MCP_OUTPUT_LIMIT' });
});

test('真实服务边界默认不展示完整body，缓存字段读取与宿主RPC不增加上游调用', async t => {
  let requests = 0;
  const raw = { id: 253, type: 2, name: '作品253', name_cn: '中文作品253', nsfw: false, platform: 'TV', date: '1998-04-03',
    rating: { score: 8.8, total: 1000, rank: 20 }, tags: [], meta_tags: ['TV'], summary: sentinel,
    infobox: [{ key: '导演', value: '已取得人物' }], images: { large: 'https://example.invalid/large.jpg', medium: 'https://example.invalid/medium.jpg' } };
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    requests++; assert.equal(path, '/v0/subjects/253'); return structuredClone(raw);
  } });
  t.after(() => service.close());
  const readContext = { turnId: 'independent-full-resource-audit' };
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, readContext);
  const tools = createReadTools({ call, readCachedResource: async resourceRef => service.readCachedResource(resourceRef, readContext) });
  const reply = await tools.find(tool => tool.name === 'get_subject_details').execute('call_subject', { subject_id: 253 }, undefined, undefined, {});
  assert.notEqual(reply.isError, true, JSON.stringify(reply.content));
  const projected = JSON.parse(reply.content[0].text).value;
  assert.ok(projected.resourceRef); assert.equal(JSON.stringify(projected).includes(sentinel), false);
  assert.equal(JSON.stringify(projected).includes('example.invalid'), false); assert.equal(requests, 1);
  const cached = await service.readCachedResource(projected.resourceRef, readContext);
  assert.equal(cached.value.summary, sentinel); assert.equal(cached.value.images.large, raw.images.large);
  const fields = await call('read_cached_resource', { resource_ref: projected.resourceRef, fields: ['summary', 'name', 'score'] });
  assert.equal(fields.value.summary, sentinel); assert.equal(fields.value.name, raw.name); assert.equal(fields.value.score, 8.8);
  assert.equal(requests, 1, '字段读取与宿主RPC都必须是缓存操作');
  const cacheReply = await tools.find(tool => tool.name === 'read_cached_resource').execute('call_cache',
    { resource_ref: projected.resourceRef, fields: ['summary', 'name', 'score'] }, undefined, undefined, {});
  assert.notEqual(cacheReply.isError, true, JSON.stringify(cacheReply.content));
  assert.equal(JSON.parse(cacheReply.content[0].text).value.value.summary, sentinel);
  assert.equal(requests, 1, 'Pi 桥接缓存读取不能因二次投影丢失请求事实或重新读网络');
  await assert.rejects(call('read_cached_resource', { resource_ref: projected.resourceRef, fields: ['summary.raw'] }), { code: 'INVALID_INPUT' });
  assert.equal(requests, 1);
});

test('真实模型默认参数经prepareArguments仍满足Pi公开schema，不注入被隐藏的include', () => {
  const tool = createReadTools({ call: async () => { throw new Error('本测试仅校验参数，不请求网络'); } })
    .find(tool => tool.name === 'get_subject_details');
  const prepared = tool.prepareArguments({ subject_id: 253 });
  assert.equal(Object.hasOwn(prepared, 'include'), false, '宿主内部include默认值不能返回Pi公开参数层');
  assert.doesNotThrow(() => schemaArguments(tool.parameters, prepared));
  assert.throws(() => tool.prepareArguments({ subject_id: 253, include: ['summary'] }), { code: 'INVALID_INPUT' });
});

test('搜索候选模式的完整内部字段状态可投影为合法cache事实，无额外API读取', async t => {
  let requests = 0;
  const row = { id: 253, type: 2, name: '候选作品', name_cn: '候选中文名', nsfw: false, date: '1998-10-23', platform: 'TV',
    tags: [], meta_tags: ['TV'], rating: { score: 8.8, total: 100, rank: 20 }, images: { medium: 'https://example.invalid/candidate.jpg' } };
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    requests++; assert.equal(path, '/v0/search/subjects'); return { total: 1, data: [structuredClone(row)] };
  } });
  t.after(() => service.close());
  const readContext = { turnId: 'candidate-cached-fact-audit' };
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, readContext);
  const tools = createReadTools({ call, readCachedResource: async resourceRef => service.readCachedResource(resourceRef, readContext) });
  const initial = await tools.find(tool => tool.name === 'search_subjects').execute('search',
    { keyword: '候选', subject_type: 2, result_mode: 'candidates', limit: 30 }, undefined, undefined, {});
  assert.notEqual(initial.isError, true, JSON.stringify(initial.content));
  const value = JSON.parse(initial.content[0].text).value;
  assert.equal(value.kind, 'candidate_page'); assert.deepEqual(value.data.map(item => item.id), [253]);
  const result = await tools.find(tool => tool.name === 'read_cached_resource').execute('cache',
    { resource_ref: value.resourceRef, fields: ['name', 'nameCn', 'score', 'date', 'subjectType'] }, undefined, undefined, {});
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const projected = JSON.parse(result.content[0].text).value.value;
  assert.equal(projected.data[0].name, row.name); assert.equal(projected.data[0].score, 8.8);
  for (const field of Object.values(projected.data[0].fieldStates ?? {})) assert.ok(['unknown', 'failed'].includes(field));
  assert.equal(JSON.stringify(projected).includes('candidate.jpg'), false);
  assert.equal(requests, 1, '候选缓存字段读取不得重新搜索或补详情');
});

test('普通详情在读取轮次结束后迟到响应不能复活缓存引用', async t => {
  let release, announce;
  const started = new Promise(resolve => { announce = resolve; });
  const service = new BangumiMcpService({ close: async () => {}, public: async () => {
    announce(); return new Promise(resolve => { release = () => resolve({ id: 1, type: 2, name: '迟到作品', name_cn: '',
      nsfw: false, tags: [], meta_tags: [], summary: sentinel, infobox: [] }); });
  } });
  t.after(() => service.close());
  const readContext = { turnId: 'ended-resource-turn' };
  const pending = service.call('get_subject_details', { subject_id: 1 }, undefined, undefined, undefined, readContext);
  const settled = pending.then(value => ({ value }), error => ({ error }));
  await started; service.endReadContext(readContext.turnId); release();
  const outcome = await settled;
  if (outcome.error) assert.ok(['RESOURCE_EXPIRED', 'CANCELLED', 'MCP_CLOSED'].includes(outcome.error.code), outcome.error.code);
  else await assert.rejects(async () => service.readCachedResource(outcome.value.resourceRef, readContext), { code: 'RESOURCE_EXPIRED' });
});

test('宿主缓存RPC和模型缓存工具都不能在同一轮账户改变后读取旧账户引用', async t => {
  let account = { id: 42, username: 'original_account' };
  const context = () => ({ ...anonymousContext(), mode: 'account', source: 'p1', account: { ...account } });
  const service = new BangumiMcpService({ close: async () => {}, currentUser: async () => ({ ...account }), identity: async () => context() });
  t.after(() => service.close());
  const readContext = { turnId: 'account-resource-turn' };
  const original = await service.call('get_current_user', {}, undefined, undefined, undefined, readContext);
  const full = await service.readCachedResource(original.resourceRef, readContext); assert.equal(full.value.id, 42);
  account = { id: 43, username: 'changed_account' };
  const denied = error => ['ACCOUNT_CHANGED', 'RESOURCE_SCOPE_MISMATCH', 'RESOURCE_EXPIRED'].includes(error.code);
  await assert.rejects(async () => service.readCachedResource(original.resourceRef, readContext), denied);
  await assert.rejects(service.call('read_cached_resource', { resource_ref: original.resourceRef, fields: ['username'] },
    undefined, undefined, undefined, readContext), denied);
});

test('生产缓存账户守卫核对本机session版本且保持零HTTP，包括同账户重新登录', async t => {
  let session = { version: 1, accountId: 42, username: 'cache_guard_user', sessionId: 'offline-cache-session',
    savedAt: Date.now(), expiresAt: Date.now() + 60000 };
  let requests = 0;
  const transport = createMcpTransport({ authDir: 'unused-resource-cache-guard', proxy: null, timeoutMs: 1000,
    loadSession: async () => session, fakeFetch: async url => {
      requests++; assert.equal(new URL(url).pathname, '/p1/me');
      return new Response(JSON.stringify({ id: 42, username: 'cache_guard_user' }), { headers: { 'content-type': 'application/json' } });
    } });
  t.after(() => transport.close());
  const binding = await transport.identity(); assert.equal(requests, 1);
  await transport.validateCachedContext(binding); assert.equal(requests, 1);
  session = { ...session, sessionId: 'offline-cache-session-replaced', savedAt: session.savedAt + 1 };
  await assert.rejects(transport.validateCachedContext(binding), { code: 'ACCOUNT_CHANGED' });
  assert.equal(requests, 1, '同账户换登录版本的拒绝也必须是零HTTP');
});

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
for (const api of ['openai-responses', 'openai-completions']) test(`${api}真实消息转换中完整资源和details未进入模型`, () => {
  const full = fixture(), projected = projectModelResult(full, 'get_subject_details', {});
  const model = { id: 'projection-model', name: 'projection-model', provider: 'openai', api, baseUrl: 'https://example.invalid/v1',
    reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const wire = JSON.stringify({ value: projected });
  const context = { messages: [
    { role: 'assistant', api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'toolUse', usage,
      content: [{ type: 'toolCall', id: 'call_1', name: 'get_subject_details', arguments: { subject_id: 253 } }] },
    { role: 'toolResult', toolCallId: 'call_1', toolName: 'get_subject_details', timestamp: 2, isError: false,
      content: [{ type: 'text', text: wire }], structuredContent: { value: full }, details: { value: full } },
  ] };
  const input = api === 'openai-responses' ? convertResponsesMessages(model, context, new Set(['openai']))
    : convertMessages(model, context, { supportsStrictMode: true, supportsMidConvoSystemMessages: true });
  const tool = input.find(message => message.type === 'function_call_output' || message.role === 'tool');
  assert.equal(tool.output ?? tool.content, wire); assert.equal(JSON.stringify(input).includes(sentinel), false);
  assert.ok(JSON.stringify(input).includes(projected.resourceRef));
});
