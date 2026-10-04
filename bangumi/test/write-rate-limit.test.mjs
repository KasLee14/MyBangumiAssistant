import assert from 'node:assert/strict';
import test from 'node:test';
import { WriteRateLimiter, WRITE_RATE_RULES, writeRateRequests, restoreWriteRateLimits } from '../dist/src/mcp/write-rate-limit.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';

function clock() {
  let now = 10_000;
  const sleeps = [];
  const limiter = new WriteRateLimiter({ now: () => now, safetyMarginMs: 0,
    wait: async milliseconds => { sleeps.push(milliseconds); now += milliseconds; },
  });
  return { limiter, sleeps, now: () => now, advance: milliseconds => { now += milliseconds; } };
}
async function fill(limiter, accountId, action, count = WRITE_RATE_RULES[action].limit) {
  for (let index = 0; index < count; index++) (await limiter.reserve(accountId, action)).dispatched();
}

test('所有已开放写工具都有固定限流映射，新增未登记工具失败关闭', () => {
  const writes = TOOL_DEFINITIONS.filter(tool => tool.effect === 'write');
  assert.equal(writes.length, 14);
  for (const tool of writes) assert.ok(writeRateRequests(tool.name, { rating: 8, episode_ids: [1] }).length);
  assert.throws(() => writeRateRequests('future_write', {}), error => error.code === 'UNKNOWN_TOOL');
  assert.deepEqual(Object.fromEntries(Object.entries(WRITE_RATE_RULES).map(([action, rule]) => [action, rule.limit])),
    { Subject: 15, Character: 15, Person: 15, Index: 10, IndexEdit: 15, Episode: 10 });
});

test('HTTP 阶段计数：复数章节逐次计数，官方看到此集计一次，书籍 PUT/PATCH 计两次', () => {
  assert.deepEqual(writeRateRequests('update_episode_collection', { episode_ids: [1, 2, 3] }), [{ action: 'Episode', count: 3 }]);
  assert.deepEqual(writeRateRequests('update_single_episode_collection', { batch: true }), [{ action: 'Episode', count: 1 }]);
  assert.deepEqual(writeRateRequests('update_subject_collection', { rating: 8, ep_status: 5, vol_status: 1 }), [{ action: 'Subject', count: 2 }]);
  assert.deepEqual(writeRateRequests('update_subject_collection', { ep_status: 5 }), [{ action: 'Subject', count: 1 }]);
  assert.deepEqual(writeRateRequests('update_subject_collection', { comment: '', private: false }), [{ action: 'Subject', count: 1 }]);
});

test('创建目录与添加作品共享 15 次额度，第 16 次在宿主 RPC 前等待', async () => {
  const fixture = clock(); const events = [];
  await fill(fixture.limiter, 534925, 'IndexEdit');
  let rpcCalls = 0;
  const reservation = await fixture.limiter.reserve(534925, 'IndexEdit', 1, { onWait: event => events.push({ ...event, rpcCalls }) });
  rpcCalls++; reservation.dispatched();
  assert.equal(events[0].nextAllowedAt, 310_000);
  assert.equal(events[0].rpcCalls, 0);
  assert.equal(fixture.sleeps.reduce((sum, value) => sum + value, 0), 300_000);
  assert.equal(rpcCalls, 1);
});

test('不同会话同账户动作共享；不同账户、不同上游动作各自独立', async () => {
  const fixture = clock(); await fill(fixture.limiter, 1, 'IndexEdit');
  (await fixture.limiter.reserve(2, 'IndexEdit')).dispatched();
  (await fixture.limiter.reserve(1, 'Index')).dispatched();
  assert.equal(fixture.sleeps.length, 0);
  (await fixture.limiter.reserve(1, 'IndexEdit')).dispatched();
  assert.equal(fixture.now(), 310_000);
});

test('明确未 dispatch 才能退款，429 和 unknown 尝试继续占用额度', async () => {
  const fixture = clock();
  const cancelledBeforeRpc = await fixture.limiter.reserve(1, 'Episode', 2);
  cancelledBeforeRpc.refundUndispatched();
  await fill(fixture.limiter, 1, 'Episode', 9);
  const unknown = await fixture.limiter.reserve(1, 'Episode'); unknown.dispatched(); unknown.refundUndispatched();
  (await fixture.limiter.reserve(1, 'Episode')).dispatched();
  assert.equal(fixture.now(), 310_000);
});

test('等待中取消不会提交新请求，也不会遗留占用；已有请求额度仍保留', async () => {
  const limiter = new WriteRateLimiter(); await fill(limiter, 1, 'Episode');
  const controller = new AbortController(); let waiting = false; let calls = 0;
  const task = limiter.reserve(1, 'Episode', 1, { signal: controller.signal,
    onWait: () => { waiting = true; controller.abort(); },
  }).then(reservation => { calls++; reservation.dispatched(); });
  await assert.rejects(task, error => error.code === 'CANCELLED');
  assert.equal(waiting, true); assert.equal(calls, 0);
  (await limiter.reserve(2, 'Episode')).dispatched();
});

test('同一时刻并发 reserve 不会超卖；退还明确未发额度会唤醒其他会话', async () => {
  const limiter = new WriteRateLimiter();
  const reserved = await Promise.all(Array.from({ length: 10 }, () => limiter.reserve(1, 'Episode')));
  let waiting = false; let admitted = false;
  const task = limiter.reserve(1, 'Episode', 1, { onWait: () => { waiting = true; } }).then(reservation => { admitted = true; return reservation; });
  await Promise.resolve(); assert.equal(waiting, true); assert.equal(admitted, false);
  reserved[0].refundUndispatched();
  (await task).dispatched();
  for (const reservation of reserved.slice(1)) reservation.dispatched();
  assert.equal(admitted, true);
});

test('收到外部额度引起的 429 后关闭该动作窗口，重启恢复已尝试次数', async () => {
  const fixture = clock(); fixture.limiter.limited(1, 'Character');
  (await fixture.limiter.reserve(1, 'Person')).dispatched(); assert.equal(fixture.sleeps.length, 0);
  (await fixture.limiter.reserve(1, 'Character')).dispatched(); assert.equal(fixture.now(), 310_000);
  const recovered = clock(); recovered.limiter.rememberDispatched(1, 'Subject', 15, recovered.now());
  (await recovered.limiter.reserve(1, 'Subject')).dispatched(); assert.equal(recovered.now(), 310_000);
});

test('在途请求不会按发起时间提前失效；从实际返回时开始保守窗口', async () => {
  const fixture = clock(); const reserved = await fixture.limiter.reserve(1, 'Episode', 10);
  fixture.advance(90_000); reserved.dispatched();
  (await fixture.limiter.reserve(1, 'Episode')).dispatched();
  assert.equal(fixture.now(), 400_000);
  await assert.rejects(fixture.limiter.reserve(1, 'Episode', 11), error => error.code === 'INVALID_INPUT');
});

test('启动恢复每个 stageId 只记一次，提交回执覆盖 started 和重复事实', async () => {
  const fixture = clock(); const facts = [];
  for (let index = 0; index < 9; index++) {
    const fact = { kind: 'bangumi-write', accountId: 1, stageId: `stage-${index}`, rateAction: 'Episode', rateCount: 1, recordedAt: new Date(fixture.now()).toISOString() };
    facts.push({ ...fact, phase: 'started' }, { ...fact, phase: 'submission', writeNetworkAttempted: true }, { ...fact, phase: 'submission', writeNetworkAttempted: true });
  }
  restoreWriteRateLimits(fixture.limiter, facts);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched();
  assert.equal(fixture.sleeps.length, 0);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched();
  assert.equal(fixture.now(), 310_000);
});

test('崩溃留下的 started 保守占用，明确未发出的 submission 解除额度', async () => {
  const started = { kind: 'bangumi-write', phase: 'started', accountId: 1, stageId: 'crashed', rateAction: 'Episode', rateCount: 10, recordedAt: new Date(10_000).toISOString() };
  const crashed = clock(); restoreWriteRateLimits(crashed.limiter, [started]);
  (await crashed.limiter.reserve(1, 'Episode')).dispatched(); assert.equal(crashed.now(), 310_000);
  const notAttempted = clock(); restoreWriteRateLimits(notAttempted.limiter, [started, { ...started, phase: 'submission', rateCount: 0, writeNetworkAttempted: false }]);
  await fill(notAttempted.limiter, 1, 'Episode'); assert.equal(notAttempted.sleeps.length, 0);
});

test('恢复使用 submission 时间、保留 429 冷却，非法现代额度事实明确阻塞', async () => {
  const fixture = clock();
  const started = { kind: 'bangumi-write', phase: 'started', accountId: 1, stageId: 'retry-window', rateAction: 'IndexEdit', rateCount: 1, recordedAt: new Date(10_000).toISOString() };
  restoreWriteRateLimits(fixture.limiter, [started, { ...started, phase: 'submission', recordedAt: new Date(30_000).toISOString(), writeNetworkAttempted: true, error: { code: 'BGM_HTTP_429' } }]);
  (await fixture.limiter.reserve(1, 'IndexEdit')).dispatched();
  assert.equal(fixture.now(), 331_000);
  assert.throws(() => restoreWriteRateLimits(fixture.limiter, [{ ...started, recordedAt: 'invalid' }]), error => error.code === 'WRITE_RATE_FACT_INVALID');
  restoreWriteRateLimits(fixture.limiter, [{ kind: 'bangumi-write', phase: 'started', stageId: 'legacy' }]);
});

test('恢复明确拒绝的 submissionError 尊重更长 Retry-After', async () => {
  const fixture = clock();
  restoreWriteRateLimits(fixture.limiter, [{ kind: 'bangumi-write', phase: 'submission', accountId: 1, stageId: 'rejected', rateAction: 'IndexEdit', rateCount: 1,
    recordedAt: new Date(fixture.now()).toISOString(), writeNetworkAttempted: true,
    submissionError: { code: 'BGM_RATE_LIMIT_REJECTED', rejection: { retryAfterMs: 600_000 } },
  }]);
  (await fixture.limiter.reserve(1, 'IndexEdit')).dispatched();
  assert.equal(fixture.now(), 611_000);
});

test('迁移旧事实只记回执实际尝试阶段，现代逻辑摘要不重复计数', async () => {
  const fixture = clock();
  const receipt = { items: Array.from({ length: 20 }, (_, index) => ({ submissionState: index < 9 ? 'acknowledged' : 'not_attempted' })) };
  const legacy = { kind: 'bangumi-write', phase: 'completed', accountId: 1, toolCallId: 'legacy-call', tool: 'update_episode_collection',
    args: { episode_ids: Array.from({ length: 20 }, (_, index) => index + 1) }, recordedAt: new Date(fixture.now()).toISOString(), networkAttempted: true, submission: receipt };
  restoreWriteRateLimits(fixture.limiter, [{ ...legacy, phase: 'started' }, legacy, legacy]);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched();
  assert.equal(fixture.sleeps.length, 0);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched(); assert.equal(fixture.now(), 310_000);
  const modern = clock();
  const stage = { kind: 'bangumi-write', phase: 'submission', accountId: 1, operationId: 'modern-operation', stageId: 'modern-stage', rateAction: 'Episode', rateCount: 9,
    recordedAt: new Date(modern.now()).toISOString(), writeNetworkAttempted: true };
  restoreWriteRateLimits(modern.limiter, [stage, { ...legacy, operationId: 'modern-operation' }]);
  (await modern.limiter.reserve(1, 'Episode')).dispatched(); assert.equal(modern.sleeps.length, 0);
});

test('旧事实及只读 reconciled 共用操作身份，恢复读不延长或重复计入额度', async () => {
  const fixture = clock(); fixture.advance(100_000);
  const original = { kind: 'bangumi-write', phase: 'completed', accountId: 1, toolCallId: 'legacy-readback', tool: 'update_episode_collection',
    args: { episode_ids: Array.from({ length: 9 }, (_, index) => index + 1) }, recordedAt: new Date(10_000).toISOString(), networkAttempted: true };
  const reconciled = { ...original, phase: 'reconciled', operationId: 'legacy:1:legacy-readback', attemptedAt: original.recordedAt, recordedAt: new Date(fixture.now()).toISOString() };
  restoreWriteRateLimits(fixture.limiter, [original, reconciled]);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched(); assert.equal(fixture.sleeps.length, 0);
  (await fixture.limiter.reserve(1, 'Episode')).dispatched(); assert.equal(fixture.now(), 310_000);
  const expired = clock(); expired.advance(400_000);
  restoreWriteRateLimits(expired.limiter, [original, { ...reconciled, recordedAt: new Date(expired.now()).toISOString() }]);
  await fill(expired.limiter, 1, 'Episode'); assert.equal(expired.sleeps.length, 0);
});
