import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { accessContextSchema, anonymousContext, checkAccessResponse } from '../dist/src/mcp/access-context.js';
import { readContext } from '../dist/src/mcp/read-context.js';
import { compileSchema } from '../dist/src/support/tool-schema.js';
import { setImmediate as nextTick } from 'node:timers/promises';

function fixture(t, options = {}) {
  let session = { version: 1, accountId: 42, username: 'offline_reader', sessionId: 'offline-original-session',
    savedAt: Date.now(), expiresAt: Date.now() + 60_000 };
  let privacyStatus = options.privacyStatus ?? 200;
  let preferences = options.preferences ?? { showNsfwSubject: true, allowNsfw: true };
  let sessionLoads = 0;
  const requests = [];
  const transport = createMcpTransport({ authDir: 'unused-nsfw-on-demand', proxy: null, timeoutMs: 1000,
    loadSession: async () => { sessionLoads++; await options.onLoad?.(); return options.anonymous ? null : session; },
    fakeFetch: async (url, init) => {
      const path = new URL(url).pathname; requests.push({ path, headers: init.headers });
      if (path.startsWith('/v0/')) return new Response(JSON.stringify({ id: 1, nsfw: false }), { headers: { 'content-type': 'application/json' } });
      assert.ok(['/p1/me', '/p1/privacy'].includes(path), `离线请求越界：${path}`);
      if (path === '/p1/privacy') await options.onPrivacy?.();
      const body = path === '/p1/me' ? { id: 42, username: 'offline_reader' } : { preferences };
      return new Response(JSON.stringify(body), { status: path === '/p1/privacy' ? privacyStatus : 200, headers: { 'content-type': 'application/json' } });
    } });
  t.after(() => transport.close());
  return { transport, requests, get sessionLoads() { return sessionLoads; },
    privacyCount: () => requests.filter(row => row.path === '/p1/privacy').length,
    rotate: () => { session = { ...session, sessionId: 'offline-replaced-session', savedAt: session.savedAt + 1 }; },
    privacy: (status, value = preferences) => { privacyStatus = status; preferences = value; } };
}

test('公共读取不加载会话、不请求/me或/privacy，也不发送Cookie', async t => {
  const f = fixture(t);
  assert.equal((await f.transport.public('/v0/subjects/1')).id, 1);
  assert.equal(f.sessionLoads, 0);
  assert.deepEqual(f.requests.map(row => row.path), ['/v0/subjects/1']);
  assert.equal(new Headers(f.requests[0].headers).has('cookie'), false);
  const context = anonymousContext();
  assert.equal(context.nsfw.state, 'not_checked');
  assert.equal(context.nsfw.allowed, null);
  assert.equal(compileSchema(accessContextSchema)(context), true);
});

test('本人身份核验仅请求/me，未检查权限不能发布NSFW内容', async t => {
  const f = fixture(t); const context = await f.transport.identity();
  assert.deepEqual(f.requests.map(row => row.path), ['/p1/me']);
  assert.equal(context.mode, 'account');
  assert.deepEqual(context.nsfw, { preference: null, allowed: null, state: 'not_checked' });
  assert.equal(compileSchema(accessContextSchema)(context), true);
  assert.throws(() => checkAccessResponse('get_subject', { nsfw: true, accessContext: context }), error => error.code === 'MCP_INVALID_RESULT');
  checkAccessResponse('get_subject', { nsfw: false, accessContext: context });
  for (const malformed of [
    { ...anonymousContext(), nsfw: { preference: true, allowed: true, state: 'enabled' }, nsfwApplied: true },
    { ...context, nsfw: { preference: true, allowed: true, state: 'enabled' }, nsfwApplied: true, source: 'v0' },
    { ...context, nsfw: { preference: true, allowed: true, state: 'enabled' }, nsfwApplied: false },
  ]) assert.throws(() => checkAccessResponse('get_subject', { nsfw: true, accessContext: malformed }), error => error.code === 'MCP_INVALID_RESULT');
});

test('第三方匿名网页收藏不受本机登录影响，也不加载账户凭据', async t => {
  const requests = [];
  const transport = createMcpTransport({ authDir: 'unused-public-web', proxy: null, timeoutMs: 1000,
    loadSession: async () => { throw Error('公共网页不得加载账户'); },
    fakeFetch: async (url, init) => {
      requests.push(url); assert.equal(new Headers(init.headers).has('cookie'), false);
      return new Response('<html>公开收藏</html>', { headers: { 'content-type': 'text/html' } });
    } });
  t.after(() => transport.close());
  assert.equal(await transport.webCollections('public_reader', 'anime', 'do', 1), '<html>公开收藏</html>');
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).hostname, 'bgm.tv');
});

test('同一任务并发及重复补查NSFW只发一次/privacy，不同任务隔离', async t => {
  const f = fixture(t); const context = await f.transport.identity();
  const values = await f.transport.withReadContext({ turnId: 'turn-one' }, async () => {
    const concurrent = await Promise.all([f.transport.ensureNsfw(context), f.transport.ensureNsfw(context)]);
    return [...concurrent, await f.transport.ensureNsfw(context)];
  });
  assert.equal(f.privacyCount(), 1);
  assert.ok(values.every(value => value.nsfw.allowed === true));
  values[0].nsfw.allowed = false;
  await Promise.all(['turn-two', 'turn-three'].map(turnId => f.transport.withReadContext({ turnId }, async () => {
    await f.transport.ensureNsfw(context); await f.transport.ensureNsfw(context);
  })));
  assert.equal(f.privacyCount(), 3);
  const cached = await f.transport.withReadContext({ turnId: 'turn-one' }, () => f.transport.ensureNsfw(context));
  assert.equal(cached.nsfw.allowed, true);
  assert.equal(f.privacyCount(), 3);
});

test('同账户换会话拒绝旧身份，新身份权限不能沿用任务旧缓存', async t => {
  const f = fixture(t); const old = await f.transport.identity();
  await f.transport.ensureNsfw(old, undefined, 'turn-session');
  f.rotate();
  await assert.rejects(f.transport.ensureNsfw(old, undefined, 'turn-session'), error => error.code === 'ACCOUNT_CHANGED');
  const fresh = await f.transport.identity();
  await assert.rejects(f.transport.bindReadScope(old), error => error.code === 'ACCOUNT_CHANGED');
  await f.transport.ensureNsfw(fresh, undefined, 'turn-session');
  assert.equal(f.privacyCount(), 2);
});

test('共享权限Promise的第二等待者可单独取消，不影响第一调用', async t => {
  let started, finish;
  const startedPrivacy = new Promise(resolve => { started = resolve; });
  const finishPrivacy = new Promise(resolve => { finish = resolve; });
  const f = fixture(t, { onPrivacy: async () => { started(); await finishPrivacy; } });
  const context = await f.transport.identity();
  const first = f.transport.ensureNsfw(context, undefined, 'turn-shared-cancel');
  await startedPrivacy;
  const controller = new AbortController(); let secondOutcome;
  const second = f.transport.ensureNsfw(context, controller.signal, 'turn-shared-cancel')
    .then(() => { secondOutcome = 'success'; }, error => { secondOutcome = error.code; });
  await nextTick(); controller.abort(); await nextTick();
  assert.equal(secondOutcome, 'CANCELLED');
  assert.equal(f.privacyCount(), 1);
  finish();
  assert.equal((await first).nsfw.allowed, true);
  await second;
  assert.equal((await f.transport.ensureNsfw(context, undefined, 'turn-shared-cancel')).nsfw.allowed, true);
  assert.equal(f.privacyCount(), 1);
});

test('结束任务禁止在途调用迟到重建权限缓存，同时保留其他任务缓存', async t => {
  let blockLoad = false, started, finish;
  const startedLoad = new Promise(resolve => { started = resolve; });
  const finishLoad = new Promise(resolve => { finish = resolve; });
  const f = fixture(t, { onLoad: async () => { if (blockLoad) { started(); await finishLoad; } } });
  const context = await f.transport.identity();
  await f.transport.ensureNsfw(context, undefined, 'turn-survivor');
  blockLoad = true;
  const inFlight = f.transport.withReadContext({ turnId: 'turn-late' }, () => f.transport.ensureNsfw(context));
  await startedLoad;
  f.transport.clearReadContext('turn-late');
  blockLoad = false; finish();
  assert.equal((await inFlight).nsfw.allowed, true);
  assert.equal(f.privacyCount(), 2);
  await f.transport.ensureNsfw(context, undefined, 'turn-survivor');
  assert.equal(f.privacyCount(), 2);
  await f.transport.withReadContext({ turnId: 'turn-late' }, () => f.transport.ensureNsfw(context));
  assert.equal(f.privacyCount(), 3);
});

test('任务结束显式清理权限缓存，不影响其他任务；fresh覆盖旧结果', async t => {
  const f = fixture(t); const context = await f.transport.identity();
  await f.transport.ensureNsfw(context, undefined, 'turn-ended');
  await f.transport.ensureNsfw(context, undefined, 'turn-active');
  f.transport.clearReadContext('turn-ended');
  await f.transport.ensureNsfw(context, undefined, 'turn-active');
  await f.transport.ensureNsfw(context, undefined, 'turn-ended');
  assert.equal(f.privacyCount(), 3);
  f.privacy(200, { showNsfwSubject: true, allowNsfw: false });
  const refreshed = await f.transport.ensureNsfw(context, undefined, 'turn-active', { fresh: true });
  assert.equal(refreshed.nsfw.allowed, false);
  assert.equal((await f.transport.ensureNsfw(context, undefined, 'turn-active')).nsfw.allowed, false);
  assert.equal(f.privacyCount(), 4);
});

test('权限未知和禁用均按任务缓存，状态不同于未检查且不修改偏好', async t => {
  const f = fixture(t, { privacyStatus: 404 }); const context = await f.transport.identity();
  const unknown = await f.transport.ensureNsfw(context, undefined, 'turn-unknown');
  assert.deepEqual(unknown.nsfw, { preference: null, allowed: null, state: 'unknown' });
  await f.transport.ensureNsfw(context, undefined, 'turn-unknown');
  assert.equal(f.privacyCount(), 1);
  f.privacy(200, { showNsfwSubject: true, allowNsfw: false });
  const disabled = await f.transport.ensureNsfw(context, undefined, 'turn-disabled');
  assert.deepEqual(disabled.nsfw, { preference: true, allowed: false, state: 'disabled' });
  await f.transport.ensureNsfw(context, undefined, 'turn-disabled');
  assert.equal(f.privacyCount(), 2);
});

test('普通只读结束仅复核身份；真正使用NSFW时显式复核权限变化', async t => {
  const f = fixture(t); const context = await f.transport.identity();
  const scope = await f.transport.bindReadScope(context); t.after(() => scope.close());
  await scope.verify();
  assert.equal(f.privacyCount(), 0);
  const permitted = await f.transport.ensureNsfw(context, undefined, 'turn-protected');
  await scope.verify({ usedNsfw: true, context: permitted });
  assert.equal(f.privacyCount(), 2);
  f.privacy(200, { showNsfwSubject: true, allowNsfw: false });
  await assert.rejects(scope.verify({ usedNsfw: true, context: permitted }), error => error.code === 'NSFW_SCOPE_CHANGED');
});

test('本人只读快照键绑定真实任务，同任务懒权限升级不改变键', async t => {
  const f = fixture(t); const identity = await f.transport.identity(); const scopes = [];
  t.after(async () => { await Promise.all(scopes.map(scope => scope.close())); });
  const bind = async context => { const scope = await f.transport.bindReadScope(context); scopes.push(scope); return scope.key; };
  const before = await f.transport.withReadContext({ turnId: 'snapshot-turn-one' }, () => bind(identity));
  const after = await f.transport.withReadContext({ turnId: 'snapshot-turn-one' }, async () => {
    const checked = await f.transport.ensureNsfw(identity); return bind(checked);
  });
  const next = await f.transport.withReadContext({ turnId: 'snapshot-turn-two' }, () => bind(identity));
  assert.equal(before, after); assert.notEqual(before, next);
  assert.match(before, /^[a-f0-9]{64}$/);
  assert.equal(await bind(identity), await bind(identity));
  assert.equal(f.privacyCount(), 1);
});

test('显式preflight在同任务中刷新/privacy，取消及401不会降级权限未知', async t => {
  const f = fixture(t); const context = await f.transport.identity();
  await f.transport.withReadContext({ turnId: 'turn-refresh' }, async () => {
    await f.transport.ensureNsfw(context);
    await f.transport.preflight();
    await f.transport.preflight();
  });
  assert.equal(f.privacyCount(), 3);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.transport.ensureNsfw(context, cancelled.signal, 'turn-cancelled'), error => error.code === 'CANCELLED');
  assert.equal(f.privacyCount(), 3);
  f.privacy(401);
  await assert.rejects(f.transport.ensureNsfw(context, undefined, 'turn-auth'), error => error.code === 'BGM_HTTP_401');
  await assert.rejects(f.transport.identity(), error => error.code === 'BGM_AUTH_EXPIRED');
});

test('宿主读取上下文闭合校验，模型参数不能注入来源或账户', () => {
  assert.deepEqual(readContext({ turnId: 'turn-valid' }), { turnId: 'turn-valid' });
  for (const value of [null, {}, [], { turnId: '' }, { turnId: '  ' }, { turnId: 'turn\ninvalid' }, { turnId: 'x'.repeat(201) },
    { turnId: 'turn-valid', accountId: 42 }, { turnId: 'turn-valid', source: 'p1' }]) {
    assert.throws(() => readContext(value), error => error.code === 'INVALID_INPUT');
  }
});
