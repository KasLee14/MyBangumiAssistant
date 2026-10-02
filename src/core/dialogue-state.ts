import { CandidateState } from './candidates.js';
import { mutationFrom, rateAnswer, looksLikeRateAnswer, selectionFrom, statusAnswer, type Mutation, type RequestDraft } from '../domain/dialogue-intent.js';
import type { DirectIntent } from '../domain/permissions.js';
import { AppError } from '../domain/errors.js';

export interface PendingRequest {
  draft: RequestDraft; subjectId: number | null; sources: string[]; direct: boolean;
  needsStatus: boolean;
  accountId: number | null;
}
/** 只存本次活跃会话的未完成请求；日志恢复不恢复写入请求和授权。 */
export class DialogueState {
  private pending: PendingRequest | null = null;
  constructor(private readonly candidates: CandidateState) {}
  snapshot(): PendingRequest | null { return structuredClone(this.pending); }
  clear(): void { this.pending = null; }
  canHandle(input: string): boolean {
    const draft = mutationFrom(input);
    const knownDraft = draft && (draft.reference.kind !== 'name' || this.candidates.hasName(draft.reference.name));
    return Boolean(knownDraft || selectionFrom(input) || this.candidates.hasName(input.trim())
      || this.pending?.draft.missing === 'rate' && looksLikeRateAnswer(input)
      || (this.pending?.draft.missing === 'status' || this.pending?.needsStatus) && statusAnswer(input) !== null);
  }
  consume(input: string): boolean {
    const answer = this.pending?.draft.missing === 'rate' ? rateAnswer(input) : null;
    const status = this.pending?.draft.missing === 'status' || this.pending?.needsStatus ? statusAnswer(input) : null;
    if (this.pending?.draft.missing === 'rate' && looksLikeRateAnswer(input) && answer === null) return true;
    if (this.pending && (answer !== null || status !== null)) {
      this.pending.sources.push(input);
      if (this.pending.needsStatus && status !== null) {
        const mutation = this.pending.draft.mutation;
        if (mutation?.kind === 'collection') { mutation.patch.status = status; this.pending.needsStatus = false; }
        // 进度请求先明确创建收藏，再重新读取和规划进度。
      } else {
        this.pending.draft.mutation = { kind: 'collection', patch: answer !== null ? { rate: answer } : { status: status! } };
        this.pending.draft.missing = null;
      }
      return true;
    }
    const draft = mutationFrom(input);
    if (draft) {
      this.pending = { draft, subjectId: this.subject(draft), sources: [input], direct: true, needsStatus: false, accountId: null };
      return true;
    }
    const ref = selectionFrom(input) ?? (this.candidates.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (ref) {
      const selected = this.candidates.resolve(ref, true);
      if (this.pending) {
        this.pending.subjectId = ref.kind === 'id' ? ref.id : selected?.id ?? null;
        this.pending.draft.reference = ref; this.pending.sources.push(input);
      }
      return true;
    }
    this.clear(); return false;
  }
  propose(draft: RequestDraft, source: string): void {
    // 模型解析只产生待确认提案，不能扩大真实用户已有的确定性请求。
    if (this.pending && !(this.pending.subjectId === null && this.pending.draft.reference.kind === 'name'
      && this.pending.sources.length === 1 && this.pending.sources[0] === source)) return;
    this.pending = { draft, subjectId: this.subject(draft), sources: [source], direct: false, needsStatus: false, accountId: null };
  }
  private subject(draft: RequestDraft): number | null {
    return draft.reference.kind === 'id' ? draft.reference.id : this.candidates.resolve(draft.reference, true)?.id ?? null;
  }
  requireStatus(): void { if (this.pending) this.pending.needsStatus = true; }
  bindAccount(accountId: number): void {
    if (!this.pending) return;
    if (this.pending.accountId !== null && this.pending.accountId !== accountId) throw new AppError('ACCOUNT_CHANGED', '补全请求期间账户发生变化，请重新提出修改要求。');
    this.pending.accountId = accountId;
  }
  statusForCreation(): number | null {
    if (!this.pending?.needsStatus) return null;
    return statusAnswer(this.pending.sources.at(-1)!) ?? null;
  }
  intent(): DirectIntent | null {
    const request = this.pending;
    if (!request?.direct || request.subjectId === null || !request.draft.mutation) return null;
    return mutationIntent(request.subjectId, request.draft.mutation);
  }
  context(): string {
    return `宿主保存的未完成请求（不能自行补全缺失对象或参数）：${JSON.stringify(this.pending)}。`;
  }
  question(): string | null {
    if (!this.pending) return null;
    if (this.pending.subjectId === null) return '你指哪一项作品？可以说“第一项”，或告诉我完整作品名、条目链接。修改要求已保留。';
    if (this.pending.draft.missing === 'rate') return '要设置成几分？请给出0～10的整数。';
    if (this.pending.draft.missing === 'status' || this.pending.needsStatus && this.statusForCreation() === null) return '这部作品尚未明确收藏状态，请选择想看/想读/想听/想玩、在看/在读/在听/在玩、看过/读过/听过/玩过、搁置或抛弃。原修改要求已保留。';
    return null;
  }
}
export function mutationIntent(subjectId: number, mutation: Mutation): DirectIntent | null {
  if (mutation.kind === 'delete') return null;
  if (mutation.kind === 'collection') return { subjectId, patch: mutation.patch };
  return mutation.progress.mode === 'book' ? { subjectId, patch: { ...(mutation.progress.chapters === undefined ? {} : { chapters: mutation.progress.chapters }),
    ...(mutation.progress.volumes === undefined ? {} : { volumes: mutation.progress.volumes }) } }
    : { subjectId, patch: {}, progress: mutation.progress };
}
