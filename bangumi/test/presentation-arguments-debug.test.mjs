import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { setToolCallArgumentSource } from '@earendil-works/pi-ai';
import { createAdvancedBangumiExtension as createBangumiExtension } from './advanced-presentation-fixture.mjs';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { registerCredentials } from '../dist/src/support/errors.js';

test('展示修复/拒绝原参数仅保存脱敏本地debug，保留重复键/空白且公开审计不泄漏', async t => {
  const root = mkdtempSync(join(tmpdir(), 'presentation-raw-debug-')), traceDir = join(root, 'tracelog');
  const secret = `presentation-registered-credential-${randomUUID()}`; registerCredentials([secret]);
  const duplicate = ` \n { "text": "一", "text": "二", "extra": "${secret}" }\t`;
  const repaired = ' \n { "text": "修复后公开说明" \t';
  const unfinished = '{"text":"' + secret.slice(0, -3);
  const scriptedCall = (id, raw) => {
    const call = fauxToolCall('present_text', { text: '原生预解析占位' }, { id });
    setToolCallArgumentSource(call, { raw, state: 'complete', source: 'terminal_response' });
    return fauxAssistantMessage([call], { stopReason: 'toolUse' });
  };
  let providerInput;
  const faux = fauxProvider({ api: 'openai-completions', provider: 'presentation-raw-debug' });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('present_text', { text: '正常公开说明' }, { id: 'accepted' })], { stopReason: 'toolUse' }),
    scriptedCall('duplicate', duplicate), scriptedCall('repaired', repaired), scriptedCall('unfinished', unfinished),
    context => { providerInput = JSON.stringify(context); return fauxAssistantMessage('最终说明。'); },
  ]);
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider); await modelRuntime.setRuntimeApiKey(faux.getModel().provider, 'offline-placeholder');
  const manager = SessionManager.create(root, join(root, 'sessions')); manager.appendSessionInfo('展示原参数debug测试');
  const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, sessionManager: manager, modelRuntime, provider: faux.getModel().provider, model: 'faux-1',
    extension: createBangumiExtension({ authDir: join(root, 'auth'), timeoutMs: 1000, proxy: null, trace: { directory: traceDir },
      client: { call: async () => { throw Error('不访问上游'); } }, generateSessionTitle: async () => null,
      channel: { canConfirm: () => false, canLogin: () => false, notify: () => {} },
    }) });
  t.after(async () => { await runtime.dispose(); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  runtime.session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 2, provider: { maxRetries: 0 } } });
  await runtime.session.prompt('验证展示参数的本地debug'); await runtime.session.waitForIdle();
  const file = readdirSync(traceDir, { recursive: true }).find(file => file.endsWith('events.jsonl')); assert.ok(file);
  const directory = resolve(join(traceDir, file), '..'), events = readFileSync(join(traceDir, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const debugEvents = events.filter(event => event.event === 'presentation.arguments_debug');
  assert.deepEqual(debugEvents.map(event => event.data.toolCallId), ['duplicate', 'repaired', 'unfinished']);
  const payload = event => JSON.parse(readFileSync(join(directory, event.data.debug_ref.path), 'utf8'));
  const duplicateDebug = payload(debugEvents[0]); assert.equal(duplicateDebug.rawArguments, duplicate.replace(secret, '[REDACTED]'));
  assert.equal((duplicateDebug.rawArguments.match(/"text"/g) ?? []).length, 2);
  assert.equal(payload(debugEvents[1]).rawArguments, repaired);
  assert.ok(payload(debugEvents[2]).rawArguments.endsWith('[PARTIAL_REDACTED]'));
  assert.equal(duplicateDebug.offsetBasis, 'original_raw_before_redaction');
  const branch = manager.buildContextEntries(), audits = branch.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation_arguments');
  const publicAudit = JSON.stringify(audits); assert.equal(publicAudit.includes('rawArguments'), false); assert.equal(publicAudit.includes('debug_ref'), false);
  assert.equal(publicAudit.includes(secret), false); assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(providerInput.includes('rawArguments'), false); assert.equal(providerInput.includes('debug_ref'), false); assert.equal(providerInput.includes(duplicate), false); assert.equal(providerInput.includes(secret), false);
  const canonical = branch.filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/presentation').at(-1).data;
  assert.equal(canonical.status, 'completed'); assert.deepEqual(canonical.content.map(part => part.text), ['正常公开说明', '修复后公开说明', '最终说明。']);
});
