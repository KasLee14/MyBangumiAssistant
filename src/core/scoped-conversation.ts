import type { LanguageModel, Message, ToolRegistry } from './types.js';
import type { ReadAgent } from './agent.js';
import type { SessionLog } from '../storage/session.js';
import { AppError, credentialValues, redact } from '../domain/errors.js';
import { BOUNDARY_UNAVAILABLE, SCOPE_CLARIFICATION, scopeReply, capabilityReply, type BoundaryRecord, type ScopeDecision } from '../domain/task-scope.js';
import { TaskBoundary, scopeHistory } from './task-boundary.js';
import type { TurnObserver } from './events.js';

interface HostDialogue {
  canHandle(input: string, history: readonly Message[]): boolean;
  handle(input: string, history: readonly Message[], signal: AbortSignal): Promise<Message[] | null>;
  resetRequests(): void;
  selectionContinuation?(input: string, history: readonly Message[]): boolean;
}
interface ScopeTools extends ToolRegistry { scopeContext(): unknown }
export interface ScopedResult { messages: Message[]; boundary: BoundaryRecord }

/** 核心依赖交互接口，不依赖终端或具体账户适配。 */
export class ScopedConversation {
  private readonly boundary: TaskBoundary;
  constructor(model: LanguageModel, private readonly agent: ReadAgent, private readonly tools: ScopeTools,
    private readonly host: HostDialogue, private readonly log: SessionLog) { this.boundary = new TaskBoundary(model); }

  async run(input: string, history: readonly Message[], options: TurnObserver & {
    signal: AbortSignal; onText?: (text: string) => void; onTool?: (name: string) => void;
  }): Promise<ScopedResult> {
    if (!input.trim() || input.length > 8000) throw new AppError('INVALID_INPUT', '输入须为1～8000字。');
    input = redact(input, credentialValues()); options.signal.throwIfAborted();
    const safeHistory = scopeHistory(history);
    if (this.host.selectionContinuation?.(input, safeHistory)) {
      const boundary: BoundaryRecord = { code: 'IN_SCOPE', modelInput: input };
      const messages = await this.agent.run(input, history, { ...options, boundary,
        toolContext: `${this.tools.context?.() ?? ''}\n用户已经回答作品选择问题。立即继续历史中宿主放行的原任务，不要只回复已选择，也不要让用户重复问题。选择本身不授予修改权限。` });
      return { messages, boundary };
    }
    // 完整匹配的宿主交互保留原有确定性权限、消歧和补全。
    if (this.host.canHandle(input, safeHistory)) {
      const handled = await this.host.handle(input, safeHistory, options.signal);
      if (!handled) throw new AppError('INTERNAL_ERROR', '宿主交互未完成。');
      const messages = [...history, ...handled.slice(safeHistory.length)];
      options.onText?.(messages.at(-1)?.content ?? '');
      return { messages, boundary: { code: 'IN_SCOPE', modelInput: input } };
    }
    const lastUser = [...history].reverse().find(message => message.role === 'user');
    const lastAssistant = [...history].reverse().find(message => message.role === 'assistant');
    let decision: ScopeDecision;
    try {
      decision = await this.boundary.classify(input, {
        dialogue: this.tools.scopeContext(), previousInput: lastUser?.content?.slice(0, 500) ?? null,
        previousReply: lastAssistant?.content?.slice(0, 400) ?? null,
        previousBoundary: lastAssistant?.role === 'assistant' ? lastAssistant.boundary?.code ?? null : null,
      }, this.tools.schemas(), options.signal, () => options.onEvent?.({ type: 'model/start', stage: 'scope' }));
    } catch {
      this.host.resetRequests();
      options.signal.throwIfAborted();
      return this.reply(input, history, BOUNDARY_UNAVAILABLE, { code: 'BOUNDARY_UNAVAILABLE', modelInput: null }, options);
    }
    if (decision.kind !== 'in_scope' && decision.kind !== 'mixed') {
      this.host.resetRequests();
      const boundary: BoundaryRecord = { code: decision.kind === 'out_of_scope' ? 'OUT_OF_SCOPE'
        : decision.kind === 'unsupported' ? 'UNSUPPORTED_CAPABILITY' : 'CLARIFICATION_REQUIRED', modelInput: null };
      return this.reply(input, history, decision.kind === 'out_of_scope' ? scopeReply(decision.reason)
        : decision.kind === 'unsupported' ? capabilityReply(decision.reason) : SCOPE_CLARIFICATION, boundary, options);
    }
    const boundary: BoundaryRecord = { code: decision.kind === 'mixed' ? 'MIXED_SCOPE' : 'IN_SCOPE',
      modelInput: decision.kind === 'mixed' ? decision.allowedParts.join('；') : input };
    const mixed = decision.kind === 'mixed';
    // 日志及工具权限持有原文，模型只收到可处理片段；片段不能产生直接授权。
    const messages = await this.agent.run(input, history, { ...options, boundary, modelInput: boundary.modelInput!,
      ...(mixed ? { answerPrefix: (['missing_capability', 'missing_history', 'unsupported_progress', 'collection_deletion'].includes(decision.reason) ? capabilityReply(decision.reason) : scopeReply(decision.reason)) + '\n\n下面只处理可独立完成的部分。\n',
        toolContext: '混合请求只处理已放行片段。分类器片段不构成授权；写入必须依据宿主持有的完整真实原文，不得猜测或改写 sourceText。' } : {}) });
    return { messages, boundary };
  }

  private async reply(input: string, history: readonly Message[], content: string, boundary: BoundaryRecord,
    options: { signal: AbortSignal; onText?: (text: string) => void }): Promise<ScopedResult> {
    options.signal.throwIfAborted();
    await this.log.append('turn/start', {});
    let completed = false;
    try {
      const user: Message = { role: 'user', content: input };
      const assistant: Message = { role: 'assistant', content, boundary };
      await this.log.append('message', user);
      await this.log.append('scope/decision', { code: boundary.code });
      options.signal.throwIfAborted();
      await this.log.append('message', assistant);
      await this.log.append('turn/end', { status: 'completed' }); completed = true;
      options.onText?.(content);
      return { messages: [...history, user, assistant], boundary };
    } finally { if (!completed) await this.log.append('turn/end', { status: options.signal.aborted ? 'cancelled' : 'failed' }); }
  }
}
