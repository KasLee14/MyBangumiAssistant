import { AppError, registerCredentials } from '../domain/errors.js';
import { object } from '../domain/bangumi.js';

export interface OAuthConfig { clientIdEnv: string; clientSecretEnv: string; redirectUri: string }
export const DEFAULT_OAUTH: OAuthConfig = {
  clientIdEnv: 'BANGUMI_OAUTH_CLIENT_ID', clientSecretEnv: 'BANGUMI_OAUTH_CLIENT_SECRET',
  redirectUri: 'http://127.0.0.1:43835/oauth/callback',
};
export function parseOAuthConfig(value: unknown): OAuthConfig {
  const item = value === undefined ? DEFAULT_OAUTH : object(value, 'OAuth 配置');
  if (Object.keys(item).some(key => !['clientIdEnv', 'clientSecretEnv', 'redirectUri'].includes(key))) throw new AppError('INVALID_CONFIG', 'OAuth 配置仅保存凭据环境变量名与回调地址。');
  const config = { ...DEFAULT_OAUTH, ...item } as OAuthConfig;
  for (const key of ['clientIdEnv', 'clientSecretEnv'] as const) if (typeof config[key] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config[key])) throw new AppError('INVALID_CONFIG', `${key} 必须为环境变量名。`);
  let uri: URL;
  try { uri = new URL(config.redirectUri); } catch { throw new AppError('INVALID_CONFIG', 'OAuth 回调地址无效。'); }
  if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1' || !uri.port || uri.username || uri.password || uri.search || uri.hash || uri.pathname !== '/oauth/callback') throw new AppError('INVALID_CONFIG', 'OAuth 回调只允许 http://127.0.0.1:<固定端口>/oauth/callback，且须与应用登记一致。');
  return config;
}
export function oauthCredentials(config: OAuthConfig, env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } {
  const clientId = env[config.clientIdEnv]?.trim(); const clientSecret = env[config.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) throw new AppError('OAUTH_CONFIG_REQUIRED', `请先在 https://bgm.tv/dev/app 登记 OAuth 应用，回调填写 ${config.redirectUri}；在本机设置 ${config.clientIdEnv} 和 ${config.clientSecretEnv}，不要发送到对话中。`);
  if (clientId.length > 1000 || clientSecret.length > 4000 || /[\r\n]/.test(clientId + clientSecret)) throw new AppError('INVALID_CONFIG', 'OAuth 应用凭据格式无效。');
  registerCredentials([clientSecret]); return { clientId, clientSecret };
}
