import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, fsyncSync, lstatSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../support/errors.js';
import { SCHEMA_VERSION } from './schema.js';

export interface SnapshotManifest {
  schemaVersion: number; snapshotId: string; builtAt: string; parserVersion: string;
  dictionaryVersion?: string;
  normalizationVersion?: number; derivedFrom?: string;
  indexVersion?: number;
  source: { kind: 'zip' | 'directory'; name: string; url: string | null; sha256: string; size: number; exportedAt: string | null };
  counts: Record<string, number>;
  quality: { infoboxParseFailures: number; danglingRelations: number; invalidDates: number; duplicateAliases: number; invalidRelations: number };
  timings?: { totalMs: number; sourceHashMs: number; files: Record<string, number>; indexMs: number; verifyMs: number; integrityMs?: number };
  database: { file: 'catalog.sqlite'; bytes: number; sha256: string };
  capabilities: { vector: false; fullText: true; account: false; images: false; tagsComplete: false };
}
export interface SnapshotHandle { db: DatabaseSync; manifest: SnapshotManifest; close(): void }
export interface CurrentPointer { snapshotId: string; previousSnapshotId: string | null; activatedAt: string }
interface BuildOwner { kind: 'archive-build'; version: 1; pid: number; token: string; source: string; createdAt: string }
const BUILD_MARKER = '.build-owner.json';

export function snapshotPath(root: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(id) || id.includes('..')) throw new AppError('KNOWLEDGE_INVALID_SNAPSHOT', '数据快照标识无效。');
  return join(resolve(root), 'snapshots', id);
}

export function readCurrent(root: string): CurrentPointer | null {
  const path = join(root, 'current.json');
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as CurrentPointer;
    snapshotPath(root, value.snapshotId);
    if (value.previousSnapshotId !== null) snapshotPath(root, value.previousSnapshotId);
    if (!Number.isFinite(Date.parse(value.activatedAt))) throw new Error();
    return value;
  } catch { throw new AppError('KNOWLEDGE_INVALID_POINTER', '当前数据快照指针损坏，请通过 data:rollback 指定完整快照恢复。'); }
}

export function readManifest(root: string, id: string): SnapshotManifest {
  const path = join(snapshotPath(root, id), 'manifest.json');
  if (!existsSync(path)) throw new AppError('KNOWLEDGE_SNAPSHOT_NOT_FOUND', '指定本地数据快照不存在。');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as SnapshotManifest;
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.snapshotId !== id || manifest.database.file !== 'catalog.sqlite') {
    throw new AppError('KNOWLEDGE_SCHEMA_MISMATCH', '本地数据快照版本不兼容，请重新导入。');
  }
  return manifest;
}

/** 数据库只读；独立 lease 用于阻止更新器清理另一个进程正在使用的快照。 */
export function openSnapshot(root: string, snapshotId?: string): SnapshotHandle {
  const id = snapshotId ?? readCurrent(root)?.snapshotId;
  if (!id) throw new AppError('KNOWLEDGE_NOT_INITIALIZED', '尚未初始化本地 Archive 数据库，请先运行 data:init。');
  const manifest = readManifest(root, id);
  const leaseDir = join(resolve(root), 'leases');
  mkdirSync(leaseDir, { recursive: true });
  const lease = join(leaseDir, `${process.pid}-${randomUUID()}.json`);
  writeFileSync(lease, JSON.stringify({ pid: process.pid, snapshotId: id, createdAt: new Date().toISOString() }), { flag: 'wx' });
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(snapshotPath(root, id), 'catalog.sqlite'), { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== SCHEMA_VERSION) throw new AppError('KNOWLEDGE_SCHEMA_MISMATCH', '本地数据库结构版本不兼容。');
  } catch (error) { db?.close(); unlinkSync(lease); throw error; }
  let closed = false;
  const connection = db;
  return { db: connection, manifest, close() { if (!closed) { closed = true; try { connection.close(); } finally { if (existsSync(lease)) unlinkSync(lease); } } } };
}

export function atomicWriteJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx');
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temporary, path); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function activateSnapshot(root: string, id: string): CurrentPointer {
  readManifest(root, id);
  const old = readCurrent(root);
  const pointer = { snapshotId: id, previousSnapshotId: old?.snapshotId === id ? old.previousSnapshotId : old?.snapshotId ?? null, activatedAt: new Date().toISOString() };
  atomicWriteJson(join(root, 'current.json'), pointer);
  return pointer;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export function listSnapshots(root: string): SnapshotManifest[] {
  const dir = join(root, 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).flatMap(entry => {
    try { return [readManifest(root, entry.name)]; } catch { return []; }
  }).sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

export function pruneSnapshots(root: string, retain = 2): string[] {
  const keep = new Set(listSnapshots(root).slice(0, retain).map(manifest => manifest.snapshotId));
  const current = readCurrent(root);
  if (current) { keep.add(current.snapshotId); if (current.previousSnapshotId) keep.add(current.previousSnapshotId); }
  const leaseDir = join(root, 'leases');
  if (existsSync(leaseDir)) for (const name of readdirSync(leaseDir)) {
    const path = join(leaseDir, name);
    try { const lease = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; snapshotId: string };
      if (isProcessAlive(lease.pid)) keep.add(lease.snapshotId); else unlinkSync(path);
    } catch { /* 无法解释的租约保守保留全部快照，不能冒险删除使用中的数据。 */ return []; }
  }
  const deleted: string[] = [];
  for (const manifest of listSnapshots(root)) {
    if (keep.has(manifest.snapshotId)) continue;
    const path = resolve(snapshotPath(root, manifest.snapshotId)), base = resolve(root, 'snapshots'), child = relative(base, path);
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new AppError('KNOWLEDGE_UNSAFE_PATH', '拒绝清理数据目录之外的路径。');
    rmSync(path, { recursive: true }); deleted.push(manifest.snapshotId);
  }
  return deleted;
}

export function getDatasetStatus(root: string): Record<string, unknown> {
  const current = readCurrent(root);
  return { initialized: current !== null, current, manifest: current ? readManifest(root, current.snapshotId) : null,
    snapshots: listSnapshots(root).map(manifest => ({ snapshotId: manifest.snapshotId, builtAt: manifest.builtAt, bytes: manifest.database.bytes })),
    update: existsSync(join(root, 'update-state.json')) ? JSON.parse(readFileSync(join(root, 'update-state.json'), 'utf8')) : null,
    schedule: { weekday: 'Wednesday', time: '08:00', timezone: 'Asia/Hong_Kong' },
    updating: existsSync(join(root, 'update.lock')), staging: listStaging(root) };
}

export function databaseBytes(root: string, id: string): number { return statSync(join(snapshotPath(root, id), 'catalog.sqlite')).size; }

export function markStaging(root: string, path: string, source: string): void {
  const owner: BuildOwner = { kind: 'archive-build', version: 1, pid: process.pid, token: randomUUID(), source: resolve(source), createdAt: new Date().toISOString() };
  if (dirname(resolve(path)) !== resolve(root, 'snapshots')) throw new AppError('KNOWLEDGE_UNSAFE_PATH', '临时构建目录不在快照根目录内。');
  atomicWriteJson(join(path, BUILD_MARKER), owner);
}

function buildOwner(path: string): BuildOwner | null {
  try {
    const value = JSON.parse(readFileSync(join(path, BUILD_MARKER), 'utf8')) as BuildOwner;
    return value.kind === 'archive-build' && value.version === 1 && Number.isSafeInteger(value.pid) && value.pid > 0
      && typeof value.token === 'string' && value.token.length > 10 && typeof value.source === 'string' && isAbsolute(value.source)
      && Number.isFinite(Date.parse(value.createdAt)) ? value : null;
  } catch { return null; }
}

export function listStaging(root: string): Record<string, unknown>[] {
  const base = resolve(root, 'snapshots');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('build-')).flatMap(entry => {
    const path = join(base, entry.name), owner = buildOwner(path);
    // 用户可显式使用build-前缀作为完整快照名；这种快照不属于staging。
    try { if (readManifest(root, entry.name)) return []; } catch { /* 尚未完成的目录继续展示。 */ }
    return [{ directory: entry.name, managed: owner !== null, pid: owner?.pid ?? null, ownerAlive: owner ? isProcessAlive(owner.pid) : null,
      createdAt: owner?.createdAt ?? null, bytes: existsSync(join(path, 'catalog.sqlite')) ? statSync(join(path, 'catalog.sqlite')).size : 0 }];
  });
}

/** 仅删除本程序有所有权凭证的直接子目录，绝不按build-*名字批量删除。 */
export function removeStaging(root: string, path: string, source?: string): boolean {
  const target = resolve(path), base = resolve(root, 'snapshots'), child = relative(base, target), owner = buildOwner(target);
  if (!child || child.startsWith('..') || isAbsolute(child) || dirname(target) !== base || !owner || !lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) return false;
  const input = resolve(source ?? owner.source), inputWithinTarget = relative(target, input);
  if (input === target || !inputWithinTarget.startsWith('..') && !isAbsolute(inputWithinTarget)) return false;
  try { const current = readCurrent(root); if (current && (target === resolve(snapshotPath(root, current.snapshotId)) || current.previousSnapshotId && target === resolve(snapshotPath(root, current.previousSnapshotId)))) return false; }
  catch { return false; }
  rmSync(target, { recursive: true }); return true;
}

export function recordBuildFailure(root: string, path: string, code: string, message: string): void {
  const owner = buildOwner(path), dir = join(root, 'failures'); mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, `${basename(path)}-${Date.now()}.json`), { at: new Date().toISOString(), staging: basename(path), owner,
    error: { code, message: message.slice(0, 1000) } });
}

function cleanAbandonedStaging(root: string): void {
  for (const stage of listStaging(root)) {
    if (stage.managed !== true || stage.ownerAlive !== false) continue;
    const path = join(root, 'snapshots', String(stage.directory));
    try {
      recordBuildFailure(root, path, 'KNOWLEDGE_BUILD_INTERRUPTED', '前次构建进程已退出，正在清理未完成快照。');
      removeStaging(root, path);
    } catch { /* 外部文件占用不阻止新更新；保留目录供status报告和稍后重试。 */ }
  }
}

export async function withUpdateLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  mkdirSync(root, { recursive: true });
  const path = join(root, 'update.lock'), token = randomUUID();
  const claim = () => writeFileSync(path, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), { flag: 'wx' });
  try { claim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // 回收者也要互斥，否则两个进程可能先后删掉对方刚创建的新锁。
    const recovery = join(root, 'update-reclaim.lock');
    try { writeFileSync(recovery, token, { flag: 'wx' }); } catch { throw new AppError('KNOWLEDGE_UPDATE_BUSY', '已有进程正在检查数据库更新锁。'); }
    try {
      let stale = false;
      try { const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid: number }; stale = !isProcessAlive(owner.pid); } catch {
        stale = existsSync(path) && Date.now() - statSync(path).mtimeMs > 24 * 3600_000;
      }
      if (!stale) throw new AppError('KNOWLEDGE_UPDATE_BUSY', '已有本地数据库更新正在进行。');
      unlinkSync(path);
      try { claim(); } catch { throw new AppError('KNOWLEDGE_UPDATE_BUSY', '另一个进程已开始更新本地数据库。'); }
    } finally { unlinkSync(recovery); }
  }
  try { cleanAbandonedStaging(root); return await operation(); } finally {
    try { if ((JSON.parse(readFileSync(path, 'utf8')) as { token: string }).token === token) unlinkSync(path); } catch { /* 锁已由外部移除时不误删新锁。 */ }
  }
}
