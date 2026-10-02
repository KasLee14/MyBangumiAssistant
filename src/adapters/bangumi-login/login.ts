import { AccountSessionStore } from '../../storage/account-session.js';
import { AppError, registerCredentials } from '../../domain/errors.js';
import { object, positiveId } from '../../domain/bangumi.js';
import type { ProxyOptions } from '../../config/proxy.js';
import { AccountTransport, type LoginFetch } from './transport.js';
import { acquireVerification } from './verification.js';
export type LoginPrompt = (kind:'email'|'password',signal:AbortSignal)=>Promise<string>;
export async function login(store:AccountSessionStore,options:{proxy?:ProxyOptions;requestTimeoutMs?:number;timeoutMs?:number;signal:AbortSignal;prompt:LoginPrompt;manual?:boolean;notice?:(message:string)=>void;openBrowser?:(url:string)=>Promise<void>;fakeFetch?:LoginFetch;verification?:(signal:AbortSignal)=>Promise<string>}):Promise<{id:number;username:string}> {
  if (process.platform !== 'win32') throw new AppError('BGM_AUTH_PLATFORM','当前登录凭据保护仅支持 Windows。');
  const signal = AbortSignal.any([options.signal,AbortSignal.timeout(options.timeoutMs ?? 300000)]);
  const transport = new AccountTransport(null,options.proxy,options.requestTimeoutMs ?? 60000,options.fakeFetch);
  let password = '';
  try {
    signal.throwIfAborted(); const email = (await options.prompt('email',signal)).trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('INVALID_INPUT','请输入有效的 Bangumi 登录邮箱。');
    password = await options.prompt('password',signal);
    if (!password || password.length > 4000 || /[\r\n\u0000]/.test(password)) throw new AppError('INVALID_INPUT','密码为空或格式无效，请重新 /login。');
    registerCredentials([password]); signal.throwIfAborted();
    const token = options.verification ? await options.verification(signal) : await acquireVerification(transport,{signal,manual:options.manual ?? false,notice:options.notice,openBrowser:options.openBrowser});
    registerCredentials([token]); signal.throwIfAborted();
    options.notice?.('人机验证完成，正在登录 Bangumi。');
    const result = await transport.signIn(email,password,token,signal); password = '';
    options.notice?.('登录响应已收到，正在核实账户并保存本机登录。');
    const api = new AccountTransport(result.session,options.proxy,options.requestTimeoutMs ?? 60000,options.fakeFetch);
    try {
      const me = object(await api.json('/p1/me',{auth:true},signal));
      if (positiveId(me.id) !== result.user.id || typeof me.username !== 'string' || !me.username) throw new AppError('ACCOUNT_CHANGED','登录响应与 API 账户不一致，未保存。');
      result.session.username = me.username; await store.save(result.session,signal);
      return {id:result.session.accountId,username:me.username};
    } finally { await api.close(); }
  } catch(error) {
    if (signal.aborted) throw new AppError(options.signal.aborted ? 'CANCELLED' : 'BGM_LOGIN_TIMEOUT',options.signal.aborted ? '登录已取消，原有本机登录保留。' : '登录等待超时，原有本机登录保留。');
    throw error;
  } finally { password = ''; await transport.close(); }
}
