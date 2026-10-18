import { AppError, SchemaInputError, type InputIssue } from '../support/errors.js';
import { compileSchema, inputIssue, schemaArguments, type JsonSchema } from '../support/tool-schema.js';
import { accessContextSchema } from './access-context.js';
import { cachedResourceInputSchema, RESOURCE_REF_PATTERN } from './resource-contract.js';
import { registerResourcePolicy } from './resource-policy.js';
import { LOCAL_ENTITY_KINDS, ENTITY_FIELDS, PERSONAL_FIELDS, entityFields, fieldsSchema, localFilterSchema, localEntitySchema, localPageSchema, closed, integer, nullable } from './local-contract.js';

export interface McpToolDefinition {
  name: string; description: string; inputSchema: JsonSchema; outputSchema?: JsonSchema;
  modelOutputSchema?: JsonSchema; modelInputSchema?: JsonSchema; access: 'public'|'account'|'conditional'; effect: 'read'|'write';
}
// 仅供未装配的旧适配模块编译；不登记成业务工具。
export const BROWSE_CATEGORIES: Readonly<Record<number,readonly number[]>> = {1:[0,1001,1002,1003],2:[0,1,2,3,5],3:[0],4:[0,4001,4002,4003,4005],6:[0,1,2,3,6001,6002,6003,6004]};
const entity: JsonSchema = {type:'string',enum:LOCAL_ENTITY_KINDS};
const dataScope:JsonSchema={type:'string',enum:['public','self'],default:'public',description:'public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。'};
const keyword: JsonSchema = {type:'string',maxLength:300,description:'原文关键词。name检索名称与别名；fulltext检索名称、别名和简介，不解释为语义推荐。'};
const nsfw:JsonSchema={type:'string',enum:['exclude','include'],description:'仅为本地资料显示范围，不涉及账户权限。本轮首次省略为exclude，后续省略继承本轮范围；本轮内不能显式改变，换轮次重新查询。'};
const paging = {limit:{...integer(1,100),default:30},cursor:{type:'string',maxLength:2000,description:'上一页nextCursor；绑定条件、数据版本和显示范围，不手工构造。'}};
const coverage = closed({scope:{enum:['archive_snapshot','account_snapshot']},complete:{type:'boolean'},totalKind:{const:'exact'},unknownCount:integer(),limitations:{type:'array',items:{type:'string'}}},['scope','complete','totalKind','unknownCount','limitations']);
const aggregateRow = closed({entity:{const:'aggregate'},id:integer(1),group:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]},count:integer(),averageScore:nullable({type:'number'}),ratingCount:integer(),averagePersonalRating:nullable({type:'number'}),ratedCount:integer()},['entity','id','group','count']);
const response = closed({
  schemaVersion:{const:1},kind:{enum:['local_query','local_entities','local_relations','local_aggregate','dataset_status']},
  entity,resourceRef:{type:'string',pattern:RESOURCE_REF_PATTERN},snapshotId:{type:'string'},
  data:{type:'array',maxItems:200,items:{anyOf:[localEntitySchema,aggregateRow]}},
  fields:{type:'array',items:{type:'string'}},availableFields:{type:'array',items:{type:'string'}},
  page:localPageSchema,coverage,accessContext:accessContextSchema,
  requestedIds:{type:'array',items:integer(1)},missingIds:{type:'array',items:integer(1)},
  dataset:{type:'object'},readAt:{type:'string'},
},['schemaVersion','kind','snapshotId','accessContext']);
const cached = closed({schemaVersion:{const:1},kind:{const:'cached_resource'},resourceRef:{type:'string',pattern:RESOURCE_REF_PATTERN},sourceTool:{type:'string'},value:response,accessContext:accessContextSchema,fields:{type:'array',items:{type:'string'}},range:{type:'object'},fieldStates:{type:'object'}},['schemaVersion','kind','resourceRef','sourceTool','value','accessContext']);
const error = closed({code:{type:'string'},message:{type:'string'},networkAttempted:{const:false},issues:{type:'array',items:{type:'object'}},sourceTool:{type:'string'},diagnosis:{type:'object'},diagnostic:{type:'object'},accessContext:accessContextSchema},['code','message']);
const envelope = (value:JsonSchema):JsonSchema => ({type:'object',oneOf:[closed({value},['value']),closed({error},['error'])]});
const definitions: McpToolDefinition[] = [];
function tool(name:string,description:string,properties:Record<string,JsonSchema>,required:string[]):void {
  const inputSchema=closed(properties,required),outputSchema=envelope(name==='read_cached_resource'?cached:response);
  definitions.push({name,description,inputSchema,modelInputSchema:structuredClone(inputSchema),outputSchema,modelOutputSchema:structuredClone(outputSchema),access:'conditional',effect:'read'});
}
tool('query_entities','查询本地Archive中的作品、人物、角色或章节：名称/别名、全文、精确筛选、稳定排序和分页。五类作品均可查询，允许无关键词浏览。self可按本人收藏条件筛选已同步快照。默认仅身份与resourceRef；其他资料用fields请求。总数仅代表当前快照与显示范围，全文不是向量语义检索。',{
  entity,keyword,nsfw,data_scope:dataScope,match:{type:'string',enum:['name','fulltext'],default:'name'},filter:localFilterSchema,
  sort:{type:'string',enum:['id','name','date_asc','date_desc','score','rank','rating_count','match','personal_rating_desc','personal_rating_asc','collection_updated_desc','collection_updated_asc'],default:'match'},...paging,fields:fieldsSchema,
},['entity']);
tool('get_entities','按实体类型与明确ID批量读取本地资料。返回缺失ID；不将缺失解释成网站实时不存在。省略fields仅返回身份和资源引用，宿主可直接据引用补全展示。',{
  entity,nsfw,data_scope:dataScope,ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:integer(1)},fields:fieldsSchema,
},['entity','ids']);
tool('query_relations','本地关系表查询制作、作品关联、角色出演、配音与人物关系；后端按目标实体去重、过滤和分页。page.total是去重后的目标实体数，不是原始关系边数；同一人物多个职务保留在该行relations字段，不能把99个人写成99条关系。person→subject可经配音角色关联作品，appearance_role进一步限定该角色在对应作品中的主役(1)/配角(2)/客串(3)，不会把参加作品当成主役。relation_types使用Archive关系码，不能跨关系域混用。',{
  source:closed({entity,id:integer(1)},['entity','id']),target_entity:entity,nsfw,data_scope:dataScope,
  direction:{type:'string',enum:['outgoing','incoming','both'],default:'both'},
  relation_types:{type:'array',minItems:1,maxItems:50,uniqueItems:true,items:integer()},appearance_role:integer(1,3),filter:localFilterSchema,...paging,fields:fieldsSchema,
},['source']);
tool('aggregate_entities','对完整本地匹配集合执行统计，支持类型、年份、形式、标签、评分分组，计算条数/平均评分/评分人数。不会用返回页代替全集。self可按个人收藏状态、评分、标签分组；个人平均分排除未评分0。标签来自Archive部分标签，分组计数不代表完整题材覆盖。',{
  entity,keyword,nsfw,data_scope:dataScope,match:{type:'string',enum:['name','fulltext'],default:'name'},filter:localFilterSchema,
  group_by:{type:'string',enum:['subjectType','year','platform','tag','score','nsfw','collectionType','personalRating','personalTag']},
  metrics:{type:'array',minItems:1,maxItems:5,uniqueItems:true,items:{type:'string',enum:['count','averageScore','ratingCount','averagePersonalRating','ratedCount']},default:['count']},...paging,limit:{...integer(1,100),default:100},
},['entity']);
tool('read_cached_resource','按已有resource_ref读取当前任务、同一快照和显示范围内的字段。keys只能选原引用成员，fields为白名单；SQLite按需补读，不扩展成员、不联网。长文本range按字符分段，每次最多5000字符。',cachedResourceInputSchema.properties as Record<string,JsonSchema>,['resource_ref']);
tool('get_dataset_status','读取本地数据版本、Archive来源时间、导入质量和全文状态；个人库仅在Web启动或宿主显式同步时更新，读取状态不会同步。',{data_scope:dataScope},[]);

for(const definition of definitions){
  registerResourcePolicy(definition.name,definition.outputSchema!,definition.inputSchema);
  compileSchema(definition.inputSchema);compileSchema(definition.outputSchema!);
}
export const TOOL_DEFINITIONS:readonly McpToolDefinition[]=definitions;
export function findToolDefinition(name:string):McpToolDefinition{
  const definition=TOOL_DEFINITIONS.find(item=>item.name===name);
  if(!definition)throw new AppError('UNKNOWN_TOOL','未登记的本地只读MCP工具。');
  return definition;
}
export function validateToolArguments(name:string,value:unknown):Record<string,unknown>{
  const result=schemaArguments(findToolDefinition(name).inputSchema,value);
  const kind=(result.entity??(name==='query_relations'?result.target_entity:undefined)) as keyof typeof ENTITY_FIELDS|undefined;
  const self=result.data_scope==='self',personalFilter=(result.filter as Record<string,unknown>|undefined)?.collection;
  const personalUse=personalFilter!==undefined||(Array.isArray(result.fields)&&result.fields.some(field=>(PERSONAL_FIELDS as readonly string[]).includes(String(field))))||String(result.sort??'').startsWith('personal_')||String(result.sort??'').startsWith('collection_')||['collectionType','personalRating','personalTag'].includes(String(result.group_by))||(Array.isArray(result.metrics)&&result.metrics.some(metric=>['averagePersonalRating','ratedCount'].includes(String(metric))));
  if(name!=='read_cached_resource'&&personalUse&&!self)throw new AppError('INVALID_INPUT','个人字段、筛选、排序和统计需要data_scope=self。');
  if(self&&name!=='get_dataset_status'&&kind!=='subject')throw new AppError('INVALID_INPUT','本人收藏范围仅支持subject条目，关系查询须明确target_entity=subject。');
  if(kind&&Array.isArray(result.fields)&&result.fields.some(field=>!entityFields(kind,self).includes(String(field))))throw new AppError('INVALID_INPUT','请求字段不适用于此实体类型。');
  const filter=result.filter as Record<string,unknown>|undefined;
  for(const [key,range] of Object.entries(filter??{})){
    if(range&&typeof range==='object'&&!Array.isArray(range)){
      const bounds=range as {min?:number|string;max?:number|string};
      if(bounds.min!==undefined&&bounds.max!==undefined&&bounds.min>bounds.max)throw new AppError('INVALID_INPUT','筛选下界不能大于上界。');
      if(key==='date')for(const date of [bounds.min,bounds.max])if(typeof date==='string'){
        const parsed=new Date(`${date}T00:00:00.000Z`);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new AppError('INVALID_INPUT','日期必须为实际存在的YYYY-MM-DD。');
      }
    }
  }
  if(personalFilter&&typeof personalFilter==='object')for(const key of ['rating','updated_at']){const range=(personalFilter as Record<string,unknown>)[key] as {min?:number;max?:number}|undefined;if(range?.min!==undefined&&range.max!==undefined&&range.min>range.max)throw new AppError('INVALID_INPUT','个人筛选下界不能大于上界。');}
  if(personalFilter&&typeof personalFilter==='object'){
    const collection=personalFilter as Record<string,unknown>,rating=collection.rating as {min?:number;max?:number}|undefined;
    if(collection.membership==='not_collected'&&Object.keys(collection).some(key=>key!=='membership'))throw new AppError('INVALID_INPUT','未收藏不能同时限定已有收藏记录的状态、评分、标签、私密标记或更新时间。');
    if((collection.rated===true&&rating?.max===0)||(collection.rated===false&&Number(rating?.min??0)>0))throw new AppError('INVALID_INPUT','rated与个人评分范围冲突：未评分仅为0，已评分为1至10。');
    if(Array.isArray(collection.types)&&Array.isArray(collection.exclude_types)&&collection.types.every(type=>(collection.exclude_types as unknown[]).includes(type)))throw new AppError('INVALID_INPUT','收藏状态集合已被exclude_types全部排除。');
  }
  if(kind&&filter){
    if(kind!=='subject'&&['subject_type','score','rank','rating_count','platform','tags'].some(key=>Object.hasOwn(filter,key)))throw new AppError('INVALID_INPUT','此筛选字段仅适用于作品。');
    if(kind!=='episode'&&['subject_id','episode_type'].some(key=>Object.hasOwn(filter,key)))throw new AppError('INVALID_INPUT','章节所属作品与章节类型筛选仅适用于章节。');
    if(kind!=='person'&&filter.career!==undefined)throw new AppError('INVALID_INPUT','职业筛选仅适用于人物。');
    if(!['subject','episode'].includes(kind)&&['date','year'].some(key=>Object.hasOwn(filter,key)))throw new AppError('INVALID_INPUT','日期筛选仅表示作品发行/开播或章节放送日期。');
  }
  return result;
}
/** 保留旧诊断模块的类型入口；远端反馈只能引用当前目录的固定字段。 */
export function remoteInputError(name:string,args:Record<string,unknown>,value:unknown):SchemaInputError|null{
  if(!Array.isArray(value)||value.length>8)return null;
  const schema=findToolDefinition(name).inputSchema,issues:InputIssue[]=[];
  for(const raw of value){if(!raw||typeof raw!=='object')return null;const {path,rule}=raw as Record<string,unknown>;if(typeof path!=='string'||typeof rule!=='string')return null;const issue=inputIssue(schema,path,rule);if(!issue)return null;issues.push(issue);}
  return issues.length?new SchemaInputError(issues):null;
}
