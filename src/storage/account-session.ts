import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { windowsProtector, type Protector } from './protected-credentials.js';
import { AppError, registerCredentials } from '../domain/errors.js';

export interface AccountSession {
  version: 1; accountId: number; username: string; sessionId: string; savedAt: number; expiresAt: number;
}
export function accountSession(value: unknown): AccountSession {
  const s = value as AccountSession;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.accountId) || s.accountId <= 0
    || typeof s.username !== 'string' || !s.username || s.username.length > 200
    || typeof s.sessionId !== 'string' || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(s.sessionId)
    || !Number.isFinite(s.savedAt) || !Number.isFinite(s.expiresAt) || s.savedAt > Date.now() + 60000 || s.expiresAt <= s.savedAt) {
    throw new AppError('BGM_AUTH_INVALID', '本机登录凭据损坏，请重新运行 login。');
  }
  registerCredentials([s.sessionId]);
  // 只保留会话白名单，邮箱、密码及验证令牌不能进入存储。
  return { version: 1, accountId: s.accountId, username: s.username, sessionId: s.sessionId, savedAt: s.savedAt, expiresAt: s.expiresAt };
}
export class AccountSessionStore {
  readonly file: string;
  constructor(private readonly directory: string, private readonly protector: Protector = windowsProtector) { this.file = join(directory, 'account-session.dpapi'); }
  async load(): Promise<AccountSession | null> {
    try {
      const encrypted = await readFile(this.file, 'utf8');
      if (encrypted.length > 200000) throw new Error();
      return accountSession(JSON.parse(await this.protector.unprotect(encrypted)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError('BGM_AUTH_INVALID', '无法读取本机登录凭据，请重新运行 login；原文件未修改。');
    }
  }
  private async locked<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = `${this.file}.lock`; const end = Date.now() + 5000;
    let handle;
    while (!handle) {
      signal?.throwIfAborted();
      try { handle = await open(lock, 'wx', 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= end) throw new AppError('BGM_AUTH_STORAGE_BUSY', '登录凭据正在更新，请稍后重试。');
        await delay(50, undefined, { signal });
      }
    }
    try { return await run(); } finally { await handle.close(); await unlink(lock).catch(() => {}); }
  }
  async save(session: AccountSession, signal?: AbortSignal): Promise<void> {
    await this.locked(async () => {
      signal?.throwIfAborted(); const encrypted = await this.protector.protect(JSON.stringify(accountSession(session))); signal?.throwIfAborted();
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, encrypted, { flag: 'wx', mode: 0o600 }); signal?.throwIfAborted(); await rename(temp, this.file); }
      finally { await unlink(temp).catch(() => {}); }
    }, signal);
  }
  async clear(): Promise<void> { await this.locked(async () => { try { await unlink(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('BGM_AUTH_STORAGE', '无法清除本机登录凭据。'); } }); }
}
