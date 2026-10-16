import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetch, ProxyAgent } from 'undici';
import { AppError } from '../support/errors.js';
import { buildArchiveSnapshot, hashFile, type ImportProgress } from './archive.js';
import { activateSnapshot, atomicWriteJson, getDatasetStatus, listSnapshots, openSnapshot, readCurrent, readManifest, snapshotPath, withUpdateLock, type SnapshotManifest } from './store.js';
import { INDEX_VERSION } from './schema.js';

export { getDatasetStatus } from './store.js';
export const ARCHIVE_METADATA_URL = 'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json';
export interface UpdateOptions { root: string; proxy?: string | false; force?: boolean; onProgress?: (progress: ImportProgress) => void }
export interface UpdateResult { changed: boolean; manifest: SnapshotManifest }
interface ArchiveMetadata { name: string; browser_download_url: string; digest: string; size: number; created_at: string }
export interface UpdateState { lastCheckedAt?: string; lastSucceededAt?: string; lastAttemptAt?: string; error?: { code: string; at: string } }

/** Asia/Hong_Kong 无夏令时；周三08:00恰为UTC周三00:00。 */
export function nextWeeklyUpdate(now: Date | number = new Date()): Date {
  const date = new Date(now), target = new Date(date);
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + (3 - target.getUTCDay() + 7) % 7);
  if (target.getTime() <= date.getTime()) target.setUTCDate(target.getUTCDate() + 7);
  return target;
}

export function shouldCheckForUpdate(root: string, now: Date | number = new Date()): boolean {
  const currentTime = new Date(now).getTime(), state = readUpdateState(root);
  if (state.lastAttemptAt && currentTime - Date.parse(state.lastAttemptAt) < 3600_000) return false;
  if (!state.lastCheckedAt || !Number.isFinite(Date.parse(state.lastCheckedAt))) return true;
  return currentTime >= nextWeeklyUpdate(new Date(state.lastCheckedAt)).getTime();
}

export function readUpdateState(root: string): UpdateState {
  try { return JSON.parse(readFileSync(join(root, 'update-state.json'), 'utf8')) as UpdateState; } catch { return {}; }
}

function validateMetadata(value: unknown): ArchiveMetadata {
  if (!value || typeof value !== 'object') throw new AppError('KNOWLEDGE_INVALID_METADATA', 'Archive 更新元数据不是对象。');
  const meta = value as ArchiveMetadata;
  let url: URL;
  try { url = new URL(meta.browser_download_url); } catch { throw new AppError('KNOWLEDGE_INVALID_METADATA', 'Archive 下载地址无效。'); }
  if (!/^dump-[a-zA-Z0-9._-]+\.zip$/.test(meta.name) || !/^sha256:[0-9a-f]{64}$/.test(meta.digest)
    || !Number.isSafeInteger(meta.size) || meta.size <= 0 || meta.size > 20 * 1024 ** 3
    || !Number.isFinite(Date.parse(meta.created_at)) || url.protocol !== 'https:' || url.hostname !== 'github.com'
    || !url.pathname.startsWith('/bangumi/Archive/releases/download/') || url.username || url.password) {
    throw new AppError('KNOWLEDGE_INVALID_METADATA', 'Archive 更新元数据的版本、摘要或下载地址不符合约束。');
  }
  return meta;
}

export async function updateArchive(options: UpdateOptions): Promise<UpdateResult> {
  return withUpdateLock(options.root, async () => {
    const { root, onProgress } = options, state = readUpdateState(root), attemptedAt = new Date().toISOString();
    atomicWriteJson(join(root, 'update-state.json'), { ...state, lastAttemptAt: attemptedAt });
    const dispatcher = options.proxy === false ? undefined : new ProxyAgent(options.proxy ?? 'http://127.0.0.1:7890');
    try {
      onProgress?.({ stage: 'checking' });
      const response = await fetch(ARCHIVE_METADATA_URL, { ...(dispatcher ? { dispatcher } : {}), signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': 'MyBangumiAssistant-Pi/local-archive' } });
      if (!response.ok) throw new AppError('KNOWLEDGE_DOWNLOAD_FAILED', `Archive 元数据请求失败（HTTP ${response.status}）。`);
      const body = await response.text();
      if (body.length > 64 * 1024) throw new AppError('KNOWLEDGE_INVALID_METADATA', 'Archive 更新元数据过大。');
      const meta = validateMetadata(JSON.parse(body)), current = readCurrent(root);
      if (!options.force && current) {
        const manifest = readManifest(root, current.snapshotId);
        if (manifest.source.sha256 === meta.digest.slice(7) && manifest.indexVersion === INDEX_VERSION && manifest.normalizationVersion === 1) {
          atomicWriteJson(join(root, 'update-state.json'), { lastAttemptAt: attemptedAt, lastCheckedAt: new Date().toISOString(), lastSucceededAt: state.lastSucceededAt ?? manifest.builtAt });
          return { changed: false, manifest };
        }
      }
      const directory = join(root, 'downloads'); mkdirSync(directory, { recursive: true });
      const destination = join(directory, meta.name), temporary = `${destination}.part`;
      let validDownload = existsSync(destination) && statSync(destination).size === meta.size && await hashFile(destination) === meta.digest.slice(7);
      if (!validDownload) {
        let offset = existsSync(temporary) ? statSync(temporary).size : 0;
        if (offset >= meta.size) { unlinkSync(temporary); offset = 0; }
        onProgress?.({ stage: 'downloading', records: offset });
        const download = await fetch(meta.browser_download_url, { ...(dispatcher ? { dispatcher } : {}), signal: AbortSignal.timeout(3600_000),
          headers: { 'User-Agent': 'MyBangumiAssistant-Pi/local-archive', ...(offset ? { Range: `bytes=${offset}-` } : {}) } });
        if (![200, 206].includes(download.status) || !download.body) throw new AppError('KNOWLEDGE_DOWNLOAD_FAILED', `Archive 下载失败（HTTP ${download.status}）。`);
        if (download.status === 206 && download.headers.get('content-range')?.split('/')[0] !== `bytes ${offset}-${meta.size - 1}`) throw new AppError('KNOWLEDGE_DOWNLOAD_FAILED', 'Archive 下载续传范围不匹配。');
        if (download.status === 200) offset = 0;
        await pipeline(Readable.fromWeb(download.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temporary, { flags: offset ? 'a' : 'w' }));
        onProgress?.({ stage: 'checksum' });
        if (statSync(temporary).size !== meta.size || await hashFile(temporary) !== meta.digest.slice(7)) {
          unlinkSync(temporary); throw new AppError('KNOWLEDGE_ARCHIVE_CHECKSUM', 'Archive 下载长度或 SHA-256 校验失败，当前数据库未改变。');
        }
        renameSync(temporary, destination); validDownload = true;
      }
      const manifest = await buildArchiveSnapshot({ root, source: destination, expectedSha256: meta.digest, sourceUrl: meta.browser_download_url,
        exportedAt: meta.created_at, ...(onProgress ? { onProgress } : {}) });
      atomicWriteJson(join(root, 'update-state.json'), { lastAttemptAt: attemptedAt, lastCheckedAt: new Date().toISOString(), lastSucceededAt: new Date().toISOString() });
      return { changed: current?.snapshotId !== manifest.snapshotId, manifest };
    } catch (error) {
      atomicWriteJson(join(root, 'update-state.json'), { ...state, lastAttemptAt: attemptedAt, error: { code: error instanceof AppError ? error.code : 'KNOWLEDGE_UPDATE_FAILED', at: new Date().toISOString() } });
      throw error;
    } finally { await dispatcher?.close(); }
  });
}

export async function verifySnapshot(root: string, snapshotId?: string): Promise<Record<string, unknown>> {
  const handle = openSnapshot(root, snapshotId);
  try {
    const check = handle.db.prepare('PRAGMA integrity_check').all();
    const counts = Object.fromEntries(handle.db.prepare('SELECT kind,count(*) AS n FROM entities GROUP BY kind').all().map(row => [String(row.kind), Number(row.n)]));
    const matchingCounts = ['subject', 'person', 'character', 'episode'].every(kind => counts[kind] === handle.manifest.counts[kind]);
    const digest = await hashFile(join(snapshotPath(root, handle.manifest.snapshotId), 'catalog.sqlite'));
    const digestMatches = digest === handle.manifest.database.sha256;
    const ok = matchingCounts && digestMatches && check.length === 1 && check[0]?.integrity_check === 'ok';
    if (!ok) throw new AppError('KNOWLEDGE_DATABASE_CORRUPT', '本地数据库的内容数量、摘要或完整性检查失败。');
    return { ok, snapshotId: handle.manifest.snapshotId, counts, digestMatches, quality: handle.manifest.quality };
  } finally { handle.close(); }
}

export async function rollbackArchive(root: string, targetId?: string): Promise<SnapshotManifest> {
  return withUpdateLock(root, async () => {
    const current = readCurrent(root), id = targetId ?? current?.previousSnapshotId;
    if (!id || id === current?.snapshotId) throw new AppError('KNOWLEDGE_ROLLBACK_UNAVAILABLE', '没有可回退的不同数据快照。');
    await verifySnapshot(root, id);
    const manifest = readManifest(root, id); activateSnapshot(root, id); return manifest;
  });
}
