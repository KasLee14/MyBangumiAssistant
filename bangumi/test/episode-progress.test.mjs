import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { validateToolArguments } from '../dist/src/mcp/catalog.js';
import { checkSubmission } from '../dist/src/mcp/submission.js';
import { AppError } from '../dist/src/support/errors.js';

function fixture({ anchorDone = false } = {}) {
  const account = { id: 42, username: 'test_user' };
  const episodes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, subjectID: 101, type: 0, sort: i + 1, name: `第${i + 1}集`, nameCN: '', collection: { status: i < 3 || i === 8 || anchorDone && i === 6 ? 2 : 0 } }));
  episodes.push({ id: 99, subjectID: 101, type: 1, sort: 4, name: 'SP', collection: { status: 2 } });
  const interest = { type: 3, rate: 6, comment: '保留短评', tags: ['测试'], private: false, epStatus: episodes.filter(e => e.collection.status === 2).length, volStatus: 0 };
  const subject = { id: 101, type: 2, name: '测试动画', nameCN: '测试动画', eps: 12, volumes: 0, interest };
  const requests = [];
  let user = account;
  let malformed;
  let ignoreEarlier = false;
  let onWrite;
  const transport = {
    currentUser: async () => user,
    close: async () => {},
    public: async path => {
      assert.equal(path, '/v0/subjects/101');
      return structuredClone(subject);
    },
    account: async (path, options = {}) => {
      if (options.expectedAccountId !== undefined && options.expectedAccountId !== user.id) throw new AppError('ACCOUNT_CHANGED', '模拟每请求会话绑定失效');
      if (options.method === 'PUT' && path === '/p1/collections/subjects/101') {
        requests.push({ path, ...structuredClone(options) });
        const { type, rate, comment, tags, private: visibility } = options.body;
        Object.assign(interest, { type, rate, comment, tags, private: visibility });
        return {};
      }
      if (options.method === 'PATCH') {
        requests.push({ path, ...structuredClone(options) });
        const anchor = episodes.find(e => e.id === Number(path.split('/').at(-1)));
        assert.ok(anchor);
        const affected = options.body.batch && !ignoreEarlier ? episodes.filter(e => e.type === 0 && e.sort <= anchor.sort) : [anchor];
        for (const episode of affected) episode.collection.status = options.body.batch ? 2 : options.body.type;
        interest.epStatus = episodes.filter(e => e.collection.status === 2).length;
        onWrite?.();
        return {};
      }
      if (path === '/p1/subjects/101') return structuredClone(subject);
      if (path === '/p1/subjects/101/episodes') {
        const { type, limit = 100, offset = 0 } = options.query;
        const all = type ? episodes.filter(e => e.type === type) : episodes; // 上游 type=0 缺陷
        const page = { data: all.slice(offset, offset + limit), total: all.length };
        return structuredClone(malformed?.(page, offset) ?? page);
      }
      if (path.startsWith('/p1/episodes/')) return structuredClone(episodes.find(e => e.id === Number(path.split('/').at(-1))));
      throw Error(`未预期的读取：${path}`);
    },
  };
  const service = new BangumiMcpService(transport);
  const input = { text: '把测试动画设置为看到第七集', generation: 1 };
  const records = [];
  const previews = [];
  let onAuthorize;
  let connected = true;
  const channel = { canConfirm: () => connected, confirm: async (_ctx, text) => { previews.push(text); return true; } };
  const client = { call: (...args) => service.call(...args) };
  const ctx = { sessionManager: { getEntries: () => [] } };
  const boundary = createWriteBoundary(client, () => input, record => records.push(record), channel);
  const authorize = boundary.authorize;
  boundary.authorize = (...args) => { onAuthorize?.(); return authorize(...args); };
  const batch = createBatchWriteTool(boundary, record => records.push(record));
  return { service, boundary, episodes, interest, requests, previews, records,
    setMalformed: fn => { malformed = fn; }, setUser: value => { user = value; },
    setIgnoreEarlier: () => { ignoreEarlier = true; }, beforeAuthorize: fn => { onAuthorize = fn; }, onWrite: fn => { onWrite = fn; },
    disconnect: () => { connected = false; },
    execute: async operations => (await batch.execute('test', { operations }, undefined, undefined, ctx)).details.value };
}
const until = { tool: 'update_single_episode_collection', args: { episode_id: 7, batch: true } };

test('正篇筛选重新分页，SP 与无筛选保持原语义', async () => {
  const f = fixture();
  for (const [args, total, count] of [[{ episode_type: 0 }, 12, 12], [{ episode_type: 0, limit: 5, offset: 5 }, 12, 5], [{ episode_type: 0, limit: 5, offset: 10 }, 12, 2], [{ episode_type: 0, offset: 12 }, 12, 0], [{ episode_type: 1 }, 1, 1], [{}, 13, 13]]) {
    const value = await f.service.call('get_user_episode_collection', { subject_id: 101, ...args });
    assert.equal(value.page.total, total);
    assert.equal(value.data.length, count);
  }
});
test('筛选拒绝重复、残缺和总数变化的源分页', async () => {
  for (const corrupt of [page => ({ ...page, data: [page.data[0], page.data[0], ...page.data.slice(2)] }), page => ({ ...page, data: [] })]) {
    const f = fixture(); f.setMalformed(corrupt);
    await assert.rejects(() => f.service.call('get_user_episode_collection', { subject_id: 101, episode_type: 0 }));
  }
  const f = fixture();
  for (let i = 0; i < 100; i++) f.episodes.push({ id: 1000 + i, subjectID: 101, type: 0, sort: 20 + i, name: '正篇', collection: { status: 0 } });
  f.setMalformed((page, offset) => offset ? { ...page, total: page.total + 1 } : page);
  await assert.rejects(() => f.service.call('get_user_episode_collection', { subject_id: 101, episode_type: 0 }), { code: 'INCOMPLETE_DATA' });
});
test('看到免确认使用一次官方请求，补齐前序并保护后续/SP/父收藏', async () => {
  const f = fixture(); const before = { ...f.interest };
  const value = await f.execute([until]);
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/p1/collections/episodes/7');
  assert.deepEqual(f.requests[0].body, { batch: true });
  for (let id = 1; id <= 7; id++) assert.equal(f.episodes.find(e => e.id === id).collection.status, 2);
  assert.equal(f.episodes.find(e => e.id === 9).collection.status, 2);
  assert.equal(f.episodes.find(e => e.id === 8).collection.status, 0);
  assert.equal(f.episodes.find(e => e.id === 99).collection.status, 2);
  assert.equal(f.interest.epStatus, 9);
  assert.equal(f.interest.type, before.type);
  assert.equal(f.interest.comment, before.comment);
  assert.equal(f.previews.length, 0);
  assert.deepEqual(value.confirmation, { required: false, reasons: [] });
  assert.deepEqual(value.items[0].submission.affectedEpisodeIds, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(value.items[0].verification.parentProgress.actual, 9);
});
test('目标已看过仍补齐前序缺口；整个范围达成才无写入', async () => {
  const f = fixture({ anchorDone: true });
  assert.equal((await f.execute([until])).state, 'success');
  assert.equal(f.requests.length, 1);
  const allDone = fixture();
  for (const e of allDone.episodes) if (e.type === 0 && e.sort <= 7) e.collection.status = 2;
  const value = await allDone.execute([until]);
  assert.equal(value.state, 'unchanged', JSON.stringify(value));
  assert.equal(allDone.requests.length, 0);
});
test('复数集看过只改显式列表，不补齐其他集', async () => {
  const f = fixture();
  const value = await f.execute([{ tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [4, 7], collection_type: 2 } }]);
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.equal(f.previews.length, 0);
  assert.deepEqual(value.confirmation, { required: false, reasons: [] });
  assert.deepEqual(f.requests.map(r => r.body), [{ type: 2, batch: false }, { type: 2, batch: false }]);
  assert.equal(f.episodes.find(e => e.id === 5).collection.status, 0);
});
test('单集看过保留默认单集行为，看到拒绝混入状态/特殊章节', async () => {
  const f = fixture();
  assert.equal((await f.execute([{ tool: 'update_single_episode_collection', args: { episode_id: 7 } }])).state, 'success');
  assert.deepEqual(f.requests[0].body, { type: 2, batch: false });
  assert.equal(f.episodes.find(e => e.id === 4).collection.status, 0);
  for (const status of [0, 1, 2, 3]) assert.throws(() => validateToolArguments('update_single_episode_collection', { episode_id: 7, batch: true, collection_type: status }));
  const special = fixture();
  assert.equal((await special.execute([{ ...until, args: { episode_id: 99, batch: true } }])).state, 'failed');
  assert.equal(special.requests.length, 0);
});
test('看到匹配官方 sort 规则，包含小数序号与同序号章节', async () => {
  const f = fixture();
  f.episodes.push({ id: 77, subjectID: 101, type: 0, sort: 6.5, name: '6.5', collection: { status: 0 } });
  f.episodes.push({ id: 78, subjectID: 101, type: 0, sort: 7, name: '另一光盘第7集', collection: { status: 0 } });
  assert.equal((await f.execute([until])).state, 'success');
  assert.equal(f.episodes.find(e => e.id === 77).collection.status, 2);
  assert.equal(f.episodes.find(e => e.id === 78).collection.status, 2);
});
test('批次只在末尾发现网站章节范围变化，每请求会话绑定仍拒绝其他账户', async () => {
  const range = fixture(); range.beforeAuthorize(() => range.episodes.push({ id: 88, subjectID: 101, type: 0, sort: 6, name: '新增', collection: { status: 0 } }));
  const changed = await range.execute([until]);
  assert.equal(changed.state, 'failed'); assert.equal(range.requests.length, 1);
  assert.equal(changed.items[0].verification.protectedFieldsMatched, false);
  const account = fixture(); account.beforeAuthorize(() => account.setUser({ id: 43, username: 'other' }));
  const rejected = await account.execute([until]);
  assert.equal(rejected.state, 'unknown'); assert.equal(account.requests.length, 0);
  assert.equal(rejected.items[0].submissionError.code, 'ACCOUNT_CHANGED');
});

test('章节免确认仍要求有效交互通道', async () => {
  const f = fixture(); f.disconnect();
  const value = await f.execute([until]);
  assert.equal(value.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal(f.previews.length, 0);
  assert.equal(f.requests.length, 0);
});
test('回读发现未补齐或范围外被修改时不报成功', async () => {
  for (const setup of [f => f.setIgnoreEarlier(), f => f.onWrite(() => { f.episodes.find(e => e.id === 8).collection.status = 2; })]) {
    const f = fixture(); setup(f); const value = await f.execute([until]);
    assert.equal(value.state, 'failed', JSON.stringify(value));
    assert.equal(f.requests.length, 1);
  }
});
test('动画进度字段被明确拒绝；响应说明集数含义', async () => {
  const f = fixture();
  const value = await f.execute([{ tool: 'update_subject_collection', args: { subject_id: 101, ep_status: 7 } }]);
  assert.equal(value.error.code, 'UNSUPPORTED_PROGRESS');
  assert.match(value.error.message, /动画/);
  assert.equal(f.requests.length, 0);
  const collection = await f.service.call('get_user_subject_collection', { username: '-', subject_id: 101 });
  assert.equal(collection.collection.progressMeaning, '已看集数');
});
test('多项章节操作免确认，正确承接范围与派生计数', async () => {
  const single = { tool: 'update_single_episode_collection', args: { episode_id: 5, collection_type: 2 } };
  for (const operations of [[until, { ...until, args: { episode_id: 10, batch: true } }], [single, until], [until, { tool: 'update_episode_collection', args: { subject_id: 101, episode_ids: [9], collection_type: 0 } }]]) {
    const f = fixture(); const value = await f.execute(operations);
    assert.equal(value.state, 'success', JSON.stringify(value));
    assert.equal(f.previews.length, 0);
    assert.deepEqual(value.confirmation, { required: false, reasons: [] });
    assert.equal(f.requests.length, 2);
  }
});

test('章节与单项评分混合不算批量审批，作品短评仍整计划确认一次', async () => {
  for (const [args, required] of [[{ rating: 8 }, false], [{ comment: '新的作品短评' }, true]]) {
    const f = fixture();
    const value = await f.execute([until, { tool: 'update_subject_collection', args: { subject_id: 101, ...args } }]);
    assert.equal(value.state, 'success', JSON.stringify(value));
    assert.equal(f.previews.length, required ? 1 : 0);
    assert.deepEqual(value.confirmation, { required, reasons: required ? ['发布或修改作品短评'] : [] });
    assert.equal(f.requests.length, 2);
    if (required) {
      assert.match(f.previews[0], /将《测试动画》看到指定章节/);
      assert.match(f.previews[0], /章节 #1、#2、#3、#4、#5、#6、#7：标记为看过/);
      assert.match(f.previews[0], /新的作品短评/);
    }
  }
});
test('回执必须绑定完整影响范围，普通单集不能伪装补齐范围', async () => {
  const f = fixture(); const args = validateToolArguments(until.tool, until.args);
  const binding = await f.boundary.prepare(until.tool, args, 42);
  const receipt = await f.service.call(until.tool, args, undefined, binding.guard);
  const forged = { ...receipt, affectedEpisodeIds: [7] };
  assert.throws(() => checkSubmission(until.tool, forged, args, 42, 101, binding.guard.prepared), { code: 'MCP_INVALID_RESULT' });
  assert.throws(() => checkSubmission(until.tool, receipt, { episode_id: 7, collection_type: 2 }, 42, 101), { code: 'MCP_INVALID_RESULT' });
});
