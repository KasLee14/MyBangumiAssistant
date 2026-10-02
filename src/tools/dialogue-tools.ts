import type { BangumiReadClient } from '../adapters/bgm-cli/client.js';
import { ReadTools } from './read-tools.js';
import { CandidateState, type Candidate, type CandidateSet } from '../core/candidates.js';
import { OperationCoordinator, type OperationPlan } from '../core/operations.js';
import type { Message, ToolRegistry, ToolSchema } from '../core/types.js';
import { directIntentFrom, assertSubjectMutationRequest, simpleMutationIntent } from '../domain/permissions.js';
import { collectionAction, collectionPatch } from '../domain/collection-plan.js';
import { AppError } from '../domain/errors.js';
import { object, positiveId } from '../domain/bangumi.js';
import { collectionWriteAction } from '../domain/collection-plan.js';
import { progressAction, progressRequest, progressSchema } from '../domain/progress-plan.js';
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
import { usesPreparedBaseline } from '../adapters/mcp/prepared.js';
import { normalizeSubjectName } from '../domain/subject-query.js';
import type { ProgressRequest } from '../domain/progress-plan.js';
import type { Reference } from '../domain/dialogue-intent.js';
import { subjectTarget, subjectTargetSchema } from '../domain/operation-target.js';
import type { PendingRequest } from '../core/dialogue-state.js';
import type { PlannedAction } from '../domain/permissions.js';
import { compileSchema, schemaArguments } from '../domain/tool-schema.js';

// 模型和宿主使用同一搜索契约；旧type别名只在兼容入口归一化，不再向模型重复暴露。
const searchDefinition = TOOL_DEFINITIONS.find(tool => tool.name === 'search_subjects')!;
const dialogueSearchSchema = { ...structuredClone(searchDefinition.inputSchema), properties: {
  ...(searchDefinition.inputSchema.properties as Record<string, unknown>), task: readTaskSchema,
  limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
} };
compileSchema(dialogueSearchSchema);

const extraSchemas: ToolSchema[] = [
  { type: 'function', function: { name: 'request_subject_selection', description: '单作品目标不唯一时提问，读取查询同时提供task保存完整目标及字段。宿主使用最新固定候选生成选项并续接；比较或浏览不要求选一部。不授予写入权限。', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 }, task: readTaskSchema }, required: ['question'], additionalProperties: false } } },
  { type: 'function', function: { name: 'request_task_clarification', description: '读取条件或范围缺失时保存结构化task并追问；本轮停止工具执行，回答后由模型继续理解。修改缺值使用propose_dialogue_request。', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 300 }, task: readTaskSchema }, required: ['question', 'task'], additionalProperties: false } } },
  { type: 'function', function: { name: 'resolve_reference', description: '按真实输入中的名称、链接、编号或指代解析本次操作对象。支持历史候选组；多对象后的“它”须消歧，不存在默认作品。', parameters: { type: 'object', properties: { reference: { type: 'string', minLength: 1, maxLength: 300 }, candidateSetId: { type: 'string', pattern: '^c[1-9]\\d*$' } }, required: ['reference'], additionalProperties: false } } },
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
extraSchemas.push({ type: 'function', function: { name: 'preview_progress_changes', description: '完整读取后规划原生进度。single+number是网站编号；ordinal+number是本季主线序号（本季第一集用ordinal number=1）；explicit+episodeId可指定普通或特殊章节，不能混用number。普通单集在绑定真实原文和唯一作品后直接执行；回退/清空及复杂操作需确认。未收藏先选择状态。', parameters: {
  type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
    subjectId: { type: 'integer', minimum: 1 }, progress: progressSchema,
  }, required: ['subjectId','progress'], additionalProperties: false } } }, required: ['operations'], additionalProperties: false,
} } });
extraSchemas.push({ type: 'function', function: { name: 'propose_dialogue_request', description: '自然语言修改的结构化请求。章节进度直接使用本工具，内部先搜索本人在看列表，未找到先询问是否继续；不必先公开搜索或额外读取。条目状态先search_subjects。本工具按搜索—核对—计划—写入—独立回读处理。sourceText逐字等于真实输入，reference为原文完整作品名/指代，不能自行选候选。普通单集及单条目状态直接执行；降低/清空/批量/附带影响仍确认。本季单集用ordinal，网站编号用single，章节ID用explicit。模型不能授予或扩大权限。', parameters: {
  type: 'object', properties: { sourceText: { type: 'string', maxLength: 8000 }, reference: { type: 'string', maxLength: 300 },
    kind: { type: 'string', enum: ['collection', 'progress'] },
    patch: { type: 'object', properties: { status: { type: 'integer', minimum: 1, maximum: 5 }, rate: { type: 'integer', minimum: 0, maximum: 10 },
      comment: { type: 'string', maxLength: 380 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 40 }, private: { type: 'boolean' } }, additionalProperties: false },
    progress: progressSchema,
    missing: { type: 'string', enum: ['rate', 'status'] },
  }, required: ['sourceText', 'kind'], additionalProperties: false,
} } });

const proposal = extraSchemas.find(schema => schema.function.name === 'propose_dialogue_request')!.function;
const proposalProperties = proposal.parameters.properties as Record<string, unknown>;
proposal.parameters = { ...proposal.parameters, properties: { ...proposalProperties,
  operations: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
    target: subjectTargetSchema, kind: proposalProperties.kind, patch: proposalProperties.patch,
    progress: progressSchema, missing: proposalProperties.missing,
  }, required: ['target', 'kind'], additionalProperties: false } },
}, required: ['sourceText'], anyOf: [{ required: ['operations'] }, { required: ['kind'] }] };
proposal.description += '。多作品或混合收藏/进度修改在同一次operations中提交，每项target独立绑定原文与对象；完整批量预览后确认。单项旧reference参数仍兼容，省略对象只追问，不继承作品。';
for (const schema of extraSchemas.filter(schema => ['preview_collection_changes', 'preview_progress_changes'].includes(schema.function.name))) {
  const operations = object((schema.function.parameters.properties as Record<string, unknown>).operations);
  object(object(operations.items).properties).target = subjectTargetSchema;
}
extraSchemas.push({ type: 'function', function: { name: 'complete_dialogue_request', description: '仅补充已保存请求的缺项，自由表达由模型理解。sourceText逐字等于真实输入，不能覆盖已有对象/参数。合法单条目状态补全由宿主简单策略直接执行；评分等其他自由补值继续确认。模型不能提供权限标记。', parameters: {
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
  private invalidProgress = new Set<string>();
  private stopReason: string | null = null;
  private completedSimple = new Map<string, OperationPlan>();
  private progressLookup: { source: string; account: { id: number; username: string }; allowedOutside: boolean } | null = null;
  private progressGate: { source: string; reference: Reference; progress: ProgressRequest; accountId: number; question: string; batchTarget?: number } | null = null;
  private outsideTargets = new Set<number>();
  private creationPhase: { planId: string; index: number } | null = null;
  private referenceFrame: { objects: Candidate[]; ambiguous: boolean } = { objects: [], ambiguous: false };
  async afterConfirmation(plan: OperationPlan, signal: AbortSignal): Promise<string | OperationPlan | null> {
    const phase = this.creationPhase;
    if (!phase || phase.planId !== plan.id) { this.creationPhase = null; this.dialogue.clear(); return null; }
    this.creationPhase = null;
    if (!plan.results?.every(result => result.state === 'success')) { this.dialogue.clear(); return null; }
    this.dialogue.creationCompleted(phase.index);
    return this.continueRequest(signal);
  }
  constructor(private readonly client: BangumiReadClient, readonly operations: OperationCoordinator, private readonly display: {
    candidates?: (set: CandidateSet) => void; plan?: (plan: OperationPlan) => void;
  } = {}, private readonly mcp?: McpCallClient) { this.read = new ReadTools(client); }
  isReadOnly(name: string): boolean {
    return this.read.isReadOnly(name) || !!this.mcp && TOOL_DEFINITIONS.some(tool => tool.name === name && tool.effect === 'read');
  }
  schemas(): ToolSchema[] {
    const legacy = [...this.read.schemas(), ...structuredClone(extraSchemas)];
    const search = legacy.find(schema => schema.function.name === 'search_subjects')!;
    search.function.parameters.properties = { ...(search.function.parameters.properties as Record<string, unknown>), task: readTaskSchema };
    search.function.description += '。可同时提供task描述完整读取目标，目标名保留季度；单作品唯一名称由宿主匹配，比较/浏览不绑定唯一对象。不需要额外意图识别调用。';
    if (!this.mcp) return legacy;
    search.function.description = searchDefinition.description + '。支持offset分页，对话每页最多20项；媒体只填写subject_type。可提供task保留完整读取目标、季度和字段；single唯一目标由宿主核对，compare/browse不强制单选。';
    search.function.parameters = structuredClone(dialogueSearchSchema);
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
    this.referenceFrame = { objects: this.candidates.objects(), ambiguous: this.priorCandidates.multiple || this.priorCandidates.taskEstablished && this.priorCandidates.targets.length !== 1 };
    this.candidates.beginTask();
    this.creationPhase = null;
    this.operations.invalidate(); this.input = input; this.directGranted = false;
    this.invalidProgress.clear(); this.stopReason = null; this.completedSimple.clear();
    this.searchedSetId = null;
    if (!this.selectionAnswer) this.readContinuation = this.taskQuestion?.task ?? null;
    this.readTask = null; this.taskQuestion = null;
    this.candidates.fromExplicitUser(input);
    if (this.selectionAnswer) this.candidates.focus(this.selectionAnswer);
    this.selectionAnswer = null;
    if (this.dialogue.canHandleAnswer(input) || selectionCommand(input) && this.dialogue.snapshot()) {
      const command = selectionCommand(input);
      const expectedSet = this.dialogue.snapshot()?.candidateSetId;
      if (command?.setId && expectedSet && command.setId !== expectedSet) throw new AppError('CANDIDATE_NOT_FOUND', '请回答对应修改项的候选组。');
      this.dialogue.consume(selectionCommand(input) && this.candidates.current() ? `条目#${this.candidates.current()!.id}` : input);
      this.modelCompleting = false;
    } else { this.modelCompleting = this.dialogue.snapshot() !== null; this.progressLookup = null; this.progressGate = null; this.outsideTargets.clear(); }
    this.selectionQuestion = null;
  }
  endTurn(completed: boolean): void {
    if (!completed) { this.operations.invalidate(); this.candidates.restoreSnapshot(this.priorCandidates); this.dialogue.clear(); this.creationPhase = null; this.outsideTargets.clear(); this.progressGate = null; this.progressLookup = null; this.selectionQuestion = null; this.readTask = null; this.readContinuation = null; this.taskQuestion = null; }
  }
  question(): string | null { return this.progressGate?.question ?? this.selectionQuestion?.text ?? this.taskQuestion?.text ?? (this.modelCompleting ? null : this.dialogue.question()); }
  stopped(): string | null { return this.stopReason; }
  private parseProgress(value: unknown) {
    try { return progressRequest(value); } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_INPUT') {
        const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object'
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : item;
        const key = JSON.stringify(sorted(value));
        if (this.invalidProgress.has(key)) this.stopReason = `已停止重复的无效进度调用；未提交此次写入。${error.message}`;
        this.invalidProgress.add(key);
      }
      throw error;
    }
  }
  observeAnswer(content: string): void {
    const set = this.candidates.snapshot().sets.at(-1);
    if (this.selectionQuestion || !set || set.id !== this.searchedSetId || set.items.length < 2 || this.candidates.current()) return;
    const text = subjectSelectionQuestion(content);
    if (text) this.selectionQuestion = { setId: set.id, text };
  }
  awaitingSelection(): { setId: string; text: string } | null {
    const pending = this.dialogue.snapshot();
    const set = this.candidates.set(pending?.candidateSetId);
    if (!set || set.items.length < 2) return null;
    if (pending?.subjectId === null) return { setId: set.id, text: this.dialogue.question()! };
    if (this.candidates.current()) return null;
    if (this.selectionQuestion?.setId === set.id) return structuredClone(this.selectionQuestion);
    return null;
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
  context(): string { return `本次任务已核实的作品集合：${JSON.stringify(this.candidates.objects())}。本轮明确指代的上文事实：${JSON.stringify(this.referenceFrame)}。已读取作品与候选来源：${JSON.stringify(this.candidates.snapshot().sets)}。本轮读取目标：${JSON.stringify(this.readTask ?? this.readContinuation)}。没有默认作品，每项操作须明确对象参数；名称、编号及“它”均需从真实输入提取，模型不能从多对象中猜测或先读取一部来缩小原有歧义。新任务不会继承写入范围，历史事实不提供授权。候选编号按具体candidateSet原始顺序。${this.dialogue.context()}`; }
  private querySelection(set: CandidateSet): { awaitingUser?: true; question?: string; candidateSet?: CandidateSet } {
    const matches = this.candidates.targetMatches(this.readTask);
    if (this.readTask?.mode === 'single' && matches.length > 1 && !this.candidates.current()) {
      if (matches.some(item => !set.items.some(candidate => candidate.id === item.id))) {
        set = this.candidates.add(matches); this.display.candidates?.(set);
      }
      this.selectionQuestion = { setId: set.id, text: '有多个条目或季度符合查询，请选择具体作品；选择后继续原查询，不会设置个人评分。' };
      return { awaitingUser: true, question: this.selectionQuestion.text, candidateSet: set };
    }
    return {};
  }
  canHandleUser(input: string, history: readonly Message[]): boolean {
    this.hydrate(history); return this.canHandleProgressGate(input) || this.dialogue.canHandleAnswer(input);
  }
  canHandleProgressGate(input: string): boolean {
    return Boolean(this.progressGate && /^(?:继续修改|继续|确认继续|确认执行|坚持修改|仍要修改|是|是的|取消|取消修改|算了|先不改)[。！!]?$/u.test(input.trim()));
  }
  resetRequests(): void { this.operations.invalidate(); this.dialogue.clear(); this.creationPhase = null; this.candidates.clearTask(); this.outsideTargets.clear(); this.progressGate = null; this.progressLookup = null; this.selectionQuestion = null; this.selectionAnswer = null; this.readTask = null; this.readContinuation = null; this.taskQuestion = null; this.searchedSetId = null; this.input = ''; this.directGranted = false; }
  scopeContext(): unknown {
    const pending = this.dialogue.snapshot();
    return { objects: this.candidates.objects(), references: this.candidates.references(), candidateCount: this.candidates.snapshot().sets.at(-1)?.items.length ?? 0,
      pending: pending ? { kind: pending.draft.mutation?.kind ?? 'collection', missing: pending.draft.missing, needsStatus: pending.needsStatus } : this.taskQuestion ? { kind: 'read', goal: this.taskQuestion.task.goal } : null };
  }
  async handleUser(input: string, history: readonly Message[], signal: AbortSignal): Promise<string | OperationPlan> {
    if (this.canHandleProgressGate(input)) {
      const gate = this.progressGate!;
      if (/^(?:取消|算了|先不改)/u.test(input.trim())) { this.resetRequests(); return '已取消此次进度修改。'; }
      this.progressGate = null;
      const account = await this.client.currentUser(signal);
      if (account.id !== gate.accountId) { this.resetRequests(); throw new AppError('ACCOUNT_CHANGED', '确认继续期间账户改变，请重新提出修改。'); }
      this.input = gate.source; this.modelCompleting = false; this.directGranted = false;
      this.progressLookup = { source: gate.source, account, allowedOutside: true };
      if (gate.batchTarget !== undefined) {
        this.outsideTargets.add(gate.batchTarget);
        return await this.continueRequest(signal) ?? '请补齐任务修改项。';
      }
      this.dialogue.clear();
      if (gate.reference.kind === 'name') {
        const result = await this.client.search(gate.reference.name, undefined, 20, signal);
        const set = this.candidates.add(result.data); this.display.candidates?.(set);
      } else if (gate.reference.kind === 'id') {
        const subject = await this.client.subject(gate.reference.id, signal); this.candidates.add([subject]);
      }
      this.dialogue.propose({ reference: gate.reference, mutation: { kind: 'progress', progress: gate.progress }, missing: null }, gate.source);
      return await this.continueRequest(signal) ?? '未找到唯一作品，请提供完整作品名或条目链接。';
    }
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
  private async lookupProgress(reference: Reference, progress: ProgressRequest, signal?: AbortSignal): Promise<string | null> {
    const source = this.dialogue.snapshot()?.sources[0] ?? this.input;
    if (!this.mcp || progress.mode === 'book' || this.progressLookup?.source === source) return null;
    const selected = this.candidates.resolve(reference);
    const matches: unknown[] = [];
    const seen = new Set<number>(); let account: { id: number; username: string } | undefined; let total: number | undefined;
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await this.client.collections({ status: 'in_progress', limit: 100, offset }, signal);
      if (account && page.account.id !== account.id) throw new AppError('ACCOUNT_CHANGED', '在看列表读取期间账户改变。');
      account = page.account;
      if (page.scope.status !== 'in_progress' || total !== undefined && total !== page.total || page.total > 10000
        || page.offset !== offset || page.data.length !== Math.min(100, Math.max(0, page.total - offset))) throw new AppError('INCOMPLETE_COLLECTION', '在看列表不完整，不能推断目标不存在。');
      total = page.total;
      for (const item of page.data) {
        if (seen.has(item.subjectId) || item.status !== 'in_progress') throw new AppError('INCOMPLETE_COLLECTION', '在看列表重复或状态不一致。');
        seen.add(item.subjectId);
        const match = reference.kind === 'name' ? [item.name, item.nameCn].some(name => normalizeSubjectName(name) === normalizeSubjectName(reference.name))
          : item.subjectId === (reference.kind === 'id' ? reference.id : selected?.id);
        if (match && ['anime', 'real'].includes(item.type)) matches.push({ id: item.subjectId, name: item.name, nameCn: item.nameCn, type: item.type });
      }
      if (seen.size === total) break;
      if (page.nextOffset !== offset + 100) throw new AppError('INCOMPLETE_COLLECTION', '在看列表分页未继续。');
    }
    if (!account || seen.size !== total) throw new AppError('INCOMPLETE_COLLECTION', '在看列表读取未完成。');
    this.progressLookup = { source, account, allowedOutside: false };
    if (matches.length) {
      const set = this.candidates.add(matches); this.display.candidates?.(set);
      if (matches.length === 1) this.candidates.focus(set.items[0]!);
      return null;
    }
    const title = reference.kind === 'name' ? reference.name : selected?.title ?? (reference.kind === 'id' ? `条目 #${reference.id}` : '该作品');
    const question = `在看列表中未找到《${title}》。是否仍要查找并修改进度？回复“继续修改”或“取消”。`;
    this.progressGate = { source, reference: selected && (reference.kind === 'current' || reference.kind === 'index') ? { kind: 'id', id: selected.id } : reference, progress, accountId: account.id, question };
    return question;
  }
  private async continueRequest(signal?: AbortSignal): Promise<string | OperationPlan | null> {
    if (this.dialogue.snapshot()?.draft.mutation?.kind === 'delete') { this.dialogue.clear(); return '条目取消收藏暂未开放，请在 Bangumi 网站操作。'; }
    const question = this.dialogue.question(); if (question) return question;
    const pending = this.dialogue.snapshot();
    if (!pending || pending.subjectId === null || !pending.draft.mutation) return null;
    const requests = this.dialogue.all();
    const id = pending.subjectId; const mutation = pending.draft.mutation;
    try {
      const status = this.dialogue.statusForCreation();
      if (status !== null && mutation.kind === 'progress') {
        // 本轮状态选择只授权创建收藏。后续进度重新读取，展示具体预览后确认。
        const creation = await this.preview({ operations: [{ subjectId: id, patch: { status } }] }, signal, false,
          mutationIntent(id, { kind: 'collection', patch: { status } }));
        if (requests.length > 1 && creation.state === 'pending') {
          this.creationPhase = { planId: creation.id, index: this.dialogue.active() }; return creation;
        }
        if (!creation.results?.every(result => result.state === 'success')) { this.dialogue.clear(); return creation; }
        this.dialogue.creationCompleted(this.dialogue.active());
      }
      if(mutation.kind === 'delete') {
        this.dialogue.clear(); throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
      }
      const plan = await this.preview({ operations: requests.map(request => ({ subjectId: request.subjectId,
        ...(request.draft.mutation?.kind === 'collection' ? { patch: request.draft.mutation.patch }
          : request.draft.mutation?.kind === 'progress' ? { progress: request.draft.mutation.progress } : {}) })) }, signal, null);
      this.dialogue.clear(); return plan;
    } catch (error) {
      if (error instanceof AppError && error.code === 'COLLECTION_REQUIRED') {
        this.dialogue.requireStatus(); return this.dialogue.question();
      }
      if (error instanceof AppError && error.code === 'PROGRESS_CONTINUATION_REQUIRED') return error.message;
      if (error instanceof AppError && error.code === 'NO_CHANGE') { this.dialogue.clear(); return error.message; }
      this.dialogue.clear();
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
    if (this.modelCompleting) { this.dialogue.clear(); this.creationPhase = null; this.modelCompleting = false; }
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
      if (Object.keys(args).some(key => !['sourceText', 'reference', 'kind', 'patch', 'progress', 'missing', 'operations'].includes(key))
        || args.sourceText !== this.input || unsafeMutationText(this.input)) throw new AppError('AUTHORIZATION_REQUIRED', '提案必须来自本轮真实修改请求；不能从外部文本、否定或问句取得授权。');
      assertSubjectMutationRequest(this.input);
      const many = args.operations !== undefined;
      if (many && (Object.keys(args).some(key => !['sourceText', 'operations'].includes(key)) || !Array.isArray(args.operations) || !args.operations.length || args.operations.length > 20)) throw new AppError('INVALID_INPUT', 'operations须为1～20项，不能混用单项参数。');
      const items = (many ? args.operations as unknown[] : [{ target: { kind: 'subject', ...(args.reference === undefined ? {} : { reference: args.reference }) },
        kind: args.kind, patch: args.patch, progress: args.progress, missing: args.missing }]).map(value => {
        const item = object(value, '修改项');
        if (Object.keys(item).some(key => !['target', 'kind', 'patch', 'progress', 'missing'].includes(key))) throw new AppError('INVALID_INPUT', '修改项包含未声明字段。');
        const target = this.parseTarget(item.target);
        let mutation: Mutation | null = null;
        if (item.kind === 'collection' && item.patch !== undefined && item.progress === undefined && item.missing === undefined) mutation = { kind: 'collection', patch: collectionPatch(item.patch) };
        else if (item.kind === 'progress' && item.progress !== undefined && item.patch === undefined && item.missing === undefined) mutation = { kind: 'progress', progress: this.parseProgress(item.progress) };
        else if (item.kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
        else if (!(item.kind === 'collection' && ['rate', 'status'].includes(String(item.missing)) && item.patch === undefined && item.progress === undefined)) throw new AppError('INVALID_INPUT', '解析提案操作与参数不匹配。');
        const { reference, ...metadata } = target;
        const draft: PendingRequest['draft'] = { reference, mutation, missing: item.missing === 'rate' || item.missing === 'status' ? item.missing : null };
        return { ...metadata, draft };
      });
      const single = items.length === 1 ? items[0]! : null;
      if (single?.draft.mutation?.kind === 'progress' && single.draft.reference.kind !== 'missing'
        && (single.draft.reference.kind !== 'current' || this.candidates.resolve(single.draft.reference))) {
        const selected = this.candidates.resolve(single.draft.reference, false, single.candidateSetId, single.type);
        const question = await this.lookupProgress(single.draft.reference, single.draft.mutation.progress, options?.signal);
        if (question) return { awaitingUser: true, clarification: question };
        if (selected && (single.draft.reference.kind === 'current' || single.draft.reference.kind === 'index')) single.draft.reference = { kind: 'id', id: selected.id };
      }
      for (const item of items) {
        if (this.mcp && item.draft.reference.kind === 'name' && !this.candidates.resolve(item.draft.reference, false, item.candidateSetId, item.type)) {
          const result = await this.client.search(item.draft.reference.name, undefined, 20, options?.signal);
          const set = this.candidates.add(result.data); this.searchedSetId = set.id; this.display.candidates?.(set);
        }
      }
      const canonical = mutationFrom(this.input);
      this.dialogue.proposeMany(items, this.input, canonical ? canonical.reference.kind === 'id' ? canonical.reference.id : this.userReference(canonical.reference)?.id ?? null : null);
      if (this.dialogue.question()) this.dialogue.bindAccount((await this.client.currentUser(options?.signal)).id);
      const result = await this.continueRequest(options?.signal);
      return typeof result === 'string' ? { clarification: result, request: this.dialogue.snapshot(), requests: this.dialogue.all() } : result;
    }
    if (name === 'resolve_reference') {
      const args = object(value, '工具参数');
      if (typeof args.reference !== 'string' || !args.reference.trim() || Object.keys(args).some(key => !['reference', 'candidateSetId'].includes(key))) throw new AppError('INVALID_INPUT', 'resolve_reference需要真实原文中的明确指代。');
      const target = this.parseTarget({ kind: 'subject', ...args });
      const selected = this.candidates.resolve(target.reference, false, target.candidateSetId);
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
      let args = { ...input };
      const types = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
      if (input.type !== undefined) {
        const subjectType = types[mediaType(input.type)];
        if (input.subject_type !== undefined && input.subject_type !== subjectType) throw new AppError('INVALID_INPUT', 'type 与 subject_type 媒体类型不一致。');
        args.subject_type = subjectType; delete args.type;
      }
      args = schemaArguments(dialogueSearchSchema, args);
      const task = args.task;
      delete args.task;
      const parameters = validateToolArguments(name, args);
      if (task !== undefined) this.acceptReadTask(task);
      const raw = object(await this.mcp!.call(name, parameters, options?.signal));
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
        const result = await this.mcp!.call(name, args, options?.signal);
        if (name === 'get_subject_details') { const subject = subjectFrom(result); this.candidates.remember({ id: subject.id, title: subject.nameCn || subject.name, type: subject.type, url: subject.url }); }
        return result;
      }
      if (name === 'update_single_episode_collection') {
        assertSubjectMutationRequest(this.input);
        // 原名工具只复用已绑定的真实父作品；不能凭模型提供的章节ID建立对象授权。
        const status = Number(args.collection_type ?? 2);
        for (const plan of this.completedSimple.values()) {
          if (plan.actions.some(action => action.changes.length === 1
            && action.changes[0]!.field === `episode:${args.episode_id}` && action.changes[0]!.after === status)) {
            if ((await this.client.currentUser(options?.signal)).id !== plan.accountId) throw new AppError('ACCOUNT_CHANGED', '账户改变，旧操作结果不可复用。');
            return structuredClone(plan);
          }
        }
        const saved = this.dialogue.all().find(request => request.draft.mutation?.kind === 'progress');
        const named = this.namedSubjects(this.input);
        let parentId = saved?.subjectId ?? (named.length === 1 ? named[0]!.id : undefined);
        if (parentId == null) {
          const detail = object(await this.mcp!.call('get_single_episode_collection', { episode_id: args.episode_id }, options?.signal));
          parentId = positiveId(detail.subject_id);
          if (!this.boundSubject(parentId)) throw new AppError('SELECTION_REQUIRED', '请先用propose_dialogue_request绑定真实原文与作品，再修改该作品的章节。');
        }
        const pending = this.dialogue.snapshot();
        const explicitEpisode = new RegExp(`(?:/(?:ep|episode)/|(?:章节|单集)(?:\\s*ID)?\\s*#?\\s*)${args.episode_id}(?!\\d)`).test(this.input);
        if (pending?.draft.mutation?.kind !== 'progress' && !explicitEpisode) throw new AppError('SELECTION_REQUIRED', '请使用propose_dialogue_request说明本季序号或具体章节并绑定真实原文；不能从章节ID猜测用户目标。');
        return this.preview({ operations: [{ subjectId: parentId, progress: { mode: 'explicit', episodeId: args.episode_id, status: args.collection_type ?? 2 } }] }, options?.signal, true);
      }
      if (name !== 'update_subject_collection') assertMcpMutationIntent(name, args, this.input);
      else assertSubjectMutationRequest(this.input);
      if (name === 'update_subject_collection') {
        const question = this.dialogue.question();
        if (question) throw new AppError('SELECTION_REQUIRED', question);
        const patch: Record<string, unknown> = {};
        for (const [key, field] of Object.entries({ collection_type: 'status', rating: 'rate', comment: 'comment', tags: 'tags', private: 'private' })) if (args[key] !== undefined) patch[field] = args[key];
        const hasProgress = args.ep_status !== undefined || args.vol_status !== undefined;
        if (hasProgress && Object.keys(patch).length) {
          const id = positiveId(args.subject_id); const bound = this.dialogue.snapshot()?.subjectId;
          if (bound != null && bound !== id || !new RegExp(`(?:/subject/|(?:条目|作品|书籍)\\s*#?\\s*|^#?)${id}(?!\\d)`).test(this.input)
            && !this.boundSubject(id) && bound !== id) throw new AppError('SELECTION_REQUIRED', '混合修改的书籍对象须绑定本次真实任务的作品。');
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
          && !this.boundSubject(subjectId)) throw new AppError('SELECTION_REQUIRED', '章节修改须绑定本次真实任务的作品。');
        if ((args.episode_ids as number[]).length === 1) return this.preview({ operations: [{ subjectId, progress: { mode: 'explicit', episodeId: (args.episode_ids as number[])[0], status: args.collection_type ?? 2 } }] }, options?.signal, true);
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
      const subject = object(result);
      this.candidates.remember({ id: positiveId(subject.id), title: String(subject.nameCn || subject.name),
        type: mediaType(subject.type), url: `https://bgm.tv/subject/${subject.id}` });
    }
    if (name === 'get_progress') {
      const subject = object(object(result).subject);
      this.candidates.remember({ id: positiveId(subject.id), title: String(subject.nameCn || subject.name), type: mediaType(subject.type), url: String(subject.url) });
    } else if (['get_collection', 'list_episodes'].includes(name)) {
      const known = this.candidates.resolve({ kind: 'id', id: positiveId(object(value).subjectId) });
      if (known) this.candidates.remember(known);
    }
    return result;
  }
  private acceptReadTask(value: unknown): ReadTask {
    const source = object(value, '读取任务').sourceText;
    if (source !== this.input && source !== this.readContinuation?.sourceText) throw new AppError('INVALID_INPUT', '任务原文必须由宿主持有，不能由模型或外部结果替换。');
    const task = readTaskFrom(value, String(source));
    this.readTask = task; return task;
  }
  private explicitSubject(id: number): boolean {
    return new RegExp(`(?:/subject/|#|(?:条目|作品)\\s*)${id}(?!\\d)`).test(this.input);
  }
  private parseTarget(value: unknown) {
    const target = subjectTarget(value, this.input);
    if (target.reference.kind === 'index' && target.candidateSetId && target.candidateSetId !== this.candidates.set()?.id && !this.input.includes(target.candidateSetId)) {
      throw new AppError('SELECTION_REQUIRED', '原文未说明旧候选组，不能由模型把编号改绑到另一组。');
    }
    if (target.reference.kind === 'current') {
      const resolved = this.userReference(target.reference);
      target.reference = resolved ? { kind: 'id', id: resolved.id } : { kind: 'missing' };
    }
    return target;
  }
  private userReference(reference: Reference): Candidate | null {
    if (reference.kind !== 'current') return this.candidates.resolve(reference);
    return !this.referenceFrame.ambiguous && this.referenceFrame.objects.length === 1 ? structuredClone(this.referenceFrame.objects[0]!) : null;
  }
  private namedSubjects(source: string): Candidate[] {
    const text = normalizeSubjectName(source);
    const known = this.candidates.known();
    const named = known.filter(item => [item.title, ...(item.aliases ?? [])].some(name => {
      const normalized = normalizeSubjectName(name);
      return normalized && text.includes(normalized) && this.candidates.resolve({ kind: 'name', name })?.id === item.id;
    }));
    // 同系列完整季度名包含基础名时，只保留原文明确的最长名称。
    return named.filter(item => !named.some(other => other.id !== item.id && normalizeSubjectName(other.title).startsWith(normalizeSubjectName(item.title))
      && normalizeSubjectName(other.title) !== normalizeSubjectName(item.title)));
  }
  private boundSubject(id: number): boolean {
    if (this.dialogue.all().some(request => request.subjectId === id) || this.explicitSubject(id)) return true;
    const draft = mutationFrom(this.input);
    if (draft && (draft.reference.kind === 'id' ? draft.reference.id : this.userReference(draft.reference)?.id) === id) return true;
    return this.namedSubjects(this.input).some(item => item.id === id);
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
  private async preview(value: unknown, signal?: AbortSignal, progress: boolean | null = false, boundIntent?: ReturnType<typeof mutationIntent>): Promise<OperationPlan> {
    const args = object(value, '工具参数');
    if (Object.keys(args).some(key => key !== 'operations') || !Array.isArray(args.operations) || !args.operations.length || args.operations.length > 20) throw new AppError('INVALID_INPUT', '预览需要1～20项 operations。');
    const requests = args.operations.map(value => {
      const item = object(value, '操作');
      const isProgress = progress === null ? item.progress !== undefined : progress;
      if (Object.keys(item).some(key => !['subjectId', 'target', isProgress ? 'progress' : 'patch'].includes(key))) throw new AppError('INVALID_INPUT', '操作包含未声明字段。');
      return { subjectId: positiveId(item.subjectId), value: isProgress ? this.parseProgress(item.progress) : collectionPatch(item.patch), isProgress,
        target: item.target === undefined ? undefined : this.parseTarget(item.target) };
    });
    if (new Set(requests.map(item => item.subjectId)).size !== requests.length) throw new AppError('INVALID_INPUT', '同一条目只能出现一次。');
    const states = this.dialogue.all();
    if (states.length > 1 && requests.length !== states.length && !boundIntent) throw new AppError('AUTHORIZATION_REQUIRED', '批量提案须保留全部修改项，不能拆分或缩小为单项写入。');
    const directDraft = mutationFrom(this.input);
    const directSubject = directDraft ? directDraft.reference.kind === 'id' ? directDraft.reference.id : this.userReference(directDraft.reference)?.id : null;
    const directIntent = boundIntent ?? (states.length ? this.dialogue.intent() : directDraft?.mutation && directSubject != null
      ? mutationIntent(directSubject, directDraft.mutation) : unsafeMutationText(this.input) ? null : directIntentFrom(this.input, this.userReference({ kind: 'current' })?.id ?? null));
    const bindings = requests.map(request => {
      const state = states.find(state => state.subjectId === request.subjectId);
      if (states.length && !state) throw new AppError('SELECTION_REQUIRED', '工具对象不属于宿主保存的任务修改项。');
      if (request.target) {
        const ref = request.target.reference;
        const id = ref.kind === 'id' ? ref.id : this.candidates.resolve(ref, false, request.target.candidateSetId, request.target.type)?.id;
        if (id !== request.subjectId || request.target.subjectId !== undefined && request.target.subjectId !== id) throw new AppError('SELECTION_REQUIRED', '操作对象参数与真实指代不一致或存在歧义。');
        return state ?? { subjectId: id };
      }
      if (state || directIntent?.subjectId === request.subjectId || this.explicitSubject(request.subjectId)) return state ?? { subjectId: request.subjectId };
      const named = this.namedSubjects(this.input).find(item => item.id === request.subjectId);
      if (!named) throw new AppError('SELECTION_REQUIRED', '每项操作都须绑定真实原文或明确指代，不能沿用默认作品或猜测对象ID。');
      return { subjectId: named.id };
    });
    const source = states[0]?.sources[0] ?? this.input;
    const multipleSource = this.namedSubjects(source).length > 1 || states.length > 1;
    const intent = multipleSource ? null : directIntent;
    const simpleBound = requests.length === 1 && !multipleSource ? bindings[0]!.subjectId : undefined;
    const requestKey = JSON.stringify(requests);
    const completed = this.completedSimple.get(requestKey);
    if (completed) {
      if ((await this.client.currentUser(signal)).id !== completed.accountId) throw new AppError('ACCOUNT_CHANGED', '账户改变，旧操作结果不可复用。');
      return structuredClone(completed);
    }
    if (requests.length === 1 && requests[0]!.isProgress && !this.progressLookup && simpleBound === requests[0]!.subjectId) {
      const reference = states[0]?.draft.reference ?? directDraft?.reference ?? { kind: 'id' as const, id: requests[0]!.subjectId };
      const question = await this.lookupProgress(reference, requests[0]!.value as ProgressRequest, signal);
      if (question) throw new AppError('PROGRESS_CONTINUATION_REQUIRED', question);
    }
    signal?.throwIfAborted(); const user = this.progressLookup?.account ?? await this.client.currentUser(signal); this.dialogue.bindAccount(user.id);
    const writer = 'collectionSnapshot' in this.client ? this.client as BangumiWriteClient : undefined;
    const actions: PlannedAction[] = [];
    const unchanged: { subjectId: number; title: string }[] = [];
    for (const request of requests) {
      const requestState = states.find(state => state.subjectId === request.subjectId);
      if (requestState) this.dialogue.activate(states.indexOf(requestState));
      signal?.throwIfAborted();
      const subject = await this.client.subject(request.subjectId, signal);
      if (subject.id !== request.subjectId) throw new AppError('INVALID_RESPONSE', '详情返回了其他条目，已停止预览。');
      this.candidates.remember({ id: subject.id, title: subject.nameCn || subject.name, type: subject.type, url: subject.url });
      if (requestState?.type && requestState.type !== subject.type || request.target?.type && request.target.type !== subject.type) throw new AppError('SELECTION_REQUIRED', '操作对象的媒体类型不一致。');
      let collection;
      try { collection = writer ? await writer.collectionSnapshot(request.subjectId, signal) : await this.client.collection(request.subjectId, signal); }
      catch (error) {
        // 此读取在计划生成及 journal.started 之前；仅在这里标记未提交，不改变写后未知结果。
        if (error instanceof AppError) throw new AppError(error.code, `${error.message} 此操作在核对阶段停止，尚未提交修改。`);
        throw error;
      }
      if (request.isProgress) {
        if (!writer) throw new AppError('UNSUPPORTED_OPERATION', '进度写入适配器不可用。');
        const requestValue = progressRequest(request.value);
        if (this.mcp && ['anime', 'real'].includes(subject.type) && collection?.status !== 3 && !this.outsideTargets.has(subject.id) && !(states.length < 2 && this.progressLookup?.allowedOutside)) {
          const reference = requestState?.draft.reference ?? { kind: 'id' as const, id: subject.id };
          const question = `《${subject.nameCn || subject.name}》不在在看列表中。是否仍要修改进度？回复“继续修改”或“取消”。`;
          this.progressGate = { source: requestState?.sources[0] ?? this.input, reference, progress: requestValue, accountId: user.id, question,
            ...(states.length > 1 ? { batchTarget: subject.id } : {}) };
          throw new AppError('PROGRESS_CONTINUATION_REQUIRED', question);
        }
        const episodes = subject.type === 'anime' || subject.type === 'real' ? await writer.progressEpisodes(subject.id, user.id, signal) : undefined;
        let action: PlannedAction;
        try { action = progressAction(subject, collection, requestValue, episodes); }
        catch (error) {
          if (!(error instanceof AppError && error.code === 'NO_CHANGE')) throw error;
          unchanged.push({ subjectId: subject.id, title: subject.nameCn || subject.name }); continue;
        }
        const saved = requestState?.draft.mutation;
        if (saved && (saved.kind !== 'progress' || JSON.stringify(progressAction(subject, collection, saved.progress, episodes).changes) !== JSON.stringify(action.changes))) throw new AppError('AUTHORIZATION_REQUIRED', '工具参数改变了已绑定的单集目标或状态。');
        actions.push(action);
      } else {
        let action: PlannedAction;
        try { action = writer ? collectionWriteAction(subject, collection, request.value) : collectionAction(subject, collection!, request.value); }
        catch (error) {
          if (!(error instanceof AppError && error.code === 'NO_CHANGE')) throw error;
          unchanged.push({ subjectId: subject.id, title: subject.nameCn || subject.name }); continue;
        }
        const saved = requestState?.draft.mutation;
        if (saved && !boundIntent && (saved.kind !== 'collection' || JSON.stringify(collectionWriteAction(subject, collection, saved.patch).changes) !== JSON.stringify(action.changes))) throw new AppError('AUTHORIZATION_REQUIRED', '工具参数改变了已绑定的收藏修改。');
        actions.push(action);
      }
    }
    if (!actions.length) throw new AppError('NO_CHANGE', '已核实的作品当前均符合要求，无需修改。');
    signal?.throwIfAborted();
    if (!this.mcp || !actions.every(usesPreparedBaseline)) {
      if ((await this.client.currentUser(signal)).id !== user.id) throw new AppError('ACCOUNT_CHANGED', '预览期间账户改变，请重新读取。');
    }
    signal?.throwIfAborted();
    const targetKey = JSON.stringify({ account: user.id, targets: actions.map(action => ({ id: action.subjectId, kind: action.kind, changes: action.changes.map(change => ({ field: change.field, after: change.after })) })) });
    const prior = this.completedSimple.get(targetKey);
    if (prior) return structuredClone(prior);
    this.operations.invalidate();
    const simple = actions.length === 1 ? simpleMutationIntent(actions[0]!, simpleBound) : null;
    const plan = this.operations.prepare(user.id, actions, this.directGranted ? null : simple ?? intent, unchanged);
    if (plan.state === 'authorized') this.directGranted = true;
    this.display.plan?.(plan);
    if (plan.state === 'authorized' && plan.writeAvailable) {
      await this.operations.execute(plan.id, signal ?? new AbortController().signal);
      const finished = this.operations.get(plan.id);
      if (simple) { this.completedSimple.set(requestKey, finished); this.completedSimple.set(targetKey, finished); }
      this.display.plan?.(finished); return finished;
    }
    return plan;
  }
}
