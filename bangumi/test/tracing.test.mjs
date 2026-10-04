import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { lazyStream } from '@earendil-works/pi-ai';
import { createBangumiExtension } from '../dist/src/extension.js';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { parseLauncherArgs } from '../dist/src/launcher.js';
import { LocalMcpClient } from '../dist/src/mcp/client.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError, registerCredentials } from '../dist/src/support/errors.js';
import { TraceRecorder } from '../dist/src/tracing/recorder.js';
import { traceRedact } from '../dist/src/tracing/redact.js';
import { analyzeTrace } from '../dist/src/tracing/analyze.js';
import { TraceWriter } from '../dist/src/tracing/writer.js';

const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const text = content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
const message = (content, options) => ({ ...fauxAssistantMessage(content, options),
  usage: { input: 8, output: 3, cacheRead: 2, cacheWrite: 0, totalTokens: 13, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

function summaries(root) {
  try { return readdirSync(root, { recursive: true }).filter(file => file.endsWith('summary.json')).map(file => {
    const path = join(root, file);
    return { path, directory: resolve(path, '..'), value: JSON.parse(readFileSync(path, 'utf8')) };
  }); } catch { return []; }
}
function events(directory) { return readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
function payload(directory, ref) { assert.ok(ref.path); return JSON.parse(readFileSync(join(directory, ref.path), 'utf8')); }

async function fixture(t, { responses = [message('离线回答')], client, named = true, trace = true, title, modelOptions = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-tracing-'));
  const traceDir = join(root, 'tracelog');
  const runtimes = [];
  const warnings = [];
  const calls = [];
  const faux = fauxProvider(modelOptions);
  faux.setResponses(responses);
  // 离线供应商也走 Pi 的 payload 回调，验证原生观察钩子；不发送 HTTP。
  const provider = { ...faux.provider, streamSimple: (model, context, options) => lazyStream(model, async () => {
    await options?.onPayload?.({ model: model.id, messages: context.messages, options: { max_tokens: options?.maxTokens } }, model);
    return faux.provider.streamSimple(model, context, options);
  }) };
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(provider);
  await modelRuntime.setRuntimeApiKey('faux', 'offline-placeholder');
  const defaultService = new BangumiMcpService({ currentUser: async () => ({ id: 42, username: 'offline_user' }), close: async () => {} });
  const create = async (manager = SessionManager.create(root, join(root, 'sessions')), selectedClient = client) => {
    if (named && !manager.getSessionName()) manager.appendSessionInfo('离线日志测试');
    const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, sessionManager: manager, modelRuntime,
      provider: 'faux', model: 'faux-1', thinkingLevel: 'low', extension: createBangumiExtension({ authDir: join(root, 'auth'), timeoutMs: 1000,
        proxy: null, ...(trace ? { trace: { directory: typeof trace === 'string' ? trace : traceDir, onWarning: code => warnings.push(code) } } : {}),
        client: selectedClient ?? { call: async (name, args, signal, guard) => { calls.push({ name, args }); return defaultService.call(name, args, signal, guard); }, close: async () => {} },
        channel: { canConfirm: () => true, confirm: async () => true, canLogin: () => false, notify: () => {} },
        ...(title ? { generateSessionTitle: title } : {}),
      }) });
    runtimes.push(runtime);
    return runtime;
  };
  t.after(async () => {
    await Promise.all(runtimes.map(runtime => runtime.dispose()));
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, traceDir, runtime: await create(), create, calls, warnings, faux };
}

test('真实 Pi 循环保存完整 prompt、可见思考、两层工具及最终结果，离线重算一致', async t => {
  const f = await fixture(t, { responses: [message([fauxThinking('先核实当前账户'),
    ...['one', 'two', 'three'].map(id => fauxToolCall('get_current_user', {}, { id }))], { stopReason: 'toolUse' }), message('当前账户为 offline_user。')] });
  await f.runtime.session.prompt('查看当前账户');
  await f.runtime.session.waitForIdle();
  const saved = summaries(f.traceDir);
  assert.equal(saved.length, 1);
  const { value, directory } = saved[0];
  assert.equal(value.execution_status, 'completed');
  assert.equal(value.final_output.text, '当前账户为 offline_user。');
  assert.equal(value.session.session_id, f.runtime.session.sessionId);
  assert.equal(value.inputs[0].text, '查看当前账户');
  assert.equal(value.analysis.metrics.proposed_tool_calls, 3);
  assert.equal(value.analysis.metrics.executed_tools, 3);
  assert.equal(value.analysis.metrics.mcp_client_calls, 3);
  assert.equal(value.analysis.metrics.mcp_rpc_attempts, 0);
  assert.equal(value.analysis.metrics.rpc_attempt_unknown_calls, 3);
  assert.equal(value.analysis.metrics.llm_requests, 2);
  assert.equal(value.analysis.metrics.tokens.total, f.runtime.session.messages.filter(row => row.role === 'assistant').reduce((total, row) => total + row.usage.totalTokens, 0));
  assert.ok(value.analysis.findings.some(finding => finding.kind === 'duplicate_query'));
  assert.equal(value.capture.complete, true);
  const timeline = events(directory);
  assert.deepEqual(timeline.map(row => row.seq), Array.from({ length: timeline.length }, (_, i) => i + 1));
  const request = timeline.find(row => row.event === 'llm.start');
  const manifest = payload(directory, request.data.effective_prompt_ref);
  const prompt = manifest.messages.map(ref => payload(directory, ref));
  assert.ok(prompt.some(row => row.role === 'system' && JSON.stringify(row).includes('execute_write_batch')));
  assert.ok(prompt.some(row => row.role === 'user' && text(row.content) === '查看当前账户'));
  const reasoning = timeline.find(row => row.event === 'llm.end' && row.data.thinking_status === 'available');
  assert.equal(payload(directory, reasoning.data.reasoning_refs[0]).thinking, '先核实当前账户');
  assert.ok(timeline.some(row => row.event === 'llm.provider_request'));
  for (const call of timeline.filter(row => row.event === 'mcp.start')) assert.ok(timeline.some(row => row.span_id === call.parent_span_id && row.event === 'tool.start'));
  const analysis = await analyzeTrace(directory);
  assert.equal(analysis.complete, true);
  assert.deepEqual(analysis.metrics, value.analysis.metrics);
  const session = readFileSync(f.runtime.session.sessionFile, 'utf8');
  assert.equal(session.includes('tracelog'), false);
  assert.equal(session.includes('effective_prompt_ref'), false);
});

test('非法参数和未知工具保留模型意图与错误，但不发出 MCP 请求', async t => {
  const f = await fixture(t, { responses: [message([
    fauxToolCall('get_current_user', { extra: '错误参数' }, { id: 'bad' }), fauxToolCall('missing_tool', {}, { id: 'unknown' }),
  ], { stopReason: 'toolUse' }), message('参数无效，未执行查询。')] });
  await f.runtime.session.prompt('测试非法参数');
  const saved = summaries(f.traceDir)[0];
  assert.equal(f.calls.length, 0);
  assert.equal(saved.value.analysis.metrics.proposed_tool_calls, 2);
  assert.equal(saved.value.analysis.metrics.mcp_client_calls, 0);
  assert.equal(saved.value.analysis.metrics.tool_errors, 2);
  assert.equal(saved.value.analysis.metrics.executed_tools, 0);
  const proposed = events(saved.directory).find(row => row.event === 'tool.proposed' && row.data.tool_call_id === 'bad');
  assert.deepEqual(payload(saved.directory, proposed.data.raw_arguments_ref), { extra: '错误参数' });
});

test('并发会话共享 ModelRuntime 时，prompt、最终输出及 MCP 父调用互不串线', async t => {
  const a = gate(); const b = gate();
  const dynamic = async context => {
    const key = text(context.messages.findLast(row => row.role === 'user').content);
    return context.messages.at(-1)?.role === 'toolResult' ? message(`完成 ${key}`)
      : message(fauxToolCall('get_current_user', {}, { id: `tool-${key}` }), { stopReason: 'toolUse' });
  };
  const f = await fixture(t, { responses: Array.from({ length: 20 }, () => dynamic), client: {
    call: async () => { a.release(); await b.promise; return { id: 42, username: 'user_a' }; }, close: async () => {},
  } });
  const other = await f.create(undefined, { call: async () => { await a.promise; b.release(); return { id: 43, username: 'user_b' }; }, close: async () => {} });
  await Promise.all([f.runtime.session.prompt('会话A'), other.session.prompt('会话B')]);
  const saved = summaries(f.traceDir);
  assert.equal(saved.length, 2);
  assert.equal(new Set(saved.map(row => row.value.trace_id)).size, 2);
  for (const row of saved) {
    const own = row.value.session.session_id === f.runtime.session.sessionId ? '会话A' : '会话B';
    const wrong = own === '会话A' ? '会话B' : '会话A';
    assert.equal(row.value.final_output.text, `完成 ${own}`);
    assert.equal(row.value.inputs[0].text, own);
    const body = readdirSync(row.directory, { recursive: true }).filter(path => path.endsWith('.json') || path.endsWith('.jsonl'))
      .map(path => readFileSync(join(row.directory, path), 'utf8')).join('\n');
    assert.equal(body.includes(wrong), false);
  }
});

test('追加输入保留在同一执行周期内，不覆盖初始 prompt 和 trace 身份', async t => {
  const started = gate(); const release = gate();
  const service = new BangumiMcpService({ currentUser: async () => ({ id: 42, username: 'offline_user' }), close: async () => {} });
  const f = await fixture(t, { responses: [message(fauxToolCall('get_current_user', {}), { stopReason: 'toolUse' }), message('第一步完成'), message('追加任务完成')],
    client: { call: async (...args) => { started.release(); await release.promise; return service.call(...args); }, close: async () => {} } });
  const first = f.runtime.session.prompt('初始请求');
  await started.promise;
  await f.runtime.session.prompt('追加请求', { streamingBehavior: 'followUp' });
  release.release();
  await first;
  const saved = summaries(f.traceDir);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].value.inputs.map(input => input.text), ['初始请求', '追加请求']);
  assert.equal(saved[0].value.final_output.text, '追加任务完成');
});

test('取消保留执行事实与部分结果，不伪造成功或自动重发', async t => {
  const started = gate(); let calls = 0;
  const f = await fixture(t, { responses: [message([fauxThinking('正在查询'), fauxText('准备读取'), fauxToolCall('get_current_user', {})], { stopReason: 'toolUse' })],
    client: { call: async (_name, _args, signal) => {
      calls++; started.release();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      throw new AppError('CANCELLED', '离线请求已取消');
    }, close: async () => {} } });
  const running = f.runtime.session.prompt('读取后取消');
  await started.promise;
  await f.runtime.session.abort();
  await running;
  const saved = summaries(f.traceDir)[0];
  assert.equal(saved.value.execution_status, 'aborted');
  assert.equal(saved.value.final_output.status, 'partial');
  assert.equal(calls, 1);
  assert.equal(saved.value.analysis.metrics.mcp_by_tool.get_current_user.errors, 1);
});

test('trace off 不建目录；内存 session 仍可独立保存 tracelog', async t => {
  const off = await fixture(t, { trace: false });
  await off.runtime.session.prompt('关闭日志');
  assert.deepEqual(summaries(off.traceDir), []);
  const memory = await fixture(t);
  const runtime = await memory.create(SessionManager.inMemory(memory.root));
  await runtime.session.prompt('内存会话请求');
  const saved = summaries(memory.traceDir)[0];
  assert.equal(saved.value.session.session_file, null);
  assert.equal(saved.value.final_output.text, '离线回答');
});

test('恢复会话不重记旧执行，新执行引用旧分支但保存当前独立 trace', async t => {
  const f = await fixture(t, { responses: [message('第一次回答'), message('第二次回答')] });
  await f.runtime.session.prompt('第一次请求');
  const first = summaries(f.traceDir)[0];
  const path = f.runtime.session.sessionFile;
  await f.runtime.dispose();
  const resumed = await f.create(SessionManager.open(path));
  assert.equal(summaries(f.traceDir).length, 1);
  await resumed.session.prompt('继续请求');
  const saved = summaries(f.traceDir);
  assert.equal(saved.length, 2);
  const second = saved.find(row => row.value.trace_id !== first.value.trace_id);
  assert.equal(second.value.session.session_id, first.value.session.session_id);
  assert.equal(second.value.inputs[0].text, '继续请求');
  assert.ok(second.value.session.branch_start_id);
  assert.equal(second.value.final_output.text, '第二次回答');
});

test('后台标题有独立 trace 和父关联，主任务不会等待标题完成', async t => {
  const started = gate(); const release = gate();
  const f = await fixture(t, { named: false, title: async () => { started.release(); await release.promise; return '离线标题'; } });
  await f.runtime.session.prompt('为本轮生成标题');
  await started.promise;
  const main = summaries(f.traceDir).find(row => row.value.purpose === 'agent');
  assert.equal(main.value.execution_status, 'completed');
  assert.equal(main.value.analysis.metrics.llm_requests, 1);
  release.release();
  for (let i = 0; i < 100 && !summaries(f.traceDir).some(row => row.value.purpose === 'session_title' && row.value.execution_status === 'completed'); i++) await delay(5);
  const aux = summaries(f.traceDir).find(row => row.value.purpose === 'session_title');
  assert.equal(aux.value.parent_trace.trace_id, main.value.trace_id);
  assert.equal(aux.value.final_output.text, '离线标题');
  assert.equal(aux.value.analysis.metrics.llm_requests, 0); // 注入的离线生成器没有模型请求。
});

test('递归及跨片段脱敏覆盖 prompt、思考、工具 text 内 JSON 和供应商 opaque 字段', async t => {
  const secret = 'trace-test-secret-48cc9f3b'; registerCredentials([secret]);
  const f = await fixture(t, { responses: [message([fauxThinking(`思考包含 ${secret}`), fauxText(`回答包含 ${secret}`)])] });
  await f.runtime.session.prompt(`原始输入 ${secret}`);
  const saved = summaries(f.traceDir)[0];
  const body = readdirSync(saved.directory, { recursive: true }).filter(path => path.endsWith('.json') || path.endsWith('.jsonl'))
    .map(path => readFileSync(join(saved.directory, path), 'utf8')).join('\n');
  assert.equal(body.includes(secret), false);
  const safe = traceRedact({ content: [{ type: 'text', text: JSON.stringify({ password: 'not-registered-secret', headers: { Cookie: 'another-secret' } }) }],
    thinkingSignature: 'opaque-secret', thoughtSignature: 'opaque-thought', encrypted_content: 'opaque-encrypted',
    hidden: { type: 'thinking', redacted: true, thinking: 'provider-hidden-text' } });
  const safeText = JSON.stringify(safe);
  for (const value of ['not-registered-secret', 'another-secret', 'opaque-secret', 'opaque-thought', 'opaque-encrypted', 'provider-hidden-text']) assert.equal(safeText.includes(value), false);
  assert.equal(JSON.stringify(traceRedact({ thinking: secret.slice(0, 12) }, true)).includes(secret.slice(0, 12)), false);
});

test('磁盘错误不改变模型输出；队列溢出明确标记缺失正文', async t => {
  const f = await fixture(t);
  const file = join(f.root, 'a-file'); writeFileSync(file, '阻止创建日志目录');
  // 使用真实扩展的写入失败路径，目录父项是普通文件。
  const bad = await fixture(t, { trace: file });
  await bad.runtime.session.prompt('磁盘错误仍完成');
  assert.ok(bad.warnings.includes('writer_failed'));
  assert.equal(text(bad.runtime.session.messages.findLast(row => row.role === 'assistant').content), '离线回答');
  const recorder = new TraceRecorder({ directory: f.traceDir, maxQueueBytes: 100, onWarning: () => {} });
  const ctx = { mode: 'sdk', model: { provider: 'faux', id: 'faux-1', api: 'faux' }, sessionManager: {
    getSessionId: () => 'overflow', getSessionFile: () => undefined, getLeafId: () => null,
  } };
  recorder.start(ctx, { prompt: '很长的正文'.repeat(1000) });
  await recorder.settle(ctx);
  const saved = summaries(f.traceDir).find(row => row.value.session.session_id === 'overflow');
  assert.equal(saved.value.capture.complete, false);
  assert.ok(saved.value.capture.issues.includes('queue_limit'));
  assert.equal((await analyzeTrace(saved.directory)).complete, false);
});

test('分析器识别异常退出和尾部半行，不把缺少 run.end 的轨迹判为完整', async t => {
  const f = await fixture(t);
  await f.runtime.session.prompt('可重新分析');
  const saved = summaries(f.traceDir)[0];
  const path = join(saved.directory, 'events.jsonl');
  const rows = events(saved.directory).filter(row => row.event !== 'run.end');
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n{"partial":');
  const analysis = await analyzeTrace(saved.directory);
  assert.equal(analysis.execution_status, 'incomplete');
  assert.equal(analysis.complete, false);
  assert.ok(analysis.issues.includes('invalid_event_line'));
  assert.ok(analysis.issues.includes('missing_run_end'));
});

test('启动参数和环境变量决定日志目录，trace-analyze 可独立读取', () => {
  const options = parseLauncherArgs(['--data-dir', 'E:/offline-data', '--no-session', '--print', '请求'], {});
  assert.equal(options.trace.directory, resolve('E:/offline-data/tracelog'));
  assert.equal(parseLauncherArgs(['--trace', 'off', '--print', '请求'], {}).trace, undefined);
  assert.equal(parseLauncherArgs(['web', '--trace-dir', 'E:/trace-custom'], {}).trace.directory, resolve('E:/trace-custom'));
  assert.equal(parseLauncherArgs(['--print', '请求'], { BANGUMI_TRACE: 'off' }).trace, undefined);
  assert.throws(() => parseLauncherArgs(['--trace', 'remote', '--print', '请求'], {}), { code: 'INVALID_ARGUMENT' });
});

test('本地 stdio MCP 记录真正的 dispatch，参数拒绝与初始化不混入 RPC 工具数', async t => {
  const f = await fixture(t);
  const script = join(f.root, 'offline-server.mjs');
  const serverUrl = pathToFileURL(resolve('dist/src/mcp/server.js')).href;
  const serviceUrl = pathToFileURL(resolve('dist/src/mcp/service.js')).href;
  const stdioUrl = pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')).href;
  writeFileSync(script, `import { createBangumiMcpServer } from ${JSON.stringify(serverUrl)};\nimport { BangumiMcpService } from ${JSON.stringify(serviceUrl)};\nimport { StdioServerTransport } from ${JSON.stringify(stdioUrl)};\nconst service = new BangumiMcpService({ currentUser: async () => ({ id: 42, username: 'offline_user' }), close: async () => {} });\nawait createBangumiMcpServer(service).connect(new StdioServerTransport());\n`);
  const recorder = new TraceRecorder({ directory: f.traceDir });
  const ctx = { mode: 'sdk', model: { provider: 'faux', id: 'faux-1', api: 'faux' }, sessionManager: {
    getSessionId: () => 'stdio', getSessionFile: () => undefined, getLeafId: () => null,
  } };
  recorder.start(ctx, { prompt: '离线 MCP 验证' });
  const client = new LocalMcpClient({ authDir: f.root, proxy: null, timeoutMs: 5000, entry: script, onTrace: event => recorder.mcpDiagnostic(event) });
  try {
    await recorder.mcp('get_current_user', {}, () => client.call('get_current_user', {}), undefined, true);
    await assert.rejects(() => recorder.mcp('get_current_user', { extra: 1 }, () => client.call('get_current_user', { extra: 1 }), undefined, true));
  } finally { await client.close(); }
  await recorder.settle(ctx);
  const saved = summaries(f.traceDir).find(row => row.value.session.session_id === 'stdio');
  assert.equal(saved.value.analysis.metrics.mcp_client_calls, 2);
  assert.equal(saved.value.analysis.metrics.mcp_rpc_attempts, 1);
  assert.equal(saved.value.analysis.metrics.rpc_attempt_unknown_calls, 0);
  assert.equal(events(saved.directory).filter(row => row.event === 'mcp.initialized').length, 1);
});

test('模拟章节写入保持原审批与回读行为，MCP 子调用区分预检、提交和验证', async t => {
  const operations = [1, 2].map(episode_id => ({ tool: 'update_single_episode_collection', args: { episode_id, collection_type: 2 } }));
  const makeService = () => {
    const requests = [];
    const interest = { type: 3, rate: 6, comment: '保留短评', tags: ['测试'], private: false, epStatus: 0, volStatus: 0 };
    const episodes = [1, 2, 3].map(id => ({ id, subjectID: 101, type: 0, sort: id, name: `第${id}集`, nameCN: '', collection: { status: 0 } }));
    const subject = { id: 101, type: 2, name: '测试动画', nameCN: '测试动画', eps: 3, volumes: 0, interest };
    const service = new BangumiMcpService({ currentUser: async () => ({ id: 42, username: 'offline_user' }), close: async () => {},
      public: async path => { assert.equal(path, '/v0/subjects/101'); return structuredClone(subject); },
      account: async (path, options = {}) => {
        if (options.method === 'PATCH') {
          requests.push({ path, body: options.body });
          episodes.find(row => row.id === Number(path.split('/').at(-1))).collection.status = options.body.type;
          interest.epStatus = episodes.filter(row => row.collection.status === 2).length;
          return {};
        }
        if (path === '/p1/subjects/101') return structuredClone(subject);
        if (path.startsWith('/p1/episodes/')) return structuredClone(episodes.find(row => row.id === Number(path.split('/').at(-1))));
        throw new Error('未预期的离线路径');
      },
    });
    return { service, requests, client: { call: (...args) => service.call(...args), close: async () => {} } };
  };
  const logged = makeService(); const plain = makeService();
  const f = await fixture(t, { client: logged.client, responses: [message(fauxToolCall('execute_write_batch', { operations }), { stopReason: 'toolUse' }), message('已修改并完成回读。')] });
  const baseline = await fixture(t, { trace: false, client: plain.client, responses: [message(fauxToolCall('execute_write_batch', { operations }), { stopReason: 'toolUse' }), message('已修改并完成回读。')] });
  await baseline.runtime.session.prompt('把前两集标记为看过');
  await f.runtime.session.prompt('把前两集标记为看过');
  assert.deepEqual(logged.requests, plain.requests);
  assert.equal(logged.requests.length, 2);
  const result = f.runtime.session.messages.find(row => row.role === 'toolResult');
  const value = JSON.parse(text(result.content)).value;
  assert.equal(value.state, 'success', JSON.stringify(value));
  assert.deepEqual(value.confirmation, { required: false, reasons: [] });
  assert.ok(value.items.every(row => row.verification.readbackCompleted && row.verification.requestedStateMatched));
  const saved = summaries(f.traceDir)[0];
  const timeline = events(saved.directory);
  for (const phase of ['preflight', 'submit', 'verify']) assert.ok(timeline.some(row => row.event === 'mcp.end' && row.data.phase === phase), phase);
  assert.equal(timeline.filter(row => row.event === 'mcp.end' && row.data.phase === 'submit').length, 2);
  assert.equal(timeline.filter(row => row.event === 'operation.start' && row.data.name === 'batch.step').length, 2);
  const facts = timeline.filter(row => row.event === 'write.fact' && row.data.phase === 'completed');
  assert.equal(facts.length, 2);
  assert.equal(payload(saved.directory, facts[0].data.record_ref).verification.readbackCompleted, true);
});

test('流式生成中取消保存已收到的思考内容，并记录 agent_signal', async t => {
  const f = await fixture(t, { modelOptions: { tokensPerSecond: 200, minTokenSize: 4, maxTokenSize: 4 },
    responses: [message([fauxThinking('已收到的思考内容'.repeat(200)), fauxText('最终文本')])] });
  const started = gate();
  const off = f.runtime.session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') started.release();
  });
  const running = f.runtime.session.prompt('流式取消');
  await started.promise;
  await f.runtime.session.abort();
  await running; off();
  const saved = summaries(f.traceDir)[0];
  assert.equal(saved.value.execution_status, 'aborted');
  const timeline = events(saved.directory);
  assert.ok(timeline.some(row => row.event === 'run.abort' && row.data.source === 'agent_signal'));
  const thought = timeline.find(row => row.event === 'llm.end' && row.data.reasoning_refs?.length);
  assert.ok(thought);
  const captured = payload(saved.directory, thought.data.reasoning_refs[0]).thinking;
  assert.ok(captured.length > 0 && captured.length < '已收到的思考内容'.repeat(200).length);
});

test('后台标题在会话关闭时安全结束，不使用已失效的扩展上下文', async t => {
  const started = gate(); const release = gate();
  const f = await fixture(t, { named: false, title: async () => { started.release(); await release.promise; return '迟到标题'; } });
  await f.runtime.session.prompt('关闭有后台标题的会话');
  await started.promise;
  await f.runtime.dispose();
  release.release(); await delay(30);
  const aux = summaries(f.traceDir).find(row => row.value.purpose === 'session_title');
  assert.ok(['aborted', 'incomplete'].includes(aux.value.execution_status));
});

test('关闭思考和供应商隐藏思考分别记录状态，不补造 CoT', async t => {
  const f = await fixture(t, { responses: [message('普通回答'), message([{ type: 'thinking', redacted: true, thinking: '', thinkingSignature: 'opaque' }, fauxText('隐藏思考后的回答')])] });
  f.runtime.session.setThinkingLevel('off');
  await f.runtime.session.prompt('关闭思考');
  const first = summaries(f.traceDir)[0];
  assert.ok(events(first.directory).some(row => row.event === 'llm.end' && row.data.thinking_status === 'off' && row.data.reasoning_refs.length === 0));
  await f.runtime.session.prompt('供应商隐藏思考');
  const second = summaries(f.traceDir).find(row => row.value.trace_id !== first.value.trace_id);
  assert.ok(events(second.directory).some(row => row.event === 'llm.end' && row.data.thinking_status === 'redacted'));
});

test('重新分析检查正文哈希及缺失文件，并拒绝引用逃出本次 trace 目录', async t => {
  const f = await fixture(t);
  await f.runtime.session.prompt('正文完整性');
  const saved = summaries(f.traceDir)[0];
  const rows = events(saved.directory);
  const expanded = rows.find(row => row.event === 'prompt.expanded');
  const ref = expanded.data.prompt_ref;
  writeFileSync(join(saved.directory, ref.path), '{"prompt":"篡改正文"}\n');
  assert.ok((await analyzeTrace(saved.directory)).issues.includes('payload_hash_mismatch'));
  expanded.data.prompt_ref.path = '../outside.json';
  writeFileSync(join(saved.directory, 'events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  assert.ok((await analyzeTrace(saved.directory)).issues.includes('invalid_payload_path'));
});

test('供应商在不同模型轮次重复使用 toolCallId 时，不合并调用和结果', async t => {
  const f = await fixture(t, { responses: [message(fauxToolCall('get_current_user', {}, { id: 'reused' }), { stopReason: 'toolUse' }),
    message(fauxToolCall('get_current_user', {}, { id: 'reused' }), { stopReason: 'toolUse' }), message('完成两轮查询')] });
  await f.runtime.session.prompt('检查两轮相同 ID');
  const saved = summaries(f.traceDir)[0];
  assert.equal(saved.value.analysis.metrics.proposed_tool_calls, 2);
  assert.equal(saved.value.analysis.metrics.executed_tools, 2);
  assert.equal(events(saved.directory).filter(row => row.event === 'tool.result').length, 2);
});

test('搜索增量、参数改正与重复失败有可追溯统计，不跨宿主阶段误判重复', async t => {
  const f = await fixture(t);
  const recorder = new TraceRecorder({ directory: f.traceDir });
  const ctx = { mode: 'sdk', model: { provider: 'faux', id: 'faux-1', api: 'faux' }, sessionManager: {
    getSessionId: () => 'statistics', getSessionFile: () => undefined, getLeafId: () => null,
  } };
  recorder.start(ctx, { prompt: '动态搜索' });
  const args = { keyword: '搞笑', offset: 0, limit: 20 };
  const data = ids => ({ data: ids.map(id => ({ id })) });
  await recorder.mcp('search_subjects', args, async () => data([1, 2]));
  await recorder.mcp('search_subjects', { ...args, offset: 20 }, async () => data([2, 3]));
  await recorder.mcp('search_subjects', args, async () => data([1, 2]));
  await recorder.phase('verify', () => recorder.mcp('search_subjects', args, async () => data([])));
  for (let i = 0; i < 2; i++) await assert.rejects(() => recorder.mcp('search_subjects', { ...args, limit: 999 }, async () => { throw new AppError('INVALID_INPUT', '分页参数错误'); }));
  await recorder.mcp('search_subjects', { ...args, offset: 40 }, async () => data([4]));
  await recorder.settle(ctx);
  const saved = summaries(f.traceDir).find(row => row.value.session.session_id === 'statistics');
  const { metrics, findings } = saved.value.analysis;
  assert.equal(metrics.search_candidate_rows, 7);
  assert.equal(metrics.search_unique_candidates, 4);
  assert.equal(metrics.search_overlap_ratio, 3 / 7);
  assert.equal(findings.filter(row => row.kind === 'duplicate_query').length, 1);
  for (const kind of ['repeated_failure', 'changed_arguments_after_error', 'no_new_candidates']) assert.ok(findings.some(row => row.kind === kind), kind);
  assert.ok(findings.every(row => row.span_ids.length));
});

test('独立分析 CLI 返回 JSON，且不创建模型或账户数据目录', async t => {
  const f = await fixture(t);
  await f.runtime.session.prompt('CLI 分析样例');
  const saved = summaries(f.traceDir)[0];
  const unused = join(f.root, 'unused-home');
  const result = spawnSync(process.execPath, ['dist/src/main.js', 'trace-analyze', saved.directory], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, BANGUMI_PI_HOME: unused, PI_OFFLINE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.trace_id, saved.value.trace_id);
  assert.equal(report.complete, true);
  assert.equal(existsSync(unused), false);
});

test('宿主正文引用不会因目录名偶然匹配短凭据而被二次脱敏破坏', async t => {
  const f = await fixture(t);
  registerCredentials(['payloads']);
  const writer = new TraceWriter({ directory: f.traceDir }, '2026-10-04', 'references', 'abcd');
  const ref = writer.payload({ text: '正文' });
  const sanitized = traceRedact({ ref, text: 'payloads 是待脱敏的普通正文' });
  assert.equal(sanitized.ref.path, ref.path);
  assert.equal(sanitized.text.includes('payloads'), false);
  await writer.flush();
  assert.deepEqual(payload(writer.directory, sanitized.ref), { text: '正文' });
});
