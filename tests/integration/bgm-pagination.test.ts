import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BgmReadClient, createBgmRunner } from '../../src/adapters/bgm-cli/client.js';
import { bgmProcessError } from '../../src/adapters/bgm-cli/errors.js';
import { ReadTools } from '../../src/tools/read-tools.js';
import { planEpisodeTargets } from '../../src/domain/progress.js';

function episodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, type: i >= 28 ? 1 : 0, ep: i + 1, nameCN: `第${i + 1}章`,
    ...(i === 23 ? { collection: { status: 2 } } : {}) }));
}
function paged(count: number, calls: string[][] = []) {
  const data = episodes(count);
  return new BgmReadClient(async args => {
    calls.push([...args]);
    const offset = Number(args.at(-1)); const limit = Number(args[4]);
    return { data: data.slice(offset, offset + limit), total: count, offset, subjectId: 400602 };
  });
}

test('章节跨页读取、特殊章节及个人状态保留；尾页不冒充完整清单', async () => {
  const calls: string[][] = []; const client = paged(36, calls);
  const first = await client.episodes(400602);
  assert.equal(first.complete, false); assert.equal(first.nextOffset, 20);
  const last = await new ReadTools(client).execute('list_episodes', { subjectId: 400602, offset: 20 }) as Awaited<ReturnType<BgmReadClient['episodes']>>;
  assert.equal(last.data.length, 16); assert.equal(last.complete, false); assert.equal(last.nextOffset, null);
  assert.equal(last.data[3]?.status, 2); assert.equal(last.data[0]?.status, null);
  calls.length = 0;
  const all = await client.allEpisodes(400602);
  assert.equal(all.complete, true); assert.equal(all.total, 36); assert.equal(all.data.length, 36);
  assert.deepEqual(calls.map(args => args.at(-1)), ['0', '20']);
  assert.equal(all.data.filter(ep => ep.type === 1).length, 8);
  assert.equal(planEpisodeTargets('anime', all.data, all.complete, { mode: 'through', number: 28 }).length, 28);
  assert.throws(() => planEpisodeTargets('anime', first.data, first.complete, { mode: 'through', number: 8 }), { code: 'INCOMPLETE_EPISODES' });
});

test('空章节与恰好整页能停止；超出总数的偏移不是完整清单', async () => {
  for (const count of [0, 20, 40]) {
    const calls: string[][] = []; const all = await paged(count, calls).allEpisodes(400602);
    assert.equal(all.total, count); assert.equal(calls.length, Math.max(1, count / 20));
  }
  const beyond = await paged(3).episodes(400602, 20, 10);
  assert.equal(beyond.complete, false); assert.equal(beyond.nextOffset, null); assert.deepEqual(beyond.data, []);
});

test('缺失总数、空缺页、总数变化及分页重复不返回部分清单', async () => {
  const missing = new BgmReadClient(async () => ({ data: episodes(1) }));
  assert.equal((await missing.episodes(1)).complete, false);
  await assert.rejects(missing.allEpisodes(1), { code: 'INCOMPLETE_EPISODES' });
  for (const mode of ['empty', 'short', 'changed', 'repeated']) {
    let calls = 0;
    const client = new BgmReadClient(async () => {
      calls++;
      if (calls === 1) return { data: episodes(40).slice(0, 20), total: 40 };
      return { data: mode === 'empty' ? [] : mode === 'short' ? episodes(1) : mode === 'repeated' ? episodes(20) : episodes(39).slice(20),
        total: mode === 'changed' ? 39 : 40 };
    });
    await assert.rejects(client.allEpisodes(1), { code: 'INCOMPLETE_EPISODES' });
    assert.equal(calls, 2);
  }
});

test('拒绝错误响应、错条目、错偏移、页内重复及非法分页参数', async () => {
  for (const result of [
    { data: episodes(2), total: 1 }, { data: episodes(1), total: -1 },
    { data: episodes(1), total: 1, offset: 20 }, { data: episodes(1), total: 1, subjectId: 2 },
    { data: [episodes(1)[0], episodes(1)[0]], total: 2 }, { total: 0 },
  ]) await assert.rejects(new BgmReadClient(async () => result).allEpisodes(1));
  let calls = 0; const client = new BgmReadClient(async () => { calls++; return {}; });
  for (const offset of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(client.episodes(1, 20, offset), { code: 'INVALID_INPUT' });
  await assert.rejects(new ReadTools(client).execute('list_episodes', { subjectId: 1, offset: '--help' }), { code: 'INVALID_INPUT' });
  await assert.rejects(client.episodes(1, 21), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});

test('完整读取限制最多2000章；达到边界的100页可以完整返回', async () => {
  const calls: string[][] = [];
  await assert.rejects(paged(2001, calls).allEpisodes(400602), { code: 'BGM_EPISODE_LIMIT' });
  assert.equal(calls.length, 1);
  const all = await paged(2000).allEpisodes(400602); assert.equal(all.data.length, 2000); assert.equal(all.complete, true);
});

test('个人进度查询在第二页读取已看状态；书籍与不支持类型不查询章节', async () => {
  for (const type of [1, 2, 3, 4, 6]) {
    let episodeCalls = 0;
    const client = new BgmReadClient(async args => {
      if (args[0] === 'subject') return { id: 1, type, name: '测试' };
      if (args[0] === 'collection') return { collection: { type: 3, epStatus: 12, volStatus: 3 } };
      episodeCalls++;
      const offset = Number(args.at(-1));
      return { data: episodes(36).slice(offset, offset + 20), total: 36 };
    });
    const result = await new ReadTools(client).execute('get_progress', { subjectId: 1 }) as { detail: unknown };
    if (type === 2 || type === 6) {
      const detail = result.detail as { complete: boolean; data: { status: number | null }[] };
      assert.equal(detail.complete, true); assert.equal(detail.data[23]?.status, 2); assert.equal(episodeCalls, 2);
    } else {
      assert.equal(episodeCalls, 0);
      assert.deepEqual(result.detail, type === 1 ? { chapters: 12, volumes: 3 } : null);
    }
  }
});

test('中途子进程超时或取消不返回完整或部分清单，也不开始下一页', async () => {
  const entry = fileURLToPath(new URL('../../../tests/fixtures/bgm-child.mjs', import.meta.url));
  for (const mode of ['timeout', 'cancel']) {
    const controller = new AbortController();
    const run = createBgmRunner({ configDir: 'isolated-test-config', timeoutMs: mode === 'timeout' ? 100 : 2000, proxy: null, entry, env: {}, signal: controller.signal });
    let calls = 0;
    const client = new BgmReadClient(async args => {
      calls++;
      if (calls === 1) return { data: episodes(20), total: 40 };
      const timer = mode === 'cancel' ? setTimeout(() => controller.abort(), 50) : undefined;
      try { return await run(['subject', 'search', 'slow']); }
      finally { clearTimeout(timer); }
    });
    await assert.rejects(client.allEpisodes(1), { code: mode === 'cancel' ? 'CANCELLED' : 'BGM_TIMEOUT' });
    assert.equal(calls, 2);
  }
});

test('认证、权限和收藏查找错误通过真实子进程归一化，不回显文件凭据', async () => {
  const entry = fileURLToPath(new URL('../../../tests/fixtures/bgm-child.mjs', import.meta.url));
  const run = createBgmRunner({ configDir: 'isolated-test-config', timeoutMs: 2000, proxy: null, entry, env: {} });
  for (const [query, code] of [['unauthorized', 'BGM_AUTH_REQUIRED'], ['forbidden', 'BGM_FORBIDDEN'], ['collection-missing', 'BGM_COLLECTION_NOT_FOUND'], ['not-found', 'BGM_NOT_FOUND']]) {
    await assert.rejects(run(['subject', 'search', query!]), error => {
      assert.equal((error as { code: string }).code, code);
      assert.ok(!(error as Error).message.includes('unknown-disk-credential')); return true;
    });
  }
  assert.equal(bgmProcessError('Error: Failed to list episodes for subject 1. Original API response: secret').code, 'BGM_EPISODES_UNAVAILABLE');
  assert.equal(bgmProcessError('Error: Subject 1 is a book-type entry.').code, 'UNSUPPORTED_EPISODES');
  assert.equal(bgmProcessError('Bangumi API error (429): secret').code, 'BGM_RATE_LIMIT');
  assert.ok(!bgmProcessError('arbitrary disk credential').message.includes('arbitrary disk credential'));
});

test('auth-check 仅返回账户标识，丢弃上游额外数据及凭据', async () => {
  const client = new BgmReadClient(async args => {
    assert.deepEqual(args, ['user', 'me']);
    return { id: 7, username: 'test-user', email: 'private@example.test', accessToken: 'fake-disk-secret' };
  });
  assert.deepEqual(await client.currentUser(), { id: 7, username: 'test-user' });
  await assert.rejects(new BgmReadClient(async () => ({ id: 7 })).currentUser(), { code: 'INVALID_RESPONSE' });
});
