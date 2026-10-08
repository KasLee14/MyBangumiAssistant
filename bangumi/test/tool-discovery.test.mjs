import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { convertResponsesTools } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { createReadTools, prepareModelToolArguments } from '../dist/src/mcp/pi-tools.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { createBangumiToolDiscovery, resetBangumiToolLoadout, BANGUMI_TOOL_DISCOVERY_NAME } from '../dist/src/mcp/tool-discovery.js';
import { normalizeStrictOptionalNulls, toolConstraintState, effectiveToolConstraintModel, toolModelSupportsStrict } from '../dist/src/support/provider-tool-arguments.js';
import { validateSchema } from '../dist/src/support/tool-schema.js';

const model = { api: 'openai-completions', compat: { supportsStrictMode: true } };
const client = { call: async () => { throw new Error('本测试禁止网络和账户写入'); } };
function harness() {
  const tools = createReadTools(client, undefined, { model: () => model });
  let active = ['read', BANGUMI_TOOL_DISCOVERY_NAME];
  const pi = { getAllTools: () => [...tools, { name: 'read', exposure: 'direct' }, { name: BANGUMI_TOOL_DISCOVERY_NAME, exposure: 'model-only' }],
    getActiveTools: () => [...active], setActiveTools: next => { active = [...next]; } };
  const discovery = createBangumiToolDiscovery(pi, () => model);
  const discover = async raw => (await discovery.execute('discover-test', discovery.prepareArguments(raw), undefined, undefined, {})).details;
  return { tools, pi, discovery, discover };
}

test('中文用途可搜索并实际加载，精确工具名优先，分类分页不会丢能力', async () => {
  const f = harness();
  const chinese = await f.discover({ query: '作品评分', limit: 12 });
  assert.ok(chinese.tools.some(tool => tool.name === 'search_subjects'));
  assert.ok(chinese.loaded.length > 0);
  assert.ok(chinese.loaded.every(name => f.pi.getActiveTools().includes(name)));
  const exact = await f.discover({ query: 'read_cached_resource' });
  assert.equal(exact.tools[0].name, 'read_cached_resource');
  resetBangumiToolLoadout(f.pi, ['get_subject_details']);
  const seen = [];
  let offset = 0;
  do {
    const page = await f.discover({ offset, limit: 4, load: false });
    assert.equal(page.scope, 'all_registered_read_tools');
    seen.push(...page.tools.map(tool => tool.name));
    if (!page.has_more) { assert.equal(page.next_offset, null); break; }
    offset = page.next_offset;
  } while (true);
  assert.deepEqual([...seen].sort(), TOOL_DEFINITIONS.filter(tool => tool.effect === 'read').map(tool => tool.name).sort());
  assert.equal(new Set(seen).size, seen.length);
  assert.deepEqual(f.pi.getActiveTools().sort(), ['read', 'get_subject_details', BANGUMI_TOOL_DISCOVERY_NAME].sort());
  const none = await f.discover({ query: 'qzxv987654321notpresent' });
  assert.ok(none.hint);
  const category = await f.discover({ category: 'community', load: false, limit: 12 });
  assert.ok(category.tools.length);
  assert.ok(category.tools.every(tool => tool.category === 'community'));
});

test('加载集合在下一用户任务收敛；精确加载未知工具和写工具拒绝', async () => {
  const f = harness();
  await f.discover({ tool_names: ['get_current_user', 'search_persons'] });
  assert.ok(f.pi.getActiveTools().includes('search_persons'));
  // 同轮不会自动收敛，只有宿主显式开启下一真实任务时重置。
  await f.discover({ query: 'get_subject_image' });
  assert.ok(f.pi.getActiveTools().includes('search_persons'));
  resetBangumiToolLoadout(f.pi, ['get_subject_details']);
  assert.equal(f.pi.getActiveTools().includes('search_persons'), false);
  for (const name of ['unknown_tool', 'update_subject_collection']) await assert.rejects(f.discover({ tool_names: [name] }), { code: 'INVALID_INPUT' });
});

test('可转换工具实际strict=true，复杂契约明确fallback；不支持供应商不强制strict', () => {
  const f = harness();
  assert.ok(f.tools.every(tool => tool.exposure === 'deferred' && tool.defaultActive === false));
  const wire = convertResponsesTools(f.tools, { supportsStrictMode: true });
  const compatible = TOOL_DEFINITIONS.filter(tool => tool.effect === 'read'
    && toolConstraintState(tool.modelInputSchema ?? tool.inputSchema, model).schema === 'compatible');
  assert.equal(wire.filter(tool => tool.strict === true).length, compatible.length);
  assert.ok(compatible.length > 0 && compatible.length < f.tools.length);
  assert.ok(wire.filter(tool => tool.strict === false).length > 0);
  assert.ok(convertResponsesTools(f.tools, { supportsStrictMode: false }).every(tool => !Object.hasOwn(tool, 'strict')));
  assert.equal(toolConstraintState({ type: 'object', properties: {} }, { api: 'openai-responses' }).provider, 'unsupported');
  assert.equal(toolConstraintState({ type: 'object', properties: {} }, model).provider, 'enabled');
});

test('strict可选null还原省略但不改变缺省；缺必填、未知字段、类型错误继续拒绝', () => {
  const f = harness();
  const detail = f.tools.find(tool => tool.name === 'get_subject_image');
  const input = { subject_id: 1, image_type: null };
  assert.deepEqual(detail.prepareArguments(input), prepareModelToolArguments('get_subject_image', { subject_id: 1 }));
  assert.deepEqual(input, { subject_id: 1, image_type: null });
  assert.throws(() => prepareModelToolArguments('get_subject_image', input), { code: 'INVALID_INPUT' });
  for (const args of [{ image_type: null }, { subject_id: null }, { subject_id: '1' }, { subject_id: 1, unknown: null }]) {
    assert.throws(() => detail.prepareArguments(args), { code: 'INVALID_INPUT' });
  }
  const complex = f.tools.find(tool => tool.name === 'browse_subjects');
  assert.equal(toolConstraintState(complex.parameters, model).schema, 'fallback');
});
test('wire和prepare使用同一有效能力；未知Responses网关缺省禁strict，官方OpenAI允许，显式能力优先', () => {
  const tool = createReadTools(client).find(tool => tool.name === 'get_subject_image');
  const unknown = { api: 'openai-responses', provider: 'deepseek', baseUrl: 'https://api.deepseek.com' };
  const effective = effectiveToolConstraintModel(unknown);
  assert.equal(effective.compat.supportsStrictMode, false);
  assert.equal(unknown.compat, undefined);
  assert.equal(toolModelSupportsStrict(unknown), false);
  assert.equal(convertResponsesTools([tool], { supportsStrictMode: effective.compat.supportsStrictMode })[0].strict, undefined);
  assert.throws(() => prepareModelToolArguments('get_subject_image', { subject_id: 1, image_type: null }, unknown), { code: 'INVALID_INPUT' });
  const official = { api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1' };
  assert.equal(toolModelSupportsStrict(official), true);
  assert.equal(convertResponsesTools([tool], { supportsStrictMode: effectiveToolConstraintModel(official).compat.supportsStrictMode })[0].strict, true);
  assert.deepEqual(prepareModelToolArguments('get_subject_image', { subject_id: 1, image_type: null }, official), prepareModelToolArguments('get_subject_image', { subject_id: 1 }));
  assert.equal(toolModelSupportsStrict({ ...official, compat: { supportsStrictMode: false } }), false);
  assert.equal(toolModelSupportsStrict({ ...unknown, compat: { supportsStrictMode: true } }), true);
  assert.equal(toolModelSupportsStrict({ ...official, baseUrl: 'https://custom-gateway.invalid/v1' }), false);
});

test('嵌套对象和数组只省略已声明可选null；必填/未知null及合法null保留', () => {
  const schema = { type: 'object', additionalProperties: false, properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { required: { type: 'string' }, optional: { type: 'integer' }, nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['required'] } },
  }, required: ['items'] };
  const raw = { items: [{ required: '值', optional: null, nullable: null }] };
  const normalized = normalizeStrictOptionalNulls(schema, raw, true);
  assert.deepEqual(normalized, { items: [{ required: '值', nullable: null }] });
  validateSchema(schema, normalized);
  assert.deepEqual(normalizeStrictOptionalNulls(schema, raw, false), raw);
  const invalid = normalizeStrictOptionalNulls(schema, { items: [{ required: null, unknown: null }] }, true);
  assert.deepEqual(invalid, { items: [{ required: null, unknown: null }] });
  assert.throws(() => validateSchema(schema, invalid), { code: 'INVALID_INPUT' });
});

test('实际Pi请求仅声明active工具，发现后下一请求出现Schema，新任务再收敛', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-discovery-'));
  let runtime;
  t.after(async () => {
    await runtime?.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  const faux = fauxProvider({ api: 'openai-responses', provider: 'discovery-offline' });
  const captures = [];
  const events = [];
  const capture = context => captures.push(getCurrentTools(context.messages).map(tool => tool.name));
  faux.setResponses([
    context => { capture(context); return fauxAssistantMessage([fauxToolCall(BANGUMI_TOOL_DISCOVERY_NAME, { query: 'get_current_user' })], { stopReason: 'toolUse' }); },
    context => { capture(context); return fauxAssistantMessage('已加载工具'); },
    context => { capture(context); return fauxAssistantMessage('新任务'); },
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey('discovery-offline', 'offline-placeholder');
  runtime = await createBangumiRuntime({ cwd: root, agentDir: root, modelRuntime, sessionManager: SessionManager.create(root, join(root, 'sessions')),
    provider: 'discovery-offline', model: 'faux-1', extension: pi => {
      for (const tool of createReadTools(client)) pi.registerTool(tool);
      pi.registerTool(createBangumiToolDiscovery(pi));
      pi.on('before_agent_start', () => resetBangumiToolLoadout(pi, ['get_subject_details']));
    } });
  runtime.session.subscribe(event => events.push(event));
  await runtime.session.prompt('加载工具');
  await runtime.session.waitForIdle();
  await runtime.session.prompt('新的用户任务');
  await runtime.session.waitForIdle();
  assert.ok(captures.length >= 3, JSON.stringify(events.filter(event => event.type === 'turn_end').map(event => event.message.errorMessage)));
  assert.deepEqual(captures[0].sort(), [BANGUMI_TOOL_DISCOVERY_NAME, 'get_subject_details'].sort());
  assert.ok(captures[1].includes('get_current_user'), JSON.stringify({ captures, events: events.filter(event => event.type === 'tool_execution_end' || event.type === 'turn_end').map(event => ({ type: event.type, name: event.toolName, result: event.result, error: event.message?.errorMessage })) }));
  assert.deepEqual(captures[2].sort(), captures[0].sort());
});
