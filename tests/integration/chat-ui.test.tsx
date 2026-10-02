import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { render } from 'ink';
import { ChatApp } from '../../src/cli/ui/app.js';
import { chatFixture } from '../fixtures/chat-fixture.js';
import { AppError } from '../../src/domain/errors.js';
import type { Message } from '../../src/core/types.js';

async function until(check:()=>boolean):Promise<void> {
  const deadline=Date.now()+3000;
  while(!check()) {if(Date.now()>deadline)throw new Error('模拟终端等待超时');await new Promise(resolve=>setTimeout(resolve,10));}
}
function terminal() {
  let output='';let raw=false;
  const stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode:(value:boolean)=>{raw=value;},ref:()=>{},unref:()=>{}});
  const stdout=Object.assign(new Writable({write(chunk,_encoding,callback){output+=chunk.toString();callback();}}),{isTTY:true,columns:80,rows:24});
  const stderr=new Writable({write(_chunk,_encoding,callback){callback();}});
  return {stdin:stdin as unknown as NodeJS.ReadStream,stdout:stdout as unknown as NodeJS.WriteStream,stderr:stderr as unknown as NodeJS.WriteStream,
    get output(){return output;},get raw(){return raw;},
    async key(text:string){stdin.write(text);await new Promise(resolve=>setTimeout(resolve,50));},
    resize(columns:number,rows:number){stdout.columns=columns;stdout.rows=rows;stdout.emit('resize');},
  };
}

async function commandUi(t:TestContext) {
  const f=await chatFixture(t);const tty=terminal();
  const app=render(<ChatApp controller={f.controller}/>,{stdin:tty.stdin,stdout:tty.stdout,stderr:tty.stderr,interactive:true,exitOnCtrlC:false,patchConsole:false});
  t.after(()=>{app.unmount();app.cleanup();});await f.controller.initialize();await app.waitUntilRenderFlush();
  return {f,tty,app};
}

test('命令列表：/自动显示，方向键无需Tab直接选中并执行；历史保存完整命令',async t=>{
  const {f,tty}=await commandUi(t);
  await tty.key('/');assert.match(tty.output,/聊天命令/);assert.match(tty.output,/↑↓ 选择 · Tab 补全 · Enter 执行/);
  await tty.key('\u001b[B');await tty.key('\u001b[B');await tty.key('\u001b[B');await tty.key('\u001b[A');await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.startsWith('当前状态（/status）')));
  await tty.key('\u001b[A');assert.match(tty.output,/\/status▏/);assert.equal(f.modelRequests.length,0);
});

test('命令列表：半截命令Enter直接执行，Tab只补全且补全后可退格继续编辑',async t=>{
  const {f,tty}=await commandUi(t);
  await tty.key('/sta');await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.startsWith('当前状态（/status）')));
  await tty.key('/l');await tty.key('\t');assert.match(tty.output,/\/login▏/);
  assert.equal(f.controller.snapshot().login.kind,'signed-out');assert.equal(f.controller.snapshot().busy,false);
  await tty.key('\u007f');await tty.key('n');await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().login.kind==='signed-in');assert.equal(f.modelRequests.length,0);
});

test('命令列表：筛选保留仍匹配的高亮项，不匹配时回第一项，文字输入不会被方向键锁住',async t=>{
  const {f,tty}=await commandUi(t);
  await tty.key('/s');await tty.key('\u001b[B');await tty.key('\u007f');await tty.key('\t');
  assert.match(tty.output,/\/sessions▏/);
  await tty.key('\u0015');await tty.key('/s');await tty.key('\u001b[B');await tty.key('t');await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.startsWith('当前状态（/status）')));
  assert.equal(f.modelRequests.length,0);
});

test('命令列表：Esc保留草稿，编辑后重新显示；无匹配在本地提示且保留草稿',async t=>{
  const {f,tty}=await commandUi(t);const id=f.controller.snapshot().sessionId;
  await tty.key('/sta');await tty.key('\u001b');await tty.key('\r');
  assert.match(tty.output,/没有匹配命令/);assert.match(tty.output,/\/sta▏/);assert.equal(f.modelRequests.length,0);
  const mark=tty.output.length;await tty.key('t');assert.match(tty.output.slice(mark),/聊天命令/);await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.startsWith('当前状态（/status）')));
  await tty.key('/xyz');await tty.key('\r');assert.match(tty.output,/\/xyz▏/);
  assert.equal(f.controller.snapshot().sessionId,id);assert.equal(f.modelRequests.length,0);assert.equal(f.writes.length,0);
  await tty.key('\u0015');await tty.key('/statusx');await tty.key('\u007f');await tty.key('\t');assert.match(tty.output,/\/status▏/);
});

test('命令列表：带参数命令原样执行，高级快捷入口保留，缺参数或未知命令不交给模型',async t=>{
  const {f,tty}=await commandUi(t);const id=f.controller.snapshot().sessionId;
  await tty.key('/model second');await tty.key('\r');await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().modelName==='second');
  await tty.key(`/resume ${id}`);await tty.key('\r');await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().sessionId===id);
  await tty.key('/select');await tty.key('\r');assert.match(tty.output,/请补充参数：\/select/);assert.match(tty.output,/\/select▏/);
  await tty.key('\u0015');await tty.key('/xyz 参数');await tty.key('\r');assert.match(tty.output,/\/xyz 参数▏/);
  assert.equal(f.modelRequests.length,0);assert.equal(f.writes.length,0);
});

test('命令列表：正文中的斜杠与多行草稿不触发命令替换，粘贴不自动执行',async t=>{
  const {f,tty}=await commandUi(t);
  f.handler=async()=>({role:'assistant',content:'普通草稿完成'});
  await tty.key('作品 /sta');await tty.key('\r');await until(()=>!f.controller.snapshot().busy);
  await tty.key('\u001b[200~/sta\n补充\u001b[201~');
  assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='user').length,1);
  await tty.key('\r');await until(()=>!f.controller.snapshot().busy);
  assert.deepEqual(f.controller.snapshot().items.flatMap(item=>item.kind==='user' ? [item.text] : []),['作品 /sta','/sta\n补充']);
});

test('命令列表：运行中Enter不执行草稿，Esc停止本轮，结束后半截命令可直接执行',async t=>{
  const {f,tty}=await commandUi(t);let started=false;
  f.handler=async(_messages,{signal})=>{started=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new AppError('CANCELLED','已停止')),{once:true}));};
  await tty.key('搜索芙莉莲');await tty.key('\r');await until(()=>started);
  await tty.key('/sta');await tty.key('\r');assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='user').length,1);
  await tty.key('\u001b');await until(()=>!f.controller.snapshot().busy);await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='notice'&&item.text.startsWith('当前状态（/status）')));
  assert.equal(f.writes.length,0);
});

for (const natural of [false, true]) {
  test(`实际Ink提问：${natural ? '自然语言回答' : '无需Tab直接方向键选择'}后立即查询评分`, async t => {
    const f=await chatFixture(t); const tty=terminal(); let reads=0;
    const tool=(name:string,args:object):Extract<Message,{role:'assistant'}> => ({role:'assistant',content:null,
      tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    f.handler=async(messages,{onText}) => {
      const last=messages.at(-1)!;
      if(last.role==='user') return last.content.includes('多少分') ? tool('search_subjects',{keyword:'芙莉莲'}) : tool('get_collection',{subjectId:natural?1:2});
      if(last.role==='tool' && last.tool_call_id==='search_subjects') return tool('request_subject_selection',{question:'你想查询哪一部的评分？'});
      reads++;onText?.('评分查询完成');return{role:'assistant',content:'评分查询完成'};
    };
    const app=render(<ChatApp controller={f.controller}/>,{stdin:tty.stdin,stdout:tty.stdout,stderr:tty.stderr,interactive:true,exitOnCtrlC:false,patchConsole:false});
    t.after(()=>{app.unmount();app.cleanup();}); await f.controller.initialize();
    await tty.key('我给芙莉莲打了多少分？');await tty.key('\r');
    await until(()=>!f.controller.snapshot().busy && f.controller.snapshot().candidates!==null);await app.waitUntilRenderFlush();
    assert.match(tty.output,/可直接输入自然语言回答/);assert.equal(reads,0);
    await tty.key(natural?'我选第一项':'\u001b[B');await tty.key('\r');
    await until(()=>reads===1&&!f.controller.snapshot().busy);
    assert.equal(f.controller.snapshot().focus,natural?'葬送的芙莉莲':'续作');assert.equal(f.writes.length,0);
    assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='user').length,2);
  });
}

test('实际Ink组件：多行粘贴/换行、候选菜单、确认/拒绝、模型菜单、缩放与退出（模拟终端）',{timeout:12000},async t=>{
  const f=await chatFixture(t,{accountId:7});const tty=terminal();
  const app=render(<ChatApp controller={f.controller}/>,{stdin:tty.stdin,stdout:tty.stdout,stderr:tty.stderr,interactive:true,exitOnCtrlC:false,patchConsole:false,maxFps:24});
  t.after(()=>{app.unmount();app.cleanup();});
  await f.controller.initialize();await app.waitUntilRenderFlush();assert.match(tty.output,/当前Bangumi用户：fixture/);assert.equal(tty.raw,true);
  await tty.key('\u001b[200~搜索芙莉莲\n下一行\u001b[201~');
  assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='user').length,0);
  await tty.key('\u0015');await tty.key('搜索芙莉莲');await tty.key('\n');await tty.key('补充');await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy && f.controller.snapshot().candidates !== null);
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='user'&&item.text==='搜索芙莉莲\n补充'));
  await tty.key('\t');assert.match(tty.output,/选择作品/);await tty.key('\u001b[B');await tty.key('\r');
  await until(()=>f.controller.snapshot().focus==='续作'&&!f.controller.snapshot().busy);
  await tty.key('把它设为私密');await tty.key('\r');await until(()=>f.controller.snapshot().previewAcknowledged&&!f.controller.snapshot().busy);
  await tty.key('\r');await until(()=>f.controller.snapshot().pending === null && !f.controller.snapshot().busy);assert.equal(f.writes.length,0);
  await tty.key('把它设为私密');await tty.key('\r');await until(()=>f.controller.snapshot().previewAcknowledged&&!f.controller.snapshot().busy);
  await tty.key('\u001b[C');await tty.key('\r');await until(()=>f.writes.length===1&&!f.controller.snapshot().busy);assert.equal(f.collections.get(2)?.private,true);
  await tty.key('/');await tty.key('\u001b[B');await tty.key('\u001b[B');await tty.key('\u001b[B');await tty.key('\r');
  assert.match(tty.output,/选择模型配置/);await tty.key('\u001b[B');await tty.key('\r');await until(()=>f.controller.snapshot().modelName==='second');
  tty.resize(40,18);await app.waitUntilRenderFlush();await tty.key('/model');await tty.key('\r');await tty.key('\u001b');
  assert.equal(f.controller.snapshot().busy,false);
  await tty.key('\u0003');assert.match(tty.output,/再按一次 Ctrl\+C 退出/);await tty.key('\u0003');await app.waitUntilExit();
  assert.equal(tty.raw,false);assert.equal(f.closed.filter(name=>name==='second').length,1);
});
test('实际Ink组件：运行中草稿不发送，Ctrl+C停止本轮后同一草稿可继续提交（模拟终端）',{timeout:8000},async t=>{
  const f=await chatFixture(t);const tty=terminal();
  const app=render(<ChatApp controller={f.controller}/>,{stdin:tty.stdin,stdout:tty.stdout,stderr:tty.stderr,interactive:true,exitOnCtrlC:false,patchConsole:false});
  t.after(()=>{app.unmount();app.cleanup();});await f.controller.initialize();await app.waitUntilRenderFlush();
  let started=false;f.handler=async(_messages,{signal})=>{started=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new AppError('CANCELLED','已停止')),{once:true}));};
  await tty.key('搜索芙莉莲');await tty.key('\r');await until(()=>started);
  await tty.key('下一轮草稿');await tty.key('\r');assert.equal(f.controller.snapshot().items.filter(item=>item.kind==='user').length,1);
  await tty.key('\u0003');await until(()=>!f.controller.snapshot().busy);
  f.handler=async(_messages,{onText})=>{onText?.('新轮次完成');return{role:'assistant',content:'新轮次完成'};};
  await tty.key('\r');await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().items.some(item=>item.kind==='assistant'&&item.text==='新轮次完成'));
  assert.ok(f.controller.snapshot().items.some(item=>item.kind==='user'&&item.text==='下一轮草稿'));
});

test('实际Ink组件：/login 命令提示可选择，成功更新账户且开头无会话ID（模拟终端）',async t=>{
  const f=await chatFixture(t);const tty=terminal();
  const app=render(<ChatApp controller={f.controller}/>,{stdin:tty.stdin,stdout:tty.stdout,stderr:tty.stderr,interactive:true,exitOnCtrlC:false,patchConsole:false});
  t.after(()=>{app.unmount();app.cleanup();});await f.controller.initialize();await app.waitUntilRenderFlush();
  assert.ok(!tty.output.includes(f.controller.snapshot().sessionId));assert.ok(!tty.output.includes('会话：'));
  await tty.key('/l');await tty.key('\t');assert.match(tty.output,/\/login.*登录 Bangumi 账号/);await tty.key('\r');
  await until(()=>!f.controller.snapshot().busy&&f.controller.snapshot().login.kind==='signed-in');await app.waitUntilRenderFlush();
  assert.match(tty.output,/当前Bangumi用户：fixture/);assert.equal(f.modelRequests.length,0);
});
