import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { createAdvancedBangumiExtension as createBangumiExtension } from './advanced-presentation-fixture.mjs';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { fixture } from './web-fixture.mjs';

test('展示参数持续失败按当前重试预算停止，保留已发布前缀及相同历史终态', async t => {
  const f = await fixture(t, { additionalExtension: pi => createBangumiExtension({
    authDir: tmpdir(), timeoutMs: 1000, proxy: null,
    client: { call: async () => { throw Error('离线验收不访问上游'); } },
    generateSessionTitle: async () => null,
    channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
  })(pi) });
  f.initial.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, provider: { maxRetries: 0 } } });
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-budget' });
  const call = args => fauxAssistantMessage([fauxToolCall('present_text', args)], { stopReason: 'toolUse' });
  faux.setResponses([call({ text: '已完成前缀' }), ...Array.from({ length: 10 }, () => call({ text: 123 }))]);
  f.initial.session.modelRuntime.registerNativeProvider(withProviderFetch(faux.provider));
  await f.initial.session.modelRuntime.setRuntimeApiKey('presentation-budget', 'offline');
  await f.initial.session.setModel(faux.getModel());
  const id = (await f.state('budget')).sessionId;
  await f.post('budget', 'submit', { input: '展示说明，持续失败应停止' }, id);
  await f.initial.session.waitForIdle();
  assert.equal(faux.state.callCount, 3, '一次初始失败和一次纠参失败后不再请求模型');
  const snapshots = f.initial.session.sessionManager.buildContextEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation');
  assert.equal(snapshots.at(-1).data.status, 'error');
  const state = await f.state('budget');
  assert.equal(state.liveContent.length, 0);
  const completed = state.items.filter(item => item.kind === 'assistant').map(item => item.content);
  assert.deepEqual(completed, [[{ type: 'text', text: '已完成前缀' }]]);
  await f.post('budget', 'session', { action: 'new' });
  await f.post('budget', 'session', { action: 'resume', sessionId: id });
  assert.deepEqual((await f.state('budget')).items.filter(item => item.kind === 'assistant').map(item => item.content), completed);
});
