import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fetch } from 'undici';
import { AccountSessionStore, type AccountSession } from '../login/account-session.js';
import { AccountTransport } from '../login/transport.js';
import { ProxyDispatchers } from '../support/proxy-dispatcher.js';
import { AppError } from '../support/errors.js';
import { ACCOUNT_SCHEMA_VERSION, createAccountSchema } from './schema.js';
import { accountDirectory, accountSnapshotDirectory, openAccountSnapshot, publishAccountManifest, pruneAccountSnapshots, readAccountManifest, withAccountSyncLock } from './store.js';
import type { AccountManifest, AccountSyncResult, CollectionRecord, SyncAccountDataOptions } from './types.js';

const invalid = (): never => { throw new AppError('ACCOUNT_SYNC_INVALID_RESPONSE','收藏同步响应不完整或字段无效，未发布新数据。'); };
const record = (v:unknown):Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : invalid();
const integer = (v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number => Number.isSafeInteger(v) && Number(v)>=min && Number(v)<=max ? Number(v) : invalid();
const string = (v:unknown,max=100_000):string => typeof v==='string' && v.length<=max ? v : invalid();
const boolean = (v:unknown):boolean => typeof v==='boolean' ? v : invalid();
const digest = (v:unknown):string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function normalizeCollection(value:unknown,observedAt:number):CollectionRecord {
  const r=record(value),i=record(r.interest);
  if(!Array.isArray(i.tags)||i.tags.length>1000)invalid();
  const tags=[...new Set((i.tags as unknown[]).map(t=>string(t,1000)))].sort();
  const personal={subject_id:integer(r.id,1),interest_id:integer(i.id,1),subject_type:integer(r.type,1,6),
    collection_type:integer(i.type,1,5),personal_rating:integer(i.rate,0,10),comment:string(i.comment),is_private:Number(boolean(i.private)),
    ep_status:integer(i.epStatus),vol_status:integer(i.volStatus),source_updated_at:integer(i.updatedAt),tags};
  if(![1,2,3,4,6].includes(personal.subject_type))invalid();
  let image:string|null=null;
  // p1 subject images are optional; retain only an HTTP(S) URL already returned in the list.
  const images=r.images && typeof r.images==='object' ? record(r.images) : null;
  const rawImage=typeof r.image==='string'?r.image:images?.common??images?.medium??images?.small;
  if(typeof rawImage==='string'&&rawImage.length<=4000){try{const url=new URL(rawImage);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)image=url.href;}catch{/* no usable image hint */}}
  return {...personal,observed_at:observedAt,content_hash:digest(personal),name:string(r.name,2000),name_cn:string(r.nameCN??r.name_cn??'',2000),nsfw:boolean(r.nsfw),image_url:image};
}
function sameSession(a:AccountSession|null,b:AccountSession):boolean {
  return a!==null&&a.accountId===b.accountId&&a.sessionId===b.sessionId&&a.savedAt===b.savedAt&&a.expiresAt>Date.now();
}

/** Read-only upstream sync. No user query calls this function; the host owns explicit invocation. */
export async function syncAccountData(options:SyncAccountDataOptions):Promise<AccountSyncResult> {
  const started=performance.now(),store=options.sessionStore??new AccountSessionStore(options.authDir);
  const session=await store.load();
  if(!session)throw new AppError('BGM_AUTH_REQUIRED','请先登录，再同步个人数据。');
  if(options.expectedAccountId!==undefined&&options.expectedAccountId!==session.accountId)throw new AppError('ACCOUNT_CONTEXT_CHANGED','后台同步启动期间登录账户已改变，请重新同步。');
  if(session.expiresAt<=Date.now())throw new AppError('BGM_AUTH_EXPIRED','登录已过期，请重新登录后同步。');
  options.signal?.throwIfAborted();
  return withAccountSyncLock(options.root,session.accountId,async()=>{
    let old:AccountManifest|null=null;
    try {old=readAccountManifest(options.root,session.accountId);
      if(old){const check=openAccountSnapshot(options.root,session.accountId);try {
        if(check.db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new AppError('ACCOUNT_DATA_DATABASE_INVALID','个人数据库损坏，请显式执行全量同步恢复。');
      }finally{check.release();}}
    }catch(error){
      if(options.mode!=='full')throw new AppError('ACCOUNT_DATA_DATABASE_INVALID','个人数据库无法校验，保留现有文件；请显式执行全量同步恢复。');
      old=null;
    }
    const dispatchers=new ProxyDispatchers(options.proxy??null);let requestCount=0,pageCount=0,serverTime:number|undefined;
    const api=new AccountTransport(session,options.proxy??null,options.timeoutMs??30_000,async(url,init)=>{
      const endpoint=new URL(url);
      if(init.method!=='GET'||endpoint.origin!=='https://next.bgm.tv'||!['/p1/me','/p1/privacy','/p1/collections/subjects'].includes(endpoint.pathname))throw new AppError('ACCOUNT_SYNC_ENDPOINT','同步仅允许固定只读接口。');
      requestCount++;
      const response=options.fakeFetch?await options.fakeFetch(url,init):await fetch(url,{...init,dispatcher:dispatchers.forUrl(url)}) as unknown as Response;
      const clock=Date.parse(response.headers.get('date')??'');if(Number.isFinite(clock))serverTime=Math.floor(clock/1000);
      return response;
    });
    let stage:string|undefined,db:DatabaseSync|undefined,published=false;
    try {
      const assertSession=async()=>{if(!sameSession(await store.load(),session))throw new AppError('ACCOUNT_SYNC_SESSION_CHANGED','同步期间登录账户发生变化，未发布数据。');};
      const verify=async()=>{
        await assertSession();
        const me=record(await api.json('/p1/me',{auth:true},options.signal));
        if(integer(me.id,1)!==session.accountId)throw new AppError('ACCOUNT_SYNC_SESSION_CHANGED','上游账户与本地登录不一致，未发布数据。');
        const privacy=record(await api.json('/p1/privacy',{auth:true},options.signal));const prefs=record(privacy.preferences);
        const allowNsfw=boolean(prefs.allowNsfw),showNsfwSubject=boolean(prefs.showNsfwSubject);
        return {allowNsfw,showNsfwSubject,visibilityKey:digest({allowNsfw,showNsfwSubject})};
      };
      const visibility=await verify();
      const boundary=serverTime??Math.floor(Date.now()/1000);
      const scopeChanged=!!old&&old.visibilityKey!==visibility.visibilityKey;
      const mode=options.mode==='full'||!old||scopeChanged?'full':'delta';
      const since=mode==='delta'?Math.max(0,old!.cursor-120):undefined;
      const rows=new Map<number,CollectionRecord>();let total:number|undefined,offset=0;
      for(let pageIndex=0;pageIndex<10_000;pageIndex++) {
        options.signal?.throwIfAborted();
        const page=record(await api.json('/p1/collections/subjects',{auth:true,query:{limit:100,offset,...(since===undefined?{}:{since})}},options.signal));pageCount++;
        const count=integer(page.total,0,1_000_000);if(!Array.isArray(page.data)||page.data.length>100)invalid();
        const data=page.data as unknown[];
        if(total===undefined)total=count;else if(total!==count)throw new AppError('ACCOUNT_SYNC_PAGE_DRIFT','收藏列表在分页期间发生变化，请重新同步。');
        for(const item of data) {
          const row=normalizeCollection(item,Math.floor(Date.now()/1000));
          if(since!==undefined&&row.source_updated_at<since)invalid();
          if(!visibility.allowNsfw&&row.nsfw)throw new AppError('ACCOUNT_SYNC_SCOPE_CHANGED','返回条目超出当前可见范围，未发布数据。');
          if(rows.has(row.subject_id))throw new AppError('ACCOUNT_SYNC_PAGE_DRIFT','收藏分页出现重复条目，请重新同步。');
          rows.set(row.subject_id,row);
        }
        offset+=data.length;if(offset>total)invalid();if(offset===total)break;if(data.length===0)invalid();
        await delay(150,undefined,{signal:options.signal});
      }
      if(total===undefined||rows.size!==total)invalid();
      const finalVisibility=await verify();
      if(finalVisibility.visibilityKey!==visibility.visibilityKey)throw new AppError('ACCOUNT_SYNC_SCOPE_CHANGED','同步期间账户可见范围变化，未发布数据。');
      const now=new Date().toISOString(),snapshotId=`account-${Date.now()}-${randomUUID()}`;
      stage=accountSnapshotDirectory(options.root,session.accountId,snapshotId);mkdirSync(stage,{recursive:true});
      const file=join(stage,'collections.sqlite');
      const reuseOld=old!==null&&!scopeChanged;
      if(reuseOld)copyFileSync(join(accountSnapshotDirectory(options.root,session.accountId,old!.snapshotId),'collections.sqlite'),file);
      db=new DatabaseSync(file);if(!reuseOld)createAccountSchema(db);
      let added=0,updated=0,missing=0;
      db.exec('BEGIN IMMEDIATE');
      try {
        const get=db.prepare('SELECT content_hash,record_state FROM collections WHERE subject_id=?');
        const getHint=db.prepare('SELECT name,name_cn,subject_type,nsfw,image_url FROM subject_hints WHERE subject_id=?');
        const upsert=db.prepare(`INSERT OR REPLACE INTO collections(subject_id,interest_id,subject_type,collection_type,personal_rating,comment,is_private,ep_status,vol_status,source_updated_at,observed_at,content_hash,record_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'visible')`);
        const clearTags=db.prepare('DELETE FROM collection_tags WHERE subject_id=?');const tag=db.prepare('INSERT INTO collection_tags VALUES(?,?,?)');
        const hint=db.prepare('INSERT OR REPLACE INTO subject_hints VALUES(?,?,?,?,?,?,?)');
        for(const r of rows.values()) {
          const prev=get.get(r.subject_id);
          const priorHint=getHint.get(r.subject_id);
          if(prev?.content_hash===r.content_hash&&prev.record_state==='visible'&&priorHint?.name===r.name&&priorHint.name_cn===r.name_cn
            &&priorHint.subject_type===r.subject_type&&priorHint.nsfw===Number(r.nsfw)&&priorHint.image_url===r.image_url)continue;
          if(prev)updated++;else added++;
          upsert.run(r.subject_id,r.interest_id,r.subject_type,r.collection_type,r.personal_rating,r.comment,r.is_private,r.ep_status,r.vol_status,r.source_updated_at,r.observed_at,r.content_hash);
          clearTags.run(r.subject_id);r.tags.forEach((t,pos)=>tag.run(r.subject_id,t,pos));
          hint.run(r.subject_id,r.name,r.name_cn,r.subject_type,Number(r.nsfw),r.image_url,r.observed_at);
        }
        if(mode==='full'&&reuseOld){const mark=db.prepare("UPDATE collections SET record_state='missing' WHERE subject_id=?");
          for(const entry of db.prepare("SELECT subject_id FROM collections WHERE record_state='visible'").all())if(!rows.has(Number(entry.subject_id))){mark.run(Number(entry.subject_id));missing++;}}
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new AppError('ACCOUNT_SYNC_DATABASE_INVALID','个人数据库校验失败，未发布。');
      const recordCount=Number(db.prepare("SELECT COUNT(*) AS n FROM collections WHERE record_state='visible'").get()!.n);
      const missingCount=Number(db.prepare("SELECT COUNT(*) AS n FROM collections WHERE record_state='missing'").get()!.n);
      db.close();db=undefined;
      const changed=!old||scopeChanged||added>0||updated>0||missing>0;
      const manifest:AccountManifest={schemaVersion:ACCOUNT_SCHEMA_VERSION,accountId:session.accountId,snapshotId:changed?snapshotId:old!.snapshotId,
        builtAt:changed?new Date(Math.max(Date.now(),old?Date.parse(old.builtAt)+1:0)).toISOString():old!.builtAt,cursor:mode==='delta'?Math.max(old!.cursor,boundary):boundary,lastFullSyncAt:mode==='full'?now:old!.lastFullSyncAt,
        lastDeltaSyncAt:mode==='delta'?now:old?.lastDeltaSyncAt??null,...visibility,recordCount,missingCount,
        limitations:['since_does_not_cover_all_field_changes_or_deletions','missing_records_are_not_confirmed_uncollected']};
      options.signal?.throwIfAborted();await assertSession();
      publishAccountManifest(options.root,manifest,changed);published=changed;
      // Publishing succeeded; cleanup failures must never report the committed sync as failed.
      try{pruneAccountSnapshots(options.root,session.accountId);}catch{/* retry on a later successful sync */}
      return {mode,changed,added,updated,missing,requestCount,pageCount,durationMs:performance.now()-started,manifest};
    }finally {
      db?.close();
      if(stage&&!published&&existsSync(stage)){const base=join(accountDirectory(options.root,session.accountId),'snapshots'),child=relative(base,stage);
        if(child&&!child.startsWith('..')&&!isAbsolute(child))try{rmSync(stage,{recursive:true});}catch{/* unreferenced staging may be cleaned after external file locks expire */}}
      await api.close();await dispatchers.close();
    }
  },options.lockToken);
}
