import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountTransport } from '../dist/src/login/transport.js';
import { AppError, SubmissionError, safeError } from '../dist/src/support/errors.js';
import { SubmissionTracker, checkSubmission } from '../dist/src/mcp/submission.js';
import { LocalMcpClient } from '../dist/src/mcp/client.js';
import { resourceOutputSchema } from '../dist/src/mcp/resource-schemas.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';

const session = () => ({ version: 1, accountId: 42, username: 'offline_rejection', sessionId: 'offline-session-fixture', savedAt: Date.now(), expiresAt: Date.now() + 60_000 });
const rejection = retryAfterMs => ({ kind: 'rate_limit', httpStatus: 429, upstreamCode: 'RATE_LIMIT_EXCEEDED', retryAfterMs });
const limited = headers => new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED', message: 'secret-server-body', arbitrary: 'session=secret' }),
  { status: 429, headers: { 'content-type': 'application/json', ...headers } });
function apiFixture(t, reply, timeout = 1000) {
  let count = 0;
  const api = new AccountTransport(session(), null, timeout, async () => { count++; return typeof reply === 'function' ? reply() : reply; });
  t.after(() => api.close()); return { api, count: () => count };
}
async function createRejected(t, headers = {}) {
  const f = apiFixture(t, limited(headers)); const args = { title: '离线限流目录', description: '', private: false };
  const tracker = new SubmissionTracker('create_index', args, 42);
  let error;
  await assert.rejects(tracker.submit('/p1/indexes', 'POST', () => f.api.json('/p1/indexes', { method: 'POST', body: args, auth: true })), value => { error = value; return value.code === 'BGM_RATE_LIMIT_REJECTED'; });
  return { ...f, args, receipt: tracker.failed(), error };
}

test('只有固定429 JSON错误码证明修改前拒绝，回执仍报告真实网络尝试且不重发', async t => {
  const f = await createRejected(t, { 'retry-after': '300' });
  assert.equal(f.count(), 1);
  assert.equal(f.error.networkAttempted, undefined);
  assert.deepEqual(f.error.rejection, rejection(300_000));
  assert.equal(f.receipt.submissionState, 'rejected'); assert.equal(f.receipt.verification, 'pending');
  assert.equal(f.receipt.createdId, null); assert.equal(f.receipt.target, null);
  assert.deepEqual(f.receipt.items[0].rejection, rejection(300_000));
  checkSubmission('create_index', f.receipt, f.args, 42);
  assert.throws(() => checkSubmission('create_index', { ...f.receipt, submissionState: 'unknown' }, f.args, 42), { code: 'MCP_INVALID_RESULT' });
  const safe = safeError(new SubmissionError(f.error.code, f.error.message, f.receipt));
  assert.deepEqual(safe.rejection, rejection(300_000)); assert.equal(safe.networkAttempted, undefined);
  assert.equal(JSON.stringify(safe).includes('secret-server-body'), false);
  assert.equal(JSON.stringify(safe).includes('session=secret'), false);
  checkOutput(resourceOutputSchema('create_index'), { error: safe });
});

test('缺失或无效Retry-After保留未知等待时长，固定错误码与正文均有读取上限', async t => {
  for (const headers of [{}, { 'retry-after': 'arbitrary-secret' }, { 'retry-after': '99999999999999999999' }]) {
    const f = await createRejected(t, headers); assert.deepEqual(f.receipt.items[0].rejection, rejection(null));
  }
  const future = new Date(Date.now() + 60_000).toUTCString();
  const f = await createRejected(t, { 'retry-after': future });
  assert.ok(f.error.rejection.retryAfterMs >= 58_000 && f.error.rejection.retryAfterMs <= 60_000);
  const large = apiFixture(t, new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED', arbitrary: 'x'.repeat(20_001) }), { status: 429, headers: { 'content-type': 'application/json', 'content-length': '1' } }));
  await assert.rejects(large.api.json('/p1/indexes', { method: 'POST', auth: true }), error => error.code === 'BGM_OUTPUT_LIMIT' && error.rejection === undefined && error.networkAttempted !== false);
  assert.equal(large.count(), 1);
});

test('普通429、403、无效JSON与取消不假定未生效，保持unknown且不自动重试', async t => {
  const cases = [
    [new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }), 'BGM_HTTP_429'],
    [new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }), { status: 403, headers: { 'content-type': 'application/json' } }), 'BGM_HTTP_403'],
    [new Response('{"code":"RATE_LIMIT_EXCEEDED"', { status: 429, headers: { 'content-type': 'application/json' } }), 'BGM_HTTP_429'],
    [new Response('<p>RATE_LIMIT_EXCEEDED</p>', { status: 429, headers: { 'content-type': 'text/html' } }), 'BGM_HTTP_429'],
  ];
  for (const [reply, code] of cases) {
    const f = apiFixture(t, reply); const tracker = new SubmissionTracker('create_index', { title: '离线未知' }, 42);
    await assert.rejects(tracker.submit('/p1/indexes', 'POST', () => f.api.json('/p1/indexes', { method: 'POST', auth: true })), error => error.code === code && error.rejection === undefined);
    assert.equal(f.count(), 1); assert.equal(tracker.failed().submissionState, 'unknown');
  }
  const f = apiFixture(t, limited());
  await assert.rejects(f.api.json('/p1/indexes', { auth: true }), error => error.code === 'BGM_HTTP_429' && error.rejection === undefined);
  const tracker = new SubmissionTracker('create_index', { title: '离线取消' }, 42);
  await assert.rejects(tracker.submit('/p1/indexes', 'POST', async () => { throw new AppError('CANCELLED', '已派发后取消'); }));
  assert.equal(tracker.failed().submissionState, 'unknown');
});

test('多阶段部分成功后明确拒绝保留partial，各阶段拒绝证据受闭合契约约束', async t => {
  const args = { subject_id: 201, rating: 8, ep_status: 5 };
  const tracker = new SubmissionTracker('update_subject_collection', args, 42);
  await tracker.submit('/p1/collections/subjects/201', 'PUT', async () => ({}));
  const f = apiFixture(t, limited({ 'retry-after': '0' }));
  await assert.rejects(tracker.submit('/p1/collections/subjects/201', 'PATCH', () => f.api.json('/p1/collections/subjects/201', { method: 'PATCH', auth: true })));
  const receipt = tracker.failed(); assert.equal(receipt.submissionState, 'partial');
  assert.deepEqual(receipt.items.map(item => item.submissionState), ['acknowledged', 'rejected']);
  checkSubmission('update_subject_collection', receipt, args, 42);
  checkOutput(resourceOutputSchema('update_subject_collection'), { error: safeError(new SubmissionError('BGM_RATE_LIMIT_REJECTED', '固定错误', receipt)) });
  for (const modify of [
    item => { delete item.rejection; },
    item => { item.rejection.retryAfterMs = -1; },
    item => { item.rejection.arbitrary = 'secret'; },
    item => { item.submissionState = 'unknown'; },
  ]) {
    const forged = structuredClone(receipt); modify(forged.items[1]);
    assert.throws(() => checkSubmission('update_subject_collection', forged, args, 42), { code: 'MCP_INVALID_RESULT' });
    assert.throws(() => checkOutput(resourceOutputSchema('update_subject_collection'), { error: safeError(new SubmissionError('BGM_RATE_LIMIT_REJECTED', '固定错误', forged)) }), { code: 'MCP_INVALID_RESULT' });
  }
});

test('客户端贯穿明确拒绝回执与额度元数据，拒绝错误码、派发事实或证据错配', async t => {
  const f = await createRejected(t, { 'retry-after': '300' });
  const safe = safeError(new SubmissionError('BGM_RATE_LIMIT_REJECTED', 'arbitrary-server-message', f.receipt));
  function client(reply) {
    const local = new LocalMcpClient({ authDir: join(tmpdir(), 'unused-rejection-test'), proxy: null, timeoutMs: 1000 });
    local.initialization = Promise.resolve(); local.client.callTool = async () => ({ isError: true, structuredContent: { error: reply } });
    t.after(() => local.close()); return local;
  }
  await assert.rejects(client(safe).call('create_index', f.args, undefined, { accountId: 42 }), error => {
    assert.equal(error.code, 'BGM_RATE_LIMIT_REJECTED');
    assert.deepEqual(error.rejection, rejection(300_000)); assert.deepEqual(error.submission, f.receipt);
    assert.equal(error.networkAttempted, undefined); assert.equal(error.message.includes('arbitrary-server-message'), false); return true;
  });
  for (const change of [{ code: 'BGM_HTTP_429' }, { networkAttempted: false }, { rejection: rejection(1000) }]) {
    await assert.rejects(client({ ...safe, ...change }).call('create_index', f.args, undefined, { accountId: 42 }), { code: 'MCP_INVALID_RESULT' });
  }
});
