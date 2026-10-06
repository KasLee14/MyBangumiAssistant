import { fetch } from 'undici';
import { ProxyDispatchers } from '../support/proxy-dispatcher.js';
import type { ProxyOptions } from '../support/proxy.js';
import { AppError, registerCredentials, diagnosedError, type SubmissionRejection } from '../support/errors.js';
import { createErrorDiagnostic, errorCauses } from '../support/error-diagnostic.js';
import { object, positiveId } from '../support/bangumi.js';
import type { AccountSession } from './account-session.js';

export type LoginFetch = (url: string, init: { method: string; headers: Record<string,string>; body?: string; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;
export const VERIFICATION_ORIGIN = 'https://oauth-backend-jet.vercel.app';
/** 所有读取共用同一超时边界；不把底层异常或服务端正文带到模型。 */
function interrupted(active: AbortSignal, signal?: AbortSignal): AppError {
  if (active.reason instanceof AppError && active.reason.code === 'MCP_CLOSED') return new AppError('MCP_CLOSED', '账户连接已关闭。');
  const code = signal?.aborted ? 'CANCELLED' : 'BGM_TIMEOUT';
  return diagnosedError(new AppError(code, code === 'CANCELLED' ? '请求已取消。' : 'HTTP 请求总期限耗尽。'),
    createErrorDiagnostic({ code, origin: 'http', stage: 'fetch', reason: code === 'CANCELLED' ? 'user_cancelled' : 'http_deadline_exhausted' }));
}
export function discardResponse(response: Response): void { void response.body?.cancel().catch(() => {}); }
export async function awaitResponse(pending: Promise<Response>, active: AbortSignal, signal?: AbortSignal): Promise<Response> {
  try {
    return await new Promise<Response>((resolve, reject) => {
      const abort = () => { active.removeEventListener('abort', abort); reject(interrupted(active, signal)); };
      active.addEventListener('abort', abort, { once: true });
      if (active.aborted) abort();
      pending.then(response => {
        active.removeEventListener('abort', abort);
        if (active.aborted) { discardResponse(response); reject(interrupted(active, signal)); }
        else resolve(response);
      }, error => { active.removeEventListener('abort', abort); reject(error); });
    });
  } catch (error) {
    if (active.aborted) throw interrupted(active, signal);
    if (error instanceof AppError) throw error;
    throw diagnosedError(new AppError('BGM_NETWORK', 'HTTP 请求未完成；未自动重试。'),
      createErrorDiagnostic({ code: 'BGM_NETWORK', origin: 'http', stage: 'connect', reason: 'http_connect_failed', causes: errorCauses(error) }), error);
  }
}
export async function readResponseText(response: Response, active: AbortSignal, signal?: AbortSignal, maximum = 2_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw diagnosedError(new AppError('INVALID_RESPONSE', '服务响应为空。'),
    createErrorDiagnostic({ code: 'INVALID_RESPONSE', origin: 'http', stage: 'stream', reason: 'response_body_missing', evidence: { httpStatus: response.status } }));
  const abort = () => { void reader.cancel().catch(() => {}); };
  active.addEventListener('abort', abort, { once: true });
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      if (active.aborted) { abort(); throw interrupted(active, signal); }
      const part = await reader.read();
      if (active.aborted) throw interrupted(active, signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) { void reader.cancel().catch(() => {}); throw diagnosedError(new AppError('BGM_OUTPUT_LIMIT', '服务响应超过读取上限，请缩小范围。'),
        createErrorDiagnostic({ code: 'BGM_OUTPUT_LIMIT', origin: 'http', stage: 'stream', reason: 'response_bytes_limit', recovery: 'correct_parameters', evidence: { bytes, byteLimit: maximum, httpStatus: response.status } })); }
      chunks.push(part.value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch (error) { throw diagnosedError(new AppError('INVALID_RESPONSE', '服务响应不是有效 UTF-8。'),
      createErrorDiagnostic({ code: 'INVALID_RESPONSE', origin: 'http', stage: 'decode', reason: 'utf8_invalid', evidence: { bytes, httpStatus: response.status }, causes: errorCauses(error) }), error); }
  } catch (error) {
    if (active.aborted) throw interrupted(active, signal);
    if (error instanceof AppError) throw error;
    throw diagnosedError(new AppError('BGM_NETWORK', 'HTTP 响应流读取未完成；未自动重试。'),
      createErrorDiagnostic({ code: 'BGM_NETWORK', origin: 'http', stage: 'stream', reason: 'response_stream_failed', evidence: { bytes, httpStatus: response.status }, causes: errorCauses(error) }), error);
  } finally { active.removeEventListener('abort', abort); reader.releaseLock(); }
}
export function isJsonResponse(response: Response): boolean {
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
}
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch (error) { throw diagnosedError(new AppError('INVALID_RESPONSE', '服务返回无效 JSON。'),
    createErrorDiagnostic({ code: 'INVALID_RESPONSE', origin: 'http', stage: 'decode', reason: 'json_syntax_invalid', causes: errorCauses(error) }), error); }
}
/** 只保留有界等待时长，不把任意服务端头或正文带入错误输出。 */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw || raw.length > 80) return null;
  let delay: number;
  if (/^\d{1,5}$/.test(raw)) delay = Number(raw) * 1000;
  else if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) delay = Math.max(0, Date.parse(raw) - Date.now());
  else return null;
  return Number.isSafeInteger(delay) && delay >= 0 && delay <= 86_400_000 ? delay : null;
}
/** 只由固定本地传输前置检查使用，表示业务 HTTP 尚未派发。 */
export function withoutNetworkAttempt(error: unknown): unknown {
  if (error instanceof AppError) Object.defineProperty(error, 'networkAttempted', { value: false, configurable: true });
  return error;
}
export class AccountTransport {
  private readonly dispatchers: ProxyDispatchers;
  private closed = false;
  private readonly closing = new AbortController();
  constructor(private readonly session: AccountSession | null, proxy: ProxyOptions = null, private readonly timeout = 60000, private readonly fakeFetch?: LoginFetch) { this.dispatchers = new ProxyDispatchers(proxy); }
  private async request(url: string, method: string, headers: Record<string,string>, body?: string, signal?: AbortSignal): Promise<{ response: Response; value: unknown }> {
    let dispatched = false;
    try {
    const active = AbortSignal.any([this.closing.signal, AbortSignal.timeout(this.timeout), ...(signal ? [signal] : [])]);
    if (active.aborted) throw interrupted(active, signal);
    if (this.closed) throw new AppError('MCP_CLOSED', '账户连接已关闭。');
    const init = { method, headers: { Accept: 'application/json', 'User-Agent': 'MyBangumiAssistant/0.1.0 (https://github.com/KasLee14/MyBangumiAssistant)', ...headers }, signal: active, redirect: 'manual' as const, ...(body === undefined ? {} : { body }) };
    const pending = Promise.resolve().then(() => {
      if (active.aborted) throw interrupted(active, signal);
      if (this.closed) throw new AppError('MCP_CLOSED', '账户连接已关闭。');
      dispatched = true;
      return this.fakeFetch ? this.fakeFetch(url, init) : fetch(url, { ...init, dispatcher: this.dispatchers.forUrl(url) }) as unknown as Promise<Response>;
    });
    const response = await awaitResponse(pending, active, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) { discardResponse(response); throw new AppError('INVALID_RESPONSE', '账户接口发生跳转，未跟随重定向。'); }
    if (!response.ok) {
      // 原始错误正文可能含认证数据，禁止回显；只读取固定错误码分类。
      let code: unknown;
      if (isJsonResponse(response)) {
        try { code = object(parseJson(await readResponseText(response, active, signal, 20_000))).code; }
        catch (error) { if (active.aborted || error instanceof AppError && ['BGM_OUTPUT_LIMIT', 'BGM_NETWORK'].includes(error.code)) throw error; }
      } else discardResponse(response);
      if (url.endsWith('/p1/login')) {
        if (code === 'CAPTCHA_ERROR') throw new AppError('BGM_CAPTCHA_REJECTED', '人机验证失效或被拒绝，请重新 /bangumi-login 获取新验证。');
        if (code === 'EMAIL_PASSWORD_ERROR') throw new AppError('BGM_LOGIN_REJECTED', '邮箱或密码不正确，请重新 /bangumi-login。');
        if (code === 'USER_BANNED') throw new AppError('BGM_LOGIN_REJECTED', '账户无法登录，请在 Bangumi 网站核对状态。');
        if (response.status === 429) throw new AppError('BGM_RATE_LIMIT', '登录尝试过于频繁，请稍后再试。');
      }
      const endpoint = new URL(url);
      if (endpoint.origin === 'https://next.bgm.tv' && endpoint.pathname.startsWith('/p1/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
        && response.status === 429 && code === 'RATE_LIMIT_EXCEEDED') {
        const error = new AppError('BGM_RATE_LIMIT_REJECTED', '上游在修改前明确拒绝了本次请求；请等待额度后按核实后的范围重新计划。');
        const rejection: SubmissionRejection = { kind: 'rate_limit', httpStatus: 429, upstreamCode: 'RATE_LIMIT_EXCEEDED', retryAfterMs: retryAfterMs(response) };
        Object.defineProperty(error, 'rejection', { value: rejection }); throw error;
      }
      throw new AppError(`BGM_HTTP_${response.status}`, '认证、权限或请求失败，请核对登录与网络状态。');
    }
    if (response.status === 204) { discardResponse(response); return { response, value: null }; }
    if (!isJsonResponse(response)) { discardResponse(response); throw diagnosedError(new AppError('INVALID_RESPONSE', '服务未返回 JSON。'),
      createErrorDiagnostic({ code: 'INVALID_RESPONSE', origin: 'http', stage: 'decode', reason: 'content_type_not_json', evidence: { httpStatus: response.status } })); }
    return { response, value: parseJson(await readResponseText(response, active, signal)) };
    } catch (error) { throw dispatched ? error : withoutNetworkAttempt(error); }
  }
  async verificationSession(relayUrl: string, signal: AbortSignal): Promise<unknown> {
    return (await this.request(`${VERIFICATION_ORIGIN}/api/turnstile/session`, 'POST', { 'Content-Type':'application/json' }, JSON.stringify({ relay_url:relayUrl }), signal)).value;
  }
  async signIn(email: string, password: string, turnstileToken: string, signal: AbortSignal): Promise<{ session: AccountSession; user: { id:number; username:string } }> {
    const { response, value: raw } = await this.request('https://next.bgm.tv/p1/login', 'POST', { 'Content-Type':'application/json' }, JSON.stringify({ email, password, turnstileToken }), signal);
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
    let requestStarted = false;
    try {
    if (!/^\/p1\/[A-Za-z0-9_./%-]+$/.test(path) || path.includes('..') || /%(?:2e|2f|5c)/i.test(path)) throw new AppError('INVALID_INPUT','只允许固定 Bangumi p1 路径。');
    if (options.auth && !this.session) throw new AppError('BGM_AUTH_REQUIRED','请先运行 /bangumi-login 完成邮箱登录。');
    if (this.session && this.session.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED','本机登录已到期，请重新运行 /bangumi-login。');
    const url = new URL(path,'https://next.bgm.tv');
    if (url.origin !== 'https://next.bgm.tv' || !url.pathname.startsWith('/p1/')) throw new AppError('INVALID_INPUT','请求超出固定 Bangumi 主机或路径。');
    for (const [key,value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key,String(item));
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    requestStarted = true;
    return (await this.request(url.href,options.method ?? 'GET',{ ...(this.session ? {Cookie:`chiiNextSessionID=${this.session.sessionId}`} : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'}) },body,signal)).value;
    } catch (error) { throw requestStarted ? error : withoutNetworkAttempt(error); }
  }
  async close():Promise<void> { if (!this.closed) { this.closed = true; this.closing.abort(new AppError('MCP_CLOSED', '账户连接已关闭。')); await this.dispatchers.close(); } }
}
