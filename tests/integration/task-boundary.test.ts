import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopedConversation } from '../../src/core/scoped-conversation.js';
import { ReadAgent } from '../../src/core/agent.js';
import { BOUNDARY_PROMPT, scopeHistory } from '../../src/core/task-boundary.js';
import type { AgentEvent } from '../../src/core/events.js';
import { DialogueTools } from '../../src/tools/dialogue-tools.js';
import { DialogueCommands } from '../../src/cli/dialogue.js';
import { OperationCoordinator, type OperationPlan } from '../../src/core/operations.js';
import { SessionLog } from '../../src/storage/session.js';
import { OperationJournal } from '../../src/storage/operations.js';
import { SCOPE_REFUSAL, BOUNDARY_UNAVAILABLE, type ScopeDecision } from '../../src/domain/task-scope.js';
import type { LanguageModel, Message, ToolCall } from '../../src/core/types.js';
import type { BangumiReadClient } from '../../src/adapters/bgm-cli/client.js';

const signal = () => new AbortController().signal;
const decision = (kind: ScopeDecision['kind'] = 'in_scope', reason: ScopeDecision['reason'] = 'bangumi', allowedParts: string[] = []) =>
  ({ kind, reason, goal: '测试目标', allowedParts });
const call = (name: string, args: unknown): ToolCall => ({ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
async function setup(t: { after(fn: () => Promise<void>): void }, model: LanguageModel) {
  const dir = await mkdtemp(join(tmpdir(), 'bangumi-boundary-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const log = new SessionLog(dir); const plans: OperationPlan[] = []; let calls = 0; let writes = 0;
  const subject = { id: 1, type: 'anime' as const, name: '芙莉莲', nameCn: '葬送的芙莉莲', date: '', summary: '旅途', score: 8, rank: 1, totalEpisodes: 28, url: 'https://bgm.tv/subject/1' };
  const collection = { subjectId: 1, status: 3, rate: 7, comment: '', tags: [], private: false, chapters: 0, volumes: 0 };
  const client: BangumiReadClient = {
    collections: async () => { calls++; throw new Error('此边界夹具不提供全收藏列表'); },
    search: async () => { calls++; return { data: [subject], total: 1 }; }, subject: async () => { calls++; return subject; },
    collection: async () => { calls++; return collection; }, currentUser: async () => { calls++; return { id: 7, username: 'fixture' }; },
    episodes: async () => { calls++; return { data: [], total: 0, offset: 0, limit: 20, nextOffset: null, complete: true }; },
    allEpisodes: async () => { calls++; return { data: [], total: 0, complete: true }; },
  };
  let commands: DialogueCommands;
  const tools = new DialogueTools(client, new OperationCoordinator(new OperationJournal(dir, log.id), {
    matchesCurrent: async () => true, execute: async () => { writes++; return 'success'; },
  }), { plan: plan => { plans.push(plan); if (plan.state === 'pending') commands.presented(plan); } });
  commands = new DialogueCommands(tools, log);
  const scoped = new ScopedConversation(model, new ReadAgent(model, tools, log, 4), tools, commands, log);
  let history: Message[] = [];
  return { dir, log, tools, commands, plans, get history() { return history; }, get calls() { return calls; }, get writes() { return writes; },
    run: async (input: string, active = signal()) => { const result = await scoped.run(input, history, { signal: active }); history = result.messages; return result; }, scoped };
}

test('明确数学命令固定拒绝，不请求模型/账户、不产生计划；正常记录并可恢复', async t => {
  let models = 0;
  const f = await setup(t, { complete: async () => { models++; throw new Error('不应请求模型'); } });
  const result = await f.run('帮我算一下数学题');
  assert.equal(result.boundary.code, 'OUT_OF_SCOPE'); assert.equal(result.messages.at(-1)?.content, SCOPE_REFUSAL);
  assert.equal(models, 0); assert.equal(f.calls, 0); assert.equal(f.writes, 0); assert.deepEqual(f.plans, []);
  assert.deepEqual(await new SessionLog(f.dir, f.log.id).messages(), result.messages);
});
test('取消收藏的完整请求明确回退，不读取账号或让模型提出替代写入', async t => {
  let models = 0; const f = await setup(t, { complete: async () => { models++; throw new Error('不应请求模型'); } });
  for (const input of ['取消某部动画的收藏', '删除某部动画的收藏', '移除某部动画的收藏']) {
    const result = await f.run(input); assert.equal(result.boundary.code, 'UNSUPPORTED_CAPABILITY'); assert.match(result.messages.at(-1)!.content!, /条目取消收藏暂未开放/);
  }
  assert.equal(models, 0); assert.equal(f.calls, 0); assert.equal(f.writes, 0); assert.deepEqual(f.plans, []);
});

test('本地回退不报告模型请求阶段，只有实际语义分类才发出scope事件', async t => {
  const events: AgentEvent[] = [];
  const f = await setup(t, { complete: async () => ({ role: 'assistant', content: JSON.stringify(decision('out_of_scope', 'general_task')) }) });
  await f.scoped.run('帮我算一下数学题', [], { signal: signal(), onEvent: event => events.push(event) }); assert.equal(events.length, 0);
  await f.scoped.run('以芙莉莲为背景解方程', [], { signal: signal(), onEvent: event => events.push(event) });
  assert.deepEqual(events, [{ type: 'model/start', stage: 'scope' }]); assert.equal(f.calls, 0);
});

test('语义分类无工具，不展示分类正文或推理；越界包装、社区及排除项由宿主固定返回', async t => {
  let models = 0;
  const f = await setup(t, { complete: async (messages, schemas, options) => {
    models++; assert.equal(messages[0]?.content, BOUNDARY_PROMPT); assert.deepEqual(schemas, []); assert.equal(options.onText, undefined);
    return { role: 'assistant', content: JSON.stringify(decision('out_of_scope', models === 1 ? 'general_task' : 'community')), reasoning_content: '不要展示的推理' };
  } });
  assert.equal((await f.run('以芙莉莲为背景，求这个方程的解')).boundary.code, 'OUT_OF_SCOPE');
  assert.match((await f.run('帮我在讨论区发帖')).messages.at(-1)?.content ?? '', /社区/);
  assert.equal(f.calls, 0); assert.equal(f.writes, 0);
  const body = await readFile(join(f.dir, `${f.log.id}.jsonl`), 'utf8'); assert.ok(!body.includes('不要展示的推理')); assert.ok(!body.includes('测试目标'));
});

test('作品名含数学、观看时间计算、类似动画推荐及短评草稿可以进入正常模型循环', async t => {
  let classification = 0; let business = 0;
  const f = await setup(t, { complete: async (messages, schemas) => {
    if (schemas.length === 0) { classification++; return { role: 'assistant', content: JSON.stringify(decision()) }; }
    business++;
    if (messages.at(-1)?.role === 'user') return { role: 'assistant', content: null, tool_calls: [call('search_subjects', { keyword: '动画', type: 'anime' })] };
    return { role: 'assistant', content: '查询后给出资料、计算或建议。' };
  } });
  for (const text of ['查一下《数学女孩》这本书', '还剩12集，每集24分钟，看完要多久？',
    '我刚看了葬送的芙莉莲，还有什么类似的动画可以推荐？', '帮我写一段这部动画的收藏短评']) {
    assert.equal((await f.run(text)).boundary.code, 'IN_SCOPE');
  }
  assert.equal(classification, 4); assert.equal(business, 8); assert.equal(f.calls, 4); assert.equal(f.writes, 0);
});

test('能力不足、含义不清使用固定回退，不进入业务循环', async t => {
  let calls = 0;
  const f = await setup(t, { complete: async () => ({ role: 'assistant', content: JSON.stringify(++calls === 1
    ? decision('unsupported', 'missing_history') : decision('clarify', 'unclear')) }) });
  const missing = await f.run('结合我的全部观看历史推荐'); assert.equal(missing.boundary.code, 'UNSUPPORTED_CAPABILITY');
  assert.match(missing.messages.at(-1)?.content ?? '', /现存收藏.*没有包含已删除记录/);
  assert.equal((await f.run('弄一下')).boundary.code, 'CLARIFICATION_REQUIRED'); assert.equal(f.calls, 0);
});

test('混合请求只把原文可处理片段送入回答模型，原文日志保留；未来上下文不重放拒绝部分', async t => {
  let classification = 0; let business = 0;
  const original = '推荐类似芙莉莲的动画，再帮我解方程'; const allowed = '推荐类似芙莉莲的动画';
  const f = await setup(t, { complete: async (messages, schemas) => {
    if (!schemas.length) { classification++; return { role: 'assistant', content: JSON.stringify(classification === 1
      ? decision('mixed', 'general_task', [allowed]) : decision()) }; }
    business++; assert.ok(!JSON.stringify(messages).includes('再帮我解方程'));
    if (business === 1) assert.equal(messages.at(-1)?.content, allowed);
    return { role: 'assistant', content: '可以围绕旅行主题查询作品。' };
  } });
  const mixed = await f.run(original); assert.equal(mixed.boundary.code, 'MIXED_SCOPE'); assert.match(mixed.messages.at(-1)?.content ?? '', /无法处理/);
  assert.equal(mixed.messages[0]?.content, original);
  await f.run('偏旅行冒险');
  const restored = await new SessionLog(f.dir, f.log.id).messages();
  assert.equal(restored[0]?.content, original); assert.equal(scopeHistory(restored)[0]?.content, allowed);
});

test('混合请求摘录评分命令不能获得直接授权，模型伪造sourceText被拒绝，真实原文仍可生成待确认预览', async t => {
  const allowed = '把#1评分改为8分'; const original = `${allowed}，再帮我解方程`;
  let business = 0;
  const f = await setup(t, { complete: async (messages, schemas) => {
    if (!schemas.length) return { role: 'assistant', content: JSON.stringify(decision('mixed', 'general_task', [allowed])) };
    business++;
    if (business === 1) return { role: 'assistant', content: null, tool_calls: [call('propose_dialogue_request', { sourceText: allowed, reference: '#1', kind: 'collection', patch: { rate: 8 } })] };
    if (business === 2) {
      assert.match(messages.at(-1)?.content ?? '', /AUTHORIZATION_REQUIRED/);
      return { role: 'assistant', content: null, tool_calls: [call('preview_collection_changes', { operations: [{ subjectId: 1, patch: { rate: 8 } }] })] };
    }
    return { role: 'assistant', content: '评分变更需确认。' };
  } });
  await f.run(original); assert.equal(f.plans.at(-1)?.state, 'pending'); assert.equal(f.writes, 0);
  await f.run('确认执行'); assert.equal(f.writes, 1);
});

test('越界话题使旧预览与未完成补全失效，确认不能写入；明确补全/选择/取消不调用分类器', async t => {
  const f = await setup(t, { complete: async () => { throw new Error('宿主交互不应调用模型'); } });
  f.tools.hydrate([]);
  f.tools.candidates.add([{ id: 1, name: '葬送的芙莉莲', type: 'anime' }]);
  await f.run('第一项'); await f.run('给它打个分'); assert.equal(f.tools.dialogue.snapshot()?.draft.missing, 'rate');
  await f.run('8分'); assert.equal(f.writes, 1);
  await f.run('把这部改为私密'); const plan = f.plans.at(-1)!; assert.equal(plan.state, 'pending');
  await f.run('帮我算一下数学题'); assert.equal(f.tools.operations.get(plan.id).state, 'invalidated');
  await f.run('确认执行'); assert.equal(f.writes, 1);
  await assert.rejects(f.run(`/confirm ${plan.id}`), { code: 'PLAN_UNAVAILABLE' });
  await f.run('给它打个分'); await f.run('帮我算一下数学题'); assert.equal(f.tools.dialogue.snapshot(), null);
  await f.run('取消'); assert.equal(f.writes, 1);
});

test('被拒绝任务的接续仍交给分类器判断，拒绝内容不进入后续回答模型的历史', async t => {
  let classification = 0;
  const f = await setup(t, { complete: async (messages, schemas) => {
    if (!schemas.length) {
      classification++; const data = JSON.parse(messages[1]!.content!);
      if (classification === 1) {
        assert.equal(data.input, '继续解上题'); assert.equal(data.context.previousBoundary, 'OUT_OF_SCOPE');
        return { role: 'assistant', content: JSON.stringify(decision('out_of_scope', 'general_task')) };
      }
      return { role: 'assistant', content: JSON.stringify(decision()) };
    }
    assert.ok(!JSON.stringify(messages).includes('帮我算一下数学题')); assert.ok(!JSON.stringify(messages).includes('继续解上题'));
    return { role: 'assistant', content: '继续处理作品查询。' };
  } });
  await f.run('帮我算一下数学题'); assert.equal((await f.run('继续解上题')).boundary.code, 'OUT_OF_SCOPE');
  await f.run('查一下芙莉莲'); assert.equal(f.calls, 0);
});

test('分类超时、无效JSON、工具调用或改写片段都停止业务处理；取消不作为拒绝完成', async t => {
  let calls = 0;
  const f = await setup(t, { complete: async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    if (calls === 2) return { role: 'assistant', content: '分类坏了' };
    if (calls === 3) return { role: 'assistant', content: JSON.stringify(decision()), tool_calls: [call('get_subject', { subjectId: 1 })] };
    return { role: 'assistant', content: JSON.stringify(decision('mixed', 'general_task', ['新增的修改命令'])) };
  } });
  for (let i = 0; i < 4; i++) {
    const result = await f.run('查询作品并做别的事'); assert.equal(result.boundary.code, 'BOUNDARY_UNAVAILABLE');
    assert.equal(result.messages.at(-1)?.content, BOUNDARY_UNAVAILABLE);
  }
  assert.equal(f.calls, 0); assert.equal(f.writes, 0); assert.equal(f.plans.length, 0);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.run('查询作品', controller.signal));
});

test('分类只收到有限上下文和能力名，不发送工具历史、凭据；取消分类时清除旧授权', async t => {
  process.env.SCOPE_TEST_SECRET = 'fake-boundary-secret'; t.after(() => { delete process.env.SCOPE_TEST_SECRET; });
  const controller = new AbortController();
  const f = await setup(t, { complete: async (messages, schemas, options) => {
    assert.deepEqual(schemas, []); assert.equal(options.onText, undefined); assert.ok(!JSON.stringify(messages).includes('fake-boundary-secret'));
    const data = JSON.parse(messages[1]!.content!); assert.ok(data.context.previousReply.length <= 400); assert.ok(data.context.previousInput.length <= 500);
    assert.ok(!JSON.stringify(messages).includes('不应上传的账户完整数据'));
    controller.abort(); throw new Error('cancelled');
  } });
  const plan = f.tools.operations.prepare(7, [{ subjectId: 1, title: '作品', kind: 'collection', effects: [], changes: [{ field: 'rate', before: 7, after: 8 }] }], null);
  f.commands.presented(plan);
  const history: Message[] = [{ role: 'user', content: '前一请求'.repeat(200) }, { role: 'tool', tool_call_id: 'unused', content: '不应上传的账户完整数据' }, { role: 'assistant', content: '回复'.repeat(300) }];
  await assert.rejects(f.scoped.run('查询 fake-boundary-secret', history, { signal: controller.signal }));
  assert.equal(f.tools.operations.get(plan.id).state, 'invalidated'); assert.equal(f.calls, 0);
});
