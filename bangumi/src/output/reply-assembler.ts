import { randomUUID } from 'node:crypto';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { deriveNextTypes, contentFingerprint } from './content-normalize.js';
import { validateMixedContent, type MixedPart } from './content-schema.js';
import { AppError } from '../support/errors.js';

export const PRESENTATION_ENTRY_TYPE = 'bangumi/presentation';
export const PRESENTATION_MESSAGE_MARKER = 'bangumi_presentation_source';
export interface PresentationSnapshot {
  version: 1; replyId: string; turnId: string; status: 'open' | 'completed' | 'error' | 'aborted'; content: MixedPart[];
}
/** 同一真实用户回合只有一个正文，完成块是不可覆盖的前缀。 */
export class ReplyAssembler {
  private state?: PresentationSnapshot;
  private operations = new Map<string, string>();
  private published = new Map<string, number>();
  private failures = new Map<string, number>();
  private recoveryBudget = (): number => 2;
  private started = false;
  private unchangedOperations = 0;
  private exhausted = false;
  private completionIntent: { operationId: string; turnId: string } | undefined;
  constructor(private readonly persist: (snapshot: PresentationSnapshot) => void) {}
  begin(turnId: string): void {
    if (this.state?.status === 'open') this.finish('aborted');
    this.operations.clear(); this.published.clear(); this.failures.clear(); this.started = false; this.unchangedOperations = 0; this.exhausted = false;
    this.completionIntent = undefined;
    this.state = { version: 1, replyId: randomUUID(), turnId, status: 'open', content: [] };
  }
  snapshot(): PresentationSnapshot | undefined { return this.state && structuredClone(this.state); }
  get active(): boolean { return this.state?.status === 'open'; }
  setRecoveryBudget(budget: () => number): void { this.recoveryBudget = budget; }
  get recoveryExhausted(): boolean {
    this.exhausted ||= [...this.failures.values()].reduce((total, count) => total + count, 0) + this.unchangedOperations > this.recoveryBudget();
    return this.exhausted;
  }
  fail(toolName: string): void { this.failures.set(toolName, (this.failures.get(toolName) ?? 0) + 1); }
  append(part: MixedPart, operationId: string, semanticKey?: string, signal?: AbortSignal): { replyId: string; blockIndex: number; reused: boolean } {
    return this.appendMany([part], operationId, semanticKey, signal);
  }
  /** 全段先验证，失败不发布before、组件或after的任何子块。 */
  appendMany(parts: readonly MixedPart[], operationId: string, semanticKey?: string, signal?: AbortSignal): { replyId: string; blockIndex: number; reused: boolean } {
    if (signal?.aborted) throw new AppError('USER_CANCELLED', '正文发布已取消。');
    if (!this.state || !this.active) throw new AppError('RESOURCE_SCOPE_MISMATCH', '正文发布不属于活动用户回合。');
    this.started = true;
    const digest = contentFingerprint(parts);
    const previous = this.operations.get(operationId);
    if (previous && previous !== digest) throw new AppError('PRESENTATION_OPERATION_CONFLICT', '同一发布操作不能改变已完成正文。');
    const key = semanticKey ?? digest;
    const reused = previous !== undefined || this.published.has(key) || this.published.has(`content:${digest}`);
    if (!reused) {
      if (parts.length > 1 && parts.some(part => part.type !== 'text' && this.published.has(`content:${contentFingerprint([part])}`)))
        throw new AppError('PRESENTATION_OPERATION_CONFLICT', '组件已经发布，不能用新文案重复追加；已完成前缀保留。');
      const content = deriveNextTypes([...this.state.content, ...parts]);
      validateMixedContent({ content });
      const start = this.state.content.length;
      this.state.content = content;
      this.published.set(key, start);
      this.published.set(`content:${digest}`, start);
      parts.forEach((part, index) => this.published.set(`content:${contentFingerprint([part])}`, start + index));
      this.persist(this.snapshot()!);
    }
    this.unchangedOperations = reused ? this.unchangedOperations + 1 : 0;
    this.operations.set(operationId, digest);
    return { replyId: this.state.replyId, blockIndex: this.published.get(key) ?? this.published.get(`content:${digest}`)!, reused };
  }
  requestCompletion(operationId: string): void {
    if (!this.state || !this.active || !this.operations.has(operationId)) throw new AppError('PRESENTATION_OPERATION_CONFLICT', '只能对成功原子发布的操作请求完成。');
    this.completionIntent = { operationId, turnId: this.state.turnId };
  }
  completionOperation(): string | undefined { return this.completionIntent?.turnId === this.state?.turnId ? this.completionIntent?.operationId : undefined; }
  discardCompletion(): void { this.completionIntent = undefined; }
  mark(message: AssistantMessage, owner = this.state): AssistantMessage {
    if (!owner) return message;
    if (owner.turnId === this.state?.turnId) this.started = true;
    return { ...message, diagnostics: [...(message.diagnostics ?? []).filter(value => value.type !== PRESENTATION_MESSAGE_MARKER), {
      type: PRESENTATION_MESSAGE_MARKER, timestamp: Date.now(), details: { replyId: owner.replyId, turnId: owner.turnId },
    }] };
  }
  finish(status: PresentationSnapshot['status'] = 'completed'): void {
    if (!this.state || !this.active) return;
    this.state.status = status;
    this.completionIntent = undefined;
    if (this.started) this.persist(this.snapshot()!);
  }
}
const contexts = new WeakMap<object, ReplyAssembler>();
export function bindReplyAssembler(context: TranscriptContext, assembler: ReplyAssembler): void { contexts.set(context, assembler); contexts.set(context.messages, assembler); }
export function replyAssemblerFor(context: TranscriptContext): ReplyAssembler | undefined { return contexts.get(context) ?? contexts.get(context.messages); }
export function isPresentationSource(message: { diagnostics?: { type: string }[] }): boolean { return message.diagnostics?.some(value => value.type === PRESENTATION_MESSAGE_MARKER) === true; }
