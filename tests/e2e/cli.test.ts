import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/cli/main.js',import.meta.url));

test('CLI 帮助、诊断、未知写命令和会话列表；不调用网络', async t => {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-agent-cli-')); t.after(() => rm(directory,{ recursive: true, force: true }));
  const env = { ...process.env, BANGUMI_AGENT_HOME: directory, ANTHROPIC_AUTH_TOKEN: 'fake-test-token', DEEPSEEK_API_KEY: '' };
  const run = (args: string[]) => spawnSync(process.execPath,[entry,...args],{ env, encoding:'utf8',windowsHide:true,timeout:5000 });
  const help = run(['--help']); assert.equal(help.status,0); assert.match(help.stdout,/只读/); assert.match(help.stdout,/^MyBangumiAssistant 0\.1\.0/);
  const doctor = run(['doctor']); assert.equal(doctor.status,0); assert.ok(!doctor.stdout.includes('fake-test-token')); assert.equal(JSON.parse(doctor.stdout).networkChecked,false);
  const write = run(['collect','1']); assert.equal(write.status,1); assert.match(write.stderr,/未知命令/);
  const sessions = run(['sessions']); assert.equal(sessions.status,0); assert.deepEqual(JSON.parse(sessions.stdout),[]);
  const invalid = run(['search','--help']); assert.equal(invalid.status,1);
  for (const args of [['episodes','1','--all','--offset','0'], ['episodes','1','--offset','-1'], ['episodes','1','--offset','0.5'], ['episodes','1','--all','--limit','2']]) {
    const result = run(args); assert.equal(result.status,1); assert.match(result.stderr,/INVALID_INPUT/);
  }
  assert.match(help.stdout,/auth-check/); assert.match(help.stdout,/--all/);
  assert.match(help.stdout,/login-status/);assert.ok(!help.stdout.includes('preview-delete'));assert.match(help.stdout,/OAuth/);
  const deletion=run(['preview-delete','1']);assert.equal(deletion.status,1);assert.match(deletion.stderr,/UNSUPPORTED_OPERATION/);
  const status=run(['login-status']);assert.equal(status.status,0);assert.deepEqual(JSON.parse(status.stdout),{saved:false,source:'oauth',networkChecked:false});
  const logout=run(['logout']);assert.equal(logout.status,0);assert.deepEqual(JSON.parse(logout.stdout),{localAuthenticationCleared:true,serverSessionRevoked:false});
  const login=run(['login']);assert.equal(login.status,1);assert.match(login.stderr,/交互终端/);
});

test('CLI 分页、完整章节、个人进度与在线认证入口在假子进程下完整运行', async t => {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-agent-cli-')); t.after(() => rm(directory,{ recursive: true, force: true }));
  const preload = new URL('../../../tests/fixtures/bgm-preload.mjs', import.meta.url).href;
  const env = { ...process.env, BANGUMI_AGENT_HOME: directory };
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath,['--import', preload, entry, ...args],{ env, encoding:'utf8',windowsHide:true,timeout:5000 });
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes('fake-file-secret')); return JSON.parse(result.stdout);
  };
  const page = run(['episodes','400602','--offset','20']); assert.equal(page.data.length,16); assert.equal(page.complete,false);
  const all = run(['episodes','400602','--all']); assert.equal(all.data.length,36); assert.equal(all.complete,true);
  const progress = run(['progress','400602']); assert.equal(progress.detail.data.length,36); assert.equal(progress.collection.rate,8);
  const auth = run(['auth-check']); assert.deepEqual(auth, { authenticated:true, user: { id:7,username:'fixture-user' },source:'bangumi' });
  const preview = run(['preview','400602','{"rate":7}','--json']);
  assert.equal(preview.writeAvailable, false); assert.equal(preview.state, 'pending');
  assert.deepEqual(preview.actions[0].changes, [{ field:'rate',before:8,after:7 }]);
});

test('CLI 续会话、自然编号选择与复合自然语言实际执行器（假子进程）；恢复后拒绝旧确认', async t => {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-agent-dialogue-cli-')); t.after(() => rm(directory,{ recursive: true, force: true }));
  const preload = new URL('../../../tests/fixtures/dialogue-preload.mjs', import.meta.url).href;
  await writeFile(join(directory,'config.json'), JSON.stringify({ activeModel:'fixture',models:{ fixture:{ baseUrl:'http://offline.invalid',model:'fixture-model',apiKeyEnv:'FIXTURE_API_KEY' } } }));
  const env = { ...process.env, BANGUMI_AGENT_HOME:directory, FIXTURE_API_KEY:'fake-e2e-credential' };
  const spawn = (args: string[]) => spawnSync(process.execPath,['--import',preload,entry,...args],{ env,encoding:'utf8',windowsHide:true,timeout:10000 });
  const run = (args: string[]) => {
    const result = spawn(args); assert.equal(result.status,0,result.stderr); assert.ok(!result.stdout.includes('fake-e2e-credential')); return JSON.parse(result.stdout);
  };
  const search = run(['ask','搜索测试','--json']); assert.equal(search.candidates.sets[0].items[1].id,400602);
  assert.equal(search.boundary.code, 'IN_SCOPE');
  const selected = run(['ask','第二项','--resume',search.sessionId,'--json']); assert.equal(selected.answer.content.includes('#400602'),true);
  const preview = run(['ask','这个结果是对的，把他改成7分','--resume',search.sessionId,'--json']);
  assert.equal(preview.plans.length,1); assert.equal(preview.plans[0].state,'finished'); assert.equal(preview.plans[0].writeAvailable,true);
  assert.equal(preview.plans[0].results[0].state,'success');
  assert.deepEqual(preview.plans[0].actions[0].changes,[{ field:'rate',before:8,after:7 }]);
  const restoredConfirm = spawn(['ask',`/confirm ${preview.plans[0].id}`,'--resume',search.sessionId,'--json']);
  assert.equal(restoredConfirm.status,1); assert.match(restoredConfirm.stderr,/PLAN_UNAVAILABLE/);
  const naturalConfirm = run(['ask','确认执行','--resume',search.sessionId,'--json']);
  assert.match(naturalConfirm.answer.content,/没有/); assert.deepEqual(naturalConfirm.plans,[]);
});

test('CLI 越界固定回退及语义分类、混合请求和能力不足均为正常JSON结果（离线）', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bangumi-scope-cli-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const preload = new URL('../../../tests/fixtures/dialogue-preload.mjs', import.meta.url).href;
  await writeFile(join(directory, 'config.json'), JSON.stringify({ activeModel: 'fixture', models: { fixture: { baseUrl: 'http://offline.invalid', model: 'fixture-model', apiKeyEnv: 'FIXTURE_API_KEY' } } }));
  const env = { ...process.env, BANGUMI_AGENT_HOME: directory, FIXTURE_API_KEY: 'fake-scope-e2e-secret' };
  const run = (input: string, offline = true) => {
    const args = offline ? ['--import', preload, entry, 'ask', input, '--json'] : [entry, 'ask', input, '--json'];
    const result = spawnSync(process.execPath, args, { env: offline ? env : { ...env, FIXTURE_API_KEY: '' }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes(env.FIXTURE_API_KEY)); return JSON.parse(result.stdout);
  };
  const refused = run('帮我算一下数学题', false); assert.equal(refused.boundary.code, 'OUT_OF_SCOPE'); assert.match(refused.answer.content, /无法处理/); assert.deepEqual(refused.plans, []);
  assert.equal(run('以芙莉莲为背景，帮我解方程').boundary.code, 'OUT_OF_SCOPE');
  assert.equal(run('结合我的全部观看历史推荐').boundary.code, 'UNSUPPORTED_CAPABILITY');
  assert.equal(run('弄一下').boundary.code, 'CLARIFICATION_REQUIRED');
  const work = run('查一下《数学女孩》这本书'); assert.equal(work.boundary.code, 'IN_SCOPE'); assert.ok(work.candidates.sets.length);
  const mixed = run('推荐类似芙莉莲的动画，再帮我解方程'); assert.equal(mixed.boundary.code, 'MIXED_SCOPE'); assert.match(mixed.answer.content, /无法处理/); assert.ok(mixed.candidates.sets.length); assert.deepEqual(mixed.plans, []);
});
