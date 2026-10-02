import { CandidateState } from './candidates.js';
import { mutationFrom, rateAnswer, looksLikeRateAnswer, selectionFrom, statusAnswer, type Mutation, type RequestDraft } from '../domain/dialogue-intent.js';
import { assertSubjectMutationRequest, type DirectIntent } from '../domain/permissions.js';
import { AppError } from '../domain/errors.js';
import type { MediaType } from '../domain/bangumi.js';

export interface PendingRequest {
  draft: RequestDraft; subjectId: number | null; sources: string[]; direct: boolean;
  needsStatus: boolean;
  accountId: number | null;
  candidateSetId?: string;
  type?: MediaType;
}
/** 只存本次活跃会话的未完成请求；日志恢复不恢复写入请求和授权。 */
export class DialogueState {
  private requests: PendingRequest[] = [];
  private activeIndex = 0;
  private get pending(): PendingRequest | null { return this.requests[this.activeIndex] ?? null; }
  private set pending(value: PendingRequest | null) { this.requests = value ? [value] : []; this.activeIndex = 0; }
  constructor(private readonly candidates: CandidateState) {}
  snapshot(): PendingRequest | null { this.validateOrigin(); return structuredClone(this.pending); }
  all(): PendingRequest[] { this.validateOrigin(); return structuredClone(this.requests); }
  active(): number { return this.activeIndex; }
  activate(index: number): void {
    if (!this.requests[index]) throw new AppError('INVALID_INPUT', '修改项不存在。');
    this.activeIndex = index;
  }
  private nextMissing(): void {
    const index = this.requests.findIndex(request => request.subjectId === null || request.draft.missing !== null || request.needsStatus);
    this.activeIndex = index < 0 ? 0 : index;
  }
  private validateOrigin(): void {
    for (const request of this.requests) {
      const source = request.sources[0] ?? '';
      if (request.direct) { if (!mutationFrom(source)) { this.clear(); return; } }
      else { try { assertSubjectMutationRequest(source); } catch { this.clear(); return; } }
    }
  }
  clear(): void { this.pending = null; }
  canHandleAnswer(input: string): boolean {
    this.validateOrigin();
    return Boolean(this.pending && (this.pending.subjectId === null && (selectionFrom(input) || this.candidates.hasName(input.trim()))
      || this.pending.draft.missing === 'rate' && looksLikeRateAnswer(input)
      || (this.pending.draft.missing === 'status' || this.pending.needsStatus) && statusAnswer(input) !== null));
  }
  canHandle(input: string): boolean {
    this.validateOrigin();
    const draft = mutationFrom(input);
    const knownDraft = draft && (draft.reference.kind !== 'name' || this.candidates.hasName(draft.reference.name));
    return Boolean(knownDraft || selectionFrom(input) || this.candidates.hasName(input.trim())
      || this.pending?.draft.missing === 'rate' && looksLikeRateAnswer(input)
      || (this.pending?.draft.missing === 'status' || this.pending?.needsStatus) && statusAnswer(input) !== null);
  }
  consume(input: string): boolean {
    this.validateOrigin();
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
      this.nextMissing(); return true;
    }
    const draft = mutationFrom(input);
    if (draft) {
      this.pending = { draft, subjectId: this.subject(draft), sources: [input], direct: true, needsStatus: false, accountId: null };
      return true;
    }
    const ref = selectionFrom(input) ?? (this.candidates.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (ref) {
      const selected = this.candidates.resolve(ref, true, this.pending?.candidateSetId, this.pending?.type);
      if (this.pending) {
        const id = ref.kind === 'id' && (!this.pending.candidateSetId || selected) ? ref.id : selected?.id ?? null;
        if (this.pending.subjectId !== null && id !== this.pending.subjectId) throw new AppError('INVALID_INPUT', '选择不能覆盖该修改项已绑定的对象，请重新提出任务。');
        this.pending.subjectId = id;
        this.pending.draft.reference = ref; this.pending.sources.push(input);
      }
      this.nextMissing(); return true;
    }
    this.clear(); return false;
  }
  propose(draft: RequestDraft, source: string): void {
    assertSubjectMutationRequest(source);
    // 模型解析只产生待确认提案，不能扩大真实用户已有的确定性请求。
    if (this.pending && !(this.pending.subjectId === null && this.pending.draft.reference.kind === 'name'
      && this.pending.sources.length === 1 && this.pending.sources[0] === source)) return;
    // 模型提案不授予权限；仅宿主重新核对完整原文得到完全同一请求时沿用方案B。
    const canonical = mutationFrom(source);
    const direct = canonical !== null && JSON.stringify(canonical.reference) === JSON.stringify(draft.reference)
      && JSON.stringify(canonical.mutation) === JSON.stringify(draft.mutation) && canonical.missing === draft.missing;
    this.pending = { draft, subjectId: this.subject(draft), sources: [source], direct, needsStatus: false, accountId: null };
  }
  /** 每项对象独立绑定；模型对象参数仅为提案，不能从编号或ID猜测歧义对象。 */
  proposeMany(items: { draft: RequestDraft; candidateSetId?: string; type?: MediaType; subjectId?: number }[], source: string, canonicalSubjectId?: number | null): void {
    assertSubjectMutationRequest(source);
    if (!items.length || items.length > 20) throw new AppError('INVALID_INPUT', '修改请求须包含1～20项。');
    const requests = items.map(item => {
      const ref = item.draft.reference;
      const resolved = this.candidates.resolve(ref, false, ref.kind === 'name' ? undefined : item.candidateSetId, item.type);
      const subjectId = ref.kind === 'id' ? ref.id : resolved?.id ?? null;
      if (item.subjectId !== undefined && item.subjectId !== subjectId) throw new AppError('SELECTION_REQUIRED', '对象ID与真实指代不一致或尚有歧义，不能由模型替用户选择。');
      const canonical = items.length === 1 ? mutationFrom(source) : null;
      const direct = canonical !== null && JSON.stringify(canonical.mutation) === JSON.stringify(item.draft.mutation) && canonical.missing === item.draft.missing
        && (JSON.stringify(canonical.reference) === JSON.stringify(ref) || ref.kind === 'missing' && canonical.reference.kind === 'current'
          || typeof canonicalSubjectId === 'number' && canonicalSubjectId === subjectId);
      const set = item.candidateSetId ?? (subjectId === null ? this.candidates.snapshot().sets.findLast(set =>
        ref.kind !== 'name' || set.items.some(candidate => [candidate.title, ...(candidate.aliases ?? [])].some(name => name.normalize('NFKC').replace(/\s/g, '').toLowerCase() === ref.name.normalize('NFKC').replace(/\s/g, '').toLowerCase())))?.id : undefined);
      return { draft: structuredClone(item.draft), subjectId, sources: [source], direct, needsStatus: false, accountId: null,
        ...(set ? { candidateSetId: set } : {}), ...(item.type ? { type: item.type } : {}) } satisfies PendingRequest;
    });
    const ids = requests.flatMap(request => request.subjectId === null ? [] : [request.subjectId]);
    if (new Set(ids).size !== ids.length) throw new AppError('INVALID_INPUT', '同一作品的修改应合并为一项。');
    this.requests = requests; this.nextMissing();
  }
  /** 模型只能补充宿主已保存请求的缺项，不能改写已有对象/值或取得直接授权。 */
  completeFromModel(input: string, values: { reference?: string; rate?: number; status?: number }): void {
    this.validateOrigin();
    if (!this.pending) throw new AppError('PLAN_UNAVAILABLE', '没有本次活跃会话的待补请求。');
    const request = structuredClone(this.pending);
    const probe = new CandidateState(); probe.restoreSnapshot(this.candidates.snapshot());
    if (values.reference !== undefined) {
      if (request.subjectId !== null || !input.includes(values.reference)) throw new AppError('INVALID_INPUT', '只能用本轮原文补充尚未绑定的对象。');
      const ref = selectionFrom(values.reference) ?? { kind: 'name' as const, name: values.reference };
      request.subjectId = ref.kind === 'id' ? ref.id : probe.resolve(ref, true, request.candidateSetId, request.type)?.id ?? null;
      request.draft.reference = ref;
    }
    if (values.rate !== undefined) {
      if (request.draft.missing !== 'rate' || !Number.isInteger(values.rate) || values.rate < 0 || values.rate > 10) throw new AppError('INVALID_INPUT', '只能补充缺失的0～10分整数评分。');
      request.draft.mutation = { kind: 'collection', patch: { rate: values.rate } }; request.draft.missing = null;
    }
    if (values.status !== undefined) {
      if (!(request.draft.missing === 'status' || request.needsStatus) || !Number.isInteger(values.status) || values.status < 1 || values.status > 5) throw new AppError('INVALID_INPUT', '只能补充缺失的收藏状态。');
      if (request.needsStatus) {
        if (request.draft.mutation?.kind === 'collection') request.draft.mutation.patch.status = values.status;
        else throw new AppError('INVALID_INPUT', '未收藏进度请用明确状态回答，先创建收藏再重新预览。');
        request.needsStatus = false;
      } else { request.draft.mutation = { kind: 'collection', patch: { status: values.status } }; request.draft.missing = null; }
    }
    request.sources.push(input); request.direct = false;
    this.requests[this.activeIndex] = request; this.candidates.restoreSnapshot(probe.snapshot()); this.nextMissing();
  }
  private subject(draft: RequestDraft): number | null {
    return draft.reference.kind === 'id' ? draft.reference.id : this.candidates.resolve(draft.reference, true)?.id ?? null;
  }
  requireStatus(): void { if (this.pending) this.pending.needsStatus = true; }
  creationCompleted(index: number): void { this.activate(index); this.pending!.needsStatus = false; this.nextMissing(); }
  bindAccount(accountId: number): void {
    for (const request of this.requests) {
      if (request.accountId !== null && request.accountId !== accountId) throw new AppError('ACCOUNT_CHANGED', '补全请求期间账户发生变化，请重新提出修改要求。');
      request.accountId = accountId;
    }
  }
  statusForCreation(): number | null {
    if (!this.pending?.needsStatus) return null;
    return statusAnswer(this.pending.sources.at(-1)!) ?? null;
  }
  intent(): DirectIntent | null {
    this.validateOrigin();
    const request = this.pending;
    if (this.requests.length !== 1 || !request?.direct || request.subjectId === null || !request.draft.mutation) return null;
    return mutationIntent(request.subjectId, request.draft.mutation);
  }
  context(): string {
    return `宿主保存的任务修改项（按原顺序；只能补第${this.activeIndex + 1}项的缺项，不能覆盖已有对象或参数）：${JSON.stringify(this.requests)}。`;
  }
  question(): string | null {
    this.validateOrigin();
    if (!this.pending) return null;
    const prefix = this.requests.length > 1 ? `第${this.activeIndex + 1}项修改：` : '';
    if (this.pending.subjectId === null) return `${prefix}你指哪一项作品？可以说“第一项”，或告诉我完整作品名、条目链接。修改要求已保留。`;
    if (this.pending.draft.missing === 'rate') return `${prefix}要设置成几分？请给出0～10的整数。`;
    if (this.pending.draft.missing === 'status' || this.pending.needsStatus && this.statusForCreation() === null) return `${prefix}这部作品尚未明确收藏状态，请选择想看/想读/想听/想玩、在看/在读/在听/在玩、看过/读过/听过/玩过、搁置或抛弃。原修改要求已保留。`;
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
