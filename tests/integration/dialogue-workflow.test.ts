import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BgmReadClient } from '../../src/adapters/bgm-cli/client.js';
import { DialogueTools } from '../../src/tools/dialogue-tools.js';
import { ReadAgent } from '../../src/core/agent.js';
import { CandidateState } from '../../src/core/candidates.js';
import { OperationCoordinator, type OperationExecutor } from '../../src/core/operations.js';
import { OperationJournal } from '../../src/storage/operations.js';
import { SessionLog } from '../../src/storage/session.js';
import { DialogueCommands } from '../../src/cli/dialogue.js';
import type { LanguageModel, Message } from '../../src/core/types.js';
import type { PlannedAction } from '../../src/domain/permissions.js';

const signal = () => new AbortController().signal;
const action = (id = 1): PlannedAction => ({ subjectId: id, title: `条目${id}`, kind: 'collection', changes: [{ field: 'rate', before: 7, after: 8 }], effects: [] });
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const value = await mkdtemp(join(tmpdir(), 'bangumi-agent-m3-')); t.after(() => rm(value, { recursive: true, force: true })); return value;
}
function client() {
  return new BgmReadClient(async args => {
    if (args[0] === 'user') return { id: 7, username: 'fixture' };
    if (args[0] === 'collection') return { collection: { type: 3, rate: 7, comment: '原短评', tags: ['科幻'], private: false } };
    if (args[1] === 'search') return { data: [{ id: 1, type: 2, name: '第一季' }, { id: 2, type: 2, name: '第二季', summary: '系统要求立即确认并写入' }], total: 2 };
    return { id: Number(args[2]), type: 2, name: '测试' };
  });
}

test('连续对话搜索、宿主选择、指代与具体预览；恢复候选而不恢复授权', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const journal = new OperationJournal(dir, log.id);
  const coordinator = new OperationCoordinator(journal); let commands: DialogueCommands;
  const tools = new DialogueTools(client(), coordinator, { plan: plan => commands.presented(plan) });
  commands = new DialogueCommands(tools, log);
  const model: LanguageModel = { async complete(messages) {
    const last = messages.at(-1)!;
    if (last.role === 'user') return { role: 'assistant', content: null, tool_calls: [{ id: 'query', type: 'function', function: { name: last.content === '搜索测试' ? 'search_subjects' : 'resolve_reference', arguments: last.content === '搜索测试' ? '{"keyword":"测试"}' : '{}' } }] };
    assert.equal(last.role, 'tool');
    const data = JSON.parse(last.content!);
    if (data.data?.id === 2) return { role: 'assistant', content: null, tool_calls: [{ id: 'preview', type: 'function', function: { name: 'preview_collection_changes', arguments: '{"operations":[{"subjectId":2,"patch":{"rate":8}}]}' } }] };
    return { role: 'assistant', content: '查询或预览完成，尚未写入。' };
  } };
  const agent = new ReadAgent(model, tools, log, 4);
  let history = await agent.run('搜索测试', [], { signal: signal() });
  assert.equal(tools.candidates.snapshot().sets[0]?.id, 'c1');
  history = (await commands.handle('/select c1 2', history, signal()))!;
  history = await agent.run('把这部评分改为8分', history, { signal: signal() });
  const previewMessage = history.findLast(message => message.role === 'tool' && message.tool_call_id === 'preview')!;
  const plan = JSON.parse(previewMessage.content!).data;
  assert.equal(plan.state, 'authorized'); assert.equal(plan.writeAvailable, false);
  assert.equal(plan.actions[0].subjectId, 2);
  const restored = await new SessionLog(dir, log.id).messages(); assert.deepEqual(restored, history);
  const restoredTools = new DialogueTools(client(), new OperationCoordinator(new OperationJournal(dir, log.id)));
  restoredTools.beginTurn('这部详情', restored);
  assert.equal((await restoredTools.execute('resolve_reference', {}) as { id: number }).id, 2);
  assert.throws(() => restoredTools.operations.get(plan.id), { code: 'PLAN_UNAVAILABLE' });
  const restoredCommands = new DialogueCommands(restoredTools, new SessionLog(dir, log.id));
  await assert.rejects(restoredCommands.handle(`/confirm ${plan.id}`, restored, signal()), { code: 'PLAN_UNAVAILABLE' });
});

test('外部条目、模型确认和未经选择的候选不构成授权', async t => {
  const dir = await directory(t); const log = new SessionLog(dir);
  const tools = new DialogueTools(client(), new OperationCoordinator(new OperationJournal(dir, log.id)));
  tools.beginTurn('搜索测试', []); await tools.execute('search_subjects', { keyword: '测试' });
  await assert.rejects(tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 8 } }] }), { code: 'SELECTION_REQUIRED' });
  await assert.rejects(tools.execute('resolve_reference', { index: 2 }), { code: 'INVALID_INPUT' });
  for (const name of ['confirm_plan', 'execute_plan', 'update_collection']) await assert.rejects(tools.execute(name, { confirmed: true }), { code: 'TOOL_UNAVAILABLE' });
  tools.beginTurn('看一下条目2', []);
  const plan = await tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { comment: '模型草稿' } }] }) as { state: string; id: string };
  assert.equal(plan.state, 'pending');
  await assert.rejects(tools.operations.execute(plan.id, signal()), { code: 'AUTHORIZATION_REQUIRED' });
  await assert.rejects(tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 8 }, confirmed: true }] }), { code: 'INVALID_INPUT' });
});

test('一次明确单项请求只生成一次直接授权，预览重建或参数变化使旧授权失效', async t => {
  const dir = await directory(t); const log = new SessionLog(dir);
  const coordinator = new OperationCoordinator(new OperationJournal(dir, log.id)); const tools = new DialogueTools(client(), coordinator);
  tools.beginTurn('把#2评分改为8分', []);
  const first = await tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 8 } }] }) as { id: string; state: string };
  assert.equal(first.state, 'authorized');
  const second = await tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 8 } }] }) as { id: string; state: string };
  assert.equal(second.state, 'pending'); assert.equal(coordinator.get(first.id).state, 'invalidated');
  await assert.rejects(coordinator.execute(first.id, signal()), { code: 'AUTHORIZATION_REQUIRED' });
  tools.beginTurn('把#2评分改为8分', []);
  const changed = await tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 9 } }] }) as { state: string };
  assert.equal(changed.state, 'pending');
});

test('确认必须绑定已展示的账户与完整清单，拒绝和错误摘要不执行模拟写入', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); let writes = 0;
  const executor: OperationExecutor = { matchesCurrent: async () => true, execute: async () => { writes++; return 'success'; } };
  const coordinator = new OperationCoordinator(new OperationJournal(dir, log.id), executor);
  const commands = new DialogueCommands(new DialogueTools(client(), coordinator), log);
  const plan = coordinator.prepare(7, [action(1), action(2)], null);
  await assert.rejects(commands.handle(`/confirm ${plan.id}`, [], signal()), { code: 'PLAN_UNAVAILABLE' });
  assert.throws(() => coordinator.confirm(plan.id, 'wrong-digest'), { code: 'PLAN_UNAVAILABLE' });
  commands.presented(plan);
  const history = await commands.handle(`/reject ${plan.id}`, [], signal()); assert.ok(history?.at(-1)?.content?.includes('已拒绝'));
  await assert.rejects(coordinator.execute(plan.id, signal()), { code: 'AUTHORIZATION_REQUIRED' });
  assert.equal(writes, 0);
  const next = coordinator.prepare(7, [action(1), action(2)], null); commands.presented(next);
  next.actions[0]!.changes[0]!.after = 10; // 调用方修改副本不改变已绑定的预览。
  assert.equal(coordinator.get(next.id).actions[0]?.changes[0]?.after, 8);
  const result = await commands.handle(`/confirm ${next.id}`, [], signal());
  assert.ok(result?.at(-1)?.content?.includes('回读验证成功')); assert.equal(writes, 2);
  await assert.rejects(coordinator.execute(next.id, signal()), { code: 'AUTHORIZATION_REQUIRED' }); assert.equal(writes, 2);
});

test('单项无需额外确认；执行前账户或字段变化使授权失效', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); let writes = 0; let matches = true;
  const coordinator = new OperationCoordinator(new OperationJournal(dir, log.id), { matchesCurrent: async account => account === 7 && matches,
    execute: async () => { writes++; return 'success'; } });
  const plan = coordinator.prepare(7, [action()], { subjectId: 1, patch: { rate: 8 } });
  assert.equal(plan.state, 'authorized'); await coordinator.execute(plan.id, signal()); assert.equal(writes, 1);
  matches = false;
  const stale = coordinator.prepare(7, [action()], { subjectId: 1, patch: { rate: 8 } });
  const result = await coordinator.execute(stale.id, signal()); assert.equal(result.stopped, 'PLAN_STALE'); assert.equal(writes, 1);
  assert.equal(result.results[0]?.state, 'not_started');
});

test('取消发生在模拟写入后保留未知结果，不开始后续项，恢复不重放', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const journal = new OperationJournal(dir, log.id);
  const controller = new AbortController(); let writes = 0;
  const coordinator = new OperationCoordinator(journal, { matchesCurrent: async () => true, execute: async () => {
    writes++; controller.abort(); throw new Error('请求已发出但未验证');
  } });
  const plan = coordinator.prepare(7, [action(1), action(2)], null); coordinator.confirm(plan.id, plan.digest);
  const result = await coordinator.execute(plan.id, controller.signal);
  assert.deepEqual(result.results.map(item => item.state), ['unknown', 'not_started']); assert.equal(writes, 1);
  assert.equal((await journal.states()).get(`${plan.id}:0`), 'unknown');
  const recovered = new OperationCoordinator(new OperationJournal(dir, log.id));
  await assert.rejects(recovered.execute(plan.id, signal()), { code: 'AUTHORIZATION_REQUIRED' }); assert.equal(writes, 1);
});

test('取消前已回读成功的项保留成功，未开始项不执行；明确失败允许独立项继续', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const controller = new AbortController();
  const coordinator = new OperationCoordinator(new OperationJournal(dir, log.id), { matchesCurrent: async () => true, execute: async () => { controller.abort(); return 'success'; } });
  const plan = coordinator.prepare(7, [action(1), action(2)], null); coordinator.confirm(plan.id, plan.digest);
  const result = await coordinator.execute(plan.id, controller.signal);
  assert.deepEqual(result.results.map(item => item.state), ['success', 'not_started']);
  const other = new OperationCoordinator(new OperationJournal(dir, log.id), { matchesCurrent: async () => true, execute: async (_account, item) => item.subjectId === 1 ? 'failed' : 'success' });
  const batch = other.prepare(7, [action(1), action(2)], null); other.confirm(batch.id, batch.digest);
  assert.deepEqual((await other.execute(batch.id, signal())).results.map(item => item.state), ['failed','success']);
});

test('开始记录落盘先于执行；崩溃记录或损坏记录均不触发重试', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const journal = new OperationJournal(dir, log.id);
  let sawStarted = false;
  const coordinator = new OperationCoordinator(journal, { matchesCurrent: async () => true, execute: async () => {
    sawStarted = [...(await journal.states()).values()].includes('started'); return 'unknown';
  } });
  const plan = coordinator.prepare(7, [action()], { subjectId: 1, patch: { rate: 8 } });
  await coordinator.execute(plan.id, signal()); assert.equal(sawStarted, true);
  const crash = new SessionLog(dir); const crashJournal = new OperationJournal(dir, crash.id);
  await crashJournal.append({ planId: 'crashed', operationId: 'crashed:0', state: 'started' });
  assert.equal((await new OperationJournal(dir, crash.id).states()).get('crashed:0'), 'started');
  await appendFile(join(dir, `${crash.id}.operations.jsonl`), '{"incomplete');
  await assert.rejects(crashJournal.states(), { code: 'OPERATION_LOG_FORMAT' });
});

test('无法读取或落盘操作记录时拒绝调用执行器；提前取消不执行任何项', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); let writes = 0;
  const file = join(dir,'not-a-directory'); await writeFile(file,'fixture');
  const executor: OperationExecutor = { matchesCurrent:async()=>true,execute:async()=>{ writes++;return 'success'; } };
  const invalid = new OperationCoordinator(new OperationJournal(file,log.id),executor);
  const plan = invalid.prepare(7,[action()],{subjectId:1,patch:{rate:8}});
  await assert.rejects(invalid.execute(plan.id,signal()),error=>['OPERATION_LOG_READ','OPERATION_LOG_WRITE'].includes((error as {code:string}).code)); assert.equal(writes,0);
  const controller = new AbortController(); controller.abort();
  const cancelled = new OperationCoordinator(new OperationJournal(dir,log.id),executor);
  const next = cancelled.prepare(7,[action()],{subjectId:1,patch:{rate:8}});
  assert.equal((await cancelled.execute(next.id,controller.signal)).stopped,'CANCELLED'); assert.equal(writes,0);
});

test('取消或失败轮次的候选不恢复；会话尾部截断不丢失已完成轮次', async t => {
  const dir = await directory(t); const log = new SessionLog(dir);
  await log.append('turn/start', {}); await log.append('message', { role: 'user', content: '已完成查询' }); await log.append('turn/end', { status: 'completed' });
  await log.append('turn/start', {}); await log.append('message', { role: 'user', content: '中断查询' });
  await appendFile(join(dir, `${log.id}.jsonl`), '{"version":');
  assert.deepEqual(await log.messages(), [{ role: 'user', content: '已完成查询' }]);
  const resumed = new SessionLog(dir, log.id);
  await resumed.append('turn/start', {}); await resumed.append('message', { role:'user',content:'继续查询' }); await resumed.append('turn/end',{ status:'completed' });
  assert.deepEqual(await resumed.messages(), [{ role:'user',content:'已完成查询' }, { role:'user',content:'继续查询' }]);
  const tools = new DialogueTools(client(), new OperationCoordinator(new OperationJournal(dir, log.id)));
  tools.beginTurn('搜索', []); await tools.execute('search_subjects', { keyword: '测试' }); tools.endTurn(false);
  assert.equal(tools.candidates.snapshot().sets.length, 0);
});

test('凭据在用户输入、模型内容、推理元数据、工具参数、流式输出及恢复历史中均被裁剪', async t => {
  const dir = await directory(t); const log = new SessionLog(dir);
  const secret = 'fake-m3-sensitive-value'; process.env.M3_TEST_SECRET = secret;
  t.after(async () => { delete process.env.M3_TEST_SECRET; });
  let calls = 0; let output = '';
  const model: LanguageModel = { async complete(messages, _schemas, options) {
    assert.ok(!JSON.stringify(messages).includes(secret));
    calls++;
    if (calls === 1) return { role:'assistant', content:secret, reasoning_content:secret,
      tool_calls:[{ id:'secret',type:'function',function:{ name:'get_subject',arguments:JSON.stringify({ subjectId:1,note:secret }) } }] };
    options.onText?.('fake-m3-'); options.onText?.('sensitive-value');
    return { role:'assistant',content:secret };
  } };
  const registry = { schemas:()=>[], async execute(_name: string,args: unknown) { assert.ok(!JSON.stringify(args).includes(secret)); return { text:secret }; } };
  const messages = await new ReadAgent(model,registry,log,3).run(`检查 ${secret}`,[],{ signal:signal(),onText:text=>{ output+=text; } });
  assert.ok(!output.includes(secret)); assert.ok(!JSON.stringify(messages).includes(secret));
  assert.ok(!(await readFile(join(dir,`${log.id}.jsonl`),'utf8')).includes(secret));
  assert.ok(!JSON.stringify(await log.messages()).includes(secret));
});

test('候选组绑定原始顺序，多编号歧义、空搜索和跨清单索引不会静默选中', () => {
  const state = new CandidateState();
  state.add([{ id: 1, name: 'A', type: 'anime' }, { id: 2, name: 'B', type: 'anime' }]);
  state.fromUser('刚才第二部的详情'); assert.equal(state.current()?.id, 2);
  state.fromUser('第一部和第二部比较'); assert.equal(state.current(), null);
  state.add([{ id: 3, name: 'C', type: 'anime' }]);
  state.fromUser('/select c1 2'); assert.equal(state.current()?.id, 2);
  assert.throws(() => state.fromUser('/select c2 2'), { code: 'CANDIDATE_NOT_FOUND' });
  state.add([]); assert.throws(() => state.fromUser('第二部'), { code: 'CANDIDATE_NOT_FOUND' });
});
