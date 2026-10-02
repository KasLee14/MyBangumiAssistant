import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatCompletionsModel } from '../../src/adapters/llm/chat-completions.js';
import { OAuthTransport } from '../../src/adapters/bangumi-oauth/transport.js';
import { createBgmRunner, BgmReadClient } from '../../src/adapters/bgm-cli/client.js';
import { environmentProxy, decodeProxyPolicy, policyFor } from '../../src/config/proxy.js';
import { chatFixture } from '../fixtures/chat-fixture.js';

async function listen(server: Server): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test('标准环境代理真实CONNECT传输模型请求；本地模拟服务，不连接真实模型', async () => {
  let targetCalls = 0; let proxyCalls = 0;
  const target = await listen(createServer((_req, res) => {
    targetCalls++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"离线代理成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }));
  const proxyServer = createServer(); proxyServer.on('connect', (req, socket, head) => {
    proxyCalls++; assert.equal(req.url, 'model.offline:80');
    const upstream = connect(target.port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
  });
  const proxy = await listen(proxyServer);
  const model = new ChatCompletionsModel({ baseUrl: 'http://model.offline', model: 'fixture', apiKeyEnv: 'KEY', thinking: 'disabled' }, 3000, environmentProxy({ HTTP_PROXY: proxy.url })!, { KEY: 'offline-model-secret' });
  try { const result = await model.complete([{ role: 'user', content: '离线验证' }], [], { signal: new AbortController().signal }); assert.equal(result.content, '离线代理成功'); assert.equal(targetCalls, 1); assert.equal(proxyCalls, 1); }
  finally { await model.close(); await proxy.close(); await target.close(); }
});
test('NO_PROXY让本地模型直连，代理完全未收到连接', async () => {
  let proxyCalls = 0;
  const target = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"直连成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); }));
  const proxyServer = createServer(); proxyServer.on('connect', (_req, socket) => { proxyCalls++; socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  const proxy = await listen(proxyServer);
  const model = new ChatCompletionsModel({ baseUrl: target.url, model: 'fixture', apiKeyEnv: 'KEY', thinking: 'disabled' }, 2000, environmentProxy({ HTTP_PROXY: proxy.url, NO_PROXY: '127.0.0.1' })!, { KEY: 'offline-secret' });
  try { assert.equal((await model.complete([{ role: 'user', content: '测试' }], [], { signal: new AbortController().signal })).content, '直连成功'); assert.equal(proxyCalls, 0); }
  finally { await model.close(); await proxy.close(); await target.close(); }
});
test('Bangumi HTTPS代理故障只连接所选代理一次；不切换直连或回显响应体', async () => {
  let calls = 0; const server = createServer(); server.on('connect', (req, socket) => {
    calls++; assert.equal(req.url, 'next.bgm.tv:443'); socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 19\r\n\r\nprivate-test-secret');
  });
  const proxy = await listen(server); const transport = new OAuthTransport(null, environmentProxy({ HTTPS_PROXY: proxy.url })!, 2000);
  try { await assert.rejects(transport.json('/p1/search/subjects', { method: 'POST', body: { keyword: 'offline' } }), error => error instanceof Error && 'code' in error && error.code === 'BGM_NETWORK' && !error.message.includes('private-test-secret')); assert.equal(calls, 1); }
  finally { await transport.close(); await proxy.close(); }
});
test('父进程解析快照替换子进程继承配置，包含NO_PROXY；null明确直连', async () => {
  const entry = fileURLToPath(new URL('../../../tests/fixtures/bgm-child.mjs', import.meta.url));
  const p = environmentProxy({ HTTPS_PROXY: 'http://127.0.0.1:19999', NO_PROXY: 'next.bgm.tv' })!;
  const env = { HTTPS_PROXY: 'http://wrong.offline:8000', BANGUMI_PROXY_POLICY: 'invalid', BGM_PROXY: 'http://wrong.offline:8001' };
  const result = await createBgmRunner({ configDir: 'isolated-proxy-test', timeoutMs: 2000, proxy: p, entry, env })(['subject', 'search', 'ordinary']) as { proxyPolicy: string };
  assert.deepEqual(decodeProxyPolicy(result.proxyPolicy), p);
  const direct = await createBgmRunner({ configDir: 'isolated-proxy-test', timeoutMs: 2000, proxy: null, entry, env })(['subject', 'search', 'ordinary']) as { proxyPolicy: string; proxy?: string };
  assert.deepEqual(decodeProxyPolicy(direct.proxyPolicy), policyFor(null)); assert.equal(direct.proxy, undefined);
});
test('实际匿名read-worker沿用解析的代理快照；代理拒绝不触及真实Bangumi', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bgm-worker-proxy-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0; const server = createServer(); server.on('connect', (req, socket) => { calls++; assert.equal(req.url, 'next.bgm.tv:443'); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  const proxy = await listen(server);
  const client = new BgmReadClient(createBgmRunner({ configDir: dir, authDir: join(dir, 'auth'), timeoutMs: 5000, proxy: environmentProxy({ HTTPS_PROXY: proxy.url })!, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, HTTPS_PROXY: 'http://wrong.offline:8000' } }));
  try { await assert.rejects(client.search('offline'), { code: 'BGM_NETWORK' }); assert.equal(calls, 1); }
  finally { await proxy.close(); }
});
test('/status展示代理来源及当前模型/Bangumi实际路由', async t => {
  const f = await chatFixture(t); f.config.proxyPolicy = environmentProxy({ HTTPS_PROXY: 'http://127.0.0.1:19999', NO_PROXY: 'next.bgm.tv' })!;
  await f.controller.initialize(); await f.controller.submit('/status');
  assert.ok(f.controller.snapshot().items.some(item => item.kind === 'notice' && /应用代理：.*标准环境变量/.test(item.text) && /Bangumi 路由：直连/.test(item.text)));
});
