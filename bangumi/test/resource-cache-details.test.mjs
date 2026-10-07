import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStore } from '../dist/src/mcp/resource-store.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { prepareModelToolArguments } from '../dist/src/mcp/pi-tools.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, findToolDefinition, validateToolArguments } from '../dist/src/mcp/catalog.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';

const context = { turnId: 'resource-detail-test' };
const call = (service, name, args) => service.call(name, args, undefined, undefined, undefined, context);

test('Pi公开prepare参数不带内部include默认，二次schema校验通过且显式隐藏字段拒绝', () => {
  const args = prepareModelToolArguments('get_subject_details', { subject_id: 1, fields: ['summary'] });
  assert.equal(Object.hasOwn(args, 'include'), false);
  assert.deepEqual(schemaArguments(findToolDefinition('get_subject_details').modelInputSchema, args), args);
  assert.throws(() => prepareModelToolArguments('get_subject_details', { subject_id: 1, include: ['summary'] }), { code: 'INVALID_INPUT' });
});

test('缓存引用固定副本、跨轮拒绝、定向清理不影响其他轮次', () => {
  const store = new ResourceStore();
  const value = { id: 1, name: '冻结名称' };
  const ref = store.put('get_subject_details', value, { rawSecret: '仅后端' }, 'turn-a', anonymousContext());
  const other = store.put('get_subject_details', { id: 2 }, {}, 'turn-b', anonymousContext());
  value.name = '外部改变';
  const read = store.get(ref, 'turn-a'); read.value.name = '返回副本改变';
  assert.equal(store.get(ref, 'turn-a').value.name, '冻结名称');
  assert.equal(JSON.stringify(read).includes('rawSecret'), false);
  assert.throws(() => store.get(ref, 'turn-b'), { code: 'RESOURCE_SCOPE_MISMATCH' });
  store.clear('turn-a');
  assert.throws(() => store.get(ref, 'turn-a'), { code: 'RESOURCE_EXPIRED' });
  assert.equal(store.get(other, 'turn-b').value.id, 2);
});

test('fields读取完整已取得简介且Unicode分段不拆代理对，零额外API', async t => {
  let requests = 0;
  const summary = '作品🌟剧情尾声';
  const service = new BangumiMcpService({ close: async () => {}, public: async () => {
    requests++; return { id: 1, type: 2, name: '作品', name_cn: '', nsfw: false, tags: [], meta_tags: [], summary, infobox: [] };
  } });
  t.after(() => service.close());
  const value = await call(service, 'get_subject_details', { subject_id: 1, include: [] });
  assert.equal(value.summary, undefined);
  const fields = await call(service, 'read_cached_resource', { resource_ref: value.resourceRef, fields: ['summary'], range: { offset: 2, limit: 3 } });
  assert.equal(fields.value.summary, '🌟剧情');
  assert.deepEqual(fields.range, { offset: 2, limit: 3, total: 7, nextOffset: 5, complete: false });
  assert.equal(requests, 1);
});

test('账户核实后读取的公开profile缓存精确匹配用户路径，不能误取最后/me', async t => {
  const account = { id: 42, username: 'reader' };
  const access = { ...anonymousContext(), mode: 'account', source: 'p1', account };
  const requests = [];
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => access,
    currentUser: async () => account,
    public: async path => { requests.push(path); return { ...account, nickname: '公开资料', sign: '完整签名正文', user_group: 10,
      avatar: { large: 'https://lain.bgm.tv/pic/l.jpg', medium: 'https://lain.bgm.tv/pic/m.jpg', small: 'https://lain.bgm.tv/pic/s.jpg' } }; },
    account: async path => { requests.push(path); return path==='/p1/users/reader'?{...account,nickname:'公开资料',sign:'完整签名正文',group:10,avatar:{large:'https://lain.bgm.tv/pic/l.jpg',medium:'https://lain.bgm.tv/pic/m.jpg',small:'https://lain.bgm.tv/pic/s.jpg'}}:{ ...account, nickname: '账户核实' }; }
  });
  t.after(() => service.close());
  const value = await call(service, 'get_user_info', { username: '-', include: [] });
  const full = await service.readCachedResource(value.resourceRef, context);
  assert.equal(full.value.sign, '完整签名正文');
  assert.deepEqual(requests, ['/p1/users/reader']);
});

test('缓存NSFW引用绑定已核实范围，本地permission改变后拒绝旧引用', async t => {
  const account = { id: 42, username: 'reader' };
  let allowed = true;
  const access = () => ({ ...anonymousContext(), mode: 'account', source: 'p1', account, nsfwApplied: allowed,
    nsfw: { state: allowed ? 'enabled' : 'disabled', preference: allowed, allowed } });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => access(), currentUser: async () => account,
    ensureNsfw: async () => access() });
  t.after(() => service.close());
  const value = await call(service, 'get_current_user', { check_nsfw: true });
  allowed = false;
  await assert.rejects(service.readCachedResource(value.resourceRef, context), { code: 'NSFW_SCOPE_CHANGED' });
});

test('所有工具公开目录通过MCP SDK元数据校验，缓存keys只允许必要主键',()=>{
  for(const definition of TOOL_DEFINITIONS){
    assert.ok(ToolSchema.safeParse(definition).success,definition.name);
    assert.equal(definition.outputSchema.type,'object',definition.name);
  }
  assert.throws(()=>validateToolArguments('read_cached_resource',{resource_ref:'rr_'+ 'a'.repeat(32),keys:[{summary:'禁止按未请求正文推断'}]}),{code:'INVALID_INPUT'});
});

test('长社区正文默认按5000字符续读，尾段不能宣称全文且后端快照保持完整',async t=>{
  let requests=0;const body='正文🌟'.repeat(3000);
  const service=new BangumiMcpService({close:async()=>{},community:async()=>{
    requests++;return {id:321,public:true,uid:1,user:{id:1,username:'reader',nickname:'读者'},title:'日志',createdAt:1700000000,updatedAt:1700000000,replies:0,content:body};
  }});
  t.after(()=>service.close());
  const base=await call(service,'get_blog_details',{blog_id:321,include:[]});
  const first=await call(service,'read_cached_resource',{resource_ref:base.resourceRef,fields:['content']});
  assert.equal(Array.from(first.value.content.text).length,5000);
  assert.equal(first.value.content.isFullText,false);
  assert.equal(first.range.nextOffset,5000);
  const tail=await call(service,'read_cached_resource',{resource_ref:base.resourceRef,fields:['content'],range:{offset:5000,limit:5000}});
  assert.equal(tail.range.complete,true);assert.equal(tail.value.content.isFullText,false);
  assert.equal(tail.value.content.range.totalChars,9000);
  const full=await service.readCachedResource(base.resourceRef,context);
  assert.equal(full.value.content.text,body);assert.equal(full.value.content.isFullText,true);
  assert.equal(requests,1);
});

test('仅核实同账户identity不会把not_checked当作撤销已核实NSFW缓存范围',async t=>{
  const account={id:42,username:'reader'};
  const identity=()=>({...anonymousContext(),mode:'account',source:'p1',account});
  const enabled=()=>({...identity(),nsfwApplied:true,nsfw:{state:'enabled',preference:true,allowed:true}});
  const service=new BangumiMcpService({close:async()=>{},identity:async()=>identity(),currentUser:async()=>account,ensureNsfw:async()=>enabled()});
  t.after(()=>service.close());
  const checked=await call(service,'get_current_user',{check_nsfw:true});
  await call(service,'get_current_user',{});
  const cached=await service.readCachedResource(checked.resourceRef,context);
  assert.equal(cached.accessContext.nsfw.state,'enabled');
});

test('人物职业和其他数组事实可从缓存读取，窗口检测不把数组当资源对象',async t=>{
  let requests=0;
  const service=new BangumiMcpService({close:async()=>{},public:async()=>{
    requests++;return {id:1,name:'人物',type:1,career:['seiyu'],summary:'人物简介',infobox:[],nsfw:false};
  }});
  t.after(()=>service.close());
  const person=await call(service,'get_person_details',{person_id:1,include:[]});
  const facts=await call(service,'read_cached_resource',{resource_ref:person.resourceRef,fields:['id','career','name']});
  assert.deepEqual(facts.value.career,['seiyu']);assert.equal(facts.fieldStates.career,'known');assert.equal(requests,1);
});
