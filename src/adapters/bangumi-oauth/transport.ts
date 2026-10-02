import { fetch } from 'undici';
import { ProxyDispatchers } from '../proxy-dispatcher.js';
import type { ProxyOptions } from '../../config/proxy.js';
import { AppError, registerCredentials } from '../../domain/errors.js';
import type { OAuthConfig } from '../../config/oauth.js';
import { oauthCredentials } from '../../config/oauth.js';
import { object, positiveId } from '../../domain/bangumi.js';
import type { OAuthSession } from '../../storage/oauth-session.js';
export type OAuthFetch = (url: string, init: { method: string; headers: Record<string,string>; body?: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

export class OAuthTransport {
  private readonly dispatchers: ProxyDispatchers;
  constructor(private readonly session: OAuthSession | null, proxy: ProxyOptions = null, private readonly timeout = 60000, private readonly fakeFetch?: OAuthFetch) { this.dispatchers = new ProxyDispatchers(proxy); }
  private async request(url: string, method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<unknown> {
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]) : AbortSignal.timeout(this.timeout);
    active.throwIfAborted();
    const init = { method, headers: { Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)', ...headers }, signal: active, redirect: 'manual' as const, ...(body === undefined ? {} : { body }) };
    let response: Response;
    try { response = this.fakeFetch ? await this.fakeFetch(url, init) : await fetch(url, { ...init, dispatcher: this.dispatchers.forUrl(url) }) as unknown as Response; }
    catch { throw new AppError(active.aborted ? signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT' : 'BGM_NETWORK', 'Bangumi 请求未完成；未自动重试。'); }
    // 不回显 Token 接口错误正文，重定向也不自动跟随。
    if (!response.ok) throw new AppError(`BGM_HTTP_${response.status}`, 'Bangumi 认证、权限或请求失败，请核对 OAuth 登录状态。');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new AppError('INVALID_RESPONSE', 'Bangumi 未返回 JSON。');
    try { return await response.json(); } catch { throw new AppError('INVALID_RESPONSE', 'Bangumi 返回无效 JSON。'); }
  }
  async token(config: OAuthConfig, params: Record<string, string>, signal?: AbortSignal): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number; accountId: number }> {
    const { clientId, clientSecret } = oauthCredentials(config);
    const result = object(await this.request('https://bgm.tv/oauth/access_token', 'POST', { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret, redirect_uri: config.redirectUri }).toString(), signal));
    const accessToken = result.access_token; const refreshToken = result.refresh_token;
    if (typeof accessToken === 'string') registerCredentials([accessToken]);
    if (typeof refreshToken === 'string') registerCredentials([refreshToken]);
    if (typeof accessToken !== 'string' || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(accessToken)
      || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(result.expires_in) || Number(result.expires_in) <= 0 || Number(result.expires_in) > 366 * 86400
      || refreshToken !== undefined && (typeof refreshToken !== 'string' || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(refreshToken))) throw new AppError('INVALID_RESPONSE', 'OAuth Token 响应格式无效。');
    return { accessToken, ...(typeof refreshToken === 'string' ? { refreshToken } : {}), expiresAt: Date.now() + Number(result.expires_in) * 1000, accountId: positiveId(result.user_id) };
  }
  async json(path: string, options: { method?: string; query?: Record<string, unknown>; body?: unknown; auth?: boolean } = {}, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/p1/') || /[\\#\r\n]/.test(path)) throw new AppError('INVALID_INPUT', '只允许固定 Bangumi p1 路径。');
    if (options.auth && !this.session) throw new AppError('OAUTH_AUTH_REQUIRED', '请先运行 login 完成 OAuth 授权。');
    if (this.session && this.session.expiresAt <= Date.now()) throw new AppError('OAUTH_AUTH_EXPIRED', 'OAuth Token 已过期，请刷新登录。');
    const url = new URL(path, 'https://next.bgm.tv');
    if (url.origin !== 'https://next.bgm.tv') throw new AppError('INVALID_INPUT', '请求超出固定 Bangumi 主机。');
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    return this.request(url.href, options.method ?? 'GET', { ...(this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {}), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }, options.body === undefined ? undefined : JSON.stringify(options.body), signal);
  }
  async close(): Promise<void> { await this.dispatchers.close(); }
}
