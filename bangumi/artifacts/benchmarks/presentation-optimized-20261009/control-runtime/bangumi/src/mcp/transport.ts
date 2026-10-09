import { fetch } from 'undici';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ProxyDispatchers } from '../support/proxy-dispatcher.js';
import { AccountTransport, awaitResponse, discardResponse, isJsonResponse, readResponseText, withoutNetworkAttempt, type LoginFetch } from '../login/transport.js';
import { AccountSessionStore, type AccountSession } from '../login/account-session.js';
import { AppError } from '../support/errors.js';
import { object, positiveId } from '../support/bangumi.js';
import type { ProxyOptions } from '../support/proxy.js';
import { anonymousContext, type AccessContext } from './access-context.js';
import { readContext, type McpReadContext } from './read-context.js';
export interface McpRequestOptions { method?: string; query?: Record<string, unknown>; body?: unknown; expectedAccountId?: number }
/** 一次只读查询的独立连接与不可变登录绑定；不可用于提交或写入回读。 */
export interface McpReadScope {
  key: string;
  account(path: string, options?: McpRequestOptions): Promise<unknown>;
  verify(options?: { usedNsfw?: boolean; context?: AccessContext }): Promise<void>;
  close(): Promise<void>;
}
export interface McpTransport {
  public(path: string, options?: McpRequestOptions, signal?: AbortSignal): Promise<unknown>;
  community(path: string, options?: McpRequestOptions, signal?: AbortSignal): Promise<unknown>;
  account(path: string, options?: McpRequestOptions, signal?: AbortSignal): Promise<unknown>;
  currentUser(signal?: AbortSignal, fresh?: boolean): Promise<{ id: number; username: string }>;
  identity?(signal?: AbortSignal): Promise<AccessContext>;
  cachedContextKey?(context: AccessContext): string | undefined;
  validateCachedContext?(context: AccessContext, signal?: AbortSignal, bindingKey?: string): Promise<void>;
  ensureNsfw?(context: AccessContext, signal?: AbortSignal, scope?: string, options?: { fresh?: boolean }): Promise<AccessContext>;
  withReadContext?<T>(context: McpReadContext, operation: () => Promise<T>): Promise<T>;
  clearReadContext?(turnId?: string): void;
  preflight?(signal?: AbortSignal): Promise<AccessContext>;
  setBatchSession?(active: boolean): Promise<void>;
  bindReadScope?(context: AccessContext, signal?: AbortSignal): Promise<McpReadScope>;
  webCollections?(username: string, media: string, status: string, page: number, signal?: AbortSignal): Promise<string>;
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
interface AccountBinding { session: AccountSession; api: AccountTransport; user?: { id: number; username: string } }
interface ReadCacheState { active: boolean }
/** 公共请求完全匿名；账户会话每次重新加载，不缓存登录或自动换线路。 */
class FixedMcpTransport implements McpTransport {
  private readonly dispatchers: ProxyDispatchers;
  private readonly loadSession: () => Promise<AccountSession | null>;
  private closed = false;
  private readonly closing = new AbortController();
  private rejectedSession: AccountSession | undefined;
  private activeAccount: AccountBinding | undefined;
  private batchSession: AccountSession | undefined;
  private readonly readScopeClosers = new Set<() => Promise<void>>();
  private readonly readContexts = new AsyncLocalStorage<McpReadContext & { cacheState: ReadCacheState }>();
  private readonly readCacheStates = new Map<string, ReadCacheState>();
  private readonly nsfwChecks = new Map<string, Promise<AccessContext['nsfw']>>();
  private readonly identitySessions = new WeakMap<AccessContext, string>();
  constructor(private readonly options: McpTransportOptions) {
    this.dispatchers = new ProxyDispatchers(options.proxy);
    this.loadSession = options.loadSession ?? (() => new AccountSessionStore(options.authDir).load());
  }
  private ensureOpen(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消。');
    if (this.closed) throw new AppError('MCP_CLOSED', 'MCP 连接已关闭。');
  }
  private requestSignal(signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([this.closing.signal, AbortSignal.timeout(this.options.timeoutMs), ...(signal ? [signal] : [])]);
  }
  async public(path: string, options: McpRequestOptions = {}, signal?: AbortSignal): Promise<unknown> {
    this.ensureOpen(signal);
    if (!/^(?:\/calendar|\/v0\/[A-Za-z0-9_./%-]+)$/.test(path) || path.includes('..') || /%(?:2e|2f|5c)/i.test(path) || /[\\?#\r\n]/.test(path)) throw new AppError('INVALID_INPUT', '公共请求超出固定 Bangumi 路径。');
    if (options.expectedAccountId !== undefined) throw new AppError('INVALID_INPUT', '公共请求不能携带账户绑定。');
    const method = options.method ?? 'GET';
    if (method !== 'GET' && !(method === 'POST' && /^\/v0\/search\/(subjects|characters|persons)$/.test(path))) throw new AppError('INVALID_INPUT', '公共传输只允许读取及固定搜索。');
    const url = new URL(path, 'https://api.bgm.tv');
    if (url.origin !== 'https://api.bgm.tv') throw new AppError('INVALID_INPUT', '公共请求主机无效。');
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const active = this.requestSignal(signal);
    const headers = {
      Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    };
    const init = { method, headers, signal: active, redirect: 'manual' as const, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) };
    const response = await awaitResponse(Promise.resolve().then(() => this.options.fakeFetch ? this.options.fakeFetch(url.href, init) : fetch(url.href, { ...init, dispatcher: this.dispatchers.forUrl(url.href) }) as unknown as Promise<Response>), active, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      discardResponse(response);
      if (!/^\/v0\/(?:subjects|characters|persons)\/[1-9]\d*\/image$/.test(path)) throw new AppError('INVALID_RESPONSE', '公共接口发生非图片跳转，未跟随重定向。');
      const location = response.headers.get('location');
      if (!location) throw new AppError('INVALID_RESPONSE', '图片接口缺少跳转地址。');
      let image: URL;
      try { image = new URL(location, url); } catch { throw new AppError('INVALID_RESPONSE', '图片地址无效。'); }
      if (image.protocol !== 'https:' || image.username || image.password) throw new AppError('INVALID_RESPONSE', '图片地址不是有效的 HTTPS URL。');
      return { Location: image.href };
    }
    if (!response.ok) { discardResponse(response); throw new AppError(`BGM_HTTP_${response.status}`, response.status === 429 ? 'Bangumi 请求限流，请稍后重试；未自动换线路。' : 'Bangumi 公共请求失败，请核对资源和网络。'); }
    if (response.status === 204) { discardResponse(response); return null; }
    if (!isJsonResponse(response)) { discardResponse(response); throw new AppError('INVALID_RESPONSE', 'Bangumi 公共接口未返回 JSON。'); }
    const text = await readResponseText(response, active, signal);
    this.ensureOpen(signal);
    try { return JSON.parse(text); }
    catch { throw new AppError('INVALID_RESPONSE', 'Bangumi 公共接口返回无效 JSON。'); }
  }
  /** 社区内容使用固定 p1 只读路径；始终匿名，不加载或发送账户会话。 */
  async community(path: string, options: McpRequestOptions = {}, signal?: AbortSignal): Promise<unknown> {
    this.ensureOpen();
    const aborted = () => new AppError(this.closed ? 'MCP_CLOSED' : signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT', 'Bangumi 社区读取已取消或超时；未自动重试。');
    if (signal?.aborted) throw aborted();
    const matched = /^\/p1\/subjects\/([1-9]\d*)\/(?:comments|reviews|topics)$/.exec(path)
      ?? /^\/p1\/blogs\/([1-9]\d*)(?:\/comments)?$/.exec(path)
      ?? /^\/p1\/subjects\/-\/topics\/([1-9]\d*)$/.exec(path);
    if (!matched || !Number.isSafeInteger(Number(matched[1]))) throw new AppError('INVALID_INPUT', '社区读取超出固定 Bangumi 路径。');
    if ((options.method ?? 'GET') !== 'GET' || options.body !== undefined || options.expectedAccountId !== undefined) throw new AppError('INVALID_INPUT', '社区传输仅允许匿名 GET 读取。');
    const url = new URL(path, 'https://next.bgm.tv');
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    const active = this.requestSignal(signal);
    const init = { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)' }, signal: active, redirect: 'manual' as const };
    let response: Response;
    try {
      const pending = this.options.fakeFetch ? this.options.fakeFetch(url.href, init) : fetch(url.href, { ...init, dispatcher: this.dispatchers.forUrl(url.href) }) as unknown as Promise<Response>;
      // 依赖注入也必须遵守取消边界；迟到的响应丢弃，不发起第二次请求。
      response = await new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(aborted());
        active.addEventListener('abort', onAbort, { once: true });
        if (active.aborted) onAbort();
        pending.then(value => {
          if (active.aborted) { void value.body?.cancel().catch(() => { }); reject(aborted()); }
          else resolve(value);
        }, reject).finally(() => active.removeEventListener('abort', onAbort));
      });
    } catch {
      throw active.aborted ? aborted() : new AppError('BGM_NETWORK', 'Bangumi 社区请求未完成；未自动重试。');
    }
    if (active.aborted) { await response.body?.cancel(); throw aborted(); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      throw new AppError('INVALID_RESPONSE', 'Bangumi 社区接口发生跳转，未跟随重定向。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`BGM_HTTP_${response.status}`, response.status === 429 ? 'Bangumi 请求限流，请稍后重试；未自动换线路。' : 'Bangumi 社区请求失败，请核对资源和网络。');
    }
    if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new AppError('INVALID_RESPONSE', 'Bangumi 社区接口未返回 JSON。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('INVALID_RESPONSE', 'Bangumi 社区响应为空。');
    const onAbort = () => { void reader.cancel().catch(() => { }); };
    active.addEventListener('abort', onAbort, { once: true });
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        if (active.aborted) throw aborted();
        const item = await reader.read();
        if (active.aborted) throw aborted();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new AppError('BGM_OUTPUT_LIMIT', 'Bangumi 社区响应超过读取上限，请缩小范围。'); }
        chunks.push(item.value);
      }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new AppError('INVALID_RESPONSE', 'Bangumi 社区接口返回无效 JSON。'); }
    } catch (error) {
      if (active.aborted) throw aborted();
      if (error instanceof AppError) throw error;
      throw new AppError('BGM_NETWORK', 'Bangumi 社区响应读取未完成；未自动重试。');
    } finally { active.removeEventListener('abort', onAbort); reader.releaseLock(); }
  }
  private async withAccount<T>(run: (api: AccountTransport, session: AccountSession, binding: AccountBinding) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.ensureOpen(signal);
    const session = structuredClone(await this.loadSession());
    this.ensureOpen(signal);
    if (!session) throw new AppError('BGM_AUTH_REQUIRED', '请先运行 login 或在 chat 中使用 /login。');
    if (this.batchSession && !this.sameSession(this.batchSession, session)) throw new AppError('ACCOUNT_CHANGED', '批次期间本机登录会话改变，停止后续请求。');
    if (session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED', '本机登录已到期，请重新 /login。');
    if (this.rejectedSession && this.sameSession(this.rejectedSession, session)) throw new AppError('BGM_AUTH_EXPIRED', '网站已拒绝此会话，请重新 /login；未继续个人请求。');
    let binding = this.activeAccount;
    if (!binding || !this.sameSession(binding.session, session)) {
      const previous = binding;
      binding = { session, api: new AccountTransport(session, this.options.proxy, this.options.timeoutMs, this.options.fakeFetch) };
      this.activeAccount = binding;
      await previous?.api.close();
    }
    this.ensureOpen(signal);
    try {
      const result = await run(binding.api, session, binding);
      this.ensureOpen(signal);
      await this.verifySession(session, signal);
      return result;
    }
    catch (error) {
      if (error instanceof AppError && error.code === 'BGM_HTTP_401') this.rejectSession(session);
      throw error;
    }
  }
  private sameSession(a: AccountSession, b: AccountSession): boolean {
    return a.accountId === b.accountId && a.savedAt === b.savedAt && a.sessionId === b.sessionId;
  }
  private sessionKey(session: AccountSession): string {
    return createHash('sha256').update(JSON.stringify([session.accountId, session.savedAt, session.sessionId])).digest('hex');
  }
  withReadContext<T>(context: McpReadContext, operation: () => Promise<T>): Promise<T> {
    const checked = readContext(context);
    return this.readContexts.run({ ...checked, cacheState: this.readCacheState(checked.turnId) }, operation);
  }
  private readCacheState(scope: string): ReadCacheState {
    let state = this.readCacheStates.get(scope);
    if (!state) {
      state = { active: true }; this.readCacheStates.set(scope, state);
      if (this.readCacheStates.size > 256) this.clearReadContext(this.readCacheStates.keys().next().value!);
    }
    return state;
  }
  clearReadContext(turnId?: string): void {
    if (turnId === undefined) {
      for (const state of this.readCacheStates.values()) state.active = false;
      this.readCacheStates.clear(); this.nsfwChecks.clear(); return;
    }
    const scope = readContext({ turnId }).turnId;
    const state = this.readCacheStates.get(scope);
    if (state) state.active = false;
    this.readCacheStates.delete(scope);
    for (const key of this.nsfwChecks.keys()) {
      if ((JSON.parse(key) as [string, string])[0] === scope) this.nsfwChecks.delete(key);
    }
  }
  private waitNsfw(pending: Promise<AccessContext['nsfw']>, signal?: AbortSignal): Promise<AccessContext['nsfw']> {
    const active = AbortSignal.any([this.closing.signal, ...(signal ? [signal] : [])]);
    return new Promise((resolve, reject) => {
      const abort = () => {
        active.removeEventListener('abort', abort);
        try { this.ensureOpen(signal); } catch (error) { reject(error); }
      };
      active.addEventListener('abort', abort, { once: true });
      if (active.aborted) abort();
      pending.then(value => {
        active.removeEventListener('abort', abort);
        if (active.aborted) abort(); else resolve(value);
      }, error => {
        active.removeEventListener('abort', abort);
        if (active.aborted) abort(); else reject(error);
      });
    });
  }
  private rejectSession(session: AccountSession): void {
    // 迟到的旧会话401不能覆盖当前会话已经被拒绝的事实。
    if (!this.activeAccount || this.sameSession(this.activeAccount.session, session)) this.rejectedSession = session;
  }
  private async verifySession(session: AccountSession, signal?: AbortSignal): Promise<void> {
    this.ensureOpen(signal);
    const latest = await this.loadSession();
    this.ensureOpen(signal);
    if (!latest || !this.sameSession(latest, session)) throw new AppError('ACCOUNT_CHANGED', '账户请求期间本机登录会话改变。');
    if (latest.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED', '账户请求期间本机登录到期。');
    if (this.rejectedSession && this.sameSession(this.rejectedSession, session)) throw new AppError('BGM_AUTH_EXPIRED', '网站已拒绝此会话，未继续个人请求。');
  }
  async setBatchSession(active: boolean): Promise<void> {
    if (!active) { this.batchSession = undefined; return; }
    this.ensureOpen();
    const session = structuredClone(await this.loadSession());
    this.ensureOpen();
    if (!session || !this.activeAccount || !this.sameSession(session, this.activeAccount.session)) throw new AppError('ACCOUNT_CHANGED', '开始预检期间登录会话改变。');
    if (session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED', '开始批次时登录已到期。');
    if (this.batchSession && !this.sameSession(this.batchSession, session)) throw new AppError('ACCOUNT_CHANGED', '已有批次绑定不能替换。');
    this.batchSession = session;
  }
  async currentUser(signal?: AbortSignal, fresh = true): Promise<{ id: number; username: string }> {
    return this.withAccount(async (api, session, binding) => {
      if (!fresh && binding.user) return structuredClone(binding.user);
      delete binding.user;
      const user = userFrom(await api.json('/p1/me', { auth: true }, signal));
      if (user.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '网站账户与本机保存登录不一致。');
      binding.user = user;
      return structuredClone(user);
    }, signal);
  }
  /** 缓存读取只核对本机已验证登录绑定，不发起HTTP。 */
  cachedContextKey(context: AccessContext): string | undefined {
    return context.account && this.activeAccount?.user?.id === context.account.id ? this.sessionKey(this.activeAccount.session) : undefined;
  }
  async validateCachedContext(context: AccessContext, signal?: AbortSignal, bindingKey?: string): Promise<void> {
    this.ensureOpen(signal);
    if (!context.account) return;
    const session = await this.loadSession();
    if (!session || session.expiresAt <= Date.now() || bindingKey !== undefined && this.sessionKey(session) !== bindingKey || session.accountId !== context.account.id || !this.activeAccount || !this.sameSession(this.activeAccount.session, session)) throw new AppError('ACCOUNT_CHANGED', '缓存读取的本机登录会话已经改变，请重新读取来源。');
  }
  async identity(signal?: AbortSignal): Promise<AccessContext> {
    this.ensureOpen(signal);
    const saved = await this.loadSession();
    this.ensureOpen(signal);
    if (!saved) return anonymousContext();
    return this.withAccount(async (api, session, binding) => {
      delete binding.user;
      const account = userFrom(await api.json('/p1/me', { auth: true }, signal));
      if (account.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '网站账户与本机保存登录不一致。');
      await this.verifySession(session, signal);
      binding.user = account;
      const context: AccessContext = {
        mode: 'account', account, nsfw: { preference: null, allowed: null, state: 'not_checked' },
        source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString()
      };
      this.identitySessions.set(context, this.sessionKey(session));
      return context;
    }, signal);
  }
  async ensureNsfw(context: AccessContext, signal?: AbortSignal, scope?: string, options: { fresh?: boolean } = {}): Promise<AccessContext> {
    this.ensureOpen(signal);
    if (context.mode !== 'account' || !context.account) return structuredClone(context);
    const readTask = this.readContexts.getStore();
    const taskScope = scope === undefined ? readTask?.turnId : readContext({ turnId: scope }).turnId;
    const cacheState = taskScope === undefined ? undefined : scope === undefined ? readTask?.cacheState : this.readCacheState(taskScope);
    return this.withAccount(async (api, session, binding) => {
      const sessionKey = this.sessionKey(session);
      const previousSession = this.identitySessions.get(context);
      if (previousSession !== undefined && previousSession !== sessionKey) throw new AppError('ACCOUNT_CHANGED', '身份核验后的本机登录会话改变。');
      const account = binding.user ?? userFrom(await api.json('/p1/me', { auth: true }, signal));
      if (account.id !== session.accountId || account.id !== context.account!.id || account.username !== context.account!.username) {
        throw new AppError('ACCOUNT_CHANGED', 'NSFW 权限查询账户与已核实身份不一致。');
      }
      binding.user = account;
      await this.verifySession(session, signal);
      const check = async (): Promise<AccessContext['nsfw']> => {
        let preference: boolean | null = null, allowed: boolean | null = null;
        try {
          const privacy = object(await api.json('/p1/privacy', { auth: true }, signal));
          const preferences = privacy.preferences == null ? {} : object(privacy.preferences);
          preference = typeof preferences.showNsfwSubject === 'boolean' ? preferences.showNsfwSubject : null;
          allowed = typeof preferences.allowNsfw === 'boolean' ? preferences.allowNsfw : null;
        } catch (error) {
          // 仅权限读取失败可局部跳过；身份、会话和取消边界仍终止原请求。
          if (!(error instanceof AppError) || !(error.code !== 'BGM_HTTP_401' && /^BGM_HTTP_\d+$/.test(error.code)
            || ['BGM_NETWORK', 'BGM_TIMEOUT', 'BGM_OUTPUT_LIMIT', 'INVALID_RESPONSE'].includes(error.code))) throw error;
        }
        await this.verifySession(session, signal);
        return { preference, allowed, state: allowed === null ? 'unknown' : allowed ? 'enabled' : 'disabled' };
      };
      const key = taskScope === undefined || !cacheState?.active ? undefined : JSON.stringify([taskScope, sessionKey]);
      let pending = key === undefined || options.fresh ? undefined : this.nsfwChecks.get(key);
      if (!pending) {
        pending = check();
        if (key !== undefined && cacheState?.active) {
          this.nsfwChecks.set(key, pending);
          // 任务结束后的缓存仅保留有界数量，不携带任何原始会话凭据。
          if (this.nsfwChecks.size > 256) this.nsfwChecks.delete(this.nsfwChecks.keys().next().value!);
          void pending.catch(() => { if (this.nsfwChecks.get(key) === pending) this.nsfwChecks.delete(key); });
        }
      }
      const nsfw = structuredClone(await this.waitNsfw(pending, signal));
      this.ensureOpen(signal);
      const verified: AccessContext = { ...structuredClone(context), nsfw, nsfwApplied: nsfw.allowed === true, checkedAt: new Date().toISOString() };
      this.identitySessions.set(verified, sessionKey);
      return verified;
    }, signal);
  }
  /** 兼容显式权限预检；普通公共读取及账户身份核验不得调用此方法。 */
  async preflight(signal?: AbortSignal): Promise<AccessContext> {
    return this.ensureNsfw(await this.identity(signal), signal, undefined, { fresh: true });
  }
  async webCollections(username: string, media: string, status: string, page: number, signal?: AbortSignal): Promise<string> {
    this.ensureOpen(signal);
    if (!/^[A-Za-z0-9_]+$/.test(username) || !['book', 'anime', 'music', 'game', 'real'].includes(media)
      || !['wish', 'collect', 'do', 'on_hold', 'dropped'].includes(status) || !Number.isInteger(page) || page < 1 || page > 417) throw new AppError('INVALID_INPUT', '网页收藏读取超出固定范围。');
    const url = new URL(`/${media}/list/${username}/${status}`, 'https://bgm.tv');
    url.searchParams.set('orderby', 'date'); url.searchParams.set('page', String(page));
    const active = this.requestSignal(signal);
    const init = { method: 'GET', headers: { Accept: 'text/html', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)' }, signal: active, redirect: 'manual' as const };
    const response = await awaitResponse(Promise.resolve().then(() => this.options.fakeFetch ? this.options.fakeFetch(url.href, init) : fetch(url.href, { ...init, dispatcher: this.dispatchers.forUrl(url.href) }) as unknown as Promise<Response>), active, signal);
    if (!response.ok) { discardResponse(response); throw new AppError(`BGM_HTTP_${response.status}`, '网页收藏读取失败，未绕过登录或人机验证。'); }
    if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { discardResponse(response); throw new AppError('INVALID_RESPONSE', '网页收藏接口未返回 HTML。'); }
    const text = await readResponseText(response, active, signal);
    this.ensureOpen(signal);
    return text;
  }
  async account(path: string, options: McpRequestOptions = {}, signal?: AbortSignal): Promise<unknown> {
    let dispatched = false;
    try {
      return await this.withAccount(async (api, session, binding) => {
        if (!/^\/p1\/[A-Za-z0-9_./%-]+$/.test(path) || path.includes('..') || /^\/p1\/(?:login|logout)(?:\/|$)/.test(path)) throw new AppError('INVALID_INPUT', '账户请求超出固定业务路径。');
        const before = binding.user ?? userFrom(await api.json('/p1/me', { auth: true }, signal));
        if (before.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '账户请求前登录身份发生变化。');
        if (options.expectedAccountId !== undefined && before.id !== positiveId(options.expectedAccountId)) throw new AppError('ACCOUNT_CHANGED', '当前登录账户与宿主授权账户不一致，未提交。');
        binding.user = before;
        await this.verifySession(session, signal);
        const { expectedAccountId: _expectedAccountId, ...request } = options;
        dispatched = true;
        const data = await api.json(path, { ...request, auth: true }, signal);
        return data;
      }, signal);
    } catch (error) { throw dispatched ? error : withoutNetworkAttempt(error); }
  }
  async bindReadScope(context: AccessContext, signal?: AbortSignal): Promise<McpReadScope> {
    this.ensureOpen(signal);
    const session = structuredClone(await this.loadSession());
    const expectedSession = this.identitySessions.get(context);
    context = structuredClone(context);
    this.ensureOpen(signal);
    if (!session || context.mode !== 'account' || !context.account) throw new AppError('BGM_AUTH_REQUIRED', '本人出演查询需要已核实的登录账户。');
    if (session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED', '本机登录已到期，请重新登录。');
    const sessionKey = this.sessionKey(session);
    if ((expectedSession !== undefined && expectedSession !== sessionKey) || session.accountId !== context.account.id || !this.activeAccount || !this.sameSession(this.activeAccount.session, session)
      || this.activeAccount.user?.id !== context.account.id || this.activeAccount.user.username !== context.account.username) throw new AppError('ACCOUNT_CHANGED', '预检后的本机登录会话改变，未开始关系查询。');
    if (this.rejectedSession && this.sameSession(this.rejectedSession, session)) {
      throw new AppError('BGM_AUTH_EXPIRED', '网站已拒绝此会话，未继续关系查询。');
    }
    // 私有会话只参与宿主哈希，不进入模型参数、结果或日志。
    const taskScope = this.readContexts.getStore()?.turnId;
    const key = taskScope === undefined ? sessionKey
      : createHash('sha256').update(JSON.stringify([taskScope, sessionKey])).digest('hex');
    const api = new AccountTransport(session, this.options.proxy, this.options.timeoutMs, this.options.fakeFetch);
    let closed = false;
    const unchanged = async (): Promise<void> => {
      this.ensureOpen(signal);
      if (closed) throw new AppError('MCP_CLOSED', '关系读取上下文已关闭。');
      await this.verifySession(session, signal);
    };
    const read = async (path: string, options: McpRequestOptions = {}): Promise<unknown> => {
      await unchanged();
      if (!/^\/p1\/(?:persons\/[1-9]\d*\/casts|subjects\/[1-9]\d*|me|privacy)$/.test(path)
        || (options.method ?? 'GET') !== 'GET' || options.body !== undefined) throw new AppError('INVALID_INPUT', '关系读取上下文只允许固定 GET 查询。');
      const id = /\/(\d+)(?:\/|$)/.exec(path)?.[1]; if (id !== undefined) positiveId(Number(id));
      if (options.expectedAccountId !== undefined && options.expectedAccountId !== session.accountId) throw new AppError('ACCOUNT_CHANGED', '关系查询账户与绑定上下文不一致。');
      try {
        const value = await api.json(path, { ...(options.query === undefined ? {} : { query: options.query }), auth: true }, signal);
        await unchanged();
        return value;
      } catch (error) {
        if (error instanceof AppError && error.code === 'BGM_HTTP_401') this.rejectSession(session);
        throw error;
      }
    };
    const close = async () => { if (!closed) { closed = true; this.readScopeClosers.delete(close); await api.close(); } };
    this.readScopeClosers.add(close);
    return {
      key, account: read, verify: async (options = {}) => {
        const user = userFrom(await read('/p1/me'));
        if (user.id !== context.account!.id || user.username !== context.account!.username) throw new AppError('ACCOUNT_CHANGED', '关系查询结束时网站账户改变。');
        if (!options.usedNsfw) return;
        const expected = options.context ?? context;
        if (expected.mode !== 'account' || expected.account?.id !== user.id || expected.account.username !== user.username
          || expected.source !== 'p1' || !expected.nsfwApplied || expected.nsfw.allowed !== true) throw new AppError('NSFW_SCOPE_CHANGED', 'NSFW 关系读取缺少已核实的授权范围。');
        let preference: boolean | null = null, allowed: boolean | null = null;
        try {
          const privacy = object(await read('/p1/privacy'));
          const preferences = privacy.preferences == null ? {} : object(privacy.preferences);
          preference = typeof preferences.showNsfwSubject === 'boolean' ? preferences.showNsfwSubject : null;
          allowed = typeof preferences.allowNsfw === 'boolean' ? preferences.allowNsfw : null;
        } catch (error) {
          if (!(error instanceof AppError) || !['BGM_HTTP_403', 'BGM_HTTP_404'].includes(error.code)) throw error;
        }
        if (preference !== expected.nsfw.preference || allowed !== expected.nsfw.allowed) throw new AppError('NSFW_SCOPE_CHANGED', '关系读取期间 NSFW 权限改变，请重新查询。');
      }, close
    };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.batchSession = undefined; this.clearReadContext(); this.closing.abort(new AppError('MCP_CLOSED', 'MCP 连接已关闭。'));
    await Promise.all([this.activeAccount?.api.close(), ...[...this.readScopeClosers].map(close => close()), this.dispatchers.close()]);
  }
}
export function createMcpTransport(options: McpTransportOptions): McpTransport { return new FixedMcpTransport(options); }
