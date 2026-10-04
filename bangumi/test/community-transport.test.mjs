import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { proxyForUrl } from '../dist/src/support/proxy.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
const errorCode = code => error => error?.code === code;

function fixture(t, fakeFetch, options = {}) {
  let sessionReads = 0; const calls = [];
  const transport = createMcpTransport({ authDir: 'unused-community-test', proxy: null, timeoutMs: 1000,
    loadSession: async () => { sessionReads++; throw new Error('社区读取不得加载登录'); },
    fakeFetch: async (url, init) => { calls.push({ url, init }); return fakeFetch(url, init); }, ...options });
  t.after(() => transport.close());
  return { transport, calls, sessionReads: () => sessionReads };
}

test('固定社区路径匿名读取，查询编码且不加载登录或发送 Cookie', async t => {
  const f = fixture(t, async () => json({ data: [] }), { proxy: 'http://127.0.0.1:7890' });
  for (const path of ['/p1/subjects/12/comments', '/p1/subjects/12/reviews', '/p1/subjects/12/topics',
    '/p1/blogs/34', '/p1/blogs/34/comments', '/p1/subjects/-/topics/56']) {
    assert.deepEqual(await f.transport.community(path, { query: { limit: 5, offset: 0, test: 'a&b', values: ['a', 'b'], omitted: null } }), { data: [] });
  }
  assert.equal(f.sessionReads(), 0);
  assert.equal(f.calls.length, 6);
  for (const { url, init } of f.calls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://next.bgm.tv');
    assert.equal(parsed.searchParams.get('test'), 'a&b');
    assert.deepEqual(parsed.searchParams.getAll('values'), ['a', 'b']);
    assert.equal(parsed.searchParams.has('omitted'), false);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(Object.keys(init.headers).some(name => /cookie|authorization/i.test(name)), false);
    assert.equal(init.body, undefined);
  }
});

test('社区不继承可用或过期会话，账户读取继续要求登录', async t => {
  for (const expiresAt of [Date.now() + 60_000, Date.now() - 60_000]) {
    const f = fixture(t, async () => json({ id: 1 }), { loadSession: async () => ({ version: 1, accountId: 1, username: 'user', sessionId: 'should-never-be-sent', savedAt: 1, expiresAt }) });
    await f.transport.community('/p1/blogs/1');
    assert.equal(f.calls[0].init.headers.Cookie, undefined);
  }
  const f = fixture(t, async () => json({}), { loadSession: async () => null });
  await assert.rejects(f.transport.account('/p1/me'), errorCode('BGM_AUTH_REQUIRED'));
  assert.equal(f.calls.length, 0);
});

test('社区只允许六类正安全整数路径，拒绝任意 URL、遍历和额外账户路径', async t => {
  const f = fixture(t, async () => json({}));
  for (const path of ['https://next.bgm.tv/p1/blogs/1', '//next.bgm.tv/p1/blogs/1', '/p1/blogs/0', '/p1/blogs/01',
    '/p1/blogs/-1', '/p1/blogs/1.5', '/p1/blogs/9007199254740992', '/p1/blogs/%31', '/p1/blogs/1?limit=1',
    '/p1/blogs/1#fragment', '/p1/blogs/1/../2', '/p1/blogs/1\\comments', '/p1/blogs/1\n', '/p1/blogs/1/',
    '/p1/login', '/p1/me', '/p1/subjects/1', '/p1/subjects/1/topics/2', '/v0/subjects/1']) {
    await assert.rejects(f.transport.community(path), errorCode('INVALID_INPUT'), path);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.sessionReads(), 0);
});

test('社区拒绝写入方法、body 和账户绑定参数，不走网络', async t => {
  const f = fixture(t, async () => json({}));
  for (const options of [{ method: 'POST' }, { method: 'DELETE' }, { method: 'get' }, { body: {} }, { body: null }, { expectedAccountId: 1 }]) {
    await assert.rejects(f.transport.community('/p1/blogs/1', options), errorCode('INVALID_INPUT'));
  }
  assert.equal(f.calls.length, 0);
});

test('社区重定向一律拒绝，不跟随或返回跳转目标', async t => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = fixture(t, async () => new Response('hidden-body', { status, headers: { location: 'https://bgm.tv/login' } }));
    await assert.rejects(f.transport.community('/p1/blogs/1'), errorCode('INVALID_RESPONSE'));
    assert.equal(f.calls.length, 1);
  }
});

test('社区严格检查 JSON 媒体类型、文本编码和 JSON 结构', async t => {
  for (const [body, type] of [['{}', 'text/html'], ['{}', 'text/json'], ['{}', 'application/jsonjunk'],
    ['{}', 'image/json'], ['{', 'application/json'], [new Uint8Array([0x22, 0xff, 0x22]), 'application/json']]) {
    const f = fixture(t, async () => new Response(body, { headers: { 'content-type': type } }));
    await assert.rejects(f.transport.community('/p1/blogs/1'), errorCode('INVALID_RESPONSE'));
  }
  const f = fixture(t, async () => new Response('{}', { headers: { 'content-type': 'application/problem+json' } }));
  assert.deepEqual(await f.transport.community('/p1/blogs/1'), {});
});

test('社区按流实际字节限制 2 MB，不依赖 Content-Length', async t => {
  let cancelled = false;
  const f = fixture(t, async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(1_000_000)); controller.enqueue(new Uint8Array(1_000_001));
  }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json', 'content-length': '1' } }));
  await assert.rejects(f.transport.community('/p1/blogs/1'), errorCode('BGM_OUTPUT_LIMIT'));
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 1);
});

test('社区恰好 2 MB 的有效 JSON 可读取', async t => {
  const text = 'a'.repeat(1_999_998);
  const f = fixture(t, async () => new Response(JSON.stringify(text), { headers: { 'content-type': 'application/json' } }));
  assert.equal((await f.transport.community('/p1/blogs/1')).length, text.length);
});

test('社区 HTTP 和网络失败分类，不读取或暴露服务端错误正文，不重试', async t => {
  for (const status of [401, 403, 404, 429, 500]) {
    const f = fixture(t, async () => new Response('private diagnostic', { status }));
    await assert.rejects(f.transport.community('/p1/blogs/1'), error => error.code === `BGM_HTTP_${status}` && !error.message.includes('private diagnostic'));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(t, async () => { throw new Error('private diagnostic'); });
  await assert.rejects(f.transport.community('/p1/blogs/1'), errorCode('BGM_NETWORK'));
  assert.equal(f.calls.length, 1);
});

test('社区预先取消不请求网络，关闭后拒绝读取', async t => {
  const f = fixture(t, async () => json({}));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.transport.community('/p1/blogs/1', {}, abort.signal), errorCode('CANCELLED'));
  assert.equal(f.calls.length, 0);
  await f.transport.close();
  await assert.rejects(f.transport.community('/p1/blogs/1'), errorCode('MCP_CLOSED'));
});

test('社区请求阶段取消和超时均停止等待，迟到响应被丢弃且不重试', async t => {
  for (const cancel of [true, false]) {
    let responseCancelled = false;
    const f = fixture(t, async () => { await delay(40); return new Response(new ReadableStream({ cancel() { responseCancelled = true; } }), { headers: { 'content-type': 'application/json' } }); }, { timeoutMs: cancel ? 1000 : 10 });
    const abort = new AbortController();
    if (cancel) setTimeout(() => abort.abort(), 5);
    await assert.rejects(f.transport.community('/p1/blogs/1', {}, abort.signal), errorCode(cancel ? 'CANCELLED' : 'BGM_TIMEOUT'));
    await delay(50);
    assert.equal(responseCancelled, true);
    assert.equal(f.calls.length, 1);
  }
});

test('社区响应流阶段取消和超时映射明确错误，不返回不完整数据', async t => {
  for (const cancel of [true, false]) {
    let cancelled = false;
    const f = fixture(t, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: cancel ? 1000 : 10 });
    const abort = new AbortController();
    const keepAlive = setTimeout(() => { if (cancel) abort.abort(); }, cancel ? 5 : 50);
    try { await assert.rejects(f.transport.community('/p1/blogs/1', {}, abort.signal), errorCode(cancel ? 'CANCELLED' : 'BGM_TIMEOUT')); }
    finally { clearTimeout(keepAlive); }
    assert.equal(cancelled, true);
    assert.equal(f.calls.length, 1);
  }
});

test('社区响应流网络中断为 BGM_NETWORK，不返回原始异常或重试', async t => {
  const f = fixture(t, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('raw-response')); } }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(f.transport.community('/p1/blogs/1'), error => error.code === 'BGM_NETWORK' && !error.message.includes('raw-response'));
  assert.equal(f.calls.length, 1);
});

test('现有公共接口继续拒绝 p1，社区的源沿用 HTTPS 代理策略', async t => {
  const f = fixture(t, async () => json({}));
  await assert.rejects(f.transport.public('/p1/blogs/1'), errorCode('INVALID_INPUT'));
  assert.deepEqual(await f.transport.public('/v0/subjects/1'), {});
  assert.equal(f.calls[0].url, 'https://api.bgm.tv/v0/subjects/1');
  const policy = { source: 'config', http: null, https: 'http://127.0.0.1:7890', bypass: [] };
  assert.equal(proxyForUrl(policy, 'https://next.bgm.tv/p1/blogs/1'), 'http://127.0.0.1:7890');
  assert.equal(proxyForUrl({ ...policy, bypass: ['next.bgm.tv'] }, 'https://next.bgm.tv/p1/blogs/1'), null);
});
