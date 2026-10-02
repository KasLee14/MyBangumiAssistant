import type { ProxyOptions } from '../../config/proxy.js';
import { OAuthSessionStore, type OAuthSession } from '../../storage/oauth-session.js';
import { OAuthTransport } from './transport.js';
import { oauthCredentials } from '../../config/oauth.js';
import { object, positiveId } from '../../domain/bangumi.js';
import { AppError } from '../../domain/errors.js';
import type { OAuthFetch } from './transport.js';

export async function activeSession(store: OAuthSessionStore, proxy: ProxyOptions = null, timeout = 60000, signal?: AbortSignal, fakeFetch?: OAuthFetch): Promise<OAuthSession | null> {
  const saved = await store.load();
  if (!saved || saved.expiresAt > Date.now() + 30000) return saved;
  if (!saved.refreshToken) throw new AppError('OAUTH_AUTH_EXPIRED', 'OAuth Token 即将过期且没有刷新凭据，请重新运行 login。');
  if (oauthCredentials(saved.config).clientId !== saved.clientId) throw new AppError('OAUTH_CONFIG_CHANGED', 'OAuth 应用配置已改变，请重新运行 login --force。');
  const transport = new OAuthTransport(null, proxy, timeout, fakeFetch);
  try {
    const token = await transport.token(saved.config, { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, signal);
    if (token.accountId !== saved.accountId) throw new AppError('ACCOUNT_CHANGED', '刷新 Token 的账户不一致，未保存。');
    const next: OAuthSession = { ...saved, ...token, refreshToken: token.refreshToken ?? saved.refreshToken, savedAt: Date.now() };
    const api = new OAuthTransport(next, proxy, timeout, fakeFetch);
    try {
      const me = object(await api.json('/p1/me', { auth: true }, signal));
      if (positiveId(me.id) !== saved.accountId || typeof me.username !== 'string' || !me.username) throw new AppError('ACCOUNT_CHANGED', '刷新后账户核实失败，未保存。');
      next.username = me.username;
    } finally { await api.close(); }
    const current = await store.replaceIfCurrent(saved, next, signal);
    if (!current || current.accountId !== saved.accountId) throw new AppError('ACCOUNT_CHANGED', '刷新期间本机登录改变，请重新读取。');
    return current;
  } finally { await transport.close(); }
}
