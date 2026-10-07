import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools,prepareModelToolArguments } from '../dist/src/mcp/pi-tools.js';

const context={turnId:'field-path-audit'};
const subject=id=>({id,type:2,name:`作品${id}`,name_cn:`中文${id}`,nsfw:false,platform:'TV',date:'2026-01-01',rating:{score:8,total:10,rank:1},tags:[],meta_tags:[]});
function toolsFor(service){return createReadTools({call:(name,args,signal)=>service.call(name,args,signal,undefined,undefined,context),readCachedResource:(ref,signal)=>service.readCachedResource(ref,context,signal)});}
async function invoke(tools,name,args){const result=await tools.find(tool=>tool.name===name).execute('field_path',args,undefined,undefined,{});assert.notEqual(result.isError,true,JSON.stringify(result.content));return JSON.parse(result.content[0].text).value;}

test('API收藏DTO的collection容器仅递归必要身份和显式个人事实',async t=>{
 let requests=0;const service=new BangumiMcpService({close:async()=>{},public:async()=>{requests++;return {subject_id:1,subject_type:1,type:2,rate:8,private:false,comment:'未请求个人评论',tags:[],ep_status:3,vol_status:1};}});
 t.after(()=>service.close());const tools=toolsFor(service);
 const value=await invoke(tools,'get_user_subject_collection',{username:'reader',subject_id:1,fields:['collectionStatus','personalRating','chapters']});
 assert.equal(value.collection.collectionStatus,2);assert.equal(value.collection.personalRating,8);assert.equal(value.collection.chapters,3);
 assert.equal(JSON.stringify(value).includes('未请求个人评论'),false);assert.equal(requests,1);
});

for(const entity of ['person','character'])test(`${entity}收藏容器可显式读取嵌套名称与收藏时间`,async t=>{
 let requests=0;const service=new BangumiMcpService({close:async()=>{},public:async()=>{requests++;return {id:1,name:'实体名称',type:1,nsfw:false,created_at:'2026-01-01T00:00:00Z'};}});
 t.after(()=>service.close());const tools=toolsFor(service);
 const value=await invoke(tools,`get_user_${entity}_collection`,{username:'reader',[`${entity}_id`]:1,fields:['name','createdAt']});
 assert.equal(value.collection.target.name,'实体名称');assert.equal(value.collection.createdAt,'2026-01-01T00:00:00.000Z');assert.equal(requests,1);
});

test('候选资源缓存fields形成合法CandidateView，不把内部known状态搬给模型',async t=>{
 let requests=0;const service=new BangumiMcpService({close:async()=>{},public:async()=>{requests++;return {data:[subject(1),subject(2)],total:2};}});
 t.after(()=>service.close());const tools=toolsFor(service);
 const source=await invoke(tools,'search_subjects',{keyword:'作品',subject_type:2,result_mode:'candidates',limit:2});
 const cached=await invoke(tools,'read_cached_resource',{resource_ref:source.resourceRef,fields:['name','nameCn','score','date','subjectType']});
 assert.equal(cached.value.data[0].name,'作品1');assert.equal(cached.value.data[0].score,8);
 assert.ok(!cached.value.data[0].fieldStates||Object.values(cached.value.data[0].fieldStates).every(state=>state!=='known'));
 assert.equal(cached.fieldStates.name,'known');assert.equal(requests,1);
});

test('人物出演普通模式fields支持subjectFacts/ownCollection，候选模式仍拒绝分组字段',()=>{
 const prepared=prepareModelToolArguments('get_person_characters',{person_id:71,fields:['subjectFacts','ownCollection']});
 assert.deepEqual(prepared.fields,['subjectFacts','ownCollection']);assert.equal(prepared.include,undefined);
 assert.throws(()=>prepareModelToolArguments('get_person_characters',{person_id:71,result_mode:'candidates',fields:['ownCollection']}),{code:'INVALID_INPUT'});
});

test('显式正文续读工具直接交付所请求的缓存片段，不再次折叠丢正文',async t=>{
 let requests=0;const service=new BangumiMcpService({close:async()=>{},community:async()=>{requests++;return {id:321,public:true,uid:1,user:{id:1,username:'reader',nickname:'读者'},title:'日志',createdAt:1700000000,updatedAt:1700000000,replies:0,content:'完整正文🌟后续段落'};}});
 t.after(()=>service.close());const tools=toolsFor(service);
 const source=await invoke(tools,'get_blog_details',{blog_id:321,fields:['content']});
 const content=await invoke(tools,'read_community_content',{content_ref:source.content.contentRef,offset:2,limit:3});
 assert.equal(content.content.text,'正文🌟');assert.equal(content.content.isFullText,false);assert.equal(requests,1);
});

test('reference快照没有成员窗口时字段状态为unknown，不对空数组假报known',async t=>{
 let requests=0;const service=new BangumiMcpService({close:async()=>{},public:async()=>{requests++;return {data:[subject(1),subject(2)],total:2};}});
 t.after(()=>service.close());const tools=toolsFor(service);
 const source=await invoke(tools,'search_subjects',{keyword:'作品',subject_type:2,result_mode:'candidates',response_view:'reference',limit:2});
 assert.deepEqual(source.data,[]);assert.equal(source.set.resultCount,2);
 const cached=await invoke(tools,'read_cached_resource',{resource_ref:source.resourceRef,fields:['name','score']});
 assert.deepEqual(cached.value.data,[]);assert.equal(cached.fieldStates.name,'unknown');assert.equal(cached.fieldStates.score,'unknown');assert.equal(requests,1);
});
