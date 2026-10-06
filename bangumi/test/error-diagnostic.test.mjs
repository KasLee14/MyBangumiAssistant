import assert from 'node:assert/strict';
import test from 'node:test';
import { lazyStream } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { CONTENT_OUTPUT_SYSTEM_MARKER } from '../dist/src/output/content-schema.js';
import { AppError, safeError, registerCredentials, SubmissionError } from '../dist/src/support/errors.js';
import { assistantErrorDiagnostic, isErrorDiagnostic, classifyProviderFailure, takeErrorDebug } from '../dist/src/support/error-diagnostic.js';
import { traceRedact } from '../dist/src/tracing/redact.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';
import { CandidateStore } from '../dist/src/mcp/candidate-store.js';
import { CandidateQuery } from '../dist/src/mcp/candidate-query.js';
import { checkCandidateResponse } from '../dist/src/mcp/candidate-contract.js';
import { assistantErrorView } from '../dist/src/web/error-view.js';
import { awaitResponse, readResponseText } from '../dist/src/login/transport.js';

const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_SYSTEM_MARKER, timestamp: 1 }] };
async function output(raw, { reason = 'stop', limit, outputTokens = 10, reasoningTokens } = {}) {
  const faux = fauxProvider({ api: 'openai-completions', provider: 'diagnostic-offline' });
  const model = { ...faux.getModel(), maxTokens: 20000 };
  const message = { ...fauxAssistantMessage(raw), rawStopReason: reason, usage: { input: 1, output: outputTokens, cacheRead: 0, cacheWrite: 0, totalTokens: outputTokens + 1,
    ...(reasoningTokens === undefined ? {} : { reasoning: reasoningTokens }), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = (model, _context, options) => lazyStream(model, async () => {
    await options.onPayload({ ...(limit === undefined ? {} : { max_tokens: limit }) }, model);
    return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason, message }; } };
  });
  const wrapped = withProviderFetch({ ...faux.provider, stream, streamSimple: stream });
  const events = [];
  for await (const event of wrapped.streamSimple(model, context, {})) events.push(event);
  return events.at(-1).error ?? events.at(-1).message;
}

test('length边界的完整合法121张卡片直接收束，保留上游结束原因且不重生成', async () => {
  let id = 0;
  const content = [50, 24, 46, 1].map(size => ({ type: 'SubjectCards', pending: false, props: { layout: 'list', items: Array.from({ length: size }, () => ({ id: ++id, name: `模拟作品${id}`, kind: 'anime' })) } }));
  const message = await output(JSON.stringify({ content }), { reason: 'length', limit: 20000, outputTokens: 20000, reasoningTokens: 9000 });
  assert.equal(message.stopReason, 'stop'); assert.equal(message.rawStopReason, 'length');
  assert.equal(assistantErrorDiagnostic(message), undefined);
  assert.equal(message.content.length, 4);
  assert.equal(new Set(message.content.flatMap(part => part.props.items.map(item => item.id))).size, 121);
  assert.ok(message.diagnostics.some(item => item.type === 'bangumi_output_finalized'));
  assert.equal(JSON.stringify(message.diagnostics).includes('responseText'), false);
});

test('未捕获本次请求额度时保留unknown证据，不拿模型配置冒充实际额度', async () => {
  const m = await output('{"content":[{"type":"text","nextType":null,"text":"未闭合', { reason: 'length' });
  const d = assistantErrorDiagnostic(m);
  assert.equal(d.code, 'LLM_OUTPUT_TRUNCATED'); assert.equal(d.reason, 'provider_length_stop');
  assert.equal(d.evidence.requestMaxTokens, null); assert.equal(d.evidence.configuredMaxTokens, 20000); assert.equal(d.evidence.jsonComplete, false);
  assert.ok(d.issues.some(issue => issue.rule === 'json_unclosed'));
});

test('真正的组件字段错误定位实际类型与JSON路径，不夹带其他组件分支噪音', async () => {
  const m = await output(JSON.stringify({ content: [{ type: 'SubjectCards', pending: false, props: { layout: 'list', items: [{ id: '错误类型', name: '模拟作品', kind: 'anime' }] } }] }));
  const d = assistantErrorDiagnostic(m);
  assert.equal(d.code, 'CONTENT_SCHEMA_INVALID'); assert.equal(d.stage, 'validate');
  assert.equal(d.issues[0].path, '/content/0/props/items/0/id'); assert.equal(d.issues[0].rule, 'type'); assert.equal(d.issues[0].actualType, 'string');
  assert.equal(d.issues.some(issue => issue.path.includes('nextType')), false);
});

test('语法、闭合、字节、内容块及嵌套超限分别保留具体原因', async () => {
  const syntax = assistantErrorDiagnostic(await output('{"content":x}'));
  assert.equal(syntax.code, 'CONTENT_JSON_SYNTAX'); assert.equal(typeof syntax.evidence.offset, 'number');
  const truncated = assistantErrorDiagnostic(await output('{"content":['));
  assert.equal(truncated.code, 'CONTENT_JSON_INCOMPLETE');
  const bytes = assistantErrorDiagnostic(await output(' '.repeat(128 * 1024 + 1)));
  assert.equal(bytes.code, 'CONTENT_LIMIT_EXCEEDED'); assert.equal(bytes.reason, 'content_bytes_limit');
  const parts = assistantErrorDiagnostic(await output(JSON.stringify({ content: Array.from({ length: 17 }, (_, i) => ({ type: 'text', nextType: i === 16 ? null : 'text', text: '' })) })));
  assert.equal(parts.reason, 'content_parts_limit');
  const decoder = new ContentDecoder();
  assert.throws(() => decoder.feed('['.repeat(65)), error => error.reason === 'json_nesting_limit');
});

test('未知异常保留稳定错误ID及底层原因，原始堆栈与秘密不进入DTO', () => {
  const secret = 'diagnostic-private-value-20261006'; registerCredentials([secret]);
  const cause = Object.assign(new Error(`网络故障 ${secret}`), { code: 'ECONNRESET' });
  const error = new Error(`执行失败 ${secret}`, { cause });
  const a = safeError(error), b = safeError(error);
  assert.equal(a.code, 'INTERNAL_ERROR'); assert.equal(a.diagnostic.reason, 'unclassified_exception'); assert.equal(a.diagnostic.errorId, b.diagnostic.errorId);
  assert.ok(a.diagnostic.causes.some(item => item.code === 'ECONNRESET'));
  assert.equal(JSON.stringify(a).includes(secret), false); assert.equal(JSON.stringify(a).includes('stack'), false);
  const longError = new Error('a'.repeat(1990) + secret);
  const d = safeError(longError).diagnostic, debug = traceRedact(takeErrorDebug(d.errorId), true);
  assert.equal(debug.message.endsWith(secret.slice(0, 10)), false);
  const thrown = safeError(secret); assert.equal(thrown.diagnostic.causes[0].name, 'ThrownValue');
  assert.equal(JSON.stringify(traceRedact(takeErrorDebug(thrown.diagnostic.errorId), true)).includes(secret), false);
});

test('MCP输出schema和候选scope、计数问题提供具体字段诊断', async () => {
  assert.throws(() => checkOutput({ type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false }, { count: '不合法' }), error => {
    assert.equal(error.diagnostic.reason, 'response_schema_invalid'); assert.equal(error.diagnostic.issues[0].path, '/count'); return true;
  });
  const binding = { turnId: 'diagnostic', accountId: null, scopeKey: 'public:sfw' }, store = new CandidateStore();
  const seed = store.create({ binding, sources: [], rows: [{ id: 1, facts: { name: '模拟作品' } }] });
  const query = new CandidateQuery(store, { loadFacts: async () => ({ facts: {} }) }), args = { candidate_ref: seed.ref, fields: ['id'] };
  const result = await query.execute(args, binding);
  const badScope = structuredClone(result); badScope.scope.candidate_ref = 'different_ref';
  assert.throws(() => checkCandidateResponse(badScope, args), error => error.diagnostic.reason === 'request_scope_mismatch' && error.diagnostic.issues[0].path === '/scope');
  const badCount = structuredClone(result); badCount.page.returnedCount = 0;
  assert.throws(() => checkCandidateResponse(badCount, args), error => error.diagnostic.reason === 'page_count_mismatch' && error.diagnostic.issues[0].path === '/page/returnedCount');
});

test('HTTP连接、流读取和编码错误能区分阶段，原因链不包含任意正文', async () => {
  const controller = new AbortController(), network = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
  await assert.rejects(awaitResponse(Promise.reject(network), controller.signal), error => error.diagnostic.stage === 'connect' && error.diagnostic.causes[0].code === 'ECONNREFUSED');
  await assert.rejects(readResponseText(new Response(new Uint8Array([0xff])), controller.signal), error => error.diagnostic.reason === 'utf8_invalid');
});

test('提供方旧文字诊断标为推断；429和配额耗尽分开，写入未知不建议重发', () => {
  const base = fauxAssistantMessage('', { stopReason: 'error', errorMessage: '429 insufficient_quota' });
  const d = classifyProviderFailure(base);
  assert.equal(d.code, 'LLM_QUOTA_EXHAUSTED'); assert.equal(d.certainty, 'inferred'); assert.equal(d.recovery, 'none');
  const receipt = { schemaVersion: 1, kind: 'submission', tool: 'update_user_collection', expectedAccountId: 1, target: null,
    submissionState: 'unknown', verification: 'pending', items: [], requestedFields: [], createdId: null, relatedId: null, requestedCollected: null, requestedEpisodeStatus: null };
  const error = safeError(new SubmissionError('BGM_NETWORK', '提交结果未知', receipt));
  assert.equal(error.diagnostic.recovery, 'verify_write'); assert.equal(error.diagnostic.evidence.submissionState, 'unknown');
});
