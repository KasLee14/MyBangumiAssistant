import type { NetworkEvent, RequestMetric, RunMetrics } from './schema.js';
import { record } from './schema.js';

const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function blankMetrics(): RunMetrics {
  return { totalMs: 0, startupMs: 0, modelRequests: 0, providerHttpRequests: null, proposedToolCalls: 0, toolExecutions: 0,
    toolErrors: 0, mcpCalls: 0, mcpMs: 0, mcpInitializationMs: 0, cacheRpcCalls: 0, rpcDispatches: 0, upstreamRequests: null, upstreamWriteRequests: null,
    upstreamMs: null, modelMs: 0, providerPayloadBytesMax: null, inputTokensMax: null, inputTokensSum: null,
    contextInputTokensMax: null, contextInputTokensSum: null, reasoningTokensSum: null,
    outputTokensSum: null, cacheReadTokensSum: null, cacheWriteTokensSum: null, totalTokensSum: null,
    estimatedCost: null, usageUnavailableRequests: 0, modelToolResultBytes: 0, firstTextMs: null,
    firstCompleteResultMs: null, providerFirstTextMs: null, firstPublishedBlockMs: null, confirmationsMs: 0, duplicateReads: 0, requests: [],
    outputErrors: 0, blankOutputErrors: 0, schemaOutputErrors: 0, jsonOutputErrors: 0,
    modelErrors: 0, terminalModelErrors: 0, recoveryScheduled: 0, recoveryRunning: 0, recoveryRecovered: 0, recoveryStopped: 0,
    strictToolsSent: 0, toolDeclarationsSent: 0, initialToolCount: null, initialToolSchemaBytes: null,
    initialProviderPayloadBytes: null, validatedFinals: 0, prefixMonotonic: true, prefixDuplications: 0,
    firstRoundFailed: false, firstOutputAttemptFailed: null, localArgumentRepairs: 0, argumentRejections: 0, schemaArgumentRejections: 0,
    modelArgumentCorrections: 0, preparedComponents: 0, publishedComponents: 0 };
}
/** 只计数和打时间点；不保存流片段、凭据或假造不可见思考。 */
export class MetricsCollector {
  readonly value = blankMetrics();
  private started = performance.now();
  private pendingPayloadBytes: number | null = null;
  private active: { metric: RequestMetric; start: number; lastThinking: number | null } | undefined;
  private failedPresentationTools = new Set<string>();
  private nativePresentation = false;
  private firstOutputToolId: string | undefined;
  start(startupMs: number, offline: boolean): void {
    this.started = performance.now(); this.value.startupMs = startupMs;
    this.value.providerHttpRequests = offline ? 0 : 0;
  }
  payload(bytes: number): void {
    this.value.initialProviderPayloadBytes ??= bytes;
    if (this.active) this.active.metric.providerPayloadBytes = bytes;
    else this.pendingPayloadBytes = bytes;
  }
  payloadTools(payload: unknown): void {
    const tools = Array.isArray(record(payload).tools) ? record(payload).tools as unknown[] : [];
    this.value.initialToolCount ??= tools.length;
    this.value.initialToolSchemaBytes ??= Buffer.byteLength(JSON.stringify(tools.map(tool =>
      record(tool).parameters ?? record(record(tool).function).parameters ?? record(tool).input_schema ?? {})));
    this.value.toolDeclarationsSent += tools.length;
    this.value.strictToolsSent += tools.filter(tool => record(tool).strict === true || record(record(tool).function).strict === true).length;
  }
  private finishRequest(message: Record<string, unknown>): void {
    if (!this.active) return;
    const { metric, start, lastThinking } = this.active, usage = record(message.usage);
    const hasUsage = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].some(key => Number(usage[key]) > 0);
    if (hasUsage) {
      metric.inputTokens = number(usage.input); metric.outputTokens = number(usage.output);
      metric.cacheReadTokens = number(usage.cacheRead); metric.cacheWriteTokens = number(usage.cacheWrite);
      metric.totalTokens = number(usage.totalTokens); metric.estimatedCost = number(record(usage.cost).total);
      metric.reasoningTokens = number(usage.reasoning);
      if ([metric.inputTokens, metric.cacheReadTokens, metric.cacheWriteTokens].every(value => value !== null))
        metric.contextInputTokens = metric.inputTokens! + metric.cacheReadTokens! + metric.cacheWriteTokens!;
    }
    metric.durationMs = performance.now() - start;
    metric.visibleThinkingMs = lastThinking === null || metric.firstThinkingMs === null ? null : lastThinking - metric.firstThinkingMs;
    metric.responseModel = typeof message.responseModel === 'string' ? message.responseModel : null;
    this.value.requests.push(metric); this.active = undefined;
  }
  event(value: unknown): void {
    const event = record(value), message = record(event.message), now = performance.now();
    if (event.type === 'entry_appended') {
      const entry = record(event.entry), data = record(entry.data);
      if (entry.type === 'custom' && entry.customType === 'bangumi/recovery') {
        if (data.stage === 'scheduled') this.value.recoveryScheduled++;
        if (data.stage === 'running') this.value.recoveryRunning++;
        if (data.stage === 'recovered') this.value.recoveryRecovered++;
        if (['stopped', 'cancelled', 'checkpoint_conflict', 'tool_recovery_stopped'].includes(String(data.stage))) this.value.recoveryStopped++;
      }
      if (entry.type === 'custom' && entry.customType === 'bangumi/presentation_arguments') {
        if (data.stage !== 'schema' && data.status === 'repaired') this.value.localArgumentRepairs++;
        if (data.stage !== 'schema' && data.status === 'rejected') this.value.argumentRejections++;
        if (data.stage === 'schema' && data.status === 'rejected') this.value.schemaArgumentRejections++;
      }
      if (entry.type === 'custom' && entry.customType === 'bangumi/presentation') {
        this.nativePresentation = true;
        const content = Array.isArray(data.content) ? data.content : [];
        if (content.length) this.value.firstPublishedBlockMs ??= now - this.started;
        if (content.some(part => record(part).type === 'text' && String(record(part).text ?? '').length))
          this.value.firstTextMs ??= now - this.started;
        if (data.status === 'completed') this.value.firstCompleteResultMs ??= now - this.started;
        if (this.value.firstOutputAttemptFailed === null && ['completed', 'error', 'aborted'].includes(String(data.status)))
          this.value.firstOutputAttemptFailed = data.status !== 'completed';
      }
    }
    if (event.type === 'message_start' && message.role === 'assistant') {
      if (this.active) this.finishRequest({});
      this.value.modelRequests++;
      this.active = { start: now, lastThinking: null, metric: {
        inputTokens: null, contextInputTokens: null, reasoningTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null,
        estimatedCost: null, providerPayloadBytes: this.pendingPayloadBytes, durationMs: 0, firstTextMs: null, firstThinkingMs: null,
        visibleThinkingMs: null, thinkingChars: 0, responseModel: null,
      } };
      this.pendingPayloadBytes = null;
    }
    if (event.type === 'message_update' && this.active) {
      const delta = record(event.assistantMessageEvent), elapsed = now - this.active.start;
      if (delta.type === 'text_delta') {
        this.active.metric.firstTextMs ??= elapsed; this.value.providerFirstTextMs ??= now - this.started;
        if (!this.nativePresentation) this.value.firstTextMs ??= now - this.started;
      }
      if (delta.type === 'thinking_delta') {
        this.active.metric.firstThinkingMs ??= elapsed; this.active.lastThinking = elapsed;
        if (typeof delta.delta === 'string') this.active.metric.thinkingChars += Array.from(delta.delta).length;
      }
    }
    if (event.type === 'tool_execution_start') this.value.toolExecutions++;
    if (event.type === 'tool_execution_end' && event.isError === true) this.value.toolErrors++;
    if (event.type === 'message_end' && message.role === 'toolResult') {
      this.value.modelToolResultBytes += Buffer.byteLength(JSON.stringify(message.content ?? []));
      const name = String(message.toolName);
      if (['prepare_component', 'present_component', 'present_text'].includes(name)) {
        if (this.value.firstOutputAttemptFailed === null && (this.firstOutputToolId === undefined || this.firstOutputToolId === message.toolCallId))
          this.value.firstOutputAttemptFailed = message.isError === true;
        if (message.isError === true) {
          this.failedPresentationTools.add(name);
          if (this.value.modelRequests === 1) this.value.firstRoundFailed = true;
        } else {
          if (this.failedPresentationTools.delete(name)) this.value.modelArgumentCorrections++;
          if (name === 'prepare_component') this.value.preparedComponents++;
          if (name === 'present_component') this.value.publishedComponents++;
        }
      }
    }
    if (event.type === 'message_end' && message.role === 'assistant') {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        this.value.modelErrors++;
        if (this.value.modelRequests === 1) this.value.firstRoundFailed = true;
        const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
        const structured = diagnostics.map(item => record(record(record(item).details).diagnostic));
        const diagnostic = structured.find(row => typeof row.code === 'string' && row.code.startsWith('CONTENT_'))
          ?? structured.find(row => row.origin === 'content' || row.origin === 'output');
        const code = typeof diagnostic?.code === 'string' ? diagnostic.code : undefined;
        if (code !== undefined) {
          // 原因可细分为资源引用等业务类别；格式分类始终以宿主固定错误码为准。
          if (code.startsWith('CONTENT_') || diagnostic?.origin === 'content' || diagnostic?.origin === 'output') this.value.outputErrors++;
          if (code === 'CONTENT_OUTPUT_EMPTY') this.value.blankOutputErrors++;
          if (code === 'CONTENT_SCHEMA_INVALID') this.value.schemaOutputErrors++;
          if (code.startsWith('CONTENT_JSON_')) this.value.jsonOutputErrors++;
          if (this.value.firstOutputAttemptFailed === null && (code.startsWith('CONTENT_') || diagnostic?.origin === 'content' || diagnostic?.origin === 'output'))
            this.value.firstOutputAttemptFailed = true;
        } else {
          const description = String(message.errorMessage ?? '') + ' ' + String(diagnostic?.reason ?? '') + ' ' + JSON.stringify(diagnostic?.issues ?? []);
          if (/CONTENT_|content_|json_|schema_|blank|empty_output|output_/i.test(description)) {
            this.value.outputErrors++;
            if (this.value.firstOutputAttemptFailed === null) this.value.firstOutputAttemptFailed = true;
          }
          if (/blank|empty_output|empty_response|whitespace|CONTENT_OUTPUT_EMPTY/i.test(description)) this.value.blankOutputErrors++;
          if (/schema|field|component|type_mismatch/i.test(description)) this.value.schemaOutputErrors++;
          // 旧格式没有结构化诊断时，已识别空白仍归为空输出，不能同时误算未闭合 JSON。
          if (!/blank|empty_output|empty_response|whitespace|CONTENT_OUTPUT_EMPTY/i.test(description)
            && /json|syntax|unclosed|incomplete/i.test(description)) this.value.jsonOutputErrors++;
        }
      }
      const calls = Array.isArray(message.content) ? message.content.filter(part => record(part).type === 'toolCall') : [];
      if (this.value.firstOutputAttemptFailed === null && this.firstOutputToolId === undefined) {
        const first = calls.find(call => ['prepare_component', 'present_component', 'present_text'].includes(String(record(call).name)));
        if (typeof record(first).id === 'string') this.firstOutputToolId = String(record(first).id);
      }
      this.value.proposedToolCalls += calls.length;
      const source = Array.isArray(message.diagnostics) && message.diagnostics.some(item => record(item).type === 'bangumi_presentation_source');
      if (!source && message.stopReason === 'stop' && calls.length === 0) {
        this.value.firstCompleteResultMs ??= now - this.started;
        this.value.firstOutputAttemptFailed ??= false;
      }
      this.finishRequest(message);
    }
  }
  finish(network: NetworkEvent[], upstreamKnown: boolean): RunMetrics {
    if (this.active) this.finishRequest({});
    this.value.totalMs = performance.now() - this.started;
    const requests = this.value.requests;
    const sum = (key: keyof RequestMetric): number | null => requests.length && requests.every(request => typeof request[key] === 'number')
      ? requests.reduce((total, request) => total + Number(request[key]), 0) : null;
    const max = (key: keyof RequestMetric): number | null => requests.length && requests.every(request => typeof request[key] === 'number')
      ? Math.max(...requests.map(request => Number(request[key]))) : null;
    Object.assign(this.value, {
      modelMs: requests.reduce((total, request) => total + request.durationMs, 0),
      inputTokensSum: sum('inputTokens'), outputTokensSum: sum('outputTokens'),
      contextInputTokensSum: sum('contextInputTokens'), contextInputTokensMax: max('contextInputTokens'), reasoningTokensSum: sum('reasoningTokens'),
      cacheReadTokensSum: sum('cacheReadTokens'), cacheWriteTokensSum: sum('cacheWriteTokens'),
      totalTokensSum: sum('totalTokens'), estimatedCost: sum('estimatedCost'),
      inputTokensMax: max('inputTokens'), providerPayloadBytesMax: max('providerPayloadBytes'),
      usageUnavailableRequests: requests.filter(request => request.inputTokens === null).length,
      upstreamRequests: upstreamKnown ? network.length : null,
      upstreamWriteRequests: upstreamKnown ? network.filter(event => event.write).length : null,
      upstreamMs: upstreamKnown ? network.reduce((total, event) => total + event.durationMs, 0) : null,
    });
    const unobserved = Math.max(0, (this.value.providerHttpRequests ?? 0) - requests.length);
    if (unobserved) {
      this.value.usageUnavailableRequests += unobserved;
      for (const key of ['inputTokensSum', 'outputTokensSum', 'cacheReadTokensSum', 'cacheWriteTokensSum', 'totalTokensSum',
        'contextInputTokensSum', 'contextInputTokensMax', 'inputTokensMax', 'estimatedCost', 'reasoningTokensSum'] as const) this.value[key] = null;
    }
    return this.value;
  }
}
