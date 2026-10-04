import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { TaskQueue } from '../dist/src/support/task-queue.js';
import { deferred, eventually, fixture } from './web-fixture.mjs';

test('新建和切换不会取消旧任务，两个会话都可完成并独立落盘', async t => {
  const f = await fixture(t);
  const a = (await f.state('tab-a')).sessionId;
  const gateA = await f.begin('tab-a', a, '任务A');
  const b = (await f.post('tab-a', 'session', { action: 'new' })).state.sessionId;
  assert.equal(gateA.aborted, false);
  assert.equal(f.runtimes.get(a).session.isStreaming, true);
  const gateB = await f.begin('tab-a', b, '任务B');
  assert.equal(f.runtimes.get(a).session.isStreaming && f.runtimes.get(b).session.isStreaming, true);
  await f.post('tab-a', 'session', { action: 'resume', sessionId: a });
  assert.equal(gateA.aborted || gateB.aborted, false);
  assert.deepEqual(f.shutdowns, []);
  gateB.release.resolve();
  gateA.release.resolve();
  await Promise.all([f.runtimes.get(a).session.waitForIdle(), f.runtimes.get(b).session.waitForIdle()]);
  for (const [id, marker] of [[a, '任务A'], [b, '任务B']]) {
    const snapshot = await f.state('tab-a', id);
    assert.ok(snapshot.items.some(item => item.kind === 'assistant' && item.text === `完成：${marker}`));
    const saved = SessionManager.open(f.runtimes.get(id).session.sessionFile).getEntries();
    assert.equal(saved.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message.stopReason, 'stop');
  }
});

test('多个标签页独立选择，SSE 切换发送完整快照，条目编号相同也不串会话', async t => {
  const f = await fixture(t);
  const streamA = await f.stream('tab-a');
  const streamB = await f.stream('tab-b');
  const a = (await f.state('tab-a')).sessionId;
  await f.begin('tab-a', a, '多标签A');
  const b = (await f.post('tab-a', 'session', { action: 'new' })).state.sessionId;
  await f.begin('tab-a', b, '多标签B');
  assert.equal((await f.state('tab-b')).sessionId, a);
  await eventually(() => streamA.frames.some(frame => frame.type === 'state' && frame.state.sessionId === b && frame.items.some(item => item.text === '多标签B')));
  assert.equal(streamB.frames.some(frame => frame.type === 'state' && frame.state.sessionId === b), false);
  await f.post('tab-a', 'session', { action: 'resume', sessionId: a });
  await eventually(() => streamA.frames.some(frame => frame.type === 'state' && frame.full && frame.state.sessionId === a
    && frame.items.some(item => item.text === '多标签A')));
  assert.ok(streamA.frames.some(frame => frame.type === 'sessions' && frame.sessions.filter(session => session.busy).length === 2));
});

test('停止只作用于明确指定的会话，未知会话和未指定会话不能误取消', async t => {
  const f = await fixture(t);
  const a = (await f.state('tab')).sessionId;
  const gateA = await f.begin('tab', a, '停止A');
  const b = (await f.post('tab', 'session', { action: 'new' })).state.sessionId;
  const gateB = await f.begin('tab', b, '停止B');
  assert.equal((await f.request('tab', 'cancel', {})).status, 400);
  assert.equal((await f.request('tab', 'cancel', {}, 'unknown')).status, 400);
  assert.equal(gateA.aborted || gateB.aborted, false);
  await f.post('tab', 'cancel', {}, a);
  assert.equal(gateA.aborted, true);
  assert.equal(gateB.aborted, false);
  assert.equal(f.runtimes.get(b).session.isStreaming, true);
});

test('后台确认跨切换保留，确认 ID 不能在另一会话使用，断线仍拒绝写入', async t => {
  const f = await fixture(t);
  const connection = await f.stream('tab');
  const a = (await f.state('tab')).sessionId;
  const confirmation = f.manager.get(a).requestConfirmation('修改A', undefined);
  const view = f.manager.get(a).snapshot().pending;
  const id = view.id;
  assert.equal(view.title, '操作授权');
  assert.equal(view.confirmLabel, '确认授权');
  assert.equal(view.preview, '修改A');
  assert.equal(view.hint, '授权仅用于本次列出的操作。');
  const b = (await f.post('tab', 'session', { action: 'new' })).state.sessionId;
  assert.equal(f.manager.get(a).snapshot().pending.id, id);
  assert.equal((await f.request('tab', 'confirm', { id, accepted: true }, b)).status, 400);
  await f.post('tab', 'session', { action: 'resume', sessionId: a });
  await f.post('tab', 'confirm', { id, accepted: true }, a);
  assert.equal(await confirmation, true);
  const second = f.manager.get(a).requestConfirmation('修改A2', undefined);
  connection.stop();
  await eventually(() => f.manager.get(a).snapshot().pending === null);
  assert.equal(await second, false);
  assert.throws(() => f.manager.get(b).requestConfirmation('未连接', undefined), /没有已连接/);
});

test('未落盘和内存会话也可按 ID 切回，无效恢复保留原会话', async t => {
  const f = await fixture(t, { persisted: false });
  const a = (await f.state('tab')).sessionId;
  const b = (await f.post('tab', 'session', { action: 'new' })).state.sessionId;
  assert.notEqual(a, b);
  await f.post('tab', 'session', { action: 'resume', sessionId: a });
  assert.equal((await f.state('tab')).sessionId, a);
  assert.equal((await f.request('tab', 'session', { action: 'resume', path: join(f.root, 'outside.jsonl') })).status, 400);
  assert.equal((await f.state('tab')).sessionId, a);
  assert.equal(f.runtimes.size, 2);
});

test('历史文件并发恢复与 Windows 大小写路径只创建一个运行时', async t => {
  const f = await fixture(t);
  const saved = SessionManager.create(f.root, f.sessionDir);
  saved.appendMessage({ role: 'user', content: '历史会话', timestamp: Date.now() });
  saved.appendMessage(fauxAssistantMessage('历史回答'));
  const release = deferred();
  f.creation.before = () => release.promise;
  const path = saved.getSessionFile();
  const first = f.manager.select('one', 'resume', { path });
  const second = f.manager.select('two', 'resume', { path: process.platform === 'win32' ? path.toUpperCase() : path });
  await eventually(() => f.creation.count === 2);
  await delay(30);
  assert.equal(f.creation.count, 2);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(f.manager.selected('one').id, saved.getSessionId());
  assert.equal(f.manager.selected('two').id, saved.getSessionId());
  assert.equal(f.runtimes.size, 2);
  assert.ok(f.manager.selected('one').snapshot().items.some(item => item.text === '历史回答'));
});

test('快速连续切换以最后一次为准，运行时创建失败保留原会话', async t => {
  const f = await fixture(t);
  const a = f.manager.selected('tab').id;
  const release = deferred();
  f.creation.before = () => release.promise;
  const slow = f.manager.select('tab', 'new');
  await eventually(() => f.creation.count === 2);
  await f.manager.select('tab', 'resume', { id: a });
  release.resolve();
  await slow;
  assert.equal(f.manager.selected('tab').id, a);
  f.creation.before = async () => { throw new Error('模拟创建失败'); };
  await assert.rejects(f.manager.select('tab', 'new'), /模拟创建失败/);
  assert.equal(f.manager.selected('tab').id, a);
  assert.equal(f.runtimes.size, 2);
});

test('关闭期间正在创建的会话也会释放，重复关闭不会重复触发 shutdown', async t => {
  const f = await fixture(t);
  const release = deferred();
  f.creation.before = () => release.promise;
  const opening = f.manager.select('tab', 'new');
  const rejected = assert.rejects(opening, /正在关闭/);
  await eventually(() => f.creation.count === 2);
  const closing = f.manager.dispose();
  release.resolve();
  await Promise.all([rejected, closing]);
  await f.manager.dispose();
  assert.equal(f.runtimes.size, 2);
  assert.equal(f.shutdowns.length, 2);
  assert.equal(new Set(f.shutdowns).size, 2);
});

test('同一路径并发恢复只创建一个运行时，关闭服务会停止所有后台任务', async t => {
  const f = await fixture(t);
  const a = (await f.state('tab')).sessionId;
  const gate = await f.begin('tab', a, '持久会话');
  gate.release.resolve();
  await f.initial.session.waitForIdle();
  const file = f.initial.session.sessionFile;
  await Promise.all(['one', 'two'].map(client => f.post(client, 'session', { action: 'resume', path: file })));
  assert.equal(f.runtimes.size, 1);
  const gateA = await f.begin('one', a, '关闭A');
  const b = (await f.post('two', 'session', { action: 'new' })).state.sessionId;
  const gateB = await f.begin('two', b, '关闭B');
  await f.manager.dispose();
  assert.equal(gateA.aborted && gateB.aborted, true);
  assert.deepEqual(new Set(f.shutdowns), new Set([a, b]));
});

test('账户操作排队：取消等待任务不会执行，也不会提前放行后面的任务', async () => {
  const queue = new TaskQueue();
  const release = deferred();
  const sequence = [];
  const first = queue.run(async () => { sequence.push('first'); await release.promise; });
  const abort = new AbortController();
  const cancelled = queue.run(async () => { sequence.push('cancelled'); }, abort.signal);
  const third = queue.run(async () => { sequence.push('third'); });
  abort.abort();
  await assert.rejects(cancelled, /操作已取消/);
  assert.deepEqual(sequence, ['first']);
  release.resolve();
  await Promise.all([first, third]);
  assert.deepEqual(sequence, ['first', 'third']);
});
