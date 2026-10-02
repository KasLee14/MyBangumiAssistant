import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuthSessionStore, oauthSession } from '../../src/storage/oauth-session.js';
import { DEFAULT_OAUTH } from '../../src/config/oauth.js';
import { BgmReadClient, createBgmRunner } from '../../src/adapters/bgm-cli/client.js';
import { CollectionReader } from '../../src/core/collection-reader.js';

const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
test('独立收藏CLI：分页、媒体/状态筛选、五类汇总与中文展示，无模型请求', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bgm-collection-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const preload = new URL('../../../tests/fixtures/bgm-preload.mjs', import.meta.url).href;
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', preload, entry, ...args], { env: { ...process.env, BANGUMI_AGENT_HOME: dir }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const json = (args: string[]) => { const result = run([...args, '--json']); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  const page = json(['collections', '--offset', '120']); assert.equal(page.data.length, 5); assert.equal(page.complete, false); assert.equal(page.nextOffset, null);
  const filtered = json(['collections', '--type', 'anime', '--status', 'completed']); assert.equal(filtered.total, 5); assert.ok(filtered.data.every((row: { type: string; status: string }) => row.type === 'anime' && row.status === 'completed'));
  const summary = json(['collection-summary']); assert.equal(summary.overall.total, 125); assert.equal(summary.byType.real.total, 25); assert.equal(summary.overall.statuses.completed, 25);
  const anime = json(['collection-summary', '--type', 'anime']); assert.equal(anime.overall.total, 25); assert.equal(anime.byType.game, undefined);
  const text = run(['collection-summary']); assert.equal(text.status, 0, text.stderr); assert.match(text.stdout, /个人评分分布/); assert.match(text.stdout, /三次元：25项/);
  for (const args of [['collections', '--limit', '100'], ['collections', '--status', '2'], ['collections', '--offset', '-1'], ['collection-summary', '--status', 'wish'], ['collection-summary', 'other']]) {
    const result = run(args); assert.equal(result.status, 1); assert.match(result.stderr, /INVALID_INPUT/);
  }
});
test('自然语言收藏汇总及列表通过分类和业务工具，日志只保存汇总/所需一页', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bgm-collection-ask-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ activeModel: 'fixture', models: { fixture: { baseUrl: 'http://offline.invalid', model: 'fixture-model', apiKeyEnv: 'FIXTURE_API_KEY' } } }));
  const preload = new URL('../../../tests/fixtures/dialogue-preload.mjs', import.meta.url).href;
  const run = (input: string) => {
    const result = spawnSync(process.execPath, ['--import', preload, entry, 'ask', input, '--json'], { env: { ...process.env, BANGUMI_AGENT_HOME: dir, FIXTURE_API_KEY: 'offline-collection-model-secret' }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes('offline-collection-model-secret')); return JSON.parse(result.stdout);
  };
  const summary = run('我的五类收藏各有多少、看过多少、评分分布如何'); assert.equal(summary.boundary.code, 'IN_SCOPE'); assert.deepEqual(summary.plans, []);
  const log = await readFile(join(dir, 'sessions', `${summary.sessionId}.jsonl`), 'utf8');
  assert.match(log, /get_collection_summary/); assert.match(log, /distribution/); assert.ok(!log.includes('测试作品125'));
  const page = run('列出我的想看动画'); assert.equal(page.boundary.code, 'IN_SCOPE'); assert.deepEqual(page.plans, []);
  const pageLog = await readFile(join(dir, 'sessions', `${page.sessionId}.jsonl`), 'utf8'); assert.match(pageLog, /list_collections/); assert.match(pageLog, /测试作品2/);
});
test('实际OAuth收藏读取桥接及CLI：固定本人GET，包含私密，精简响应，身份/权限失败停止', async t => {
  if (process.platform !== 'win32') { t.skip('实际Windows DPAPI临时凭据'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'bgm-collection-bridge-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const authDir = join(dir, 'auth'); const now = Date.now(); const store = new OAuthSessionStore(authDir);
  await store.save(oauthSession({ version: 1, accountId: 7, username: 'fixture', clientId: 'offline-collection-client', config: DEFAULT_OAUTH,
    accessToken: 'offline-collection-token-123456', savedAt: now, expiresAt: now + 86400000 }));
  const preload = new URL('../../../tests/fixtures/collection-network-preload.mjs', import.meta.url).href;
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_OPTIONS: `--import=${preload}` };
  const options = { configDir: join(dir, 'bgm'), authDir, timeoutMs: 10000, proxy: null, env };
  const client = new BgmReadClient(createBgmRunner(options));
  const page = await client.collections({ type: 'anime', status: 'completed' }); assert.equal(page.total, 5); assert.ok(page.data.some(row => row.private));
  assert.ok(!JSON.stringify(page).includes('长简介')); assert.ok(!JSON.stringify(page).includes('短评')); assert.ok(!JSON.stringify(page).includes('offline-collection-token'));
  const summary = await new CollectionReader(client).summary(); assert.equal(summary.overall.total, 125); assert.equal(summary.overall.statuses.completed, 25);
  const cli = spawnSync(process.execPath, [entry, 'collection-summary', '--json'], { env: { ...env, BANGUMI_AGENT_HOME: dir, BANGUMI_AGENT_PROXY: '' }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).overall.total, 125);
  for (const mode of ['account-changed', 'unauthorized']) {
    const failed = new BgmReadClient(createBgmRunner({ ...options, env: { ...env, COLLECTION_FIXTURE_MODE: mode } }));
    await assert.rejects(failed.collections({}), { code: mode === 'account-changed' ? 'ACCOUNT_CHANGED' : 'BGM_HTTP_401' });
  }
  const anonymous = new BgmReadClient(createBgmRunner({ ...options, authDir: join(dir, 'missing-auth') }));
  await assert.rejects(anonymous.collections({}), { code: 'OAUTH_AUTH_REQUIRED' });
});
