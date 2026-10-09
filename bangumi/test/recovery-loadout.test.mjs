import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { RecoveryLoadout, ReferenceReadGate } from '../dist/src/output/recovery-loadout.js';
import { PRESENTATION_MODEL_TOOL_ROLES } from '../dist/src/output/presentation-contract.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';
import { validateToolArguments } from '../dist/src/mcp/catalog.js';
import { fixture } from './web-fixture.mjs';

const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
const batch = (...calls) => fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: 'toolUse' });
const names = context => getCurrentTools(context.messages).map(tool => tool.name);
const lastResult = (context, name) => context.messages.findLast(message => message.role === 'toolResult' && message.toolName === name);

test('恢复仅持有execution快照，限制与restore都合并当前最新host；legacy仍完整禁用', () => {
  let active = ['get_subject_details', 'execute_write_batch', 'read_component_spec', 'render_SubjectCards'];
  const api = { getActiveToolNames: () => [...active], setActiveToolsByName: value => { active = [...value]; },
    getAllTools: () => ['get_subject_details', 'execute_write_batch', 'read_component_spec', 'render_SubjectCards', 'render_Callout', 'render_fake'].map(name => ({ name })) };
  const policy = new RecoveryLoadout(api);
  policy.restrict(execution => execution.filter(name => name === 'get_subject_details'), true);
  assert.deepEqual(active.sort(), ['get_subject_details', 'read_component_spec', 'render_SubjectCards'].sort());
  assert.equal(policy.allows('execute_write_batch'), false); assert.equal(policy.allows('render_fake'), false);
  active.push('render_Callout');
  policy.restrict(() => [], true);
  assert.ok(active.includes('render_Callout')); assert.equal(policy.allows('get_subject_details'), false);
  policy.restore(); assert.ok(active.includes('render_Callout')); assert.ok(active.includes('execute_write_batch'));
  const legacy = new RecoveryLoadout(api); legacy.restrict(() => [], false); assert.deepEqual(active, []); legacy.restore();
  assert.ok(active.includes('render_Callout'));
});

test('引用重读同callID可经过顶层/extension双hook，但变参/不同ID不获得第二次许可', () => {
  const args = validateToolArguments('get_subject_details', { subject_id: 1 });
  const gate = new ReferenceReadGate('get_subject_details', args, validateToolArguments);
  assert.equal(gate.allows('source-call', 'get_subject_details', { subject_id: 2 }), false);
  gate.complete('source-call', 'get_subject_details'); // 未获准的调用不能消费许可。
  assert.equal(gate.allows('source-call', 'get_subject_details', { subject_id: 1 }), true);
  assert.equal(gate.allows('source-call', 'get_subject_details', args), true);
  assert.equal(gate.allows('source-call', 'get_subject_details', { subject_id: 2 }), false);
  assert.equal(gate.allows('source-call/1', 'get_subject_details', args), false);
  assert.equal(gate.allows('source-call', 'get_person_details', { person_id: 1 }), false);
  gate.complete('other-call', 'get_subject_details'); gate.complete('source-call', 'get_person_details');
  assert.equal(gate.allows('source-call', 'get_subject_details', args), true);
  gate.complete('source-call', 'get_subject_details');
  assert.equal(gate.allows('source-call', 'get_subject_details', args), false, '实际完成后同ID也不能获得第二次RPC许可');
});

async function production(t, mode = 'input', maxRetries = 2) {
  let httpReads = 0, captured, writeCalls = 0;
  const businessCalls = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async () => {
    httpReads++; return { id: 1, type: 2, name: '当前已核实作品', name_cn: '', nsfw: false, summary: '', tags: [], infobox: [] };
  } });
  const client = {
    call: async (...args) => {
      businessCalls.push(args[0]);
      if (mode === 'fatal' && args[0] === 'get_subject_comments') throw new AppError('BGM_AUTH_EXPIRED', '账户已过期，禁止新读取');
      return service.call(...args);
    },
    readCachedResource: (ref, signal, context, selection) => service.readCachedResource(ref, context, signal, selection),
    endReadContext: turnId => service.endReadContext(turnId), close: async () => {},
  };
  const f = await fixture(t, { additionalExtension: pi => {
    createBangumiExtension({ authDir: tmpdir(), timeoutMs: 1000, proxy: null, client, generateSessionTitle: async () => null,
      channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} } })(pi);
    // 保留真实SDK执行闭包，用来证明未声明的deferred能力不能通过nested绕过业务政策。
    pi.registerTool({ name: 'capture_executor', label: '离线执行上下文', description: '只捕获SDK上下文',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_id, _args, _signal, _update, ctx) => { captured = ctx.executeTool.bind(ctx); return { content: [{ type: 'text', text: '已捕获上下文' }], details: {} }; } });
    if (mode === 'unknown') pi.registerTool({ name: 'execute_write_batch', label: '离线未知回执', description: '模拟回执，不执行写入',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => { writeCalls++; return { content: [{ type: 'text', text: '{"value":{"state":"unknown","summary":{"unknown":1}}}' }], details: { value: { state: 'unknown', summary: { unknown: 1 } } } }; } });
  } });
  t.after(() => service.close());
  f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries, provider: { maxRetries: 0 } } });
  const faux = fauxProvider({ api: 'openai-completions', provider: `recovery-domain-${mode}` });
  const run = async responses => {
    faux.setResponses(responses); f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider));
    await f.initial.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline'); await f.initial.session.setModel(faux.getModel());
    const id = (await f.state(mode)).sessionId; await f.post(mode, 'submit', { input: '显示作品卡片并根据真实回执报告' }, id); await f.initial.session.waitForIdle();
    return { id, entries: f.initial.session.sessionManager.buildContextEntries() };
  };
  return { f, faux, run, nested: (...args) => captured(...args), httpReads: () => httpReads, businessCalls, writeCalls: () => writeCalls };
}
const initial = () => batch(['get_subject_details', { subject_id: 1, fields: ['id', 'name', 'subjectType'] }],
  ['read_component_spec', { names: ['SubjectCards'] }], ['discover_bangumi_tools', { query: 'get_subject_comments' }], ['capture_executor', {}]);
const refFrom = context => JSON.parse(lastResult(context, 'get_subject_details').content[0].text).value.resourceRef;

test('真实MCP参数失败后仍render既有缓存；恢复中加载新组件，settled保留最新host并退役跨轮', async t => {
  const p = await production(t); let ref;
  const result = await p.run([initial(), context => { ref = refFrom(context); return call('get_subject_comments', { subject_id: 1, limit: 21 }); },
    async context => {
      assert.ok(names(context).includes('render_SubjectCards')); assert.ok(names(context).includes('read_component_spec'));
      assert.equal(names(context).includes('discover_bangumi_tools'), false); assert.equal(names(context).includes('execute_write_batch'), false);
      assert.equal(lastResult(context, 'get_subject_comments').isError, true);
      const nested = await p.nested('search_subjects', { keyword: '未经允许的新范围' });
      assert.equal(nested.isError, true); assert.match(nested.result.content[0].text, /恢复策略禁止/);
      return batch(['render_SubjectCards', { resourceRef: ref, subjectIds: [1], layout: 'list' }], ['read_component_spec', { names: ['Callout'] }]);
    }, context => { assert.ok(names(context).includes('render_Callout')); return call('render_Callout', { tone: 'warning', text: '评论参数未完成，作品已核实', final: true }); },
  ]);
  assert.equal(p.faux.state.callCount, 4); assert.equal(p.httpReads(), 1); assert.deepEqual(p.businessCalls, ['get_subject_details']);
  const active = p.f.initial.session.getActiveToolNames(); assert.ok(active.includes('render_SubjectCards')); assert.ok(active.includes('render_Callout'));
  const snapshot = result.entries.findLast(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').data;
  assert.equal(snapshot.status, 'completed'); assert.deepEqual(snapshot.content.map(part => part.type), ['SubjectCards', 'Callout']);
  assert.equal(snapshot.content[0].props.items[0].name, '当前已核实作品');
  p.faux.setResponses([context => { assert.equal(names(context).some(name => name.startsWith('render_')), false); return fauxAssistantMessage('普通解释'); }]);
  await p.f.post('input', 'submit', { input: '现在普通解释' }, result.id); await p.f.initial.session.waitForIdle();
});

test('fatal与未知写入业务空集，真实nested/顶层都不能重读或再写；宿主报告与前缀仍可发布', async t => {
  for (const mode of ['fatal', 'unknown']) await t.test(mode, async child => {
    const p = await production(child, mode); let ref;
    const result = await p.run([initial(), context => { ref = refFrom(context); return batch(['render_SubjectCards', { resourceRef: ref, subjectIds: [1] }],
      mode === 'fatal' ? ['get_subject_comments', { subject_id: 1 }] : ['execute_write_batch', {}]); },
      async context => {
        assert.ok(names(context).length > 0); assert.ok(names(context).every(name => PRESENTATION_MODEL_TOOL_ROLES.has(name)));
        for (const [name, args] of [['get_subject_details', { subject_id: 1 }], ['search_subjects', { keyword: '新范围' }]]) {
          const nested = await p.nested(name, args); assert.equal(nested.isError, true); assert.match(nested.result.content[0].text, /恢复策略禁止/);
        }
        // 模型发出的未声明业务调用也必须拒绝，不能加载新read或再次写入。
        return batch(['get_subject_details', { subject_id: 1 }], ['discover_bangumi_tools', { query: 'search_subjects' }], ['execute_write_batch', {}], ['read_component_spec', { names: ['Callout'] }]);
      }, context => {
        for (const name of ['get_subject_details', 'discover_bangumi_tools', 'execute_write_batch']) assert.equal(lastResult(context, name).isError, true);
        return call('render_Callout', { tone: 'warning', text: mode === 'fatal' ? '账户限制，未继续读取' : '写入结果未知，未重发', final: true });
      },
    ]);
    assert.equal(p.httpReads(), 1); assert.deepEqual(p.businessCalls, mode === 'fatal' ? ['get_subject_details', 'get_subject_comments'] : ['get_subject_details']);
    assert.equal(p.writeCalls(), mode === 'unknown' ? 1 : 0);
    const snapshot = result.entries.findLast(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').data;
    assert.equal(snapshot.status, 'completed'); assert.deepEqual(snapshot.content.map(part => part.type), ['SubjectCards', 'Callout']);
    const state = await p.f.state(mode), answer = state.items.filter(item => item.kind === 'assistant'); assert.equal(answer.length, 1); assert.deepEqual(state.liveContent, []);
    await p.f.post(mode, 'session', { action: 'new' }); await p.f.post(mode, 'session', { action: 'resume', sessionId: result.id });
    assert.deepEqual((await p.f.state(mode)).items.filter(item => item.kind === 'assistant').map(item => item.content), [answer[0].content]);
  });
});

test('业务恢复与host参数失败共享原预算，持续坏参数仍保留审计和稳定prefix而停止', async t => {
  const p = await production(t, 'input', 1); let ref;
  const result = await p.run([initial(), context => { ref = refFrom(context); return batch(['render_SubjectCards', { resourceRef: ref, subjectIds: [1] }], ['get_subject_comments', { subject_id: 1, limit: 21 }]); },
    call('render_SubjectCards', { resourceRef: 'rr_missing', subjectIds: [2], layout: 'invalid' }),
    ...Array.from({ length: 8 }, () => call('render_SubjectCards', { resourceRef: 'rr_missing', subjectIds: [2], layout: 'invalid' })),
  ]);
  assert.equal(p.faux.state.callCount, 3); assert.equal(p.httpReads(), 1);
  const snapshot = result.entries.findLast(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').data;
  assert.equal(snapshot.status, 'error'); assert.equal(snapshot.content.length, 1); assert.equal(snapshot.content[0].type, 'SubjectCards');
  assert.ok(result.entries.some(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'render_SubjectCards' && entry.message.isError));
});
