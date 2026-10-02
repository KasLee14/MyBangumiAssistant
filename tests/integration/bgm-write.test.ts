import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BgmOperationExecutor } from '../../src/adapters/bgm-cli/executor.js';
import { BgmWriteClient, type BangumiWriteClient } from '../../src/adapters/bgm-cli/write-client.js';
import { BgmReadClient, createBgmRunner } from '../../src/adapters/bgm-cli/client.js';
import { subjectFrom } from '../../src/adapters/bgm-cli/normalize.js';
import { collectionWriteAction,deleteCollectionAction } from '../../src/domain/collection-plan.js';
import { progressAction, progressRequest } from '../../src/domain/progress-plan.js';
import { permissionFor, directIntentFrom } from '../../src/domain/permissions.js';
import { AppError } from '../../src/domain/errors.js';
import { OperationCoordinator } from '../../src/core/operations.js';
import { DialogueTools } from '../../src/tools/dialogue-tools.js';
import { OperationJournal } from '../../src/storage/operations.js';
import { SessionLog } from '../../src/storage/session.js';
import { DialogueCommands } from '../../src/cli/dialogue.js';
import type { Collection, MediaType, Episode } from '../../src/domain/bangumi.js';

const signal = () => new AbortController().signal;
function fixture(type: MediaType = 'anime') {
  const typeIds = { anime: 2, book: 1, music: 3, game: 4, real: 6 };
  const subject = subjectFrom({ id: 1, type: typeIds[type], name: '测试', eps: 4, volumes: 3 });
  const initial: Collection = { subjectId: 1, status: 3, rate: 7, comment: '原短评', tags: ['科幻,动画'], private: true, chapters: 1, volumes: 1 };
  let current: Collection | null = structuredClone(initial); let account = 7; let writes = 0;
  let episodes: Episode[] = [0,2,0,2,2].map((status,index) => ({ id: index + 10, type: index === 4 ? 1 : 0, number: index + 1, name: '章', status, url: '' }));
  let mutation: ((id: number, request: Record<string, unknown>) => void) | undefined;
  const client: BangumiWriteClient = {
    collections: async () => { throw new Error('此修改用例夹具不提供全收藏列表'); },
    async currentUser(active) { active?.throwIfAborted(); return { id: account, username: 'fixture' }; },
    async search() { return { data: [subject], total: 1 }; }, async subject() { return structuredClone(subject); },
    async collection() { if (!current) throw new Error('not found'); return structuredClone(current); },
    async collectionSnapshot(_id, active) { active?.throwIfAborted(); return structuredClone(current); },
    async episodes() { return { data: structuredClone(episodes), total: episodes.length, complete: true, offset: 0, limit: 20, nextOffset: null }; },
    async allEpisodes() { return { data: structuredClone(episodes), total: episodes.length, complete: true }; },
    async progressEpisodes(_id, bound, active) { active?.throwIfAborted(); assert.equal(bound, account); return { data: structuredClone(episodes), total: episodes.length, complete: true }; },
    async mutate(id, bound, request, active) {
      active.throwIfAborted(); assert.equal(bound, account); writes++;
      const value = request as Record<string, unknown>;
      if (mutation) return mutation(id, value);
      if (value.kind === 'collection') current = { ...(current ?? { ...initial, rate: 0, tags: [], comment: '', private: false, chapters: 0, volumes: 0 }), ...value.patch as Partial<Collection> };
      if (value.kind === 'book') {
        const patch = value.patch as { epStatus?: number; volStatus?: number };
        if (patch.epStatus !== undefined) current!.chapters = patch.epStatus;
        if (patch.volStatus !== undefined) current!.volumes = patch.volStatus;
      }
      if (value.kind === 'episode') { episodes.find(ep => ep.id === id)!.status = Number(value.status); current!.chapters = episodes.filter(ep => ep.type === 0 && ep.status === 2).length; }
    },
  };
  return { client, subject, initial, get current() { return current; }, set current(value) { current = value; }, get episodes() { return episodes; },
    set account(value: number) { account = value; }, get writes() { return writes; }, set mutation(value: (id: number, request: Record<string, unknown>) => void) { mutation = value; } };
}
function state(value: Awaited<ReturnType<BgmOperationExecutor['execute']>>) { return typeof value === 'string' ? value : value.state; }
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'bangumi-m4-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}

test('五类收藏写入及想看附带评分影响，完整保留标签、短评、私密和进度', async () => {
  for (const type of ['anime','book','music','game','real'] as const) {
    const f = fixture(type); const action = collectionWriteAction(f.subject, f.current, { rate: 8 });
    const executor = new BgmOperationExecutor(f.client, 0);
    assert.equal(await executor.matchesCurrent(7, action, signal()), true);
    assert.equal(state(await executor.execute(7, action, signal())), 'success');
    assert.deepEqual(f.current, { ...f.initial, rate: 8 }); assert.equal(f.writes, 1);
    const wish = collectionWriteAction(f.subject, f.current, { status: 1 });
    assert.equal(permissionFor([wish]).requiresConfirmation, true);
    assert.equal(state(await executor.execute(7, wish, signal())), 'success');
    assert.deepEqual(f.current, { ...f.initial, rate: 0, status: 1 });
  }
  const legacy = fixture(); legacy.current!.comment = 'e\u0301';
  const normalization = collectionWriteAction(legacy.subject, legacy.current, { rate: 8 });
  assert.equal(permissionFor([normalization]).requiresConfirmation, true);
  assert.deepEqual(normalization.effects, [{ field: 'comment', before: 'e\u0301', after: 'é' }]);
  assert.equal(state(await new BgmOperationExecutor(legacy.client, 0).execute(7, normalization, signal())), 'success');
});

test('未收藏创建必须选择状态；默认不自动完成进度，评分或进度不能隐式创建', async () => {
  const f = fixture(); f.current = null;
  assert.throws(() => collectionWriteAction(f.subject, null, { rate: 8 }), { code: 'COLLECTION_REQUIRED' });
  assert.throws(() => progressAction(f.subject, null, { mode: 'single', number: 1 }), { code: 'COLLECTION_REQUIRED' });
  const action = collectionWriteAction(f.subject, null, { status: 2 });
  assert.equal(state(await new BgmOperationExecutor(f.client, 0).execute(7, action, signal())), 'success');
  assert.equal(f.current!.chapters, 0); assert.equal(f.current!.rate, 0); assert.equal(f.current!.private, false);
});

test('账户、未请求字段和章节清单变化使原授权失效，不发写请求', async () => {
  const f = fixture(); const action = collectionWriteAction(f.subject, f.current, { rate: 8 }); const executor = new BgmOperationExecutor(f.client, 0);
  f.current!.comment = '网站新短评'; assert.equal(await executor.matchesCurrent(7, action, signal()), false);
  f.current = structuredClone(f.initial); f.account = 8; assert.equal(await executor.matchesCurrent(7, action, signal()), false); f.account = 7;
  const progress = progressAction(f.subject, f.current, { mode: 'through', number: 3 }, await f.client.allEpisodes(1));
  f.episodes[4]!.status = 0; assert.equal(await executor.matchesCurrent(7, progress, signal()), false);
  assert.equal(f.writes, 0);
});

test('累计新增保留后续与特殊章节；单集、特殊章节及到达末集提示不联动收藏', async () => {
  const f = fixture(); const executor = new BgmOperationExecutor(f.client, 0);
  const action = progressAction(f.subject, f.current, { mode: 'through', number: 3 }, await f.client.allEpisodes(1));
  assert.deepEqual(action.changes.map(item => item.field), ['episode:10','episode:12']);
  assert.match(action.notice!, /主线已全部/);
  assert.equal(state(await executor.execute(7, action, signal())), 'success');
  assert.deepEqual(f.episodes.map(ep => ep.status), [2,2,2,2,2]); assert.equal(f.current!.status, 3);
  const other = fixture(); other.episodes[4]!.status = 0;
  const special = progressAction(other.subject, other.current, { mode: 'explicit', episodeId: 14 }, await other.client.allEpisodes(1));
  assert.deepEqual(special.changes.map(item => item.field), ['episode:14']);
  assert.equal(state(await new BgmOperationExecutor(other.client, 0).execute(7, special, signal())), 'success');
  assert.equal(other.episodes[0]!.status, 0);
});

test('回退仅清后续主线已看，清空含特殊章节；两者必须确认', async () => {
  const f = fixture(); f.episodes[2]!.status = 1;
  const rollback = progressAction(f.subject, f.current, { mode: 'rollback', number: 1 }, await f.client.allEpisodes(1));
  assert.deepEqual(rollback.changes.map(item => item.field), ['episode:11','episode:13']);
  assert.equal(permissionFor([rollback]).requiresConfirmation, true);
  assert.equal(state(await new BgmOperationExecutor(f.client, 0).execute(7, rollback, signal())), 'success');
  assert.deepEqual(f.episodes.map(ep => ep.status), [0,0,1,0,2]);
  const clear = progressAction(f.subject, f.current, { mode: 'clear' }, await f.client.allEpisodes(1));
  assert.equal(permissionFor([clear]).requiresConfirmation, true);
  assert.equal(state(await new BgmOperationExecutor(f.client, 0).execute(7, clear, signal())), 'success');
  assert.deepEqual(f.episodes.map(ep => ep.status), [0,0,0,0,0]);
});

test('宿主确认复杂进度后走实际执行器，拒绝不写，恢复不重放', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const f = fixture(); let commands: DialogueCommands;
  const coordinator = new OperationCoordinator(new OperationJournal(dir, log.id), new BgmOperationExecutor(f.client, 0));
  const tools = new DialogueTools(f.client, coordinator, { plan: value => commands.presented(value) }); commands = new DialogueCommands(tools, log);
  tools.beginTurn('清空#1进度', []);
  const rejected = await tools.execute('preview_progress_changes', { operations: [{ subjectId: 1, progress: { mode: 'clear' } }] }, { signal: signal() }) as { id: string };
  await commands.handle(`/reject ${rejected.id}`, [], signal()); assert.equal(f.writes, 0);
  const plan = await tools.execute('preview_progress_changes', { operations: [{ subjectId: 1, progress: { mode: 'clear' } }] }, { signal: signal() }) as { id: string };
  const history = await commands.handle(`/confirm ${plan.id}`, [], signal()); assert.match(history!.at(-1)!.content!, /回读验证成功/);
  assert.equal(f.writes, 3); assert.deepEqual(f.episodes.map(ep => ep.status), [0,0,0,0,0]);
  const recovered = new OperationCoordinator(new OperationJournal(dir, log.id), new BgmOperationExecutor(f.client, 0));
  await assert.rejects(recovered.execute(plan.id, signal()), { code: 'AUTHORIZATION_REQUIRED' }); assert.equal(f.writes, 3);
});

test('书籍章数/卷数独立写入，回退/清零需要确认，已知总数限制生效', async () => {
  const f = fixture('book'); const executor = new BgmOperationExecutor(f.client, 0);
  const chapter = progressAction(f.subject, f.current, { mode: 'book', chapters: 3 });
  assert.equal(state(await executor.execute(7, chapter, signal())), 'success'); assert.equal(f.current!.volumes, 1);
  const lower = progressAction(f.subject, f.current, { mode: 'book', chapters: 1 }); assert.equal(permissionFor([lower]).requiresConfirmation, true);
  assert.throws(() => progressAction(f.subject, f.current, { mode: 'book', chapters: 5 }), { code: 'PROGRESS_OUT_OF_RANGE' });
  assert.throws(() => progressAction(f.subject, f.current, { mode: 'book', volumes: 4 }), { code: 'PROGRESS_OUT_OF_RANGE' });
  const clear = progressAction(f.subject, f.current, { mode: 'clear' });
  assert.equal(state(await executor.execute(7, clear, signal())), 'success');
  assert.equal(f.current!.volumes, 0); assert.equal(f.current!.chapters, 0); assert.equal(f.current!.rate, 7);
});

test('不支持类型、错进度模式、未知章节、超限和畸形输入不产生计划', async () => {
  for (const type of ['music','game'] as const) { const f = fixture(type); assert.throws(() => progressAction(f.subject, f.current, { mode: 'single', number: 1 }), { code: 'UNSUPPORTED_PROGRESS' }); }
  const f = fixture(); const episodes = await f.client.allEpisodes(1);
  assert.throws(() => progressAction(f.subject, f.current, { mode: 'through', number: 9 }, episodes), { code: 'EPISODE_AMBIGUOUS' });
  assert.throws(() => progressAction(f.subject, f.current, { mode: 'explicit', episodeId: 999 }, episodes), { code: 'EPISODE_NOT_FOUND' });
  assert.throws(() => progressAction(f.subject, f.current, { mode: 'through', number: 3 }, { ...episodes, data: episodes.data.filter(ep => ep.number !== 2) }), { code: 'EPISODE_AMBIGUOUS' });
  for (const value of [{ mode: 'through', number: 0 }, { mode: 'clear', confirmed: true }, { mode: 'book', chapters: -1 }, { mode: 'explicit', episodeId: 10, number: 1 }]) assert.throws(() => progressRequest(value), { code: 'INVALID_INPUT' });
  assert.throws(() => collectionWriteAction(f.subject, f.current, { comment: '字'.repeat(381) }), { code: 'INVALID_INPUT' });
  assert.throws(() => collectionWriteAction(f.subject, f.current, { tags: ['空 格'] }), { code: 'INVALID_INPUT' });
});

test('退出成功但回读不一致为失败，未要求的字段被覆盖也不能成功', async () => {
  const f = fixture(); f.mutation = () => {}; const action = collectionWriteAction(f.subject, f.current, { rate: 8 });
  assert.equal(state(await new BgmOperationExecutor(f.client, 0).execute(7, action, signal())), 'failed'); assert.equal(f.writes, 1);
  const other = fixture(); other.mutation = () => { other.current!.rate = 8; other.current!.tags = []; };
  assert.equal(state(await new BgmOperationExecutor(other.client, 0).execute(7, collectionWriteAction(other.subject, other.current, { rate: 8 }), signal())), 'failed');
});

test('回读短暂滞后可验证成功；网络不可读返回未知而不重发', async () => {
  const f = fixture(); const snapshot = f.client.collectionSnapshot; let reads = 0;
  f.client.collectionSnapshot = async (...args) => { reads++; return reads === 2 ? structuredClone(f.initial) : snapshot(...args); };
  assert.equal(state(await new BgmOperationExecutor(f.client, 0).execute(7, collectionWriteAction(f.subject, f.current, { rate: 8 }), signal())), 'success'); assert.equal(f.writes, 1);
  const other = fixture(); other.mutation = () => { other.client.collectionSnapshot = async () => { throw new Error('offline'); }; };
  assert.equal(state(await new BgmOperationExecutor(other.client, 0).execute(7, collectionWriteAction(other.subject, other.current, { rate: 8 }), signal())), 'unknown'); assert.equal(other.writes, 1);
});

test('超时/取消后独立回读证明已写入则成功；未持久化仍未知，不重发', async () => {
  for (const persist of [true,false]) {
    const f = fixture(); const controller = new AbortController();
    f.mutation = () => { if (persist) f.current!.rate = 8; controller.abort(); throw new AppError('BGM_TIMEOUT', 'timeout'); };
    const result = await new BgmOperationExecutor(f.client, 0).execute(7, collectionWriteAction(f.subject, f.current, { rate: 8 }), controller.signal);
    assert.equal(state(result), persist ? 'success' : 'unknown'); assert.equal(f.writes, 1);
  }
});

test('单作品多集部分成功后中断，逐字段回读结果保留，后续章节不写', async () => {
  const f = fixture(); f.mutation = (id) => { if (id === 12) throw new AppError('BGM_HTTP_403', 'forbidden'); f.episodes.find(ep => ep.id === id)!.status = 2; };
  const action = progressAction(f.subject, f.current, { mode: 'through', number: 3 }, await f.client.allEpisodes(1));
  const result = await new BgmOperationExecutor(f.client, 0).execute(7, action, signal());
  assert.equal(state(result), 'unknown'); assert.equal(f.writes, 2);
  assert.deepEqual(typeof result === 'string' ? [] : result.fields?.map(item => item.state), ['success','failed']);
});

test('实际执行器与宿主策略：直接进度执行，参数改动待确认，缺删除适配明确拒绝', async t => {
  const dir = await directory(t); const log = new SessionLog(dir); const f = fixture();
  const tools = new DialogueTools(f.client, new OperationCoordinator(new OperationJournal(dir, log.id), new BgmOperationExecutor(f.client, 0)));
  tools.beginTurn('把#1看到第3集了', []);
  const plan = await tools.execute('preview_progress_changes', { operations: [{ subjectId: 1, progress: { mode: 'through', number: 3 } }] }, { signal: signal() }) as { state: string; results: { state: string }[] };
  assert.equal(plan.state, 'finished'); assert.equal(plan.results[0]!.state, 'success'); assert.equal(f.writes, 2);
  assert.ok(directIntentFrom('把#1第1集看过', null)?.progress);
  tools.beginTurn('把#1看到第3集了', []);
  const changed = await tools.execute('preview_progress_changes', { operations: [{ subjectId: 1, progress: { mode: 'clear' } }] }, { signal: signal() }) as { state: string };
  assert.equal(changed.state, 'pending'); assert.equal(f.writes, 2);
  await assert.rejects(tools.execute('preview_delete_collection', { subjectId: 1 }), { code: 'UNSUPPORTED_OPERATION' });
});

test('五类条目取消收藏被宿主、模型工具、实际执行器与固定桥接阻止，不读取账号或写入',async t=>{
  for(const type of ['anime','book','music','game','real'] as const) {
    const dir=await directory(t);const f=fixture(type);const action=deleteCollectionAction(f.subject,f.current,f.episodes);
    let reads=0; f.client.currentUser=async()=>{reads++;throw new Error('disabled operation must not read account');};
    const executor=new BgmOperationExecutor(f.client,0);const coordinator=new OperationCoordinator(new OperationJournal(dir,new SessionLog(dir).id),executor);
    const tools=new DialogueTools(f.client,coordinator);
    assert.ok(!tools.schemas().some(schema=>schema.function.name==='preview_delete_collection'));
    assert.throws(()=>coordinator.prepare(7,[action],null),{code:'UNSUPPORTED_OPERATION'});
    await assert.rejects(executor.execute(7,action,signal()),{code:'UNSUPPORTED_OPERATION'});
    await assert.rejects(executor.matchesCurrent(7,action,signal()),{code:'UNSUPPORTED_OPERATION'});
    await assert.rejects(tools.execute('preview_delete_collection',{subjectId:1}),{code:'UNSUPPORTED_OPERATION'});
    const reply=await tools.handleUser('删除#1收藏',[],signal());assert.match(String(reply),/暂未开放/);
    tools.beginTurn('删除#1收藏',[]);await assert.rejects(tools.execute('propose_dialogue_request',{sourceText:'删除#1收藏',kind:'delete',reference:'#1'}),{code:'UNSUPPORTED_OPERATION'});
    assert.equal(reads,0);assert.equal(f.writes,0);
  }
  const dir=await directory(t);const run=createBgmRunner({configDir:dir,entry:fileURLToPath(new URL('../../src/adapters/bgm-cli/worker.js',import.meta.url)),timeoutMs:5000,proxy:null,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});
  for(const args of [['delete_check','1','7'],['mutate','1','7','{"kind":"delete"}']]) {
    const response=await run(args) as {ok:boolean;error:{code:string}};assert.equal(response.ok,false);assert.equal(response.error.code,'UNSUPPORTED_OPERATION');
  }
});

test('批量在确定失败后继续独立项，未知时停止并记录已验证结果', async t => {
  const dir = await directory(t); const f = fixture(); f.mutation = () => { throw new AppError('BGM_HTTP_403', 'forbidden'); };
  const log = new SessionLog(dir); const ops = new OperationCoordinator(new OperationJournal(dir, log.id), new BgmOperationExecutor(f.client, 0));
  const first = collectionWriteAction(f.subject, f.current, { rate: 8 });
  const second = { ...structuredClone(first), subjectId: 2 }; // fixture.subject 返回1，使第二项现状核查失败，不能写错对象。
  const plan = ops.prepare(7, [first,second], null); ops.confirm(plan.id, plan.digest);
  const result = await ops.execute(plan.id, signal()); assert.equal(result.results[0]!.state, 'failed'); assert.equal(result.stopped, 'PLAN_STALE'); assert.equal(f.writes, 1);
});

test('桥接字段不完整、非成功响应与个人章节所属不一致拒绝继续', async () => {
  const read = new BgmReadClient(async args => args[0] === 'user' ? { id: 7, username: 'fixture' } : { data: [{ id: 10, ep: 1, type: 0 }], total: 1 });
  const client = new BgmWriteClient(read, async args => args[0] === 'snapshot' ? { ok: true, data: { collection: { subject_id: 1, type: 3 } } }
    : { ok: true, data: { id: 10, subjectId: 99, accountId: 7, status: 0 } });
  await assert.rejects(client.collectionSnapshot(1), { code: 'INCOMPLETE_COLLECTION' });
  await assert.rejects(client.progressEpisodes(1,7), { code: 'INCOMPLETE_EPISODES' });
  const failed = new BgmWriteClient(read, async () => ({ ok: false, error: { code: 'BGM_HTTP_401', message: 'secret-raw-error' } }));
  await assert.rejects(failed.collectionSnapshot(1), error => error instanceof AppError && error.code === 'BGM_HTTP_401' && !error.message.includes('secret-raw-error'));
});

test('固定桥接子进程复用 bgm 客户端，完整分页查找超过100项；缺页/总数变化拒绝推断未收藏', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'config.json'), '{}');
  const worker = fileURLToPath(new URL('../../src/adapters/bgm-cli/worker.js', import.meta.url));
  const preload = new URL('../../../tests/fixtures/bgm-worker-preload.mjs', import.meta.url).href;
  for (const scenario of ['found','absent','missing','changed']) {
    const run = createBgmRunner({ configDir: dir, entry: worker, timeoutMs: 5000, proxy: null,
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_OPTIONS: `--import=${preload}`, FIXTURE_SCENARIO: scenario } });
    const result = await run(['snapshot','999']) as { ok: boolean; data?: { collection: unknown }; error?: { code: string } };
    if (scenario === 'found') { assert.equal(result.ok, true); assert.equal((result.data!.collection as { subject_id: number }).subject_id, 999); }
    else if (scenario === 'absent') { assert.equal(result.ok, true); assert.equal(result.data!.collection, null); }
    else { assert.equal(result.ok, false); assert.equal(result.error!.code, 'INCOMPLETE_COLLECTION'); }
  }
  const run = createBgmRunner({ configDir: dir, entry: worker, timeoutMs: 5000, proxy: null,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_OPTIONS: `--import=${preload}`, FIXTURE_SCENARIO: 'found' } });
  const result = await run(['mutate','1','8','{"kind":"book","patch":{"epStatus":0}}']) as { ok: boolean; error: { code: string } };
  assert.equal(result.error.code, 'ACCOUNT_CHANGED');
  assert.equal((await run(['mutate','1','7','{"kind":"book","patch":{"epStatus":0,"volStatus":0}}']) as { ok: boolean }).ok, true);
  assert.equal((await run(['mutate','1','7',JSON.stringify({ kind: 'collection', patch: { status: 3, rate: 8, tags: ['科幻,动画'], comment: '--help;$(x)', private: false } })]) as { ok: boolean }).ok, true);
  assert.equal((await run(['mutate','10','7','{"kind":"episode","subjectId":1,"status":0,"expectedStatus":0}']) as { ok: boolean }).ok, true);
  assert.equal((await run(['mutate','10','7','{"kind":"episode","subjectId":1,"status":2,"expectedStatus":2}']) as { ok: boolean }).ok, false);
});
