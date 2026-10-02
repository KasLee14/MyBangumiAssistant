import test from 'node:test';
import assert from 'node:assert/strict';
import { chatFixture } from '../fixtures/chat-fixture.js';
import type { Message } from '../../src/core/types.js';
import { SessionLog } from '../../src/storage/session.js';
import { ReadTools } from '../../src/tools/read-tools.js';

const call = (name: string, args: object): Extract<Message, { role: 'assistant' }> => ({ role: 'assistant', content: null,
  tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

for (const answer of ['第一项', '1', '葬送的芙莉莲', '/select c1 1']) {
  test(`评分查询消歧：${answer} 自动续接原问题，返回已完成与8分，无写入`, async t => {
    const f = await chatFixture(t); let reads = 0; let requests = 0;
    f.collections.set(1, { ...f.collections.get(1)!, status: 2, rate: 8, chapters: 28 });
    const original = f.client.collection; f.client.collection = async id => { reads++; return original(id); };
    f.handler = async (messages, options) => {
      requests++;
      const last = messages.at(-1)!;
      if (last.role === 'user' && last.content.includes('多少分')) return call('search_subjects', { keyword: '葬送的芙莉莲', type: 'anime' });
      if (last.role === 'tool' && last.tool_call_id === 'search_subjects') return call('request_subject_selection', { question: '你想查询哪部作品的评分？' });
      if (last.role === 'user') {
        assert.equal(last.content, answer); assert.match(messages[0]!.content!, /立即继续历史/);
        assert.ok(messages.some(message => message.role === 'user' && message.content === '我给葬送的芙莉莲打了多少分？'));
        return call('get_collection', { subjectId: 1 });
      }
      assert.ok(last.role === 'tool'); const value = JSON.parse(last.content).data;
      assert.equal(value.status, 2); assert.match(value.statusMeaning, /已完成.*看过/); assert.equal(value.rate, 8);
      const content = '你的评分为8分，收藏状态为看过。'; options.onText?.(content); return { role: 'assistant', content };
    };
    await f.controller.initialize(); await f.controller.submit('我给葬送的芙莉莲打了多少分？');
    assert.equal(reads, 0); assert.equal(requests, 2); assert.ok(!f.controller.snapshot().busy);
    assert.ok(f.controller.snapshot().items.some(item => item.kind === 'assistant' && item.text.includes('回答后继续原任务')));
    await f.controller.submit(answer);
    assert.equal(reads, 1); assert.equal(requests, 4); assert.equal(f.controller.snapshot().focus, '葬送的芙莉莲');
    assert.ok(f.controller.snapshot().items.some(item => item.kind === 'assistant' && item.text.includes('收藏状态为看过')));
    assert.equal(f.writes.length, 0);
    const messages = await new SessionLog(f.paths.sessions, f.controller.snapshot().sessionId).messages();
    assert.deepEqual(messages.filter(message => message.role === 'user').map(message => message.content), ['我给葬送的芙莉莲打了多少分？', answer]);
  });
}

test('旧式文字追问也能续接；换话题拒绝后不会继续旧评分查询', async t => {
  const f = await chatFixture(t); let queries = 0;
  f.handler = async messages => {
    const last = messages.at(-1)!;
    if (last.role === 'user' && last.content.includes('多少分')) return call('search_subjects', { keyword: '芙莉莲' });
    if (last.role === 'tool') return { role: 'assistant', content: '请回复编号（或完整名称），我再查询你的收藏评分。' };
    queries++; return { role: 'assistant', content: '继续评分查询。' };
  };
  await f.controller.initialize(); await f.controller.submit('我给芙莉莲打了多少分？'); await f.controller.submit('第一项');
  assert.equal(queries, 1);
  await f.controller.submit('我给芙莉莲打了多少分？'); await f.controller.submit('帮我算一下数学题'); await f.controller.submit('第一项');
  assert.equal(queries, 1); assert.equal(f.writes.length, 0);
});

test('结构化追问不执行同批后续工具，旧候选清单与越界编号不得用于续接', async t => {
  const f = await chatFixture(t); let reads = 0; f.client.collection = async () => { reads++; throw new Error('不应读取'); };
  f.handler = async messages => messages.at(-1)?.role === 'user' ? call('search_subjects', { keyword: '芙莉莲' })
    : { role: 'assistant', content: null, tool_calls: [...call('request_subject_selection', { question: '选择哪一部？' }).tool_calls!, ...call('get_collection', { subjectId: 1 }).tool_calls!] };
  await f.controller.initialize(); await f.controller.submit('查一下评分'); assert.equal(reads, 0);
  await f.controller.submit('/select c99 1'); assert.equal(reads, 0); assert.equal(f.controller.snapshot().focus, null);
  await f.controller.submit('第99项'); assert.equal(reads, 0); assert.equal(f.writes.length, 0);
});

test('收藏状态语义覆盖1～5和未知，进度工具使用同一含义，不增加账户查询', async t => {
  const f = await chatFixture(t); const tools = new ReadTools(f.client); let accounts = 0;
  f.client.currentUser = async () => { accounts++; throw new Error('无需查询账户'); };
  for (const [status, meaning] of [[1, '计划'], [2, '已完成'], [3, '进行中'], [4, '搁置'], [5, '抛弃'], [null, '未知']] as const) {
    f.collections.set(1, { ...f.collections.get(1)!, status });
    const result = await tools.execute('get_collection', { subjectId: 1 }) as { status: number | null; statusMeaning: string };
    assert.equal(result.status, status); assert.ok(result.statusMeaning.includes(meaning));
    const progress = await tools.execute('get_progress', { subjectId: 1 }) as { collection: typeof result };
    assert.deepEqual(progress.collection, result);
  }
  assert.equal(accounts, 0); assert.equal(f.writes.length, 0);
});
