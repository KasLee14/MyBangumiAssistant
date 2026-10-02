import test from 'node:test';
import assert from 'node:assert/strict';
import { BgmReadClient } from '../../src/adapters/bgm-cli/client.js';
import { CollectionReader } from '../../src/core/collection-reader.js';
import { ReadTools } from '../../src/tools/read-tools.js';
import { AppError } from '../../src/domain/errors.js';

function rawData(count: number) { return Array.from({ length: count }, (_, i) => ({ id: i + 1, type: [1, 2, 3, 4, 6][i % 5], name: `作品${i + 1}`,
  interest: { type: Math.floor(i / 5) % 5 + 1, rate: i % 12 === 11 ? null : i % 12, private: i % 2 === 0 } })); }
function fixture(count: number, change?: (page: Record<string, unknown>, offset: number) => unknown) {
  const calls: readonly string[][] = []; const mutableCalls = calls as string[][]; const data = rawData(count); const account = { id: 7, username: 'fixture' };
  let identities = 0;
  const client = new BgmReadClient(async (args, signal) => {
    signal?.throwIfAborted(); mutableCalls.push([...args]);
    if (args[0] === 'user') { identities++; return account; }
    const options = Object.fromEntries(Array.from({ length: (args.length - 2) / 2 }, (_, i) => [args[i * 2 + 2], args[i * 2 + 3]]));
    const offset = Number(options['--offset']); const limit = Number(options['--limit']);
    const filtered = options['--type'] ? data.filter(row => row.type === ({ book: 1, anime: 2, music: 3, game: 4, real: 6 } as Record<string, number>)[options['--type']!]) : data;
    const page = { account, total: filtered.length, data: filtered.slice(offset, offset + limit), offset, limit };
    return change ? change(page, offset) : page;
  });
  return { client, calls: mutableCalls, get identities() { return identities; } };
}
test('超过前100项的五类完整汇总只返回统计；媒体筛选只统计所选范围', async () => {
  const f = fixture(125); const tools = new ReadTools(f.client);
  assert.ok(tools.schemas().some(schema => schema.function.name === 'get_collection_summary'));
  const result = await tools.execute('get_collection_summary', {}) as Awaited<ReturnType<CollectionReader['summary']>>;
  assert.equal(result.complete, true); assert.equal(result.fetched, 125); assert.equal(result.overall.statuses.completed, 25);
  for (const type of ['book', 'anime', 'music', 'game', 'real'] as const) assert.equal(result.byType[type].total, 25);
  assert.equal('data' in result, false); assert.equal(f.identities, 2);
  assert.deepEqual(f.calls.filter(args => args[0] === 'collection').map(args => args[5]), ['0', '100']);
  const anime = await new CollectionReader(f.client).summary('anime'); assert.equal(anime.overall.total, 25); assert.equal(anime.byType.book, undefined);
});
test('空列表、整页和10000项上限停止；10001项不返回汇总', async () => {
  for (const count of [0, 100, 200, 10000]) {
    const f = fixture(count); const result = await new CollectionReader(f.client).all(); assert.equal(result.data.length, count);
    assert.equal(f.calls.filter(args => args[0] === 'collection').length, Math.max(1, count / 100));
  }
  const excessive = fixture(10001); await assert.rejects(new CollectionReader(excessive.client).summary(), { code: 'BGM_COLLECTION_LIMIT' });
  assert.equal(excessive.calls.length, 2);
});
test('总数缺失/变化、缺页、重复、错偏移、错账户均拒绝完整汇总', async () => {
  for (const mode of ['missing', 'changed', 'short', 'duplicate', 'offset', 'account']) {
    const f = fixture(125, (page, offset) => {
      if (mode === 'missing') { delete page.total; return page; }
      if (!offset) return page;
      if (mode === 'changed') page.total = 124;
      if (mode === 'short') page.data = [];
      if (mode === 'duplicate') page.data = [...rawData(24), rawData(25)[24]];
      if (mode === 'offset') page.offset = 0;
      if (mode === 'account') page.account = { id: 8, username: 'other' };
      return page;
    });
    await assert.rejects(new CollectionReader(f.client).summary(), { code: mode === 'account' ? 'ACCOUNT_CHANGED' : 'INCOMPLETE_COLLECTION' });
    assert.ok(f.calls.filter(args => args[0] === 'collection').length <= 2);
  }
});
test('列表尾页、过滤错类型/错状态、未知字段和非法参数；模型页上限20', async () => {
  const f = fixture(25); const page = await new ReadTools(f.client).execute('list_collections', { offset: 20 }) as Awaited<ReturnType<BgmReadClient['collections']>>;
  assert.equal(page.complete, false); assert.equal(page.nextOffset, null); assert.equal(page.data.length, 5);
  const beyond = await f.client.collections({ offset: 100 }); assert.equal(beyond.complete, false); assert.equal(beyond.nextOffset, null);
  for (const value of [{ limit: 21 }, { offset: -1 }, { status: 2 }, { username: 'other' }, { type: null }]) await assert.rejects(new ReadTools(f.client).execute('list_collections', value), { code: 'INVALID_INPUT' });
  await assert.rejects(new ReadTools(f.client).execute('get_collection_summary', { status: 'completed' }), { code: 'INVALID_INPUT' });
  const wrong = new BgmReadClient(async () => ({ account: { id: 7, username: 'fixture' }, total: 1, data: rawData(1) }));
  await assert.rejects(wrong.collections({ type: 'anime' }), { code: 'INCOMPLETE_COLLECTION' });
  await assert.rejects(wrong.collections({ status: 'completed' }), { code: 'INCOMPLETE_COLLECTION' });
});
test('认证/网络/超时及取消停止后续分页；结束身份核实失败也不能返回统计', async () => {
  for (const code of ['OAUTH_AUTH_REQUIRED', 'BGM_HTTP_401', 'BGM_HTTP_403', 'BGM_NETWORK', 'BGM_TIMEOUT']) {
    const f = fixture(125, (page, offset) => { if (offset) throw new AppError(code, '模拟失败'); return page; });
    await assert.rejects(new CollectionReader(f.client).summary(), { code }); assert.equal(f.calls.length, 3);
  }
  const controller = new AbortController(); const cancelled = fixture(125, page => { controller.abort(); return page; });
  await assert.rejects(new CollectionReader(cancelled.client).summary(undefined, controller.signal), { name: 'AbortError' }); assert.equal(cancelled.calls.length, 2);
  const f = fixture(1); const source = { collections: f.client.collections.bind(f.client), currentUser: async () => ({ id: f.calls.length ? 8 : 7, username: 'fixture' }) };
  await assert.rejects(new CollectionReader(source).summary(), { code: 'ACCOUNT_CHANGED' });
});
