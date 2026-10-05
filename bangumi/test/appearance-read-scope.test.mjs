import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { safeError } from '../dist/src/support/errors.js';
import { PersonCharactersQuery } from '../dist/src/mcp/person-characters.js';

function fixture() {
  let session = { version: 1, accountId: 42, username: 'scope_reader', sessionId: 'offline-original-session',
    savedAt: Date.now(), expiresAt: Date.now() + 60000 };
  let preferences = { showNsfwSubject: true, allowNsfw: true };
  let rejected = false;
  const requests = [];
  const transport = createMcpTransport({ authDir: 'unused', proxy: null, timeoutMs: 1000,
    loadSession: async () => session,
    fakeFetch: async (url, init) => {
      const path = new URL(url).pathname;
      requests.push(path);
      assert.equal(init.method, 'GET');
      let body = {};
      if (path === '/p1/me') body = { id: 42, username: 'scope_reader' };
      else if (path === '/p1/privacy') body = { preferences };
      else if (/^\/p1\/subjects\/\d+$/.test(path)) body = { id: Number(path.split('/').at(-1)), type: 2 };
      else if (path === '/p1/persons/71/casts') body = { data: [], total: 0 };
      else throw Error('固定只读范围之外的请求');
      return new Response(JSON.stringify(body), { status: rejected ? 401 : 200, headers: { 'Content-Type': 'application/json' } });
    } });
  return { transport, requests, changeSession: () => { session = { ...session, sessionId: 'offline-replaced-session', savedAt: session.savedAt + 1 }; },
    changePrivacy: () => { preferences = { showNsfwSubject: false, allowNsfw: false }; }, reject: () => { rejected = true; } };
}

test('关系查询绑定独立只读上下文，拒绝写入路径、body、方法及错账户；并发读取保持绑定', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const context = await f.transport.preflight();
  const scope = await f.transport.bindReadScope(context); t.after(() => scope.close());
  assert.match(scope.key, /^[a-f0-9]{64}$/);
  const before = f.requests.length;
  for (const [path, options] of [['/p1/subjects/1', { method: 'POST' }], ['/p1/subjects/1', { body: {} }],
    ['/p1/collections/subjects', {}], ['/p1/subjects/1', { expectedAccountId: 99 }]]) {
    await assert.rejects(scope.account(path, options), e => ['INVALID_INPUT', 'ACCOUNT_CHANGED'].includes(e.code));
  }
  assert.equal(f.requests.length, before);
  const data = await Promise.all([scope.account('/p1/subjects/1'), scope.account('/p1/subjects/2')]);
  assert.deepEqual(data.map(row => row.id), [1, 2]);
  await scope.verify();
  await scope.close();
  await assert.rejects(scope.account('/p1/subjects/3'), e => e.code === 'MCP_CLOSED');
});

test('同账户重新登录也使旧只读上下文失效，新会话生成不同绑定键', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const old = await f.transport.bindReadScope(await f.transport.preflight()); t.after(() => old.close());
  f.changeSession();
  const before = f.requests.length;
  await assert.rejects(old.account('/p1/subjects/1'), e => e.code === 'ACCOUNT_CHANGED');
  await assert.rejects(old.verify(), e => e.code === 'ACCOUNT_CHANGED');
  assert.equal(f.requests.length, before);
  const fresh = await f.transport.bindReadScope(await f.transport.preflight()); t.after(() => fresh.close());
  assert.notEqual(fresh.key, old.key);
  assert.equal((await fresh.account('/p1/subjects/1')).id, 1);
});

test('读取结束重新核实 NSFW 权限；401 标记会话被拒绝而不继续业务读取', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const scope = await f.transport.bindReadScope(await f.transport.preflight()); t.after(() => scope.close());
  f.changePrivacy();
  await assert.rejects(scope.verify({ usedNsfw: true }), e => e.code === 'NSFW_SCOPE_CHANGED');
  f.reject();
  await assert.rejects(scope.account('/p1/subjects/1'), e => e.code === 'BGM_HTTP_401');
  const before = f.requests.length;
  await assert.rejects(f.transport.preflight(), e => e.code === 'BGM_AUTH_EXPIRED');
  assert.equal(f.requests.length, before);
});

test('取消时只读上下文不再派发请求，错误仍按固定 CANCELLED 分类', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const controller = new AbortController();
  const scope = await f.transport.bindReadScope(await f.transport.preflight(), controller.signal); t.after(() => scope.close());
  const before = f.requests.length;
  controller.abort();
  await assert.rejects(scope.account('/p1/subjects/1'), e => safeError(e).code === 'CANCELLED');
  assert.equal(f.requests.length, before);
});

test('写入清缓存后，在途查询不能重新发布写前的本人收藏快照', async () => {
  let detailStarted, finishDetail;
  const started = new Promise(resolve => { detailStarted = resolve; });
  const finish = new Promise(resolve => { finishDetail = resolve; });
  const query = new PersonCharactersQuery({ public: async () => { throw Error('不能降级匿名'); } });
  const context = { mode: 'account', account: { id: 42, username: 'scope_reader' },
    nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true,
    checkedAt: new Date().toISOString() };
  const args = { person_id: 71, subject_type: 2, appearance_role: 'main', subject_form: 'tv',
    include: ['own_collection'], limit: 20, offset: 0 };
  let detailReads = 0;
  const options = { scopeKey: 'offline-session', verifyScope: async () => {}, readAccount: async path => {
    if (path.endsWith('/casts')) return { total: 1, data: [{ character: { id: 11, name: '角色', role: 1 },
      relations: [{ type: 1, subject: { id: 101, type: 2, name: '作品', metaTags: ['TV'] } }] }] };
    assert.equal(path, '/p1/subjects/101');
    const beforeWrite = detailReads++ === 0;
    if (beforeWrite) { detailStarted(); await finish; }
    return { id: 101, type: 2, name: '作品', platform: { name: 'TV' }, metaTags: ['TV'],
      interest: { type: beforeWrite ? 2 : 5, epStatus: 1, volStatus: 0 } };
  } };
  const pending = query.call(args, structuredClone(context), undefined, options);
  await started;
  const rejected = assert.rejects(pending, e => e.code === 'SNAPSHOT_EXPIRED');
  query.clear(); finishDetail(); await rejected;
  const fresh = await query.call(args, structuredClone(context), undefined, options);
  assert.equal(fresh.data[0].ownCollection.collectionStatus, 5);
  assert.equal(detailReads, 2);
});
