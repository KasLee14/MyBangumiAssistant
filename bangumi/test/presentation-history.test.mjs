import assert from 'node:assert/strict';
import test from 'node:test';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { convertMessages } from '@earendil-works/pi-ai/api/openai-completions';
import { bindPresentationHistory, inspectPresentationHistory, projectTranscriptForModel } from '../dist/src/output/model-context.js';
import { projectPresentationContent } from '../dist/src/output/presentation-history.js';
import { deriveNextTypes } from '../dist/src/output/content-normalize.js';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model = { api: 'openai-responses', provider: 'openai', id: 'history-model', name: 'history-model', reasoning: true,
  input: ['text'], baseUrl: 'https://example.invalid/v1', contextWindow: 4096, maxTokens: 1000, cost: usage.cost };
const roles = new Map([['render_Gallery','presentation'],['prepare_Gallery','presentation'],['render_Callout','presentation'],
  ['render_SubjectCards','presentation'],['present_text','presentation'],['present_component','presentation'],['read_component_spec','definition']]);
const marker = (replyId = 'reply', turnId = 'turn') => ({ type: 'bangumi_presentation_source', timestamp: 0, details: { replyId, turnId } });
const assistant = (content, timestamp, options = {}) => ({ ...model, role: 'assistant', model: model.id, usage, timestamp,
  diagnostics: [marker(options.replyId, options.turnId)], stopReason: options.stopReason ?? 'toolUse', content, ...options });
const call = (id, name, args, extra = {}) => ({ type: 'toolCall', id, name, arguments: args, ...extra });
const result = (id, name, value, options = {}) => ({ role: 'toolResult', toolCallId: id, toolName: name, timestamp: 100,
  isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], ...options });
const text = value => ({ type: 'text', text: value, nextType: null });
const user = value => ({ role: 'user', content: value, timestamp: 0 });
const snapshot = (content, options = {}) => ({ version: 1, replyId: 'reply', turnId: 'turn', status: 'completed', content: deriveNextTypes(content), ...options });
const gallery = { type: 'Gallery', pending: false, props: { title: '可见标题', items: [
  { id: 2, name: '乙人物', subtitle: '真实可见说明', image: 'https://example.invalid/private-image', url: 'https://example.invalid/private-url' },
  { id: 1, name: '甲人物' },
] } };
function project(messages, snapshots, options = {}) {
  const context = { messages }, before = structuredClone(context), saved = structuredClone(snapshots);
  bindPresentationHistory(context, snapshots, { sourceMessages: messages.filter(row => row.role === 'assistant'), sourceTranscript: messages, model, toolRoles: roles, ...options });
  const projected = projectTranscriptForModel(context, options.resolver);
  assert.deepEqual(context, before, '模型投影不得修改原生审计消息');
  assert.deepEqual(snapshots, saved, '模型投影不得修改canonical快照');
  return projected;
}
const summaries = context => context.messages.flatMap(row => row.role === 'assistant' ? row.content : [])
  .filter(part => part.type === 'text' && part.text.startsWith('历史已展示回答摘要'));
const summaryContent = part => JSON.parse(part.text.slice(part.text.indexOf('：') + 1));
const calls = context => context.messages.flatMap(row => row.role === 'assistant' ? row.content.filter(part => part.type === 'toolCall') : []);
function assertWirePairs(context, selectedModel = model) {
  const wire = selectedModel.api === 'openai-responses' ? convertResponsesMessages(selectedModel, context, new Set(['openai']))
    : convertMessages(selectedModel, context, { supportsStrictMode: true, supportsMidConvoSystemMessages: true, supportsDeveloperRole: true });
  const proposed = selectedModel.api === 'openai-responses' ? wire.filter(row => row.type === 'function_call').map(row => row.call_id)
    : wire.flatMap(row => row.tool_calls?.map(call => call.id) ?? []);
  const completed = selectedModel.api === 'openai-responses' ? wire.filter(row => row.type === 'function_call_output').map(row => row.call_id)
    : wire.filter(row => row.role === 'tool').map(row => row.tool_call_id);
  assert.deepEqual(completed, proposed, '实际provider编码不得产生孤立结果或伪造缺失结果');
  assert.equal(JSON.stringify(wire).includes('No result provided'), false);
  return wire;
}
function resolveWireSource(wire, source, api) {
  if (source.kind === 'tool_arguments') {
    const functions = api === 'openai-responses' ? wire.filter(row=>row.type==='function_call').map(row=>({name:row.name,args:row.arguments}))
      : wire.flatMap(row=>row.tool_calls?.filter(call=>call.type==='function').map(call=>({name:call.function.name,args:call.function.arguments}))??[]);
    let value = JSON.parse(functions.filter(row=>row.name===source.toolName)[source.occurrence-1].args);
    for(const token of source.argumentPointer.split('/').slice(1)) value=value[token];
    return value;
  }
  let userOrdinal=0, response=0, item=0;
  for(const row of wire) {
    if(row.role==='user') {userOrdinal++;response=0;item=0;continue;}
    if(row.role!=='assistant'||userOrdinal!==source.afterUser) continue;
    if(api==='openai-responses'&&row.type!=='message') continue;
    const text=typeof row.content==='string'?row.content:(row.content??[]).filter(part=>part.type==='text'||part.type==='output_text').map(part=>part.text).join('');
    response++; item++;
    if((api==='openai-responses'?item===source.assistantTextItem:response===source.assistantResponse)) return text.slice(source.start,source.start+source.length);
  }
  assert.fail(`来源无法在实际wire定位：${JSON.stringify(source)}`);
}

test('已完成原生文字和成对展示操作只留一个按展示顺序的语义副本', () => {
  const messages = [user('展示'), assistant([text('未进入正文的过程'), call('one','present_text',{ text: '唯一前言' })],1),
    result('one','present_text',{ replyId: 'reply', blockIndex: 0 }),
    assistant([call('two','render_Gallery',{ resourceRef: 'rr_input', before: '组件前说明', after: '组件后说明', final: true })],2),
    result('two','render_Gallery',{ replyId: 'reply', blockIndex: 1 }),
    assistant([text('唯一结语')],3,{ stopReason: 'stop' }), user('第二位叫什么')];
  const projected = project(messages,[snapshot([text('唯一前言'),text('组件前说明'),gallery,text('组件后说明'),text('唯一结语')])]);
  assert.equal(calls(projected).length,0); assert.equal(projected.messages.some(row => row.role === 'toolResult'),false);
  assert.equal(summaries(projected).length,1);
  const body = JSON.stringify(projected);
  for (const value of ['唯一前言','组件前说明','组件后说明','唯一结语']) assert.equal(body.split(value).length - 1,1,value);
  assert.equal(body.includes('未进入正文的过程'),false); assert.equal(body.includes('rr_input'),false);
  assert.equal(body.includes('private-image'),false); assert.equal(body.includes('private-url'),false);
  const content = summaryContent(summaries(projected)[0]);
  assert.deepEqual(content.map(part=>part.type),['text','text','Gallery','text','text']);
  assert.deepEqual(content[2].props.items.map(item=>item.id),[2,1]);
  assert.equal(content[2].props.items[0].subtitle,'真实可见说明');
  assertWirePairs(projected);
});

test('final render以toolUse结束也可归并，业务与展示混合同批仅删除真实展示对', () => {
  const business = call('query','browse_subjects',{ filter:{ rank:{ max:100 }, date:{ min:'2026-01-01' } }, cursor:'cursor-real', resourceRef:'rr_business' });
  const messages = [user('筛选后展示'),assistant([business,call('show','render_Gallery',{ resourceRef:'rr_display',final:true })],1),
    result('query','browse_subjects',{ value:{ resourceRef:'rr_business',data:[{ id:2,score:8.1 }],coverage:{ complete:false,pendingCount:5 },cursor:'cursor-next' } }),
    result('show','render_Gallery',{ replyId:'reply',blocks:[{ blockIndex:0,type:'Gallery' }] }),user('还有剩余吗')];
  const projected = project(messages,[snapshot([gallery])]);
  assert.deepEqual(calls(projected),[business]);
  const saved = projected.messages.find(row=>row.role==='toolResult');
  assert.equal(saved.toolCallId,'query'); assert.deepEqual(JSON.parse(saved.content[0].text),JSON.parse(messages[2].content[0].text));
  assert.deepEqual(calls(projected)[0].arguments.filter,business.arguments.filter);
  assert.match(JSON.stringify(projected),/cursor-next/); assert.match(JSON.stringify(projected),/pendingCount/);
  assert.equal(calls(projected)[0].arguments.resourceRef,'rr_business');
  assert.match(JSON.stringify(projected),/当前请求未验证可复用/);
  assertWirePairs(projected);
});

test('工具角色来自精确注册表，定义ack保留且未知render前缀业务不被误删', () => {
  const messages = [user('展示'),assistant([call('definition','read_component_spec',{ names:['Gallery'] }),call('business','render_account',{ state:'inspect' }),
    call('show','render_Gallery',{ resourceRef:'rr_display' })],1),
    result('definition','read_component_spec',{ version:7,tools:['render_Gallery'],status:'ready' }),
    result('business','render_account',{ account:'original' }),result('show','render_Gallery',{ replyId:'reply' }),user('追问')];
  const projected = project(messages,[snapshot([gallery])]);
  assert.deepEqual(calls(projected).map(row=>row.name),['read_component_spec','render_account']);
  assert.equal(projected.messages.find(row=>row.role==='toolResult'&&row.toolCallId==='definition').content[0].text,messages[2].content[0].text);
  assertWirePairs(projected);
});

test('可见评分日期类别、统计、进度及表格列值保真，不能降成只有名字', () => {
  const content = [
    { type:'SubjectCards',pending:false,props:{ layout:'list',total:2,hint:'范围仍有5项待核',items:[{ id:8,name:'作品',kind:'anime',score:8.5,scoreCount:101,rank:20,date:'2026-10',tags:['日常'],summary:'省略完整简介',image:'https://example.invalid/x',url:'https://bgm.tv/subject/8' }] } },
    { type:'DataTable',pending:false,props:{ title:'按评分过滤',columns:[{ key:'score',label:'评分' },{ key:'summary',label:'已展示简介' }],rows:[{ score:'8.5',summary:'该可见单元格必须保留' }],note:'unknown表示尚未核实' } },
    { type:'StatsCard',pending:false,props:{ mode:'histogram',entries:[{ label:'9分',value:'42',ratio:0.7 }] } },
    { type:'ProgressView',pending:false,props:{ current:3,total:12,episodes:[{ id:1,label:'第1集',state:'done' }] } },
  ];
  const projected = projectPresentationContent(content);
  assert.deepEqual(projected[0].props.items[0],{ id:8,name:'作品',kind:'anime',score:8.5,scoreCount:101,rank:20,date:'2026-10',tags:['日常'] });
  assert.deepEqual(projected[1].props,content[1].props); assert.deepEqual(projected[2].props,content[2].props); assert.deepEqual(projected[3].props,content[3].props);
  assert.equal(JSON.stringify(projected).includes('省略完整简介'),false); assert.equal(JSON.stringify(projected).includes('https://'),false);
});

test('open、error、aborted回合保持具体失败与成对工具证据，终态摘要准确标注状态', () => {
  for (const status of ['open','error','aborted']) {
    const messages = [user('展示'),assistant([call('failed','render_Gallery',{ resourceRef:'rr_expired' })],1),
      result('failed','render_Gallery',{ error:{ code:'RESOURCE_SCOPE_MISMATCH',issues:[{ path:'/resourceRef',rule:'scope' }] } },{ isError:true }),
      assistant([text('具体失败说明')],2,{ stopReason:status==='open'?'toolUse':status==='error'?'error':'aborted' })];
    const projected = project(messages,[snapshot([gallery],{ status })]);
    assert.equal(calls(projected).length,1); assert.equal(calls(projected)[0].arguments.resourceRef,'rr_expired');
    assert.equal(projected.messages.find(row=>row.role==='toolResult').isError,true);
    assert.match(JSON.stringify(projected),/RESOURCE_SCOPE_MISMATCH/); assert.match(JSON.stringify(projected),/具体失败说明/);
    if(status==='open') assert.equal(summaries(projected).length,0);
    else assert.match(summaries(projected)[0].text,new RegExp(`status=${status}`));
  }
});

test('unknown结果、缺失结果、重复ID和不匹配name不能借completed快照伪造成功归并', () => {
  const cases = [
    [result('one','render_Gallery',{ state:'unknown' })],
    [],
    [result('one','another_tool',{ replyId:'reply' })],
    [result('one','render_Gallery',{ replyId:'reply' }),result('one','render_Gallery',{ replyId:'reply' })],
  ];
  for (const extra of cases) {
    const messages = [user('展示'),assistant([call('one','render_Gallery',{ resourceRef:'rr_identity' })],1),...extra,user('追问')];
    const projected = project(messages,[snapshot([gallery])]);
    assert.equal(calls(projected).length,1); assert.equal(projected.messages.filter(row=>row.role==='toolResult').length,extra.length);
  }
  const messages = [user('展示'),assistant([call('one','render_Gallery',{}),call('one','render_Gallery',{})],1),result('one','render_Gallery',{ replyId:'reply' })];
  assert.equal(calls(project(messages,[snapshot([gallery])])).length,2);
});

test('多回合快照与过滤证据按各自owner归并，不混顺序或把当前回合压掉', () => {
  const older = assistant([call('one','present_text',{ text:'第一轮唯一文字' })],1);
  const second = assistant([call('two','present_text',{ text:'第二轮唯一文字' })],2,{ replyId:'second',turnId:'second-turn' });
  const current = assistant([call('three','render_Gallery',{ resourceRef:'rr_current' })],3,{ replyId:'current',turnId:'current-turn' });
  const messages = [user('第一轮filter=date1'),older,result('one','present_text',{ replyId:'reply' }),user('第二轮filter=date2'),second,
    result('two','present_text',{ replyId:'second' }),user('当前范围'),current,result('three','render_Gallery',{ error:{ code:'INVALID_INPUT' } },{ isError:true })];
  const projected = project(messages,[snapshot([text('第一轮唯一文字')]),snapshot([text('第二轮唯一文字')],{ replyId:'second',turnId:'second-turn' }),
    snapshot([],{ replyId:'current',turnId:'current-turn',status:'open' })]);
  assert.equal(summaries(projected).length,2); assert.equal(calls(projected).length,1); assert.equal(calls(projected)[0].id,'three');
  const body = JSON.stringify(projected);
  assert.equal(body.split('第一轮唯一文字').length-1,1); assert.equal(body.split('第二轮唯一文字').length-1,1);
  assert.ok(body.indexOf('date1')<body.indexOf('第一轮唯一文字')&&body.indexOf('第一轮唯一文字')<body.indexOf('date2'));
  assert.match(body,/INVALID_INPUT/);
});

test('源marker全部或部分压缩、context edit修改源、缺provenance均不复活整轮canonical', () => {
  const first = assistant([call('one','present_text',{ text:'已被压缩移除的文字' })],1);
  const last = assistant([text('仍可见尾文')],2,{ stopReason:'stop' });
  const sourceMessages = [first,last], saved = snapshot([text('已被压缩移除的文字'),gallery,text('仍可见尾文')]);
  for (const messages of [[user('压缩摘要后的追问')],[user('压缩摘要'),last,user('追问')],
    [user('原用户'),{...first,content:[text('context edit替换文字')]},last,user('追问')]]) {
    const projected = project(messages,[saved],{ sourceMessages,sourceTranscript:[first,result('one','present_text',{replyId:'reply'}),last] });
    assert.equal(summaries(projected).length,0); assert.equal(JSON.stringify(projected).includes('乙人物'),false);
    assert.equal(JSON.stringify(projected).includes('已被压缩移除的文字'),false);
  }
  const context = { messages:[user('原用户'),first,last,user('追问')] };
  bindPresentationHistory(context,[saved]);
  assert.equal(summaries(projectTranscriptForModel(context)).length,0);
});

test('签名Responses组保持reasoning/item/调用/结果原位，新增摘要只引用已表达文字', () => {
  const reasoning = { type:'reasoning',id:'rs_original',summary:[{ type:'summary_text',text:'签名原思考' }],encrypted_content:'opaque-original' };
  const thinking = { type:'thinking',thinking:'签名原思考',thinkingSignature:JSON.stringify(reasoning) };
  const signedCall = call('signed|fc_signed','render_Callout',{ before:'签名前言只出现一次',text:'签名组件文字只出现一次',tone:'success',final:true });
  const native = { type:'text',text:'签名尾文只出现一次',textSignature:'msg_original' };
  const messages = [user('签名展示'),assistant([thinking,signedCall],1),result(signedCall.id,signedCall.name,{ replyId:'reply' }),
    assistant([native],2,{ stopReason:'stop' }),user('追问')];
  const projected = project(messages,[snapshot([text(signedCall.arguments.before),{type:'Callout',pending:false,props:{tone:'success',text:signedCall.arguments.text}},text(native.text)])]);
  assert.deepEqual(calls(projected),[signedCall]); assert.deepEqual(projected.messages[1].content[0],thinking);
  const retained = projected.messages.find(row=>row.role==='assistant'&&row.content.some(part=>part.textSignature==='msg_original'));
  assert.deepEqual(retained.content[0],native);
  for(const value of [signedCall.arguments.before,signedCall.arguments.text,native.text]) assert.equal(JSON.stringify(projected).split(value).length-1,1,value);
  const wire = assertWirePairs(projected);
  assert.deepEqual(wire.find(row=>row.type==='reasoning'),reasoning);
  assert.equal(wire.find(row=>row.type==='function_call').id,'fc_signed');
  assert.equal(wire.find(row=>row.type==='message'&&row.id==='msg_original').content[0].text,native.text);
});

test('tool thoughtSignature和未知opaque thinking不被移除，必填旧引用保真', () => {
  for (const signature of ['tool','opaque']) {
    const protectedCall = call('protected','render_Gallery',{ resourceRef:'rr_signed_required' },signature==='tool'?{ thoughtSignature:'opaque-tool-signature' }:{});
    const content = signature==='opaque'?[{type:'thinking',thinking:'不可解释签名思考',thinkingSignature:'opaque-thinking-signature'},protectedCall]:[protectedCall];
    const messages = [user('展示'),assistant(content,1),result('protected','render_Gallery',{ replyId:'reply' }),user('追问')];
    const projected = project(messages,[snapshot([gallery])]);
    assert.deepEqual(calls(projected)[0],protectedCall); assert.equal(projected.messages.find(row=>row.role==='toolResult').toolCallId,'protected');
    if(signature==='opaque') assert.deepEqual(projected.messages[1].content[0],content[0]);
  }
});

test('无opaque签名Chat思考保持原位，实际provider编码不再发送展示calls且保持reasoning_content', () => {
  const chatModel = {...model,api:'openai-completions'};
  const thinking = { type:'thinking',thinking:'原生Chat思考',thinkingSignature:'reasoning_content' };
  const one = {...assistant([thinking,call('one','present_text',{text:'唯一正文'})],1),api:chatModel.api};
  const messages = [user('展示'),one,result('one','present_text',{ replyId:'reply' }),user('追问')];
  const projected = project(messages,[snapshot([text('唯一正文')])],{model:chatModel});
  assert.equal(calls(projected).length,0); assert.deepEqual(projected.messages[1].content[0],thinking);
  const wire = assertWirePairs(projected,chatModel);
  assert.equal(wire.find(row=>row.role==='assistant').reasoning_content,'原生Chat思考');
  assert.equal(JSON.stringify(wire).split('唯一正文').length-1,1);
});

test('跨真实user边界的旧owner来源不会被合并进当前回合摘要', () => {
  const first = assistant([text('旧owner可见文字')],1);
  const later = assistant([text('旧owner迟到文字')],2,{ stopReason:'aborted' });
  const projected = project([user('旧用户'),first,user('新用户'),later],[snapshot([gallery],{status:'aborted'})]);
  assert.equal(summaries(projected).length,0); assert.equal(JSON.stringify(projected).includes('乙人物'),false);
});

test('离线决策审计不含正文，区别安全成对归并和签名回退，不增加模型字段', () => {
  const unsigned = assistant([call('one','present_text',{text:'审计不能含这个正文'})],1);
  const signed = assistant([call('two','render_Gallery',{resourceRef:'rr_signed'},{thoughtSignature:'opaque-signature'})],2,{replyId:'signed',turnId:'signed-turn'});
  const context = {messages:[user('第一轮'),unsigned,result('one','present_text',{replyId:'reply'}),user('第二轮'),signed,result('two','render_Gallery',{replyId:'signed'}),user('追问')]};
  const snapshots = [snapshot([text('审计不能含这个正文')]),snapshot([gallery],{replyId:'signed',turnId:'signed-turn'})];
  bindPresentationHistory(context,snapshots,{sourceMessages:[unsigned,signed],sourceTranscript:context.messages,model,toolRoles:roles});
  const audit = inspectPresentationHistory(context);
  assert.equal(audit[0].sourceComplete,true); assert.equal(audit[0].foldedCallCount,1); assert.equal(audit[0].retainedSignedCallCount,0); assert.equal(audit[0].summaryInjected,true);
  assert.equal(audit[1].foldedCallCount,0); assert.equal(audit[1].retainedSignedCallCount,1);
  assert.equal(JSON.stringify(audit).includes('审计不能含这个正文'),false); assert.equal(JSON.stringify(audit).includes('乙人物'),false); assert.equal(JSON.stringify(audit).includes('opaque-signature'),false);
  const projected = projectTranscriptForModel(context);
  assert.deepEqual(Object.keys(projected),['messages']);
});

test('LinkList链接地址是不可省略的可见事实，历史追问第2条URL仍有准确依据', () => {
  const links={type:'LinkList',pending:false,props:{title:'资料',links:[{label:'第一条',url:'https://example.invalid/one',hint:'原始资料'},{label:'第二条',url:'https://example.invalid/two'}]}};
  assert.deepEqual(projectPresentationContent(links).props,links.props);
  const messages=[user('显示资料'),assistant([call('links','render_Gallery',{})],1),result('links','render_Gallery',{replyId:'reply'}),user('刚才第2条的地址')];
  const projected=project(messages,[snapshot([links])]);
  assert.equal(summaryContent(summaries(projected)[0])[0].props.links[1].url,'https://example.invalid/two');
});

test('完整assistant来源但结果移除、错配、重复或被context edit替换时不复活整轮', () => {
  const source=assistant([call('one','render_Gallery',{resourceRef:'rr_input'})],1);
  const success=result('one','render_Gallery',{replyId:'reply'}), canonical=snapshot([gallery]);
  const sourceTranscript=[user('原请求'),source,success], sourceMessages=[source];
  for(const results of [[],[{...success,toolCallId:'changed'}],[{...success,toolName:'changed'}],[success,success],
    [{...success,content:[text('上下文编辑替换了原结果')]}]]) {
    const projected=project([user('原请求'),source,...results,user('追问')],[canonical],{sourceMessages,sourceTranscript});
    assert.equal(summaries(projected).length,0); assert.equal(calls(projected).length,1);
    assert.equal(JSON.stringify(projected).includes('乙人物'),false);
    assert.deepEqual(projected.messages.filter(row=>row.role==='toolResult').map(row=>row.toolCallId),results.map(row=>row.toolCallId));
  }
});

test('业务写入unknown及查询失败保留参数、结果与诊断，展示归并不影响其真实provider配对', () => {
  const write=call('write','execute_write_batch',{operations:[{tool:'update_single_episode_collection',args:{episode_id:9,collection_type:2}}]});
  const query=call('query','get_subject_details',{subject_id:9});
  const messages=[user('操作后展示'),assistant([write,query,call('show','render_Gallery',{})],1),
    result('write','execute_write_batch',{value:{state:'unknown',summary:{unknown:1},items:[{episodeId:9,submissionState:'unknown'}]}}),
    result('query','get_subject_details',{error:{code:'MCP_UPSTREAM_UNAVAILABLE',diagnostic:{reason:'timeout',recovery:'none'}}},{isError:true}),
    result('show','render_Gallery',{replyId:'reply'}),user('刚才修改成功吗')];
  const projected=project(messages,[snapshot([gallery])]);
  assert.deepEqual(calls(projected),[write,query]);
  assert.deepEqual(projected.messages.filter(row=>row.role==='toolResult').map(row=>row.content[0].text),messages.slice(2,4).map(row=>row.content[0].text));
  assertWirePairs(projected); assert.match(JSON.stringify(projected),/submissionState.*unknown/);assert.match(JSON.stringify(projected),/MCP_UPSTREAM_UNAVAILABLE/);
});

for(const api of ['openai-responses','openai-completions']) test(`${api}多system、删除空消息、复合call ID的签名回退文字引用可在实际wire解析`,()=>{
  const target={...model,api};
  const reasoning={type:'thinking',thinking:'原签名推理',thinkingSignature:JSON.stringify({type:'reasoning',id:'rs_native',summary:[]})};
  const signedCall=call('signed|fc_signed','render_Callout',{resourceRef:'rr_expired',before:'WIRE唯一before',text:'WIRE唯一组件正文',tone:'success',final:true});
  const before=assistant([call('folded','present_text',{text:'无签名前缀'})],1);
  const bound=assistant([reasoning,signedCall],3);
  const final=assistant([{...text('WIRE唯一native'),textSignature:'msg_native'}],4,{stopReason:'stop'});
  const messages=[{role:'system',content:'初始系统',timestamp:0},user('原用户'),before,result('folded','present_text',{replyId:'reply'}),
    {role:'system',content:'中间系统',timestamp:2},assistant([],2),bound,result(signedCall.id,signedCall.name,{replyId:'reply',resourceRef:'rr_expired'}),final,user('追问')];
  const projected=project(messages,[snapshot([text('无签名前缀'),text(signedCall.arguments.before),{type:'Callout',pending:false,props:{tone:'success',text:signedCall.arguments.text}},text(final.content[0].text)])],{model:target});
  const summary=summaryContent(summaries(projected)[0]), wire=assertWirePairs(projected,target);
  assert.equal(calls(projected).length,1);
  const references=[summary[1].source,summary[2].props.text.source,summary[3].source];
  assert.deepEqual(references.map(source=>resolveWireSource(wire,source,api)),['WIRE唯一before','WIRE唯一组件正文','WIRE唯一native']);
  for(const source of references) {assert.equal('sourceMessage' in source,false);assert.equal('toolCallId' in source,false);}
  assert.equal(summary[1].source.toolName,'render_Callout');assert.equal(summary[1].source.occurrence,1);assert.equal(summary[1].source.argumentPointer,'/before');
});

test('error与aborted原生终态不伪装成功，实际provider仍收到明确的已展示前缀和未完成反馈',()=>{
  for(const status of ['error','aborted']) {
    const source=assistant([call('prefix','present_text',{text:'已展示部分唯一文字'})],1);
    const terminal=assistant([text('未交付的末尾草稿')],2,{stopReason:status,errorMessage:'具体未完成原因'});
    const messages=[user('展示'),source,result('prefix','present_text',{replyId:'reply'}),terminal,user('刚才完成哪些？')];
    const projected=project(messages,[snapshot([text('已展示部分唯一文字')],{status})]);
    assert.equal(projected.messages.find(row=>row.role==='assistant'&&row.timestamp===2).stopReason,status);
    const wire=assertWirePairs(projected);
    const body=JSON.stringify(wire);
    assert.match(body,new RegExp(`status=${status}`));assert.match(body,/具体未完成原因/);
    assert.equal(body.split('已展示部分唯一文字').length-1,1);
    assert.equal(body.includes('未交付的末尾草稿'),false);
  }
});

for(const api of ['openai-responses','openai-completions']) test(`${api}成员错配失败后成功发布相同创作文字，追问实际wire单份且不抹失败证据`,()=>{
  const target={...model,api};
  const before='三份来源已确认，按原选择顺序展示。', after='上述成员与评分日期来自已验证的缓存。', title='已确认的成员';
  const failedArgs={resourceRef:'rr_single_member',subjectIds:[9,7,1],before,after,title,final:true};
  const successArgs={sources:[{resourceRef:'rr_member_9',subjectIds:[9]},{resourceRef:'rr_member_7',subjectIds:[7]},{resourceRef:'rr_member_1',subjectIds:[1]}],before,after,title,final:true};
  const failed=call('failed|fc_failed','render_SubjectCards',failedArgs), succeeded=call('success|fc_success','render_SubjectCards',successArgs);
  const error={error:{code:'COMPONENT_MEMBER_MISMATCH',message:'原引用仅包含一个成员，所选成员不属于同一来源。',
    issues:[{path:'/subjectIds',rule:'memberMismatch',hint:'保留原选择，每个来源分别选择其成员。'}],networkAttempted:false}};
  const published={type:'SubjectCards',pending:false,props:{title,layout:'list',items:[
    {id:9,name:'成功事实9',kind:'anime',score:8.7,date:'2026-10'},{id:7,name:'成功事实7',kind:'anime',rank:12},{id:1,name:'成功事实1',kind:'anime',score:8.1},
  ]}};
  const messages=[{role:'system',content:'初始工具声明',timestamp:0},user('第一用户选择三项'),assistant([failed],1),
    result(failed.id,failed.name,error,{isError:true}),{role:'system',content:'中间工具声明',timestamp:2},assistant([succeeded],3),
    result(succeeded.id,succeeded.name,{replyId:'reply',blocks:[{blockIndex:0,type:'SubjectCards',itemCount:3}]}),user('第二用户按评分继续筛选')];
  const projected=project(messages,[snapshot([text(before),published,text(after)])],{model:target});
  assert.deepEqual(calls(projected),[failed]);
  const preserved=projected.messages.find(row=>row.role==='toolResult');
  assert.equal(preserved.toolCallId,failed.id); assert.equal(preserved.toolName,failed.name); assert.equal(preserved.isError,true);
  assert.equal(preserved.content[0].text,JSON.stringify(error));
  assert.equal(calls(projected)[0].arguments.resourceRef,'rr_single_member'); assert.deepEqual(calls(projected)[0].arguments.subjectIds,[9,7,1]);
  const summary=summaries(projected)[0]; assert.match(summary.text,/status=completed/);
  const content=summaryContent(summary); assert.deepEqual(content.map(part=>part.type),['text','SubjectCards','text']);
  assert.deepEqual(content[1].props.items,published.props.items,'事实来自成功canonical，而非失败操作参数');
  assert.deepEqual(content[1].props.items.map(item=>item.id),[9,7,1]);
  const references=[content[0].source,content[1].props.title.source,content[2].source];
  assert.ok(references.every(source=>source.operationOutcome==='error'));
  const wire=assertWirePairs(projected,target), body=JSON.stringify(wire);
  assert.deepEqual(references.map(source=>resolveWireSource(wire,source,api)),[before,title,after]);
  for(const phrase of [before,title,after]) assert.equal(body.split(phrase).length-1,1,`${phrase}在同一真实请求只能一份`);
  assert.match(body,/COMPONENT_MEMBER_MISMATCH/); assert.match(body,/memberMismatch/);assert.match(body,/原引用仅包含一个成员/);assert.match(body,/rr_single_member/);
});

test('失败参数的文字定位不用于事实，也不把不同字面或非字符串创作字段误合并',()=>{
  const targetTitle='成功标题', before='成功文字', after='成功后文';
  const args={before:{text:before},after:[after],title:17,text:'不同文字',facts:{text:before,title:targetTitle},props:{text:after}};
  const source=assistant([call('failed','render_Callout',args)],1);
  const success=assistant([call('success','render_Gallery',{resourceRef:'rr_success',before,after,title:targetTitle,final:true})],2);
  const messages=[user('显示'),source,result('failed','render_Callout',{error:{code:'INVALID_INPUT',message:'创作字段类型错误。'}},{isError:true}),
    success,result('success','render_Gallery',{replyId:'reply'}),user('追问')];
  const canonical={...gallery,props:{...gallery.props,title:targetTitle}};
  const projected=project(messages,[snapshot([text(before),canonical,text(after)])]);
  const content=summaryContent(summaries(projected)[0]);
  assert.equal(content[0].text,before);assert.equal(content[2].text,after);
  assert.deepEqual(content[1].props,{title:targetTitle,items:[{id:2,name:'乙人物',subtitle:'真实可见说明'},{id:1,name:'甲人物'}]});
  assert.deepEqual(calls(projected)[0].arguments,args);
  assert.equal(content.some(part=>part.source),false);
});

test('坏错误信封、损坏结果与无可验证目标codec不借保留失败文字生成来源引用',()=>{
  const phrase='坏来源不可借用';
  const source=assistant([call('failed','present_text',{text:phrase})],1);
  const broken=[{error:17},{error:{code:17,message:'坏类型'}},{error:{code:'INVALID_INPUT',message:{text:'坏类型'}}},
    {error:{code:'INVALID_INPUT',message:'损坏语法'}}];
  for(const [index,error] of broken.entries()) {
    const response=result('failed','present_text',error,{isError:true});
    if(index===broken.length-1)response.content[0].text='{"error":';
    const projected=project([user('原用户'),source,response,user('追问')],[snapshot([text(phrase)])]);
    assert.equal(summaryContent(summaries(projected)[0])[0].text,phrase);
    assert.equal(summaryContent(summaries(projected)[0])[0].source,undefined);
    assert.equal(projected.messages.find(row=>row.role==='toolResult').content[0].text,response.content[0].text);
  }
  for(const target of [undefined,{...model,api:'unsupported-history-codec'}]) {
    const response=result('failed','present_text',{error:{code:'INVALID_INPUT',message:'仍保留具体错误'}},{isError:true});
    const projected=project([user('原用户'),source,response,user('追问')],[snapshot([text(phrase)])],{model:target});
    assert.equal(summaryContent(summaries(projected)[0])[0].source,undefined);
    assert.deepEqual(calls(projected)[0].arguments,{text:phrase});
  }
});

test('unknown来源只给文字位置且明确unknown，不折叠操作也不改变未完成回合状态',()=>{
  for(const status of ['completed','error','aborted']) {
    const phrase=`未知操作的可见文字${status}`;
    const source=assistant([call('unknown','present_text',{text:phrase})],1);
    const response=result('unknown','present_text',{state:'unknown',submissionState:'unknown'});
    const messages=[user('原用户'),source,response,user('追问')];
    const projected=project(messages,[snapshot([text(phrase)],{status})]);
    assert.equal(calls(projected).length,1);assert.equal(projected.messages.find(row=>row.role==='toolResult').content[0].text,response.content[0].text);
    const summary=summaries(projected)[0], content=summaryContent(summary);
    assert.match(summary.text,new RegExp(`status=${status}`));assert.equal(content[0].source.operationOutcome,'unknown');
    const wire=assertWirePairs(projected);assert.equal(resolveWireSource(wire,content[0].source,model.api),phrase);
  }
});

test('失败文字的来源provenance丢失、修改或不配对时不引用、不复活快照',()=>{
  const phrase='完整来源必需';
  const source=assistant([call('failed','present_text',{text:phrase})],1);
  const response=result('failed','present_text',{error:{code:'INVALID_INPUT',message:'具体错误'}},{isError:true});
  const sourceTranscript=[user('原用户'),source,response], sourceMessages=[source];
  for(const responses of [[],[{...response,toolCallId:'wrong'}],[response,response],
    [{...response,content:[text('{"error":{"code":"CHANGED","message":"改过"}}')]}]]) {
    const projected=project([user('原用户'),source,...responses,user('追问')],[snapshot([text(phrase)])],{sourceMessages,sourceTranscript});
    assert.equal(summaries(projected).length,0);assert.equal(calls(projected).length,1);
    assert.deepEqual(projected.messages.filter(row=>row.role==='toolResult').map(row=>row.content[0].text),responses.map(row=>row.content[0].text));
  }
});
