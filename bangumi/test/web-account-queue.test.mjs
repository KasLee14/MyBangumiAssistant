import assert from 'node:assert/strict';
import test from 'node:test';
import { createBangumiExtension } from '../dist/src/extension.js';
import { TaskQueue } from '../dist/src/support/task-queue.js';
import { deferred, eventually } from './web-fixture.mjs';

function extension(queue, call, clear = async () => {}) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  createBangumiExtension({ authDir: 'unused-offline', timeoutMs: 1000, proxy: null, accountQueue: queue,
    client: { call, close: async () => {} }, store: { clear },
    channel: { canLogin: () => true, canConfirm: () => true, notify: () => {} },
  })({
    registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, command) => commands.set(name, command),
    on: (event, listener) => { events.set(event, [...events.get(event) ?? [], listener]); },
    getSessionName: () => '离线队列测试', appendEntry: () => {},
  });
  return { tool: tools.get('execute_write_batch'), commands,
    input: text => { for (const handler of events.get('input')) handler({ source: 'user', text }, {}); } };
}
const args = { operations: [{ tool: 'create_index', args: { title: '离线测试目录', description: '' } }] };

test('生产扩展共享队列：完整写入流程结束前，其他会话和登出不会开始', async () => {
  const queue = new TaskQueue();
  const release = deferred();
  const calls = [];
  const first = extension(queue, async (name, _args, _signal, _guard, scope) => {
    calls.push('a:' + name + ':' + scope.phase); await release.promise; throw new Error('离线模拟读取失败');
  });
  const second = extension(queue, async (name, _args, _signal, _guard, scope) => {
    calls.push('b:' + name + ':' + scope.phase); throw new Error('离线模拟读取失败');
  }, async () => { calls.push('logout'); });
  first.input('创建目录A'); second.input('创建目录B');
  const a = first.tool.execute('a', args, undefined, undefined, {});
  const b = second.tool.execute('b', args, undefined, undefined, {});
  const logout = second.commands.get('bangumi-logout').handler('', {});
  await eventually(() => calls.length === 1);
  assert.deepEqual(calls, ['a:get_current_user:prepare']);
  release.resolve();
  const results = await Promise.all([a, b, logout]);
  assert.equal(results[0].details.value.state, 'failed');
  assert.equal(results[1].details.value.state, 'failed');
  // 现有批次在 finally 释放宿主上下文；清理也必须在同一队列槽中结束。
  assert.deepEqual(calls, ['a:get_current_user:prepare', 'a:get_current_user:close',
    'b:get_current_user:prepare', 'b:get_current_user:close', 'logout']);
});

test('排队期间用户输入改变时，旧计划不读取账户也不提交', async () => {
  const queue = new TaskQueue();
  const release = deferred();
  const blocking = queue.run(() => release.promise);
  let calls = 0;
  const ext = extension(queue, async () => { calls++; throw new Error('不应调用'); });
  ext.input('创建目录');
  const pending = ext.tool.execute('stale', args, undefined, undefined, {});
  ext.input('取消旧计划');
  const rejected = assert.rejects(pending, error => error.code === 'STALE_PREVIEW');
  release.resolve();
  await Promise.all([blocking, rejected]);
  assert.equal(calls, 0);
});
