import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeReadRecovery, diagnoseReadError, checkReadDiagnosis, clearReadRecoveryScope } from '../dist/src/mcp/read-recovery.js';
import { AppError, safeError } from '../dist/src/support/errors.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { validateToolArguments } from '../dist/src/mcp/catalog.js';
import { createBangumiExtension } from '../dist/src/extension.js';

test('固定只读暂时失败仅重试一次，成功后保留自由继续取数', async () => {
  let count = 0;
  const result = await executeReadRecovery('get_subject_details', { subject_id: 1 }, async () => {
    if (++count === 1) throw new AppError('BGM_NETWORK', '固定失败'); return { id: 1 };
  }, { turnId: 'read-retry', retryDelayMs: 0 });
  assert.equal(count, 2); assert.equal(result.id, 1); clearReadRecoveryScope('read-retry');
});

test('未知写入与未知工具即便网络失败也永不重发', async () => {
  for (const name of ['update_subject_collection', 'unknown_local_tool']) {
    let count = 0;
    await assert.rejects(executeReadRecovery(name, { subject_id: 1 }, async () => { count++; throw new AppError('BGM_NETWORK', '失败'); }, { retryDelayMs: 0 }), error => {
      assert.equal(error.diagnosis.retryable, false); assert.equal(error.diagnosis.replanAllowed, false); return true;
    });
    assert.equal(count, 1);
  }
});

test('能力障碍不因关键词/offset/limit改变而重复派发，新来源或实质参数允许', async () => {
  let count = 0; const turnId = 'capability-test';
  const fail = async () => { count++; throw new AppError('SEARCH_CAPABILITY_UNSUPPORTED', '失败'); };
  const first = { keyword: '第一', filter: { nsfw: 'account', air_date: { min: '2025-01-01' } }, offset: 0, limit: 20 };
  await assert.rejects(executeReadRecovery('search_subjects', first, fail, { turnId }));
  await assert.rejects(executeReadRecovery('search_subjects', { ...first, keyword: '第二', offset: 20, limit: 30 }, fail, { turnId }));
  assert.equal(count, 1);
  await executeReadRecovery('search_subjects', { ...first, filter: { ...first.filter, nsfw: 'exclude' } }, async () => { count++; return []; }, { turnId });
  await executeReadRecovery('search_subjects', { ...first, filter: { ...first.filter, air_date: { min: '2024-01-01' } } }, async () => { count++; return []; }, { turnId });
  assert.equal(count, 3); clearReadRecoveryScope(turnId);
});

test('响应契约失败仅阻止完全相同请求，独立新对象和关键词可继续取证', async () => {
  const turnId = 'contract-test'; let count = 0;
  const fail = async () => { count++; throw new AppError('MCP_INVALID_RESULT', '固定失败'); };
  await assert.rejects(executeReadRecovery('search_subjects', { keyword: '第一' }, fail, { turnId }));
  await assert.rejects(executeReadRecovery('search_subjects', { keyword: '第一' }, fail, { turnId }));
  await assert.rejects(executeReadRecovery('search_subjects', { keyword: '第二' }, fail, { turnId }));
  assert.equal(count, 2);
  clearReadRecoveryScope(turnId);
  await assert.rejects(executeReadRecovery('search_subjects', { keyword: '第一' }, fail, { turnId }));
  assert.equal(count, 3); clearReadRecoveryScope(turnId);
});

test('取消在重试等待中立即停止并清理任务，不再派发', async () => {
  const turnId = 'cancel-test'; const abort = new AbortController(); let count = 0;
  const operation = async () => { count++; throw new AppError('BGM_TIMEOUT', '失败'); };
  const pending = executeReadRecovery('get_subject_details', { subject_id: 1 }, operation, { turnId, signal: abort.signal, retryDelayMs: 1000 });
  setTimeout(() => abort.abort(), 5);
  await assert.rejects(pending, error => error.code === 'CANCELLED'); assert.equal(count, 1);
  await executeReadRecovery('get_subject_details', { subject_id: 1 }, async () => { count++; return {}; }, { turnId });
  assert.equal(count, 2); clearReadRecoveryScope(turnId);
});

test('参数准备阶段提供可解析JSON固定合法值，严格校验仍然失败且没有调用', () => {
  let calls = 0;
  const tool = createReadTools({ call: async () => { calls++; return {}; }, close: async () => {} }).find(item => item.name === 'browse_subjects');
  assert.throws(() => tool.prepareArguments({ subject_type: 2, sort: 'score', keyword: 'hidden-value' }), error => {
    const result = JSON.parse(error.message).error;
    assert.equal(result.code, 'INVALID_INPUT'); assert.equal(result.networkAttempted, false);
    assert.equal(result.diagnosis.category, 'input');
    assert.deepEqual(result.diagnosis.allowedValues.find(item => item.field === '/sort').values, ['date', 'rank']);
    assert.equal(error.message.includes('hidden-value'), false); return true;
  });
  assert.equal(calls, 0);
  assert.deepEqual(validateToolArguments('get_current_user', {}), { check_nsfw: false });
});

test('远端不能加入任意能力建议、工具名或伪造重试权限', () => {
  const args = { subject_id: 1 }; const error = new AppError('BGM_HTTP_404', '固定消息');
  const expected = diagnoseReadError('get_subject_details', args, error).diagnosis;
  assert.equal(expected.category, 'not_found');
  for (const forged of [{ ...expected, retryable: true }, { ...expected, capabilitySuggestions: ['run_remote_tool'] }, { ...expected, blockedFields: ['/unknown_secret'] }]) {
    assert.throws(() => checkReadDiagnosis('get_subject_details', args, new AppError('BGM_HTTP_404', '固定消息'), forged), issue => issue.code === 'MCP_INVALID_RESULT');
  }
  assert.equal(safeError(error).diagnosis.category, 'not_found');
  for (const code of ['NSFW_UNAVAILABLE', 'NSFW_SCOPE_CHANGED']) {
    const diagnosed = diagnoseReadError('get_subject_details', args, new AppError(code, '固定权限缺口'));
    assert.equal(diagnosed.diagnosis.category, 'capability');
    assert.equal(diagnosed.diagnosis.retryable, false);
  }
});

test('本人认证障碍不换关键词绕过，但公共SFW与新真实用户轮次仍可继续', async () => {
  let calls = 0; const turnId = 'auth-fingerprint';
  const fail = async () => { calls++; throw new AppError('BGM_AUTH_EXPIRED', '失败'); };
  await assert.rejects(executeReadRecovery('get_user_collections', { username: '-', offset: 0 }, fail, { turnId }));
  await assert.rejects(executeReadRecovery('get_user_subject_collection', { username: '-', subject_id: 99 }, fail, { turnId }));
  assert.equal(calls, 1);
  await executeReadRecovery('search_subjects', { keyword: '新作品' }, async () => { calls++; return []; }, { turnId });
  assert.equal(calls, 2); clearReadRecoveryScope(turnId);
});

test('extension同一真实用户任务复用turnId，结束清理，新输入换范围', async () => {
  const events = new Map(); const tools = new Map(); const calls = []; const ended = [];
  const client = { call: async (...args) => { calls.push(args); throw new AppError('BGM_HTTP_404', '固定失败'); },
    endReadContext: async turnId => { ended.push(turnId); }, close: async () => {} };
  createBangumiExtension({ authDir: 'unused', timeoutMs: 1000, proxy: null, client })({
    on: (event, handler) => { const rows = events.get(event) ?? []; rows.push(handler); events.set(event, rows); },
    registerTool: tool => tools.set(tool.name, tool), registerCommand: () => {}, appendEntry: () => {},
    getSessionName: () => 'offline test', setSessionName: () => {},
  });
  const emit = async (event, payload = {}) => { for (const handler of events.get(event) ?? []) await handler(payload, {}); };
  const read = tools.get('get_current_user');
  await emit('input', { source: 'interactive', text: '核实账户' });
  await read.execute('first', {}, undefined, undefined, {});
  await read.execute('second', {}, undefined, undefined, {});
  const first = calls[0][5].turnId;
  assert.equal(calls[1][5].turnId, first);
  await emit('input', { source: 'extension', text: '内部继续' });
  await read.execute('continued', {}, undefined, undefined, {});
  assert.equal(calls[2][5].turnId, first);
  await emit('agent_settled'); assert.deepEqual(ended, [first]);
  await emit('input', { source: 'rpc', text: '重新核实' });
  await read.execute('new', {}, undefined, undefined, {});
  assert.notEqual(calls[3][5].turnId, first);
  await emit('session_shutdown'); assert.equal(ended.length, 2);
});
