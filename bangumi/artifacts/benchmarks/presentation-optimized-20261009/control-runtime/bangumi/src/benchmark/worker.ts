import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import type { McpCallClient } from '../mcp/client.js';
import type { InteractionChannel } from '../interaction.js';
import { createPiTransport } from '../pi-transport.js';
import { traceHash, traceRedact } from '../tracing/redact.js';
import { analyzeTrace } from '../tracing/analyze.js';
import { registerCredentials } from '../support/errors.js';
import { MetricsCollector } from './metrics.js';
import { canonicalBenchmarkContent, gradeCase, outputText } from './scoring.js';
import type { WorkerConfig, RunObservation, TurnObservation, NetworkEvent, Outcome } from './schema.js';
import { record } from './schema.js';

export function atomicJson(path: string, value: unknown): void {
  writeFileSync(path + '.tmp', JSON.stringify(traceRedact(value), null, 2) + '\n'); renameSync(path + '.tmp', path);
}
export async function executeCase(config: WorkerConfig): Promise<RunObservation> {
  mkdirSync(config.outputDir, { recursive: true });
  const isolated = join(config.outputDir, 'runtime'), authDir = join(isolated, 'auth'), traceDir = join(config.outputDir, 'tracelog');
  mkdirSync(authDir, { recursive: true }); mkdirSync(join(isolated, 'pi'), { recursive: true });
  atomicJson(join(authDir, 'benchmark-config.json'), config);
  const started = performance.now(), collector = new MetricsCollector(), confirmations: RunObservation['confirmations'] = [];
  const turns: TurnObservation[] = [], captureIssues: string[] = [], traceDirectories: string[] = [];
  let runtime: AgentSessionRuntime | undefined, unsubscribe: (() => void) | undefined, currentTurn: TurnObservation | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, reason: 'timeout' | 'budget_exceeded' | undefined;
  let error: string | null = null, outcome: Outcome = 'errored', rpcDispatches = 0, invalidOutput = false;
  let modelErrors = 0, finalMessages = 0, visiblePrefix = '';
  let presentationSeen = false;
  const nativePresentation = existsSync(join(config.runtimeRoot, 'bangumi/dist/src/output/presentation-store.js'));
  const recoveryEnabled = config.recovery === 'enabled';
  let initializationStart: number | undefined;
  const checkpoint = () => atomicJson(join(config.outputDir, 'progress.json'), { metrics: collector.value });
  const networkTransport = createPiTransport(config.offline ? null : config.proxy);
  const stop = (cause: 'timeout' | 'budget_exceeded') => { reason ??= cause; void runtime?.session.abort(); };
  const sourceModule = (name: string) => import(pathToFileURL(join(config.runtimeRoot, 'bangumi/dist/src', name + '.js')).href);
  const dependency = (name: string) => import((import.meta.resolve as (name: string, parent: string) => string)(
    name, pathToFileURL(join(config.runtimeRoot, 'bangumi/package.json')).href));
  const seenReads = new Set<string>(), pendingCalls = new Map<string, unknown>();
  try {
    const [{ createBangumiRuntime }, { createBangumiExtension }, { LocalMcpClient }, { TOOL_DEFINITIONS },
      { validateMixedContent }, pi] = await Promise.all([
      sourceModule('pi-host'), sourceModule('extension'), sourceModule('mcp/client'),
      sourceModule('mcp/catalog'), sourceModule('output/content-schema'), dependency('@earendil-works/pi-coding-agent'),
    ]);
    const modelRuntime = await pi.ModelRuntime.create({
      authPath: config.offline ? join(isolated, 'model-auth.json') : join(config.agentDir, 'auth.json'),
      modelsPath: config.offline ? null : join(config.agentDir, 'models.json'), allowModelNetwork: false,
    });
    if (config.offline) {
      if (config.case.id !== 'facts-basic' && !config.case.offlineScript) throw new Error('离线仅支持facts-basic和登记的故障脚本；不计为真实模型评测。');
      const fauxApi = await dependency('@earendil-works/pi-ai/providers/faux'), ai = await dependency('@earendil-works/pi-ai');
      const faux = fauxApi.fauxProvider({ api: 'openai-responses' });
      const nativeScript = config.case.offlineScript?.startsWith('native_') === true;
      if (nativeScript && !nativePresentation) throw new Error('原生参数脚本要求原生展示runtime。');
      if (config.case.offlineScript && !nativeScript && nativePresentation) throw new Error('旧mixed JSON脚本只验证旧runtime，请使用原生参数脚本验证当前runtime。');
      const rawOverrides = new Map<string, string>();
      const finalWire = nativePresentation ? '验收完成。' : JSON.stringify({ content: [{ type: 'text', text: '验收完成。' }] });
      const failures: Record<string, string> = {
        bare_component: '{"type":"Callout","props":{"tone":"info","text":"正文草稿"}}\n后接普通文字',
        blank_output: ' '.repeat(382),
        text_field: '{"content":[{"type":"text","text":123}]}',
        component_field: '{"content":[{"type":"Callout","props":{"tone":"invalid","text":"失败草稿"}}]}',
        prefix_then_invalid: '{"content":[{"type":"text","text":"保留前缀。"},{"type":"Callout","props":{"tone":"invalid","text":"失败草稿"}}]}',
        exhausted: '{"content":[{"type":"text","text":123}]}',
      };
      faux.setResponses(config.case.offlineScript
        ? [fauxApi.fauxAssistantMessage(failures[config.case.offlineScript]),
          ...Array.from({ length: config.case.offlineScript === 'exhausted' ? 12 : 1 }, () => fauxApi.fauxAssistantMessage(
            config.case.offlineScript === 'exhausted' ? failures.exhausted : finalWire))]
        : [
        fauxApi.fauxAssistantMessage([fauxApi.fauxToolCall('get_subject_details', {
          subject_id: 1001, fields: ['nameCn', 'score', 'date', 'totalEpisodes'],
        })], { stopReason: 'toolUse' }),
        fauxApi.fauxAssistantMessage(nativePresentation ? '星港追踪，评分8.4，首播2024-01-08，共12集。https://bgm.tv/subject/1001'
          : JSON.stringify({ content: [{ type: 'text', nextType: null,
            text: '星港追踪，评分8.4，首播2024-01-08，共12集。https://bgm.tv/subject/1001' }] })),
      ]);
      if (nativeScript) {
        const terminalScript = config.case.offlineScript?.startsWith('native_terminal_') === true;
        const scripts: Record<string, string> = {
          native_trailing_comma: '{"text":"本地修复完成。",}',
          native_duplicate_key: '{"text":"错误草稿","text":"错误重复值"}',
          native_truncated_value: '{"text":"未闭合的值',
        };
        const first = fauxApi.fauxToolCall('present_text', { text: '错误草稿' }, { id: 'native-first' });
        if (!terminalScript) rawOverrides.set('native-first', scripts[config.case.offlineScript!]!);
        const correction = fauxApi.fauxToolCall('present_text', { text: '模型纠参完成。' }, { id: 'native-corrected' });
        faux.setResponses([fauxApi.fauxAssistantMessage([first], { stopReason: 'toolUse' }),
          ...(config.case.offlineScript === 'native_trailing_comma' ? [] : [fauxApi.fauxAssistantMessage([correction], { stopReason: 'toolUse' })]),
          fauxApi.fauxAssistantMessage('验收完成。')]);
        if (terminalScript) faux.setResponses([
          fauxApi.fauxAssistantMessage([fauxApi.fauxToolCall('present_text', { text: '保留前缀。' }, { id: 'native-prefix' })], { stopReason: 'toolUse' }),
          fauxApi.fauxAssistantMessage([], { stopReason: config.case.offlineScript === 'native_terminal_abort' ? 'aborted' : 'error',
            errorMessage: 'BENCHMARK_EXPECTED_TERMINAL_FAILURE' }),
        ]);
      }
      modelRuntime.registerNativeProvider({ ...faux.provider, streamSimple: (model: unknown, context: unknown, options: Record<string, unknown>) =>
        ai.lazyStream(model, async () => {
          const payload = { model: record(model).id, messages: record(context).messages,
            tools: ai.getCurrentTools(record(context).messages) };
          if (typeof options?.onPayload === 'function') await options.onPayload(payload, model);
          collector.payload(Buffer.byteLength(JSON.stringify(payload))); collector.payloadTools(payload);
          const upstream = faux.provider.streamSimple(model, context, options);
          const attach = (message: unknown) => {
            for (const call of Array.isArray(record(message).content) ? record(message).content as unknown[] : []) {
              if (record(call).type === 'toolCall' && ['prepare_component', 'present_component', 'present_text'].includes(String(record(call).name)))
                ai.setToolCallArgumentSource(call, { raw: rawOverrides.get(String(record(call).id)) ?? JSON.stringify(record(call).arguments), state: 'complete', source: 'terminal_response' });
            }
          };
          // faux的clone不会携带WeakMap证据；只在离线生产Pi链路注入明确登记的raw参数。
          return { async *[Symbol.asyncIterator]() {
            for await (const event of upstream) { attach(record(event).partial); attach(record(event).message); yield event; }
          }, async result() { const message = await upstream.result(); attach(message); return message; } };
        }) });
      await modelRuntime.setRuntimeApiKey('faux', 'benchmark-offline-placeholder');
    }
    const client = new LocalMcpClient({ authDir, timeoutMs: Math.min(300000, Math.max(1000, config.case.budget.timeoutMs)),
      proxy: null, entry: fileURLToPath(new URL('./fixture-server.js', import.meta.url)),
      onTrace: (event: string) => {
        if (event === 'dispatch') rpcDispatches++;
        if (event === 'initializing') initializationStart = performance.now();
        if (event === 'initialized' && initializationStart !== undefined) collector.value.mcpInitializationMs += performance.now() - initializationStart;
      },
    }) as McpCallClient;
    const definitionByName = new Map<string, { effect: string }>(TOOL_DEFINITIONS.map((definition: { name: string; effect: string }) => [definition.name, definition]));
    const guarded: McpCallClient = {
      async call(name, args, signal, guard, batch, read) {
        if (reason || collector.value.mcpCalls >= config.case.budget.mcpCalls) { stop('budget_exceeded'); throw new Error('BENCHMARK_BUDGET_EXCEEDED'); }
        if (config.mode === 'live-read' && definitionByName.get(name)?.effect === 'write') throw new Error('BENCHMARK_LIVE_WRITE_BLOCKED');
        collector.value.mcpCalls++;
        checkpoint();
        if (definitionByName.get(name)?.effect === 'read') {
          const key = traceHash({ name, args, turn: turns.length, phase: batch?.phase ?? 'query' });
          if (seenReads.has(key)) collector.value.duplicateReads++; seenReads.add(key);
        }
        const start = performance.now();
        try { return await client.call(name, args, signal, guard, batch, read); }
        finally { collector.value.mcpMs += performance.now() - start; }
      },
      async readCachedResource(ref, signal, read, selection) {
        if (reason) throw new Error('BENCHMARK_STOPPED');
        collector.value.cacheRpcCalls++;
        return client.readCachedResource!(ref, signal, read, selection);
      },
      endReadContext: async turnId => { await client.endReadContext?.(turnId); },
      close: () => client.close(),
    };
    const channel: InteractionChannel = {
      canConfirm: () => config.mode === 'fixture',
      confirm: async (_ctx, preview) => {
        const start = performance.now(), accepted = config.mode === 'fixture' && config.case.confirmation === 'approve';
        confirmations.push({ preview: String(traceRedact(preview)), accepted, timestampMs: performance.timeOrigin + performance.now() });
        collector.value.confirmationsMs += performance.now() - start; return accepted;
      },
      canLogin: () => false, login: async () => { throw new Error('BENCHMARK_LOGIN_DISABLED'); }, notify: () => {},
    };
    const slash = config.model.indexOf('/'), provider = config.model.slice(0, slash), model = config.model.slice(slash + 1);
    runtime = await createBangumiRuntime({
      cwd: isolated, agentDir: join(isolated, 'pi'), modelRuntime, provider, model, thinkingLevel: config.thinking,
      sessionManager: pi.SessionManager.inMemory(isolated),
      extension: createBangumiExtension({ authDir, timeoutMs: Math.min(300000, config.case.budget.timeoutMs), proxy: null,
        client: guarded, channel, trace: { directory: traceDir }, generateSessionTitle: async () => 'Benchmark',
      }),
      fetch: async (input: Parameters<typeof networkTransport.fetch>[0], init: Parameters<typeof networkTransport.fetch>[1]) => {
        if (config.offline) throw new Error('BENCHMARK_OFFLINE_NETWORK_BLOCKED');
        const count = collector.value.providerHttpRequests ?? 0;
        if (reason || count >= config.case.budget.modelRequests) { stop('budget_exceeded'); throw new Error('BENCHMARK_BUDGET_EXCEEDED'); }
        collector.value.providerHttpRequests = count + 1;
        const headers = new Headers(init?.headers);
        for (const key of ['authorization', 'x-api-key', 'api-key']) {
          const value = headers.get(key); if (value) registerCredentials([value, value.replace(/^Bearer\s+/i, '')]);
        }
        checkpoint();
        if (typeof init?.body === 'string') {
          collector.payload(Buffer.byteLength(init.body));
          try { collector.payloadTools(JSON.parse(init.body)); } catch { captureIssues.push('provider_payload_unreadable'); }
        }
        const timeoutSignal = AbortSignal.timeout(config.case.budget.timeoutMs);
        return networkTransport.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal });
      },
    }) as AgentSessionRuntime;
    runtime.session.sessionManager.appendSessionInfo('Benchmark');
    runtime.session.setAutoRetryEnabled(recoveryEnabled);
    unsubscribe = runtime.session.subscribe(event => {
      collector.event(event);
      const row = record(event), message = record(row.message);
      const entry = record(row.entry), presentation = record(entry.data);
      if (row.type === 'entry_appended' && entry.type === 'custom' && entry.customType === 'bangumi/presentation' && currentTurn) {
        presentationSeen = true;
        const content = canonicalBenchmarkContent(Array.isArray(presentation.content) ? presentation.content : []);
        const visible = content.filter(part => record(part).type === 'text').map(part => String(record(part).text ?? '')).join('');
        if (!visible.startsWith(visiblePrefix)) collector.value.prefixMonotonic = false;
        else visiblePrefix = visible;
        if (['completed', 'error', 'aborted'].includes(String(presentation.status))) {
          currentTurn.presentationStatus = presentation.status as 'completed' | 'error' | 'aborted';
          try { validateMixedContent({ content }); } catch { invalidOutput = true; }
          currentTurn.final = traceRedact({ content }); currentTurn.text = outputText({ content });
          if (presentation.status === 'completed') { collector.value.validatedFinals++; finalMessages++; }
        }
      }
      if (row.type === 'message_start' && message.role === 'assistant' || row.type === 'tool_execution_start') checkpoint();
      if (collector.value.modelRequests > config.case.budget.modelRequests || collector.value.toolExecutions > config.case.budget.toolExecutions) stop('budget_exceeded');
      if (row.type === 'tool_execution_start') pendingCalls.set(String(row.toolCallId), traceRedact(row.args));
      if (!nativePresentation && row.type === 'message_update' && currentTurn) {
        const parts = Array.isArray(message.content) ? message.content : [];
        const visible = parts.filter(part => record(part).type === 'text').map(part => String(record(part).text ?? '')).join('');
        if (visible) { if (!visible.startsWith(visiblePrefix)) collector.value.prefixMonotonic = false; else visiblePrefix = visible; }
      }
      if (row.type === 'message_end' && message.role === 'toolResult' && currentTurn) {
        let value: unknown = null;
        const parts = Array.isArray(message.content) ? message.content : [];
        for (const part of parts) if (record(part).type === 'text' && typeof record(part).text === 'string') {
          try { value = JSON.parse(String(record(part).text)); } catch { value = record(part).text; }
        }
        currentTurn.tools.push({ name: String(message.toolName), arguments: pendingCalls.get(String(message.toolCallId)) ?? null,
          value: traceRedact(value), error: message.isError === true });
      }
      if (row.type === 'message_end' && message.role === 'assistant') {
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
          modelErrors++;
          if (typeof message.errorMessage === 'string') error ??= String(traceRedact(message.errorMessage));
        }
        const parts = Array.isArray(message.content) ? message.content : [];
        const source = Array.isArray(message.diagnostics) && message.diagnostics.some(item => record(item).type === 'bangumi_presentation_source');
        if (!nativePresentation && !presentationSeen && !source && message.stopReason === 'stop' && !parts.some(part => record(part).type === 'toolCall') && currentTurn) {
          const content = canonicalBenchmarkContent(parts);
          try { validateMixedContent({ content }); collector.value.validatedFinals++; } catch { invalidOutput = true; }
          currentTurn.final = traceRedact({ content }); currentTurn.text = outputText({ content }); finalMessages++;
          if (visiblePrefix && !parts.filter(part => record(part).type === 'text').map(part => String(record(part).text ?? '')).join('').startsWith(visiblePrefix)) collector.value.prefixMonotonic = false;
        }
      }
    });
    collector.start(performance.now() - started, config.offline);
    deadline = setTimeout(() => stop('timeout'), config.case.budget.timeoutMs);
    for (const prompt of config.case.turns) {
      const start = performance.now();
      visiblePrefix = '';
      presentationSeen = false;
      currentTurn = { prompt, final: null, text: '', tools: [], durationMs: 0 }; turns.push(currentTurn);
      await runtime.session.prompt(prompt); await runtime.session.waitForIdle();
      currentTurn.durationMs = performance.now() - start;
      if (reason) break;
    }
    const terminalError = turns.some(turn => turn.final === null || turn.presentationStatus && turn.presentationStatus !== 'completed');
    collector.value.terminalModelErrors = turns.filter(turn => turn.final === null || turn.presentationStatus && turn.presentationStatus !== 'completed').length;
    outcome = reason ?? ((terminalError || !recoveryEnabled && modelErrors > 0) ? 'errored' : 'failed');
    if (recoveryEnabled && !terminalError) error = null;
  } catch (caught) { error = String(traceRedact(caught instanceof Error ? caught.message : 'BENCHMARK_ERROR')); outcome = reason ?? 'errored'; }
  finally {
    if (deadline) clearTimeout(deadline);
    unsubscribe?.();
    try { await runtime?.dispose(); } catch { captureIssues.push('runtime_dispose_failed'); }
    await networkTransport.close();
  }
  let network: NetworkEvent[] = [], state: unknown = null;
  try { if (existsSync(join(config.outputDir, 'network.jsonl'))) network = readFileSync(join(config.outputDir, 'network.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { captureIssues.push('invalid_network_capture'); }
  try { if (existsSync(join(config.outputDir, 'fixture-state.json'))) state = JSON.parse(readFileSync(join(config.outputDir, 'fixture-state.json'), 'utf8')); } catch { captureIssues.push('invalid_fixture_state'); }
  if (existsSync(traceDir)) for (const file of readdirSync(traceDir, { recursive: true }).filter(file => String(file).endsWith('summary.json'))) {
    const directory = resolve(traceDir, String(file), '..'); traceDirectories.push(directory);
    try { const analysis = await analyzeTrace(directory); if (!analysis.complete) captureIssues.push('trace_incomplete'); } catch { captureIssues.push('trace_unreadable'); }
  }
  if (!traceDirectories.length) captureIssues.push('trace_missing');
  if (config.case.offlineScript === 'prefix_then_invalid') collector.value.prefixDuplications = Math.max(0, (turns.at(-1)?.text.split('保留前缀。').length ?? 1) - 2);
  const gradingCase: WorkerConfig['case'] = config.case.offlineScript && !config.case.offlineScript.startsWith('native_') ? { ...config.case, rules: [...config.case.rules, {
    kind: 'recovery' as const, expectedTerminal: config.case.expectedTerminal ?? 'success',
    ...(config.case.offlineScript === 'prefix_then_invalid' ? { prefix: '保留前缀。' } : {}),
  }] } : config.case;
  const grade = gradeCase(gradingCase, turns, config.fixture, network, confirmations, state, collector.value);
  const expectedError = config.case.expectedTerminal === 'error';
  if (invalidOutput || finalMessages !== config.case.turns.length && !expectedError) grade.passed = false;
  if (invalidOutput) error ??= '输出未通过当前版本组件契约校验。';
  if (!reason && (outcome !== 'errored' || expectedError)) outcome = grade.passed ? 'passed' : 'failed';
  if (!reason && network.some(event => event.fixtureMiss)) outcome = 'invalid_fixture';
  if (!reason && captureIssues.length) outcome = 'incomplete_capture';
  collector.value.rpcDispatches = rpcDispatches;
  const result: RunObservation = { schemaVersion: 1, caseId: config.case.id, family: config.case.family,
    variant: config.variant, repeat: config.repeat, protocolHash: config.protocolHash, versionHash: config.versionHash,
    model: config.model, thinking: config.thinking, mode: config.mode, outcome, error, turns,
    metrics: collector.finish(network, config.mode === 'fixture' || existsSync(join(config.outputDir, 'network.jsonl'))),
    grade, confirmations, network, traceDirectories, captureIssues };
  if (result.outcome === 'passed' && !config.offline && result.metrics.providerHttpRequests !== result.metrics.modelRequests) {
    result.outcome = 'incomplete_capture'; result.captureIssues.push('provider_request_usage_incomplete');
  }
  atomicJson(join(config.outputDir, 'result.json'), result); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executeCase(JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as WorkerConfig)
    .then(result => { process.stdout.write(JSON.stringify({ outcome: result.outcome, caseId: result.caseId }) + '\n'); })
    .catch(() => { process.stderr.write('BENCHMARK_WORKER_FAILED\n'); process.exitCode = 1; });
}
