import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatController, loginText } from '../../src/cli/chat-controller.js';
import { chatFixture } from '../fixtures/chat-fixture.js';
import { AppError } from '../../src/domain/errors.js';
import { SessionLog } from '../../src/storage/session.js';

test('登录状态：未保存不联网；已有登录核对数字账户；断网保留待核实而不冒充未登录',async t=>{
  const f=await chatFixture(t);let reads=0;f.client.currentUser=async()=>{reads++;return{id:7,username:'fixture'};};
  await f.controller.initialize();assert.equal(reads,0);assert.equal(loginText(f.controller.snapshot().login),'当前未登录Bangumi账号');
  f.login={accountId:7};await f.controller.submit('/status');assert.equal(reads,1);assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：fixture');
  f.client.currentUser=async()=>{throw new AppError('BGM_NETWORK','离线断网');};await f.controller.submit('/status');
  assert.equal(f.controller.snapshot().login.kind,'unverified');assert.match(loginText(f.controller.snapshot().login),/当前Bangumi用户：fixture/);
  f.client.currentUser=async()=>{throw new AppError('BGM_AUTH_REQUIRED','登录失效');};await f.controller.submit('/status');
  assert.equal(f.controller.snapshot().login.kind,'signed-out');
});
test('横幅username来自已核实账户，离线保留本机姓名并标注待核实；登录及模型切换只输出简短更新',async t=>{
  const f=await chatFixture(t,{accountId:7,username:'saved-user'});
  f.client.currentUser=async()=>({id:7,username:'verified-user'});
  await f.controller.initialize();assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：verified-user');
  const first=f.controller.snapshot().items.find(item=>item.kind==='header');assert.ok(first?.kind==='header');assert.equal(first.compact,undefined);
  f.client.currentUser=async()=>{throw new AppError('BGM_NETWORK','断网');};
  await f.controller.submit('/status');assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：saved-user（登录状态待核实）');
  f.loginHandler=async()=>({id:8,username:'new-user'});
  await f.controller.submit('/login');assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：new-user');
  const signedIn=f.controller.snapshot().login;assert.ok(signedIn.kind==='signed-in');assert.equal(signedIn.accountId,8);
  await f.controller.submit('/model second');
  const updates=f.controller.snapshot().items.filter(item=>item.kind==='header').slice(1);
  assert.equal(updates.length,2);assert.ok(updates.every(item=>item.kind==='header'&&item.compact));
  const last=updates.at(-1);assert.ok(last?.kind==='header');assert.equal(last.header.modelLabel,'fixture-second');
  assert.equal(last.header.login.kind==='signed-in' && last.header.login.username,'new-user');
  assert.equal(f.modelRequests.length,0);assert.equal(f.writes.length,0);
});
test('显示与宿主确认分离：未展示或错误摘要不能确认，完整展示后确认只写一次',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();await f.controller.submit('搜索芙莉莲');await f.controller.submit('第一项');
  await f.controller.submit('把它设为私密');const plan=f.controller.snapshot().pending;assert.ok(plan);assert.equal(f.writes.length,0);
  await f.controller.submit('确认执行');assert.equal(f.writes.length,0);assert.ok(f.controller.snapshot().pending);
  f.controller.acknowledgePlan(plan.id,'错误摘要');assert.equal(f.controller.snapshot().previewAcknowledged,false);
  f.controller.acknowledgePlan(plan.id,plan.digest);await f.controller.submit('确认执行');assert.equal(f.writes.length,1);assert.equal(f.collections.get(1)?.private,true);
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='plan'&&item.plan.results?.[0]?.state==='success'));
  await f.controller.submit('确认执行');assert.equal(f.writes.length,1);
});
test('明确单项继续直接执行；确认前账户改变停止，模型切换使旧预览失效',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();await f.controller.submit('搜索芙莉莲');await f.controller.submit('第一项');
  await f.controller.submit('把它改成8分');assert.equal(f.writes.length,1);assert.equal(f.collections.get(1)?.rate,8);
  await f.controller.submit('把它设为私密');let plan=f.controller.snapshot().pending!;f.controller.acknowledgePlan(plan.id,plan.digest);
  f.account=8;await f.controller.submit('确认执行');assert.equal(f.writes.length,1);
  f.account=7;await f.controller.submit('把它设为私密');plan=f.controller.snapshot().pending!;f.controller.acknowledgePlan(plan.id,plan.digest);
  await f.controller.submit('/model second');assert.equal(f.controller.snapshot().modelName,'second');assert.equal(f.controller.snapshot().pending,null);
  await f.controller.submit(`/confirm ${plan.id}`);assert.equal(f.writes.length,1);assert.ok(f.closed.includes('first'));
});
test('取消模型本轮后可继续聊天，失败轮次不会恢复，运行中不并发提交',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  f.handler=async (_messages,{signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new AppError('CANCELLED','已取消')),{once:true}));};
  const pending=f.controller.submit('搜索芙莉莲');await began;await f.controller.submit('第二个请求');f.controller.cancel();await pending;
  assert.equal(f.controller.snapshot().busy,false);assert.deepEqual(await new SessionLog(f.paths.sessions,f.controller.snapshot().sessionId).messages(),[]);
  f.handler=async (_messages,{onText})=>{onText?.('恢复后的回答');return{role:'assistant',content:'恢复后的回答'};};
  await f.controller.submit('搜索芙莉莲');assert.ok(f.controller.snapshot().items.some(item=>item.kind==='assistant'&&item.text==='恢复后的回答'));
});
test('取消真实工具读取传到每轮signal，下一轮没有继承已取消signal',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();const original=f.client.search;
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});let received:AbortSignal|undefined;
  f.client.search=async (_query,_type,_limit,signal)=>{received=signal;started();return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new AppError('CANCELLED','读取停止')),{once:true}));};
  const pending=f.controller.submit('搜索芙莉莲');await began;f.controller.cancel();await pending;assert.equal(received?.aborted,true);
  f.client.search=original;await f.controller.submit('搜索芙莉莲');assert.equal(f.controller.snapshot().candidates?.items.length,2);
});
test('写入取消后等待独立回读，结果未知保留、后续不自动重发且关闭等待本轮结束',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();await f.controller.submit('搜索芙莉莲');await f.controller.submit('第一项');
  const originalRead=f.client.collectionSnapshot;let sent=false;let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  f.client.mutate=async (_id,_account,_request,signal)=>{f.writes.push(1);sent=true;started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new AppError('CANCELLED','写入已发出')),{once:true}));};
  let verifiedSignal:AbortSignal|undefined;
  f.client.collectionSnapshot=async(id,signal)=>{if(sent){verifiedSignal=signal;throw new AppError('BGM_NETWORK','回读失败');}return originalRead(id,signal);};
  const pending=f.controller.submit('把它改成8分');await began;f.controller.cancel();assert.equal(f.controller.snapshot().busy,true);await pending;
  assert.equal(verifiedSignal?.aborted,false);assert.equal(f.writes.length,1);assert.equal(f.controller.snapshot().unknownOperations,1);assert.equal(f.controller.snapshot().busy,false);
  await f.controller.submit('/status');
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='notice'&&/结果未知的操作：1 项；请先核对网站，不会自动重试/.test(item.text)));
  await f.controller.submit('/new');assert.equal(f.writes.length,1);
});
test('会话菜单恢复完成对话和候选；旧确认不恢复；查看状态不会清除待确认预览',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();await f.controller.submit('搜索芙莉莲');await f.controller.submit('第一项');
  await f.controller.submit('把它设为私密');const plan=f.controller.snapshot().pending!;f.controller.acknowledgePlan(plan.id,plan.digest);
  const headers=f.controller.snapshot().items.filter(item=>item.kind==='header').length;
  await f.controller.submit('/status');assert.equal(f.controller.snapshot().pending?.id,plan.id);
  assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='header').length,headers);
  const status=f.controller.snapshot().items.filter(item=>item.kind==='notice').at(-1)!;
  assert.ok(status.kind==='notice');assert.match(status.text,/当前作品：葬送的芙莉莲/);
  assert.ok(status.text.includes(`待确认变更：1 个条目；预览 ID：${plan.id}；可确认或取消`));
  const id=f.controller.snapshot().sessionId;assert.ok((await f.controller.sessions()).includes(id));await f.controller.submit('/new');
  await f.controller.submit(`/resume ${id}`);assert.equal(f.controller.snapshot().pending,null);assert.equal(f.controller.snapshot().focus,'葬送的芙莉莲');
  await f.controller.submit('确认执行');assert.equal(f.writes.length,0);
});
test('损坏或过期本机认证仍能启动界面，提示不会泄露保护文件内容',async t=>{
  const f=await chatFixture(t);const controller=new ChatController({config:f.config,paths:f.paths,client:f.client,createModel:f.createModel,
    loadLogin:async()=>{throw new AppError('OAUTH_AUTH_INVALID','登录过期');},login:async()=>({id:7,username:'fixture'}),signal:new AbortController().signal},'first');
  t.after(()=>controller.close());await controller.initialize();assert.equal(controller.snapshot().ready,true);assert.equal(controller.snapshot().login.kind,'signed-out');
});

test('/login 复用宿主登录并刷新账号，清除旧授权；/status 明确字段且不请求模型',async t=>{
  const f=await chatFixture(t);await f.controller.initialize();await f.controller.submit('/status');
  let status=f.controller.snapshot().items.filter(item=>item.kind==='notice').at(-1)!;
  assert.ok(status.kind==='notice');assert.match(status.text,/Bangumi 登录：未登录或登录已失效；输入 \/login 登录/);
  await f.controller.submit('搜索芙莉莲');await f.controller.submit('第一项');await f.controller.submit('把它设为私密');
  const plan=f.controller.snapshot().pending!;f.controller.acknowledgePlan(plan.id,plan.digest);
  const requests=f.modelRequests.length;f.account=8;await f.controller.submit('/login');
  assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：fixture');assert.equal(f.controller.snapshot().pending,null);
  await f.controller.submit('/status');assert.equal(f.modelRequests.length,requests);assert.equal(f.writes.length,0);
  status=f.controller.snapshot().items.filter(item=>item.kind==='notice').at(-1)!;assert.ok(status.kind==='notice');
  for(const line of ['当前状态（/status）','Bangumi 登录：已登录（用户 ID：8；本次 OAuth API 核实通过）','当前模型：fixture-first',
    '模型配置：first（/model 切换）',`完整会话 ID：${f.controller.snapshot().sessionId}（/resume ID 恢复）`,
    '当前作品：葬送的芙莉莲','待确认变更：无','结果未知的操作：0 项（无需核查）'])assert.ok(status.text.includes(line),line);
  await f.controller.submit(`/confirm ${plan.id}`);assert.equal(f.writes.length,0);
});

test('/login 失败或取消保留原登录，不泄露凭据，取消后可继续聊天',async t=>{
  const f=await chatFixture(t,{accountId:7});await f.controller.initialize();
  f.loginHandler=async()=>{throw new AppError('WEB_BROWSER_UNAVAILABLE','离线模拟浏览器不可用');};
  await f.controller.submit('/login');assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：fixture');
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.includes('登录未完成：[WEB_BROWSER_UNAVAILABLE]')));
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});let received:AbortSignal|undefined;
  f.loginHandler=async(signal,notice)=>{received=signal;notice('离线模拟等待登录');started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new AppError('CANCELLED','已取消')),{once:true}));};
  const pending=f.controller.submit('/login');await began;assert.equal(f.controller.snapshot().busy,true);f.controller.cancel();await pending;
  assert.equal(received?.aborted,true);assert.equal(f.controller.snapshot().busy,false);assert.equal(loginText(f.controller.snapshot().login),'当前Bangumi用户：fixture');
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text==='登录已取消，原有本机登录保留；可以继续聊天。'));
  assert.equal(f.modelRequests.length,0);await f.controller.submit('搜索芙莉莲');assert.equal(f.controller.snapshot().candidates?.items.length,2);
});
