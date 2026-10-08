import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';
import { getCurrentTools } from '@earendil-works/pi-ai';

const response = value => fauxAssistantMessage(JSON.stringify({ content: value }));
const card = (resourceRef, id) => ({ type: 'SubjectCards', props: { resourceRef, items: [{ id }], layout: 'list' } });
const feedback = transcript => {
  const text = transcript.messages.filter(message => message.role === 'user').flatMap(message => typeof message.content === 'string' ? [message.content] : message.content.filter(part => part.type === 'text').map(part => part.text)).findLast(text => text.includes('host_recovery_feedback'));
  return text ? JSON.parse(text) : undefined;
};
async function fixture(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-resource-recovery-'));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } }));
  const faux = fauxProvider({ api: 'openai-responses', provider: `reference-recovery-${mode}`, tokenSize: { min: 1, max: 2 } });
  const calls = [], refs = new Map(); let oldRef;
  const service = new BangumiMcpService({ close: async () => {}, public: async path => { const id = Number(path.split('/').at(-1)); return { id, type: 2, name: `作品${id}`, name_cn: '', nsfw: false, summary: `简介${id}`, tags: [], infobox: [] }; } });
  const client = {
    call: async (...args) => { calls.push({ tool: args[0], args: args[1] }); const value = await service.call(...args); refs.set(args[1].subject_id, value.resourceRef); oldRef ??= args[1].subject_id === 2 ? value.resourceRef : undefined; return value; },
    readCachedResource: async (ref, signal, context) => {
      if (ref === oldRef) throw new AppError(mode === 'access' ? 'ACCOUNT_CHANGED' : 'RESOURCE_EXPIRED', '离线模拟缓存失效');
      return service.readCachedResource(ref, context, signal);
    },
    endReadContext: async turnId => service.endReadContext(turnId), close: async () => {},
  };
  const initial = fauxAssistantMessage([fauxToolCall('get_subject_details', { subject_id: 1 }, { id: 'one' }), fauxToolCall('get_subject_details', { subject_id: 2 }, { id: 'two' })], { stopReason: 'toolUse' });
  const expired = () => response([card(refs.get(1), 1), card(oldRef, 2)]);
  const retry = transcript => {
    const data = feedback(transcript); assert.equal(data.goal.strategy, 'replan_read'); assert.equal(data.referenceSource.tool, 'get_subject_details'); assert.equal(data.referenceSource.args.subject_id, 2);
    assert.equal(data.referenceSource.args.include, undefined);
    assert.deepEqual(data.referenceSource.memberIds, [2]); assert.equal(data.checkpoint.completedParts, 1);
    assert.deepEqual(getCurrentTools(transcript.messages).map(tool => tool.name).sort(), ['get_subject_details', 'read_component_index', 'read_component_spec'].sort());
    return fauxAssistantMessage([fauxToolCall('get_subject_details', { subject_id: mode === 'scope' ? 3 : 2 }, { id: `retry-${calls.length}` })], { stopReason: 'toolUse' });
  };
  const planned = mode === 'success' ? [initial, expired, retry, () => response([card(refs.get(2), 2)])]
    : mode === 'stuck' ? [initial, expired, retry, () => response([card(oldRef, 2)]), retry, () => response([card(oldRef, 2)])]
    : mode === 'scope' ? [initial, expired, retry, transcript => { assert.equal(feedback(transcript).goal.strategy, 'report_failure'); return response([{ type: 'text', text: '查询范围改变已被拒绝，保留已完成部分。' }]); }]
    : [initial, expired, transcript => { assert.equal(feedback(transcript).goal.strategy, 'report_failure'); return response([{ type: 'text', text: '账户已改变，仅保留已完成部分，未重新读取。' }]); }];
  // 这组测试关注引用恢复；先完成真实组件目录工具读取，随后保持原故障/恢复脚本。
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read_component_index', { query: 'SubjectCards' }, { id: 'index' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('read_component_spec', { names: ['SubjectCards'], representation: 'reference' }, { id: 'spec' })], { stopReason: 'toolUse' }),
    ...planned,
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false }); modelRuntime.registerNativeProvider(faux.provider); await modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline-placeholder');
  const manager = SessionManager.create(root, join(root, 'sessions')); manager.appendSessionInfo('引用恢复验证');
  const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, modelRuntime, sessionManager: manager, provider: faux.getModel().provider, model: 'faux-1', extension: createBangumiExtension({ authDir: join(root, 'auth'), timeoutMs: 1000, proxy: null, client, channel: { canConfirm: () => true, confirm: async () => true, canLogin: () => false, notify: () => {} } }) });
  t.after(async () => { await runtime.dispose(); await service.close(); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  await runtime.session.prompt('按1、2顺序显示作品卡片'); await runtime.session.waitForIdle();
  return { runtime, calls, faux, manager, records: manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/recovery').map(entry => entry.data), answer: manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message };
}

test('引用失效只重读原source原参数，新引用仅补未完成成员并保持canonical前缀及顺序', async t => {
  const f = await fixture(t, 'success');
  assert.equal(f.answer.stopReason, 'stop', JSON.stringify(f.answer.diagnostics));
  assert.deepEqual(f.answer.content.filter(part => part.type === 'SubjectCards').flatMap(part => part.props.items.map(item => item.id)), [1, 2]);
  assert.deepEqual(f.calls.map(call => call.args.subject_id), [1, 2, 2]);
  assert.equal(f.faux.state.callCount, 6); assert.ok(f.records.some(row => row.strategy === 'replan_read' && row.stage === 'scheduled'));
});

test('重复失效引用没有进展时受现有恢复预算限制并明确停止，不无限重取', async t => {
  const f = await fixture(t, 'stuck');
  assert.equal(f.answer.stopReason, 'error'); assert.equal(f.faux.state.callCount, 8);
  assert.deepEqual(f.calls.map(call => call.args.subject_id), [1, 2, 2, 2]);
  assert.ok(f.records.some(row => row.stage === 'stopped' && row.attempt <= 2));
});

test('账户变化不恢复读取权限，报告缺口且不再调用API或写工具', async t => {
  const f = await fixture(t, 'access');
  assert.equal(f.answer.stopReason, 'stop'); assert.deepEqual(f.calls.map(call => call.args.subject_id), [1, 2]);
  assert.ok(f.answer.content.some(part => part.type === 'text' && part.text.includes('账户已改变')));
  assert.ok(f.records.some(row => row.strategy === 'report_failure'));
});

test('恢复模型尝试改变原source成员时在RPC前被阻断，不扩大查询范围', async t => {
  const f = await fixture(t, 'scope');
  assert.deepEqual(f.calls.map(call => call.args.subject_id), [1, 2]);
  assert.ok(f.records.some(row => row.stage === 'reference_read_failed'));
});
