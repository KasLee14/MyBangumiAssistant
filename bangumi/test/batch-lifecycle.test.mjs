import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { AppError } from '../dist/src/support/errors.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBangumiMcpServer } from '../dist/src/mcp/server.js';

function fixture({ count = 26, failWrite, unknownAfterWrite, failVerify, afterWrite } = {}) {
  const viewer = { id: 42, username: 'test_user' };
  const subjects = new Map(Array.from({ length: count }, (_, i) => [101 + i, { id: 101 + i, type: 2, name: `作品${i}`, nameCN: `作品${i}`, eps: 12 }]));
  const book = { id: 201, type: 1, name: '书籍', eps: 100, volumes: 10,
    interest: { type: 3, rate: 5, comment: '保留', tags: ['原标签'], private: true, epStatus: 3, volStatus: 1 } };
  subjects.set(201, book);
  const index = { id: 500, uid: 42, title: '目录', desc: '简介', private: false };
  let created = false, collected = false, preflights = 0, confirmations = 0;
  const entities = { characters: new Set(), persons: new Set() };
  const relations = [], events = [], updates = [], facts = [];
  const controller = new AbortController();
  const page = (rows, options) => ({ data: structuredClone(rows.slice(options.query?.offset ?? 0, (options.query?.offset ?? 0) + (options.query?.limit ?? 100))), total: rows.length });
  const transport = {
    preflight: async () => {
      events.push({ kind: 'preflight' }); preflights++;
      if (failVerify && preflights === 2) throw new AppError('BGM_NETWORK', '模拟末尾预检断网');
      return { mode: 'account', account: viewer, nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true, checkedAt: '2026-10-04T00:00:00.000Z' };
    },
    currentUser: async () => viewer, close: async () => {}, public: async () => { throw Error('不应匿名读取'); },
    account: async (path, options = {}) => {
      assert.equal(options.expectedAccountId, 42);
      const method = options.method ?? 'GET'; events.push({ kind: method === 'GET' ? 'read' : 'write', path, method, body: structuredClone(options.body) });
      if (method !== 'GET') {
        const number = events.filter(e => e.kind === 'write').length;
        if (number === failWrite) throw new AppError('BGM_HTTP_403', '模拟拒绝');
        let value = {};
        if (path === '/p1/indexes') { created = true; value = { id: 500 }; Object.assign(index, { title: options.body.title, desc: options.body.desc, private: options.body.private }); }
        else if (path === '/p1/indexes/500/related' && method === 'PUT') {
          const id = 900 + number; relations.push({ id, sid: options.body.sid, order: options.body.order, comment: options.body.comment, subject: subjects.get(options.body.sid) }); value = { id };
        } else if (path === '/p1/indexes/500') Object.assign(index, { title: options.body.title ?? index.title, desc: options.body.desc ?? index.desc, private: options.body.private ?? index.private });
        else if (path.startsWith('/p1/indexes/500/related/')) {
          const id = Number(path.split('/').at(-1)); const row = relations.find(row => row.id === id); assert.ok(row);
          if (method === 'DELETE') relations.splice(relations.indexOf(row), 1); else Object.assign(row, options.body);
        } else if (path === '/p1/collections/indexes/500') collected = method === 'PUT';
        else if (path === '/p1/collections/subjects/201') {
          if (method === 'PUT') Object.assign(book.interest, { type: options.body.type, rate: options.body.rate, comment: options.body.comment, tags: options.body.tags, private: options.body.private });
          else Object.assign(book.interest, { epStatus: options.body.epStatus ?? book.interest.epStatus, volStatus: options.body.volStatus ?? book.interest.volStatus });
        } else if (/^\/p1\/collections\/(characters|persons)\/\d+$/.test(path)) {
          const [, kind, id] = /^\/p1\/collections\/(characters|persons)\/(\d+)$/.exec(path);
          if (method === 'PUT') entities[kind].add(Number(id)); else entities[kind].delete(Number(id));
        } else throw Error(`未支持写入 ${path}`);
        afterWrite?.({ number, controller, index, relations });
        if (number === unknownAfterWrite) throw new AppError('BGM_NETWORK', '模拟请求已生效但响应断开');
        return value;
      }
      if (/^\/p1\/subjects\/\d+$/.test(path)) return structuredClone(subjects.get(Number(path.split('/').at(-1))));
      if (path === '/p1/indexes/500') { assert.ok(created); return structuredClone(index); }
      if (path === '/p1/indexes/500/related') return page(relations, options);
      if (path === '/p1/collections/indexes') return page(collected ? [index] : [], options);
      const entity = /^\/p1\/(characters|persons)\/(\d+)$/.exec(path);
      if (entity) return { id: Number(entity[2]), name: entity[1], type: 1, career: [] };
      const collection = /^\/p1\/collections\/(characters|persons)$/.exec(path);
      if (collection) return page([...entities[collection[1]]].map(id => ({ id, name: '实体', type: 1 })), options);
      throw Error(`未支持读取 ${path}`);
    }
  };
  const service = new BangumiMcpService(transport);
  const input = { text: '按完整范围整理目录及收藏', generation: 1 };
  const boundary = createWriteBoundary({ call: (...args) => service.call(...args) }, () => input, value => facts.push(value),
    { canConfirm: () => true, confirm: async () => { confirmations++; return true; } });
  const batch = createBatchWriteTool(boundary, value => facts.push(value));
  const ctx = { sessionManager: { getEntries: () => [] } };
  const plan = [{ tool: 'create_index', args: { title: '目录', description: '简介' } }, ...Array.from({ length: count }, (_, i) => ({ tool: 'add_subject_to_index', index_from: 1, args: { subject_id: 101 + i, order: i, comment: `评语${i}` } }))];
  return { service, events, relations, index, updates, facts, plan, controller,
    get preflights() { return preflights; }, get confirmations() { return confirmations; },
    run: async (operations = plan) => (await batch.execute('test', { operations }, controller.signal, value => updates.push(value.details.value), ctx)).details.value };
}

test('26部目录计划只有开始/结束两次账户预检，中间27次写入没有读取，成功留到末尾回读', async () => {
  const f = fixture(); const value = await f.run();
  assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(value.summary.success, 27);
  assert.equal(f.preflights, 2); assert.equal(f.confirmations, 1); assert.equal(f.relations.length, 26);
  const first = f.events.findIndex(e => e.kind === 'write'); const last = f.events.findLastIndex(e => e.kind === 'write');
  assert.ok(f.events.slice(first, last + 1).every(e => e.kind === 'write'));
  assert.equal(f.events.filter(e => e.kind === 'write').length, 27);
  assert.equal(f.events.filter(e => e.kind === 'read' && e.path === '/p1/indexes/500/related').length, 1);
  assert.ok(f.updates.every(update => update.summary.success === 0));
  assert.ok(f.updates.some(update => update.summary.submitted === 27));
  assert.ok(value.items.every(item => item.verification.readbackCompleted && item.verification.scope === 'batch_final_state'));
});

test('混合目录/人物/角色/书籍任务都遵循统一两阶段读取，连续修改采用最终目标', async () => {
  const f = fixture({ count: 1 });
  const operations = [...f.plan,
    { tool: 'update_index_subject', index_from: 1, args: { subject_id: 101, comment: '最后评语', order: 2 } },
    { tool: 'remove_subject_from_index', index_from: 1, args: { subject_id: 101 } },
    { tool: 'update_index', index_from: 1, args: { title: '最后标题' } },
    { tool: 'collect_index', index_from: 1, args: {} }, { tool: 'uncollect_index', index_from: 1, args: {} },
    { tool: 'collect_character', args: { character_id: 701 } }, { tool: 'uncollect_character', args: { character_id: 701 } },
    { tool: 'collect_person', args: { person_id: 702 } }, { tool: 'uncollect_person', args: { person_id: 702 } },
    { tool: 'update_subject_collection', args: { subject_id: 201, rating: 7, ep_status: 5, vol_status: 2 } },
    { tool: 'update_subject_collection', args: { subject_id: 201, rating: 8 } }];
  const value = await f.run(operations);
  assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(value.summary.success, operations.length);
  assert.equal(f.preflights, 2); assert.equal(f.confirmations, 1); assert.equal(f.index.title, '最后标题'); assert.equal(f.relations.length, 0);
  assert.equal(value.items.at(-1).actual.rating, 8); assert.equal(value.items.at(-1).actual.ep_status, 5);
  assert.equal(value.items[0].verification.superseded, true);
  const first = f.events.findIndex(e => e.kind === 'write'), last = f.events.findLastIndex(e => e.kind === 'write');
  assert.ok(f.events.slice(first, last + 1).every(e => e.kind === 'write'));
});

test('中途取消停止后续，统一回读已提交部分，不把未执行项记成成功', async () => {
  const f = fixture({ count: 5, afterWrite: ({ number, controller }) => { if (number === 3) controller.abort(); } });
  const value = await f.run();
  assert.equal(value.state, 'failed', JSON.stringify(value)); assert.equal(value.partial, true);
  assert.equal(value.summary.success, 3); assert.equal(value.summary.not_executed, 3); assert.equal(f.preflights, 2);
  assert.equal(f.events.filter(e => e.kind === 'write').length, 3);
  assert.ok(value.items.slice(0, 3).every(item => item.verification.readbackCompleted));
});

test('合法回执绑定的未知响应不重发，核查保护范围后继续其他作品并回读已生效结果', async () => {
  const f = fixture({ count: 3, unknownAfterWrite: 2 }); const value = await f.run();
  assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(value.summary.success, 4); assert.equal(value.summary.not_executed, 0);
  assert.equal(f.events.filter(e => e.kind === 'write').length, 4);
  assert.equal(f.events.filter(e => e.kind === 'write' && e.body?.sid === 101).length, 1, '结果未知的原请求不能重发');
  const failedAt = f.events.findIndex(e => e.kind === 'write' && e.path === '/p1/indexes/500/related');
  const nextAt = f.events.findIndex((e, i) => i > failedAt && e.kind === 'write');
  assert.ok(f.events.slice(failedAt + 1, nextAt).some(e => e.kind === 'read' && e.path === '/p1/indexes/500/related'));
  assert.deepEqual(f.relations.map(row => row.sid), [101, 102, 103]);
});

test('中途条目HTTP错误保留未知，保护核查后其他作品继续且前序已完成结果保留', async () => {
  const f = fixture({ count: 4, failWrite: 3 }); const value = await f.run();
  assert.equal(value.state, 'unknown', JSON.stringify(value)); assert.equal(value.partial, true);
  assert.equal(value.summary.success, 4); assert.equal(value.summary.unknown, 1); assert.equal(value.summary.not_executed, 0);
  assert.equal(f.events.filter(e => e.kind === 'write').length, 5); assert.deepEqual(f.relations.map(row => row.sid), [101, 103, 104]);
  assert.ok(value.items.slice(0, 2).every(item => item.verification.protectedFieldsMatched && item.state === 'success'));
  assert.ok(value.items.slice(3).every(item => item.state === 'success'));
});

test('末尾发现范围外改动或回读失败，不把提交回执当成功', async () => {
  const changed = fixture({ count: 2, afterWrite: ({ number, index }) => { if (number === 3) index.desc = '范围外修改'; } });
  const value = await changed.run(); assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.summary.success, 0); assert.ok(value.items.every(item => !item.verification.protectedFieldsMatched));
  const offline = fixture({ count: 2, failVerify: true }); const unknown = await offline.run();
  assert.equal(unknown.state, 'unknown', JSON.stringify(unknown)); assert.equal(unknown.summary.unknown, 3);
  assert.ok(unknown.items.every(item => !item.verification.readbackCompleted));
  assert.equal(offline.events.filter(e => e.kind === 'write').length, 3);
});

test('冻结写入快照不能脱离批次使用，也不能在回读阶段再写或更换参数', async () => {
  const f = fixture({ count: 1 });
  const transport = { close: async () => {}, currentUser: async () => ({ id: 42, username: 'test_user' }), account: async () => { throw Error('不能写'); } };
  const service = new BangumiMcpService(transport); const args = { title: '目录', description: '简介', private: false };
  const guard = { accountId: 42, batchPreparation: { tool: 'create_index', args, before: null, after: args, target: { kind: 'newIndex' } } };
  await assert.rejects(service.call('create_index', args, undefined, guard), { code: 'AUTHORIZATION_REQUIRED' });
  const scope = { id: '12345678-1234-1234-1234-123456789012', phase: 'prepare' };
  await service.call('get_current_user', {}, undefined, undefined, scope);
  await assert.rejects(service.call('create_index', { ...args, title: '改变' }, undefined, guard, { ...scope, phase: 'submit' }), { code: 'STALE_PREVIEW' });
  await service.call('get_current_user', {}, undefined, undefined, { ...scope, phase: 'verify' });
  await assert.rejects(service.call('create_index', args, undefined, guard, { ...scope, phase: 'submit' }), { code: 'BATCH_SCOPE_INVALID' });
  await service.call('get_current_user', {}, undefined, undefined, { ...scope, phase: 'close' });
});

test('真实传输实现固定批次会话，Cookie变化以本地检查停止请求，无逐项/me', async () => {
  let saved = { version: 1, accountId: 42, username: 'test_user', sessionId: 'local-fixture-session', savedAt: 1, expiresAt: Date.now() + 100000 };
  const paths = [];
  const transport = createMcpTransport({ authDir: 'unused', proxy: null, timeoutMs: 10000, loadSession: async () => saved,
    fakeFetch: async (url) => { const path = new URL(url).pathname; paths.push(path);
      return new Response(JSON.stringify(path === '/p1/privacy' ? { preferences: { allowNsfw: true, showNsfwSubject: true } } : { id: 42, username: 'test_user' }), { headers: { 'content-type': 'application/json' } }); } });
  try {
    await transport.preflight(); await transport.setBatchSession(true);
    await transport.account('/p1/indexes/500', { expectedAccountId: 42 });
    assert.deepEqual(paths, ['/p1/me', '/p1/privacy', '/p1/indexes/500']);
    saved = { ...saved, savedAt: 2, sessionId: 'changed-fixture-session' };
    await assert.rejects(transport.account('/p1/indexes/500', { method: 'PATCH', expectedAccountId: 42 }), { code: 'ACCOUNT_CHANGED' });
    assert.equal(paths.length, 3);
  } finally { await transport.close(); }
});

test('宿主批次元数据经真实MCP SDK服务端保留，模型参数不能携带快照', async () => {
  const f = fixture({ count: 2 }); const server = createBangumiMcpServer(f.service);
  const client = new Client({ name: 'batch-test', version: '1' }, { capabilities: {} });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  try {
    const adapter = { call: async (name, args, _signal, guard, scope) => {
      const reply = await client.callTool({ name, arguments: args, _meta: { ...(guard ? { 'bangumi/guard': guard } : {}), ...(scope ? { 'bangumi/batch': scope } : {}) } });
      if (reply.isError) throw new AppError(reply.structuredContent.error.code, reply.structuredContent.error.message);
      return reply.structuredContent.value;
    } };
    const boundary = createWriteBoundary(adapter, () => ({ text: '创建目录并添加两部作品', generation: 1 }), () => {}, { canConfirm: () => true, confirm: async () => true });
    const batch = createBatchWriteTool(boundary, () => {});
    const value = (await batch.execute('sdk', { operations: f.plan }, undefined, undefined, { sessionManager: { getEntries: () => [] } })).details.value;
    assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(f.preflights, 2);
    const reply = await client.callTool({ name: 'create_index', arguments: { title: '不能伪造', description: '说明', batchPreparation: {} } });
    assert.equal(reply.isError, true); assert.equal(f.events.filter(e => e.kind === 'write').length, 3);
  } finally { await client.close(); await server.close(); await f.service.close(); }
});
