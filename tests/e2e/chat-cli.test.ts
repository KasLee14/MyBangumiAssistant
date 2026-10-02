import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('真实chat入口普通文本回退：登录提示、连续多命令不丢行、自然选择及退出（离线）',{timeout:10000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'bangumi-chat-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'config.json'),JSON.stringify({activeModel:'fixture',models:{fixture:{baseUrl:'http://offline.invalid',model:'fixture-model',apiKeyEnv:'FIXTURE_API_KEY'}}}));
  const entry=fileURLToPath(new URL('../../src/cli/main.js',import.meta.url));
  const preload=new URL('../../../tests/fixtures/chat-cli-preload.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--import',preload,entry,'chat','--plain'],{windowsHide:true,env:{...process.env,BANGUMI_AGENT_HOME:directory,FIXTURE_API_KEY:'fake-chat-credential'},stdio:['pipe','pipe','pipe']});
  let output='';let errors='';let submitted=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',(text:string)=>{output+=text;if(!submitted&&output.includes('MyBangumiAssistant')){submitted=true;child.stdin.end('/help\n搜索测试\n第二项\n/status\n/exit\n');}});
  child.stderr.on('data',(text:string)=>{errors+=text;});t.after(()=>{child.kill();});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
  assert.equal(code,0,errors);assert.match(output,/当前未登录Bangumi账号/);assert.match(output,/Ctrl\+J/);
  assert.match(output,/MyBangumiAssistant v0\.1\.0\n当前模型：fixture-model\n当前未登录Bangumi账号/);
  assert.doesNotMatch(output,/[\u2800-\u28ff]|\u001b/);
  assert.match(output,/作品候选|候选/);assert.match(output,/已选择 #400602/);assert.match(output,/完整会话 ID/);
  assert.match(output,/\/login\s+在默认浏览器 OAuth 授权 Bangumi/);assert.match(output,/当前状态（\/status）/);
  assert.match(output,/结果未知的操作：0 项（无需核查）/);assert.doesNotMatch(output.split('/help')[0]!,/会话：/);
  assert.ok(!output.includes('fake-chat-credential'));assert.equal(errors,'');
});
