import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { windowsProtector, type Protector } from './protected-credentials.js';
import { parseOAuthConfig, type OAuthConfig } from '../config/oauth.js';
import { AppError, registerCredentials } from '../domain/errors.js';

export interface OAuthSession {
  version: 1; accountId: number; username: string; clientId: string; config: OAuthConfig;
  accessToken: string; refreshToken?: string; savedAt: number; expiresAt: number;
}
export function oauthSession(value: unknown): OAuthSession {
  const s = value as OAuthSession;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.accountId) || s.accountId <= 0
    || typeof s.username !== 'string' || !s.username || s.username.length > 200
    || typeof s.clientId !== 'string' || !s.clientId || s.clientId.length > 1000
    || typeof s.accessToken !== 'string' || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(s.accessToken)
    || s.refreshToken !== undefined && (typeof s.refreshToken !== 'string' || !/^[A-Za-z0-9._~+/-]{8,16000}$/.test(s.refreshToken))
    || !Number.isFinite(s.savedAt) || !Number.isFinite(s.expiresAt) || s.savedAt > Date.now() + 60000 || s.expiresAt <= s.savedAt) throw new AppError('OAUTH_AUTH_INVALID', 'OAuth 凭据损坏，请重新运行 login。');
  parseOAuthConfig(s.config); registerCredentials([s.accessToken, s.refreshToken ?? '']); return structuredClone(s);
}
export class OAuthSessionStore {
  readonly file: string;
  constructor(private readonly directory: string, private readonly protector: Protector = windowsProtector) { this.file = join(directory, 'oauth-session.dpapi'); }
  async load(): Promise<OAuthSession | null> {
    try {
      const encrypted = await readFile(this.file, 'utf8');
      if (encrypted.length > 200000) throw new Error();
      return oauthSession(JSON.parse(await this.protector.unprotect(encrypted)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError('OAUTH_AUTH_INVALID', '无法读取 OAuth 凭据，请重新运行 login；原文件未修改。');
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
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= end) throw new AppError('OAUTH_STORAGE_BUSY', 'OAuth 凭据正在更新或锁文件尚未释放，请稍后重试。');
        await delay(50, undefined, { signal });
      }
    }
    try { return await run(); } finally { await handle.close(); await unlink(lock).catch(() => {}); }
  }
  private async write(session: OAuthSession, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); const encrypted = await this.protector.protect(JSON.stringify(oauthSession(session))); signal?.throwIfAborted();
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, encrypted, { flag: 'wx', mode: 0o600 }); signal?.throwIfAborted(); await rename(temp, this.file); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async save(session: OAuthSession, signal?: AbortSignal): Promise<void> { await this.locked(() => this.write(session, signal), signal); }
  async replaceIfCurrent(expected: OAuthSession, session: OAuthSession, signal?: AbortSignal): Promise<OAuthSession | null> {
    return this.locked(async () => {
      const current = await this.load();
      if (!current || current.accessToken !== expected.accessToken || current.savedAt !== expected.savedAt) return current;
      await this.write(session, signal); return session;
    }, signal);
  }
  async clear(): Promise<void> { await this.locked(async () => { try { await unlink(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('OAUTH_STORAGE', '无法清除本机 OAuth 凭据。'); } }); }
}
