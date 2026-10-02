import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { OAuthSessionStore, oauthSession, type OAuthSession } from '../../src/storage/oauth-session.js';
import { windowsProtector } from '../../src/storage/protected-credentials.js';
import { OAuthTransport, type OAuthFetch } from '../../src/adapters/bangumi-oauth/transport.js';
import { login } from '../../src/adapters/bangumi-oauth/login.js';
import { activeSession } from '../../src/adapters/bangumi-oauth/session.js';
import { DEFAULT_OAUTH, parseOAuthConfig, oauthCredentials } from '../../src/config/oauth.js';
import { credentialValues, redact } from '../../src/domain/errors.js';
import { BgmReadClient, createBgmRunner } from '../../src/adapters/bgm-cli/client.js';
import { BgmWriteClient } from '../../src/adapters/bgm-cli/write-client.js';
import { BgmOperationExecutor } from '../../src/adapters/bgm-cli/executor.js';
import { collectionWriteAction } from '../../src/domain/collection-plan.js';

process.env.TEST_OAUTH_CLIENT_ID = 'offline-client-id';
process.env.TEST_OAUTH_CLIENT_SECRET = 'offline-client-secret';
const settings = { ...DEFAULT_OAUTH, clientIdEnv: 'TEST_OAUTH_CLIENT_ID', clientSecretEnv: 'TEST_OAUTH_CLIENT_SECRET' };
const protector = { async protect(value: string) { return Buffer.from(value).toString('base64'); }, async unprotect(value: string) { return Buffer.from(value, 'base64').toString('utf8'); } };
function session(): OAuthSession { const now = Date.now(); return oauthSession({ version: 1, accountId: 7, username: 'fixture', clientId: 'offline-client-id', config: settings, accessToken: 'offline-access-token-123456', refreshToken: 'offline-refresh-token-123456', savedAt: now, expiresAt: now + 86400000 }); }
async function directory(t: { after(fn: () => Promise<void>): void }) { const dir = await mkdtemp(join(tmpdir(), 'bgm-oauth-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function callbackConfig() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error(); await new Promise<void>(resolve => server.close(() => resolve())); return { ...settings, redirectUri: `http://127.0.0.1:${address.port}/oauth/callback` }; }
function callback(url: string): URL { const authorization = new URL(url); assert.equal(authorization.origin, 'https://bgm.tv'); assert.equal(authorization.pathname, '/oauth/authorize'); assert.equal(authorization.searchParams.get('client_id'), 'offline-client-id'); const uri = new URL(authorization.searchParams.get('redirect_uri')!); uri.searchParams.set('state', authorization.searchParams.get('state')!); uri.searchParams.set('code', 'offline-authorization-code'); return uri; }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const fake: OAuthFetch = async (raw, init) => {
  const url = new URL(raw); assert.equal(init.headers.Cookie, undefined); assert.equal(init.redirect, 'manual');
  if (url.href === 'https://bgm.tv/oauth/access_token') {
    assert.equal(init.method, 'POST'); const form = new URLSearchParams(init.body); assert.equal(form.get('client_secret'), 'offline-client-secret');
    return json({ access_token: 'offline-new-access-token-123456', refresh_token: 'offline-new-refresh-token-123456', token_type: 'Bearer', expires_in: 86400, user_id: 7 });
  }
  assert.equal(url.href, 'https://next.bgm.tv/p1/me'); assert.equal(init.headers.Authorization, 'Bearer offline-new-access-token-123456'); return json({ id: 7, username: 'fixture' });
};

test('OAuth 配置只保存环境变量引用，回调固定到回环；缺配置提示，不泄露凭据', () => {
  assert.deepEqual(parseOAuthConfig(undefined), DEFAULT_OAUTH);
  for (const redirectUri of ['https://evil.invalid/oauth/callback', 'http://0.0.0.0:1234/oauth/callback', 'http://localhost:1234/oauth/callback', 'http://127.0.0.1:1234/other', 'http://127.0.0.1:1234/oauth/callback?secret=x']) assert.throws(() => parseOAuthConfig({ ...settings, redirectUri }), { code: 'INVALID_CONFIG' });
  assert.throws(() => parseOAuthConfig({ ...settings, clientSecret: 'private-test-secret' }), error => error instanceof Error && !error.message.includes('private-test-secret'));
  assert.throws(() => oauthCredentials(settings, {}), { code: 'OAUTH_CONFIG_REQUIRED' });
  assert.equal(oauthCredentials(settings).clientId, 'offline-client-id');
});
test('OAuth 保存原子替换，失败或取消保留旧凭据；损坏拒绝、清除幂等', async t => {
  const dir = await directory(t); const store = new OAuthSessionStore(dir, protector); assert.equal(await store.load(), null); await store.save(session());
  const old = await readFile(store.file, 'utf8'); assert.ok(!old.includes('offline-access-token'));
  const cancelling = new AbortController(); const failing = new OAuthSessionStore(dir, { ...protector, async protect(value) { cancelling.abort(); return protector.protect(value); } });
  await assert.rejects(failing.save({ ...session(), accountId: 8 }, cancelling.signal)); assert.equal(await readFile(store.file, 'utf8'), old);
  assert.equal(redact(session().accessToken, credentialValues()), '[REDACTED]');
  await writeFile(store.file, 'broken'); await assert.rejects(store.load(), { code: 'OAUTH_AUTH_INVALID' });
  await store.clear(); await store.clear(); assert.equal(await store.load(), null);
});
test('Windows DPAPI 实际保护临时 OAuth Token，未读取真实账号', async t => {
  if (process.platform !== 'win32') { t.skip('Windows only'); return; }
  const store = new OAuthSessionStore(await directory(t), windowsProtector); await store.save(session());
  assert.ok(!(await readFile(store.file, 'utf8')).includes('offline-access-token')); assert.equal((await store.load())!.accountId, 7);
});
test('OAuth p1 请求仅携带 Bearer，固定主机、不跟随重定向、不重复请求', async () => {
  let calls = 0; const transport = new OAuthTransport(session(), null, 1000, async (url, init) => { calls++; assert.equal(url, 'https://next.bgm.tv/p1/me'); assert.equal(init.headers.Authorization, `Bearer ${session().accessToken}`); assert.equal(init.headers.Cookie, undefined); return new Response('', { status: 302, headers: { location: 'https://evil.invalid' } }); });
  await assert.rejects(transport.json('/p1/me', { auth: true }), { code: 'BGM_HTTP_302' }); assert.equal(calls, 1);
  await assert.rejects(transport.json('//evil.invalid'), { code: 'INVALID_INPUT' });
  const anonymous = new OAuthTransport(null, null, 1000, fake); await assert.rejects(anonymous.json('/p1/me', { auth: true }), { code: 'OAUTH_AUTH_REQUIRED' }); await anonymous.close(); await transport.close();
});
test('真实本地 OAuth 回调：错误 state/路径拒绝，授权一次立即换 Token、核实后保存', async t => {
  const store = new OAuthSessionStore(await directory(t), protector); let exchanges = 0;
  const user = await login(store, { config: await callbackConfig(), proxy: null, signal: new AbortController().signal, fakeFetch: async (url, init) => { if (url.includes('/oauth/')) exchanges++; return fake(url, init); }, openBrowser: async url => {
    const uri = callback(url); const wrong = new URL(uri); wrong.searchParams.set('state', 'wrong-state'); assert.equal((await fetch(wrong)).status, 400);
    const path = new URL(uri); path.pathname = '/unrelated'; assert.equal((await fetch(path)).status, 404);
    assert.equal(await store.load(), null); const res = await fetch(uri); assert.equal(res.status, 200); assert.match(await res.text(), /MyBangumiAssistant 授权成功/);
  } });
  assert.deepEqual(user, { id: 7, username: 'fixture' }); assert.equal(exchanges, 1); assert.equal((await store.load())!.accessToken, 'offline-new-access-token-123456');
});
test('回调重复不会重复交换 Token；端口在结束后释放', async t => {
  const store = new OAuthSessionStore(await directory(t), protector); const config = await callbackConfig(); let exchanges = 0; let unblock!: () => void; let received!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; }); const held = new Promise<void>(resolve => { unblock = resolve; });
  await login(store, { config, signal: new AbortController().signal, fakeFetch: async (url, init) => { if (url.includes('/oauth/')) { exchanges++; received(); await held; } return fake(url, init); }, openBrowser: async url => {
    const uri = callback(url); const first = fetch(uri); await started; const second = await fetch(uri); assert.equal(second.status, 409); unblock(); assert.equal((await first).status, 200);
  } }); assert.equal(exchanges, 1);
  const server = createServer(); server.listen(Number(new URL(config.redirectUri).port), '127.0.0.1'); await once(server, 'listening'); await new Promise<void>(resolve => server.close(() => resolve()));
});
test('拒绝授权、网络错误、账户错配、等待超时和取消均保留原登录', async t => {
  const store = new OAuthSessionStore(await directory(t), protector); await store.save(session()); const old = await readFile(store.file, 'utf8');
  for (const scenario of ['denied', 'network', 'mismatch', 'timeout', 'cancel']) {
    const controller = new AbortController();
    await assert.rejects(login(store, { config: await callbackConfig(), signal: controller.signal, timeoutMs: scenario === 'timeout' ? 100 : 3000, fakeFetch: async (url, init) => {
      if (scenario === 'network') throw new Error('offline-client-secret');
      return scenario === 'mismatch' && url.includes('/p1/') ? json({ id: 8, username: 'other' }) : fake(url, init);
    }, openBrowser: async url => {
      if (scenario === 'cancel') { controller.abort(); return; } if (scenario === 'timeout') return;
      const uri = callback(url); if (scenario === 'denied') { uri.searchParams.delete('code'); uri.searchParams.set('error', 'access_denied'); }
      const res = await fetch(uri); assert.equal(res.status, 400);
    } }), { code: { denied: 'OAUTH_DENIED', network: 'BGM_NETWORK', mismatch: 'ACCOUNT_CHANGED', timeout: 'OAUTH_TIMEOUT', cancel: 'CANCELLED' }[scenario] });
    assert.equal(await readFile(store.file, 'utf8'), old);
  }
});
test('端口冲突及缺配置不会打开浏览器，也不修改凭据', async t => {
  const config = await callbackConfig(); const server = createServer(); server.listen(Number(new URL(config.redirectUri).port), '127.0.0.1'); await once(server, 'listening'); let opened = 0;
  const store = new OAuthSessionStore(await directory(t), protector);
  try { await assert.rejects(login(store, { config, signal: new AbortController().signal, openBrowser: async () => { opened++; } }), { code: 'OAUTH_CALLBACK_PORT' }); assert.equal(opened, 0); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  await assert.rejects(login(store, { config: { ...config, clientSecretEnv: 'UNSET_OFFLINE_SECRET' }, signal: new AbortController().signal, openBrowser: async () => { opened++; } }), { code: 'OAUTH_CONFIG_REQUIRED' }); assert.equal(opened, 0);
});
test('交换 Token 过程中取消会中断请求，回调结束后不会补写登录', async t => {
  const store = new OAuthSessionStore(await directory(t), protector); await store.save(session()); const old = await readFile(store.file, 'utf8');
  const controller = new AbortController(); let started!: () => void; const exchanging = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  await assert.rejects(login(store, { config: await callbackConfig(), signal: controller.signal, fakeFetch: async (_url, init) => {
    calls++; started(); await new Promise<void>((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }); throw new Error('never');
  }, openBrowser: async url => { const request = fetch(callback(url)); await exchanging; controller.abort(); await request.catch(() => {}); } }), { code: 'CANCELLED' });
  assert.equal(calls, 1); assert.equal(await readFile(store.file, 'utf8'), old);
});
test('到期 Token 自动刷新并核实同一账户；账户错配和退出竞争不覆盖登录', async t => {
  const store = new OAuthSessionStore(await directory(t), protector); const expired = { ...session(), savedAt: Date.now() - 10000, expiresAt: Date.now() - 1 }; await store.save(expired);
  const fresh = await activeSession(store, null, 1000, undefined, fake); assert.equal(fresh!.accessToken, 'offline-new-access-token-123456');
  let calls = 0; await activeSession(store, null, 1000, undefined, async () => { calls++; throw new Error(); }); assert.equal(calls, 0);
  await store.save(expired); const old = await readFile(store.file, 'utf8');
  await assert.rejects(activeSession(store, null, 1000, undefined, async (url, init) => url.includes('/p1/') ? json({ id: 8, username: 'other' }) : fake(url, init)), { code: 'ACCOUNT_CHANGED' }); assert.equal(await readFile(store.file, 'utf8'), old);
  await assert.rejects(activeSession(store, null, 1000, undefined, async (url, init) => { if (url.includes('/p1/')) await store.clear(); return fake(url, init); }), { code: 'ACCOUNT_CHANGED' }); assert.equal(await store.load(), null);
});
test('实际查询/写入桥接共享 OAuth Token；旧 Cookie 与旧 bgm-cli 会话被忽略', async t => {
  if (process.platform !== 'win32') { t.skip('Windows credential store'); return; }
  const dir = await directory(t); const authDir = join(dir, 'auth'); await new OAuthSessionStore(authDir).save(session()); await writeFile(join(authDir, 'web-session.dpapi'), 'obsolete-cookie-file');
  const preload = new URL('../../../tests/fixtures/oauth-network-preload.mjs', import.meta.url).href;
  const options = { configDir: join(dir, 'bgm-cli'), authDir, timeoutMs: 10000, proxy: null, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_OPTIONS: `--import=${preload}`, BGM_PRIVATE_SESSION_ID: 'old-private-session', BGM_ACCESS_TOKEN: 'old-access-token', BANGUMI_WEB_COOKIE: 'old-cookie' } };
  const read = new BgmReadClient(createBgmRunner(options)); const client = new BgmWriteClient(read, createBgmRunner({ ...options, entry: fileURLToPath(new URL('../../src/adapters/bgm-cli/worker.js', import.meta.url)) }));
  assert.deepEqual(await client.currentUser(), { id: 7, username: 'fixture' }); assert.equal((await client.search('测试', 'anime')).data[0]!.id, 1);
  const subject = await client.subject(1); assert.equal((await client.collection(1)).rate, 7); assert.equal((await client.allEpisodes(1)).data[0]!.status, 2);
  const update = await new BgmOperationExecutor(client, 0).execute(7, collectionWriteAction(subject, await client.collectionSnapshot(1), { rate: 8 }), new AbortController().signal); assert.equal(typeof update === 'string' ? update : update.state, 'success');
  await assert.rejects(client.mutate(1, 7, { kind: 'delete' }, new AbortController().signal), { code: 'UNSUPPORTED_OPERATION' }); assert.equal((await client.collectionSnapshot(1))!.rate, 8);
});
test('实际公开查询不被到期 Token 阻塞，个人查询仍要求 OAuth；旧 Cookie 不作为后备', async t => {
  if (process.platform !== 'win32') { t.skip('Windows credential store'); return; }
  const dir = await directory(t); const authDir = join(dir, 'auth'); const store = new OAuthSessionStore(authDir);
  await store.save({ ...session(), savedAt: Date.now() - 10000, expiresAt: Date.now() - 1 }); await writeFile(join(authDir, 'web-session.dpapi'), 'obsolete-cookie-file');
  const preload = new URL('../../../tests/fixtures/oauth-network-preload.mjs', import.meta.url).href;
  const client = new BgmReadClient(createBgmRunner({ configDir: join(dir, 'bgm-cli'), authDir, timeoutMs: 10000, proxy: null, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_OPTIONS: `--import=${preload}`, FIXTURE_ANONYMOUS: '1' } }));
  assert.equal((await client.search('测试')).data[0]!.id, 1); await assert.rejects(client.currentUser(), { code: 'OAUTH_CONFIG_REQUIRED' });
  await store.clear(); assert.equal((await client.search('测试')).data[0]!.id, 1); await assert.rejects(client.currentUser(), { code: 'OAUTH_AUTH_REQUIRED' });
});
