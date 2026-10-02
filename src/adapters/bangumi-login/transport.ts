import { fetch } from 'undici';
import { ProxyDispatchers } from '../proxy-dispatcher.js';
import type { ProxyOptions } from '../../config/proxy.js';
import { AppError, registerCredentials } from '../../domain/errors.js';
import { object, positiveId } from '../../domain/bangumi.js';
import type { AccountSession } from '../../storage/account-session.js';

export type LoginFetch = (url: string, init: { method: string; headers: Record<string,string>; body?: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;
export const VERIFICATION_ORIGIN = 'https://oauth-backend-jet.vercel.app';
export class AccountTransport {
  private readonly dispatchers: ProxyDispatchers;
  constructor(private readonly session: AccountSession | null, proxy: ProxyOptions = null, private readonly timeout = 60000, private readonly fakeFetch?: LoginFetch) { this.dispatchers = new ProxyDispatchers(proxy); }
  private async request(url: string, method: string, headers: Record<string,string>, body?: string, signal?: AbortSignal): Promise<Response> {
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]) : AbortSignal.timeout(this.timeout);
    active.throwIfAborted();
    const init = { method, headers: { Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)', ...headers }, signal: active, redirect: 'manual' as const, ...(body === undefined ? {} : { body }) };
    let response: Response;
    try { response = this.fakeFetch ? await this.fakeFetch(url, init) : await fetch(url, { ...init, dispatcher: this.dispatchers.forUrl(url) }) as unknown as Response; }
    catch { throw new AppError(active.aborted ? signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT' : 'BGM_NETWORK', '请求未完成；未自动重试。'); }
    active.throwIfAborted();
    if (!response.ok) {
      // 原始错误正文可能含认证数据，禁止回显；只读取固定错误码分类。
      let code: unknown;
      try { code = object(await response.json()).code; } catch {}
      if (url.endsWith('/p1/login')) {
        if (code === 'CAPTCHA_ERROR') throw new AppError('BGM_CAPTCHA_REJECTED', '人机验证失效或被拒绝，请重新 /login 获取新验证。');
        if (code === 'EMAIL_PASSWORD_ERROR') throw new AppError('BGM_LOGIN_REJECTED', '邮箱或密码不正确，请重新 /login。');
        if (code === 'USER_BANNED') throw new AppError('BGM_LOGIN_REJECTED', '账户无法登录，请在 Bangumi 网站核对状态。');
        if (response.status === 429) throw new AppError('BGM_RATE_LIMIT', '登录尝试过于频繁，请稍后再试。');
      }
      throw new AppError(`BGM_HTTP_${response.status}`, '认证、权限或请求失败，请核对登录与网络状态。');
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new AppError('INVALID_RESPONSE', '服务未返回 JSON。');
    return response;
  }
  async verificationSession(relayUrl: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.request(`${VERIFICATION_ORIGIN}/api/turnstile/session`, 'POST', { 'Content-Type':'application/json' }, JSON.stringify({ relay_url:relayUrl }), signal);
    try { return await response.json(); } catch { throw new AppError('INVALID_RESPONSE', '验证服务返回无效 JSON。'); }
  }
  async signIn(email: string, password: string, turnstileToken: string, signal: AbortSignal): Promise<{ session: AccountSession; user: { id:number; username:string } }> {
    registerCredentials([password, turnstileToken]);
    const response = await this.request('https://next.bgm.tv/p1/login', 'POST', { 'Content-Type':'application/json' }, JSON.stringify({ email, password, turnstileToken }), signal);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new AppError('INVALID_RESPONSE', '登录响应无效。'); }
    const user = object(raw); const id = positiveId(user.id);
    if (typeof user.username !== 'string' || !user.username || user.username.length > 200) throw new AppError('INVALID_RESPONSE', '登录响应缺少用户名。');
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
    const matches = cookies.flatMap(cookie => [...cookie.matchAll(/(?:^|,\s*)chiiNextSessionID=([^;,\s]+)/g)].map(match => ({ value:match[1]!, cookie })));
    if (matches.length !== 1 || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(matches[0]!.value)) throw new AppError('INVALID_RESPONSE', '登录响应缺少有效且唯一的账户会话，未保存。');
    const savedAt = Date.now(); const maxAge = /;\s*Max-Age=(\d+)/i.exec(matches[0]!.cookie)?.[1];
    const seconds = maxAge === undefined ? 30*86400 : Math.min(Number(maxAge),30*86400);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new AppError('INVALID_RESPONSE', '登录会话已过期，未保存。');
    const session: AccountSession = { version:1, accountId:id, username:user.username, sessionId:matches[0]!.value, savedAt, expiresAt:savedAt+seconds*1000 };
    registerCredentials([session.sessionId]);
    return { session, user:{id,username:user.username} };
  }
  async json(path: string, options: { method?:string; query?:Record<string,unknown>; body?:unknown; auth?:boolean } = {}, signal?:AbortSignal): Promise<unknown> {
    if (!path.startsWith('/p1/') || /[\\#\r\n]/.test(path)) throw new AppError('INVALID_INPUT','只允许固定 Bangumi p1 路径。');
    if (options.auth && !this.session) throw new AppError('BGM_AUTH_REQUIRED','请先运行 login 完成邮箱登录。');
    if (this.session && this.session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED','本机登录已到期，请重新运行 login。');
    const url = new URL(path,'https://next.bgm.tv');
    if (url.origin !== 'https://next.bgm.tv' || !url.pathname.startsWith('/p1/')) throw new AppError('INVALID_INPUT','请求超出固定 Bangumi 主机或路径。');
    for (const [key,value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key,String(item));
    const response = await this.request(url.href,options.method ?? 'GET',{ ...(this.session ? {Cookie:`chiiNextSessionID=${this.session.sessionId}`} : {}), ...(options.body === undefined ? {} : {'Content-Type':'application/json'}) },options.body === undefined ? undefined : JSON.stringify(options.body),signal);
    try { return await response.json(); } catch { throw new AppError('INVALID_RESPONSE','Bangumi 返回无效 JSON。'); }
  }
  async close():Promise<void> { await this.dispatchers.close(); }
}
