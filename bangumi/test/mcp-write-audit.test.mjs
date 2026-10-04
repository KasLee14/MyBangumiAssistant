import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { advanceWriteView, createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { SubmissionTracker, checkSubmission } from '../dist/src/mcp/submission.js';
import { preparedBaseline } from '../dist/src/mcp/prepared.js';
import { batchScope } from '../dist/src/mcp/batch-context.js';
import { AppError, SubmissionError } from '../dist/src/support/errors.js';

// 只运行内存固定服务；所有账号、HTTP及提交事实都是离线夹具。
function fixture({ rewriteReceipt, finalChange, failFinal, finalAccountChange, cancelAfter, refuseBeforeDispatch,
  initialNsfw = { preference: true, allowed: true, state: 'enabled' }, finalNsfw, finalNsfwApplied = true } = {}) {
  const viewer = { id: 42, username: 'test_user' };
  const index = { id: 500, uid: 42, title: '目录', desc: '简介', private: false };
  const subject = { id: 101, type: 2, name: '作品', nameCN: '作品', eps: 12 };
  const relations = [], writes = [], facts = [], updates = [], reads = [];
  const controller = new AbortController();
  let checks = 0, finalAccountReads = 0, connected = true;
  const transport = {
    close: async () => {}, currentUser: async () => viewer,
    preflight: async () => {
      checks++;
      if (checks === 2) {
        finalChange?.(index);
        if (failFinal) throw new AppError('BGM_NETWORK', '离线夹具模拟最终预检失败');
      }
      return { mode: 'account', account: viewer, nsfw: structuredClone(checks === 2 && finalNsfw ? finalNsfw : initialNsfw),
        source: 'p1', nsfwApplied: checks === 2 ? finalNsfwApplied : true, checkedAt: '2026-10-04T00:00:00.000Z' };
    },
    public: async () => { throw Error('不应调用匿名传输'); },
    account: async (path, options = {}) => {
      assert.equal(options.expectedAccountId, 42);
      if (options.method && options.method !== 'GET') {
        if (refuseBeforeDispatch) {
          const error = new AppError('ACCOUNT_CHANGED', '离线夹具模拟提交前会话拒绝');
          Object.defineProperty(error, 'networkAttempted', { value: false }); throw error;
        }
        writes.push({ path, method: options.method, body: structuredClone(options.body) });
        let value;
        if (path === '/p1/indexes') {
          Object.assign(index, { title: options.body.title, desc: options.body.desc, private: options.body.private });
          value = { id: 500 };
        } else if (path === '/p1/indexes/500') {
          Object.assign(index, { title: options.body.title ?? index.title, desc: options.body.desc ?? index.desc,
            private: options.body.private ?? index.private }); value = { id: 500 };
        } else if (path === '/p1/indexes/500/related') {
          const row = { id: 900, sid: 101, comment: options.body.comment, order: options.body.order, subject };
          relations.push(row); value = { id: 900 };
        } else throw Error(`未登记写入路径 ${path}`);
        if (writes.length === cancelAfter) controller.abort();
        return value;
      }
      reads.push({ path, final: checks >= 2 });
      if (path === '/p1/indexes/500') return structuredClone(index);
      if (path === '/p1/collections/indexes') return { data: [], total: 0 };
      if (path === '/p1/indexes/500/related') return { data: structuredClone(relations), total: relations.length };
      if (path === '/p1/subjects/101') return structuredClone(subject);
      throw Error(`未登记读取路径 ${path}`);
    },
  };
  const service = new BangumiMcpService(transport);
  const client = { call: async (...args) => {
    const value = await service.call(...args);
    if (args[0] === 'get_current_user' && args[4]?.phase === 'verify') {
      finalAccountReads++;
      if (finalAccountChange && finalAccountReads === 2) return { ...value, id: 43,
        accessContext: { ...value.accessContext, account: { id: 43, username: viewer.username } } };
    }
    return args[3] ? rewriteReceipt?.(structuredClone(value)) ?? value : value;
  } };
  const input = { text: '按完整范围修改目录', generation: 1 };
  const boundary = createWriteBoundary(client, () => input, value => facts.push(value),
    { canConfirm: () => connected, confirm: async () => true });
  const batch = createBatchWriteTool(boundary, value => facts.push(value));
  const ctx = { sessionManager: { getEntries: () => [] } };
  return { writes, reads, facts, updates, index, input, boundary, ctx, disconnect: () => { connected = false; },
    run: async operations => (await batch.execute('audit', { operations }, controller.signal,
      value => updates.push(value.details.value), ctx)).details.value };
}
const createAndAdd = [
  { tool: 'create_index', args: { title: '新目录', description: '简介' } },
  { tool: 'add_subject_to_index', index_from: 1, args: { subject_id: 101 } },
];
const update = { tool: 'update_index', args: { index_id: 500, title: '新标题' } };

test('正常回执校验失败不采用创建ID，也不继续目录依赖步骤', async () => {
  const f = fixture({ rewriteReceipt: receipt => ({ ...receipt, expectedAccountId: 43 }) });
  const value = await f.run(createAndAdd);
  assert.equal(value.state, 'unknown', JSON.stringify(value));
  assert.equal(f.writes.length, 1);
  assert.equal(value.items[0].submission, undefined);
  assert.equal(value.items[1].state, 'not_executed');
  assert.equal(value.items[1].target.indexFrom, 1);
  assert.equal(value.writeNetworkAttempted, true);
});

test('异常回执同样须通过契约与账号绑定，不能伪造已确认创建继续依赖', async () => {
  const f = fixture({ rewriteReceipt: receipt => {
    throw new SubmissionError('BGM_NETWORK', '离线夹具模拟错误回执', { ...receipt, expectedAccountId: 43 });
  } });
  const value = await f.run(createAndAdd);
  assert.equal(value.state, 'unknown', JSON.stringify(value));
  assert.equal(f.writes.length, 1);
  assert.equal(value.items[0].submission, undefined);
  assert.equal(value.items[1].state, 'not_executed');
});

test('错误返回即使携带合法已确认回执也停止后续，已创建ID与末尾核实仍准确', async () => {
  const f = fixture({ rewriteReceipt: receipt => { throw new SubmissionError('MCP_INVALID_RESULT', '离线夹具模拟提交后错误', receipt); } });
  const value = await f.run(createAndAdd);
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.partial, true);
  assert.equal(value.items[0].state, 'success');
  assert.equal(value.items[0].submission.createdId, 500);
  assert.equal(value.items[1].state, 'not_executed');
  assert.equal(value.items[1].target.indexId, 500);
  assert.equal(f.writes.length, 1);
});

test('未知提交独立回读核实目标后可报告成功，提交阶段不提前报成功且不重发', async () => {
  const f = fixture({ rewriteReceipt: receipt => {
    const unknown = { ...receipt, submissionState: 'unknown', items: receipt.items.map(item => ({ ...item, submissionState: 'unknown' })) };
    throw new SubmissionError('BGM_NETWORK', '离线夹具模拟响应断开', unknown);
  } });
  const value = await f.run([update]);
  assert.equal(value.state, 'failed', JSON.stringify(value)); // 未知响应触发停止；已核实项单列成功。
  assert.equal(value.items[0].state, 'success');
  assert.equal(value.items[0].submission.submissionState, 'unknown');
  assert.equal(value.items[0].verification.readbackCompleted, true);
  assert.equal(f.writes.length, 1);
  assert.ok(f.updates.every(value => value.summary.success === 0));
});

test('全无变更计划的最终基线漂移应报告失败，并明确没有写入网络尝试', async () => {
  const f = fixture({ finalChange: index => { index.desc = '范围外变化'; } });
  const value = await f.run([{ ...update, args: { index_id: 500, title: '目录' } }]);
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.items[0].state, 'failed');
  assert.equal(value.items[0].verification.protectedFieldsMatched, false);
  assert.equal(value.items[0].verification.readbackCompleted, true);
  assert.equal(value.networkAttempted, false);
  assert.equal(value.writeNetworkAttempted, false);
  assert.equal(f.writes.length, 0);
});

test('全无变更计划回读失败不会伪造未知写入', async () => {
  const f = fixture({ failFinal: true });
  const value = await f.run([{ ...update, args: { index_id: 500, title: '目录' } }]);
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.summary.unknown, 0);
  assert.equal(value.items[0].verification.readbackCompleted, false);
  assert.equal(value.writeNetworkAttempted, false);
  assert.equal(f.writes.length, 0);
});

test('最终读取期间账户变更应丢弃原回读，已提交项保留未知', async () => {
  const f = fixture({ finalAccountChange: true });
  const value = await f.run([update]);
  assert.equal(value.state, 'unknown', JSON.stringify(value));
  assert.equal(value.items[0].verification.readbackCompleted, false);
  assert.equal(value.items[0].verificationError.code, 'ACCOUNT_CHANGED');
  assert.equal(f.writes.length, 1);
});

test('取消已提交批次仍核实真实目录ID，后续依赖保持未执行', async () => {
  const f = fixture({ cancelAfter: 1 });
  const value = await f.run(createAndAdd);
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.partial, true);
  assert.equal(value.items[0].state, 'success');
  assert.equal(value.items[0].submission.createdId, 500);
  assert.equal(value.items[1].state, 'not_executed');
  assert.equal(f.writes.length, 1);
});

test('写入前交互断开没有提交事实与写网络尝试', async () => {
  const f = fixture(); f.disconnect();
  const value = await f.run([update]);
  assert.equal(value.error.code, 'AUTHORIZATION_REQUIRED');
  assert.equal(value.writeNetworkAttempted, false);
  assert.equal(f.writes.length, 0);
  assert.ok(f.facts.every(fact => fact.phase !== 'started'));
});

test('业务请求未dispatch的本地拒绝不能报告写入尝试或目标已核实', async () => {
  const f = fixture({ refuseBeforeDispatch: true });
  const value = await f.run([update]);
  assert.equal(value.state, 'failed', JSON.stringify(value));
  assert.equal(value.items[0].submission.submissionState, 'not_attempted');
  assert.equal(value.items[0].verification.requestedStateMatched, false);
  assert.equal(value.items[0].verification.protectedFieldsMatched, true);
  assert.equal(value.networkAttempted, false);
  assert.equal(value.writeNetworkAttempted, false);
  assert.equal(f.writes.length, 0);
});

test('已核对快照拒绝字符串状态、缺失负进度与嵌套未知字段', () => {
  const collection = { subjectId: 101, status: 3, rate: 5, comment: '', tags: [], private: false, chapters: 2, volumes: 0 };
  const valid = { type: 'anime', collection, episodes: [{ id: 7, type: 0, status: 0 }] };
  assert.deepEqual(preparedBaseline(valid), valid);
  for (const change of [{ status: '3' }, { chapters: -1 }, { volumes: undefined }, { chapters: null }, { unknown: true }]) {
    assert.throws(() => preparedBaseline({ ...valid, collection: { ...collection, ...change } }), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => preparedBaseline({ ...valid, episodes: [{ ...valid.episodes[0], extra: true }] }), { code: 'INVALID_INPUT' });
});

test('宿主批次ID须具有UUID分段结构，长度正确的任意连字符不能成为上下文', () => {
  assert.equal(batchScope({ id: '12345678-1234-1234-1234-123456789012', phase: 'prepare' }).phase, 'prepare');
  for (const id of ['-'.repeat(36), 'a'.repeat(36), '12345678-1234-1234-123-1234567890123']) {
    assert.throws(() => batchScope({ id, phase: 'prepare' }), { code: 'BATCH_SCOPE_INVALID' });
  }
});

test('回执逐项对象与整体对象均必须绑定原请求，非创建工具不能声明新ID', async () => {
  const args = { character_id: 701 };
  const tracker = new SubmissionTracker('collect_character', args, 42);
  await tracker.submit('/p1/collections/characters/701', 'PUT', async () => ({}));
  const receipt = tracker.finish({});
  checkSubmission('collect_character', receipt, args, 42);
  for (const forged of [
    { ...receipt, items: [{ ...receipt.items[0], target: { kind: 'character', id: 702 } }] },
    { ...receipt, createdId: 500 }, { ...receipt, relatedId: 900 }, { ...receipt, requestedEpisodeStatus: 2 },
    { ...receipt, submissionState: 'not_attempted' },
  ]) assert.throws(() => checkSubmission('collect_character', forged, args, 42), { code: 'MCP_INVALID_RESULT' });
});

test('多阶段回执遵守串行前缀，汇总partial不能与零提交事实矛盾', async () => {
  const args = { subject_id: 201, rating: 8, ep_status: 5 };
  const tracker = new SubmissionTracker('update_subject_collection', args, 42);
  await tracker.submit('/p1/collections/subjects/201', 'PUT', async () => ({}));
  const partial = tracker.failed();
  checkSubmission('update_subject_collection', partial, args, 42);
  assert.throws(() => checkSubmission('update_subject_collection', { ...partial,
    items: [...partial.items].reverse().map((item, i) => ({ ...item, stage: partial.items[i].stage })) }, args, 42), { code: 'MCP_INVALID_RESULT' });
  const idle = new SubmissionTracker('update_subject_collection', args, 42).failed();
  assert.throws(() => checkSubmission('update_subject_collection', { ...idle, submissionState: 'partial' }, args, 42), { code: 'MCP_INVALID_RESULT' });
});

test('传输明确证明未dispatch才恢复not_attempted；取消/HTTP错误不得按错误码猜测', async () => {
  const args = { character_id: 701 };
  const local = new SubmissionTracker('collect_character', args, 42);
  const refused = new AppError('ACCOUNT_CHANGED', '离线夹具模拟请求前本地身份拒绝');
  Object.defineProperty(refused, 'networkAttempted', { value: false });
  await assert.rejects(local.submit('/p1/collections/characters/701', 'PUT', async () => { throw refused; }));
  assert.equal(local.failed().submissionState, 'not_attempted');
  for (const code of ['ACCOUNT_CHANGED', 'CANCELLED', 'BGM_HTTP_403', 'BGM_NETWORK']) {
    const uncertain = new SubmissionTracker('collect_character', args, 42);
    await assert.rejects(uncertain.submit('/p1/collections/characters/701', 'PUT', async () => { throw new AppError(code, '未提供dispatch事实'); }));
    assert.equal(uncertain.failed().submissionState, 'unknown');
  }
});

test('宿主token遇未知提交或进入回读后不能继续授权后续步骤，核查仍可完成', async () => {
  for (const uncertain of [false, true]) {
    const f = fixture({ rewriteReceipt: uncertain ? receipt => {
      throw new SubmissionError('BGM_NETWORK', '离线夹具模拟未知响应', { ...receipt, submissionState: 'unknown',
        items: receipt.items.map(item => ({ ...item, submissionState: 'unknown' })) });
    } : undefined });
    const viewer = await f.boundary.beginBatch();
    try {
      const view = new Map();
      const first = { name: update.tool, binding: await f.boundary.prepare(update.tool, update.args, 42, undefined, view) };
      const initial = structuredClone(first.binding.baseline);
      advanceWriteView(view, first, 42);
      const second = { name: update.tool, binding: await f.boundary.prepare(update.tool, { ...update.args, title: '下一标题' }, 42, undefined, view) };
      const token = await f.boundary.authorize([first, second], initial, f.input, viewer, f.ctx);
      await f.boundary.executeApproved(token, undefined, 'direct/1');
      if (uncertain) await assert.rejects(f.boundary.executeApproved(token, undefined, 'direct/2'), { code: 'AUTHORIZATION_REQUIRED' });
      const verified = await f.boundary.finishApproved(token);
      assert.equal(verified[0].state, 'success');
      await assert.rejects(f.boundary.executeApproved(token, undefined, 'direct/2'), { code: 'AUTHORIZATION_REQUIRED' });
      assert.equal(f.writes.length, 1);
      f.boundary.revoke(token);
    } finally { await f.boundary.endBatch(); }
  }
});

test('批次末尾NSFW范围变化拒绝混用快照，无论权限收紧、扩大、未知或偏好变化', async () => {
  const enabled = { preference: true, allowed: true, state: 'enabled' };
  const disabled = { preference: false, allowed: false, state: 'disabled' };
  const unknown = { preference: null, allowed: null, state: 'unknown' };
  for (const [initialNsfw, finalNsfw] of [[enabled, disabled], [disabled, enabled], [enabled, unknown],
    [enabled, { ...enabled, preference: false }]]) {
    const f = fixture({ initialNsfw, finalNsfw });
    const value = await f.run([update]);
    assert.equal(value.state, 'unknown', JSON.stringify(value));
    assert.equal(value.summary.success, 0);
    assert.equal(value.items[0].verification.readbackCompleted, false);
    assert.equal(value.items[0].verificationError.code, 'NSFW_SCOPE_CHANGED');
    assert.deepEqual(value.accessContext.nsfw, finalNsfw);
    assert.equal(f.reads.filter(read => read.final).length, 0);
    assert.equal(f.writes.length, 1);
  }
});

test('NSFW范围应用状态变化及无变更计划同样不能假报完成', async () => {
  for (const [option, operations, state, writes] of [
    [{ finalNsfwApplied: false }, [update], 'unknown', 1],
    [{ finalNsfw: { preference: false, allowed: false, state: 'disabled' } },
      [{ ...update, args: { index_id: 500, title: '目录' } }], 'failed', 0],
  ]) {
    const f = fixture(option); const value = await f.run(operations);
    assert.equal(value.state, state, JSON.stringify(value));
    assert.equal(value.items[0].verificationError.code, 'NSFW_SCOPE_CHANGED');
    assert.equal(value.items[0].verification.readbackCompleted, false);
    assert.equal(f.reads.filter(read => read.final).length, 0);
    assert.equal(f.writes.length, writes);
  }
});

test('开始预检范围保持独立副本，传输返回对象被修改也不能改写原范围', async () => {
  const context = { mode: 'account', account: { id: 42, username: 'test_user' },
    nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true,
    checkedAt: '2026-10-04T00:00:00.000Z' };
  const service = new BangumiMcpService({ preflight: async () => context, currentUser: async () => context.account,
    close: async () => {}, account: async () => { throw Error('NSFW范围变更后不能开始读取业务对象'); } });
  const scope = { id: '12345678-1234-1234-1234-123456789012', phase: 'prepare' };
  await service.call('get_current_user', {}, undefined, undefined, scope);
  context.nsfw.allowed = false; context.nsfw.state = 'disabled';
  try {
    await assert.rejects(service.call('get_current_user', {}, undefined, undefined, { ...scope, phase: 'verify' }), { code: 'NSFW_SCOPE_CHANGED' });
  } finally {
    await service.call('get_current_user', {}, undefined, undefined, { ...scope, phase: 'close' });
    await service.close();
  }
});
