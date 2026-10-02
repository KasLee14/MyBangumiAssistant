import type { BangumiReadClient } from '../adapters/bgm-cli/client.js';
import { ReadTools } from './read-tools.js';
import { CandidateState, type CandidateSet } from '../core/candidates.js';
import { OperationCoordinator, type OperationPlan } from '../core/operations.js';
import type { Message, ToolRegistry, ToolSchema } from '../core/types.js';
import { directIntentFrom } from '../domain/permissions.js';
import { collectionAction, collectionPatch } from '../domain/collection-plan.js';
import { AppError } from '../domain/errors.js';
import { object, positiveId } from '../domain/bangumi.js';
import { collectionWriteAction } from '../domain/collection-plan.js';
import { progressAction, progressRequest } from '../domain/progress-plan.js';
import type { BangumiWriteClient } from '../adapters/bgm-cli/write-client.js';
import { DialogueState, mutationIntent } from '../core/dialogue-state.js';
import { referenceFrom, selectionFrom, unsafeMutationText, type Mutation } from '../domain/dialogue-intent.js';

const extraSchemas: ToolSchema[] = [
  { type: 'function', function: { name: 'request_subject_selection', description: '指代不唯一时向用户提问；宿主使用最新固定候选生成选项，选择或自然语言回答后继续原任务。不是修改确认，不授予写入权限。', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['question'], additionalProperties: false } } },
  { type: 'function', function: { name: 'resolve_reference', description: '读取由用户编号选择的当前作品；没有明确选择时返回消歧错误，模型不能自行选择候选。', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'preview_collection_changes', description: '读取账户和现有收藏，生成完整字段预览；宿主按真实用户授权执行明确单项，其余等待确认。未收藏时必须指定状态。模型不能确认或授权。', parameters: {
    type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
      subjectId: { type: 'integer', minimum: 1 }, patch: { type: 'object', minProperties: 1, properties: {
        status: { type: 'integer', minimum: 1, maximum: 5 }, rate: { type: 'integer', minimum: 0, maximum: 10 },
        tags: { type: 'array', maxItems: 40, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
        comment: { type: 'string', maxLength: 380, description: '最终短评正文；草稿不会自行构成保存授权' }, private: { type: 'boolean' },
      }, additionalProperties: false },
    }, required: ['subjectId', 'patch'], additionalProperties: false } } }, required: ['operations'], additionalProperties: false,
  } } },
];
extraSchemas.push({ type: 'function', function: { name: 'preview_progress_changes', description: '完整读取后规划原生进度。through 累计新增，single 单集，explicit 指定特殊章节，book 书籍章数/卷数，rollback 移除目标之后的主线已看（保留其他状态），clear 清空全部章节或书籍两个计数；回退/清空需确认。未收藏先选择状态。模型不能确认。', parameters: {
  type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
    subjectId: { type: 'integer', minimum: 1 }, progress: { type: 'object', properties: {
      mode: { type: 'string', enum: ['through','single','explicit','book','rollback','clear'] }, number: { type: 'integer', minimum: 0 }, episodeId: { type: 'integer', minimum: 1 },
      chapters: { type: 'integer', minimum: 0 }, volumes: { type: 'integer', minimum: 0 },
    }, required: ['mode'], additionalProperties: false },
  }, required: ['subjectId','progress'], additionalProperties: false } } }, required: ['operations'], additionalProperties: false,
} } });
extraSchemas.push({ type: 'function', function: { name: 'propose_dialogue_request', description: '复杂自然语言的受限解析提案。sourceText 必须逐字等于本轮真实用户输入；reference 必须是用户原文中的作品指代，不能自行选搜索结果。缺失对象或值时宿主保存请求并追问；模型提案始终需要具体预览确认，不构成授权。', parameters: {
  type: 'object', properties: { sourceText: { type: 'string', maxLength: 8000 }, reference: { type: 'string', maxLength: 300 },
    kind: { type: 'string', enum: ['collection', 'progress'] },
    patch: { type: 'object', properties: { status: { type: 'integer', minimum: 1, maximum: 5 }, rate: { type: 'integer', minimum: 0, maximum: 10 },
      comment: { type: 'string', maxLength: 380 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 40 }, private: { type: 'boolean' } }, additionalProperties: false },
    progress: { type: 'object', properties: { mode: { type: 'string', enum: ['through', 'single', 'explicit', 'book', 'rollback', 'clear'] }, number: { type: 'integer', minimum: 0 },
      episodeId: { type: 'integer', minimum: 1 }, chapters: { type: 'integer', minimum: 0 }, volumes: { type: 'integer', minimum: 0 } }, required: ['mode'], additionalProperties: false },
    missing: { type: 'string', enum: ['rate', 'status'] },
  }, required: ['sourceText', 'kind'], additionalProperties: false,
} } });

export class DialogueTools implements ToolRegistry {
  presentPlan(plan: OperationPlan): void { this.display.plan?.(plan); }
  readonly candidates = new CandidateState();
  readonly dialogue = new DialogueState(this.candidates);
  private readonly read: ReadTools;
  private input = '';
  private directGranted = false;
  private hydrated = false;
  private priorCandidates = this.candidates.snapshot();
  private selectionQuestion: { setId: string; text: string } | null = null;
  constructor(private readonly client: BangumiReadClient, readonly operations: OperationCoordinator, private readonly display: {
    candidates?: (set: CandidateSet) => void; plan?: (plan: OperationPlan) => void;
  } = {}) { this.read = new ReadTools(client); }
  schemas(): ToolSchema[] { return [...this.read.schemas(), ...structuredClone(extraSchemas)]; }
  hydrate(history: readonly Message[]): void {
    if (!this.hydrated) { this.candidates.restore(history); this.hydrated = true; }
  }
  beginTurn(input: string, history: readonly Message[]): void {
    this.hydrate(history); this.priorCandidates = this.candidates.snapshot();
    this.operations.invalidate(); this.input = input; this.directGranted = false;
    this.candidates.fromUser(input);
    this.dialogue.consume(/^\/select\s+(?:(c[1-9]\d*)\s+)?[1-9]\d*$/.test(input.trim())
      ? `条目#${this.candidates.current()!.id}` : input);
    this.selectionQuestion = null;
  }
  endTurn(completed: boolean): void {
    if (!completed) { this.operations.invalidate(); this.candidates.restoreSnapshot(this.priorCandidates); this.dialogue.clear(); this.selectionQuestion = null; }
  }
  question(): string | null { return this.selectionQuestion?.text ?? null; }
  selectionContinuation(input: string, history: readonly Message[]): boolean {
    this.hydrate(history);
    // 已保存的修改请求仍由确定性宿主补全，不能被读查询续接取代。
    if (this.dialogue.snapshot()) return false;
    const set = this.candidates.snapshot().sets.at(-1);
    const last = history.at(-1);
    const legacyQuestion = !this.candidates.current() && last?.role === 'assistant'
      && /回复编号|完整名称|完整作品名|是哪一个|哪一项作品/.test(last.content ?? '');
    if (!set?.items.length || !this.selectionQuestion && !legacyQuestion) return false;
    if (this.selectionQuestion && this.selectionQuestion.setId !== set.id) return false;
    const command = /^\/select\s+(?:(c[1-9]\d*)\s+)?([1-9]\d*)$/.exec(input.trim());
    if (command && command[1] && command[1] !== set.id) throw new AppError('CANDIDATE_NOT_FOUND', '请回答当前候选清单，不要选择旧清单。');
    const reference = command ? { kind: 'index' as const, index: Number(command[2]) }
      : /^[1-9]\d*$/.test(input.trim()) ? { kind: 'index' as const, index: Number(input.trim()) }
        : selectionFrom(input) ?? (this.candidates.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (!reference || !this.candidates.resolve(reference, true)) return false;
    this.selectionQuestion = null;
    return true;
  }
  context(): string { return `宿主确认的当前作品：${JSON.stringify(this.candidates.current())}。候选编号以工具 candidateSet 原始顺序为准，不得重排编号。${this.dialogue.context()}`; }
  canHandleUser(input: string, history: readonly Message[]): boolean {
    this.hydrate(history); return this.dialogue.canHandle(input);
  }
  resetRequests(): void { this.operations.invalidate(); this.dialogue.clear(); this.selectionQuestion = null; this.input = ''; this.directGranted = false; }
  scopeContext(): unknown {
    const pending = this.dialogue.snapshot();
    return { current: this.candidates.current(), candidateCount: this.candidates.snapshot().sets.at(-1)?.items.length ?? 0,
      pending: pending ? { kind: pending.draft.mutation?.kind ?? 'collection', missing: pending.draft.missing, needsStatus: pending.needsStatus } : null };
  }
  async handleUser(input: string, history: readonly Message[], signal: AbortSignal): Promise<string | OperationPlan> {
    this.beginTurn(input, history);
    const reply = await this.continueRequest(signal);
    if (reply) return reply;
    const reference = selectionFrom(input);
    if (!this.candidates.current() && reference?.kind === 'id') {
      const subject = await this.client.subject(reference.id, signal);
      if (subject.id !== reference.id) throw new AppError('INVALID_RESPONSE', '详情返回了其他条目。');
      this.candidates.focus({ id: subject.id, title: subject.nameCn || subject.name, type: subject.type, url: subject.url });
    }
    const selected = this.candidates.current();
    return selected ? `已选择 #${selected.id} ${selected.title}，${selected.url}。` : '请明确作品名、候选编号或条目链接。';
  }
  private async continueRequest(signal?: AbortSignal): Promise<string | OperationPlan | null> {
    if (this.dialogue.snapshot()?.draft.mutation?.kind === 'delete') { this.dialogue.clear(); return '条目取消收藏暂未开放，请在 Bangumi 网站操作。'; }
    const question = this.dialogue.question(); if (question) return question;
    const pending = this.dialogue.snapshot();
    if (!pending || pending.subjectId === null || !pending.draft.mutation) return null;
    const id = pending.subjectId; const mutation = pending.draft.mutation;
    try {
      const status = this.dialogue.statusForCreation();
      if (status !== null && mutation.kind === 'progress') {
        // 本轮状态选择只授权创建收藏。后续进度重新读取，展示具体预览后确认。
        const creation = await this.preview({ operations: [{ subjectId: id, patch: { status } }] }, signal, false,
          mutationIntent(id, { kind: 'collection', patch: { status } }));
        if (!creation.results?.every(result => result.state === 'success')) { this.dialogue.clear(); return creation; }
      }
      if(mutation.kind === 'delete') {
        this.dialogue.clear(); throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
      }
      const plan = await this.preview({ operations: [{ subjectId: id, ...(mutation.kind === 'collection' ? { patch: mutation.patch }
        : { progress: mutation.progress }) }] }, signal, mutation.kind === 'progress');
      this.dialogue.clear(); return plan;
    } catch (error) {
      if (error instanceof AppError && error.code === 'COLLECTION_REQUIRED') {
        this.dialogue.requireStatus(); return this.dialogue.question();
      }
      if (error instanceof AppError && error.code === 'NO_CHANGE') { this.dialogue.clear(); return error.message; }
      throw error;
    }
  }
  async execute(name: string, value: unknown, options?: { signal: AbortSignal }): Promise<unknown> {
    options?.signal.throwIfAborted();
    if (name === 'request_subject_selection') {
      const args = object(value, '选择问题');
      if (Object.keys(args).some(key => key !== 'question') || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 300) throw new AppError('INVALID_INPUT', '请选择简短问题，不得提供或重排候选。');
      const set = this.candidates.snapshot().sets.at(-1);
      if (!set?.items.length || this.candidates.current()) throw new AppError('SELECTION_REQUIRED', '当前没有需要消歧的候选。');
      this.selectionQuestion = { setId: set.id, text: `${args.question.trim()}\n可选择候选，或回复编号、完整作品名；回答后继续原任务。` };
      return { awaitingUser: true, question: this.selectionQuestion.text, candidateSet: set };
    }
    if (name === 'propose_dialogue_request') {
      const args = object(value, '解析提案');
      if (Object.keys(args).some(key => !['sourceText', 'reference', 'kind', 'patch', 'progress', 'missing'].includes(key))
        || args.sourceText !== this.input || unsafeMutationText(this.input)) throw new AppError('AUTHORIZATION_REQUIRED', '提案必须来自本轮真实修改请求；不能从外部文本、否定或问句取得授权。');
      if (args.reference !== undefined && (typeof args.reference !== 'string' || !args.reference.trim() || !this.input.includes(args.reference))) throw new AppError('INVALID_INPUT', '作品指代必须逐字来自真实用户输入。');
      let mutation: Mutation | null = null;
      if (args.kind === 'collection' && args.patch !== undefined && args.progress === undefined && args.missing === undefined) mutation = { kind: 'collection', patch: collectionPatch(args.patch) };
      else if (args.kind === 'progress' && args.progress !== undefined && args.patch === undefined && args.missing === undefined) mutation = { kind: 'progress', progress: progressRequest(args.progress) };
      else if (args.kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
      else if (!(args.kind === 'collection' && ['rate', 'status'].includes(String(args.missing)) && args.patch === undefined && args.progress === undefined)) throw new AppError('INVALID_INPUT', '解析提案操作与参数不匹配。');
      this.dialogue.propose({ reference: referenceFrom(typeof args.reference === 'string' ? args.reference : ''), mutation,
        missing: args.missing === 'rate' || args.missing === 'status' ? args.missing : null }, this.input);
      const result = await this.continueRequest(options?.signal);
      return typeof result === 'string' ? { clarification: result, request: this.dialogue.snapshot() } : result;
    }
    if (name === 'resolve_reference') {
      if (Object.keys(object(value, '工具参数')).length) throw new AppError('INVALID_INPUT', 'resolve_reference 不接受模型指定候选。');
      const selected = this.candidates.current();
      if (!selected) throw new AppError('SELECTION_REQUIRED', '作品指代不唯一，请让用户使用候选编号或明确条目链接选择。');
      return selected;
    }
    if (name === 'preview_collection_changes' || name === 'preview_progress_changes') {
      const question = this.dialogue.question();
      if (question) throw new AppError('SELECTION_REQUIRED', question);
      try {
        const plan = await this.preview(value, options?.signal, name === 'preview_progress_changes'); this.dialogue.clear(); return plan;
      } catch (error) {
        if (error instanceof AppError && error.code === 'COLLECTION_REQUIRED' && this.dialogue.snapshot()) {
          this.dialogue.requireStatus(); return { clarification: this.dialogue.question(), request: this.dialogue.snapshot() };
        }
        throw error;
      }
    }
    if (name === 'preview_delete_collection') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
    const result = await this.read.execute(name, value, options);
    options?.signal.throwIfAborted();
    if (name === 'search_subjects') {
      const page = object(result); const set = this.candidates.add(page.data as unknown[]);
      this.display.candidates?.(set); return { ...page, candidateSet: set };
    }
    return result;
  }
  private async preview(value: unknown, signal?: AbortSignal, progress = false, boundIntent?: ReturnType<typeof mutationIntent>): Promise<OperationPlan> {
    const args = object(value, '工具参数');
    if (Object.keys(args).some(key => key !== 'operations') || !Array.isArray(args.operations) || !args.operations.length || args.operations.length > 20) throw new AppError('INVALID_INPUT', '预览需要1～20项 operations。');
    const requests = args.operations.map(value => {
      const item = object(value, '操作');
      if (Object.keys(item).some(key => !['subjectId', progress ? 'progress' : 'patch'].includes(key))) throw new AppError('INVALID_INPUT', '操作包含未声明字段。');
      return { subjectId: positiveId(item.subjectId), value: progress ? progressRequest(item.progress) : collectionPatch(item.patch) };
    });
    if (new Set(requests.map(item => item.subjectId)).size !== requests.length) throw new AppError('INVALID_INPUT', '同一条目只能出现一次。');
    const selected = this.candidates.current(); const latest = this.candidates.snapshot().sets.at(-1);
    const requestState = this.dialogue.snapshot();
    const intent = boundIntent ?? (requestState ? this.dialogue.intent() : unsafeMutationText(this.input) ? null : directIntentFrom(this.input, selected?.id ?? null));
    const bound = requestState?.subjectId;
    if (requests.length === 1 && bound != null && bound !== requests[0]!.subjectId) throw new AppError('SELECTION_REQUIRED', '工具对象与用户明确的作品不匹配。');
    if (requests.length === 1 && latest && latest.items.length > 1 && selected?.id !== requests[0]!.subjectId
      && intent?.subjectId !== requests[0]!.subjectId
      && !new RegExp(`(?:^#?|/subject/|条目\\s*#?|\\s)${requests[0]!.subjectId}(?!\\d)`).test(this.input)) {
      throw new AppError('SELECTION_REQUIRED', '不能替用户从多个候选中选择写入对象，请先明确候选编号或条目ID。');
    }
    signal?.throwIfAborted(); const user = await this.client.currentUser(signal); this.dialogue.bindAccount(user.id);
    const writer = 'collectionSnapshot' in this.client ? this.client as BangumiWriteClient : undefined;
    const actions = [];
    for (const request of requests) {
      signal?.throwIfAborted();
      const subject = await this.client.subject(request.subjectId, signal);
      if (subject.id !== request.subjectId) throw new AppError('INVALID_RESPONSE', '详情返回了其他条目，已停止预览。');
      if (requests.length === 1 && (bound === subject.id || intent?.subjectId === subject.id)) this.candidates.focus({ id: subject.id, title: subject.nameCn || subject.name, type: subject.type, url: subject.url });
      const collection = writer ? await writer.collectionSnapshot(request.subjectId, signal) : await this.client.collection(request.subjectId, signal);
      if (progress) {
        if (!writer) throw new AppError('UNSUPPORTED_OPERATION', '进度写入适配器不可用。');
        const requestValue = progressRequest(request.value);
        const episodes = subject.type === 'anime' || subject.type === 'real' ? await writer.progressEpisodes(subject.id, user.id, signal) : undefined;
        actions.push(progressAction(subject, collection, requestValue, episodes));
      } else actions.push(writer ? collectionWriteAction(subject, collection, request.value) : collectionAction(subject, collection!, request.value));
    }
    signal?.throwIfAborted();
    if ((await this.client.currentUser(signal)).id !== user.id) throw new AppError('ACCOUNT_CHANGED', '预览期间账户改变，请重新读取。');
    signal?.throwIfAborted();
    this.operations.invalidate();
    const plan = this.operations.prepare(user.id, actions, this.directGranted ? null : intent);
    if (plan.state === 'authorized') this.directGranted = true;
    this.display.plan?.(plan);
    if (plan.state === 'authorized' && plan.writeAvailable) {
      await this.operations.execute(plan.id, signal ?? new AbortController().signal);
      const finished = this.operations.get(plan.id); this.display.plan?.(finished); return finished;
    }
    return plan;
  }
}
