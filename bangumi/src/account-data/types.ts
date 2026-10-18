import type { DatabaseSync } from 'node:sqlite';
import type { AccountSession } from '../login/account-session.js';
import type { LoginFetch } from '../login/transport.js';
import type { ProxyOptions } from '../support/proxy.js';

export interface AccountManifest {
  schemaVersion: number; accountId: number; snapshotId: string; builtAt: string;
  cursor: number; lastFullSyncAt: string; lastDeltaSyncAt: string | null;
  visibilityKey: string; allowNsfw: boolean; showNsfwSubject: boolean;
  recordCount: number; missingCount: number;
  /** since 不覆盖所有修改和删除，不能把增量成功解释成线上完整实时快照。 */
  limitations: string[];
}
export interface AccountSnapshotHandle { manifest: AccountManifest; path: string; db: DatabaseSync; release(): void }
export interface AccountDatasetStatus { initialized: boolean; manifest: AccountManifest | null; updating: boolean }
export interface SyncAccountDataOptions {
  root: string; authDir: string; proxy?: ProxyOptions; timeoutMs?: number; mode?: 'auto' | 'full'; signal?: AbortSignal;
  fakeFetch?: LoginFetch;
  sessionStore?: Pick<{ load(): Promise<AccountSession | null> }, 'load'>;
  /** 宿主分配的内部 worker 所有权标识，用于异常退出时定向释放锁。 */
  lockToken?: string;
  /** 启动 worker 前观察到的账户，防止消息传递期间换号。 */
  expectedAccountId?: number;
}
export interface AccountSyncResult {
  mode: 'full' | 'delta'; changed: boolean; added: number; updated: number; missing: number;
  requestCount: number; pageCount: number; durationMs: number; manifest: AccountManifest;
}
export interface CollectionRecord {
  subject_id: number; interest_id: number; subject_type: number; collection_type: number;
  personal_rating: number; comment: string; is_private: number; ep_status: number; vol_status: number;
  source_updated_at: number; observed_at: number; content_hash: string; tags: string[];
  name: string; name_cn: string; nsfw: boolean; image_url: string | null;
}
