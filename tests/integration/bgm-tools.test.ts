import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BgmReadClient, createBgmRunner } from '../../src/adapters/bgm-cli/client.js';
import { ReadTools } from '../../src/tools/read-tools.js';

const entry = fileURLToPath(new URL('../../../tests/fixtures/bgm-child.mjs', import.meta.url));

test('子进程使用参数数组和隔离配置，字符串不是 shell 命令', async () => {
  // fixtures 为源文件，不随 tsc 编译，从项目根路径解析。
  const run = createBgmRunner({ configDir: 'isolated-test-config', timeoutMs: 2000, proxy: 'http://127.0.0.1:7890', entry, env: {} });
  const result = await run(['subject','search','test; echo should-not-run']) as { argv: string[]; configDir: string; proxy: string };
  assert.deepEqual(result.argv, ['--json','subject','search','test; echo should-not-run']);
  assert.equal(result.configDir, 'isolated-test-config'); assert.equal(result.proxy, 'http://127.0.0.1:7890');
});

test('子进程错误、JSON 错误、超时和取消分别报告', async () => {
  const run = createBgmRunner({ configDir: 'isolated-test-config', timeoutMs: 2000, proxy: null, entry, env: { TEST_API_KEY: 'fake-secret' } });
  await assert.rejects(run(['subject','search','fail']), error => error instanceof Error && !error.message.includes('fake-secret'));
  await assert.rejects(run(['subject','search','invalid-json']), { code: 'BGM_INVALID_JSON' });
  const short = createBgmRunner({ configDir: 'isolated-test-config', timeoutMs: 100, proxy: null, entry, env: {} });
  await assert.rejects(short(['subject','search','slow']), { code: 'BGM_TIMEOUT' });
  const controller = new AbortController(); const promise = run(['subject','search','slow'], controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('所有媒体搜索、nested 收藏和章节输出归一化', async () => {
  const commands: string[][] = [];
  const client = new BgmReadClient(async args => {
    commands.push([...args]);
    if (args[0] === 'collection') return { action: 'get', collection: { type: 3, rate: 8, ep_status: 4, tags: ['科幻'] } };
    if (args[0] === 'episode') return { data: [{ id: 91, type: 0, ep: 2, nameCN: '第二集', collection: { status: 2 } }], total: 1 };
    return { data: [{ id: 1, type: ({ book: 1, anime: 2, music: 3, game: 4, real: 6 } as Record<string, number>)[args.at(-1)!], name: '测试作品' }], total: 1 };
  });
  for (const type of ['book','anime','music','game','real'] as const) assert.equal((await client.search('测试',type)).data[0]?.type, type);
  assert.equal((await client.collection(1)).rate, 8);
  const episodes = await client.episodes(1); assert.equal(episodes.data[0]?.status, 2); assert.equal(episodes.total, 1); assert.equal(episodes.complete, true);
  assert.ok(commands.every(args => !args.includes('watch') && !args.includes('rate')));
});

test('每轮取消从搜索工具传到实际子进程；取消后新signal仍可查询', async () => {
  const runner=createBgmRunner({configDir:'isolated-test-config',timeoutMs:2000,proxy:null,entry,env:{}});
  const tools=new ReadTools(new BgmReadClient(runner));const round=new AbortController();
  const pending=tools.execute('search_subjects',{keyword:'slow'},{signal:round.signal});
  setTimeout(()=>round.abort(),50);await assert.rejects(pending,{code:'CANCELLED'});
  const result=await tools.execute('search_subjects',{keyword:'dialogue-fixture'},{signal:new AbortController().signal}) as {data:unknown[]};
  assert.equal(result.data.length,2);
});

test('工具注册表拒绝写入、社区工具与未声明参数', async () => {
  let calls = 0;
  const client = new BgmReadClient(async () => { calls++; return {}; });
  const tools = new ReadTools(client);
  await assert.rejects(tools.execute('update_collection', { subjectId: 1 }), { code: 'TOOL_UNAVAILABLE' });
  await assert.rejects(tools.execute('create_topic', {}), { code: 'TOOL_UNAVAILABLE' });
  await assert.rejects(tools.execute('get_subject', { subjectId: 1, command: 'delete' }), { code: 'INVALID_INPUT' });
  await assert.rejects(tools.execute('search_subjects', { keyword: '--help' }), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});
