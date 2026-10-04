import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpTransport } from '../dist/src/mcp/transport.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { findToolDefinition, validateToolArguments } from '../dist/src/mcp/catalog.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { fullDate } from '../dist/src/mcp/collection-query.js';
import { AppError, safeError } from '../dist/src/support/errors.js';

const viewer = { id: 42, username: 'test_user' };
const context = (allowed = true) => ({ mode: 'account', account: viewer, nsfw: { preference: true, allowed, state: allowed === null ? 'unknown' : allowed ? 'enabled' : 'disabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });
const row = (id, date = '2026-04-01', type = 2, extra = {}) => ({ id, type: 2, name: `作品${id}`, nameCN: `作品${id}`, airtime: { date }, nsfw: id === 616453,
  eps: 12, volumes: 0, tags: [], metaTags: [], rating: { total: 10, score: 7 },
  interest: { type, rate: 6, tags: [], comment: '', private: false, epStatus: 12, volStatus: 0, updatedAt: 1700000000 }, ...extra });
const query = { username: '-', subject_type: 2, collection_type: 2, air_date: { min: '2026-04-01', max: '2026-04-30' } };
function collectionFixture(rows, options = {}) {
  const calls = []; const transport = {
    preflight: async () => options.context ?? context(), currentUser: async () => viewer, close: async () => {},
    webCollections: async () => { throw Error('登录查询不能读取匿名网页'); },
    public: async () => { throw Error('登录查询不能降级匿名'); },
    account: async (path, args) => { calls.push({ path, args }); assert.equal(path, '/p1/collections/subjects'); assert.equal(args.expectedAccountId, 42);
      const filtered = rows.filter(item => (args.query.type === undefined || item.interest.type === args.query.type) && item.type === args.query.subjectType);
      const { offset, limit } = args.query; const page = { data: filtered.slice(offset, offset + limit), total: filtered.length };
      return options.page ? options.page(page, offset) : page;
    },
  };
  return { service: new BangumiMcpService(transport), calls };
}

test('账户范围查询只分页看过，含私密/R18、月初月末及明确跨月补入；模型只得到匹配项', async () => {
  const rows = Array.from({ length: 220 }, (_, i) => row(i + 1, '2020-01-01'));
  rows.push(row(616453, '2026-04-05'), row(551455, '2026-03-28'), row(1001, '2026-04-30', 2, { interest: { ...row(1001).interest, private: true } }), row(1002, '2026-04-01'));
  rows.push(row(1003, '2026-04-10', 3), row(1004, '2026-05-01'), row(1005, '2026-03-31'));
  const f = collectionFixture(rows);
  const value = await f.service.call('query_user_collections', { ...query, extra_subject_ids: [551455, 1003], sort: 'date_asc' });
  assert.deepEqual(value.data.map(item => item.subjectId), [551455, 1002, 616453, 1001]);
  assert.equal(value.data[2].nsfw, true); assert.equal(value.data[0].matchBasis, 'explicit_subject');
  assert.deepEqual(value.missingExtraSubjectIds, [1003]); assert.equal(value.coverage.privateRecords, 'included');
  assert.equal(value.coverage.pagesRead, 3); assert.equal(value.coverage.complete, true);
  assert.equal(value.coverage.scannedCount, 226); assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.args.query.type === 2)); assert.equal(value.accessContext.nsfw.state, 'enabled');
  assert.ok(JSON.stringify(value).length < 4000); assert.ok(!JSON.stringify(value).includes('作品1"'));
});
test('未指定状态保留全部状态，日期未知不能声称完整', async () => {
  const f = collectionFixture([row(1), row(2, '2026-04-02', 3), row(3, '')]);
  const { collection_type: _, ...allStatuses } = query;
  const value = await f.service.call('query_user_collections', allStatuses);
  assert.equal(f.calls[0].args.query.type, undefined); assert.equal(value.matchedCount, 2);
  assert.equal(value.coverage.complete, false); assert.equal(value.coverage.unknownDateCount, 1);
});
test('收藏范围拒绝重复、总数漂移、残缺页及服务端忽略状态，失败不返回部分成功', async () => {
  const rows = Array.from({ length: 102 }, (_, i) => row(i + 1));
  for (const page of [p => ({ ...p, data: [...p.data.slice(1), p.data[1]] }),
    (p, offset) => offset ? { ...p, total: 103 } : p, p => ({ ...p, data: p.data.slice(1) }),
    p => ({ ...p, data: p.data.map((r, i) => i ? r : { ...r, interest: { ...r.interest, type: 3 } }) })]) {
    await assert.rejects(collectionFixture(rows, { page }).service.call('query_user_collections', query), e => ['INCOMPLETE_DATA', 'INVALID_RESPONSE'].includes(e.code));
  }
});
test('日期参数严格验证，不能传任意网址、错误类型或无效日历日期', () => {
  for (const args of [{ ...query, air_date: { min: '2026-02-30' } }, { ...query, air_date: { min: '2026-05-01', max: '2026-04-30' } },
    { ...query, url: 'https://evil.test' }, { ...query, collection_type: '2' }, { ...query, extra_subject_ids: [1, 1] }]) {
    assert.throws(() => validateToolArguments('query_user_collections', args), e => e.code === 'INVALID_INPUT');
  }
  for (const [input, expected] of [['2026年4月1日', '2026-04-01'], ['1话 / 2026-05-08', '2026-05-08'], ['2026-02-30', null], ['2026年4月', null]]) assert.equal(fullDate(input), expected);
});
function webPage(rows, total, number) {
  return `<a href="/anime/list/public_user/collect">看过 (${total})</a><div>( ${number} / ${Math.ceil(total / 24)} )</div>` + rows.map(r => `<li id="item_${r.id}"><h3><a href="/subject/${r.id}">作品${r.id}</a></h3><p class="info tip">${r.date}</p></li>`).join('');
}
test('未登录公开网页严格越过日期下界才停止，同日跨页不漏，ISO与中文日期均可解析', async () => {
  const pages = []; const dates = ['2026年5月1日', '2026-04-01', '2026年3月31日', '2026-02-01'];
  const rows = dates.flatMap((date, p) => Array.from({ length: 24 }, (_, i) => ({ id: p * 24 + i + 1, date })));
  const service = new BangumiMcpService({ currentUser: async () => { throw Error('公开查询不能加载凭据'); }, preflight: async () => anonymousContext(),
    public: async () => { throw Error('正确网页无需回退'); }, account: async () => { throw Error('公开查询不得用私密接口'); }, close: async () => {},
    webCollections: async (_u, _m, _s, page) => { pages.push(page); return webPage(rows.slice((page - 1) * 24, page * 24), 96, page); } });
  const value = await service.call('query_user_collections', { ...query, username: 'public_user' });
  assert.deepEqual(pages, [1, 2, 3]); assert.equal(value.matchedCount, 24);
  assert.deepEqual(value.data.map(item => item.subjectId), Array.from({ length: 24 }, (_, i) => i + 25));
  assert.equal(value.coverage.stopReason, 'date_boundary'); assert.equal(value.coverage.privateRecords, 'public_only');
  assert.equal(value.accessContext.nsfwApplied, false);
});
test('公开网页排序异常回退固定公开API，网络失败/取消不换路径', async () => {
  let apiCalls = 0;
  const make = html => new BangumiMcpService({ preflight: async () => anonymousContext(), currentUser: async () => viewer, close: async () => {},
    account: async () => { throw Error('不允许账户调用'); }, webCollections: async () => { if (html instanceof Error) throw html; return html; },
    public: async (_path, options) => { apiCalls++; assert.equal(options.query.type, 2); return { data: [{ subject_id: 1, type: 2, rate: 8, private: false, subject: { id: 1, type: 2, name: '公开作品', date: '2026-04-01' } }], total: 1 }; } });
  const value = await make(webPage([{ id: 1, date: '2026-03-31' }, { id: 2, date: '2026-04-01' }], 2, 1)).call('query_user_collections', { ...query, username: 'public_user' });
  assert.equal(value.coverage.source, 'v0'); assert.equal(value.matchedCount, 1); assert.equal(apiCalls, 1);
  await assert.rejects(make(new AppError('BGM_TIMEOUT', '超时')).call('query_user_collections', { ...query, username: 'public_user' }), e => e.code === 'BGM_TIMEOUT');
  assert.equal(apiCalls, 1);
});
function networkFixture({ session = true, preferences = { showNsfwSubject: true, allowNsfw: true }, privacyStatus = 200, meStatus = 200 } = {}) {
  const requests = []; const data = row(616453, '2026-04-05');
  const savedAt = Date.now() - 1000; const expiresAt = savedAt + 101000;
  const transport = createMcpTransport({ authDir: 'unused', proxy: null, timeoutMs: 1000,
    loadSession: async () => session ? { version: 1, ...viewer, accountId: 42, sessionId: 'offline-session-cookie', savedAt, expiresAt } : null,
    fakeFetch: async (url, init) => { requests.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }); const path = new URL(url).pathname;
      let body, status = 200;
      if (path === '/p1/me') { body = viewer; status = meStatus; }
      else if (path === '/p1/privacy') { body = { preferences }; status = privacyStatus; }
      else if (path === '/p1/subjects/616453') body = data;
      else if (path === '/v0/subjects/616453') { body = {}; status = 404; }
      else if (path === '/p1/search/subjects') body = { data: [data], total: 1 };
      else if (path === '/v0/search/subjects') body = { data: [{ ...data, id: 535669, nsfw: false, name_cn: data.nameCN, date: data.airtime.date }], total: 1 };
      else if (path === '/p1/subjects') body = { data: [{ ...data, id: 535669, nsfw: false }], total: 1 };
      else throw Error(`不允许的请求 ${path}`);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    } });
  return { transport, service: new BangumiMcpService(transport), requests };
}
test('账户详情与检索使用p1，公开筛选也先预检并报告NSFW限制，Cookie不发送到v0', async t => {
  const f = networkFixture(); t.after(() => f.service.close());
  const detail = await f.service.call('get_subject_details', { subject_id: 616453, include: [] });
  assert.equal(detail.nsfw, true); assert.equal(detail.accessContext.nsfw.state, 'enabled');
  assert.deepEqual(f.requests.slice(0, 3).map(r => new URL(r.url).pathname), ['/p1/me', '/p1/privacy', '/p1/subjects/616453']);
  await assert.rejects(f.service.call('search_subjects', { keyword: '', subject_type: 2, filter: { air_date: { min: '2026-04-01', max: '2026-04-30' } } }), e => e.code === 'SEARCH_CAPABILITY_UNSUPPORTED');
  const search = await f.service.call('search_subjects', { keyword: '', subject_type: 2, filter: { air_date: { min: '2026-04-01', max: '2026-04-30' }, nsfw: 'exclude' } });
  assert.equal(search.data[0].id, 535669);
  assert.equal(search.accessContext.nsfwApplied, false); assert.equal(search.accessContext.source, 'v0');
  assert.deepEqual(f.requests.find(r => r.url.includes('/v0/search/subjects')).body.filter.air_date, ['>=2026-04-01', '<=2026-04-30']);
  const byTag = await f.service.call('search_subjects', { keyword: '作品', subject_type: 2, filter: { tag: ['里番'], meta_tags: ['TV'] }, limit: 1 });
  assert.equal(byTag.accessContext.nsfwApplied, true);
  assert.deepEqual(f.requests.find(r => r.url.includes('/p1/search/subjects')).body.filter.tags, ['里番']);
  assert.deepEqual(f.requests.find(r => r.url.includes('/p1/search/subjects')).body.filter.metaTags, ['TV']);
  const browse = await f.service.call('browse_subjects', { subject_type: 2, year: 2026, month: 4, sort: 'date', nsfw: 'exclude' });
  assert.equal(browse.data[0].id, 535669); assert.equal(browse.accessContext.nsfwApplied, false);
  assert.ok(f.requests.every(r => r.headers.Cookie === (r.url.startsWith('https://next.bgm.tv/p1/') ? 'chiiNextSessionID=offline-session-cookie' : undefined)));
});
test('NSFW显示偏好与实际权限分别报告，权限不可读报告未知', async t => {
  for (const opts of [{ preferences: { showNsfwSubject: true, allowNsfw: false } }, { privacyStatus: 404 }]) {
    const f = networkFixture(opts); t.after(() => f.service.close()); const value = await f.service.call('get_current_user', {});
    assert.equal(value.accessContext.nsfw.state, opts.privacyStatus ? 'unknown' : 'disabled');
    assert.equal(value.accessContext.nsfw.allowed, opts.privacyStatus ? null : false);
    assert.equal(value.accessContext.nsfw.preference, opts.privacyStatus ? null : true);
  }
});
test('认证被拒绝时不降级匿名；无会话时匿名404仍保留NSFW上下文', async t => {
  const rejected = networkFixture({ meStatus: 401 }); t.after(() => rejected.service.close());
  await assert.rejects(rejected.service.call('get_subject_details', { subject_id: 616453 }), e => e.code === 'BGM_HTTP_401');
  assert.equal(rejected.requests.length, 1); assert.ok(!rejected.requests.some(r => r.url.includes('api.bgm.tv')));
  const anon = networkFixture({ session: false }); t.after(() => anon.service.close());
  await assert.rejects(anon.service.call('get_subject_details', { subject_id: 616453 }), e => {
    const error = safeError(e); return error.code === 'BGM_HTTP_404' && error.accessContext.mode === 'anonymous' && error.sourceTool === 'get_subject_details';
  });
  assert.equal(anon.requests.length, 1); assert.equal(anon.requests[0].headers.Cookie, undefined);
});
test('提交入口的账户预检失败保留未尝试回执，不能冒充已发送创建请求', async () => {
  let writes = 0;
  const service = new BangumiMcpService({ preflight: async () => { throw new AppError('BGM_HTTP_401', '会话失效'); },
    currentUser: async () => viewer, public: async () => { throw Error('不能退回匿名'); },
    account: async () => { writes++; throw Error('不能提交'); }, close: async () => {} });
  await assert.rejects(service.call('create_index', { title: '测试', description: '' }, undefined, { accountId: 42 }), error => {
    const safe = safeError(error); return safe.code === 'BGM_HTTP_401' && safe.submission.submissionState === 'not_attempted'
      && safe.accessContext.mode === 'unverified' && safe.accessContext.nsfw.state === 'unknown';
  });
  assert.equal(writes, 0);
});
test('固定输出拒绝互相矛盾的NSFW状态', async () => {
  const f = collectionFixture([row(1)]); const value = await f.service.call('query_user_collections', query);
  value.accessContext.nsfw.allowed = false;
  assert.throws(() => checkOutput(findToolDefinition('query_user_collections').outputSchema, { value }), e => e.code === 'MCP_INVALID_RESULT');
});
test('NSFW关闭时拒绝上游错误夹带R18，未把未知权限等同于关闭', async () => {
  await assert.rejects(collectionFixture([row(616453)], { context: context(false) }).service.call('query_user_collections', query), e => e.code === 'NSFW_SCOPE_MISMATCH');
  const value = await collectionFixture([row(616453)], { context: context(null) }).service.call('query_user_collections', query);
  assert.equal(value.accessContext.nsfw.state, 'unknown');
});
test('账户日历字典及带个人状态的章节映射保留只读投影，正篇0重新分页', async () => {
  const calls = [];
  const service = new BangumiMcpService({ preflight: async () => context(), currentUser: async () => viewer, close: async () => {},
    public: async () => { throw Error('不能退回匿名'); }, account: async (path, options) => {
      calls.push(path);
      if (path === '/p1/calendar') return Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), [{ subject: row(i + 1), watchers: 100 }]]));
      if (path === '/p1/subjects/101/episodes') return { data: [{ id: 1, type: 0, sort: 1, subjectID: 101, name: '正篇', collection: { type: 2 } }, { id: 2, type: 1, sort: 1, subjectID: 101, name: 'SP' }], total: 2 };
      throw Error(path);
    } });
  const calendar = await service.call('get_daily_broadcast', { limit: 1 });
  assert.equal(calendar.data.length, 7); assert.equal(calendar.data[0].subjects.data[0].id, 1);
  const episodes = await service.call('get_episodes', { subject_id: 101, episode_type: 0 });
  assert.equal(episodes.page.total, 1); assert.equal(episodes.data[0].id, 1); assert.equal(episodes.data[0].collection, undefined);
});
test('p1浏览总页数不能当条目总数；非完整窗口明确NSFW来源限制', async () => {
  const service = new BangumiMcpService({ preflight: async () => context(), currentUser: async () => viewer, close: async () => {},
    public: async () => { throw Error('不能退回匿名'); }, account: async (path, options) => {
      assert.equal(path, '/p1/subjects'); const page = options.query.page;
      return { data: page === 1 ? Array.from({ length: 21 }, (_, i) => row(i + 1)) : [row(99)], total: 2 };
    } });
  const first = await service.call('browse_subjects', { subject_type: 2, limit: 1, nsfw: 'exclude' });
  assert.equal(first.page.total, null); assert.equal(first.page.complete, false); assert.equal(first.accessContext.nsfwApplied, false);
  const tail = await service.call('browse_subjects', { subject_type: 2, offset: 21, limit: 1, nsfw: 'exclude' });
  assert.equal(tail.page.total, 22); assert.equal(tail.data[0].id, 99);
});
test('社区读取也先预检账户，正文快照不能跨账户或NSFW权限续读', async () => {
  let current = context(); let accountCalls = 0;
  const service = new BangumiMcpService({ preflight: async () => structuredClone(current), currentUser: async () => viewer, close: async () => {},
    public: async () => { throw Error('不能降级公开接口'); }, community: async () => { throw Error('不能绕过账户'); },
    account: async (path, options) => { accountCalls++; assert.equal(path, '/p1/subjects/616453/comments'); assert.equal(options.expectedAccountId, 42);
      return { data: [{ id: 1, user: { id: 7, username: 'reviewer', nickname: '评论者' }, type: 2, rate: 8, updatedAt: 1700000000, comment: '有权限的正文' }], total: 1 }; }
  });
  const value = await service.call('get_subject_comments', { subject_id: 616453, include: ['content'], limit: 1 });
  assert.equal(value.accessContext.nsfw.state, 'enabled'); const ref = value.data[0].content.contentRef;
  const same = await service.call('read_community_content', { content_ref: ref }); assert.equal(same.content.text, '有权限的正文');
  current = context(false);
  await assert.rejects(service.call('read_community_content', { content_ref: ref }), e => e.code === 'CONTENT_REF_INVALID');
  current = context(null);
  await assert.rejects(service.call('read_community_content', { content_ref: ref }), e => e.code === 'CONTENT_REF_INVALID');
  current = { ...context(), account: { id: 99, username: 'different_user' } };
  await assert.rejects(service.call('read_community_content', { content_ref: ref }), e => e.code === 'CONTENT_REF_INVALID');
  assert.equal(accountCalls, 1);
});
function indexFixture({ fail = false } = {}) {
  const writes = []; const records = []; const relations = []; let created = false;
  const index = { id: 500, uid: 42, title: '四月目录', desc: '测试目录', private: false };
  const transport = { preflight: async () => context(!fail), currentUser: async () => viewer, close: async () => {},
    public: async () => { throw Error('预检禁止匿名'); }, account: async (path, args = {}) => {
      if (args.method) {
        writes.push({ path, method: args.method });
        if (path === '/p1/indexes') { created = true; return { id: 500 }; }
        if (path === '/p1/indexes/500/related') { relations.push({ id: 900, sid: 616453, order: 1, comment: '', subject: row(616453) }); return { id: 900 }; }
        throw Error(`未预期写入 ${path}`);
      }
      if (path === '/p1/subjects/616453') { if (fail) throw new AppError('BGM_HTTP_404', '当前权限不可见'); return row(616453); }
      if (path === '/p1/indexes/500') { assert.equal(created, true); return index; }
      if (path === '/p1/collections/indexes') return { data: [], total: 0 };
      if (path === '/p1/indexes/500/related') return { data: relations, total: relations.length };
      throw Error(`未预期读取 ${path}`);
    } };
  const service = new BangumiMcpService(transport);
  const boundary = createWriteBoundary({ call: (...args) => service.call(...args) }, () => ({ text: '创建目录并加入这部看过的动画', generation: 1 }), record => records.push(record), { canConfirm: () => true, confirm: async () => true });
  const batch = createBatchWriteTool(boundary, record => records.push(record));
  const operations = [{ tool: 'create_index', args: { title: '四月目录', description: '测试目录' } }, { tool: 'add_subject_to_index', index_from: 1, args: { subject_id: 616453, order: 1 } }];
  return { writes, execute: async () => (await batch.execute('batch', { operations }, undefined, undefined, { sessionManager: { getEntries: () => [] } })).details.value };
}
test('模拟创建目录与加入R18经账户预检、一次授权、提交及独立回读成功', async () => {
  const f = indexFixture(); const value = await f.execute();
  assert.equal(value.state, 'success', JSON.stringify(value)); assert.equal(value.summary.success, 2);
  assert.deepEqual(f.writes.map(w => w.path), ['/p1/indexes', '/p1/indexes/500/related']);
  assert.equal(value.accessContext.nsfw.state, 'enabled'); assert.equal(value.writeNetworkAttempted, true);
});
test('R18预检404跳过加入步骤，并阻断没有可加入作品的附带空目录创建', async () => {
  const f = indexFixture({ fail: true }); const value = await f.execute();
  assert.equal(value.state, 'failed'); assert.equal(value.summary.skipped, 1); assert.equal(value.summary.blocked, 1); assert.equal(f.writes.length, 0);
  assert.equal(value.items[0].state, 'blocked'); assert.equal(value.items[1].state, 'skipped');
  assert.ok(value.failures.some(failure => failure.phase === 'preflight' && failure.step === 2
    && failure.tool === 'add_subject_to_index' && failure.sourceTool === 'get_subject_details'));
  assert.equal(value.writeNetworkAttempted, false); assert.equal(value.accessContext.nsfw.state, 'disabled');
});
