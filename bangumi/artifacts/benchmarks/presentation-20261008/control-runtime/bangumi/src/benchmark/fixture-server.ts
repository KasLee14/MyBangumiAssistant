import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FixtureRouter } from './fixtures.js';
import type { NetworkEvent, WorkerConfig } from './schema.js';
import { createPiTransport } from '../pi-transport.js';

async function main(): Promise<void> {
  const authDir = process.env.BANGUMI_AUTH_DIRECTORY;
  if (!authDir) throw new Error('缺少 benchmark 认证目录。');
  const config = JSON.parse(readFileSync(join(authDir, 'benchmark-config.json'), 'utf8')) as WorkerConfig;
  if (!['fixture', 'live-read'].includes(config.mode)) throw new Error('服务器运行模式无效。');
  const module = (name: string) => import(pathToFileURL(join(config.runtimeRoot, 'bangumi/dist/src/mcp', name + '.js')).href);
  const [{ createBangumiMcpServer }, { BangumiMcpService }, { createMcpTransport }] = await Promise.all([module('server'), module('service'), module('transport')]);
  const router = config.mode === 'fixture' ? new FixtureRouter(config.fixture, config.outputDir) : null, savedAt = Date.now() - 1000;
  const network = createPiTransport(config.proxy), networkStarted = performance.now();
  let sequence = 0;
  const { AccountSessionStore } = await import(pathToFileURL(join(config.runtimeRoot, 'bangumi/dist/src/login/account-session.js')).href);
  const accountStore = new AccountSessionStore(join(config.agentDir, '..', 'auth'));
  const liveFetch = async (input: string, init: Parameters<typeof network.fetch>[1]) => {
    const url = new URL(input), start = performance.now(), method = init?.method ?? 'GET';
    if (!['api.bgm.tv', 'next.bgm.tv'].includes(url.hostname) || !(method === 'GET' || method === 'POST' && /^\/(?:v0|p1)\/search\/(?:subjects|persons|characters)$/.test(url.pathname))) throw new Error('BENCHMARK_LIVE_WRITE_BLOCKED');
    const event: NetworkEvent = { seq: ++sequence, timestampMs: performance.timeOrigin + start, elapsedMs: start - networkStarted, durationMs: 0,
      source: 'live', path: url.pathname, method, status: null, write: false, subjectId: null,
      body: null, fixtureMiss: false };
    try { const response = await network.fetch(input, init); event.status = response.status; return response; }
    catch { event.error = 'LIVE_NETWORK_ERROR'; throw new Error('BENCHMARK_LIVE_NETWORK_ERROR'); }
    finally { event.durationMs = performance.now() - start; appendFileSync(join(config.outputDir, 'network.jsonl'), JSON.stringify(event) + '\n'); }
  };
  const transport = createMcpTransport({
    authDir, proxy: null, timeoutMs: config.mode === 'fixture' ? 5000 : 30000,
    fakeFetch: router ? router.fetch : liveFetch,
    loadSession: router ? async () => ({ version: 1, accountId: config.fixture.account.id, username: config.fixture.account.username, sessionId: 'benchmark-synthetic-session',
      savedAt, expiresAt: savedAt + 3_600_000 }) : () => accountStore.load(),
  });
  const service = new BangumiMcpService(transport), server = createBangumiMcpServer(service);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await service.close(); await server.close(); await network.close(); };
  process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => { void close(); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('BENCHMARK_FIXTURE_SERVER_FAILED\n'); process.exitCode = 1; });
}
