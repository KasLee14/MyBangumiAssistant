import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, TSchema } from '@earendil-works/pi-ai';
import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { safeError, sanitizeErrorDiagnostic } from '../support/errors.js';
import { assistantErrorDiagnostic, correlateDiagnostic, takeErrorDebug, isErrorDiagnostic, type ErrorDiagnostic } from '../support/error-diagnostic.js';
import { TOOL_DEFINITIONS } from '../mcp/catalog.js';
import { analyzeEvents } from './analyze.js';
import { traceHash, traceJson, traceRedact, traceDiagnosticReference } from './redact.js';
import { TRACE_SCHEMA_VERSION, traceRecord, type PayloadRef, type TraceData, type TraceEvent, type TraceHost,
  type TraceLink, type TraceOptions, type TraceOutcome, type TracePhase, type TraceSession } from './schema.js';
import { TraceWriter } from './writer.js';

interface TraceSpan { id: string; parent: string | null; started: number; data: TraceData }
interface TraceScope { run: TraceRun; span: TraceSpan; phase: TracePhase }

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value.map(part => traceRecord(part)).filter(part => part.type === 'text').map(part => String(part.text ?? '')).join('') : '';
}

function sessionIdentity(ctx: ExtensionContext): TraceSession {
  return { session_id: ctx.sessionManager.getSessionId(), session_file: ctx.sessionManager.getSessionFile() ?? null,
    branch_start_id: ctx.sessionManager.getLeafId(), branch_end_id: null };
}

/** 一次执行的持久化投影；只保留统计所需元数据，正文立即进入独立文件队列。 */
export class TraceRun {
  readonly id = randomBytes(16).toString('hex');
  readonly root: TraceSpan;
  readonly writer: TraceWriter;
  readonly events: TraceEvent[] = [];
  private readonly started = performance.now();
  private readonly startedAt = new Date().toISOString();
  private sequence = 0;
  private finishing: Promise<void> | undefined;
  private ended = false;
  private turn: TraceSpan | undefined;
  private llm: TraceSpan | undefined;
  private lastLlmId: string | null = null;
  private lastPartial: AgentMessage | undefined;
  private checkpointAt = -Infinity;
  private readonly tools = new Map<string, TraceSpan>();
  private readonly requestedTools = new Map<string, TraceSpan>();
  private readonly results = new Set<string>();
  private readonly proposed = new Set<string>();
  private lastAnswer = { text: '', status: 'none', message_ref: null as PayloadRef | null };
  private outcome: TraceOutcome = 'incomplete';
  private cancelled = false;
  private stateEpoch = 0;
  private accountScope = 'unknown';
  private readonly inputs: TraceData[] = [];
  private readonly recordedErrors = new Set<string>();

  constructor(options: TraceOptions, readonly session: TraceSession, readonly purpose: 'agent' | 'session_title',
    environment: TraceData, readonly parent: TraceLink | null = null) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: String(environment.timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    this.writer = new TraceWriter(options, date, session.session_id, this.id);
    this.root = { id: randomBytes(8).toString('hex'), parent: null, started: this.started, data: {} };
    this.emit('run.start', { purpose, session, parent_trace: parent, environment }, this.root);
    this.writer.summary(this.summary('running'));
  }

  payload(value: unknown, partial = false): PayloadRef {
    const safe = traceRedact(value, partial);
    if (safe === '[FULLY_REDACTED: serialization_failed]') this.writer.issue('serialization_failed');
    return this.writer.payload(safe);
  }

  emit(event: string, data: TraceData = {}, span = this.root, final = false): void {
    if (this.ended && !final) return;
    const entry: TraceEvent = { schema_version: TRACE_SCHEMA_VERSION, trace_id: this.id, span_id: span.id, parent_span_id: span.parent,
      seq: ++this.sequence, ts: new Date().toISOString(), elapsed_ms: performance.now() - this.started,
      event, data: traceRecord(traceRedact(data)) };
    this.events.push(entry);
    this.writer.event(entry, final);
  }

  span(data: TraceData, parent = this.turn ?? this.root): TraceSpan {
    return { id: randomBytes(8).toString('hex'), parent: parent.id, started: performance.now(), data };
  }

  input(value: TraceData): void {
    const safe = traceRecord(traceRedact(value));
    this.inputs.push(safe);
    this.emit('input', { input_ref: this.payload(safe), source: safe.source, streaming_behavior: safe.streamingBehavior ?? null });
  }

  expandedPrompt(value: unknown): void { this.emit('prompt.expanded', { prompt_ref: this.payload(value) }); }
  answer(text: string): void { this.lastAnswer = { text: String(traceRedact(text)), status: 'final', message_ref: this.payload({ text }) }; }

  turnStart(index: number): void {
    if (this.turn) this.emit('turn.end', { continued: true, duration_ms: performance.now() - this.turn.started }, this.turn);
    this.turn = this.span({ turn_index: index }, this.root);
    this.emit('turn.start', this.turn.data, this.turn);
  }

  turnEnd(data: TraceData): void {
    this.boundary(data.outcome === 'aborted' ? 'aborted' : data.outcome === 'error' ? 'error' : 'completed');
    this.emit('turn.boundary', data, this.turn ?? this.root);
    if (this.turn) { this.emit('turn.end', { duration_ms: performance.now() - this.turn.started }, this.turn); this.turn = undefined; }
  }

  llmStart(messages: unknown, model: TraceData, thinking: string): void {
    if (this.llm) this.llmIncomplete();
    this.llm = this.span({ model, thinking_level: thinking });
    this.lastLlmId = this.llm.id;
    this.lastPartial = undefined;
    this.checkpointAt = -Infinity;
    // 每条消息独立去重；该 manifest 足以重建本轮完整、有序的规范化 prompt。
    const refs = Array.isArray(messages) ? messages.map(message => this.payload(message)) : [];
    this.emit('llm.start', { ...this.llm.data, prompt_message_count: refs.length, prompt_bytes: refs.reduce((sum, ref) => sum + ref.bytes, 0),
      effective_prompt_ref: this.payload({ schema_version: 1, messages: refs }) }, this.llm);
  }

  providerPayload(value: unknown): void {
    this.emit('llm.provider_request', { payload_ref: this.payload(value), projection: 'redacted' }, this.llm ?? this.root);
  }
  private recordError(diagnostic: ErrorDiagnostic, span: TraceSpan): void {
    if (this.recordedErrors.has(diagnostic.errorId)) return;
    this.recordedErrors.add(diagnostic.errorId);
    const safe = traceDiagnosticReference(sanitizeErrorDiagnostic(correlateDiagnostic(diagnostic, {
      traceId: this.id, spanId: span.id, sessionId: this.session.session_id,
    })));
    const debug = takeErrorDebug(diagnostic.errorId);
    this.emit('error.diagnostic', { diagnostic: safe, ...(debug === undefined ? {} : { debug_ref: this.payload(debug, true) }) }, span);
  }

  llmPartial(message: AgentMessage): void {
    this.lastPartial = message;
    if (performance.now() - this.checkpointAt < 1000) return;
    this.checkpointAt = performance.now();
    this.emit('llm.partial', { message_ref: this.payload(message, true), complete: false }, this.llm ?? this.root);
  }

  llmEnd(message: AssistantMessage): void {
    if (!this.llm) return;
    const span = this.llm;
    const diagnostic = assistantErrorDiagnostic(message);
    if (diagnostic) this.recordError(diagnostic, span);
    const safe = traceRecord(traceRedact(message));
    const ref = this.payload(safe);
    const thoughts = message.content.filter(part => part.type === 'thinking');
    const thinkingStatus = thoughts.some(part => part.redacted) ? 'redacted' : thoughts.some(part => part.thinking) ? 'available'
      : span.data.thinking_level === 'off' ? 'off' : 'not_returned';
    const text = messageText(message.content);
    const calls = message.content.filter(part => part.type === 'toolCall');
    for (const call of calls) if (!this.proposed.has(`${span.id}:${call.id}`)) {
      this.proposed.add(`${span.id}:${call.id}`);
      this.emit('tool.proposed', { tool_call_id: call.id, tool_name: call.name, raw_arguments_ref: this.payload(call.arguments) }, span);
    }
    const hasUsage = [message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite].some(value => value > 0);
    this.emit('llm.end', { message_ref: ref, stop_reason: message.stopReason, response_model: message.responseModel ?? message.model,
      response_id: message.responseId ?? null, thinking_status: thinkingStatus,
      reasoning_refs: thoughts.filter(part => !part.redacted).map(part => this.payload({ type: 'thinking', thinking: part.thinking })),
      usage: message.usage, usage_status: hasUsage ? 'reported' : 'unavailable', duration_ms: performance.now() - span.started }, span);
    this.lastAnswer = { text: String(traceRedact(text)), status: message.stopReason === 'stop' && !calls.length ? 'final' : 'partial', message_ref: ref };
    this.boundary(message.stopReason === 'aborted' ? 'aborted' : message.stopReason === 'error' ? 'error' : 'completed');
    this.llm = undefined;
    this.lastPartial = undefined;
  }

  private llmIncomplete(): void {
    if (!this.llm) return;
    this.emit('llm.incomplete', { message_ref: this.lastPartial ? this.payload(this.lastPartial, true) : null,
      complete: false, duration_ms: performance.now() - this.llm.started }, this.llm);
    if (this.lastPartial) this.lastAnswer = { text: messageText(traceRecord(traceRedact(this.lastPartial, true)).content), status: 'partial', message_ref: this.payload(this.lastPartial, true) };
    this.llm = undefined;
    this.lastPartial = undefined;
  }

  toolStart(id: string, name: string, args: unknown): TraceSpan {
    const key = `${this.lastLlmId}:${id}`;
    const existing = this.tools.get(key);
    if (existing) return existing;
    const span = this.requestedTools.get(key) ?? this.span({ tool_call_id: id, tool_name: name, requested_by: this.lastLlmId });
    span.data = { ...span.data, arguments_ref: this.payload(args), phase: name === 'execute_write_batch' ? 'preflight' : 'query' };
    this.tools.set(key, span);
    this.emit('tool.start', span.data, span);
    return span;
  }

  toolRequested(id: string, name: string, args: unknown): void {
    const span = this.span({ tool_call_id: id, tool_name: name, requested_by: this.lastLlmId, arguments_ref: this.payload(args) });
    this.requestedTools.set(`${this.lastLlmId}:${id}`, span);
    this.emit('tool.execution_requested', span.data, span);
  }

  toolResult(id: string, name: string, result: unknown, isError: boolean): void {
    const key = `${this.lastLlmId}:${id}`;
    if (this.results.has(key)) return;
    this.results.add(key);
    const existing = this.tools.get(key);
    const span = existing ?? this.requestedTools.get(key) ?? this.span({ tool_call_id: id, tool_name: name });
    const content = traceRecord(result).content;
    const structured = traceRecord(traceRecord(result).structuredContent ?? traceRecord(result).details);
    const toolError = traceRecord(structured.error);
    if (isErrorDiagnostic(toolError.diagnostic)) {
      // 固定 MCP 输出已校验；记录同一 errorId，不把原始正文塞进模型反馈。
      const diagnostic = toolError.diagnostic;
      this.recordError(diagnostic, span);
    }
    const bytes = Buffer.byteLength(messageText(traceRedact(content)));
    this.emit('tool.result', { ...span.data, executed: Boolean(existing), is_error: isError, result_ref: this.payload(result),
      model_visible_bytes: bytes, duration_ms: existing ? performance.now() - existing.started : null }, span);
    if (name === 'read' && !isError) this.emit('skill.read', { tool_call_id: id, result_hash: traceHash(traceRedact(content)) }, span);
  }

  mcpStart(name: string, args: TraceData, phase: TracePhase, parent?: TraceSpan, accountId?: number, diagnostics = false): TraceSpan {
    if (accountId !== undefined) this.accountScope = `account:${accountId}`;
    const effect = TOOL_DEFINITIONS.find(tool => tool.name === name)?.effect ?? 'unknown';
    if (effect === 'write') this.stateEpoch++;
    const safeArgs = traceRedact(args);
    const span = this.span({ tool_name: name, phase, effect, args_hash: traceHash(safeArgs), arguments_ref: this.payload(safeArgs),
      account_scope: this.accountScope, state_epoch: this.stateEpoch, rpc_attempted: diagnostics ? false : null }, parent);
    this.emit('mcp.start', span.data, span);
    return span;
  }

  mcpEnd(span: TraceSpan, value: unknown, error?: unknown): void {
    const data = traceRecord(value);
    if (error !== undefined) { const diagnostic = safeError(error).diagnostic; if (diagnostic) this.recordError(diagnostic, span); }
    if (span.data.tool_name === 'get_current_user' && Number.isSafeInteger(data.id)) this.accountScope = `account:${data.id}`;
    let subjectIds: number[] | undefined;
    if (['search_subjects', 'browse_subjects'].includes(String(span.data.tool_name)) && Array.isArray(data.data)) {
      subjectIds = data.data.map(row => Number(traceRecord(row).id)).filter(id => Number.isSafeInteger(id) && id > 0);
    }
    this.emit('mcp.end', { ...span.data, outcome: error === undefined ? 'completed' : 'error', duration_ms: performance.now() - span.started,
      result_ref: error === undefined ? this.payload(value) : null, result_bytes: error === undefined ? Buffer.byteLength(traceJson(traceRedact(value))) : 0,
      ...(subjectIds === undefined ? {} : { subject_ids: subjectIds }), ...(error === undefined ? {} : { error: safeError(error) }) }, span);
  }

  boundary(outcome: TraceOutcome): void { this.outcome = this.cancelled ? 'aborted' : outcome; }
  cancel(source = 'tool_signal'): void {
    if (this.cancelled) return;
    this.cancelled = true; this.outcome = 'aborted'; this.emit('run.abort', { source });
  }

  private summary(status: string) {
    return { schema_version: TRACE_SCHEMA_VERSION, trace_id: this.id, root_span_id: this.root.id, purpose: this.purpose,
      parent_trace: this.parent, session: this.session, started_at: this.startedAt, execution_status: status,
      duration_ms: performance.now() - this.started, inputs: this.inputs, final_output: this.lastAnswer,
      capture: { complete: !this.writer.issues.size, issues: [...this.writer.issues], dropped_events: this.writer.droppedEvents,
        provider_payloads: 'redacted_when_available', provider_payload_count: this.events.filter(event => event.event === 'llm.provider_request').length,
        reasoning: 'provider_visible_only', http_request_tracing: 'not_instrumented',
        compaction_model_requests: 'not_instrumented', cache_warming_requests: 'not_instrumented' },
      analysis: analyzeEvents(this.events), evaluation: null };
  }

  finish(branchEndId: string | null, outcome?: TraceOutcome): Promise<void> {
    this.finishing ??= this.finishOnce(branchEndId, outcome);
    return this.finishing;
  }

  private async finishOnce(branchEndId: string | null, outcome?: TraceOutcome): Promise<void> {
    if (outcome) this.outcome = outcome;
    this.llmIncomplete();
    this.session.branch_end_id = branchEndId;
    await this.writer.flush();
    const summary = this.summary(this.outcome);
    this.ended = true;
    this.emit('run.end', { outcome: this.outcome, duration_ms: summary.duration_ms, final_output_ref: this.lastAnswer.message_ref,
      session: this.session, capture: summary.capture }, this.root, true);
    this.writer.summary(summary);
    await this.writer.flush();
  }
}

/** 每个扩展实例一个 Recorder；AsyncLocalStorage 只在此实例内关联宿主子操作。 */
export class TraceRecorder implements TraceHost {
  private readonly scopes = new AsyncLocalStorage<TraceScope>();
  private readonly pendingInputs: TraceData[] = [];
  private readonly runs = new Set<TraceRun>();
  current: TraceRun | undefined;
  private environment: TraceData = {};
  private stopWatching: (() => void) | undefined;

  constructor(private readonly options?: TraceOptions) {}

  /** 隔离观察代码的异常；调用者自己的异常仍由原执行链路处理。 */
  observe<T>(operation: () => T): T | undefined {
    try { return operation(); } catch {
      (this.scopes.getStore()?.run ?? this.current)?.writer.issue('observer_failed');
      return undefined;
    }
  }

  configure(environment: TraceData): void { this.environment = traceRecord(traceRedact(environment)); }

  input(value: TraceData): void {
    if (!this.options) return;
    if (this.current) this.current.input(value); else this.pendingInputs.push(traceRecord(traceRedact(value)));
  }

  start(ctx: ExtensionContext, expanded: unknown): void {
    if (!this.options) return;
    if (!this.current) {
      this.current = this.create(ctx, 'agent');
      for (const input of this.pendingInputs.splice(0)) this.current.input(input);
    }
    this.current.expandedPrompt(expanded);
  }

  private create(ctx: ExtensionContext, purpose: 'agent' | 'session_title', parent: TraceLink | null = null): TraceRun {
    const run = new TraceRun(this.options!, sessionIdentity(ctx), purpose, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      node_version: process.version, ...this.environment, entry_mode: ctx.mode,
      entry_point: this.options!.entryPoint ?? 'embedded',
      model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, api: ctx.model.api } : null }, parent);
    this.runs.add(run);
    return run;
  }

  link(): TraceLink | null { return this.current ? { trace_id: this.current.id, session_id: this.current.session.session_id } : null; }

  watchSignal(signal: AbortSignal | undefined): void {
    const run = this.current;
    if (!signal || !run) return;
    this.stopWatching?.();
    const abort = () => this.observe(() => run.cancel('agent_signal'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    this.stopWatching = () => signal.removeEventListener('abort', abort);
  }

  auxiliary(ctx: ExtensionContext, input: TraceData): TraceRun | undefined {
    if (!this.options) return undefined;
    const run = this.create(ctx, 'session_title', this.link());
    run.input(input);
    return run;
  }

  wrapTool<TParams extends TSchema, TDetails, TState>(tool: ToolDefinition<TParams, TDetails, TState>): ToolDefinition<TParams, TDetails, TState> {
    return { ...tool, execute: (id, args, signal, update, ctx) => {
      const run = this.current;
      if (!run) return tool.execute(id, args, signal, update, ctx);
      const span = this.observe(() => run.toolStart(id, tool.name, args));
      if (!span) return tool.execute(id, args, signal, update, ctx);
      const abort = () => this.observe(() => run.cancel());
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      return this.scopes.run({ run, span, phase: tool.name === 'execute_write_batch' ? 'preflight' : 'query' }, async () => {
        try { return await tool.execute(id, args, signal, update, ctx); }
        finally { signal?.removeEventListener('abort', abort); }
      });
    } };
  }

  async phase<T>(phase: TracePhase, task: () => Promise<T>, data: TraceData = {}): Promise<T> {
    const scope = this.scopes.getStore();
    const run = scope?.run ?? this.current;
    if (!run) return task();
    const span = this.observe(() => { const span = run.span({ ...data, phase }, scope?.span); run.emit('host.start', span.data, span); return span; });
    if (!span) return task();
    try {
      const result = await this.scopes.run({ run, span, phase }, task);
      this.observe(() => run.emit('host.end', { ...span.data, outcome: 'completed', duration_ms: performance.now() - span.started }, span));
      return result;
    } catch (error) {
      this.observe(() => run.emit('host.end', { ...span.data, outcome: 'error', duration_ms: performance.now() - span.started, error: safeError(error) }, span));
      throw error;
    }
  }

  async operation<T>(name: string, task: () => Promise<T>, data: TraceData = {}): Promise<T> {
    const scope = this.scopes.getStore();
    const run = scope?.run ?? this.current;
    if (!run) return task();
    const span = this.observe(() => { const span = run.span({ ...data, name }, scope?.span); run.emit('operation.start', span.data, span); return span; });
    if (!span) return task();
    try {
      const result = await this.scopes.run({ run, span, phase: scope?.phase ?? 'preflight' }, task);
      this.observe(() => run.emit('operation.end', { ...span.data, duration_ms: performance.now() - span.started, outcome: 'completed' }, span));
      return result;
    } catch (error) {
      this.observe(() => run.emit('operation.end', { ...span.data, duration_ms: performance.now() - span.started, outcome: 'error', error: safeError(error) }, span));
      throw error;
    }
  }

  async mcp<T>(name: string, args: TraceData, task: () => Promise<T>, accountId?: number, diagnostics = false): Promise<T> {
    const scope = this.scopes.getStore();
    const run = scope?.run ?? this.current;
    if (!run) return task();
    const phase = scope?.phase ?? 'query';
    const span = this.observe(() => run.mcpStart(name, args, phase, scope?.span, accountId, diagnostics));
    if (!span) return task();
    try {
      const value = await this.scopes.run({ run, span, phase }, task);
      this.observe(() => run.mcpEnd(span, value));
      return value;
    } catch (error) { this.observe(() => run.mcpEnd(span, undefined, error)); throw error; }
  }

  mcpDiagnostic(event: 'initializing' | 'initialized' | 'dispatch'): void {
    const scope = this.scopes.getStore();
    if (!scope) return;
    if (event === 'dispatch') scope.span.data.rpc_attempted = true;
    scope.run.emit(`mcp.${event}`, {}, scope.span);
  }

  record(event: string, value: unknown): void {
    this.observe(() => this.recordOnce(event, value));
  }

  private recordOnce(event: string, value: unknown): void {
    const scope = this.scopes.getStore();
    const run = scope?.run ?? this.current;
    if (run) {
      const data = traceRecord(value);
      run.emit(event, { ...Object.fromEntries(['phase', 'state', 'tool', 'toolCallId', 'accountId', 'step', 'count', 'duration_ms', 'outcome', 'level', 'source', 'provider', 'model', 'required', 'reason']
        .filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])), record_ref: run.payload(value) }, scope?.span);
    }
  }

  async settle(ctx: ExtensionContext): Promise<void> {
    this.stopWatching?.(); this.stopWatching = undefined;
    const run = this.current;
    this.current = undefined;
    if (run) { await run.finish(ctx.sessionManager.getLeafId()); this.runs.delete(run); }
  }

  async shutdown(ctx: ExtensionContext): Promise<void> {
    this.stopWatching?.(); this.stopWatching = undefined;
    this.current = undefined;
    this.pendingInputs.length = 0;
    await Promise.all([...this.runs].map(run => run.finish(ctx.sessionManager.getLeafId(), 'incomplete')));
    this.runs.clear();
  }
}

export function traceModel(ctx: ExtensionContext): TraceData {
  return ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, api: ctx.model.api } : {};
}
