import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as z from 'zod/v4';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LocalMcpClient } from '../dist/src/mcp/client.js';
import { createBangumiMcpServer } from '../dist/src/mcp/server.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { AppError, diagnosedError, safeError } from '../dist/src/support/errors.js';
import { createErrorDiagnostic, isErrorDiagnostic } from '../dist/src/support/error-diagnostic.js';
import { CACHED_RESOURCE_RPC_OPERATION, CACHED_RESOURCE_SELECTION_LIMIT } from '../dist/src/mcp/resource-contract.js';

const ref = `rr_${'a'.repeat(32)}`;
const turn = { turnId: 'cached-rpc-roundtrip' };
const code = expected => error => error instanceof AppError && error.code === expected;
function cachedResource() {
  const accessContext = anonymousContext();
  return { schemaVersion: 1, kind: 'cached_resource', resourceRef: ref, sourceTool: 'refine_subject_candidates',
    value: { schemaVersion: 1, kind: 'candidate_page', data: [{ id: 42, name: '缓存作品', score: 8.5,
      image: 'https://lain.bgm.tv/pic/cover/c/offline.jpg' }], accessContext }, accessContext };
}
async function linked(t, service) {
  const server = createBangumiMcpServer(service);
  const client = new LocalMcpClient({ authDir: join(tmpdir(), 'unused-resource-rpc'), proxy: null, timeoutMs: 1000 });
  const [left, right] = InMemoryTransport.createLinkedPair();
  // 实际使用 LocalMcpClient 的初始化、请求、SDK 编解码及取消；只替换传输，避免子进程与网络。
  client.transport = left;
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(right);
  await client.listTools();
  return { client, server };
}
function overrideReply(server, reply) {
  server.setRequestHandler(RequestSchema.extend({ method: z.literal('bangumi/readCachedResource') }), async () => reply);
}
const rawRead = (client, params) => client.client.request({ method: 'bangumi/readCachedResource', params }, z.unknown());

test('缓存 RPC 真实 SDK 往返保留成员范围、任务、取消信号和封面字段', async t => {
  let observed;
  const resource = cachedResource();
  const { client } = await linked(t, { readCachedResource: async (...args) => { observed = args; return resource; } });
  const result = await client.readCachedResource(ref, undefined, turn, { subjectIds: [42] });
  assert.deepEqual(result, resource);
  assert.deepEqual(observed.slice(0, 2), [ref, turn]);
  assert.ok(observed[2] instanceof AbortSignal);
  assert.deepEqual(observed[3], { subjectIds: [42] });
  assert.equal(result.value.data[0].image, 'https://lain.bgm.tv/pic/cover/c/offline.jpg');
});

test('候选阶段、过期、账户和权限业务错误经 SDK 往返保留原错误码及诊断', async t => {
  for (const expected of ['CANDIDATE_STAGE_INCOMPLETE', 'CANDIDATE_REQUIRED_FACTS_MISSING', 'RESOURCE_EXPIRED',
    'RESOURCE_VERSION_CHANGED', 'RESOURCE_SCOPE_MISMATCH', 'ACCOUNT_CHANGED', 'NSFW_SCOPE_CHANGED']) {
    await t.test(expected, async child => {
      const error = new AppError(expected, '服务端细节 Bearer private-rpc-secret');
      Object.defineProperty(error, 'sourceTool', { value: 'refine_subject_candidates' });
      diagnosedError(error, createErrorDiagnostic({ code: expected, origin: 'domain', stage: 'validate',
        reason: 'cached_resource_rejected', operation: error.sourceTool,
        issues: [{ path: '/candidateRef', rule: 'cached_resource', message: 'Bearer private-rpc-secret' }],
        causes: [{ name: 'AppError', code: expected }] }));
      const { client } = await linked(child, { readCachedResource: async () => { throw error; } });
      const wire = await rawRead(client, { resourceRef: ref, readContext: turn });
      assert.deepEqual(Object.keys(wire), ['error']);
      assert.equal(wire.error.code, expected);
      assert.equal(wire.error.sourceTool, error.sourceTool);
      assert.equal(wire.error.message.includes('private-rpc-secret'), false);
      await assert.rejects(client.readCachedResource(ref, undefined, turn), observed => {
        assert.ok(observed instanceof AppError);
        assert.equal(observed.code, expected);
        assert.equal(observed.sourceTool, error.sourceTool);
        assert.ok(isErrorDiagnostic(observed.diagnostic));
        assert.equal(observed.diagnostic.errorId, error.diagnostic.errorId);
        assert.deepEqual(observed.diagnostic.causes, error.diagnostic.causes);
        assert.equal(observed.diagnostic.issues[0].message.includes('private-rpc-secret'), false);
        assert.equal(observed.message.includes('private-rpc-secret'), false);
        return true;
      });
    });
  }
});

test('未知内部异常使用脱敏内部错误信封，畸形本地错误被契约错误替代', async t => {
  const { client } = await linked(t, { readCachedResource: async () => { throw new Error('private exception text'); } });
  await assert.rejects(client.readCachedResource(ref, undefined, turn), observed => {
    assert.equal(observed.code, 'INTERNAL_ERROR');
    assert.equal(observed.message.includes('private exception text'), false);
    assert.deepEqual(observed.diagnostic.causes, [{ name: 'Error' }]);
    return true;
  });
  const malformed = await linked(t, { readCachedResource: async () => { throw new AppError('bad-code', 'private text'); } });
  await assert.rejects(malformed.client.readCachedResource(ref), code('MCP_INVALID_RESULT'));
});

test('selection 在客户端与服务端独立拒绝空、重复、超限和额外字段', async t => {
  let reads = 0;
  const { client } = await linked(t, { readCachedResource: async () => { reads++; return cachedResource(); } });
  for (const selection of [null, {}, { subjectIds: [] }, { subjectIds: [42, 42] }, { subjectIds: [0] },
    { subjectIds: ['42'] }, { subjectIds: [Number.MAX_SAFE_INTEGER + 1] },
    { subjectIds: [42], all: true }, { subjectIds: Array.from({ length: CACHED_RESOURCE_SELECTION_LIMIT + 1 }, (_, index) => index + 1) }]) {
    await assert.rejects(client.readCachedResource(ref, undefined, turn, selection), code('INVALID_INPUT'));
    const wire = await rawRead(client, { resourceRef: ref, readContext: turn, selection });
    assert.equal(wire.error.code, 'INVALID_INPUT');
  }
  await assert.rejects(client.readCachedResource('rr_invalid'), code('INVALID_INPUT'));
  for (const params of [{ resourceRef: 'rr_invalid' }, { resourceRef: ref, extra: true },
    { resourceRef: ref, readContext: { turnId: turn.turnId, injected: true } }])
    assert.equal((await rawRead(client, params)).error.code, 'INVALID_INPUT');
  assert.equal(reads, 0);
  await client.readCachedResource(ref, undefined, turn, { subjectIds: [42] });
  assert.equal(reads, 1);
});

test('客户端严格拒绝缓存成功错误混杂、畸形诊断和越界来源', async t => {
  const { client, server } = await linked(t, { readCachedResource: async () => cachedResource() });
  const resource = cachedResource();
  const error = safeError(new AppError('RESOURCE_EXPIRED', '不可信远端文字'));
  for (const reply of [
    {}, { resource, error }, { resource, extra: true }, { resource: null },
    { resource: { ...resource, sourceTool: 'unknown_fixed_tool' } },
    { resource: { ...resource, resourceRef: `rr_${'b'.repeat(32)}` } },
    { resource: { ...resource, accessContext: null } },
    { resource: { ...resource, value: { ...resource.value, accessContext: { ...resource.accessContext, checkedAt: 'mismatched' } } } },
    { error: { ...error, raw: 'private' } }, { error: { ...error, code: 'bad-code' } },
    { error: { ...error, diagnostic: { ...error.diagnostic, code: 'ACCOUNT_CHANGED' } } },
    { error: { ...error, diagnostic: { ...error.diagnostic, private: true } } },
    { error: { ...error, sourceTool: 'refine_subject_candidates', diagnostic: { ...error.diagnostic, operation: 'get_current_user' } } },
    { error: { ...error, sourceTool: 'unknown_fixed_tool' } },
    { error: { ...error, diagnostic: { ...error.diagnostic, operation: 'unknown_fixed_tool' } } },
    { error: { ...error, recovery: { stage: 'response_contract', retryable: false } } },
    { error: { ...error, networkAttempted: true } },
    { error: { ...error, diagnosis: { category: 'incomplete' } } },
    { error: { ...error, submission: {} } },
  ]) {
    overrideReply(server, reply);
    await assert.rejects(client.readCachedResource(ref, undefined, turn), code('MCP_INVALID_RESULT'));
  }
});

test('SDK 取消传入缓存服务，客户端保留 CANCELLED 且不重发', { timeout: 3000 }, async t => {
  let entered, cancelled, reads = 0;
  const start = new Promise(resolve => { entered = resolve; });
  const stop = new Promise(resolve => { cancelled = resolve; });
  const { client } = await linked(t, { readCachedResource: async (_ref, _context, signal) => {
    reads++; entered(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      cancelled(); reject(new AppError('CANCELLED', '缓存读取取消。'));
    }, { once: true }));
  } });
  const controller = new AbortController();
  const pending = client.readCachedResource(ref, controller.signal, turn);
  assert.ok(await start instanceof AbortSignal);
  controller.abort();
  await assert.rejects(pending, code('CANCELLED'));
  await stop;
  assert.equal(reads, 1);
  await assert.rejects(client.readCachedResource(ref, controller.signal, turn), code('CANCELLED'));
  assert.equal(reads, 1);
});

test('SDK 缓存读取超时保留总期限诊断，不重试原请求', { timeout: 10_000 }, async t => {
  let reads = 0;
  const { client } = await linked(t, { readCachedResource: async (_ref, _context, signal) => {
    reads++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AppError('CANCELLED', '期限取消。')), { once: true }));
  } });
  await assert.rejects(client.readCachedResource(ref, undefined, turn), observed => {
    assert.equal(observed.code, 'BGM_TIMEOUT');
    assert.equal(observed.diagnostic.reason, 'mcp_deadline_exhausted');
    assert.equal(observed.diagnostic.operation, CACHED_RESOURCE_RPC_OPERATION);
    assert.equal(observed.diagnostic.evidence.rpcCode, -32001);
    return true;
  });
  assert.equal(reads, 1);
});

test('未遵循错误信封的 JSON-RPC 异常保留协议码，不冒充账户权限问题', async t => {
  const { client, server } = await linked(t, { readCachedResource: async () => cachedResource() });
  server.setRequestHandler(RequestSchema.extend({ method: z.literal('bangumi/readCachedResource') }), async () => { throw new Error('private RPC failure'); });
  await assert.rejects(client.readCachedResource(ref, undefined, turn), observed => {
    assert.equal(observed.code, 'MCP_PROTOCOL_ERROR');
    assert.equal(observed.diagnostic.evidence.rpcCode, -32603);
    assert.equal(observed.diagnostic.operation, CACHED_RESOURCE_RPC_OPERATION);
    assert.equal(observed.message.includes('private RPC failure'), false);
    return true;
  });
});

test('请求中途关闭 SDK 传输保留连接故障，不重发缓存读取', { timeout: 3000 }, async t => {
  let entered, reads = 0;
  const start = new Promise(resolve => { entered = resolve; });
  const { client, server } = await linked(t, { readCachedResource: async (_ref, _context, signal) => {
    reads++; entered();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AppError('CANCELLED', '连接已关闭。')), { once: true }));
  } });
  const pending = client.readCachedResource(ref, undefined, turn);
  await start;
  await server.close();
  await assert.rejects(pending, code('MCP_TRANSPORT_ERROR'));
  assert.equal(reads, 1);
});
