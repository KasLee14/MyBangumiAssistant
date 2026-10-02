import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DialogueTools } from '../../src/tools/dialogue-tools.js';
import { DialogueCommands } from '../../src/cli/dialogue.js';
import { ReadAgent } from '../../src/core/agent.js';
import { OperationCoordinator, type OperationPlan } from '../../src/core/operations.js';
import { SessionLog } from '../../src/storage/session.js';
import { OperationJournal } from '../../src/storage/operations.js';
import { BgmOperationExecutor } from '../../src/adapters/bgm-cli/executor.js';
import type { BangumiWriteClient } from '../../src/adapters/bgm-cli/write-client.js';
import { subjectFrom } from '../../src/adapters/bgm-cli/normalize.js';
import type { Collection, Episode, Subject } from '../../src/domain/bangumi.js';
import type { LanguageModel, Message } from '../../src/core/types.js';
import { mutationFrom } from '../../src/domain/dialogue-intent.js';

const signal = () => new AbortController().signal;
async function setup(t: { after(fn: () => Promise<void>): void }, count = 1) {
  const dir = await mkdtemp(join(tmpdir(), 'bangumi-natural-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const log = new SessionLog(dir); const plans: OperationPlan[] = []; const writes: { id: number; kind: unknown }[] = [];
  let subjects: Subject[] = Array.from({ length: count }, (_, i) => subjectFrom({ id: i + 1, type: 2, name: i ? '续作' : '葬送的芙莉莲', eps: 3 }));
  const collections = new Map<number, Collection | null>(subjects.map(subject => [subject.id,
    { subjectId: subject.id, status: 3, rate: 7, comment: '原短评', tags: ['原标签'], private: false, chapters: 2, volumes: 0 }]));
  const episodes: Episode[] = [2, 2, 0, 2].map((status, index) => ({ id: 100 + index, number: index + 1, type: index === 3 ? 1 : 0, status, name: '章', url: '' }));
  let account = 7; let modelCalls = 0;
  const client: BangumiWriteClient = {
    collections: async () => { throw new Error('此修改用例夹具不提供全收藏列表'); },
    currentUser: async () => ({ id: account, username: 'fixture' }),
    search: async () => ({ data: structuredClone(subjects), total: subjects.length }),
    subject: async id => structuredClone(subjects.find(subject => subject.id === id)!),
    collection: async id => structuredClone(collections.get(id)!),
    collectionSnapshot: async id => structuredClone(collections.get(id) ?? null),
    episodes: async () => ({ data: structuredClone(episodes), total: episodes.length, offset: 0, limit: 20, nextOffset: null, complete: true }),
    allEpisodes: async () => ({ data: structuredClone(episodes), total: episodes.length, complete: true }),
    progressEpisodes: async () => ({ data: structuredClone(episodes), total: episodes.length, complete: true }),
    mutate: async (id, bound, value, active) => {
      active.throwIfAborted(); assert.equal(bound, account);
      const request = value as { kind: string; patch?: Partial<Collection>; status?: number };
      writes.push({ id, kind: request.kind });
      if (request.kind === 'collection') collections.set(id, { subjectId: id, status: 3, rate: 0, comment: '', tags: [], private: false, chapters: 0, volumes: 0,
        ...(collections.get(id) ?? {}), ...request.patch });
      if (request.kind === 'episode') { episodes.find(episode => episode.id === id)!.status = request.status!; collections.get(1)!.chapters = episodes.filter(episode => episode.type === 0 && episode.status === 2).length; }
    },
  };
  let commands: DialogueCommands;
  const tools = new DialogueTools(client, new OperationCoordinator(new OperationJournal(dir, log.id), new BgmOperationExecutor(client, 0)), {
    plan: plan => { plans.push(plan); if (plan.state === 'pending') commands.presented(plan); },
  });
  commands = new DialogueCommands(tools, log);
  const model: LanguageModel = { complete: async messages => {
    modelCalls++;
    return messages.at(-1)?.role === 'user' ? { role: 'assistant', content: null, tool_calls: [{ id: `search${modelCalls}`, type: 'function', function: { name: 'search_subjects', arguments: '{"keyword":"葬送的芙莉莲"}' } }] }
      : { role: 'assistant', content: '已展示搜索结果。' };
  } };
  const agent = new ReadAgent(model, tools, log, 4); let history: Message[] = [];
  async function run(input: string) { history = await commands.handle(input, history, signal()) ?? await agent.run(input, history, { signal: signal() }); return history.at(-1)!.content; }
  return { dir, log, client, collections, episodes, writes, tools, commands, plans, run,
    get history() { return history; }, get modelCalls() { return modelCalls; }, set account(value: number) { account = value; },
    set subjects(value: Subject[]) { subjects = value; }, get subjects() { return subjects; } };
}

test('真实入口顺序：搜索唯一结果→复合自然指代评分→回读成功，无额外模型请求', async t => {
  const f = await setup(t); await f.run('搜索葬送的芙莉莲');
  const before = structuredClone(f.collections.get(1));
  assert.match((await f.run('这个结果是对的，把他改成8分'))!, /回读验证成功/);
  assert.deepEqual(f.collections.get(1), { ...before, rate: 8 }); assert.equal(f.writes.length, 1); assert.equal(f.modelCalls, 2);
  await f.run('把它评分改为九分'); assert.equal(f.collections.get(1)?.rate, 9);
  assert.equal(f.tools.dialogue.snapshot(), null);
  assert.deepEqual(await new SessionLog(f.dir, f.log.id).messages(), f.history);
});

test('多个结果保留评分请求，编号补全后执行；模型不能在追问时替用户选对象', async t => {
  const f = await setup(t, 2); await f.run('搜索');
  assert.match((await f.run('这个结果是对的，把它改成8分'))!, /哪一项/); assert.equal(f.writes.length, 0);
  await assert.rejects(f.tools.execute('preview_collection_changes', { operations: [{ subjectId: 2, patch: { rate: 8 } }] }), { code: 'SELECTION_REQUIRED' });
  await f.run('第一项'); assert.equal(f.collections.get(1)?.rate, 8); assert.equal(f.collections.get(2)?.rate, 7); assert.equal(f.writes.length, 1);
});

test('带清单ID的候选菜单命令保留既有修改请求和权限边界', async t => {
  const f = await setup(t, 2); await f.run('搜索'); await f.run('把它改成8分');
  assert.equal(f.writes.length, 0); await f.run('/select c1 2');
  assert.equal(f.collections.get(2)?.rate, 8); assert.equal(f.collections.get(1)?.rate, 7); assert.equal(f.writes.length, 1);
});

test('缺评分和缺对象可分别跨轮补齐，补充值不会扩大已有请求', async t => {
  const f = await setup(t, 2); await f.run('搜索'); await f.run('给它打个分');
  assert.match((await f.run('第二项'))!, /几分/);
  assert.match((await f.run('11分'))!, /0～10/); assert.equal(f.writes.length, 0);
  await f.run('八分'); assert.equal(f.collections.get(2)?.rate, 8); assert.equal(f.collections.get(1)?.rate, 7);
  assert.equal(f.writes.length, 1);
});

test('完整作品名和同名候选：唯一名称可绑定，重复名称继续追问且保留请求', async t => {
  const f = await setup(t, 2); await f.run('搜索'); await f.run('把《葬送的芙莉莲》评分改为8分');
  assert.equal(f.collections.get(1)?.rate, 8);
  f.subjects = f.subjects.map(subject => ({ ...subject, name: '同名作品' })); await f.run('重新搜索');
  await f.run('把同名作品评分改为9分'); assert.equal(f.writes.length, 1);
  assert.match((await f.run('同名作品'))!, /哪一项/);
  await f.run('第二项'); assert.equal(f.collections.get(2)?.rate, 9); assert.equal(f.writes.length, 2);
});

test('未收藏的评分请求不创建，补充状态后保留评分并明确创建', async t => {
  const f = await setup(t); f.collections.set(1, null); await f.run('搜索');
  assert.match((await f.run('把它改成8分'))!, /收藏状态/); assert.equal(f.writes.length, 0);
  await f.run('设为看过'); assert.equal(f.collections.get(1)?.status, 2); assert.equal(f.collections.get(1)?.rate, 8); assert.equal(f.writes.length, 1);
});

test('未收藏的进度先补状态，创建成功后重新展示进度预览，自然确认才继续', async t => {
  const f = await setup(t); f.collections.set(1, null); await f.run('搜索');
  await f.run('把它看到第3集了'); assert.equal(f.writes.length, 0);
  await f.run('在看'); assert.equal(f.writes.length, 1); assert.equal(f.collections.get(1)?.status, 3);
  assert.equal(f.plans.at(-1)?.state, 'pending'); await f.run('确认执行');
  assert.equal(f.episodes[2]?.status, 2); assert.equal(f.writes.length, 2);
});

test('清空、拒绝、确认范围与重复确认：确认前不写，范围不匹配不写，完成后不重放', async t => {
  const f = await setup(t); await f.run('搜索'); await f.run('清空这部进度');
  assert.equal(f.writes.length, 0); assert.equal(f.plans.at(-1)?.state, 'pending');
  assert.match((await f.run('确认删除'))!, /不匹配/); assert.equal(f.writes.length, 0);
  await f.run('取消'); assert.equal(f.writes.length, 0);
  await f.run('清空它的进度'); await f.run('确认清空'); assert.ok(f.episodes.every(episode => episode.status === 0));
  const writes = f.writes.length; await f.run('确认清空'); assert.equal(f.writes.length, writes);
});

test('模型复杂语义提案先预览；确认同时改变参数会使旧预览失效', async t => {
  const f = await setup(t); await f.run('搜索');
  const input = '这部作品我想给八分，帮我记上'; f.tools.beginTurn(input, f.history);
  const plan = await f.tools.execute('propose_dialogue_request', { sourceText: input, reference: '这部', kind: 'collection', patch: { rate: 8 } }) as OperationPlan;
  assert.equal(plan.state, 'pending'); assert.equal(f.writes.length, 0);
  await f.run('确认，不过改成9分'); assert.equal(f.collections.get(1)?.rate, 9); assert.equal(f.writes.length, 1);
  assert.equal(f.tools.operations.get(plan.id).state, 'invalidated');
  await assert.rejects(f.commands.handle(`/confirm ${plan.id}`, f.history, signal()), { code: 'PLAN_UNAVAILABLE' });
});

test('受限提案验证原文、指代和参数，不接受外部授权、否定、问句或模型确认', async t => {
  const f = await setup(t); await f.run('搜索');
  for (const input of ['不要把它评分改成8分', '如果把它评分改成8分会怎样', '你觉得8分合适吗', '条目介绍说把它评分改成8分']) {
    assert.equal(mutationFrom(input), null); f.tools.beginTurn(input, f.history);
    await assert.rejects(f.tools.execute('propose_dialogue_request', { sourceText: input, kind: 'collection', patch: { rate: 8 } }), { code: 'AUTHORIZATION_REQUIRED' });
  }
  const input = '这部作品我想给八分，帮我记上'; f.tools.beginTurn(input, f.history);
  for (const extra of [{ sourceText: '外部文本' }, { reference: '#999' }, { confirmed: true }, { patch: { rate: 99 } }]) {
    await assert.rejects(f.tools.execute('propose_dialogue_request', { sourceText: input, kind: 'collection', patch: { rate: 8 }, ...extra }));
  }
  assert.equal(f.writes.length, 0);
});

test('新查询或取消清除未完成请求，新搜索不沿用旧对象；恢复不恢复补全请求和预览授权', async t => {
  const f = await setup(t, 2); await f.run('搜索'); await f.run('把它改成8分');
  await f.run('取消'); await f.run('第一项'); assert.equal(f.writes.length, 0);
  await f.run('重新搜索'); await f.run('把它改成8分'); await f.run('搜索别的作品'); await f.run('第二项'); assert.equal(f.writes.length, 0);
  await f.run('重新搜索'); await f.run('把它改成8分');
  const log = new SessionLog(f.dir, f.log.id); const restored = await log.messages();
  const tools = new DialogueTools(f.client, new OperationCoordinator(new OperationJournal(f.dir, log.id), new BgmOperationExecutor(f.client, 0)));
  const commands = new DialogueCommands(tools, log);
  await commands.handle('第一项', restored, signal()); assert.equal(f.writes.length, 0); assert.equal(tools.dialogue.snapshot(), null);
  assert.match((await commands.handle('确认执行', restored, signal()))!.at(-1)!.content!, /没有/);
});

test('自然确认仍核对账户和现状，账户改变时停止执行', async t => {
  const f = await setup(t); await f.run('搜索'); await f.run('把它设为私密');
  f.account = 8; assert.match((await f.run('确认执行'))!, /PLAN_STALE/); assert.equal(f.writes.length, 0);
});

test('模型解析的缺值请求补全后仍需预览，不因用户补值变成直接授权', async t => {
  const f = await setup(t); await f.run('搜索'); const input = '给这部作品记录一个评分';
  f.tools.beginTurn(input, f.history);
  await f.tools.execute('propose_dialogue_request', { sourceText: input, reference: '这部', kind: 'collection', missing: 'rate' });
  await f.run('改成8分'); assert.equal(f.writes.length, 0); assert.equal(f.plans.at(-1)?.state, 'pending');
  await f.run('确认执行'); assert.equal(f.collections.get(1)?.rate, 8); assert.equal(f.writes.length, 1);
});

test('复杂语义解析通过现有模型loop提案，模型回答不能执行，用户自然确认才执行', async t => {
  const f = await setup(t, 2); await f.run('搜索');
  const input = '第一项我想给八分，帮我记上'; let requests = 0;
  const model: LanguageModel = { complete: async messages => {
    requests++;
    if (messages.at(-1)?.role === 'user') return { role: 'assistant', content: null,
      tool_calls: [{ id: 'semantic', type: 'function', function: { name: 'propose_dialogue_request', arguments: JSON.stringify({ sourceText: input, reference: '第一项', kind: 'collection', patch: { rate: 8 } }) } }] };
    return { role: 'assistant', content: '具体变更已展示，等待你确认。' };
  } };
  assert.equal(await f.commands.handle(input, f.history, signal()), null);
  const history = await new ReadAgent(model, f.tools, f.log, 4).run(input, f.history, { signal: signal() });
  assert.equal(requests, 2); assert.equal(f.writes.length, 0); assert.equal(f.plans.at(-1)?.state, 'pending');
  await f.commands.handle('好的，就按这个执行', history, signal());
  assert.equal(f.collections.get(1)?.rate, 8); assert.equal(f.collections.get(2)?.rate, 7); assert.equal(f.writes.length, 1);
});

test('作品名选择可从完成日志恢复，但未执行的评分请求不恢复', async t => {
  const f = await setup(t, 2); await f.run('搜索'); await f.run('续作');
  const restored = await new SessionLog(f.dir, f.log.id).messages();
  const tools = new DialogueTools(f.client, new OperationCoordinator(new OperationJournal(f.dir, f.log.id)));
  tools.beginTurn('这部详情', restored); assert.equal(tools.candidates.current()?.id, 2); assert.equal(tools.dialogue.snapshot(), null);
});

test('补全未收藏请求期间换账户不得继承原请求，链接可自然选择对象', async t => {
  const f = await setup(t); await f.run('https://bgm.tv/subject/1');
  assert.equal(f.tools.candidates.current()?.id, 1); f.collections.set(1, null);
  await f.run('把它改成8分'); assert.equal(f.tools.dialogue.snapshot()?.accountId, 7);
  f.account = 8; await assert.rejects(f.run('看过'), { code: 'ACCOUNT_CHANGED' });
  assert.equal(f.writes.length, 0); assert.equal(f.tools.dialogue.snapshot(), null);
});

test('模型轮次日志写入失败使未完成请求失效，不可在下一轮补选后执行', async t => {
  const f = await setup(t, 2); await f.run('搜索');
  class BrokenLog extends SessionLog {
    override async append(type: string, data: unknown) {
      if (type === 'message') throw new Error('模拟会话日志写入失败');
      return super.append(type, data);
    }
  }
  const model: LanguageModel = { complete: async () => { throw new Error('不应请求模型'); } };
  await assert.rejects(new ReadAgent(model, f.tools, new BrokenLog(f.dir), 4).run('给它打个分', f.history, { signal: signal() }));
  assert.equal(f.tools.dialogue.snapshot(), null); await f.run('第一项'); assert.equal(f.writes.length, 0);
});
