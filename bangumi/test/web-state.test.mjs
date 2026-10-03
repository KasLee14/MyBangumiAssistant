import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_SCALARS, streamReducer } from '../../web/src/store/reducers/stream.ts';
import { uiReducer } from '../../web/src/store/reducers/ui.ts';

const frame = (sessionId, revision, text, full = true, instanceId = 'host-1') => ({
  type: 'stream/frame', frame: { type: 'state', instanceId, revision, full,
    state: { ...INITIAL_SCALARS, sessionId, ready: true },
    items: [{ id: 1, version: revision, kind: 'user', text }] },
});

test('同编号的不同会话不合并，迟到的 HTTP/SSE 帧不能切回旧会话', () => {
  let state = streamReducer(undefined, frame('a', 1, 'A'));
  state = streamReducer(state, frame('b', 3, 'B', false));
  assert.deepEqual(state.items.map(item => item.text), ['B']);
  const latest = state;
  state = streamReducer(state, frame('a', 2, '旧A'));
  assert.equal(state, latest);
  state = streamReducer(state, frame('b', 4, '新B', false));
  assert.deepEqual(state.items.map(item => item.text), ['新B']);
});

test('宿主重启后的新实例可以接受重新从零开始的版本号', () => {
  const before = streamReducer(undefined, frame('a', 100, '重启前'));
  const after = streamReducer(before, frame('a', 0, '重启后', true, 'host-2'));
  assert.equal(after.revision, 0);
  assert.deepEqual(after.items.map(item => item.text), ['重启后']);
});

test('发送失败只恢复原会话草稿，不覆盖另一会话或用户的新输入', () => {
  let state = uiReducer(undefined, { type: 'ui/draft', sessionId: 'b', text: 'B的草稿' });
  state = uiReducer(state, { type: 'ui/draftRestore', sessionId: 'a', text: '失败的A' });
  assert.deepEqual(state.drafts, { a: '失败的A', b: 'B的草稿' });
  state = uiReducer(state, { type: 'ui/draft', sessionId: 'a', text: 'A的新输入' });
  state = uiReducer(state, { type: 'ui/draftRestore', sessionId: 'a', text: '旧输入' });
  assert.equal(state.drafts.a, 'A的新输入');
});
