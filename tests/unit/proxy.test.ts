import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseConfig, pathsFor } from '../../src/config/config.js';
import { decodeProxyPolicy, environmentProxy, policyFor, proxyForUrl, proxySummary, windowsProxy, type WindowsProxy } from '../../src/config/proxy.js';

const system: WindowsProxy = { enabled: true, server: '127.0.0.1:18888', bypass: 'localhost;<local>;*.internal.test', pac: false, autoDetect: false };
test('代理优先级：显式配置/直连、应用变量、标准变量；不绑定7890', () => {
  const env = { BANGUMI_AGENT_PROXY: 'http://127.0.0.1:18080', HTTPS_PROXY: 'http://127.0.0.1:18081', HTTP_PROXY: 'http://127.0.0.1:18082' };
  assert.equal(parseConfig({ proxy: 'http://127.0.0.1:19999' }, env).proxy, 'http://127.0.0.1:19999');
  assert.equal(parseConfig({ proxy: null }, env).proxyPolicy?.source, 'config');
  assert.equal(parseConfig({ proxy: null }, env).proxy, null);
  assert.equal(parseConfig({}, env).proxyPolicy?.source, 'app-env');
  assert.equal(parseConfig({}, { ...env, BANGUMI_AGENT_PROXY: '' }).proxy, null);
  assert.equal(parseConfig({}, { HTTPS_PROXY: env.HTTPS_PROXY, HTTP_PROXY: env.HTTP_PROXY }).proxyPolicy?.source, 'environment');
  assert.equal(parseConfig({}, {}).proxyPolicy?.source, 'direct');
});
test('HTTP/HTTPS分流与小写优先；单HTTP兼容HTTPS，单HTTPS保留HTTP直连', () => {
  const p = environmentProxy({ http_proxy: 'http://proxy.test:8000', HTTP_PROXY: 'http://ignored.test:8001', HTTPS_PROXY: 'http://tls.test:8002' })!;
  assert.equal(proxyForUrl(p, 'http://service.test'), 'http://proxy.test:8000');
  assert.equal(proxyForUrl(p, 'https://service.test'), 'http://tls.test:8002');
  assert.equal(environmentProxy({ HTTP_PROXY: 'http://proxy.test:8080' })?.https, 'http://proxy.test:8080');
  assert.equal(environmentProxy({ HTTPS_PROXY: 'http://proxy.test:8080' })?.http, null);
});
test('NO_PROXY支持域名边界、子域、端口、IPv6、全绕过；不误匹配相似域名', () => {
  const p = environmentProxy({ HTTPS_PROXY: 'http://proxy.test:8080', NO_PROXY: 'localhost,.example.test,api.test:443,[::1]:8443,127.0.0.1' })!;
  for (const url of ['https://example.test', 'https://x.example.test', 'https://api.test', 'https://[::1]:8443', 'https://127.0.0.1']) assert.equal(proxyForUrl(p, url), null);
  for (const url of ['https://notexample.test', 'https://api.test:8443', 'https://[::1]:443']) assert.equal(proxyForUrl(p, url), 'http://proxy.test:8080');
  assert.equal(proxyForUrl(environmentProxy({ HTTPS_PROXY: p.https!, NO_PROXY: '*' })!, 'https://anything.test'), null);
  assert.equal(proxyForUrl(environmentProxy({ HTTPS_PROXY: p.https!, no_proxy: 'localhost', NO_PROXY: '*' })!, 'https://anything.test'), p.https);
});
test('Windows支持普通与分协议代理、关闭状态与本地绕过；拒绝PAC及仅SOCKS', () => {
  const p = windowsProxy(system)!; assert.equal(p.https, 'http://127.0.0.1:18888');
  assert.equal(proxyForUrl(p, 'https://intranet'), null); assert.equal(proxyForUrl(p, 'https://abc.internal.test'), null);
  const split = windowsProxy({ ...system, server: 'http=127.0.0.1:18880;https=127.0.0.1:18881' })!;
  assert.equal(split.http, 'http://127.0.0.1:18880'); assert.equal(split.https, 'http://127.0.0.1:18881');
  assert.equal(windowsProxy({ ...system, enabled: false }), null);
  const wildcard = windowsProxy({ ...system, bypass: '192.168.*;*.internal.test;single.test' })!;
  assert.equal(proxyForUrl(wildcard, 'https://192.168.1.2'), null);
  assert.equal(proxyForUrl(wildcard, 'https://sub.single.test'), wildcard.https);
  assert.deepEqual(decodeProxyPolicy(JSON.stringify(wildcard)), wildcard);
  assert.throws(() => windowsProxy({ ...system, pac: true }), { code: 'PROXY_AUTO_UNSUPPORTED' });
  assert.throws(() => windowsProxy({ ...system, autoDetect: true }), { code: 'PROXY_AUTO_UNSUPPORTED' });
  assert.throws(() => windowsProxy({ ...system, server: 'socks=127.0.0.1:18888' }), { code: 'INVALID_PROXY' });
});
test('异步系统发现只用于Windows且无较高优先级配置；不读取真实注册表', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bgm-proxy-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = pathsFor({ BANGUMI_AGENT_HOME: dir }); let calls = 0;
  const discovery = { platform: 'win32' as const, read: async () => { calls++; return system; } };
  assert.equal((await loadConfig(paths, {}, discovery)).proxyPolicy?.source, 'windows'); assert.equal(calls, 1);
  await loadConfig(paths, { HTTPS_PROXY: 'http://other.test:8000' }, discovery); assert.equal(calls, 1);
  await writeFile(paths.config, '{"proxy":null}'); assert.equal((await loadConfig(paths, {}, discovery)).proxy, null); assert.equal(calls, 1);
  await writeFile(paths.config, '{}'); assert.equal((await loadConfig(paths, {}, { ...discovery, platform: 'linux' })).proxy, null); assert.equal(calls, 1);
  await assert.rejects(loadConfig(paths, {}, { ...discovery, read: async () => { throw new Error('discovery failed'); } }));
});
test('代理凭据/路径/不支持协议不进入错误或状态；传输快照严格校验', () => {
  for (const proxy of ['http://user:private-test-secret@host:8000', 'socks5://host:8000', 'http://host:8000/path', 'http://host:8000?token=private-test-secret']) {
    assert.throws(() => parseConfig({ proxy }, {}), error => error instanceof Error && !error.message.includes('private-test-secret'));
  }
  assert.throws(() => parseConfig({ proxy: {} }, {}));
  assert.throws(() => decodeProxyPolicy('{"source":"environment","http":null,"https":null,"bypass":[1]}'));
  const p = environmentProxy({ HTTPS_PROXY: 'http://127.0.0.1:18080', NO_PROXY: '.local.test' })!;
  assert.deepEqual(decodeProxyPolicy(JSON.stringify(p)), p); assert.match(proxySummary(p), /标准环境变量/);
});
