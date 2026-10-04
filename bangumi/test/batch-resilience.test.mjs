import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { AppError } from '../dist/src/support/errors.js';
import { restoreWriteRateLimits, WriteRateLimiter, WRITE_RATE_RULES } from '../dist/src/mcp/write-rate-limit.js';

// 仅使用内存账户和持久 custom 条目；故障既可发生在修改前，也可发生在修改后。
function fixture({ beforeWrite, afterWrite, beforeRead, beforeCall, afterCall, beforePreflight, missing = [], entries = [], requestId = 'resilience-request-1' } = {}) {
  const account = { id: 42, username: 'resilience_fixture' };
  const interest = () => ({ type: 3, rate: 5, comment: '保留短评', tags: ['原标签'], private: true, epStatus: 0, volStatus: 0 });
  const subjects = new Map([101, 102, 103, 201].map(id => [id, {
    id, type: id === 201 ? 1 : 2, name: `作品${id}`, nameCN: `作品${id}`, eps: 12, volumes: 10, interest: interest(),
  }]));
  const indexes = new Map([500, 501].map(id => [id, { id, uid: 42, title: `目录${id}`, desc: '保留介绍', private: false }]));
  const relations = new Map([500, 501].map(id => [id, []]));
  const entities = { characters: new Set(), persons: new Set() };
  const collectedIndexes = new Set();
  const episodes = [501, 502, 503].map((id, i) => ({ id, subjectID: 101, type: 0, sort: i + 1, name: `第${i + 1}集`, collection: { status: 0 } }));
  const journal = structuredClone(entries), events = [], writes = [], calls = [], updates = [], previews = [];
  const controller = new AbortController();
  let nextIndex = 600, nextRelation = 900, preflights = 0, confirmations = 0, service;
  const page = (rows, options) => ({ data: structuredClone(rows.slice(options.query?.offset ?? 0,
    (options.query?.offset ?? 0) + (options.query?.limit ?? 100))), total: rows.length });
  const state = { subjects, indexes, relations, entities, collectedIndexes, episodes, controller, events, writes, calls };
  const transport = {
    preflight: async () => {
      preflights++; events.push({ kind: 'preflight', number: preflights });
      beforePreflight?.({ ...state, number: preflights });
      return { mode: 'account', account, nsfw: { preference: true, allowed: true, state: 'enabled' },
        source: 'p1', nsfwApplied: true, checkedAt: '2026-10-04T12:00:00.000Z' };
    },
    currentUser: async () => account, close: async () => {},
    public: async () => { throw Error('离线容错夹具不允许匿名请求'); },
    account: async (path, options = {}) => {
      assert.equal(options.expectedAccountId, 42);
      const method = options.method ?? 'GET';
      const event = { kind: method === 'GET' ? 'read' : 'write', path, method, body: structuredClone(options.body) };
      events.push(event);
      if (method !== 'GET') {
        writes.push(event); beforeWrite?.({ ...state, ...event, number: writes.length });
        let value = {};
        if (path === '/p1/indexes') {
          const id = nextIndex++;
          indexes.set(id, { id, uid: 42, title: options.body.title, desc: options.body.desc, private: options.body.private });
          relations.set(id, []); value = { id };
        } else if (/^\/p1\/collections\/subjects\/\d+$/.test(path)) {
          const row = subjects.get(Number(path.split('/').at(-1)));
          if (method === 'PUT') Object.assign(row.interest, { type: options.body.type, rate: options.body.rate,
            comment: options.body.comment, tags: options.body.tags, private: options.body.private });
          else Object.assign(row.interest, options.body);
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
          Object.assign(row, { title: options.body.title ?? row.title, desc: options.body.desc ?? row.desc, private: options.body.private ?? row.private });
        } else if (/^\/p1\/indexes\/\d+\/related$/.test(path)) {
          const id = Number(path.split('/')[3]), relationId = nextRelation++;
          relations.get(id).push({ id: relationId, sid: options.body.sid, comment: options.body.comment, order: options.body.order, subject: subjects.get(options.body.sid) });
          value = { id: relationId };
        } else if (/^\/p1\/indexes\/\d+\/related\/\d+$/.test(path)) {
          const id = Number(path.split('/')[3]), relationId = Number(path.split('/').at(-1));
          const rows = relations.get(id), offset = rows.findIndex(row => row.id === relationId); assert.ok(offset >= 0);
          if (method === 'DELETE') rows.splice(offset, 1); else Object.assign(rows[offset], options.body);
        } else throw Error(`未登记写入 ${method} ${path}`);
        afterWrite?.({ ...state, ...event, number: writes.length });
        return value;
      }
      beforeRead?.({ ...state, ...event });
      if (/^\/p1\/subjects\/\d+$/.test(path)) {
        const id = Number(path.split('/').at(-1));
        if (missing.includes(id)) throw new AppError('BGM_HTTP_404', '当前账户范围不可见');
        return structuredClone(subjects.get(id));
      }
      if (/^\/p1\/episodes\/\d+$/.test(path)) return structuredClone(episodes.find(row => row.id === Number(path.split('/').at(-1))));
      if (path === '/p1/subjects/101/episodes') return page(episodes, options);
      if (/^\/p1\/indexes\/\d+$/.test(path)) return structuredClone(indexes.get(Number(path.split('/').at(-1))));
      if (/^\/p1\/indexes\/\d+\/related$/.test(path)) return page(relations.get(Number(path.split('/')[3])), options);
      if (path === '/p1/collections/indexes') return page([...collectedIndexes].map(id => indexes.get(id)), options);
      const entity = /^\/p1\/(characters|persons)\/(\d+)$/.exec(path);
      if (entity) return { id: Number(entity[2]), name: entity[1], type: 1, career: [] };
      const collection = /^\/p1\/collections\/(characters|persons)$/.exec(path);
      if (collection) return page([...entities[collection[1]]].map(id => ({ id, name: '实体', type: 1 })), options);
      throw Error(`未登记读取 ${path}`);
    },
  };
  service = new BangumiMcpService(transport);
  const client = { call: async (name, args, signal, guard, scope) => {
    const call = { name, args: structuredClone(args), phase: scope?.phase, writesBefore: writes.length }; calls.push(call);
    beforeCall?.({ ...state, ...call, guard });
    const value = await service.call(name, args, signal, guard, scope);
    return afterCall?.({ ...state, ...call, guard, value }) ?? value;
  } };
  const append = (customType, data) => journal.push(JSON.parse(JSON.stringify({ type: 'custom', customType, id: `fact-${journal.length + 1}`, data })));
  const input = { text: '按明确范围完成本次目录及收藏修改', generation: 1, requestId };
  const boundary = createWriteBoundary(client, () => input, data => append('bangumi/write', data), {
    canConfirm: () => true, confirm: async (...args) => { confirmations++; previews.push(args); return true; },
  });
  const batch = createBatchWriteTool(boundary, data => append('bangumi/batch', data));
  return { ...state, journal, updates, previews,
    get preflights() { return preflights; }, get confirmations() { return confirmations; },
    run: async operations => (await batch.execute('resilience', { operations }, controller.signal,
      update => updates.push(update.details.value), { sessionManager: { getEntries: () => journal } })).details.value,
  };
}
const create = () => ({ tool: 'create_index', args: { title: '容错目录', description: '说明' } });
const add = (subject_id, index_from = 1) => ({ tool: 'add_subject_to_index', index_from, args: { subject_id, order: subject_id } });
const rate = (subject_id, rating = 8) => ({ tool: 'update_subject_collection', args: { subject_id, rating } });
const person = () => ({ tool: 'collect_person', args: { person_id: 702 } });
const character = () => ({ tool: 'collect_character', args: { character_id: 701 } });
const write404 = () => new AppError('BGM_HTTP_404', '模拟条目写入响应404，不能证明未生效');
const noNetwork = () => Object.defineProperty(new AppError('INVALID_INPUT', '固定本地阶段拒绝，业务请求未派发'), 'networkAttempted', { value: false });
const unchangedMeta = f => ({ comment: f.subjects.get(101).interest.comment, tags: f.subjects.get(101).interest.tags, private: f.subjects.get(101).interest.private });

test('预检A成功/B404/C成功只跳过B，一次确认后创建目录并加入A和C', async () => {
  const f = fixture({ missing: [102] }); const value = await f.run([create(), add(101), add(102), add(103)]);
  assert.equal(value.state, 'partial', JSON.stringify(value)); assert.equal(value.partial, true);
  assert.equal(value.summary.success, 3); assert.equal(value.summary.skipped, 1); assert.equal(value.summary.blocked, 0);
  assert.deepEqual(value.items.map(item => item.step), [1, 2, 3, 4]); assert.equal(value.items[2].state, 'skipped');
  assert.deepEqual(f.writes.map(row => row.body?.sid ?? row.path), ['/p1/indexes', 101, 103]);
  assert.deepEqual(f.relations.get(600).map(row => row.sid), [101, 103]); assert.equal(f.confirmations, 1);
  assert.ok(value.failures.some(failure => failure.phase === 'preflight' && failure.step === 3 && failure.tool === 'add_subject_to_index'));
});

test('跳过前项后index_from仍引用原始步骤编号，未因压缩可执行计划指向错误目录', async () => {
  const f = fixture({ missing: [102] }); const value = await f.run([rate(102), create(), add(101, 2)]);
  assert.equal(value.items[0].state, 'skipped'); assert.deepEqual(value.items.map(item => item.step), [1, 2, 3]);
  assert.equal(value.summary.success, 2, JSON.stringify(value)); assert.equal(f.relations.get(600)[0].sid, 101);
  assert.equal(f.writes[1].path, '/p1/indexes/600/related');
});

test('所有关联作品预检不可见时抑制附带创建空目录；明确独立创建空目录仍执行', async () => {
  const empty = fixture({ missing: [102] }); const skipped = await empty.run([create(), add(102)]);
  assert.equal(empty.writes.length, 0, JSON.stringify(skipped)); assert.equal(skipped.writeNetworkAttempted, false);
  assert.ok(skipped.items.every(item => ['skipped', 'blocked'].includes(item.state)));
  const explicit = fixture(); const created = await explicit.run([create()]);
  assert.equal(created.state, 'success', JSON.stringify(created)); assert.equal(explicit.writes.length, 1);
  assert.equal(explicit.relations.get(600).length, 0);
});

test('评分失败阻断同作品标签链，独立作品继续且标签请求不能夹带失败评分', async () => {
  const f = fixture({ beforeWrite: ({ path }) => { if (path === '/p1/collections/subjects/101') throw write404(); } });
  const protectedBefore = unchangedMeta(f);
  const value = await f.run([rate(101), { tool: 'update_subject_collection', args: { subject_id: 101, tags: ['新标签'] } }, rate(103)]);
  assert.equal(value.items[1].state, 'blocked', JSON.stringify(value)); assert.equal(value.items[2].state, 'success');
  assert.equal(f.writes.filter(row => row.path === '/p1/collections/subjects/101').length, 1);
  assert.equal(f.subjects.get(101).interest.rate, 5); assert.deepEqual(unchangedMeta(f), protectedBefore);
  assert.equal(f.subjects.get(103).interest.rate, 8); assert.equal(value.partial, true);
});

test('人物条目失败不拖停角色、其他人物、目录和作品混合操作', async () => {
  const f = fixture({ beforeWrite: ({ path }) => { if (path === '/p1/collections/persons/702') throw write404(); } });
  const value = await f.run([person(), character(), { tool: 'collect_person', args: { person_id: 703 } },
    { tool: 'update_index', args: { index_id: 500, title: '新标题' } }, rate(103)]);
  assert.deepEqual(value.items.slice(1).map(item => item.state), ['success', 'success', 'success', 'success'], JSON.stringify(value));
  assert.equal(value.summary.success, 4); assert.equal(f.entities.persons.has(702), false);
  assert.equal(f.entities.persons.has(703), true); assert.equal(f.entities.characters.has(701), true); assert.equal(f.indexes.get(500).title, '新标题');
});

test('创建目录失败只阻断该目录的依赖，独立角色及作品继续且不重复创建', async () => {
  const f = fixture({ beforeWrite: ({ path }) => { if (path === '/p1/indexes') throw write404(); } });
  const value = await f.run([create(), add(101), add(103), character(), rate(103)]);
  assert.deepEqual(value.items.slice(1, 3).map(item => item.state), ['blocked', 'blocked'], JSON.stringify(value));
  assert.equal(value.items[1].target.indexFrom, 1); assert.equal(value.items[1].target.indexId, undefined);
  assert.deepEqual(value.items.slice(3).map(item => item.state), ['success', 'success']);
  assert.equal(f.writes.filter(row => row.path === '/p1/indexes').length, 1);
  assert.ok(!f.writes.some(row => row.path.endsWith('/related'))); assert.equal(value.summary.blocked, 2);
});

for (const applied of [false, true]) test(`同目录404未知${applied ? '已生效' : '尚未生效'}时checkpoint后继续其他sid且不重发原项`, async () => {
  const hook = ({ path, body }) => { if (path === '/p1/indexes/500/related' && body.sid === 102) throw write404(); };
  const f = fixture(applied ? { afterWrite: hook } : { beforeWrite: hook });
  const operations = [101, 102, 103].map(subject_id => ({ tool: 'add_subject_to_index', args: { index_id: 500, subject_id, comment: '', order: subject_id } }));
  const value = await f.run(operations);
  assert.equal(value.items[0].state, 'success', JSON.stringify(value)); assert.equal(value.items[2].state, 'success');
  assert.equal(f.writes.filter(row => row.body?.sid === 102).length, 1);
  assert.deepEqual(f.relations.get(500).map(row => row.sid), applied ? [101, 102, 103] : [101, 103]);
  const failedAt = f.events.findIndex(row => row.kind === 'write' && row.body?.sid === 102);
  const nextAt = f.events.findIndex(row => row.kind === 'write' && row.body?.sid === 103);
  assert.ok(nextAt > failedAt); assert.ok(f.events.slice(failedAt + 1, nextAt).some(row => row.kind === 'read' && row.path === '/p1/indexes/500/related'));
  const failureFact = f.journal.find(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'submission'
    && entry.data.args?.subject_id === 102);
  assert.equal(failureFact.data.submission.items[0].submissionState, 'unknown');
});

test('目录checkpoint失败隔离该目录，其余目录和人物可继续', async () => {
  let damaged = false;
  const f = fixture({ beforeWrite: ({ path, body }) => { if (path === '/p1/indexes/500/related' && body.sid === 102) { damaged = true; throw write404(); } },
    beforeRead: ({ path }) => { if (damaged && path === '/p1/indexes/500/related') throw new AppError('BGM_HTTP_404', '该目录回读失败'); } });
  const value = await f.run([
    { tool: 'add_subject_to_index', args: { index_id: 500, subject_id: 102 } },
    { tool: 'add_subject_to_index', args: { index_id: 500, subject_id: 103 } },
    { tool: 'add_subject_to_index', args: { index_id: 501, subject_id: 101 } }, person(),
  ]);
  assert.equal(value.items[1].state, 'blocked', JSON.stringify(value));
  assert.deepEqual(value.items.slice(2).map(item => item.state), ['success', 'success']);
  assert.equal(f.writes.filter(row => row.path === '/p1/indexes/500/related').length, 1); assert.equal(f.relations.get(501)[0].sid, 101);
});

test('目录checkpoint容许失败行原值或目标值，但不容许其他行的范围外改动', async () => {
  const f = fixture({ beforeWrite: ({ path, body, relations }) => {
    if (path === '/p1/indexes/500/related' && body.sid === 102) {
      relations.get(500)[0].comment = '范围外改动'; throw write404();
    }
  } });
  f.relations.get(500).push({ id: 899, sid: 101, comment: '保留关系短评', order: 1, subject: f.subjects.get(101) });
  const value = await f.run([
    { tool: 'add_subject_to_index', args: { index_id: 500, subject_id: 102 } },
    { tool: 'add_subject_to_index', args: { index_id: 500, subject_id: 103 } }, person(),
  ]);
  assert.equal(value.items[1].state, 'blocked', JSON.stringify(value)); assert.equal(value.items[2].state, 'success');
  assert.ok(!f.writes.some(row => row.body?.sid === 103)); assert.equal(f.relations.get(500)[0].comment, '范围外改动');
});

test('多集明确未派发失败保留逐阶段事实，前后其他集完成且失败集不重发', async () => {
  const f = fixture({ beforeWrite: ({ path }) => { if (path === '/p1/collections/episodes/502') throw noNetwork(); } });
  const value = await f.run([{ tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [501, 502, 503], collection_type: 2 } }, person()]);
  assert.deepEqual(f.episodes.map(row => row.collection.status), [2, 0, 2], JSON.stringify(value));
  assert.equal(value.items[1].state, 'success'); assert.equal(f.writes.filter(row => row.path === '/p1/collections/episodes/502').length, 1);
  const attempted = f.journal.filter(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'submission' && entry.data.stageId);
  assert.ok(attempted.some(entry => entry.data.submission?.items[0]?.target?.id === 503));
  assert.ok(Array.isArray(value.items[0].stageResults), '部分多集操作须公开逐阶段结果');
  assert.deepEqual(value.items[0].stageResults.map(stage => stage.stage), [1, 2, 3]);
});

test('多集预检中一集404只跳过该集，前后两集提交并公开稳定逐集结果', async () => {
  const f = fixture({ beforeRead: ({ path }) => { if (path === '/p1/episodes/502') throw new AppError('BGM_HTTP_404', '该集预检不可见'); } });
  const value = await f.run([{ tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [501, 502, 503], collection_type: 2 } }, person()]);
  assert.deepEqual(f.episodes.map(row => row.collection.status), [2, 0, 2], JSON.stringify(value));
  assert.deepEqual(f.writes.filter(row => row.path.startsWith('/p1/collections/episodes/')).map(row => Number(row.path.split('/').at(-1))), [501, 503]);
  assert.equal(value.items[1].state, 'success');
  assert.ok(Array.isArray(value.items[0].stageResults));
  assert.equal(value.items[0].stageResults.length, 3); assert.equal(value.items[0].stageResults[1].state, 'skipped');
  assert.deepEqual(value.items[0].stageResults.map(stage => stage.stage), [1, 2, 3]);
  assert.equal(value.items[0].stageResults[0].state, 'success'); assert.equal(value.items[0].stageResults[2].state, 'success');
});

for (const cause of ['cancel', 'auth']) test(`全局${cause === 'cancel' ? '取消' : '认证失效'}仍停止其余独立写入`, async () => {
  const f = fixture({ afterWrite: ({ number, controller }) => { if (cause === 'cancel' && number === 1) controller.abort(); },
    beforeWrite: ({ number }) => { if (cause === 'auth' && number === 1) throw new AppError('BGM_HTTP_401', '模拟会话失效'); } });
  const value = await f.run([character(), person(), rate(103)]);
  assert.equal(f.writes.length, 1, JSON.stringify(value)); assert.equal(value.items[1].state, 'not_executed');
  assert.equal(value.items[2].state, 'not_executed'); assert.equal(f.entities.persons.size, 0);
});

for (const mode of ['closed', 'invalid']) test(`MCP${mode === 'closed' ? '通道关闭' : '响应绑定非法'}缺合法回执时停止独立项，已派发阶段不重发`, async () => {
  const f = fixture({ afterCall: ({ guard, value }) => {
    if (!guard) return;
    if (mode === 'closed') throw new AppError('MCP_CONNECTION_CLOSED', '模拟提交后本地MCP通道关闭');
    return { ...value, expectedAccountId: 99 };
  } });
  const value = await f.run([character(), person(), rate(103)]);
  assert.equal(f.writes.length, 1, JSON.stringify(value)); assert.equal(f.entities.characters.has(701), true);
  assert.equal(value.items[1].state, 'not_executed'); assert.equal(value.items[2].state, 'not_executed');
  assert.equal(f.entities.persons.size, 0); assert.equal(f.subjects.get(103).interest.rate, 5);
});

test('末尾某目录回读失败仅使该目录待核实，独立人物与评分已完成结果保留', async () => {
  const f = fixture({ beforeRead: ({ path, writes }) => {
    if (writes.length && path === '/p1/indexes/500') throw new AppError('BGM_HTTP_404', '独立目录回读不可见');
  } });
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '已提交标题' } }, person(), rate(103)]);
  assert.equal(value.items[0].state, 'unknown', JSON.stringify(value));
  assert.deepEqual(value.items.slice(1).map(item => item.state), ['success', 'success']); assert.equal(value.summary.success, 2);
  assert.equal(value.partial, true); assert.equal(f.writes.length, 3);
});

test('末尾回读账户变化属于全局失败，不能保留先前缓存范围中的成功快照', async () => {
  const f = fixture({ beforeRead: ({ path, writes }) => {
    if (writes.length && path === '/p1/subjects/103') throw new AppError('ACCOUNT_CHANGED', '模拟读回过程中账户变化');
  } });
  const value = await f.run([person(), rate(103)]);
  assert.equal(value.state, 'unknown', JSON.stringify(value)); assert.equal(value.summary.success, 0);
  assert.ok(value.items.every(item => item.state === 'unknown' && !item.verification.readbackCompleted));
  assert.equal(f.writes.length, 2);
});

test('旧未知目录只阻断同域新项，混合计划的独立人物与评分仍执行且保留旧事实', async () => {
  const old = { schemaVersion: 2, kind: 'bangumi-write', phase: 'completed', operationId: 'old-directory-operation',
    fingerprint: 'old-directory', toolCallId: 'old/1', requestId: 'old-request', accountId: 42,
    tool: 'update_index', args: { index_id: 500, title: '旧未知目标' }, target: { kind: 'index', id: 500, title: '目录500' },
    before: { title: '目录500', description: '保留介绍', private: false },
    after: { title: '旧未知目标', description: '保留介绍', private: false }, state: 'unknown', networkAttempted: true, writeNetworkAttempted: true };
  const f = fixture({ entries: [{ type: 'custom', customType: 'bangumi/write', id: 'old', data: old }],
    beforeRead: ({ path }) => { if (path === '/p1/indexes/500') throw new AppError('BGM_NETWORK', '旧目录读取故障'); } });
  const value = await f.run([{ tool: 'update_index', args: { index_id: 500, title: '新目标' } }, person(), rate(103)]);
  assert.equal(value.items[0].state, 'blocked', JSON.stringify(value));
  assert.deepEqual(value.items.slice(1).map(item => item.state), ['success', 'success']); assert.equal(f.writes.length, 2);
  assert.deepEqual(f.journal[0].data, old); assert.ok(!f.journal.some(entry => entry.data.operationId === old.operationId && entry.data.phase === 'reconciled'));
});

test('实际子阶段事实重启恢复额度，started/submission/completed及父聚合不会漏计或重复计', async () => {
  const f = fixture(); const value = await f.run([rate(101), rate(103)]);
  assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(f.writes.length, 2);
  const facts = f.journal.filter(entry => entry.customType === 'bangumi/write').map(entry => entry.data);
  const parents = f.journal.filter(entry => entry.customType === 'bangumi/batch').map(entry => ({ kind: 'bangumi-batch', ...entry.data }));
  const submissions = facts.filter(fact => fact.phase === 'submission');
  assert.equal(submissions.length, 2); assert.equal(new Set(submissions.map(fact => fact.stageId)).size, 2);
  assert.equal(new Set(submissions.map(fact => fact.operationId)).size, 2);
  assert.ok(submissions.every(fact => typeof fact.stageId === 'string' && fact.stageId === fact.operationId));
  let now = Math.max(...submissions.map(fact => Date.parse(fact.attemptedAt)));
  const waits = [];
  const limiter = new WriteRateLimiter({ now: () => now, safetyMarginMs: 0, wait: async milliseconds => { waits.push(milliseconds); now += milliseconds; } });
  restoreWriteRateLimits(limiter, [...facts, ...parents]);
  const remaining = await limiter.reserve(42, 'Subject', WRITE_RATE_RULES.Subject.limit - 2);
  assert.equal(waits.length, 0, '两次实际提交应恰好消耗两份额度，不能把同阶段多条事实重复计数');
  const next = await limiter.reserve(42, 'Subject', 1);
  assert.ok(waits.length > 0, '窗口剩余额度用尽后必须等待，重启不能漏掉已派发子阶段');
  remaining.refundUndispatched(); next.refundUndispatched();
});

for (const applied of [true, false]) test(`同目录不同逻辑操作硬中断恢复保留合法后续行，未知行${applied ? '已生效可结案' : '未达目标先阻断且迟到生效可重新核实'}`, async () => {
  const hook = ({ path, body }) => { if (path === '/p1/indexes/500/related' && body.sid === 102) throw write404(); };
  const first = fixture(applied ? { afterWrite: hook } : { beforeWrite: hook });
  await first.run([102, 103].map(subject_id => ({ tool: 'add_subject_to_index', args: { index_id: 500, subject_id, comment: '', order: subject_id } })));
  assert.equal(first.writes.length, 2);
  // 模拟第二个独立操作已返回回执，进程在统一末尾回读之前中断；只保存实际已持久的阶段前缀。
  const entries = first.journal.filter(entry => entry.data.phase !== 'completed');
  const restarted = fixture({ entries, requestId: 'resilience-request-2' });
  restarted.relations.set(500, structuredClone(first.relations.get(500)));
  const value = await restarted.run([{ tool: 'update_index', args: { index_id: 500, title: '恢复后的新请求' } }]);
  if (applied) {
    assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(restarted.writes.length, 1);
    assert.ok(restarted.journal.some(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'reconciled'
      && entry.data.args?.subject_id === 102 && entry.data.state === 'success'));
  } else {
    assert.equal(value.items[0].state, 'blocked', JSON.stringify(value)); assert.equal(restarted.writes.length, 0);
    assert.ok(!restarted.journal.some(entry => entry.customType === 'bangumi/write' && entry.data.phase === 'reconciled' && entry.data.args?.subject_id === 102));
    // 已结案的103事实经过新boundary重新盖戳，不能改变冻结授权中的原scope顺序。
    const later = fixture({ entries: restarted.journal, requestId: 'resilience-request-3' });
    later.relations.set(500, [...structuredClone(restarted.relations.get(500)), {
      id: 901, sid: 102, comment: '', order: 102, subject: later.subjects.get(102),
    }]);
    const recovered = await later.run([{ tool: 'update_index', args: { index_id: 500, title: '迟到结果核实后的新请求' } }]);
    assert.equal(recovered.state, 'success', JSON.stringify(recovered)); assert.equal(later.writes.length, 1);
    assert.ok(!later.writes.some(row => row.path.endsWith('/related')));
  }
  assert.deepEqual(restarted.relations.get(500).map(row => row.sid), applied ? [102, 103] : [103]);
  assert.ok(!restarted.writes.some(row => row.path.endsWith('/related')), '恢复不能重发任一旧目录添加请求');
});

test('无需修改的角色也核实末尾保护范围，独立写入期间被外部取消不能仍报unchanged', async () => {
  const f = fixture({ afterWrite: ({ entities }) => { entities.characters.delete(701); } });
  f.entities.characters.add(701);
  const value = await f.run([character(), rate(103)]);
  assert.equal(f.writes.length, 1); assert.equal(value.items[1].state, 'success');
  assert.equal(value.items[0].actual.collected, false); assert.equal(value.items[0].state, 'failed', JSON.stringify(value));
  assert.equal(value.items[0].verification.requestedStateMatched, false); assert.equal(value.items[0].verification.protectedFieldsMatched, false);
  assert.equal(value.state, 'partial');
});

test('整项无需修改也不能把末尾全局账户核实失败伪装成完整unchanged', async () => {
  const f = fixture({ beforePreflight: ({ number }) => { if (number === 2) throw new AppError('ACCOUNT_CHANGED', '模拟无需修改项末尾账户变化'); } });
  f.entities.characters.add(701);
  const value = await f.run([character()]);
  assert.equal(f.writes.length, 0); assert.ok(!['success', 'unchanged'].includes(value.state), JSON.stringify(value));
  assert.equal(value.items[0].verification.readbackCompleted, false); assert.equal(value.items[0].verification.requestedStateMatched, false);
  assert.equal(value.items[0].verification.protectedFieldsMatched, false);
});
