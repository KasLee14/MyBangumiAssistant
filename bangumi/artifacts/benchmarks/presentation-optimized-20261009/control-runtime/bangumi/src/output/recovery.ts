import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { lazyStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { retryDelayMs, type RetryPolicy } from '@earendil-works/pi-ai/utils/retry';
import type { AgentSession, ExtensionAPI, SessionBoundaryDraft } from '@earendil-works/pi-coding-agent';
import { assistantErrorDiagnostic, createErrorDiagnostic, withAssistantDiagnostic, type ErrorDiagnostic } from '../support/error-diagnostic.js';
import { safeError, sanitizeErrorDiagnostic } from '../support/errors.js';
import { diagnoseReadError } from '../mcp/read-recovery.js';
import { prepareModelToolArguments } from '../mcp/pi-tools.js';
import { TOOL_DEFINITIONS, validateToolArguments, findToolDefinition } from '../mcp/catalog.js';
import { schemaArguments } from '../support/tool-schema.js';
import { outputCheckpoint, attachOutputCheckpoint } from './recovery-checkpoint.js';
import { validateMixedContent, validateMixedPart, type MixedPart } from './content-schema.js';
import { deriveNextTypes, contentFingerprint } from './content-normalize.js';
import { projectContentForModel } from './model-context.js';
import { bindComponentCatalog, componentCatalogFor } from './component-catalog.js';
import { shouldUsePresentation } from './presentation-output.js';
import { isPresentationSource } from './reply-assembler.js';
import { PRESENTATION_SYSTEM_MARKER, PRESENTATION_TOOL_NAMES } from './presentation-contract.js';

type Mode = 'retry_request' | 'continue_output' | 'repair_component' | 'regenerate_output' | 'replan_read' | 'report_failure';
interface ResourceSource { tool: string; args: Record<string, unknown>; publicArgs: Record<string, unknown>; ids: number[]; components: Record<string, number[][]>; state?: Record<string, unknown> }
interface ReferenceRefresh { source: ResourceSource; kind: string; ids: number[]; readStarted?: boolean }
interface Plan { mode: Mode; prefix: MixedPart[]; feedback: string; delayMs: number; errorId: string; referenceRefresh?: ReferenceRefresh }
type Data = Record<string, unknown>;
const referenceIdentityKinds = new Set(['SubjectCards', 'Gallery', 'ProgressView']);
const contractTools = new Set(['read_component_index', 'read_component_spec']);
const presentationTools = new Set<string>([...contractTools, ...PRESENTATION_TOOL_NAMES]);
const correctablePresentationCodes = new Set(['INVALID_INPUT', 'COMPONENT_INDEX_REQUIRED', 'COMPONENT_NOT_DISCOVERED', 'COMPONENT_SPEC_REQUIRED',
  'PRESENTATION_REQUIRED', 'PRESENTATION_OPERATION_CONFLICT', 'PRESENTATION_LIMIT', 'CONTENT_SCHEMA_INVALID', 'CONTENT_LIMIT_EXCEEDED']);
function nativePresentationCorrection(name: string, details: unknown): boolean {
  if (!presentationTools.has(name)) return false;
  // prepareArguments失败只有原生工具错误文本；它没有旧通用恢复诊断，交给原生纠参。
  if (!record(details) || !record(details.error)) return true;
  if (correctablePresentationCodes.has(String(details.error.code))) return true;
  // 固定renderer的本地字段/容量校验可纠正；带缓存权限/业务cause的错误仍走既有保护。
  const diagnostic = record(details.error.diagnostic) ? details.error.diagnostic : undefined;
  const causes = Array.isArray(diagnostic?.causes) ? diagnostic.causes : [];
  return details.error.code === 'INTERNAL_ERROR' && causes.length === 1 && record(causes[0])
    && causes[0].name === 'ContentOutputError' && ['schema', 'size'].includes(String(causes[0].code));
}
const record = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
// 仅解包公开续查契约中的这一层；不递归搜寻远端对象中的任意result。
const resourceValue = (value: Data): Data => value.kind === 'candidate_continuation' && record(value.result) && value.result.kind === 'candidate_page' ? value.result : value;
function resourceState(value: Data): Data | undefined {
  if (!value.resultRef && !value.candidateRef) return undefined;
  return structuredClone(Object.fromEntries(['resultRef', 'candidateRef', 'scope', 'coverage'].filter(key => value[key] !== undefined).map(key => [key, value[key]])));
}
function presentationMembers(value: Data): Record<string, number[][]> {
  const presentation = record(value.presentation) ? value.presentation : undefined;
  const parts = Array.isArray(presentation?.content) ? presentation.content : presentation?.type ? [presentation] : [];
  const result: Record<string, number[][]> = {};
  for (const part of parts) {
    if (!record(part) || typeof part.type !== 'string' || !record(part.props)) continue;
    const rows = part.props.items ?? part.props.episodes;
    if (!Array.isArray(rows) || rows.some(item => !record(item) || !positiveId(item.id))) continue;
    (result[part.type] ??= []).push(rows.map(item => (item as { id: number }).id));
  }
  return result;
}
function referenceIds(draft: { type?: string; props?: { partIndex?: number; items?: Record<string, unknown>[] } }, source: ResourceSource): number[] | undefined {
  if (draft.props?.items) {
    const ids = draft.props.items.map(item => item.id ?? item.characterId ?? item.personId ?? item.episodeId ?? item.subjectId);
    return ids.every(positiveId) && new Set(ids).size === ids.length ? ids : undefined;
  }
  return source.components[draft.type ?? '']?.[draft.props?.partIndex ?? 0] ?? (source.ids.length ? source.ids : undefined);
}
function referenceFailureInstruction(reason: string, diagnostic?: ErrorDiagnostic): string {
  if (reason === 'resource_reference_access_denied') return '缓存引用的账户、权限或读取轮次绑定不匹配，停止所有工具操作。仅依据error中的具体错误说明展示限制，保留已完成部分，不重取数据、不绕过账户或NSFW范围。';
  if (reason === 'resource_reference_stage_incomplete' && diagnostic?.causes.some(cause => cause.code === 'CANDIDATE_REQUIRED_FACTS_MISSING'))
    return '候选卡片所需的必要展示事实尚未核实完整，停止本次展示恢复。用text仅依据error说明名称、媒体类型等必要字段缺口；不能根据展示字段缺失推断还有未处理候选，也不能声称展示已完成。保留已完成部分，不替换成员、不扩大查询范围。';
  if (reason === 'resource_reference_stage_incomplete') return '候选阶段尚未完成，停止本次展示恢复。用text明确原筛选范围仍有未处理或待核条目；只引用error及scope.coverage中已知的pendingCount、remainingCount和完整性，未知计数说明未知，不能将已核实部分声称为完整结果或任务已完成。保留已完成部分，不扩大查询范围。';
  if (reason === 'resource_reference_refresh_required') return '缓存引用已失效，当前失败组件不能由宿主可靠核验原来源、成员范围及顺序。停止工具操作，用text说明引用失效和展示缺口，保留已完成部分；不能替换成员、重搜全站或推断账户、权限发生变化。';
  return '缓存引用读取发生内部或传输故障，停止工具操作。用text依据error中的真实错误码和诊断说明展示失败及缺口，保留已完成部分；没有账户或权限错误证据时不得归因为账户或权限变化。';
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mixed = (message: AssistantMessage): MixedPart[] => message.content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').map(part =>
  part.type === 'text' ? validateMixedPart({ type: 'text', nextType: part.nextType, text: part.text }) : part);
const connect = (content: AssistantMessage['content']): AssistantMessage['content'] => {
  const visual = deriveNextTypes(content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall'));
  let index = 0;
  return content.map(part => {
    if (part.type === 'thinking' || part.type === 'toolCall') return part;
    const connected = visual[index++];
    return part.type === 'text' ? { ...part, nextType: connected?.type === 'text' ? connected.nextType ?? null : null } : part;
  });
};
/** 原生思考及其签名必须保持在本次assistant输出之前，宿主前缀不能变成缺COT的独立消息。 */
const prefixPosition = (content: AssistantMessage['content']): number => {
  const index = content.findIndex(part => part.type !== 'thinking');
  return index < 0 ? content.length : index;
};
const retainPrefix = (prefix: MixedPart[], content: AssistantMessage['content']): AssistantMessage['content'] => {
  const index = prefixPosition(content);
  return [...content.slice(0, index), ...prefix, ...content.slice(index)];
};

/** 每个Pi会话独立的宿主恢复状态；只使用原生边界草稿和请求/流适配，不更改前端。 */
export class RecoveryController {
  get remainingRecoveryAttempts(): number { const policy = this.policy(); return policy.enabled ? Math.max(0, policy.maxRetries - this.attempts) : 0; }
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
  private readonly resourceSources = new Map<string, ResourceSource>();
  constructor(private readonly policy: () => RetryPolicy) {}

  private reset(): void {
    this.wait?.abort(); this.wait = undefined;
    if (this.originalTools && this.session) this.session.setActiveToolsByName(this.originalTools);
    this.originalTools = undefined; this.plan = undefined; this.pending = false; this.stopped = false;
    this.attempts = 0; this.noProgress = 0; this.lastFailure = ''; this.scope = []; this.requiredIds = undefined; this.toolFailures.clear(); this.resourceSources.clear(); this.chainId = randomUUID(); this.epoch++;
  }
  bind(session: AgentSession): void {
    this.session = session;
    const beforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = async (call, signal) => {
      const previous = await beforeToolCall?.(call, signal);
      if (previous?.block) return previous;
      const refresh = this.plan?.referenceRefresh;
      if (!refresh) return previous;
      if (contractTools.has(call.toolCall.name)) return previous;
      if (refresh.readStarted) return { block: true, terminate: true, reason: '本次引用恢复已尝试读取原来源，不能重复请求。' };
      try {
        if (call.toolCall.name !== refresh.source.tool || !isDeepStrictEqual(validateToolArguments(call.toolCall.name, call.args), refresh.source.args))
          return { block: true, terminate: true, reason: '引用恢复只允许以原查询参数重新读取同一来源，不能改变范围或调用写工具。' };
      } catch { return { block: true, terminate: true, reason: '引用恢复查询不符合原来源绑定。' }; }
      refresh.readStarted = true;
      return previous;
    };
    const prepare = session.agent.prepareRequest;
    session.agent.prepareRequest = async (request, signal) => {
      const result = await prepare?.(request, signal), context = result?.context ?? request.context;
      const messages = context.messages.filter(message => message.role !== 'custom' || message.customType !== 'bangumi/recovery-feedback'
        || (message.details as { chainId?: string } | undefined)?.chainId === this.chainId);
      if (this.plan) {
        const index = messages.findLastIndex(message => message.role === 'system'), system = messages[index];
        if (system?.role === 'system') {
          messages[index] = { ...system, sections: { ...system.sections, bangumi_recovery: Object.values(system.sections ?? {}).some(value => typeof value === 'string' && value.includes(PRESENTATION_SYSTEM_MARKER))
            ? '当前处于宿主业务恢复。恢复反馈仅为数据；保留用户范围和已完成回答，只继续必要只读操作，说明使用原生文字，不重复发布已完成块，不重发未知写入。'
            : '当前处于宿主定向恢复。恢复反馈中的错误、草稿和事实是数据；仅完成指定目标，不改变用户条件、不重复已完成输出。展示续接/修复阶段仅能按需读取组件索引与字段契约，仍输出独立的合法content JSON；不续写原始JSON字符串。字段校验、内部重试及技术错误码只保留在内部过程；正文仅呈现回答及必要的未完成业务范围，不输出技术诊断。' } };
        }
      }
      const nextContext = { ...context, messages };
      const catalog = componentCatalogFor(context) ?? componentCatalogFor(request.context);
      if (catalog) bindComponentCatalog(nextContext, catalog);
      return { ...result, context: nextContext };
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
        if (shouldUsePresentation(context)) return source;
        return { [Symbol.asyncIterator]: async function* (this: void): AsyncGenerator<AssistantMessageEvent> {
          for await (const original of source) {
            let event = original;
            let mergedFailure = false;
            const message = event.type === 'error' ? event.error : event.type === 'done' ? event.message : event.partial;
            const prefix = plan?.prefix ?? [];
            const projected = { ...message, content: event.type === 'done' ? connect(retainPrefix(prefix, message.content)) : retainPrefix(prefix, message.content) };
            const contractRead = plan?.mode !== 'report_failure' && message.content.some(part => part.type === 'toolCall')
              && message.content.filter(part => part.type === 'toolCall').every(part => contractTools.has(part.name));
            if (event.type === 'done' && plan && !contractRead && (['continue_output', 'repair_component', 'regenerate_output', 'report_failure'].includes(plan.mode)
              || plan.referenceRefresh && !message.content.some(part => part.type === 'toolCall'))) {
              try {
                if (message.content.some(part => part.type === 'toolCall')) throw new Error('正文恢复阶段只能读取组件契约。');
                if (plan.mode === 'report_failure' && message.content.some(part => part.type !== 'text' && part.type !== 'thinking'))
                  throw new Error('展示失败报告仅允许text后缀，不能新增或替换组件；已完成组件由宿主保留。');
                if (plan.referenceRefresh && message.content.some(part => part.type !== 'text' && part.type !== 'thinking' && part.type !== plan.referenceRefresh!.kind))
                  throw new Error('引用恢复后缀只允许原目标组件及text，不能附加其他组件扩大成员范围。');
                validateMixedContent({ content: mixed(projected) });
                const delivered = new Set(prefix.map(part => hash(part.type === 'text' ? { type: part.type, text: part.text } : part)));
                if (mixed(message).some(part => (part.type !== 'text' || part.text.trim())
                  && delivered.has(hash(part.type === 'text' ? { type: part.type, text: part.text } : part))))
                  throw new Error('恢复结果重播已完成正文或组件。');
                const previousIds = new Set(prefix.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []));
                const returnedIds = mixed(message).flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []);
                if (returnedIds.some(id => previousIds.has(id)) || new Set(returnedIds).size !== returnedIds.length) throw new Error('恢复结果重复已交付作品。');
                if (plan.referenceRefresh && referenceIdentityKinds.has(plan.referenceRefresh.kind)) {
                  const targetIds = message.content.flatMap(part => {
                    if (part.type !== plan.referenceRefresh!.kind || part.type === 'text' || part.type === 'thinking' || part.type === 'toolCall') return [];
                    const props = part.props as { items?: { id: number }[]; episodes?: { id: number }[] };
                    return (props.items ?? props.episodes ?? []).map(item => item.id);
                  });
                  if (!isDeepStrictEqual(targetIds, plan.referenceRefresh.ids)) throw new Error('引用恢复改变了原成员范围或顺序。');
                }
                if (plan.mode !== 'report_failure' && controller.requiredIds) {
                  const all = [...previousIds, ...returnedIds];
                  if (!isDeepStrictEqual(all, controller.requiredIds)) throw new Error('恢复结果改变了宿主已准备的完整作品集合或顺序。');
                }
              } catch (error) {
                const diagnostic = createErrorDiagnostic({ code: 'CONTENT_SCHEMA_INVALID', reason: 'recovery_result_invalid', origin: 'content', stage: 'validate', recovery: 'repair_component',
                  issues: [{ path: '/content', rule: 'recovery_contract', message: error instanceof Error ? error.message.slice(0, 300) : '恢复结果不合法' }] });
                event = { type: 'error', reason: 'error', error: withAssistantDiagnostic({ ...projected, stopReason: 'error', errorMessage: 'CONTENT_OUTPUT_INVALID：恢复结果未通过合并校验。' }, diagnostic) };
                event.error = attachOutputCheckpoint(event.error, { prefix, jsonComplete: true, failureScope: 'host' });
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
              const failed = attachOutputCheckpoint({ ...raw, content: plan ? retainPrefix(kept, raw.content.filter(part => part.type === 'thinking')) : raw.content },
                { ...cp, prefix: kept, ...(cp.failedPartIndex === undefined ? {} : { failedPartIndex: mergedFailure ? cp.failedPartIndex : prefix.length + cp.failedPartIndex }) });
              const diagnostic = assistantErrorDiagnostic(failed);
              const annotated = diagnostic ? withAssistantDiagnostic(failed, { ...diagnostic, evidence: { ...diagnostic.evidence,
                completedParts: kept.length, completedComponents: kept.filter(part => part.type !== 'text' && part.pending === false).length,
                subjectCount: new Set(kept.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : [])).size } }) : failed;
              yield { ...event, error: own(annotated, 'error') };
              return;
            }
            if (event.type === 'done') yield { ...event, message: plan ? own(contractRead ? { ...message, content: retainPrefix(prefix, message.content.filter(part => part.type === 'thinking' || part.type === 'toolCall')) } : projected, contractRead ? 'running' : plan.mode === 'report_failure' ? 'reported' : 'recovered') : projected };
            else {
              // 恢复后缀通过合并校验后再交付；避免重复/错误块提前污染已完成内容。
              const partial = plan ? own({ ...message, content: retainPrefix(prefix, message.content.filter(part => part.type === 'thinking')) }, 'running') : projected;
              if (event.type === 'start') yield { ...event, partial };
              else yield { ...event, contentIndex: event.contentIndex < prefixPosition(message.content) ? event.contentIndex : event.contentIndex + prefix.length, partial };
            }
          }
        } };
      });
    };
    const controller = this;
  }

  private record(stage: string, diagnostic?: ErrorDiagnostic): SessionBoundaryDraft {
    return { type: 'custom', customType: 'bangumi/recovery', data: { stage, chainId: this.chainId, attempt: this.attempts, maxAttempts: this.policy().maxRetries,
      noProgress: this.noProgress, errorId: diagnostic?.errorId, ...(diagnostic ? { diagnostic: sanitizeErrorDiagnostic(diagnostic) } : {}), strategy: this.plan?.mode, retainedParts: this.plan?.prefix.length ?? 0 } };
  }
  private schedule(message: AssistantMessage, diagnostic: ErrorDiagnostic, targetId: string): SessionBoundaryDraft[] {
    const cp = outputCheckpoint(message), previous = this.plan?.prefix ?? [];
    const prefix = cp.prefix;
    const failure = hash({ code: diagnostic.code, reason: diagnostic.reason, issues: diagnostic.issues.map(issue => [issue.path, issue.rule]), prefix: contentFingerprint(prefix) });
    this.noProgress = failure === this.lastFailure ? this.noProgress + 1 : 0; this.lastFailure = failure;
    const policy = this.policy();
    let mode: Mode | undefined;
    let referenceRefresh: ReferenceRefresh | undefined;
    const draft = cp.draft as { type?: string; props?: { resourceRef?: string; partIndex?: number; items?: Record<string, unknown>[] } } | undefined;
    const source = draft?.props?.resourceRef ? this.resourceSources.get(draft.props.resourceRef) : undefined;
    if (['continue_output', 'repair_component'].includes(diagnostic.recovery) || diagnostic.recovery === 'correct_parameters' && diagnostic.origin === 'content')
      mode = diagnostic.recovery === 'repair_component' ? 'repair_component' : 'continue_output';
    if (diagnostic.recovery === 'retry_request') mode = prefix.length ? 'continue_output' : 'retry_request';
    if (cp.failureScope === 'envelope' && diagnostic.origin === 'content') mode = 'regenerate_output';
    // 供应商网络/限流错误优先使用原诊断的退避策略；空线路断点不能把它改成即时JSON续写。
    if (cp.failureScope === 'json' && mode && diagnostic.recovery !== 'retry_request') mode = 'continue_output';
    if (diagnostic.reason === 'empty_output') mode = 'regenerate_output';
    if (diagnostic.reason === 'resource_reference_refresh_required') {
      const ids = source && draft ? referenceIds(draft, source) : undefined;
      const identityVerifiable = referenceIdentityKinds.has(draft?.type ?? '');
      mode = source && ids && identityVerifiable ? 'replan_read' : 'report_failure';
      if (source && ids && identityVerifiable) {
        referenceRefresh = { source, kind: draft?.type ?? '', ids };
      }
    } else if (['resource_reference_stage_incomplete', 'resource_reference_access_denied', 'resource_reference_unavailable'].includes(diagnostic.reason)) mode = 'report_failure';
    // 同一引用恢复后的组件校验若失败，修复后缀也必须保留原成员锁，不能借普通repair_component换成员。
    else if (mode && mode !== 'report_failure' && this.plan?.referenceRefresh) referenceRefresh = this.plan.referenceRefresh;
    if (!policy.enabled || this.attempts >= policy.maxRetries || this.noProgress >= 2 || !mode || this.stopped || this.plan?.mode === 'report_failure') {
      this.stopped = true; this.pending = false;
      return [{ type: 'context_edit', targetId, replacement: null }, this.record('stopped', diagnostic), {
        type: 'custom_message', customType: 'bangumi/recovery-result', display: false,
        content: JSON.stringify({ kind: 'host_recovery_result', chainId: this.chainId, status: 'stopped', error: sanitizeErrorDiagnostic(diagnostic), completedContent: prefix, scope: this.scope }),
      }];
    }
    // 断点只能推进；已有合法块在后续失败中不能消失或被模型重写。
    if (previous.length > prefix.length || contentFingerprint(previous) !== contentFingerprint(prefix.slice(0, previous.length))) {
      this.stopped = true; return [this.record('checkpoint_conflict', diagnostic)];
    }
    this.attempts++;
    const feedback = { schemaVersion: 1, kind: 'host_recovery_feedback', chainId: this.chainId, attempt: this.attempts, maxAttempts: policy.maxRetries,
      error: sanitizeErrorDiagnostic(diagnostic), scope: source?.state ? [source.state] : this.scope,
      checkpoint: { completedParts: prefix.length, resumeAt: prefix.length, errorPathScope: 'last_response_suffix',
        failureScope: cp.failureScope ?? 'unknown', ...(cp.failedPartIndex === undefined ? {} : { failedPartIndex: cp.failedPartIndex }),
        completedSubjectIds: prefix.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : []),
        ...(cp.draft === undefined ? {} : { draft: projectContentForModel(cp.draft) }), jsonComplete: cp.jsonComplete },
      goal: { strategy: mode, instruction: mode === 'retry_request' ? '依据错误恢复当前阶段，保留已完成工具结果及用户范围。'
        : mode === 'replan_read' ? '缓存引用已失效。只能按referenceSource的原工具和原参数重新读取同一来源，取得新resourceRef后仅补未完成组件；保留原成员、顺序和用户条件，不调用写工具，不重复已完成前缀。'
        : mode === 'report_failure' ? referenceFailureInstruction(diagnostic.reason, diagnostic)
        : '只返回resumeAt位置的待修复块及必要后续内容，或尚未完成的后缀。若确实没有剩余内容，返回content空数组作为独立响应结束。禁止重复已完成作品，仅允许按需读取组件索引与字段契约，输出独立合法content JSON；完成部分由宿主合并并维护连接状态。' } };
    if (referenceRefresh) Object.assign(feedback, { referenceSource: { tool: referenceRefresh.source.tool, args: referenceRefresh.source.publicArgs, memberIds: referenceRefresh.ids } });
    this.plan = { mode, prefix, feedback: JSON.stringify(feedback), errorId: diagnostic.errorId,
      ...(referenceRefresh ? { referenceRefresh } : {}),
      delayMs: mode === 'retry_request' ? retryDelayMs(policy, this.attempts) : 0 };
    this.pending = true;
    if (!this.originalTools) this.originalTools = this.session!.getActiveToolNames();
    const availableContracts = this.session!.getAllTools().map(tool => tool.name).filter(name => contractTools.has(name));
    if (referenceRefresh && mode === 'replan_read') this.session!.setActiveToolsByName([referenceRefresh.source.tool, ...availableContracts]);
    else if (mode !== 'retry_request') this.session!.setActiveToolsByName(mode === 'report_failure' ? [] : availableContracts);
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
          const resource = resourceValue(row);
          const sourceCall = event.message.content.find(part => part.type === 'toolCall' && part.id === result.toolCallId);
          if (typeof row.resourceRef === 'string' && sourceCall?.type === 'toolCall' && result.toolName !== 'read_cached_resource'
            && TOOL_DEFINITIONS.find(tool => tool.name === result.toolName)?.effect === 'read') {
            const data = Array.isArray(resource.data) ? resource.data : [resource];
            const ids = data.flatMap(value => {
              if (!record(value)) return [];
              const target = value.character ?? value.person ?? value.episode ?? value.subject ?? value.target ?? value;
              return record(target) && positiveId(target.id) ? [target.id] : [];
            });
            const components = presentationMembers(resource), state = resourceState(resource);
            const definition = findToolDefinition(result.toolName);
            this.resourceSources.set(row.resourceRef, { tool: result.toolName, args: validateToolArguments(result.toolName, sourceCall.arguments),
              publicArgs: schemaArguments(definition.modelInputSchema ?? definition.inputSchema, sourceCall.arguments), ids, components,
              ...(state ? { state } : {}) });
          }
          const state = resourceState(resource);
          if (state) { this.scope.push(state); this.scope = this.scope.slice(-4); }
          if (row.kind === 'candidate_output' && row.format === 'subject_cards') {
            const counts = record(row.counts) ? row.counts : undefined;
            const ids = presentationMembers(row).SubjectCards?.flat(), page = record(row.page) ? row.page : undefined;
            this.requiredIds = undefined;
            // 全体成员只能由canonical已准备快照与一致计数证明；模型投影的scope/reasons并不代表全体。
            if (counts && typeof counts.memberCount === 'number' && Number.isSafeInteger(counts.memberCount) && counts.memberCount >= 0
              && counts.memberCount === counts.preparedCount && counts.remainingCount === 0 && ids
              && ids.length === counts.preparedCount && new Set(ids).size === ids.length
              && (!page || page.offset === 0 && page.complete === true && page.returnedCount === counts.memberCount)) this.requiredIds = ids;
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
          if (isPresentationSource(event.message) && this.plan?.mode !== 'report_failure' && !this.plan?.referenceRefresh
            && nativePresentationCorrection(result.toolName, result.details)) continue;
          if (this.plan?.referenceRefresh) {
            const { referenceRefresh: _refresh, ...previous } = this.plan;
            const diagnostic = (result.details as { error?: { diagnostic?: ErrorDiagnostic } } | undefined)?.error?.diagnostic;
            const feedback = JSON.stringify({ schemaVersion: 1, kind: 'host_recovery_feedback', chainId: this.chainId,
              ...(diagnostic ? { error: sanitizeErrorDiagnostic(diagnostic) } : {}), scope: this.scope,
              checkpoint: { completedParts: previous.prefix.length, resumeAt: previous.prefix.length },
              goal: { strategy: 'report_failure', instruction: '原来源重读未完成。停止所有工具，保留已完成组件，用text仅依据已有错误说明读取或展示缺口；没有账户或权限错误证据时不能推断账户或权限问题，不重发、不扩大查询范围，也不能声称任务已完成。' } });
            this.plan = { ...previous, mode: 'report_failure', feedback };
            this.session!.setActiveToolsByName([]); this.pending = true;
            return { entries: [this.record('reference_read_failed', diagnostic), { type: 'custom_message', customType: 'bangumi/recovery-feedback', content: feedback, display: false, details: { chainId: this.chainId } }] };
          }
          if (!this.policy().enabled) continue;
          let safe = (result.details as { error?: { diagnostic?: ErrorDiagnostic; diagnosis?: { replanAllowed?: boolean }; networkAttempted?: false } } | undefined)?.error;
          // Pi参数准备失败仅保留message。重新执行同一本地参数契约取诊断，不从错误文字或远端文本猜恢复。
          if (!safe && TOOL_DEFINITIONS.some(tool => tool.name === result.toolName)) {
            const call = event.message.content.find(part => part.type === 'toolCall' && part.id === result.toolCallId);
            if (call?.type === 'toolCall') try { prepareModelToolArguments(result.toolName, call.arguments, this.session?.model); }
            catch (error) { safe = safeError(diagnoseReadError(result.toolName, call.arguments, error)); }
          }
          const diagnostic = safe?.diagnostic;
          if (!diagnostic) continue;
          const request = event.message.content.find(part => part.type === 'toolCall' && part.id === result.toolCallId);
          const key = hash({ operation: result.toolName, arguments: request?.type === 'toolCall' ? request.arguments : null, code: diagnostic.code, reason: diagnostic.reason, issues: diagnostic.issues });
          const read = TOOL_DEFINITIONS.find(tool => tool.name === result.toolName)?.effect === 'read' || result.toolName === 'read';
          const fatal = !read || ['relogin', 'inspect_permissions', 'verify_write'].includes(diagnostic.recovery) || safe?.diagnosis?.replanAllowed === false
            || diagnostic.recovery === 'none' && safe?.diagnosis?.replanAllowed !== true;
          if (this.toolFailures.has(key) || this.attempts >= this.policy().maxRetries) {
            this.stopped = true;
            return { entries: [this.record('tool_recovery_stopped', diagnostic), {
              type: 'custom_message', customType: 'bangumi/recovery-result', display: false,
              content: JSON.stringify({ kind: 'host_recovery_result', chainId: this.chainId, status: 'stopped',
                error: sanitizeErrorDiagnostic(diagnostic), completedContent: this.plan?.prefix ?? [], scope: this.scope }),
            }] };
          }
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
      if (event.message.stopReason === 'error' && !isPresentationSource(event.message)) {
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
