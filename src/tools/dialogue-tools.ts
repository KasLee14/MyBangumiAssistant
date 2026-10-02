import type { BangumiReadClient } from '../adapters/bgm-cli/client.js';
import { ReadTools } from './read-tools.js';
import { CandidateState, type Candidate, type CandidateSet } from '../core/candidates.js';
import { OperationCoordinator, type OperationPlan } from '../core/operations.js';
import type { Message, ToolRegistry, ToolSchema } from '../core/types.js';
import { directIntentFrom, assertSubjectMutationRequest } from '../domain/permissions.js';
import { collectionAction, collectionPatch } from '../domain/collection-plan.js';
import { AppError } from '../domain/errors.js';
import { object, positiveId } from '../domain/bangumi.js';
import { collectionWriteAction } from '../domain/collection-plan.js';
import { progressAction, progressRequest } from '../domain/progress-plan.js';
import type { BangumiWriteClient } from '../adapters/bgm-cli/write-client.js';
import { DialogueState, mutationIntent } from '../core/dialogue-state.js';
import { referenceFrom, selectionFrom, selectionCommand, unsafeMutationText, mutationFrom, type Mutation } from '../domain/dialogue-intent.js';
import { readTaskSchema, readTaskFrom, type ReadTask } from '../domain/model-task.js';
import { subjectSelectionQuestion } from '../domain/subject-selection-question.js';
import { mcpSchemas, mcpMutationAction, assertMcpMutationIntent, directMcpIntentFrom } from './mcp-tools.js';
import { TOOL_DEFINITIONS, validateToolArguments } from '../adapters/mcp/catalog.js';
import type { McpCallClient } from '../adapters/mcp/client.js';
import { subjectFrom } from '../adapters/bgm-cli/normalize.js';
import { mediaType } from '../domain/bangumi.js';

const extraSchemas: ToolSchema[] = [
  { type: 'function', function: { name: 'request_subject_selection', description: '单作品目标不唯一时提问，读取查询同时提供task保存完整目标及字段。宿主使用最新固定候选生成选项并续接；比较或浏览不要求选一部。不授予写入权限。', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 }, task: readTaskSchema }, required: ['question'], additionalProperties: false } } },
  { type: 'function', function: { name: 'request_task_clarification', description: '读取条件或范围缺失时保存结构化task并追问；本轮停止工具执行，回答后由模型继续理解。修改缺值使用propose_dialogue_request。', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 }, task: readTaskSchema }, required: ['question', 'task'], additionalProperties: false } } },
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
extraSchemas.push({ type: 'function', function: { name: 'propose_dialogue_request', description: '自然语言修改的受限结构化提案。sourceText必须逐字等于真实用户输入；reference来自原文，不能自行选候选。缺项由宿主保存并追问。模型提案不构成授权；仅宿主独立核实完整原文得到完全同一明确单项时沿用方案B，其余具体预览确认。', parameters: {
  type: 'object', properties: { sourceText: { type: 'string', maxLength: 8000 }, reference: { type: 'string', maxLength: 300 },
    kind: { type: 'string', enum: ['collection', 'progress'] },
    patch: { type: 'object', properties: { status: { type: 'integer', minimum: 1, maximum: 5 }, rate: { type: 'integer', minimum: 0, maximum: 10 },
      comment: { type: 'string', maxLength: 380 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 40 }, private: { type: 'boolean' } }, additionalProperties: false },
    progress: { type: 'object', properties: { mode: { type: 'string', enum: ['through', 'single', 'explicit', 'book', 'rollback', 'clear'] }, number: { type: 'integer', minimum: 0 },
      episodeId: { type: 'integer', minimum: 1 }, chapters: { type: 'integer', minimum: 0 }, volumes: { type: 'integer', minimum: 0 } }, required: ['mode'], additionalProperties: false },
    missing: { type: 'string', enum: ['rate', 'status'] },
  }, required: ['sourceText', 'kind'], additionalProperties: false,
} } });
extraSchemas.push({ type: 'function', function: { name: 'complete_dialogue_request', description: '仅补充宿主已保存修改请求的缺项，自由表达由模型理解。sourceText逐字等于本轮真实输入；不能覆盖已有对象或参数。模型补全后展示具体预览确认，不授予直接权限。', parameters: {
  type: 'object', properties: { sourceText: { type: 'string', minLength: 1, maxLength: 8000 }, reference: { type: 'string', minLength: 1, maxLength: 300 },
    rate: { type: 'integer', minimum: 0, maximum: 10 }, status: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['sourceText'], additionalProperties: false,
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
  private selectionAnswer: Candidate | null = null;
  private readTask: ReadTask | null = null;
  private readContinuation: ReadTask | null = null;
  private taskQuestion: { text: string; task: ReadTask } | null = null;
  private searchedSetId: string | null = null;
  private modelCompleting = false;
  constructor(private readonly client: BangumiReadClient, readonly operations: OperationCoordinator, private readonly display: {
    candidates?: (set: CandidateSet) => void; plan?: (plan: OperationPlan) => void;
  } = {}, private readonly mcp?: McpCallClient) { this.read = new ReadTools(client); }
  schemas(): ToolSchema[] {
    const legacy = [...this.read.schemas(), ...structuredClone(extraSchemas)];
    const search = legacy.find(schema => schema.function.name === 'search_subjects')!;
    search.function.parameters.properties = { ...(search.function.parameters.properties as Record<string, unknown>), task: readTaskSchema };
    search.function.description += '。可同时提供task描述完整读取目标，目标名保留季度；单作品唯一名称由宿主匹配，比较/浏览不绑定唯一对象。不需要额外意图识别调用。';
    if (!this.mcp) return legacy;
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === 'search_subjects')!;
    const oldProperties = search.function.parameters.properties as Record<string, unknown>;
    search.function.description = '按关键词搜索五类作品，支持排序和offset分页；type兼容媒体名，subject_type为MCP数字类型，二者须一致。同时提供task保留完整读取目标、季度和字段；single唯一目标由宿主核对，compare/browse不强制单选。不增加独立意图请求。';
    search.function.parameters = { ...structuredClone(definition.inputSchema), properties: {
      ...(definition.inputSchema.properties as Record<string, unknown>), type: oldProperties.type, task: readTaskSchema,
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
    } };
    const names = new Set(legacy.map(schema => schema.function.name));
    return [...legacy, ...mcpSchemas().filter(schema => !names.has(schema.function.name))];
  }
  hydrate(history: readonly Message[]): void {
    if (!this.hydrated) {
      this.candidates.restore(history); this.hydrated = true;
      const lastUser = history.findLastIndex(message => message.role === 'user');
      const calls = new Map<string, string>();
      for (const message of history.slice(lastUser + 1)) {
        if (message.role === 'assistant') for (const call of message.tool_calls ?? []) calls.set(call.id, call.function.name);
        if (message.role !== 'tool' || !['search_subjects', 'request_subject_selection', 'request_task_clarification', 'get_subject', 'get_collection', 'get_progress', 'list_episodes'].includes(calls.get(message.tool_call_id) ?? '')) continue;
        try {
          const result = JSON.parse(message.content);
          const set = this.candidates.snapshot().sets.at(-1);
          const source = history[lastUser]?.content;
          if (result.ok === true && result.data?.readTask && source) this.readTask = readTaskFrom(result.data.readTask, source);
          if (calls.get(message.tool_call_id) === 'request_task_clarification' && result.ok === true && this.readTask && typeof result.data.question === 'string') {
            this.taskQuestion = { text: result.data.question, task: this.readTask };
          }
          if (calls.get(message.tool_call_id) === 'search_subjects' && result.ok === true && set && result.data?.candidateSet?.id === set.id) this.searchedSetId = set.id;
          if (result.ok === true && result.data?.awaitingUser === true && set && set.id === result.data.candidateSet?.id
            && typeof result.data.question === 'string' && !this.candidates.current()) this.selectionQuestion = { setId: set.id, text: result.data.question };
        } catch { /* 仅恢复有效的已完成读取追问；修改请求及授权不恢复。 */ }
      }
      const last = history.at(-1);
      if (last?.role === 'assistant' && last.content) this.observeAnswer(last.content);
    }
  }
  beginTurn(input: string, history: readonly Message[]): void {
    this.hydrate(history); this.priorCandidates = this.candidates.snapshot();
    this.operations.invalidate(); this.input = input; this.directGranted = false;
    this.searchedSetId = null;
    if (!this.selectionAnswer) this.readContinuation = this.taskQuestion?.task ?? null;
    this.readTask = null; this.taskQuestion = null;
    this.candidates.fromExplicitUser(input);
    if (this.selectionAnswer) this.candidates.focus(this.selectionAnswer);
    this.selectionAnswer = null;
    if (this.dialogue.canHandleAnswer(input) || selectionCommand(input) && this.dialogue.snapshot()) {
      this.dialogue.consume(selectionCommand(input) && this.candidates.current() ? `条目#${this.candidates.current()!.id}` : input);
      this.modelCompleting = false;
    } else this.modelCompleting = this.dialogue.snapshot() !== null;
    this.selectionQuestion = null;
  }
  endTurn(completed: boolean): void {
    if (!completed) { this.operations.invalidate(); this.candidates.restoreSnapshot(this.priorCandidates); this.dialogue.clear(); this.selectionQuestion = null; this.readTask = null; this.readContinuation = null; this.taskQuestion = null; }
  }
  question(): string | null { return this.selectionQuestion?.text ?? this.taskQuestion?.text ?? (this.modelCompleting ? null : this.dialogue.question()); }
  observeAnswer(content: string): void {
    const set = this.candidates.snapshot().sets.at(-1);
    if (this.selectionQuestion || !set || set.id !== this.searchedSetId || set.items.length < 2 || this.candidates.current()) return;
    const text = subjectSelectionQuestion(content);
    if (text) this.selectionQuestion = { setId: set.id, text };
  }
  awaitingSelection(): { setId: string; text: string } | null {
    const set = this.candidates.snapshot().sets.at(-1);
    if (!set || set.items.length < 2 || this.candidates.current()) return null;
    if (this.selectionQuestion?.setId === set.id) return structuredClone(this.selectionQuestion);
    const pending = this.dialogue.snapshot();
    return pending?.subjectId === null ? { setId: set.id, text: this.dialogue.question()! } : null;
  }
  selectionContinuation(input: string, history: readonly Message[]): string | null {
    this.hydrate(history);
    // 已保存的修改请求仍由确定性宿主补全，不能被读查询续接取代。
    if (this.dialogue.snapshot()) return null;
    const set = this.candidates.snapshot().sets.at(-1);
    const lastUser = history.findLast(message => message.role === 'user');
    if (lastUser?.content?.startsWith('[宿主未放行上一任务')) {
      const ref = selectionFrom(input) ?? selectionCommand(input)?.reference;
      if (ref && ref.kind !== 'id') throw new AppError('SELECTION_REQUIRED', '上一任务未放行，没有可续接的选择；请重新说明查询。');
      return null;
    }
    const explicit = selectionFrom(input);
    if (!set?.items.length) return explicit?.kind === 'id' ? `https://bgm.tv/subject/${explicit.id}` : null;
    if (this.selectionQuestion && this.selectionQuestion.setId !== set.id) return null;
    const command = selectionCommand(input);
    if (command?.setId && command.setId !== set.id) throw new AppError('CANDIDATE_NOT_FOUND', '请回答当前候选清单，不要选择旧清单。');
    const reference = command ? command.reference
      : /^[1-9]\d*$/.test(input.trim()) ? { kind: 'index' as const, index: Number(input.trim()) }
        : selectionFrom(input) ?? (this.candidates.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (!reference) return null;
    // 校验时不改变真实状态；进入新轮次后绑定，取消仍能恢复原快照。
    const probe = new CandidateState(); probe.restoreSnapshot(this.candidates.snapshot());
    const selected = probe.resolve(reference, true);
    if (!selected) return reference.kind === 'id' ? `https://bgm.tv/subject/${reference.id}` : null;
    this.selectionAnswer = selected;
    this.readContinuation = this.readTask;
    return selected.url;
  }
  context(): string { return `宿主确认的当前作品：${JSON.stringify(this.candidates.current())}。本轮读取目标：${JSON.stringify(this.readTask ?? this.readContinuation)}。仅用模型工具参数理解自由表达；旧字段词表不参与任务判断。读取目标不提供写入授权；原文和当前输入均需核对，换任务不得沿用旧目标。候选编号以工具 candidateSet 原始顺序为准，不得重排编号。${this.dialogue.context()}`; }
  private querySelection(set: CandidateSet): { awaitingUser: true; question: string } | Record<string, never> {
    if (this.readTask?.mode === 'single' && this.candidates.targetMatches(this.readTask).length > 1 && !this.candidates.current()) {
      this.selectionQuestion = { setId: set.id, text: '有多个条目或季度符合查询，请选择具体作品；选择后继续原查询，不会设置个人评分。' };
      return { awaitingUser: true, question: this.selectionQuestion.text };
    }
    return {};
  }
  canHandleUser(input: string, history: readonly Message[]): boolean {
    this.hydrate(history); return this.dialogue.canHandleAnswer(input);
  }
  resetRequests(): void { this.operations.invalidate(); this.dialogue.clear(); this.selectionQuestion = null; this.selectionAnswer = null; this.readTask = null; this.readContinuation = null; this.taskQuestion = null; this.searchedSetId = null; this.input = ''; this.directGranted = false; }
  scopeContext(): unknown {
    const pending = this.dialogue.snapshot();
    return { current: this.candidates.current(), candidateCount: this.candidates.snapshot().sets.at(-1)?.items.length ?? 0,
      pending: pending ? { kind: pending.draft.mutation?.kind ?? 'collection', missing: pending.draft.missing, needsStatus: pending.needsStatus } : this.taskQuestion ? { kind: 'read', goal: this.taskQuestion.task.goal } : null };
  }
  async handleUser(input: string, history: readonly Message[], signal: AbortSignal): Promise<string | OperationPlan> {
    if (mutationFrom(input)?.mutation?.kind === 'delete') { this.resetRequests(); return '条目取消收藏暂未开放，请在 Bangumi 网站操作。'; }
    this.beginTurn(input, history);
    const reply = await this.continueRequest(signal);
    if (reply) return reply;
    const set = this.candidates.snapshot().sets.at(-1);
    if (selectionCommand(input) && !this.candidates.current() && set && set.items.length > 1) {
      this.selectionQuestion = { setId: set.id, text: '作品名未唯一匹配，请从当前候选中选择具体条目。' };
      return this.selectionQuestion.text;
    }
    const reference = selectionFrom(input);
    if (!this.candidates.current() && reference?.kind === 'id') {
      const subject = await this.client.subject(reference.id, signal);
      if (subject.id !== reference.id) throw new AppError('INVALID_RESPONSE', '详情返回了其他条目。');
      this.candidates.focus({ id: subject.id, title: subject.nameCn || subject.name, type: subject.type, url: subject.url });
    }
    return '当前没有可续接的作品查询，请重新说明任务或提供完整作品名、条目链接。';
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
    if (name === 'complete_dialogue_request') {
      const args = object(value, '请求补全');
      if (Object.keys(args).some(key => !['sourceText', 'reference', 'rate', 'status'].includes(key)) || args.sourceText !== this.input || unsafeMutationText(this.input)
        || args.reference === undefined && args.rate === undefined && args.status === undefined
        || args.reference !== undefined && (typeof args.reference !== 'string' || !args.reference.trim() || args.reference.length > 300)) throw new AppError('INVALID_INPUT', '补全必须来自本轮真实回答且仅包含缺项，不得提供授权。');
      this.dialogue.completeFromModel(this.input, { ...(args.reference === undefined ? {} : { reference: args.reference as string }),
        ...(args.rate === undefined ? {} : { rate: args.rate as number }), ...(args.status === undefined ? {} : { status: args.status as number }) });
      this.modelCompleting = false;
      const result = await this.continueRequest(options?.signal);
      return typeof result === 'string' ? { clarification: result, request: this.dialogue.snapshot() } : result;
    }
    // 选择新业务工具表示不再补充旧请求，不能让旧草稿阻止新任务或附带执行。
    if (this.modelCompleting) { this.dialogue.clear(); this.modelCompleting = false; }
    if (name === 'request_task_clarification') {
      const args = object(value, '读取追问');
      if (Object.keys(args).some(key => !['question', 'task'].includes(key)) || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 300) throw new AppError('INVALID_INPUT', '追问必须提供简短问题和结构化读取任务。');
      const task = this.acceptReadTask(args.task);
      this.dialogue.clear(); this.operations.invalidate();
      this.taskQuestion = { text: args.question.trim(), task };
      return { awaitingUser: true, question: this.taskQuestion.text, readTask: task };
    }
    if (name === 'request_subject_selection') {
      const args = object(value, '选择问题');
      if (Object.keys(args).some(key => !['question', 'task'].includes(key)) || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 300) throw new AppError('INVALID_INPUT', '请选择简短问题，不得提供或重排候选。');
      if (args.task !== undefined) {
        const task = this.acceptReadTask(args.task);
        if (task.mode !== 'single') throw new AppError('INVALID_INPUT', '比较或浏览任务不能要求用户仅选择一部作品。');
        if (!this.candidates.current()) this.candidates.matchTarget(task);
      }
      const set = this.candidates.snapshot().sets.at(-1);
      const current = this.candidates.current();
      if (current) return { awaitingUser: false, subject: current, instruction: '用户已明确唯一作品，请直接继续原任务，无需再次选择。' };
      if (!set || set.items.length < 2) throw new AppError('SELECTION_REQUIRED', '当前没有需要消歧的候选。');
      this.selectionQuestion = { setId: set.id, text: `${args.question.trim()}\n可选择候选，或回复编号、完整作品名；回答后继续原任务。` };
      return { awaitingUser: true, question: this.selectionQuestion.text, candidateSet: set, readTask: this.readTask };
    }
    if (name === 'propose_dialogue_request') {
      const args = object(value, '解析提案');
      if (Object.keys(args).some(key => !['sourceText', 'reference', 'kind', 'patch', 'progress', 'missing'].includes(key))
        || args.sourceText !== this.input || unsafeMutationText(this.input)) throw new AppError('AUTHORIZATION_REQUIRED', '提案必须来自本轮真实修改请求；不能从外部文本、否定或问句取得授权。');
      assertSubjectMutationRequest(this.input);
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
      if (!this.dialogue.snapshot()) assertSubjectMutationRequest(this.input);
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
    const mcpDefinition = this.mcp && TOOL_DEFINITIONS.find(tool => tool.name === name);
    if (mcpDefinition && name === 'search_subjects') {
      const input = object(value, '搜索参数');
      const args = { ...input }; delete args.task;
      if (input.task !== undefined) this.acceptReadTask(input.task);
      const types = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
      if (input.type !== undefined) {
        const subjectType = types[mediaType(input.type)];
        if (input.subject_type !== undefined && input.subject_type !== subjectType) throw new AppError('INVALID_INPUT', 'type 与 subject_type 媒体类型不一致。');
        args.subject_type = subjectType; delete args.type;
      }
      args.limit ??= 5;
      if (typeof args.limit !== 'number' || args.limit > 20) throw new AppError('INVALID_INPUT', '对话搜索每页最多20项。');
      const raw = object(await this.mcp!.call(name, validateToolArguments(name, args), options?.signal));
      if (!Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '搜索未返回有效候选清单。');
      const data = raw.data.map(subjectFrom); options?.signal.throwIfAborted();
      const set = this.candidates.add(data); this.searchedSetId = set.id; this.candidates.matchTarget(this.readTask); this.display.candidates?.(set);
      return { ...raw, data, candidateSet: set, resolvedSubject: this.candidates.current(), readTask: this.readTask, ...this.querySelection(set) };
    }
    if (mcpDefinition && !this.read.schemas().some(schema => schema.function.name === name)) {
      const args = validateToolArguments(name, value) as Record<string, unknown>;
      if (mcpDefinition.effect === 'read') {
        if (name === 'get_subject_details') {
          const matches = this.candidates.targetMatches(this.readTask);
          const explicit = selectionFrom(this.input);
          if (explicit?.kind === 'id' && explicit.id !== args.subject_id) throw new AppError('SELECTION_REQUIRED', 'MCP详情对象与用户提供的条目链接不一致。');
          const target = selectionCommand(this.input) || selectionFrom(this.input) ? this.candidates.current() : matches.length === 1 ? matches[0] : null;
          if (target && target.id !== args.subject_id) throw new AppError('SELECTION_REQUIRED', 'MCP详情对象与用户明确的条目不一致。');
          if (matches.length > 1 && !this.candidates.current()) throw new AppError('SELECTION_REQUIRED', '作品或季度仍有歧义，请先请求用户选择。');
        }
        return this.mcp!.call(name, args, options?.signal);
      }
      assertMcpMutationIntent(name, args, this.input);
      if (name === 'update_subject_collection') {
        const question = this.dialogue.question();
        if (question) throw new AppError('SELECTION_REQUIRED', question);
        const patch: Record<string, unknown> = {};
        for (const [key, field] of Object.entries({ collection_type: 'status', rating: 'rate', comment: 'comment', tags: 'tags', private: 'private' })) if (args[key] !== undefined) patch[field] = args[key];
        const hasProgress = args.ep_status !== undefined || args.vol_status !== undefined;
        if (hasProgress && Object.keys(patch).length) {
          const id = positiveId(args.subject_id); const bound = this.dialogue.snapshot()?.subjectId;
          if (bound != null && bound !== id || !new RegExp(`(?:/subject/|(?:条目|作品|书籍)\\s*#?\\s*|^#?)${id}(?!\\d)`).test(this.input)
            && this.candidates.current()?.id !== id && bound !== id) throw new AppError('SELECTION_REQUIRED', '混合修改的书籍对象必须由真实用户链接、条目 ID 或已确认的当前作品绑定。');
          return this.previewMcp(name, args, options?.signal);
        }
        if (hasProgress) {
          const subject = await this.client.subject(positiveId(args.subject_id), options?.signal);
          if (subject.type !== 'book') throw new AppError('INVALID_INPUT', 'ep_status/vol_status 仅用于书籍章数/卷数，动画请使用章节状态工具。');
          return this.preview({ operations: [{ subjectId: args.subject_id, progress: { mode: 'book', ...(args.ep_status !== undefined ? { chapters: args.ep_status } : {}), ...(args.vol_status !== undefined ? { volumes: args.vol_status } : {}) } }] }, options?.signal, true);
        }
        return this.preview({ operations: [{ subjectId: args.subject_id, patch }] }, options?.signal);
      }
      if (name === 'update_episode_collection') {
        const subjectId = positiveId(args.subject_id);
        if (!new RegExp(`(?:/subject/|(?:条目|作品)\\s*#?\\s*)${subjectId}(?!\\d)`).test(this.input)
          && this.candidates.current()?.id !== subjectId) throw new AppError('SELECTION_REQUIRED', '批量章节修改需要明确作品链接、条目 ID 或宿主已确认的当前作品。');
      }
      return this.previewMcp(name, args, options?.signal);
    }
    if (['get_subject', 'get_collection', 'get_progress', 'list_episodes'].includes(name)) {
      const matches = this.candidates.targetMatches(this.readTask);
      const subjectId = positiveId(object(value).subjectId);
      const reference = selectionFrom(this.input);
      const selectedId = reference?.kind === 'id' ? reference.id
        : reference || /^\/select\s/.test(this.input) || this.candidates.hasName(this.input.trim()) ? this.candidates.current()?.id : undefined;
      const boundId = selectedId ?? (matches.length === 1 ? matches[0]!.id : undefined);
      if (boundId !== undefined && boundId !== subjectId) throw new AppError('SELECTION_REQUIRED', '工具对象与用户明确选择或指定的作品、季度或媒体条件不一致，请查询宿主已匹配的条目。');
      if (matches.length > 1 && !this.candidates.current()) {
        const set = this.candidates.snapshot().sets.at(-1)!;
        this.selectionQuestion = { setId: set.id, text: '有多个条目符合你指定的作品条件，请选择具体作品；回答后继续原任务。' };
        return { awaitingUser: true, question: this.selectionQuestion.text, candidateSet: set };
      }
    }
    let readValue = value;
    if (name === 'search_subjects') {
      const args = { ...object(value, '搜索参数') };
      if (args.task !== undefined) this.acceptReadTask(args.task);
      delete args.task; readValue = args;
    }
    const result = await this.read.execute(name, readValue, options);
    options?.signal.throwIfAborted();
    if (name === 'search_subjects') {
      const page = object(result); const set = this.candidates.add(page.data as unknown[]);
      this.searchedSetId = set.id;
      this.candidates.matchTarget(this.readTask);
      this.display.candidates?.(set); return { ...page, candidateSet: set, resolvedSubject: this.candidates.current(), readTask: this.readTask, ...this.querySelection(set) };
    }
    if (name === 'get_subject') {
      const explicit = selectionFrom(this.input); const subject = object(result);
      if (explicit?.kind === 'id' && subject.id === explicit.id) this.candidates.focus({ id: explicit.id,
        title: String(subject.nameCn || subject.name), type: mediaType(subject.type), url: `https://bgm.tv/subject/${explicit.id}` });
    }
    return result;
  }
  private acceptReadTask(value: unknown): ReadTask {
    const source = object(value, '读取任务').sourceText;
    if (source !== this.input && source !== this.readContinuation?.sourceText) throw new AppError('INVALID_INPUT', '任务原文必须由宿主持有，不能由模型或外部结果替换。');
    const task = readTaskFrom(value, String(source));
    this.readTask = task; return task;
  }
  private async previewMcp(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<OperationPlan> {
    const user = await this.client.currentUser(signal);
    const action = await mcpMutationAction(this.mcp!, name, args, this.input, user.id, signal);
    if ((await this.client.currentUser(signal)).id !== user.id) throw new AppError('ACCOUNT_CHANGED', '生成预览期间账户改变。');
    this.operations.invalidate();
    const plan = this.operations.prepare(user.id, [action], this.directGranted ? null : directMcpIntentFrom(this.input));
    if (plan.state === 'authorized') this.directGranted = true;
    this.display.plan?.(plan);
    if (plan.state === 'authorized' && plan.writeAvailable) {
      await this.operations.execute(plan.id, signal ?? new AbortController().signal);
      const finished = this.operations.get(plan.id); this.display.plan?.(finished); return finished;
    }
    return plan;
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
    // 完整句式只在权限检查时核对，不创建待补值草稿或拦截模型理解。
    const directDraft = mutationFrom(this.input);
    const directSubject = directDraft ? directDraft.reference.kind === 'id' ? directDraft.reference.id : this.candidates.resolve(directDraft.reference)?.id : null;
    const intent = boundIntent ?? (requestState ? this.dialogue.intent() : directDraft?.mutation && directSubject != null ? mutationIntent(directSubject, directDraft.mutation) : unsafeMutationText(this.input) ? null : directIntentFrom(this.input, selected?.id ?? null));
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
