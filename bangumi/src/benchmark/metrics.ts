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
    firstCompleteResultMs: null, confirmationsMs: 0, duplicateReads: 0, requests: [] };
}
/** 只计数和打时间点；不保存流片段、凭据或假造不可见思考。 */
export class MetricsCollector {
  readonly value = blankMetrics();
  private started = performance.now();
  private pendingPayloadBytes: number | null = null;
  private active: { metric: RequestMetric; start: number; lastThinking: number | null } | undefined;
  start(startupMs: number, offline: boolean): void {
    this.started = performance.now(); this.value.startupMs = startupMs;
    this.value.providerHttpRequests = offline ? 0 : 0;
  }
  payload(bytes: number): void {
    if (this.active) this.active.metric.providerPayloadBytes = bytes;
    else this.pendingPayloadBytes = bytes;
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
        this.active.metric.firstTextMs ??= elapsed; this.value.firstTextMs ??= now - this.started;
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
    }
    if (event.type === 'message_end' && message.role === 'assistant') {
      const calls = Array.isArray(message.content) ? message.content.filter(part => record(part).type === 'toolCall') : [];
      this.value.proposedToolCalls += calls.length;
      if (message.stopReason === 'stop' && calls.length === 0) this.value.firstCompleteResultMs ??= now - this.started;
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
