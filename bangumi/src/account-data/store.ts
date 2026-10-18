import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../support/errors.js';
import { atomicWriteJson, isProcessAlive } from '../knowledge/store.js';
import { ACCOUNT_SCHEMA_VERSION } from './schema.js';
import type { AccountManifest, AccountSnapshotHandle, AccountDatasetStatus } from './types.js';

export function accountDirectory(root: string, accountId: number): string {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new AppError('ACCOUNT_DATA_INVALID_ID', '账户标识无效。');
  return resolve(root, String(accountId));
}
export function accountSnapshotDirectory(root: string, accountId: number, snapshotId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(snapshotId)) throw new AppError('ACCOUNT_DATA_INVALID_SNAPSHOT', '个人数据快照标识无效。');
  return join(accountDirectory(root, accountId), 'snapshots', snapshotId);
}
function manifestValue(value: unknown, accountId: number): AccountManifest {
  const m = value as AccountManifest;
  if (!m || m.schemaVersion !== ACCOUNT_SCHEMA_VERSION || m.accountId !== accountId || typeof m.snapshotId !== 'string'
    || !Number.isSafeInteger(m.cursor) || m.cursor < 0 || !Number.isFinite(Date.parse(m.builtAt))
    || !Number.isFinite(Date.parse(m.lastFullSyncAt)) || (m.lastDeltaSyncAt !== null && !Number.isFinite(Date.parse(m.lastDeltaSyncAt)))
    || typeof m.visibilityKey !== 'string' || !/^[a-f0-9]{64}$/.test(m.visibilityKey)
    || typeof m.allowNsfw !== 'boolean' || typeof m.showNsfwSubject !== 'boolean'
    || !Number.isSafeInteger(m.recordCount) || m.recordCount < 0 || !Number.isSafeInteger(m.missingCount) || m.missingCount < 0
    || !Array.isArray(m.limitations) || m.limitations.some(x => typeof x !== 'string')) throw new AppError('ACCOUNT_DATA_INVALID_MANIFEST', '个人数据清单损坏，需要重新同步。');
  accountSnapshotDirectory('.', accountId, m.snapshotId);
  return m;
}
export function readAccountManifest(root: string, accountId: number, snapshotId?: string): AccountManifest | null {
  const path = snapshotId ? join(accountSnapshotDirectory(root,accountId,snapshotId),'manifest.json') : join(accountDirectory(root,accountId),'current.json');
  if (!existsSync(path)) return null;
  try {
    const m = manifestValue(JSON.parse(readFileSync(path,'utf8')), accountId);
    if (snapshotId && m.snapshotId !== snapshotId) throw new Error();
    if (!existsSync(join(accountSnapshotDirectory(root,accountId,m.snapshotId),'collections.sqlite'))) throw new Error();
    return m;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('ACCOUNT_DATA_INVALID_MANIFEST','个人数据快照不完整，需要重新同步。');
  }
}
export function getAccountDatasetStatus(root: string, accountId: number): AccountDatasetStatus {
  const manifest = readAccountManifest(root,accountId);
  return { initialized: manifest !== null, manifest, updating: existsSync(join(accountDirectory(root,accountId),'sync.lock')) };
}
export function openAccountSnapshot(root: string, accountId: number, snapshotId?: string): AccountSnapshotHandle {
  const manifest = readAccountManifest(root,accountId,snapshotId);
  if (!manifest) throw new AppError('ACCOUNT_DATA_NOT_INITIALIZED','个人数据尚未初始化，请同步账户数据。');
  const leases = join(accountDirectory(root,accountId),'leases'); mkdirSync(leases,{recursive:true});
  const lease = join(leases,`${process.pid}-${randomUUID()}.json`);
  writeFileSync(lease,JSON.stringify({pid:process.pid,snapshotId:manifest.snapshotId}),{flag:'wx',mode:0o600});
  const path = join(accountSnapshotDirectory(root,accountId,manifest.snapshotId),'collections.sqlite'); let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path,{readOnly:true}); db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== ACCOUNT_SCHEMA_VERSION) throw new AppError('ACCOUNT_DATA_SCHEMA_MISMATCH','个人数据库版本不兼容，请重新同步。');
  } catch(error) { db?.close(); unlinkSync(lease); throw error; }
  const connection = db; let closed = false;
  return {manifest,path,db:connection,release() { if (!closed) { closed=true; try {connection.close();} finally {if(existsSync(lease))unlinkSync(lease);} } }};
}
export function publishAccountManifest(root: string, manifest: AccountManifest, newSnapshot: boolean): void {
  manifestValue(manifest,manifest.accountId);
  if(newSnapshot) atomicWriteJson(join(accountSnapshotDirectory(root,manifest.accountId,manifest.snapshotId),'manifest.json'),manifest);
  atomicWriteJson(join(accountDirectory(root,manifest.accountId),'current.json'),manifest);
}
/** Only complete, validated direct-child snapshot directories are eligible. */
export function pruneAccountSnapshots(root:string,accountId:number): void {
  const base=join(accountDirectory(root,accountId),'snapshots'); if(!existsSync(base))return;
  const manifests=readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(e=>{try{const m=readAccountManifest(root,accountId,e.name);return m?[m]:[];}catch{return [];}}).sort((a,b)=>b.builtAt.localeCompare(a.builtAt));
  const keep=new Set(manifests.slice(0,2).map(m=>m.snapshotId));const current=readAccountManifest(root,accountId);if(current)keep.add(current.snapshotId);
  const leases=join(accountDirectory(root,accountId),'leases');
  if(existsSync(leases)) for(const entry of readdirSync(leases)) {
    const file=join(leases,entry);
    try {const lease=JSON.parse(readFileSync(file,'utf8'));if(!Number.isSafeInteger(lease.pid)||typeof lease.snapshotId!=='string')return;
      if(isProcessAlive(lease.pid))keep.add(lease.snapshotId);else unlinkSync(file);
    }catch{return;}
  }
  for(const m of manifests) {if(keep.has(m.snapshotId))continue;const path=accountSnapshotDirectory(root,accountId,m.snapshotId),child=relative(base,path);
    if(!child||child.startsWith('..')||isAbsolute(child)||lstatSync(path).isSymbolicLink())continue;rmSync(path,{recursive:true});}
}
/** Only the originating host process with the exact worker token may recover its lock. */
export function releaseAccountSyncLock(root:string,accountId:number,token:string):boolean {
  const path=join(accountDirectory(root,accountId),'sync.lock');
  try {const owner=JSON.parse(readFileSync(path,'utf8'));
    if(owner.token!==token||owner.pid!==process.pid)return false;
    unlinkSync(path);return true;
  }catch{return false;}
}
export async function withAccountSyncLock<T>(root:string,accountId:number,run:()=>Promise<T>,token:string=randomUUID()):Promise<T> {
  if(!/^[a-f0-9-]{36}$/i.test(token))throw new AppError('ACCOUNT_SYNC_INVALID_LOCK','同步锁所有权标识无效。');
  const dir=accountDirectory(root,accountId);mkdirSync(dir,{recursive:true});const path=join(dir,'sync.lock');
  const claim=()=>writeFileSync(path,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});
  try{claim();}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const recovery=join(dir,'sync-reclaim.lock');try{writeFileSync(recovery,token,{flag:'wx'});}catch{throw new AppError('ACCOUNT_SYNC_BUSY','其他进程正在同步个人数据。');}
    try {let owner;try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{throw new AppError('ACCOUNT_SYNC_BUSY','个人同步锁无法核实，请稍后重试。');}
      if(!Number.isSafeInteger(owner.pid)||isProcessAlive(owner.pid))throw new AppError('ACCOUNT_SYNC_BUSY','其他进程正在同步个人数据。');
      unlinkSync(path);try{claim();}catch{throw new AppError('ACCOUNT_SYNC_BUSY','其他进程已开始同步个人数据。');}
    }finally{unlinkSync(recovery);}
  }
  try{return await run();}finally{releaseAccountSyncLock(root,accountId,token);}
}
