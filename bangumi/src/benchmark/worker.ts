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
import { gradeCase, outputText } from './scoring.js';
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
  let modelErrors = 0, finalMessages = 0;
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
      if (config.case.id !== 'facts-basic') throw new Error('离线 smoke 仅支持 facts-basic；其输出为脚本，不计为真实模型评测。');
      const fauxApi = await dependency('@earendil-works/pi-ai/providers/faux'), ai = await dependency('@earendil-works/pi-ai');
      const faux = fauxApi.fauxProvider({ api: 'openai-responses' });
      faux.setResponses([
        fauxApi.fauxAssistantMessage([fauxApi.fauxToolCall('get_subject_details', {
          subject_id: 1001, fields: ['nameCn', 'score', 'date', 'totalEpisodes'],
        })], { stopReason: 'toolUse' }),
        fauxApi.fauxAssistantMessage(JSON.stringify({ content: [{ type: 'text', nextType: null,
          text: '星港追踪，评分8.4，首播2024-01-08，共12集。https://bgm.tv/subject/1001' }] })),
      ]);
      modelRuntime.registerNativeProvider({ ...faux.provider, streamSimple: (model: unknown, context: unknown, options: Record<string, unknown>) =>
        ai.lazyStream(model, async () => {
          const payload = { model: record(model).id, messages: record(context).messages };
          collector.payload(Buffer.byteLength(JSON.stringify(payload)));
          if (typeof options?.onPayload === 'function') await options.onPayload(payload, model);
          return faux.provider.streamSimple(model, context, options);
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
        if (typeof init?.body === 'string') collector.payload(Buffer.byteLength(init.body));
        const timeoutSignal = AbortSignal.timeout(config.case.budget.timeoutMs);
        return networkTransport.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal });
      },
    }) as AgentSessionRuntime;
    runtime.session.sessionManager.appendSessionInfo('Benchmark');
    runtime.session.setAutoRetryEnabled(false);
    unsubscribe = runtime.session.subscribe(event => {
      collector.event(event);
      const row = record(event), message = record(row.message);
      if (row.type === 'message_start' && message.role === 'assistant' || row.type === 'tool_execution_start') checkpoint();
      if (collector.value.modelRequests > config.case.budget.modelRequests || collector.value.toolExecutions > config.case.budget.toolExecutions) stop('budget_exceeded');
      if (row.type === 'tool_execution_start') pendingCalls.set(String(row.toolCallId), traceRedact(row.args));
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
        if (message.stopReason === 'stop' && !parts.some(part => record(part).type === 'toolCall') && currentTurn) {
          const content = parts.filter(part => !['thinking', 'toolCall'].includes(String(record(part).type)));
          try { validateMixedContent({ content }); } catch { invalidOutput = true; }
          currentTurn.final = traceRedact({ content }); currentTurn.text = outputText({ content }); finalMessages++;
        }
      }
    });
    collector.start(performance.now() - started, config.offline);
    deadline = setTimeout(() => stop('timeout'), config.case.budget.timeoutMs);
    for (const prompt of config.case.turns) {
      const start = performance.now();
      currentTurn = { prompt, final: null, text: '', tools: [], durationMs: 0 }; turns.push(currentTurn);
      await runtime.session.prompt(prompt); await runtime.session.waitForIdle();
      currentTurn.durationMs = performance.now() - start;
      if (reason) break;
    }
    outcome = reason ?? (modelErrors ? 'errored' : 'failed');
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
  const grade = gradeCase(config.case, turns, config.fixture, network, confirmations, state);
  if (invalidOutput || finalMessages !== config.case.turns.length) grade.passed = false;
  if (invalidOutput) error ??= '输出未通过当前版本组件契约校验。';
  if (!reason && outcome !== 'errored') outcome = grade.passed ? 'passed' : 'failed';
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
