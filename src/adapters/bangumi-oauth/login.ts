import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { OAuthSessionStore, type OAuthSession } from '../../storage/oauth-session.js';
import { oauthCredentials, parseOAuthConfig, type OAuthConfig } from '../../config/oauth.js';
import type { ProxyOptions } from '../../config/proxy.js';
import { AppError } from '../../domain/errors.js';
import { object, positiveId } from '../../domain/bangumi.js';
import { OAuthTransport } from './transport.js';
import type { OAuthFetch } from './transport.js';

export function openDefaultBrowser(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(new AppError('OAUTH_BROWSER', '无法打开默认浏览器，请检查默认浏览器设置。')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export async function login(store: OAuthSessionStore, options: {
  config?: OAuthConfig; proxy?: ProxyOptions; requestTimeoutMs?: number; timeoutMs?: number; signal: AbortSignal;
  notice?: (message: string) => void; openBrowser?: (url: string) => Promise<void>; fakeFetch?: OAuthFetch;
}): Promise<{ id: number; username: string }> {
  const config = parseOAuthConfig(options.config); const { clientId } = oauthCredentials(config);
  const redirect = new URL(config.redirectUri); const state = randomBytes(32).toString('hex');
  const authorization = new URL('https://bgm.tv/oauth/authorize');
  authorization.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: config.redirectUri, state }).toString();
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]); signal.throwIfAborted();
  const transport = new OAuthTransport(null, options.proxy, options.requestTimeoutMs ?? 60000, options.fakeFetch);
  let handled = false; let settled = false;
  let finish!: (user: { id: number; username: string }) => void; let fail!: (error: unknown) => void;
  const result = new Promise<{ id: number; username: string }>((resolve, reject) => { finish = resolve; fail = reject; });
  // 回调只接收一次 code；没有 Cookie 轮询，也不从用户日常浏览器读取凭据。
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let callback: URL;
    try { callback = new URL(req.url ?? '', config.redirectUri); } catch { res.writeHead(400); res.end('无效回调。'); return; }
    if (req.method !== 'GET' || callback.pathname !== redirect.pathname) { res.writeHead(404); res.end('未找到。'); return; }
    if (req.headers.host !== redirect.host || callback.origin !== redirect.origin || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== state) { res.writeHead(400); res.end('授权状态不匹配，请返回原授权页面。'); return; }
    if (handled || settled) { res.writeHead(409); res.end('此授权已经处理。'); return; }
    const code = callback.searchParams.get('code');
    if (callback.searchParams.has('error')) { handled = true; res.writeHead(400); res.end('授权已取消，可以关闭此页。'); fail(new AppError('OAUTH_DENIED', '用户未授予 OAuth 权限。')); return; }
    if (!code || callback.searchParams.getAll('code').length !== 1 || code.length > 2000) { res.writeHead(400); res.end('缺少授权码。'); return; }
    handled = true;
    void (async () => {
      try {
        options.notice?.('已收到授权回调，正在交换 Token 并核实账户。');
        const token = await transport.token(config, { grant_type: 'authorization_code', code, state }, signal);
        const saved: OAuthSession = { version: 1, ...token, username: 'pending', clientId, config, savedAt: Date.now() };
        const api = new OAuthTransport(saved, options.proxy, options.requestTimeoutMs ?? 60000, options.fakeFetch);
        try {
          const user = object(await api.json('/p1/me', { auth: true }, signal));
          if (positiveId(user.id) !== token.accountId || typeof user.username !== 'string' || !user.username) throw new AppError('ACCOUNT_CHANGED', '授权与 API 账户不一致，未保存凭据。');
          saved.username = user.username; await store.save(saved, signal);
          settled = true; res.end('MyBangumiAssistant 授权成功，可以关闭此页并返回终端。'); finish({ id: saved.accountId, username: saved.username });
        } finally { await api.close(); }
      } catch (error) { res.writeHead(400); res.end('授权未完成，请返回终端查看提示。'); fail(error); }
    })();
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  const abort = () => fail(new AppError('CANCELLED', 'OAuth 登录已取消，原有本机登录保留。'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { fail(new AppError('OAUTH_TIMEOUT', '等待 OAuth 授权超时，原有本机登录保留。')); controller.abort(); }, options.timeoutMs ?? 180000);
  // 先安装错误处理，再开始监听；端口冲突时不会打开浏览器。
  result.catch(() => {});
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new AppError('OAUTH_CALLBACK_PORT', `无法监听回调端口 ${redirect.port}，请关闭占用进程或修改并重新登记回调地址。`)));
      server.listen(Number(redirect.port), '127.0.0.1', resolve);
    });
    signal.throwIfAborted();
    options.notice?.('即将在默认浏览器打开 Bangumi OAuth 授权；可使用已有登录，点击授权后自动返回。Esc / Ctrl+C 取消。');
    await (options.openBrowser ?? openDefaultBrowser)(authorization.href);
    return await result;
  } finally {
    settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort();
    server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => resolve()); }); await transport.close();
  }
}
