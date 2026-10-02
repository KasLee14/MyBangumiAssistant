import { fetch } from 'undici';
import { ProxyDispatchers } from '../proxy-dispatcher.js';
import { AccountTransport, type LoginFetch } from '../bangumi-login/transport.js';
import { AccountSessionStore, type AccountSession } from '../../storage/account-session.js';
import { AppError } from '../../domain/errors.js';
import { object, positiveId } from '../../domain/bangumi.js';
import type { ProxyOptions } from '../../config/proxy.js';

export interface McpRequestOptions { method?: string; query?: Record<string, unknown>; body?: unknown; expectedAccountId?: number }
export interface McpTransport {
  public(path: string, options?: McpRequestOptions, signal?: AbortSignal): Promise<unknown>;
  account(path: string, options?: McpRequestOptions, signal?: AbortSignal): Promise<unknown>;
  currentUser(signal?: AbortSignal, fresh?: boolean): Promise<{ id: number; username: string }>;
  close(): Promise<void>;
}
export interface McpTransportOptions {
  authDir: string; proxy: ProxyOptions; timeoutMs: number;
  /** 仅供离线依赖注入，不来自应用配置或模型参数。 */
  loadSession?: () => Promise<AccountSession | null>;
  fakeFetch?: LoginFetch;
}

function userFrom(value: unknown): { id: number; username: string } {
  const user = object(value, '账户');
  if (typeof user.username !== 'string' || !user.username.trim() || user.username.length > 200) throw new AppError('INVALID_RESPONSE', '账户响应缺少有效用户名。');
  return { id: positiveId(user.id), username: user.username };
}

/** 公共请求完全匿名；账户会话每次重新加载，不缓存登录或自动换线路。 */
class FixedMcpTransport implements McpTransport {
  private readonly dispatchers: ProxyDispatchers;
  private readonly loadSession: () => Promise<AccountSession | null>;
  private closed = false;
  private rejectedSession: { accountId: number; savedAt: number } | undefined;
  private activeAccount: { session: AccountSession; api: AccountTransport; user?: { id: number; username: string } } | undefined;
  constructor(private readonly options: McpTransportOptions) {
    this.dispatchers = new ProxyDispatchers(options.proxy);
    this.loadSession = options.loadSession ?? (() => new AccountSessionStore(options.authDir).load());
  }
  private ensureOpen(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (this.closed) throw new AppError('MCP_CLOSED', 'MCP 连接已关闭。');
  }
  async public(path: string, options: McpRequestOptions = {}, signal?: AbortSignal): Promise<unknown> {
    this.ensureOpen(signal);
    if (!/^(?:\/calendar|\/v0\/[A-Za-z0-9_./%-]+)$/.test(path) || path.includes('..') || /[\\?#\r\n]/.test(path)) throw new AppError('INVALID_INPUT', '公共请求超出固定 Bangumi 路径。');
    const method = options.method ?? 'GET';
    if (method !== 'GET' && !(method === 'POST' && /^\/v0\/search\/(subjects|characters|persons)$/.test(path))) throw new AppError('INVALID_INPUT', '公共传输只允许读取及固定搜索。');
    const url = new URL(path, 'https://api.bgm.tv');
    if (url.origin !== 'https://api.bgm.tv') throw new AppError('INVALID_INPUT', '公共请求主机无效。');
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]) : AbortSignal.timeout(this.options.timeoutMs);
    const headers = { Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    const init = { method, headers, signal: active, redirect: 'manual' as const, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) };
    let response: Response;
    try { response = this.options.fakeFetch ? await this.options.fakeFetch(url.href, init) : await fetch(url.href, { ...init, dispatcher: this.dispatchers.forUrl(url.href) }) as unknown as Response; }
    catch { throw new AppError(active.aborted ? signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT' : 'BGM_NETWORK', 'Bangumi 公共请求未完成；未自动重试。'); }
    if (active.aborted) { await response.body?.cancel(); throw new AppError(signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT', 'Bangumi 公共请求已取消或超时。'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new AppError('INVALID_RESPONSE', '图片接口缺少跳转地址。');
      let image: URL;
      try { image = new URL(location, url); } catch { throw new AppError('INVALID_RESPONSE', '图片地址无效。'); }
      if (image.protocol !== 'https:' || image.username || image.password) throw new AppError('INVALID_RESPONSE', '图片地址不是有效的 HTTPS URL。');
      return { Location: image.href };
    }
    if (!response.ok) { await response.body?.cancel(); throw new AppError(`BGM_HTTP_${response.status}`, response.status === 429 ? 'Bangumi 请求限流，请稍后重试；未自动换线路。' : 'Bangumi 公共请求失败，请核对资源和网络。'); }
    if (response.status === 204) return null;
    if (!response.headers.get('content-type')?.includes('json')) { await response.body?.cancel(); throw new AppError('INVALID_RESPONSE', 'Bangumi 公共接口未返回 JSON。'); }
    const reader = response.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    if (!reader) throw new AppError('INVALID_RESPONSE', 'Bangumi 公共响应为空。');
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new AppError('BGM_OUTPUT_LIMIT', 'Bangumi 响应超过读取上限，请缩小范围。'); }
        chunks.push(item.value);
        if (active.aborted) { await reader.cancel(); throw new AppError(signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT', 'Bangumi 公共读取已取消或超时。'); }
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AppError('INVALID_RESPONSE', 'Bangumi 公共接口返回无效 JSON。'); }
    } finally { reader.releaseLock(); }
  }
  private async withAccount<T>(run: (api: AccountTransport, session: AccountSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.ensureOpen(signal);
    const session = await this.loadSession();
    if (!session) throw new AppError('BGM_AUTH_REQUIRED', '请先运行 login 或在 chat 中使用 /login。');
    if (session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED', '本机登录已到期，请重新 /login。');
    if (this.rejectedSession?.accountId === session.accountId && this.rejectedSession.savedAt === session.savedAt) throw new AppError('BGM_AUTH_EXPIRED', '网站已拒绝此会话，请重新 /login；未继续个人请求。');
    if (!this.activeAccount || !this.sameSession(this.activeAccount.session, session)) {
      await this.activeAccount?.api.close();
      this.activeAccount = { session, api: new AccountTransport(session, this.options.proxy, this.options.timeoutMs, this.options.fakeFetch) };
    }
    const api = this.activeAccount.api;
    try { return await run(api, session); }
    catch (error) {
      if (error instanceof AppError && error.code === 'BGM_HTTP_401') this.rejectedSession = { accountId: session.accountId, savedAt: session.savedAt };
      throw error;
    }
  }
  private sameSession(a: AccountSession, b: AccountSession): boolean {
    return a.accountId === b.accountId && a.savedAt === b.savedAt && a.sessionId === b.sessionId;
  }
  async currentUser(signal?: AbortSignal, fresh = true): Promise<{ id: number; username: string }> {
    return this.withAccount(async (api, session) => {
      if (!fresh && this.activeAccount?.user) return this.activeAccount.user;
      delete this.activeAccount!.user;
      const user = userFrom(await api.json('/p1/me', { auth: true }, signal));
      if (user.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '网站账户与本机保存登录不一致。');
      this.activeAccount!.user = user;
      return user;
    }, signal);
  }
  async account(path: string, options: McpRequestOptions = {}, signal?: AbortSignal): Promise<unknown> {
    return this.withAccount(async (api, session) => {
      if (!/^\/p1\/[A-Za-z0-9_./%-]+$/.test(path) || path.includes('..') || /^\/p1\/(?:login|logout)(?:\/|$)/.test(path)) throw new AppError('INVALID_INPUT', '账户请求超出固定业务路径。');
      const before = this.activeAccount?.user ?? userFrom(await api.json('/p1/me', { auth: true }, signal));
      if (before.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '账户请求前登录身份发生变化。');
      if (options.expectedAccountId !== undefined && before.id !== positiveId(options.expectedAccountId)) throw new AppError('ACCOUNT_CHANGED', '当前登录账户与宿主授权账户不一致，未提交。');
      this.activeAccount!.user = before;
      const { expectedAccountId: _expectedAccountId, ...request } = options;
      const data = await api.json(path, { ...request, auth: true }, signal);
      const latest = await this.loadSession();
      if (!latest || !this.sameSession(latest, session)) throw new AppError('ACCOUNT_CHANGED', '账户请求期间本机登录会话改变。');
      return data;
    }, signal);
  }
  async close(): Promise<void> { this.closed = true; await this.activeAccount?.api.close(); await this.dispatchers.close(); }
}

export function createMcpTransport(options: McpTransportOptions): McpTransport { return new FixedMcpTransport(options); }
