import { AccountSessionStore, type AccountSession } from './account-session.js';
import { AppError } from '../support/errors.js';

/** 不保存密码，也不自动重登或重放业务请求。 */
export async function activeSession(store:AccountSessionStore):Promise<AccountSession|null> {
  const saved = await store.load();
  if (saved && saved.expiresAt <= Date.now()) throw new AppError('BGM_AUTH_EXPIRED','本机登录已到期，请重新运行 /bangumi-login。');
  return saved;
}
