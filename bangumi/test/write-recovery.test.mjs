import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { AppError, SubmissionError } from '../dist/src/support/errors.js';
import { WriteRateLimiter } from '../dist/src/mcp/write-rate-limit.js';

// 所有账户和 HTTP 均由内存夹具提供；custom 条目真实回灌宿主，而非 getEntries: () => []。
function fixture({ accountId = 42, indexId = 500, entries = [], factStore, limiter } = {}) {
  const account = { id: accountId, username: 'recovery_fixture' };
  const indexes = new Map([[indexId, { id: indexId, uid: accountId, title: '原目录', desc: '保留介绍', private: false }]]);
  const relations = new Map([[indexId, []]]);
  const collectedIndexes = new Set();
  const entities = { characters: new Set(), persons: new Set() };
  const episodes = [1, 2, 3].map(id => ({ id, subjectID: 101, type: 0, sort: id, name: `第${id}集`, collection: { status: 0 } }));
  const interest = () => ({ type: 3, rate: 5, comment: '保留短评', tags: ['保留标签'], private: false, epStatus: 0, volStatus: 0 });
  const subjects = new Map([101, 201, 595106, ...Array.from({ length: 20 }, (_, i) => 1001 + i)].map(id => [id,
    { id, type: id === 201 ? 1 : 2, name: `作品${id}`, nameCN: `作品${id}`, eps: 12, volumes: 10, interest: interest() }]));
  let journal = JSON.parse(JSON.stringify(entries));
  const writes = [], calls = [], updates = [];
  let input = { text: '按明确计划修改本人数据', generation: 1, requestId: 'request-1' };
  let service, boundary, batch;
  let controller = new AbortController();
  let nextIndex = indexId + 1, nextRelation = 900, resets = 0, confirmations = 0;
  const faults = { failVerify: false, loseReceipt: false, loseReceiptWithId: false, interrupt: false,
    failClose: false, rejectWrite: false, failAppend: undefined, failReadPaths: new Set(),
    loseReceiptOnEpisode: undefined, loseBeforeEpisode: undefined };
  const context = { sessionManager: { getEntries: () => journal } };
  const access = () => ({ mode: 'account', account, nsfw: { preference: true, allowed: true, state: 'enabled' },
    source: 'p1', nsfwApplied: true, checkedAt: '2026-10-04T12:00:00.000Z' });
  const page = (rows, options) => ({ data: structuredClone(rows.slice(options.query?.offset ?? 0,
    (options.query?.offset ?? 0) + (options.query?.limit ?? 100))), total: rows.length });
  const transport = {
    preflight: async () => access(), currentUser: async () => account, close: async () => {},
    public: async () => { throw Error('恢复夹具不允许匿名网络'); },
    account: async (path, options = {}) => {
      if (options.expectedAccountId !== undefined) assert.equal(options.expectedAccountId, accountId);
      const method = options.method ?? 'GET';
      if (method !== 'GET') {
        writes.push({ path, method, body: structuredClone(options.body), requestId: input.requestId });
        if (faults.rejectWrite) throw new AppError('BGM_HTTP_429', '离线夹具模拟服务端拒绝本次提交');
        if (faults.loseBeforeEpisode && path === `/p1/collections/episodes/${faults.loseBeforeEpisode}`)
          throw new AppError('BGM_NETWORK', '离线夹具模拟阶段结果未知且当前尚未生效');
        let value = {};
        if (path === '/p1/indexes') {
          const id = nextIndex++;
          indexes.set(id, { id, uid: accountId, title: options.body.title, desc: options.body.desc, private: options.body.private });
          relations.set(id, []); value = { id };
        } else if (/^\/p1\/collections\/subjects\/\d+$/.test(path)) {
          const row = subjects.get(Number(path.split('/').at(-1)));
          if (method === 'PUT') {
            const { type, rate, comment, tags, private: visibility } = options.body;
            Object.assign(row.interest, { type, rate, comment, tags, private: visibility });
          } else Object.assign(row.interest, options.body);
        } else if (/^\/p1\/collections\/episodes\/\d+$/.test(path)) {
          const anchor = episodes.find(row => row.id === Number(path.split('/').at(-1)));
          const affected = options.body.batch ? episodes.filter(row => row.type === 0 && row.sort <= anchor.sort) : [anchor];
          for (const row of affected) row.collection.status = options.body.batch ? 2 : options.body.type;
          subjects.get(101).interest.epStatus = episodes.filter(row => row.collection.status === 2).length;
        } else if (/^\/p1\/collections\/(characters|persons)\/\d+$/.test(path)) {
          const [, kind, id] = /^\/p1\/collections\/(characters|persons)\/(\d+)$/.exec(path);
          if (method === 'PUT') entities[kind].add(Number(id)); else entities[kind].delete(Number(id));
        } else if (/^\/p1\/collections\/indexes\/\d+$/.test(path)) {
          const id = Number(path.split('/').at(-1));
          if (method === 'PUT') collectedIndexes.add(id); else collectedIndexes.delete(id);
        } else if (/^\/p1\/indexes\/\d+$/.test(path)) {
          const row = indexes.get(Number(path.split('/').at(-1)));
          Object.assign(row, { title: options.body.title ?? row.title, desc: options.body.desc ?? row.desc,
            private: options.body.private ?? row.private });
        } else if (/^\/p1\/indexes\/\d+\/related$/.test(path)) {
          const id = Number(path.split('/')[3]), relatedId = nextRelation++;
          relations.get(id).push({ id: relatedId, sid: options.body.sid, comment: options.body.comment,
            order: options.body.order, subject: subjects.get(options.body.sid) }); value = { id: relatedId };
        } else if (/^\/p1\/indexes\/\d+\/related\/\d+$/.test(path)) {
          const id = Number(path.split('/')[3]), relatedId = Number(path.split('/').at(-1));
          const rows = relations.get(id), offset = rows.findIndex(row => row.id === relatedId);
          assert.ok(offset >= 0);
          if (method === 'DELETE') rows.splice(offset, 1); else Object.assign(rows[offset], options.body);
        } else throw Error(`未登记的写入 ${method} ${path}`);
        return value;
      }
      if (faults.failReadPaths.has(path)) throw new AppError('BGM_NETWORK', '离线夹具模拟一个独立对象读取失败');
      if (/^\/p1\/subjects\/\d+$/.test(path)) return structuredClone(subjects.get(Number(path.split('/').at(-1))));
      if (/^\/p1\/episodes\/\d+$/.test(path)) return structuredClone(episodes.find(row => row.id === Number(path.split('/').at(-1))));
      if (path === '/p1/subjects/101/episodes') return page(episodes, options);
      if (/^\/p1\/indexes\/\d+$/.test(path)) return structuredClone(indexes.get(Number(path.split('/').at(-1))));
      if (/^\/p1\/indexes\/\d+\/related$/.test(path)) return page(relations.get(Number(path.split('/')[3])), options);
      if (path === '/p1/collections/indexes') return page([...collectedIndexes].map(id => indexes.get(id)), options);
      const entity = /^\/p1\/(characters|persons)\/(\d+)$/.exec(path);
      if (entity) return { id: Number(entity[2]), name: entity[1], type: 1, career: [] };
      const collection = /^\/p1\/collections\/(characters|persons)$/.exec(path);
      if (collection) return page([...entities[collection[1]]].map(id => ({ id, name: '实体', type: 1 })), options);
      throw Error(`未登记的读取 ${path}`);
    },
  };
  const client = { call: async (name, args, signal, guard, scope) => {
    calls.push({ name, args: structuredClone(args), phase: scope?.phase, writesBefore: writes.length });
    if (faults.failClose && scope?.phase === 'close') throw new AppError('MCP_CONNECTION_CLOSED', '离线夹具模拟关闭消息丢失');
    if (faults.failVerify && scope?.phase === 'verify') throw new AppError('BGM_NETWORK', '离线夹具模拟末尾回读断网');
    const value = await service.call(name, args, signal, guard, scope);
    if (guard && faults.interrupt) controller.abort();
    if (guard && faults.loseReceiptWithId) throw new SubmissionError('BGM_NETWORK', '离线夹具模拟已知对象回执断开',
      { ...value, submissionState: 'unknown', items: value.items.map(item => ({ ...item, submissionState: 'unknown' })) });
    if (guard && faults.loseReceipt) throw new AppError('BGM_NETWORK', '离线夹具模拟整个响应丢失');
    if (guard && faults.loseReceiptOnEpisode && args.episode_ids?.includes(faults.loseReceiptOnEpisode))
      throw new AppError('BGM_NETWORK', '离线夹具模拟指定章节已生效而响应丢失');
    return value;
  } };
  const append = (customType, data) => {
    if (faults.failAppend?.(data, customType)) throw new AppError('INTERNAL_ERROR', '离线夹具模拟事实落盘失败');
    journal.push(JSON.parse(JSON.stringify({ type: 'custom', customType, id: `custom-${journal.length + 1}`, data })));
  };
  const restart = () => {
    // 经 JSON 落盘/读回的 custom 条目不能依赖原运行时对象、Map 或 WeakMap。
    journal = JSON.parse(JSON.stringify(journal));
    service = new BangumiMcpService(transport);
    boundary = createWriteBoundary(client, () => input, data => append('bangumi/write', data),
      { canConfirm: () => true, confirm: async () => { confirmations++; return true; } }, undefined,
      { journal: factStore, limiter, resetClient: async () => { resets++; service = new BangumiMcpService(transport); } });
    batch = createBatchWriteTool(boundary, data => append('bangumi/batch', data));
  };
  restart();
  return { account, indexes, relations, entities, collectedIndexes, subjects, episodes, writes, calls, updates, faults,
    get entries() { return journal; }, get resets() { return resets; }, get input() { return input; },
    get confirmations() { return confirmations; }, abort: () => controller.abort(),
    nextTurn: ({ sameRequest = false } = {}) => {
      input = { ...input, generation: input.generation + 1,
        requestId: sameRequest ? input.requestId : `request-${input.generation + 1}` };
      controller = new AbortController();
    },
    restart,
    run: async operations => (await batch.execute(`call-${input.generation}`, { operations }, controller.signal,
      result => updates.push(result.details.value), context)).details.value,
    read: async (name, args) => {
      const tool = createReadTools(client).find(tool => tool.name === name);
      assert.ok(tool);
      return (await tool.execute('ordinary-read', args, undefined, undefined, context)).details;
    },
    seed: data => append('bangumi/write', data),
    addRelation: (id, subjectId, order = 0) => relations.get(id).push({ id: nextRelation++, sid: subjectId,
      comment: '', order, subject: subjects.get(subjectId) }),
  };
}

function rateClock() {
  let now = 10_000;
  const sleeps = [];
  const clock = { sleeps, onSleep: undefined, now: () => now };
  clock.limiter = new WriteRateLimiter({ now: () => now, safetyMarginMs: 0,
    wait: async (milliseconds, signal) => {
      sleeps.push({ milliseconds, startedAt: now });
      clock.onSleep?.();
      if (signal.aborted) throw new AppError('CANCELLED', '离线时钟模拟额度等待中取消');
      now += Math.max(milliseconds, 300_000);
    },
  });
  return clock;
}

function createSixteenPlan() {
  return [{ tool: 'create_index', args: { title: '限流目录', description: '保留介绍' } },
    ...Array.from({ length: 16 }, (_, i) => ({ tool: 'add_subject_to_index', index_from: 1,
      args: { subject_id: 1001 + i, comment: '', order: i } }))];
}

const cases = [
  { tool: 'update_subject_collection', args: { subject_id: 201, rating: 8 }, read: ['get_user_subject_collection', { username: '-', subject_id: 201 }] },
  { tool: 'update_single_episode_collection', args: { episode_id: 2, collection_type: 2 }, read: ['get_single_episode_collection', { episode_id: 2 }] },
  { tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [1, 2], collection_type: 2 }, read: ['get_user_episode_collection', { subject_id: 101 }] },
  { tool: 'collect_character', args: { character_id: 701 }, read: ['get_user_character_collection', { username: '-', character_id: 701 }] },
  { tool: 'uncollect_character', args: { character_id: 701 }, setup: f => f.entities.characters.add(701), read: ['get_user_character_collection', { username: '-', character_id: 701 }] },
  { tool: 'collect_person', args: { person_id: 702 }, read: ['get_user_person_collection', { username: '-', person_id: 702 }] },
  { tool: 'uncollect_person', args: { person_id: 702 }, setup: f => f.entities.persons.add(702), read: ['get_user_person_collection', { username: '-', person_id: 702 }] },
  { tool: 'create_index', args: { title: '创建目标', description: '保留介绍' }, read: ['get_index', { index_id: 501, own: true }] },
  { tool: 'update_index', args: { index_id: 500, title: '修改目标' }, read: ['get_index', { index_id: 500, own: true }] },
  { tool: 'add_subject_to_index', args: { index_id: 500, subject_id: 101, comment: '', order: 0 }, read: ['get_index_subjects', { index_id: 500, own: true }] },
  { tool: 'update_index_subject', args: { index_id: 500, subject_id: 101, comment: '新关系短评' }, setup: f => f.addRelation(500, 101), read: ['get_index_subjects', { index_id: 500, own: true }] },
  { tool: 'remove_subject_from_index', args: { index_id: 500, subject_id: 101 }, setup: f => f.addRelation(500, 101), read: ['get_index_subjects', { index_id: 500, own: true }] },
  { tool: 'collect_index', args: { index_id: 500 }, read: ['get_index', { index_id: 500, own: true }] },
  { tool: 'uncollect_index', args: { index_id: 500 }, setup: f => f.collectedIndexes.add(500), read: ['get_index', { index_id: 500, own: true }] },
];
assert.deepEqual(cases.map(row => row.tool).sort(), TOOL_DEFINITIONS.filter(row => row.effect === 'write').map(row => row.name).sort());

for (const row of cases) for (const mode of ['interrupted', 'response_lost', 'readback_failed']) {
  test(`${row.tool}：${mode} 后从 custom 日志恢复，普通读取不清锁且新轮不重发`, async () => {
    const f = fixture(); row.setup?.(f);
    f.faults.failVerify = true;
    if (mode === 'interrupted') f.faults.interrupt = true;
    if (mode === 'response_lost') {
      if (row.tool === 'create_index') f.faults.loseReceiptWithId = true;
      else f.faults.loseReceipt = true;
    }
    const operation = { tool: row.tool, args: row.args };
    const first = await f.run([operation]);
    assert.equal(first.state, 'unknown', JSON.stringify(first));
    const writeCount = f.writes.length;
    assert.ok(writeCount > 0);
    const interruptedEpisodes = row.tool === 'update_episode_collection' && mode !== 'readback_failed';
    if (interruptedEpisodes) {
      assert.equal(writeCount, 1, '原计划只发出第一集请求，后续集未提交');
      assert.equal(first.items[0].submission.items[1].submissionState, 'not_attempted');
      assert.equal(f.episodes.find(ep => ep.id === 1).collection.status, 2);
      assert.equal(f.episodes.find(ep => ep.id === 2).collection.status, 0);
    }
    const original = JSON.stringify(f.entries);
    const originalLast = f.entries.filter(entry => entry.customType === 'bangumi/write').at(-1);
    assert.equal(originalLast.data.state, 'unknown');
    Object.assign(f.faults, { failVerify: false, loseReceipt: false, loseReceiptWithId: false, interrupt: false });
    const observation = await f.read(...row.read);
    assert.ok(observation.value, JSON.stringify(observation));
    assert.equal(JSON.stringify(f.entries), original, '普通读工具不能追加 reconciled 或恢复授权');
    f.nextTurn(); f.restart();
    const next = row.tool === 'create_index' ? { tool: 'update_index', args: { index_id: 501, title: '创建目标' } }
      : interruptedEpisodes ? { tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [2], collection_type: 2 } } : operation;
    const recovered = await f.run([next]);
    const reconciled = f.entries.filter(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'reconciled');
    if (interruptedEpisodes) {
      assert.equal(recovered.state, 'success', JSON.stringify(recovered));
      assert.equal(f.writes.length, writeCount + 1, '新用户计划只提交未达成的第二集');
      assert.equal(f.writes.filter(write => write.path === '/p1/collections/episodes/1').length, 1, '已核实第一集不重发');
      assert.equal(f.writes.filter(write => write.path === '/p1/collections/episodes/2').length, 1);
      assert.ok(reconciled.some(entry => entry.data.state === 'failed' && entry.data.resolution === 'observed_partial'), JSON.stringify(reconciled));
    } else {
      assert.equal(recovered.state, 'unchanged', JSON.stringify(recovered));
      assert.equal(f.writes.length, writeCount, '恢复核实和已达成的新计划均不得重发原操作');
      assert.ok(reconciled.some(entry => entry.data.state === 'success'), JSON.stringify(reconciled));
    }
    assert.equal(JSON.stringify(f.entries.slice(0, JSON.parse(original).length)), original, '恢复仅追加事实，不改写原投递状态');
  });
}

test('真实新轮评分 8→7→8 及人物 收藏→取消→再收藏不被历史 fingerprint 永久拒绝', async () => {
  for (const operations of [
    [8, 7, 8].map(rating => ({ tool: 'update_subject_collection', args: { subject_id: 201, rating } })),
    ['collect_person', 'uncollect_person', 'collect_person'].map(tool => ({ tool, args: { person_id: 702 } })),
  ]) {
    const f = fixture();
    for (const operation of operations) {
      const value = await f.run([operation]);
      assert.equal(value.state, 'success', JSON.stringify(value));
      f.nextTurn(); f.restart();
    }
    assert.equal(f.writes.length, 3);
  }
});

test('硬中断只留下部分ack的submission阶段未决事实，重启仍须核实而不能当已结案', async () => {
  const f = fixture(); f.faults.failVerify = true; f.faults.interrupt = true;
  const original = { tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [1, 2], collection_type: 2 } };
  await f.run([original]);
  const lastSubmission = f.entries.findLastIndex(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'submission');
  assert.ok(lastSubmission >= 0);
  assert.equal(f.entries[lastSubmission].data.state, 'unknown');
  assert.equal(f.entries[lastSubmission].data.submission.items[0].submissionState, 'acknowledged');
  assert.equal(f.entries[lastSubmission].data.submission.items[1].submissionState, 'not_attempted');
  // 保留真实提交阶段事实，删除进程崩溃后本应不存在的完成/回读条目。
  f.entries.splice(lastSubmission + 1);
  f.faults.failVerify = false; f.faults.interrupt = false; f.nextTurn(); f.restart();
  const value = await f.run([{ tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [2], collection_type: 2 } }]);
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.ok(f.entries.some(entry => entry.data.phase === 'reconciled' && entry.data.resolution === 'observed_partial'));
  assert.equal(f.writes.filter(write => write.path === '/p1/collections/episodes/1').length, 1);
  assert.equal(f.writes.filter(write => write.path === '/p1/collections/episodes/2').length, 1);
});

for (const applied of [true, false]) test(`阶段2 started硬中断：未知阶段${applied ? '已生效则核实前缀后只补余下' : '当前未生效仍不能解锁重发'}`, async () => {
  const f = fixture(); f.faults.failVerify = true;
  if (applied) f.faults.loseReceiptOnEpisode = 2; else f.faults.loseBeforeEpisode = 2;
  const original = { tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [1, 2, 3], collection_type: 2 } };
  assert.equal((await f.run([original])).state, 'unknown');
  assert.equal(f.writes.length, 2, '第三阶段从未发出');
  assert.equal(f.episodes.find(ep => ep.id === 1).collection.status, 2);
  assert.equal(f.episodes.find(ep => ep.id === 2).collection.status, applied ? 2 : 0);
  assert.equal(f.episodes.find(ep => ep.id === 3).collection.status, 0);
  const startedIndex = f.entries.findLastIndex(entry => entry.customType === 'bangumi/write'
    && entry.data.phase === 'started' && entry.data.stageId?.endsWith('/2'));
  assert.ok(startedIndex >= 0);
  const started = f.entries[startedIndex].data;
  assert.deepEqual(started.submission.items.map(item => item.submissionState), ['acknowledged', 'unknown', 'not_attempted']);
  assert.ok(Array.isArray(started.baselineBefore) && Array.isArray(started.expected));
  assert.equal(started.expected.find(([key]) => key === 'episode:2')[1].collection_type, 2,
    '硬中断核实视图必须包含当前未知阶段目标，不能只保留先前ack前缀');
  // 模拟进程在第二阶段RPC中退出：只读回此started及其之前的真实custom事实。
  f.entries.splice(startedIndex + 1);
  f.faults.failVerify = false; f.faults.loseReceiptOnEpisode = undefined; f.faults.loseBeforeEpisode = undefined;
  f.nextTurn(); f.restart();
  const next = await f.run([{ tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [3], collection_type: 2 } }]);
  if (applied) {
    assert.equal(next.state, 'success', JSON.stringify(next));
    assert.ok(f.entries.some(entry => entry.data.phase === 'reconciled' && entry.data.resolution === 'observed_partial'));
    for (const id of [1, 2, 3]) assert.equal(f.writes.filter(write => write.path === `/p1/collections/episodes/${id}`).length, 1,
      '当前已达成阶段不重发，新用户只提交未发的第三阶段');
  } else {
    assert.equal(next.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(next));
    assert.equal(f.writes.length, 2, '不能把未知阶段当前旧值当作明确未提交并继续');
    assert.equal(f.writes.filter(write => write.path === '/p1/collections/episodes/3').length, 0);
  }
});

test('同一个 requestId 即使 generation 改变也不会重放已经提交的目录创建', async () => {
  const f = fixture(), create = { tool: 'create_index', args: { title: '只创建一次', description: '说明' } };
  assert.equal((await f.run([create])).state, 'success');
  f.nextTurn({ sameRequest: true }); f.restart();
  await f.run([create]);
  assert.equal(f.writes.filter(row => row.path === '/p1/indexes').length, 1);
});

test('创建回执完全丢失时明确要求真实对象，不能猜标题或再创建', async () => {
  const f = fixture(); f.faults.loseReceipt = true; f.faults.failVerify = true;
  const create = { tool: 'create_index', args: { title: '对象ID未知', description: '说明' } };
  assert.equal((await f.run([create])).state, 'unknown');
  f.faults.loseReceipt = false; f.faults.failVerify = false;
  f.nextTurn(); f.restart();
  const blocked = await f.run([create]);
  assert.equal(blocked.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(blocked));
  assert.match(JSON.stringify(blocked), /UNVERIFIABLE_CREATE|真实.*ID|recoveryTarget/);
  assert.equal(f.writes.filter(row => row.path === '/p1/indexes').length, 1);
});

test('创建ID丢失后用户指定真实目录，核实所有者和完整元数据再绑定旧结果', async () => {
  const f = fixture(); f.faults.loseReceipt = true; f.faults.failVerify = true;
  const create = { tool: 'create_index', args: { title: '用户指定的创建目标', description: '说明' } };
  assert.equal((await f.run([create])).state, 'unknown');
  f.faults.loseReceipt = false; f.faults.failVerify = false;
  f.nextTurn(); f.restart();
  f.input.text = '我核实了创建目标，真实目录 ID 是 501，请读取并继续';
  const value = await f.run([{ tool: 'update_index', args: { index_id: 501, title: '用户指定的创建目标' } }]);
  assert.equal(value.state, 'unchanged', JSON.stringify(value));
  assert.equal(f.writes.length, 1, '绑定真实目录只核实，不能重发创建或伪造新授权');
  assert.ok(f.entries.some(entry => entry.data.phase === 'reconciled' && entry.data.state === 'success'));
});

test('创建ID未知时模型仅在计划填入index_id不能充当用户指定真实目录', async () => {
  const f = fixture(); f.faults.loseReceipt = true; f.faults.failVerify = true;
  assert.equal((await f.run([{ tool: 'create_index', args: { title: '不能猜测的目录', description: '说明' } }])).state, 'unknown');
  f.faults.loseReceipt = false; f.faults.failVerify = false;
  f.nextTurn(); f.restart();
  const blocked = await f.run([{ tool: 'update_index', args: { index_id: 501, title: '不能猜测的目录' } }]);
  assert.equal(blocked.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(blocked));
  assert.equal(f.writes.length, 1);
});

test('未知投递且当前仍为 before 的普通断网不能被自动改成可重试失败', async () => {
  const f = fixture();
  f.seed({ phase: 'completed', fingerprint: 'uncertain-before', tool: 'update_index', toolCallId: 'old/1', accountId: 42,
    args: { index_id: 500, title: '未确认标题' }, target: { kind: 'index', id: 500, title: '原目录' },
    before: { title: '原目录', description: '保留介绍', private: false }, after: { title: '未确认标题', description: '保留介绍', private: false },
    state: 'unknown', networkAttempted: true, writeNetworkAttempted: true, submissionError: { code: 'BGM_NETWORK', message: '响应未知' } });
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '未确认标题' } }]);
  assert.equal(value.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(value));
  assert.equal(f.writes.length, 0);
});

test('新schema started有完整目标但无投递证据，当前等于before仍不能解锁重发', async () => {
  const f = fixture();
  f.seed({ schemaVersion: 2, kind: 'bangumi-write', phase: 'started', operationId: 'started-operation',
    batchId: 'started-batch', requestId: 'old-request', fingerprint: 'started-fingerprint', tool: 'update_index',
    toolCallId: 'interrupted/1', accountId: 42, args: { index_id: 500, title: '开始后结果未知' },
    target: { kind: 'index', id: 500, title: '原目录' },
    before: { title: '原目录', description: '保留介绍', private: false },
    after: { title: '开始后结果未知', description: '保留介绍', private: false }, state: 'unknown' });
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '开始后结果未知' } }]);
  assert.equal(value.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(value));
  assert.equal(f.writes.length, 0, '有目标快照不能证明历史请求明确未提交');
});

test('混合工具恢复时一个独立范围断网，不丢失另一个已核实范围的持久结案', async () => {
  const f = fixture(); f.faults.failVerify = true;
  const update = { tool: 'update_index', args: { index_id: 500, title: '目录目标' } };
  const collect = { tool: 'collect_person', args: { person_id: 702 } };
  assert.equal((await f.run([update, collect])).state, 'unknown');
  const writes = f.writes.length;
  assert.equal(writes, 2);
  f.faults.failVerify = false; f.faults.failReadPaths.add('/p1/indexes/500');
  f.nextTurn(); f.restart();
  const indexReadsBefore = f.calls.filter(call => call.name === 'get_index' && call.args.index_id === 500).length;
  const independent = await f.run([collect]);
  assert.equal(independent.state, 'unchanged', JSON.stringify(independent));
  assert.equal(f.calls.filter(call => call.name === 'get_index' && call.args.index_id === 500).length, indexReadsBefore,
    '无关联人物计划不必重新读取故障目录');
  const reconciled = f.entries.filter(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'reconciled');
  assert.ok(reconciled.some(entry => entry.data.tool === 'collect_person' && entry.data.state === 'success'), JSON.stringify(reconciled));
  assert.ok(!reconciled.some(entry => entry.data.tool === 'update_index' && entry.data.state === 'success'));
  const personReads = f.calls.filter(call => call.name === 'get_user_person_collection').length;
  f.faults.failReadPaths.clear(); f.nextTurn(); f.restart();
  const next = await f.run([update]);
  assert.equal(next.state, 'unchanged', JSON.stringify(next));
  assert.equal(f.writes.length, writes, '恢复只读，不能重新提交任一旧步骤');
  assert.equal(f.calls.filter(call => call.name === 'get_user_person_collection').length, personReads,
    '前一轮已落盘核实的独立人物范围不应复活为未决');
});

test('旧目录投递未知且目录读取断网，不挡新评分和人物收藏且不删除旧未决事实', async () => {
  for (const operation of [
    { tool: 'update_subject_collection', args: { subject_id: 201, rating: 8 } },
    { tool: 'collect_person', args: { person_id: 702 } },
  ]) {
    const f = fixture();
    const old = { schemaVersion: 2, kind: 'bangumi-write', phase: 'completed', operationId: 'old-directory-operation',
      fingerprint: 'old-directory', toolCallId: 'old-directory/1', requestId: 'old-request', accountId: 42,
      tool: 'update_index', args: { index_id: 500, title: '旧未知目标' }, target: { kind: 'index', id: 500, title: '原目录' },
      before: { title: '原目录', description: '保留介绍', private: false },
      after: { title: '旧未知目标', description: '保留介绍', private: false }, state: 'unknown',
      networkAttempted: true, writeNetworkAttempted: true };
    f.seed(old); f.faults.failReadPaths.add('/p1/indexes/500');
    const value = await f.run([operation]);
    assert.equal(value.state, 'success', JSON.stringify(value));
    assert.equal(f.writes.length, 1);
    assert.equal(f.calls.filter(call => call.name === 'get_index').length, 0,
      '宿主不能为了无冲突目标调用旧故障目录');
    assert.deepEqual(f.entries.find(entry => entry.data.operationId === old.operationId).data, old);
    assert.ok(!f.entries.some(entry => entry.data.operationId === old.operationId && entry.data.phase === 'reconciled'));
  }
});

test('同一旧目录的未决修改仍严格阻塞新的目录计划，零写入', async () => {
  const f = fixture();
  f.seed({ schemaVersion: 2, kind: 'bangumi-write', phase: 'completed', operationId: 'conflicting-directory',
    fingerprint: 'conflicting-directory', toolCallId: 'old/1', accountId: 42, tool: 'update_index',
    args: { index_id: 500, title: '旧未知目标' }, target: { kind: 'index', id: 500, title: '原目录' },
    before: { title: '原目录', description: '保留介绍', private: false },
    after: { title: '旧未知目标', description: '保留介绍', private: false }, state: 'unknown',
    networkAttempted: true, writeNetworkAttempted: true });
  f.faults.failReadPaths.add('/p1/indexes/500');
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '新目录目标' } }]);
  assert.equal(value.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(value));
  assert.equal(f.writes.length, 0);
  assert.ok(f.calls.some(call => call.name === 'get_index' && call.args.index_id === 500));
});

test('宿主本轮恢复原创建后拒绝同参数再创建，给真实目录ID且同轮可重规划剩余项', async () => {
  const f = fixture(); f.faults.failVerify = true;
  const create = { tool: 'create_index', args: { title: '恢复后不可重创', description: '保留介绍' } };
  assert.equal((await f.run([create])).state, 'unknown');
  f.faults.failVerify = false; f.nextTurn(); f.restart();
  const replan = await f.run([create]);
  assert.equal(replan.error.code, 'RECOVERED_CREATE_REPLAN_REQUIRED', JSON.stringify(replan));
  assert.equal(replan.recovery.createdTargets[0].indexId, 501);
  assert.equal(replan.writeNetworkAttempted, false);
  assert.equal(f.writes.filter(write => write.path === '/p1/indexes').length, 1);
  assert.equal((await f.run([create])).error.code, 'RECOVERED_CREATE_REPLAN_REQUIRED', '同轮再次调用不能绕过已恢复目录');
  f.restart();
  assert.equal((await f.run([create])).error.code, 'RECOVERED_CREATE_REPLAN_REQUIRED', '相同真实请求重启后仍保留恢复目标');
  assert.equal(f.writes.filter(write => write.path === '/p1/indexes').length, 1);
  const requestId = f.input.requestId, generation = f.input.generation;
  const next = await f.run([{ tool: 'add_subject_to_index', args: { index_id: 501, subject_id: 101, comment: '', order: 0 } }]);
  assert.equal(next.state, 'success', JSON.stringify(next));
  assert.equal(f.input.requestId, requestId);
  assert.equal(f.input.generation, generation, '纯恢复后重规划尚未提交，允许同一真实用户请求补齐计划');
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes.filter(write => write.path === '/p1/indexes').length, 1);
});

test('legacy 第16步429：目录已有14项，完整宿主核实后只执行新轮剩余项', async () => {
  const f = fixture({ accountId: 534925, indexId: 104345 });
  for (let i = 0; i < 14; i++) f.addRelation(104345, 1001 + i, i);
  f.seed({ phase: 'completed', fingerprint: 'legacy-create', tool: 'create_index', toolCallId: 'legacy-batch/1', accountId: 534925,
    state: 'success', target: { kind: 'newIndex' }, args: { title: '原目录', description: '保留介绍', private: false },
    submission: { createdId: 104345 } });
  const args = { index_id: 104345, subject_id: 595106, comment: '', order: 14 };
  const unknown = { phase: 'completed', fingerprint: 'legacy-sixteenth', tool: 'add_subject_to_index',
    toolCallId: 'legacy-batch/16', accountId: 534925, args,
    target: { kind: 'indexSubject', indexId: 104345, title: '原目录', subjectId: 595106, name: '作品595106' },
    before: null, after: { subject_id: 595106, comment: '', order: 14 }, actual: null, state: 'unknown',
    networkAttempted: true, writeNetworkAttempted: true,
    verification: { readbackCompleted: true, requestedStateMatched: false, protectedFieldsMatched: true,
      mismatchedFields: ['batch_final_state'], state: 'unknown', scope: 'batch_final_state' },
    submissionError: { code: 'BGM_HTTP_429', message: '离线旧日志中的提交拒绝' } };
  f.seed(unknown);
  const ordinary = await f.read('get_index_subjects', { index_id: 104345, own: true });
  assert.equal(ordinary.value.page.total, 14);
  assert.equal(f.entries.filter(entry => entry.data.phase === 'reconciled').length, 0);
  f.nextTurn(); f.restart();
  const value = await f.run([{ tool: 'add_subject_to_index', args }]);
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.equal(f.writes.length, 1);
  assert.equal(f.relations.get(104345).length, 15);
  assert.equal(f.writes[0].path, '/p1/indexes/104345/related');
  assert.ok(f.entries.some(entry => entry.data.phase === 'reconciled' && entry.data.state === 'failed'));
  assert.deepEqual(f.entries.find(entry => entry.data.fingerprint === 'legacy-sixteenth').data, unknown);
});

test('started 事实写入失败不提交，释放 scope 后新请求仍可正常执行', async () => {
  const f = fixture();
  f.faults.failAppend = data => data.phase === 'started' && data.tool === 'update_index';
  const operation = { tool: 'update_index', args: { index_id: 500, title: '落盘后才能修改' } };
  const failed = await f.run([operation]);
  assert.notEqual(failed.state, 'success');
  assert.equal(f.writes.length, 0);
  f.faults.failAppend = undefined; f.nextTurn();
  const success = await f.run([operation]);
  assert.equal(success.state, 'success', JSON.stringify(success));
  assert.equal(f.writes.length, 1);
});

test('completed 事实落盘失败仍可从持久提交事实核实，不重发已完成写入', async () => {
  const f = fixture();
  f.faults.failAppend = (data, type) => type === 'bangumi/write' && data.phase === 'completed';
  const operation = { tool: 'update_index', args: { index_id: 500, title: '提交已生效' } };
  await f.run([operation]);
  assert.equal(f.writes.length, 1);
  f.faults.failAppend = undefined; f.nextTurn(); f.restart();
  const value = await f.run([operation]);
  assert.equal(value.state, 'unchanged', JSON.stringify(value));
  assert.equal(f.writes.length, 1);
  assert.ok(f.entries.some(entry => entry.data.phase === 'reconciled' && entry.data.state === 'success'));
});

test('共享账本已由另一宿主核实结案，旧运行时local facts不能复活未决操作', async () => {
  const shared = [];
  const store = { entries: () => JSON.parse(JSON.stringify(shared)), append: fact => shared.push(JSON.parse(JSON.stringify(fact))) };
  const f = fixture({ factStore: store }); f.faults.failVerify = true;
  assert.equal((await f.run([{ tool: 'update_index', args: { index_id: 500, title: '共享账本目标' } }])).state, 'unknown');
  const pending = shared.filter(fact => fact.kind === 'bangumi-write').at(-1);
  assert.equal(pending.state, 'unknown');
  // 模拟另一宿主在同一账户队列内完成独立核实后，只向共享账本追加结案。
  store.append({ ...pending, phase: 'reconciled', state: 'success', resolution: 'observed_applied',
    actual: { title: '共享账本目标', description: '保留介绍', private: false },
    verification: { readbackCompleted: true, requestedStateMatched: true, protectedFieldsMatched: true, state: 'success' } });
  f.faults.failVerify = false; f.faults.failReadPaths.add('/p1/indexes/500'); f.nextTurn();
  const next = await f.run([{ tool: 'collect_person', args: { person_id: 702 } }]);
  assert.equal(next.state, 'success', JSON.stringify(next));
  assert.equal(f.writes.length, 2, '旧local started/unknown不能覆盖共享账本的新结案再触发读取阻塞');
});

test('scope close 消息丢失弃用旧客户端，新轮不会残留 BATCH_SCOPE_ACTIVE', async () => {
  const f = fixture(); f.faults.failClose = true;
  assert.equal((await f.run([{ tool: 'update_index', args: { index_id: 500, title: '第一轮' } }])).state, 'success');
  assert.equal(f.resets, 1);
  f.faults.failClose = false; f.nextTurn();
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '第二轮' } }]);
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.equal(f.writes.length, 2);
});

test('真实宿主目录创建+16项添加在第16次RPC前等待，共享额度后重核基线且只确认一次', async () => {
  const clock = rateClock(), f = fixture({ limiter: clock.limiter });
  const waiting = [];
  clock.onSleep = () => waiting.push({ writes: f.writes.length, calls: f.calls.length });
  const value = await f.run(createSixteenPlan());
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.equal(value.summary.success, 17);
  assert.equal(f.confirmations, 1, '额度等待不恢复或重复索取原计划授权');
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].writes, 15, '创建+14项添加耗尽IndexEdit，第16次RPC尚未发送');
  assert.equal(clock.now(), 310_000, '仅推进离线时钟，没有真实五分钟等待');
  assert.ok(f.updates.some(update => update.phase === 'rate_limit_wait'));
  assert.ok(f.calls.slice(waiting[0].calls).some(call => call.name === 'get_index' && call.args.index_id === 501
    && call.phase === 'prepare' && call.writesBefore === 15), '等待后、下次提交前独立重核真实目录');
  assert.ok(f.calls.slice(waiting[0].calls).some(call => call.name === 'get_index_subjects' && call.args.index_id === 501
    && call.phase === 'prepare' && call.writesBefore === 15), '等待后核对已提交的完整关系范围');
  assert.equal(f.writes.length, 17);
  assert.equal(f.writes.filter(write => write.path === '/p1/indexes').length, 1);
  const additions = f.writes.filter(write => write.path === '/p1/indexes/501/related');
  assert.equal(additions.length, 16);
  assert.equal(new Set(additions.map(write => write.body.sid)).size, 16);
  assert.ok(value.items.every(item => item.state === 'success' && item.verification.readbackCompleted));
});

test('额度等待期间目录基线被修改，宿主读取证据并停止旧计划而不发送第16次RPC', async () => {
  const clock = rateClock(), f = fixture({ limiter: clock.limiter });
  clock.onSleep = () => {
    assert.equal(f.writes.length, 15);
    f.indexes.get(501).title = '等待期间的外部修改';
  };
  const value = await f.run(createSixteenPlan());
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.match(JSON.stringify(value), /STALE_PREVIEW/);
  assert.equal(f.confirmations, 1);
  assert.equal(f.writes.length, 15, '已提交部分之外的旧授权操作全部停止');
  assert.equal(f.relations.get(501).length, 14);
  assert.equal(f.indexes.get(501).title, '等待期间的外部修改');
  assert.ok(f.calls.some(call => call.name === 'get_index' && call.args.index_id === 501
    && call.phase === 'prepare' && call.writesBefore === 15));
  assert.equal(f.writes.filter(write => write.body?.sid === 1015 || write.body?.sid === 1016).length, 0);
});

test('额度等待中取消仍独立核实已提交部分，新真实用户只补余下范围且无unknown死锁', async () => {
  const clock = rateClock(), f = fixture({ limiter: clock.limiter });
  clock.onSleep = () => {
    assert.equal(f.writes.length, 15);
    f.abort();
  };
  const first = await f.run(createSixteenPlan());
  assert.equal(first.state, 'failed', JSON.stringify(first));
  assert.equal(first.summary.success, 15, '创建及14项添加都完成独立回读');
  assert.equal(first.summary.unknown, 0, 'MCP scope因等待关闭不能丢弃已提交部分的独立核实');
  assert.ok(first.items.slice(0, 15).every(item => item.verification.readbackCompleted && item.state === 'success'));
  assert.equal(f.writes.length, 15);
  assert.equal(f.confirmations, 1);
  clock.onSleep = undefined; f.nextTurn();
  const remainder = createSixteenPlan().slice(15).map(operation => ({ tool: operation.tool,
    args: { ...operation.args, index_id: 501 } }));
  const next = await f.run(remainder);
  assert.equal(next.state, 'success', JSON.stringify(next));
  assert.equal(next.summary.success, 2);
  assert.equal(f.writes.length, 17);
  assert.equal(f.writes.filter(write => write.path === '/p1/indexes').length, 1, '新请求使用真实目录，绝不重发旧创建');
  const additions = f.writes.filter(write => write.path === '/p1/indexes/501/related');
  assert.equal(additions.length, 16);
  assert.equal(new Set(additions.map(write => write.body.sid)).size, 16, '已提交添加不重复');
});
