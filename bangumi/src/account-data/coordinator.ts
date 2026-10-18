import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { AccountSessionStore } from '../login/index.js';
import { AppError } from '../support/errors.js';
import type { ProxyOptions } from '../support/proxy.js';
import type { syncAccountData } from './sync.js';
import { releaseAccountSyncLock } from './store.js';

export type AccountSyncResult = Awaited<ReturnType<typeof syncAccountData>> | { skipped: true; reason: 'not_logged_in' };
export interface AccountDataCoordinator {
  sync(options?: { mode?: 'auto' | 'full'; signal?: AbortSignal }): Promise<AccountSyncResult>;
  /** 只等待已经存在的任务，绝不触发网络请求。 */
  waitForActive(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
function wait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new AppError('ABORTED', '等待账户同步已取消。'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 一个宿主共享一个入口；调用者取消只取消自己的等待，不影响其他查询。 */
export function createAccountDataCoordinator(options: {
  root: string; authDir: string; proxy: () => ProxyOptions; timeoutMs?: number;
  store?: Pick<AccountSessionStore, 'load'>;
}): AccountDataCoordinator {
  const store = options.store ?? new AccountSessionStore(options.authDir);
  let closed = false;
  type Flight = { promise: Promise<AccountSyncResult>; mode: 'auto' | 'full'; sessionKey?: string };
  let flight: Flight | undefined;
  let worker: Worker | undefined;
  const key = (session: { accountId: number; savedAt: number; sessionId: string } | null) => session
    ? createHash('sha256').update(JSON.stringify([session.accountId, session.savedAt, session.sessionId])).digest('hex') : 'none';
  const sync: AccountDataCoordinator['sync'] = (request = {}) => {
    if (closed) return Promise.reject(new AppError('ACCOUNT_SYNC_CLOSED', '账户同步器已关闭。'));
    request.signal?.throwIfAborted();
    if (flight) {
      const existing = flight;
      return wait((async () => {
        let result: AccountSyncResult | undefined; let failure: unknown;
        try { result = await existing.promise; } catch (error) { failure = error; }
        request.signal?.throwIfAborted();
        const session = await store.load();
        // 切换账户/重新登录后必须独立同步；full请求不得被正在运行的auto替代。
        if (key(session) !== existing.sessionKey || request.mode === 'full' && existing.mode !== 'full') return sync(request);
        if (failure) throw failure;
        return result!;
      })(), request.signal);
    }
    {
      const current: Flight = { promise: undefined as unknown as Promise<AccountSyncResult>, mode: request.mode ?? 'auto' };
      const task = (async (): Promise<AccountSyncResult> => {
        const session = await store.load();
        current.sessionKey = key(session);
        if (!session) return { skipped: true, reason: 'not_logged_in' };
        if (closed) throw new AppError('ACCOUNT_SYNC_CLOSED', '账户同步器已关闭。');
        return new Promise((resolve, reject) => {
          const lockToken = randomUUID();
          const child = new Worker(new URL('./worker.js', import.meta.url), { workerData: {
            root: options.root, authDir: options.authDir, proxy: options.proxy(),
            timeoutMs: options.timeoutMs, mode: request.mode ?? 'auto', lockToken, expectedAccountId: session.accountId,
          } });
          worker = child;
          child.once('message', (message: { ok: boolean; result?: AccountSyncResult; error?: { code: string; message: string } }) => {
            if (message.ok && message.result) resolve(message.result);
            else reject(new AppError(message.error?.code ?? 'ACCOUNT_SYNC_FAILED', message.error?.message ?? '账户同步失败。'));
          });
          child.once('error', () => { /* exit确认线程已停止后再清理自己的锁并拒绝，避免重试与旧线程竞争。 */ });
          child.once('exit', code => {
            if (worker === child) worker = undefined;
            try { releaseAccountSyncLock(options.root, session.accountId, lockToken); }
            catch { reject(new AppError('ACCOUNT_SYNC_LOCK_CLEANUP_FAILED', '账户同步已退出，但自己的同步锁清理失败。')); return; }
            reject(new AppError('ACCOUNT_SYNC_FAILED', `账户同步后台任务已退出（${code}）。`));
          });
        });
      })();
      current.promise = task; flight = current;
      void task.finally(() => { if (flight === current) flight = undefined; }).catch(() => {});
    }
    return wait(flight.promise, request.signal);
  };
  return {
    sync,
    async waitForActive(signal) { if (flight) await wait(flight.promise, signal); },
    async close() {
      closed = true;
      const child = worker;
      if (!child) { await flight?.promise.catch(() => {}); return; }
      child.postMessage('abort');
      const timer = setTimeout(() => { void child.terminate(); }, 2_000);
      timer.unref();
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
      clearTimeout(timer);
    },
  };
}
