import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { AppError } from '../support/errors.js';
import { ENTITY_FIELDS, PERSONAL_FIELDS, entityFields, type LocalEntityKind } from '../mcp/local-contract.js';
import { buildFtsQuery, normalizeSearch } from './schema.js';
import { openSnapshot } from './store.js';
import { platformLabel, relationLabel } from './dictionaries.js';

type Row = Record<string,unknown>;
type Binding = SQLInputValue[];
export type QuerySnapshot = ReturnType<typeof openSnapshot>;
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=(value:unknown):string|null=>typeof value==='string'&&value.length?value:null;
const json=(value:unknown):unknown=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const placeholders=(length:number):string=>Array.from({length},()=>'?').join(',');
const escapeLike=(value:string):string=>value.replace(/[\\%_]/g,char=>`\\${char}`);
const sfwEntity="e.nsfw=0 AND (e.kind<>'episode' OR EXISTS(SELECT 1 FROM entities parent WHERE parent.kind='subject' AND parent.id=e.subject_id AND parent.nsfw=0))";
const sfwForKind=(kind?:LocalEntityKind):string=>kind&&kind!=='episode'?'e.nsfw=0':sfwEntity;
function digest(value:unknown):string{
  const stable=(item:unknown):unknown=>Array.isArray(item)?item.map(stable):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,stable(value)])):item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export interface QueryScope { snapshotId:string; nsfw:'exclude'|'include'; accountId?:number; accountSnapshotId?:string; accountSchema?:string; accountAllowNsfw?:boolean }
export interface AccountQuerySource {path:string;accountId:number;snapshotId:string;allowNsfw:boolean}
export interface QueryResult { value:Row; members:{entity:LocalEntityKind;id:number;extra?:Row}[] }

/** 所有SQL标识符来自下方固定表；用户值仅以绑定参数进入SQLite。 */
function conditions(args:Row,scope:QueryScope,kind?:LocalEntityKind):{sql:string;params:Binding;missing:string[];baseSql:string;baseParams:Binding}{
  const entity=kind??args.entity as LocalEntityKind,filter=record(args.filter),clauses:string[]=[],params:Binding=[],missing:string[]=[];
  if(entity){clauses.push('e.kind=?');params.push(entity);}
  if(scope.nsfw==='exclude')clauses.push(`(${sfwForKind(entity)})`);
  if(scope.accountSchema){
    const collection=record(filter.collection),visible="e.ac_record_state='visible'";
    if(collection.membership==='collected')clauses.push(visible);
    if(collection.membership==='not_collected')clauses.push(`e.ac_subject_id IS NULL${scope.accountAllowNsfw?'':' AND e.nsfw=0'}`);
    if(Object.keys(collection).some(key=>key!=='membership'))clauses.push(visible);
    for(const key of ['types','exclude_types'])if(Array.isArray(collection[key])){clauses.push(`e.ac_collection_type ${key==='exclude_types'?'NOT ':''}IN (${placeholders(collection[key].length)})`);params.push(...collection[key] as number[]);}
    if(collection.rated!==undefined)clauses.push(collection.rated?'e.ac_personal_rating>0':'e.ac_personal_rating=0');
    if(collection.private!==undefined){clauses.push('e.ac_is_private=?');params.push(collection.private?1:0);}
    for(const [key,column] of Object.entries({rating:'ac_personal_rating',updated_at:'ac_source_updated_at'})){const range=record(collection[key]);for(const side of ['min','max'])if(range[side]!==undefined){clauses.push(`e.${column}${side==='min'?'>=':'<='}?`);params.push(Number(range[side]));}}
    if(Array.isArray(collection.tags_all))for(const tag of collection.tags_all){clauses.push(`EXISTS(SELECT 1 FROM ${scope.accountSchema}.collection_tags ct WHERE ct.subject_id=e.id AND ct.tag=?)`);params.push(String(tag));}
    if(Array.isArray(collection.tags_any)){clauses.push(`EXISTS(SELECT 1 FROM ${scope.accountSchema}.collection_tags ct WHERE ct.subject_id=e.id AND ct.tag IN (${placeholders(collection.tags_any.length)}))`);params.push(...collection.tags_any.map(String));}
  }
  const keyword=typeof args.keyword==='string'?args.keyword.trim():'';
  if(keyword){
    const keywordStart=clauses.length;
    if(args.match==='fulltext'){
      const match=buildFtsQuery(keyword);
      if(match){clauses.push('(e.kind,e.id) IN (SELECT kind,entity_id FROM entity_fts WHERE entity_fts MATCH ?)');params.push(match);}
      else clauses.push('0');
    }else{
      // CJK逐字FTS先缩小候选，再核实真实子串，避免每次名称查询扫描数百万别名。
      // 混合名称只取最长连续CJK片段做必要条件；拉丁内部子串仍由LIKE验证，不能整词预筛而漏召回。
      const segment=(normalizeSearch(keyword).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)??[]).sort((a,b)=>b.length-a.length)[0];
      const indexed=segment!==undefined,match=buildFtsQuery(segment??'');
      if(indexed&&match){clauses.push('(e.kind,e.id) IN (SELECT kind,entity_id FROM entity_fts WHERE entity_fts MATCH ?)');params.push(`{name aliases}: ${match}`);}
      // 导入器将原名和中文名一并登记aliases；只扫描紧凑别名索引，避免读取含原文的大实体表。
      clauses.push(indexed&&match
        ?"EXISTS(SELECT 1 FROM aliases a WHERE a.kind=e.kind AND a.entity_id=e.id AND a.normalized LIKE ? ESCAPE '\\')"
        :"(e.kind,e.id) IN (SELECT kind,entity_id FROM aliases WHERE normalized LIKE ? ESCAPE '\\')");
      const pattern=`%${escapeLike(normalizeSearch(keyword))}%`;params.push(pattern);
    }
    if(scope.accountSchema&&keyword){const start=keywordStart;if(start<clauses.length){const keywordSql=clauses.splice(start);clauses.push(`((${keywordSql.join(' AND ')}) OR (e.ac_archive_missing=1 AND (lower(e.name) LIKE ? ESCAPE '\\' OR lower(e.name_cn) LIKE ? ESCAPE '\\')))`);const pattern=`%${escapeLike(normalizeSearch(keyword))}%`;params.push(pattern,pattern);}}
  }
  for(const [key,column] of Object.entries({subject_type:'subject_type',platform:'platform',subject_id:'subject_id',episode_type:'entity_type'}))if(filter[key]!==undefined){clauses.push(`e.${column}=?`);params.push(filter[key] as number);}
  if(Array.isArray(filter.tags))for(const tag of filter.tags){clauses.push('EXISTS(SELECT 1 FROM tags t WHERE t.kind=e.kind AND t.entity_id=e.id AND t.name=?)');params.push(String(tag));}
  if(Array.isArray(filter.career)){clauses.push(`EXISTS(SELECT 1 FROM json_each(e.raw_json,'$.career') career WHERE career.value IN (${placeholders(filter.career.length)}))`);params.push(...filter.career.map(String));}
  const baseSql=clauses.join(' AND ')||'1',baseParams=[...params];
  for(const [key,column] of Object.entries({year:'year',date:'date',score:'score',rating_count:'rating_total',rank:'rank'})){
    const range=record(filter[key]);if(!Object.keys(range).length)continue;
    missing.push(`e.${column} IS NULL`);
    // 只有完整日期才参与日粒度比较，年份精度应使用year条件。
    if(key==='date'){clauses.push('length(e.date)=10');missing[missing.length-1]='(e.date IS NULL OR length(e.date)<>10)';}
    for(const side of ['min','max'])if(range[side]!==undefined){clauses.push(`e.${column}${side==='min'?'>=':'<='}?`);params.push(range[side] as number|string);}
  }
  return {sql:clauses.join(' AND ')||'1',params,missing,baseSql,baseParams};
}
function cursorOffset(args:Row,scope:QueryScope):number{
  if(args.cursor===undefined)return 0;
  let cursor:Row;try{cursor=record(JSON.parse(Buffer.from(String(args.cursor),'base64url').toString('utf8')));}catch{throw new AppError('INVALID_INPUT','分页游标无效。');}
  const {cursor:_cursor,fields:_fields,...plan}=args;
  if(cursor.snapshotId!==scope.snapshotId||cursor.scope!==scope.nsfw||cursor.accountId!==scope.accountId||cursor.accountSnapshotId!==scope.accountSnapshotId||cursor.plan!==digest(plan)||!Number.isSafeInteger(cursor.offset)||Number(cursor.offset)<1)
    throw new AppError('RESOURCE_SCOPE_MISMATCH','分页条件、数据快照或显示范围发生变化。');
  return Number(cursor.offset);
}
function page(args:Row,scope:QueryScope,total:number,offset:number,returnedCount:number):Row{
  const limit=Number(args.limit??30),{cursor:_cursor,fields:_fields,...plan}=args;
  const nextCursor=offset+returnedCount<total?Buffer.from(JSON.stringify({snapshotId:scope.snapshotId,scope:scope.nsfw,accountId:scope.accountId,accountSnapshotId:scope.accountSnapshotId,plan:digest(plan),offset:offset+returnedCount})).toString('base64url'):null;
  return {total,limit,offset,returnedCount,nextCursor,complete:nextCursor===null};
}
function coverage(db:DatabaseSync,where:ReturnType<typeof conditions>,entities='entities',self=false):Row{
  const unknownCount=where.missing.length?Number(db.prepare(`SELECT count(*) n FROM ${entities} e WHERE ${where.baseSql} AND (${where.missing.join(' OR ')})`).get(...where.baseParams)?.n??0):0;
  return {scope:self?'account_snapshot':'archive_snapshot',complete:unknownCount===0,totalKind:'exact',unknownCount,
    limitations:[...(self?['个人信息来自本地收藏快照；增量可能未捕获评分、标签修改及取消收藏，未收藏仅表示适用快照中缺席；全量缺席待核实记录为未知，不纳入未收藏筛选。']:[]),'仅覆盖本次公开Archive导出，非网站实时全集。','标签为上游部分标签，缺失标签不证明作品没有该题材。',...(unknownCount?['筛选字段缺失的记录计入unknownCount，未推断满足条件。']:[])]};
}
const ordering:Record<string,string>={id:'e.id ASC',name:'e.name COLLATE NOCASE,e.id',date_asc:'e.date IS NULL,e.date ASC,e.id',date_desc:'e.date IS NULL,e.date DESC,e.id',score:'e.score IS NULL,e.score DESC,e.id',rank:'e.rank IS NULL,e.rank ASC,e.id',rating_count:'e.rating_total IS NULL,e.rating_total DESC,e.id',personal_rating_desc:"CASE WHEN e.ac_record_state='visible' THEN e.ac_personal_rating END IS NULL,CASE WHEN e.ac_record_state='visible' THEN e.ac_personal_rating END DESC,e.id",personal_rating_asc:"CASE WHEN e.ac_record_state='visible' THEN e.ac_personal_rating END IS NULL,CASE WHEN e.ac_record_state='visible' THEN e.ac_personal_rating END ASC,e.id",collection_updated_desc:"CASE WHEN e.ac_record_state='visible' THEN e.ac_source_updated_at END IS NULL,CASE WHEN e.ac_record_state='visible' THEN e.ac_source_updated_at END DESC,e.id",collection_updated_asc:"CASE WHEN e.ac_record_state='visible' THEN e.ac_source_updated_at END IS NULL,CASE WHEN e.ac_record_state='visible' THEN e.ac_source_updated_at END ASC,e.id"};

/** 一个服务端快照句柄供同轮查询、延迟补字段及展示共享，更新不替换已打开的文件。 */
export class LocalQueryEngine {
  private readonly entities:string;
  constructor(readonly snapshot:QuerySnapshot,readonly scope:QueryScope,readonly accountSource?:AccountQuerySource){
    this.entities='entities';
    this.scope={snapshotId:scope.snapshotId,nsfw:scope.nsfw};
    if(accountSource){
      const db=snapshot.db,alias=`account_${digest([accountSource.accountId,accountSource.snapshotId]).slice(0,16)}`;
      const uri=pathToFileURL(accountSource.path);uri.searchParams.set('mode','ro');uri.searchParams.set('immutable','1');
      db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(uri.href);
      this.scope={...scope,nsfw:accountSource.allowNsfw?scope.nsfw:'exclude',accountId:accountSource.accountId,accountSnapshotId:accountSource.snapshotId,accountSchema:alias,accountAllowNsfw:accountSource.allowNsfw};
      this.entities=`${alias}_entities`;
      const columns=['subject_id','collection_type','personal_rating','comment','is_private','ep_status','vol_status','source_updated_at','record_state'].map(column=>`c.${column} ac_${column}`).join(',');
      db.exec('PRAGMA query_only=OFF');
      try { db.exec(`CREATE TEMP VIEW ${this.entities} AS
        SELECT e.*,${columns},0 ac_archive_missing FROM main.entities e LEFT JOIN ${alias}.collections c ON e.kind='subject' AND c.subject_id=e.id
        UNION ALL
        SELECT 'subject',h.subject_id,h.subject_type,NULL,h.name,h.name_cn,NULL,NULL,NULL,NULL,NULL,NULL,NULL,h.nsfw,NULL,NULL,NULL,NULL,NULL,${columns},1
        FROM ${alias}.subject_hints h JOIN ${alias}.collections c ON c.subject_id=h.subject_id AND c.record_state='visible'
        WHERE NOT EXISTS(SELECT 1 FROM main.entities e WHERE e.kind='subject' AND e.id=h.subject_id)`); } finally { db.exec('PRAGMA query_only=ON'); }
    }
  }
  private fields(kind:LocalEntityKind):readonly string[]{return entityFields(kind,Boolean(this.accountSource));}
  private check(args:Row):void{
    if((args.data_scope==='self')!==Boolean(this.accountSource))throw new AppError('RESOURCE_SCOPE_MISMATCH','个人数据范围与固定查询快照不一致。');
    if(this.accountSource&&(args.entity??args.target_entity)!=='subject')throw new AppError('INVALID_INPUT','本人收藏只支持subject条目。');
    if(!this.accountSource&&(record(args.filter).collection!==undefined||(Array.isArray(args.fields)&&args.fields.some(field=>(PERSONAL_FIELDS as readonly string[]).includes(String(field))))||String(args.sort??'').startsWith('personal_')||String(args.sort??'').startsWith('collection_')||['collectionType','personalRating','personalTag'].includes(String(args.group_by))||(Array.isArray(args.metrics)&&args.metrics.some(metric=>['averagePersonalRating','ratedCount'].includes(String(metric))))))throw new AppError('INVALID_INPUT','个人数据需要data_scope=self。');
  }
  query(args:Row):QueryResult{
    this.check(args);
    const kind=args.entity as LocalEntityKind,where=conditions(args,this.scope),db=this.snapshot.db;
    const total=Number(db.prepare(`SELECT count(*) n FROM ${this.entities} e WHERE ${where.sql}`).get(...where.params)?.n??0),offset=cursorOffset(args,this.scope),limit=Number(args.limit??30);
    let order=ordering[String(args.sort)]??ordering.id!,bindings=[...where.params],from=`${this.entities} e`,predicate=where.sql;
    if(args.sort==='match'&&typeof args.keyword==='string'&&args.keyword.trim()){
      const fts=!this.accountSource&&args.match==='fulltext'?buildFtsQuery(args.keyword):'';
      order=`CASE WHEN lower(e.name)=? OR lower(e.name_cn)=? THEN 0 WHEN EXISTS(SELECT 1 FROM aliases a WHERE a.kind=e.kind AND a.entity_id=e.id AND a.normalized=?) THEN 1 ELSE 2 END,${fts?'f.match_rank,':''}e.id`;
      if(fts&&!this.accountSource){
        const filters=conditions({...args,keyword:''},this.scope);
        from=`(SELECT kind,entity_id,bm25(entity_fts,0,0,8,5,1) match_rank FROM entity_fts WHERE entity_fts MATCH ? LIMIT -1) f JOIN ${this.entities} e ON e.kind=f.kind AND e.id=f.entity_id`;
        predicate=filters.sql;bindings=[fts,...filters.params];
      }
      const name=normalizeSearch(args.keyword);bindings.push(name,name,name);
    }
    const rows=db.prepare(`SELECT e.kind,e.id FROM ${from} WHERE ${predicate} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...bindings,limit,offset);
    const members=rows.map(row=>({entity:row.kind as LocalEntityKind,id:Number(row.id)}));
    return {members,value:{schemaVersion:1,kind:'local_query',entity:kind,snapshotId:this.scope.snapshotId,
      data:this.read(members,args.fields as string[]??[]),fields:args.fields??[],availableFields:this.fields(kind),page:page(args,this.scope,total,offset,rows.length),coverage:coverage(db,where,this.entities,Boolean(this.accountSource))}};
  }
  get(args:Row):QueryResult{
    this.check(args);
    const kind=args.entity as LocalEntityKind,ids=args.ids as number[],db=this.snapshot.db;
    const records=db.prepare(`SELECT id FROM ${this.entities} e WHERE kind=? AND id IN (${placeholders(ids.length)})${this.scope.nsfw==='exclude'?` AND (${sfwForKind(kind)})`:''}`).all(kind,...ids);
    const found=new Set(records.map(row=>Number(row.id))),members=ids.filter(id=>found.has(id)).map(id=>({entity:kind,id}));
    return {members,value:{schemaVersion:1,kind:'local_entities',entity:kind,snapshotId:this.scope.snapshotId,
      data:this.read(members,args.fields as string[]??[]),fields:args.fields??[],availableFields:this.fields(kind),requestedIds:ids,missingIds:ids.filter(id=>!found.has(id))}};
  }
  relations(args:Row):QueryResult{
    this.check(args);
    const db=this.snapshot.db,source=record(args.source),direction=String(args.direction??'both'),target=args.target_entity as LocalEntityKind|undefined;
    if(args.appearance_role!==undefined&&(source.entity!=='person'||target!=='subject'||direction==='incoming'||args.relation_types!==undefined))throw new AppError('INVALID_INPUT','appearance_role仅用于人物配音到作品的角色职能筛选，不与反向或其他关系域的类型筛选混用。');
    const sourceRow=db.prepare(`SELECT subject_type FROM ${this.entities} e WHERE kind=? AND id=?${this.scope.nsfw==='exclude'?` AND (${sfwForKind(source.entity as LocalEntityKind)})`:''}`).get(String(source.entity),Number(source.id));
    if(!sourceRow)throw new AppError('LOCAL_ENTITY_NOT_FOUND','当前本地快照和显示范围中没有关系起点。');
    const routes:string[]=[],params:Binding=[];
    const types=Array.isArray(args.relation_types)?args.relation_types as number[]:[];
    const typeSql=types.length?` AND r.relation_type IN (${placeholders(types.length)})`:'';
    const sourceVisibility=this.scope.nsfw==='exclude'?" AND (r.subject_id IS NULL OR EXISTS(SELECT 1 FROM entities owner WHERE owner.kind='subject' AND owner.id=r.subject_id AND owner.nsfw=0))":'';
    const edgeColumns='r.source_kind edge_source_kind,r.source_id edge_source_id,r.target_kind edge_target_kind,r.target_id edge_target_id,NULL via_character_id,NULL appearance_role,NULL appearance_relation_id';
    if(direction!=='incoming'){
      routes.push(`SELECT r.target_kind kind,r.target_id id,r.id relation_id,r.relation_type,r.subject_id,${edgeColumns} FROM relations r WHERE r.source_kind=? AND r.source_id=?${typeSql}${sourceVisibility}`);
      params.push(String(source.entity),Number(source.id),...types);
    }
    if(direction!=='outgoing'){
      routes.push(`SELECT r.source_kind kind,r.source_id id,r.id relation_id,r.relation_type,r.subject_id,${edgeColumns} FROM relations r WHERE r.target_kind=? AND r.target_id=?${typeSql}${sourceVisibility}`);
      params.push(String(source.entity),Number(source.id),...types);
    }
    // 配音归属必须同时匹配作品和角色，防止同名角色或跨作品出演混入。
    if(source.entity==='person'&&target==='subject'&&direction!=='incoming'&&!types.length){
      const roleSql=(args.appearance_role===undefined?'':' AND sc.relation_type=?')+(this.scope.nsfw==='exclude'?" AND EXISTS(SELECT 1 FROM entities owner WHERE owner.kind='subject' AND owner.id=pc.subject_id AND owner.nsfw=0)":'');
      routes.push(`SELECT 'subject' kind,pc.subject_id id,pc.id relation_id,pc.relation_type,pc.subject_id,pc.source_kind edge_source_kind,pc.source_id edge_source_id,pc.target_kind edge_target_kind,pc.target_id edge_target_id,pc.target_id via_character_id,sc.relation_type appearance_role,sc.id appearance_relation_id FROM relations pc JOIN relations sc ON sc.source_kind='subject' AND sc.source_id=pc.subject_id AND sc.target_kind='character' AND sc.target_id=pc.target_id WHERE pc.source_kind='person' AND pc.source_id=? AND pc.target_kind='character' AND pc.subject_id IS NOT NULL${roleSql}`);
      params.push(Number(source.id));if(args.appearance_role!==undefined)params.push(Number(args.appearance_role));
      if(args.appearance_role!==undefined){routes.splice(0,routes.length-1);params.splice(0,params.length-(args.appearance_role===undefined?1:2));}
    }
    const where=conditions({filter:args.filter??{},...(target?{entity:target}:{})},this.scope,target),cte=`WITH edges AS (${routes.join(' UNION ALL ')}), members AS (SELECT kind,id,json_group_array(DISTINCT json_object('relationId',relation_id,'relationType',relation_type,'sourceEntity',edge_source_kind,'sourceId',edge_source_id,'targetEntity',edge_target_kind,'targetId',edge_target_id,'subjectId',subject_id,'viaCharacterId',via_character_id,'appearanceRole',appearance_role,'appearanceRelationId',appearance_relation_id)) relations_json FROM edges GROUP BY kind,id)`;
    let constraint=where.sql;const bound=[...params,...where.params];
    if(target)constraint+=' AND m.kind=?',bound.push(target);
    const join=` FROM members m JOIN ${this.entities} e ON e.kind=m.kind AND e.id=m.id WHERE ${constraint}`;
    const total=Number(db.prepare(`${cte} SELECT count(*) n${join}`).get(...bound)?.n??0),offset=cursorOffset(args,this.scope),limit=Number(args.limit??30);
    const records=db.prepare(`${cte} SELECT e.kind,e.id,e.subject_type,m.relations_json${join} ORDER BY e.id,e.kind LIMIT ? OFFSET ?`).all(...bound,limit,offset);
    const members=records.map(row=>{
      const relations=json(row.relations_json) as Row[],relationTypes=[...new Set(relations.map(edge=>Number(edge.relationType)))].sort((a,b)=>a-b),roles=[...new Set(relations.flatMap(edge=>edge.appearanceRole==null?[]:[Number(edge.appearanceRole)]))];
      const subjectType=number(sourceRow.subject_type)??number(row.subject_type),labels=[...new Set(relations.map(edge=>relationLabel(edge.sourceEntity as LocalEntityKind,edge.targetEntity as LocalEntityKind,Number(edge.relationType),subjectType)))].join(' / ');
      return {entity:row.kind as LocalEntityKind,id:Number(row.id),extra:{relations,relationTypes,relationId:relations.length===1?relations[0]!.relationId:null,relationType:relationTypes.length===1?relationTypes[0]:null,relation:labels,staff:labels,appearanceRole:roles.length===1?roles[0]:null}};
    });
    const resultCoverage=coverage(db,{...where,missing:[]},this.entities,Boolean(this.accountSource));
    (resultCoverage.limitations as string[]).push('page.total及分页计数的单位是去重后的目标实体；原始关系边完整保留在每行relations字段，人数与边数不能互换。');
    if(where.missing.length){
      const unknown=Number(db.prepare(`${cte} SELECT count(*) n FROM members m JOIN ${this.entities} e ON e.kind=m.kind AND e.id=m.id WHERE ${where.baseSql} AND (${where.missing.join(' OR ')})`).get(...params,...where.baseParams)?.n??0);
      resultCoverage.unknownCount=unknown;resultCoverage.complete=unknown===0;
    }
    return {members,value:{schemaVersion:1,kind:'local_relations',...(target?{entity:target}:{}),snapshotId:this.scope.snapshotId,data:this.read(members,args.fields as string[]??[]),fields:args.fields??[],availableFields:target?this.fields(target):[...new Set(Object.values(ENTITY_FIELDS).flat())],page:page(args,this.scope,total,offset,records.length),coverage:resultCoverage}};
  }
  aggregate(args:Row):QueryResult{
    this.check(args);
    const db=this.snapshot.db,where=conditions(args,this.scope),groupBy=String(args.group_by??''),metrics=args.metrics as string[]??['count'];
    const groups:Record<string,string>={subjectType:'e.subject_type',year:'e.year',platform:'e.platform',score:'CAST(e.score AS INTEGER)',nsfw:'e.nsfw',tag:'t.name',collectionType:"CASE WHEN e.ac_record_state='visible' THEN e.ac_collection_type END",personalRating:"CASE WHEN e.ac_record_state='visible' THEN e.ac_personal_rating END",personalTag:'ct.tag'};
    const group=groups[groupBy]??'NULL',tagJoin=groupBy==='tag'?' JOIN (SELECT DISTINCT kind,entity_id,name FROM tags) t ON t.kind=e.kind AND t.entity_id=e.id':groupBy==='personalTag'?` LEFT JOIN ${this.scope.accountSchema}.collection_tags ct ON ct.subject_id=e.id AND e.ac_record_state='visible'`:'';
    const select=`${group} AS group_value,count(*) count${metrics.includes('averageScore')?',avg(CASE WHEN e.rating_total>0 THEN e.score END) average_score':''}${metrics.includes('ratingCount')?',coalesce(sum(e.rating_total),0) rating_count':''}${metrics.includes('averagePersonalRating')?",avg(CASE WHEN e.ac_record_state='visible' AND e.ac_personal_rating>0 THEN e.ac_personal_rating END) average_personal_rating":''}${metrics.includes('ratedCount')?",sum(CASE WHEN e.ac_record_state='visible' AND e.ac_personal_rating>0 THEN 1 ELSE 0 END) rated_count":''}`,suffix=groupBy?` GROUP BY ${group}`:'';
    const sql=`SELECT ${select} FROM ${this.entities} e${tagJoin} WHERE ${where.sql}${suffix}`;
    const total=groupBy?Number(db.prepare(`SELECT count(*) n FROM (SELECT ${group} FROM ${this.entities} e${tagJoin} WHERE ${where.sql}${suffix})`).get(...where.params)?.n??0):1;
    const limit=Number(args.limit??100),offset=cursorOffset(args,this.scope);
    const rows=db.prepare(`${sql} ORDER BY count DESC,group_value LIMIT ? OFFSET ?`).all(...where.params,limit,offset);
    const data=rows.map((row,index)=>({entity:'aggregate',id:offset+index+1,group:row.group_value??null,count:Number(row.count),...(metrics.includes('averageScore')?{averageScore:number(row.average_score)}:{}),...(metrics.includes('ratingCount')?{ratingCount:Number(row.rating_count)}:{}),...(metrics.includes('averagePersonalRating')?{averagePersonalRating:number(row.average_personal_rating)}:{}),...(metrics.includes('ratedCount')?{ratedCount:Number(row.rated_count??0)}:{})}));
    return {members:[],value:{schemaVersion:1,kind:'local_aggregate',entity:args.entity,snapshotId:this.scope.snapshotId,data,fields:['group',...metrics],availableFields:['group','count','averageScore','ratingCount',...(this.accountSource?['averagePersonalRating','ratedCount']:[])],page:page({...args,limit},this.scope,total,offset,data.length),coverage:coverage(db,where,this.entities,Boolean(this.accountSource))}};
  }
  read(members:QueryResult['members'],fields:readonly string[]|'all'):Row[]{
    const db=this.snapshot.db,result:Row[]=[];
    for(const member of members){
      const wanted=fields==='all'?this.fields(member.entity):fields;
      if(wanted.some(field=>!this.fields(member.entity).includes(field)))throw new AppError('INVALID_INPUT','请求字段不适用于此实体类型。');
      if(wanted.length===0){result.push({entity:member.entity,id:member.id});continue;}
      const row=db.prepare(`SELECT * FROM ${this.entities} e WHERE kind=? AND id=?${this.scope.nsfw==='exclude'?` AND (${sfwForKind(member.entity)})`:''}`).get(member.entity,member.id);
      if(!row)throw new AppError('RESOURCE_VERSION_CHANGED','引用成员在绑定快照中不可读。');
      const needsRaw=wanted.some(field=>['totalEpisodes','totalVolumes','disc','duration','infoboxRaw','career','comments','collects','collectionCounts','series'].includes(field));
      const raw=needsRaw?record(json(row.raw_json)):{},values:Row={entity:member.entity,id:member.id};
      // 默认读取身份不用解析正文；SQLite完整记录始终只在进程内。
      const full:Row={name:row.name,nameCn:text(row.name_cn),summary:text(row.summary),date:row.date??null,year:row.year??null,nsfw:Boolean(row.nsfw),url:`https://bgm.tv/${member.entity==='episode'?'ep':member.entity}/${member.id}`,...member.extra};
      if(member.entity==='subject'&&this.accountSource){
        const visible=row.ac_record_state==='visible',state=visible?'collected':row.ac_subject_id!=null||(!this.accountSource.allowNsfw&&row.nsfw!==0)?'unknown':'not_collected';
        Object.assign(full,{collectionState:state,collectionType:visible?row.ac_collection_type:null,personalRating:visible?row.ac_personal_rating:null,personalComment:visible?row.ac_comment:null,collectionPrivate:visible?Boolean(row.ac_is_private):null,epStatus:visible?row.ac_ep_status:null,volStatus:visible?row.ac_vol_status:null,collectionUpdatedAt:visible?row.ac_source_updated_at:null});
        if(wanted.includes('personalTags'))full.personalTags=visible?db.prepare(`SELECT tag FROM ${this.scope.accountSchema}.collection_tags WHERE subject_id=? ORDER BY position,tag`).all(member.id).map(row=>String(row.tag)):null;
      }
      if(member.entity==='subject'){
        const infobox=json(row.infobox_json),wikiNumber=(names:string[]):number|null=>{
          if(!Array.isArray(infobox))return null;
          for(const entry of infobox){const item=record(entry);if(!names.includes(String(item.key))||typeof item.value!=='string')continue;const matched=/^(\d+)(?:话|話|集|册|冊|卷|巻)?$/u.exec(item.value.normalize('NFKC').trim());if(matched&&Number.isSafeInteger(Number(matched[1])))return Number(matched[1]);}return null;
        };
        const favorite=record(raw.favorite);
        Object.assign(full,{subjectType:row.subject_type??null,platform:row.platform==null?null:platformLabel(number(row.subject_type),number(row.platform)),score:row.score??null,rank:row.rank??null,ratingCount:row.rating_total??null,totalEpisodes:number(raw.eps??raw.total_episodes)??wikiNumber(['话数','話数','集数']),totalVolumes:number(raw.volumes)??wikiNumber(['册数','冊数','卷数','巻数']),series:typeof raw.series==='boolean'?raw.series:null,collectionCounts:Object.keys(favorite).length?Object.fromEntries(['wish','done','doing','on_hold','dropped'].map(key=>[key,number(favorite[key])])):null});
      }
      if(member.entity==='person')full.personType=row.entity_type??null;
      if(member.entity==='character')full.characterType=row.entity_type??null;
      if(member.entity==='person'||member.entity==='character')Object.assign(full,{comments:number(raw.comments),collects:number(raw.collects),...(member.entity==='person'?{career:Array.isArray(raw.career)?raw.career.filter(item=>typeof item==='string'):null}:{})});
      if(member.entity==='episode')Object.assign(full,{episodeType:row.entity_type??null,subjectId:row.subject_id??null,sort:row.sort??null,disc:number(raw.disc),airDate:row.date??null,duration:text(raw.duration)});
      if(wanted.some(field=>['tags','metaTags','tagStats'].includes(field))){
        const tags=db.prepare('SELECT name,count,source FROM tags WHERE kind=? AND entity_id=? ORDER BY coalesce(count,0) DESC,name').all(member.entity,member.id);
        full.tags=tags.filter(tag=>tag.source!=='meta').map(tag=>String(tag.name));full.metaTags=tags.filter(tag=>tag.source==='meta').map(tag=>String(tag.name));
        full.tagStats=tags.filter(tag=>tag.source!=='meta').map(tag=>({name:String(tag.name),count:tag.count??null,totalCount:null}));
      }
      if(wanted.includes('aliases'))full.aliases=db.prepare('SELECT alias FROM aliases WHERE kind=? AND entity_id=? ORDER BY alias').all(member.entity,member.id).map(row=>String(row.alias));
      if(wanted.includes('infobox'))full.infobox=row.infobox_status==='failed'?null:json(row.infobox_json);
      if(wanted.includes('infoboxRaw'))full.infoboxRaw=text(raw.infobox);
      if(wanted.includes('ratingDistribution')){
        const scores=db.prepare('SELECT score,count FROM subject_scores WHERE subject_id=?').all(member.id);
        full.ratingDistribution=scores.length?Object.fromEntries(Array.from({length:10},(_,i)=>[String(i+1),Number(scores.find(score=>Number(score.score)===i+1)?.count??0)])):null;
      }
      if(row.ac_archive_missing===1)for(const field of ['tags','metaTags','tagStats','aliases','infobox'])full[field]=null;
      for(const field of wanted)if(field!=='fieldStates')values[field]=full[field]??null;
      if(wanted.includes('fieldStates')||fields==='all')values.fieldStates=Object.fromEntries(wanted.filter(field=>field!=='fieldStates').map(field=>[field,field==='infobox'&&row.infobox_status==='failed'?'failed':full[field]==null?'unknown':'known']));
      result.push(values);
    }
    return result;
  }
}
