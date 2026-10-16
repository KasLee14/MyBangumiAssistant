import { isAbsolute } from 'node:path';
import { AppError } from '../support/errors.js';
import { getDatasetStatus, openSnapshot } from '../knowledge/store.js';
import { LocalQueryEngine, type QueryResult } from '../knowledge/query.js';
import { ResourceStore } from './resource-store.js';
import { cachedResourceSelection, type CachedResource, type CachedResourceSelection } from './resource-contract.js';
import { projectModelResult } from './model-projection.js';
import { assertResourceFields } from './resource-policy.js';
import { ENTITY_FIELDS, LOCAL_FIELDS } from './local-contract.js';
import { validateToolArguments } from './catalog.js';
import type { AccessContext } from './access-context.js';
import { readContext, type McpReadContext } from './read-context.js';
import type { McpTransport } from './transport.js';
import type { McpBatchScope, BatchPreparation } from './batch-context.js';
import type { PreparedBaseline } from './prepared.js';

export interface McpWriteGuard { accountId:number;subjectId?:number;expectedStatus?:number;prepared?:PreparedBaseline;batchPreparation?:BatchPreparation }
type Row=Record<string,unknown>;
interface Turn {engine:LocalQueryEngine;context:AccessContext;nsfw:'exclude'|'include'}
interface Ref {turnId:string;snapshotId:string;nsfw:'exclude'|'include';members:QueryResult['members']}
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
function interrupted(signal?:AbortSignal):void{if(signal?.aborted)throw new AppError('CANCELLED','本地读取已取消。');}
function localContext(snapshotId:string,nsfw:'include'|'exclude'):AccessContext{
  const include=nsfw==='include';
  return {mode:'local',account:null,source:'archive',snapshotId,nsfw:{preference:include,allowed:include,state:include?'enabled':'disabled'},nsfwApplied:include,checkedAt:new Date().toISOString()};
}

/** 只读业务服务不装配HTTP或账户传输；SQLite读取位于现有独立MCP子进程。 */
export class BangumiMcpService {
  private readonly root:string;
  private readonly turns=new Map<string,Turn>();
  private readonly resources=new ResourceStore();
  private readonly references=new Map<string,Ref>();
  private closed=false;
  constructor(options:{knowledgeDir:string}|McpTransport){
    const root=(options as {knowledgeDir?:unknown}).knowledgeDir;
    if(typeof root!=='string'||!isAbsolute(root))throw new AppError('INVALID_INPUT','本地MCP必须指定绝对knowledgeDir，在线传输已停用。');
    this.root=root;
  }
  private turn(context?:McpReadContext,requestedNsfw?:'exclude'|'include'):{turnId:string;turn:Turn}{
    if(this.closed)throw new AppError('MCP_CLOSED','本地查询服务已关闭。');
    const read=context?readContext(context):{turnId:'standalone'};
    let turn=this.turns.get(read.turnId);
    const nsfw=read.nsfw??requestedNsfw??turn?.nsfw??'exclude';
    if(read.nsfw!==undefined&&requestedNsfw!==undefined&&read.nsfw!==requestedNsfw)throw new AppError('RESOURCE_SCOPE_MISMATCH','工具显示范围与宿主读取范围不一致。');
    if(turn){
      if(turn.nsfw!==nsfw||read.snapshotId!==undefined&&turn.engine.scope.snapshotId!==read.snapshotId)throw new AppError('RESOURCE_SCOPE_MISMATCH','同一读取轮次不能改变数据快照或内容显示范围。');
    }else{
      if(this.turns.size>=64)throw new AppError('MCP_CONTEXT_LIMIT','活动读取轮次过多，请先结束已完成的读取轮次。');
      const snapshot=openSnapshot(this.root,read.snapshotId),snapshotId=snapshot.manifest.snapshotId;
      turn={engine:new LocalQueryEngine(snapshot,{snapshotId,nsfw}),context:localContext(snapshotId,nsfw),nsfw};this.turns.set(read.turnId,turn);
    }
    return {turnId:read.turnId,turn};
  }
  async call(name:string,input:unknown,signal?:AbortSignal,_guard?:McpWriteGuard,_batch?:McpBatchScope,context?:McpReadContext):Promise<unknown>{
    interrupted(signal);const args=validateToolArguments(name,input);
    if(name==='get_dataset_status'){
      const dataset=getDatasetStatus(this.root),manifest=record(dataset.manifest),snapshotId=String(manifest.snapshotId??'uninitialized');
      const active=context?this.turns.get(context.turnId):undefined;
      return {schemaVersion:1,kind:'dataset_status',snapshotId:active?.engine.scope.snapshotId??snapshotId,dataset:{...dataset,activeSnapshotId:active?.engine.scope.snapshotId??null,currentSnapshotId:snapshotId},accessContext:active?.context??localContext(snapshotId,context?.nsfw??'exclude')};
    }
    if(name==='read_cached_resource')return this.readForModel(args,context,signal);
    const {turnId,turn}=this.turn(context,args.nsfw as 'exclude'|'include'|undefined);
    args.nsfw=turn.nsfw;
    let result:QueryResult;
    switch(name){
      case 'query_entities':result=turn.engine.query(args);break;
      case 'get_entities':result=turn.engine.get(args);break;
      case 'query_relations':result=turn.engine.relations(args);break;
      case 'aggregate_entities':result=turn.engine.aggregate(args);break;
      default:throw new AppError('UNKNOWN_TOOL','未登记的本地只读工具。');
    }
    interrupted(signal);
    const value={...result.value,accessContext:structuredClone(turn.context)};
    const resourceRef=this.resources.put(name,value,{},turnId,turn.context,`${turn.engine.scope.snapshotId}:${turn.nsfw}`);
    this.references.set(resourceRef,{turnId,snapshotId:turn.engine.scope.snapshotId,nsfw:turn.nsfw,members:result.members});
    if(this.references.size>1000)this.references.delete(this.references.keys().next().value!);
    return projectModelResult({...value,resourceRef},name,args);
  }
  private reference(ref:string,context?:McpReadContext):{cached:CachedResource;reference:Ref;turn:Turn}{
    const {turnId,turn}=this.turn(context),cached=this.resources.get(ref,turnId),reference=this.references.get(ref);
    if(!reference)throw new AppError('RESOURCE_EXPIRED','资源引用已过期。');
    if(reference.turnId!==turnId||reference.snapshotId!==turn.engine.scope.snapshotId||reference.nsfw!==turn.nsfw)throw new AppError('RESOURCE_SCOPE_MISMATCH','缓存引用的数据版本、任务或显示范围不一致。');
    return {cached,reference,turn};
  }
  async readCachedResource(ref:string,context?:McpReadContext,signal?:AbortSignal,selection?:CachedResourceSelection):Promise<CachedResource>{
    interrupted(signal);const selected=selection===undefined?undefined:cachedResourceSelection(selection),{cached,reference,turn}=this.reference(ref,context);
    let members=reference.members;
    if(selected?.subjectIds){
      const ids=new Set(selected.subjectIds);
      if(selected.subjectIds.some(id=>members.filter(member=>member.entity==='subject'&&member.id===id).length!==1))throw new AppError('RESOURCE_SCOPE_MISMATCH','展示成员不属于该引用的作品窗口。');
      members=members.filter(member=>member.entity==='subject'&&ids.has(member.id));
    }
    // 宿主RPC完整补齐同一页成员；它不进入模型content，也不会触发在线补取。
    if(reference.members.length)cached.value={...cached.value,data:members.flatMap(member=>turn.engine.read([member],selected?.fields?selected.fields.filter(field=>ENTITY_FIELDS[member.entity].includes(field)):'all'))};
    interrupted(signal);return cached;
  }
  private readForModel(args:Row,context?:McpReadContext,signal?:AbortSignal):CachedResource&Row{
    interrupted(signal);const ref=String(args.resource_ref),{cached,reference,turn}=this.reference(ref,context);
    const fields=Array.isArray(args.fields)?args.fields.map(String):[];
    const aggregate=cached.value.kind==='local_aggregate';
    if(fields.some(field=>!LOCAL_FIELDS.includes(field as typeof LOCAL_FIELDS[number])&&!(aggregate&&['group','count','averageScore'].includes(field))))throw new AppError('INVALID_INPUT','缓存读取字段未在公共资料白名单声明。');
    assertResourceFields(cached.sourceTool,fields);
    let members=reference.members;
    if(Array.isArray(args.keys)&&!aggregate){
      const chosen:QueryResult['members']=[];
      for(const key of args.keys){
        const matches=members.filter(member=>typeof key==='number'?member.id===key:Object.entries(record(key)).every(([field,value])=>field==='entity'||field==='kind'?member.entity===value:field==='id'||field===`${member.entity}Id`?member.id===value:member.extra?.[field]===value));
        if(matches.length!==1)throw new AppError('RESOURCE_SCOPE_MISMATCH','缓存keys必须唯一对应原引用的成员。');
        if(chosen.some(member=>member.entity===matches[0]!.entity&&member.id===matches[0]!.id))throw new AppError('INVALID_INPUT','缓存选择包含重复成员。');
        chosen.push(matches[0]!);
      }
      members=chosen;
    }
    const aggregateRows=Array.isArray(cached.value.data)?cached.value.data as Row[]:[];
    const selectedAggregates=Array.isArray(args.keys)?aggregateRows.filter(row=>(args.keys as unknown[]).some(key=>typeof key==='number'?row.id===key:Object.entries(record(key)).every(([field,value])=>row[field]===value))):aggregateRows;
    if(aggregate&&Array.isArray(args.keys)&&selectedAggregates.length!==args.keys.length)throw new AppError('RESOURCE_SCOPE_MISMATCH','统计keys必须选自原引用成员。');
    const data:Row[]=aggregate?selectedAggregates.map(row=>({entity:row.entity,id:row.id,group:row.group,count:row.count,...Object.fromEntries(fields.filter(field=>Object.hasOwn(row,field)).map(field=>[field,row[field]]))})):turn.engine.read(members,fields);
    const range=record(args.range),offset=Number(range.offset??0),limit=Number(range.limit??500),windows:Row[]=[];
    for(const row of data)for(const field of fields){
      const original=row[field];
      if(typeof original==='string'&&['summary','infoboxRaw'].includes(field)){
        const characters=Array.from(original);if(offset>characters.length)throw new AppError('CONTENT_RANGE_INVALID','正文偏移超过该字段长度。');
        row[field]=characters.slice(offset,offset+limit).join('');windows.push({entity:row.entity,id:row.id,field,total:characters.length,offset,limit,nextOffset:offset+limit<characters.length?offset+limit:null,complete:offset+limit>=characters.length});
      }
    }
    const value={...cached.value,data,fields,resourceRef:ref};
    const result={...cached,value,fields,...(windows.length?{range:{offset,limit,fields:windows}}:{})};
    // 约束模型正文窗口而非把一次响应挤入全部长文本。
    if(Buffer.byteLength(JSON.stringify(result))>200_000)throw new AppError('MCP_OUTPUT_LIMIT','所选缓存字段超过上下文上限，请减少keys或缩小range。');
    return result;
  }
  endReadContext(turnId:string):void{
    this.resources.clear(turnId);for(const [ref,binding]of this.references)if(binding.turnId===turnId)this.references.delete(ref);
    this.turns.get(turnId)?.engine.snapshot.close();this.turns.delete(turnId);
  }
  async close():Promise<void>{if(this.closed)return;this.closed=true;for(const id of this.turns.keys())this.endReadContext(id);this.resources.clear();this.references.clear();}
}
