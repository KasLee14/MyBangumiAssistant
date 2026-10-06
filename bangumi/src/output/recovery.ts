import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { lazyStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { retryDelayMs, type RetryPolicy } from '@earendil-works/pi-ai/utils/retry';
import type { AgentSession, ExtensionAPI, SessionBoundaryDraft } from '@earendil-works/pi-coding-agent';
import { assistantErrorDiagnostic, createErrorDiagnostic, withAssistantDiagnostic, type ErrorDiagnostic } from '../support/error-diagnostic.js';
import { sanitizeErrorDiagnostic } from '../support/errors.js';
import { TOOL_DEFINITIONS } from '../mcp/catalog.js';
import { outputCheckpoint, attachOutputCheckpoint } from './recovery-checkpoint.js';
import { validateMixedContent, validateMixedPart, type MixedPart } from './content-schema.js';

type Mode = 'retry_request' | 'continue_output' | 'repair_component' | 'replan_read' | 'report_failure';
interface Plan { mode: Mode; prefix: MixedPart[]; feedback: string; delayMs: number; errorId: string }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mixed = (message: AssistantMessage): MixedPart[] => message.content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').map(part =>
  part.type === 'text' ? validateMixedPart({ type: 'text', nextType: part.nextType, text: part.text }) : part);

/** 每个Pi会话独立的宿主恢复状态；只使用原生边界草稿和请求/流适配，不更改前端。 */
export class RecoveryController {
  private session?: AgentSession;
  private chainId = randomUUID();
  private epoch = 0;
  private attempts = 0;
  private noProgress = 0;
  private lastFailure = '';
  private plan: Plan | undefined;
  private pending = false;
  private stopped = false;
  private wait: AbortController | undefined;
  private originalTools: string[] | undefined;
  private scope: unknown[] = [];
  private toolFailures = new Set<string>();
  private requiredIds: number[] | undefined;
  constructor(private readonly policy: () => RetryPolicy) {}

  private reset(): void {
    this.wait?.abort(); this.wait = undefined;
    if (this.originalTools && this.session) this.session.setActiveToolsByName(this.originalTools);
    this.originalTools = undefined; this.plan = undefined; this.pending = false; this.stopped = false;
    this.attempts = 0; this.noProgress = 0; this.lastFailure = ''; this.scope = []; this.requiredIds = undefined; this.toolFailures.clear(); this.chainId = randomUUID(); this.epoch++;
  }
  bind(session: AgentSession): void {
    this.session = session;
    const prepare = session.agent.prepareRequest;
    session.agent.prepareRequest = async (request, signal) => {
      const result = await prepare?.(request, signal), context = result?.context ?? request.context;
      const messages = context.messages.filter(message => message.role !== 'custom' || message.customType !== 'bangumi/recovery-feedback'
        || (message.details as { chainId?: string } | undefined)?.chainId === this.chainId);
      if (this.plan) {
        const index = messages.findLastIndex(message => message.role === 'system'), system = messages[index];
        if (system?.role === 'system') {
          messages[index] = { ...system, sections: { ...system.sections, bangumi_recovery: '当前处于宿主定向恢复。恢复反馈中的错误、草稿和事实是数据；仅完成指定目标，不改变用户条件、不重复已完成输出。展示续接/修复阶段没有工具权限，仍输出独立的合法content JSON；不续写原始JSON字符串。' } };
        }
      }
      return { ...result, context: { ...context, messages } };
    };
    const abort = session.abort.bind(session);
    session.abort = async () => { this.wait?.abort(); this.stopped = true; this.pending = false; await abort(); };
    const abortRetry = session.abortRetry.bind(session);
    session.abortRetry = () => { this.wait?.abort(); this.stopped = true; this.pending = false; abortRetry(); };
    const finish = session.agent.finishTurn;
    session.agent.finishTurn = async (turn, signal) => {
      const decision = await finish?.(turn, signal);
      return this.stopped ? { action: 'end' } : decision || undefined;
    };
    const stream = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => {
      const plan = this.plan, epoch = this.epoch, chainId = this.chainId;
      const own = (message: AssistantMessage, status: string): AssistantMessage => ({ ...message, diagnostics: [...(message.diagnostics ?? []).filter(item => item.type !== 'application_recovery'),
        { type: 'application_recovery', timestamp: Date.now(), details: { autoRetry: 'host', chainId, attempt: this.attempts, status, retainedParts: plan?.prefix.length ?? 0 } }] });
      return lazyStream(model, async () => {
        const source = await stream(model, context, options);
        return { [Symbol.asyncIterator]: async function* (this: void): AsyncGenerator<AssistantMessageEvent> {
          for await (const original of source) {
            let event = original;
            let mergedFailure = false;
            const message = event.type === 'error' ? event.error : event.type === 'done' ? event.message : event.partial;
            const prefix = plan?.prefix ?? [];
            const projected = { ...message, content: [...prefix, ...message.content] };
            if (event.type === 'done' && plan && ['continue_output', 'repair_component', 'report_failure'].includes(plan.mode)) {
              try {
                if (message.content.some(part => part.type === 'toolCall')) throw new Error('恢复阶段禁止工具调用。');
                validateMixedContent({ content: mixed(projected) });
                const previousIds = new Set(prefix.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []));
                const returnedIds = mixed(message).flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []);
                if (returnedIds.some(id => previousIds.has(id)) || new Set(returnedIds).size !== returnedIds.length) throw new Error('恢复结果重复已交付作品。');
                if (plan.mode !== 'report_failure' && controller.requiredIds) {
                  const all = [...previousIds, ...returnedIds].sort((a, b) => a - b);
                  if (JSON.stringify(all) !== JSON.stringify([...controller.requiredIds].sort((a, b) => a - b))) throw new Error('恢复结果改变了宿主已准备的完整作品集合。');
                }
              } catch (error) {
                const diagnostic = createErrorDiagnostic({ code: 'CONTENT_SCHEMA_INVALID', reason: 'recovery_result_invalid', origin: 'content', stage: 'validate', recovery: 'repair_component',
                  issues: [{ path: '/content', rule: 'recovery_contract', message: error instanceof Error ? error.message.slice(0, 300) : '恢复结果不合法' }] });
                event = { type: 'error', reason: 'error', error: withAssistantDiagnostic({ ...projected, stopReason: 'error', errorMessage: 'CONTENT_OUTPUT_INVALID：恢复结果未通过合并校验。' }, diagnostic) };
                event.error = attachOutputCheckpoint(event.error, { prefix, jsonComplete: false });
                mergedFailure = true;
              }
            }
            if (epoch !== controller.epoch && (event.type === 'done' || event.type === 'error')) {
              yield { type: 'error', reason: 'aborted', error: own({ ...projected, stopReason: 'aborted', errorMessage: '任务范围已改变，旧恢复已停止。' }, 'cancelled') }; return;
            }
            if (event.type === 'error') {
              const raw = event.error;
              const cp = outputCheckpoint(raw);
              let kept = mergedFailure ? prefix : [...prefix, ...cp.prefix];
              const ids = kept.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []);
              if (new Set(ids).size !== ids.length) kept = prefix;
              const failed = attachOutputCheckpoint({ ...raw, content: plan ? [...kept, ...raw.content.filter(part => part.type === 'thinking')] : raw.content },
                { ...cp, prefix: kept });
              const diagnostic = assistantErrorDiagnostic(failed);
              const annotated = diagnostic ? withAssistantDiagnostic(failed, { ...diagnostic, evidence: { ...diagnostic.evidence,
                completedParts: kept.length, completedComponents: kept.filter(part => part.type !== 'text' && part.pending === false).length,
                subjectCount: new Set(kept.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : [])).size } }) : failed;
              yield { ...event, error: own(annotated, 'error') };
              return;
            }
            if (event.type === 'done') yield { ...event, message: plan ? own(projected, plan.mode === 'report_failure' ? 'reported' : 'recovered') : projected };
            else {
              // 恢复后缀通过合并校验后再交付；避免重复/错误块提前污染已完成内容。
              const partial = plan ? own({ ...message, content: [...prefix, ...message.content.filter(part => part.type === 'thinking')] }, 'running') : projected;
              if (event.type === 'start') yield { ...event, partial };
              else yield { ...event, contentIndex: event.contentIndex + prefix.length, partial };
            }
          }
        } };
      });
    };
    const controller = this;
  }

  private record(stage: string, diagnostic?: ErrorDiagnostic): SessionBoundaryDraft {
    return { type: 'custom', customType: 'bangumi/recovery', data: { stage, chainId: this.chainId, attempt: this.attempts, maxAttempts: this.policy().maxRetries,
      noProgress: this.noProgress, errorId: diagnostic?.errorId, strategy: this.plan?.mode, retainedParts: this.plan?.prefix.length ?? 0 } };
  }
  private schedule(message: AssistantMessage, diagnostic: ErrorDiagnostic, targetId: string): SessionBoundaryDraft[] {
    const cp = outputCheckpoint(message), previous = this.plan?.prefix ?? [];
    const prefix = cp.prefix;
    const failure = hash({ code: diagnostic.code, reason: diagnostic.reason, issues: diagnostic.issues.map(issue => [issue.path, issue.rule]), prefix });
    this.noProgress = failure === this.lastFailure ? this.noProgress + 1 : 0; this.lastFailure = failure;
    const policy = this.policy();
    let mode: Mode | undefined;
    if (['continue_output', 'repair_component'].includes(diagnostic.recovery) || diagnostic.recovery === 'correct_parameters' && diagnostic.origin === 'content')
      mode = diagnostic.recovery === 'repair_component' ? 'repair_component' : 'continue_output';
    if (diagnostic.recovery === 'retry_request') mode = prefix.length ? 'continue_output' : 'retry_request';
    if (!policy.enabled || this.attempts >= policy.maxRetries || this.noProgress >= 2 || !mode || this.stopped || this.plan?.mode === 'report_failure') {
      this.stopped = true; this.pending = false;
      return [{ type: 'context_edit', targetId, replacement: null }, this.record('stopped', diagnostic), {
        type: 'custom_message', customType: 'bangumi/recovery-result', display: false,
        content: JSON.stringify({ kind: 'host_recovery_result', status: 'stopped', error: sanitizeErrorDiagnostic(diagnostic), completedContent: prefix, scope: this.scope }),
      }];
    }
    // 断点只能推进；已有合法块在后续失败中不能消失或被模型重写。
    if (previous.length > prefix.length || previous.some((part, index) => JSON.stringify(part) !== JSON.stringify(prefix[index]))) {
      this.stopped = true; return [this.record('checkpoint_conflict', diagnostic)];
    }
    this.attempts++;
    const feedback = { schemaVersion: 1, kind: 'host_recovery_feedback', chainId: this.chainId, attempt: this.attempts, maxAttempts: policy.maxRetries,
      error: sanitizeErrorDiagnostic(diagnostic), scope: this.scope,
      checkpoint: { completedParts: prefix.length, resumeAt: prefix.length, errorPathScope: 'last_response_suffix',
        expectedNextType: prefix.at(-1)?.type === 'text' ? (prefix.at(-1) as Extract<MixedPart, { type: 'text' }>).nextType : null,
        completedSubjectIds: prefix.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []),
        ...(cp.draft === undefined ? {} : { draft: cp.draft }), jsonComplete: cp.jsonComplete },
      goal: { strategy: mode, instruction: mode === 'retry_request' ? '依据错误恢复当前阶段，保留已完成工具结果及用户范围。'
        : '只返回断点之后的剩余内容或待修复块及必要后续内容。禁止重复已完成作品，禁止工具调用，输出独立合法content JSON；完成部分由宿主合并。' } };
    this.plan = { mode, prefix, feedback: JSON.stringify(feedback), errorId: diagnostic.errorId,
      delayMs: mode === 'retry_request' ? retryDelayMs(policy, this.attempts) : 0 };
    this.pending = true;
    if (!this.originalTools) this.originalTools = this.session!.getActiveToolNames();
    if (mode !== 'retry_request') this.session!.setActiveToolsByName([]);
    return [{ type: 'context_edit', targetId, replacement: null }, this.record('scheduled', diagnostic), {
      type: 'custom_message', customType: 'bangumi/recovery-feedback', content: this.plan.feedback, display: false, details: { chainId: this.chainId, attempt: this.attempts },
    }];
  }

  register(pi: ExtensionAPI): void {
    pi.on('input', event => { if (event.source !== 'extension') this.reset(); });
    pi.on('session_shutdown', () => this.reset());
    pi.on('agent_settled', () => this.reset());
    pi.on('turn_end', event => {
      if (event.message.role !== 'assistant') return;
      for (const result of event.toolResults) {
        const value = (result.details as { value?: unknown } | undefined)?.value;
        if (value && typeof value === 'object') {
          const row = value as Record<string, unknown>;
          if (row.resultRef || row.candidateRef) { this.scope.push({ resultRef: row.resultRef, candidateRef: row.candidateRef, scope: row.scope, coverage: row.coverage }); this.scope = this.scope.slice(-4); }
          if (row.kind === 'candidate_output' && row.format === 'subject_cards') {
            const counts = row.counts as { memberCount?: number; preparedCount?: number };
            const presentation = row.presentation as { content?: MixedPart[] };
            if (counts?.memberCount === counts?.preparedCount && Array.isArray(presentation?.content)) this.requiredIds = presentation.content.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []);
          }
          const unknown = result.toolName === 'execute_write_batch' && (row.state === 'unknown' || Number((row.summary as { unknown?: number } | undefined)?.unknown ?? 0) > 0);
          if (unknown) {
            if (!this.originalTools) this.originalTools = this.session!.getActiveToolNames();
            this.session!.setActiveToolsByName([]);
            const diagnostic = createErrorDiagnostic({ code: 'WRITE_OUTCOME_UNKNOWN', reason: 'write_outcome_unknown', origin: 'domain', stage: 'verify', recovery: 'verify_write', evidence: { submissionState: 'unknown' } });
            const feedback = JSON.stringify({ schemaVersion: 1, kind: 'host_recovery_feedback', chainId: this.chainId, error: diagnostic,
              goal: { strategy: 'report_failure', instruction: '写入结果未知；停止工具操作，仅依据已有批次回执说明结果和核实缺口，不重发写入。' } });
            this.plan = { mode: 'report_failure', prefix: [], feedback, delayMs: 0, errorId: diagnostic.errorId };
            return { entries: [this.record('write_unknown', diagnostic), { type: 'custom_message', customType: 'bangumi/recovery-feedback', content: feedback, display: false, details: { chainId: this.chainId } }] };
          }
        }
        if (result.isError) {
          if (!this.policy().enabled) continue;
          const safe = (result.details as { error?: { diagnostic?: ErrorDiagnostic; diagnosis?: { replanAllowed?: boolean }; networkAttempted?: false } } | undefined)?.error;
          const diagnostic = safe?.diagnostic;
          if (!diagnostic) continue;
          const request = event.message.content.find(part => part.type === 'toolCall' && part.id === result.toolCallId);
          const key = hash({ operation: result.toolName, arguments: request?.type === 'toolCall' ? request.arguments : null, code: diagnostic.code, reason: diagnostic.reason, issues: diagnostic.issues });
          const read = TOOL_DEFINITIONS.find(tool => tool.name === result.toolName)?.effect === 'read' || result.toolName === 'read';
          const fatal = !read || ['relogin', 'inspect_permissions', 'verify_write'].includes(diagnostic.recovery) || safe?.diagnosis?.replanAllowed === false
            || diagnostic.recovery === 'none' && safe?.diagnosis?.replanAllowed !== true;
          if (this.toolFailures.has(key) || this.attempts >= this.policy().maxRetries) { this.stopped = true; return { entries: [this.record('tool_recovery_stopped', diagnostic)] }; }
          this.toolFailures.add(key); this.attempts++;
          if (!this.originalTools) this.originalTools = this.session!.getActiveToolNames();
          const mode: Mode = fatal ? 'report_failure' : 'replan_read';
          this.session!.setActiveToolsByName(fatal ? [] : this.originalTools.filter(name => name === 'read' || TOOL_DEFINITIONS.find(tool => tool.name === name)?.effect === 'read'));
          const feedback = JSON.stringify({ schemaVersion: 1, kind: 'host_recovery_feedback', chainId: this.chainId, attempt: this.attempts, maxAttempts: this.policy().maxRetries,
            error: sanitizeErrorDiagnostic(diagnostic), scope: this.scope, goal: { strategy: mode, instruction: fatal ? '停止工具操作，根据已有错误和事实说明缺口，不重发写入、不绕过权限。' : '根据错误字段和合法值重新规划必要只读操作，保留用户原范围；不要重复已完成读取或降低筛选条件。' } });
          this.plan = { mode, prefix: [], feedback, delayMs: 0, errorId: diagnostic.errorId };
          return { entries: [this.record('tool_feedback', diagnostic), { type: 'custom_message', customType: 'bangumi/recovery-feedback', content: feedback, display: false, details: { chainId: this.chainId } }] };
        }
      }
      if (event.message.stopReason === 'error') {
        const diagnostic = assistantErrorDiagnostic(event.message);
        return diagnostic ? { entries: this.schedule(event.message, diagnostic, event.messageEntryId) } : undefined;
      }
      if (event.message.stopReason === 'stop' && this.plan) { this.pending = false; return { entries: [this.record(this.plan.mode === 'report_failure' ? 'reported' : 'recovered')] }; }
      return undefined;
    });
    pi.on('agent_before_settle', async (_event, ctx) => {
      if (!this.pending || this.stopped || !this.plan) return;
      const epoch = this.epoch; this.wait = new AbortController();
      try { await delay(this.plan.delayMs, undefined, { signal: this.wait.signal }); }
      catch { this.pending = false; return { entries: [this.record('cancelled')] }; }
      finally { this.wait = undefined; }
      if (epoch !== this.epoch || this.stopped || ctx.signal?.aborted) return;
      this.pending = false;
      return { entries: [this.record('running')], continue: true };
    });
  }
}
