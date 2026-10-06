import { randomUUID } from 'node:crypto';
import { AppError } from '../support/errors.js';
import { compileSchema } from '../support/tool-schema.js';
import { type AccessContext } from './access-context.js';
import { CANDIDATE_FIELDS, DEFAULT_CANDIDATE_FIELDS, validateCandidateFilter, type CandidateFactPatch, type CandidateField,
  type CandidateFilter, type CandidateInclude, type CandidateQueryArgs, type CandidateResponse, type CandidateRow,
  type CandidateSeed, type CandidateSource, type CandidateScopeCoverage } from './candidate-contract.js';
import { CandidateQuery, evaluateCandidateFacts } from './candidate-query.js';
import { candidateSubjectForm } from './candidate-readers.js';
import { CandidateStore, candidateRow, candidateCoverageDependency, mergeCandidateCoverageDependencies, mergeCandidateFacts, mergeCandidateSources, summarizeCandidateCoverage,
  type CandidateBinding, type CandidateQualification, type CandidateSet } from './candidate-store.js';
import { checkPageMetadata } from './subject-output.js';
import { candidateLineageInputSchema, validateRelationArguments, type CandidateLineageArgs, type CandidateLineageResponse,
  type RelationLineage, type RelationQueryArgs, type RelationResponse, type RelationStage } from './relation-contract.js';
import { validateContinuationDisplay, type ContinuationDisplay, type SubjectContinuationPlan } from './continuation-contract.js';

export interface RelationSubjectRow {
  id: number; relation?: string | null; [field: string]: unknown;
}
export interface RelationReadPage {
  data: RelationSubjectRow[];
  page: { offset: number; limit: number; total: number | null; returnedCount: number; nextOffset: number | null; complete: boolean;
    totalKind?: 'exact' | 'estimated' | 'unknown'; excludedNsfwCount?: number; unknownNsfwCount?: number;
    sourceNextOffset?: number | null; sourceHasMore?: boolean };
  accessContext?: AccessContext; sources?: CandidateSource[]; scope?: Record<string, unknown>; candidateRequiresNsfw?: boolean;
}
export interface RelationQueryDependencies {
  /** 规范原生结果必须已核对父对象、账户与可见范围；每父来源数组可由适配层缓存，分页不得重复网络读取。 */
  readRelations(parentId: number, offset: number, limit: number, signal?: AbortSignal): Promise<RelationReadPage>;
  loadFacts(row: CandidateRow, fields: CandidateField[], include: CandidateInclude[], signal?: AbortSignal,
    args?: CandidateQueryArgs): Promise<CandidateFactPatch>;
  /** 候选输入窗口的通用成本规划，来源由宿主核实；不改变筛选条件或关系范围。 */
  prepareWindow?(rows: CandidateRow[], args: CandidateQueryArgs, signal?: AbortSignal): Promise<CandidateSource[]>;
  /** 一次批量关联已读收藏快照，未知缺席不得返回not_collected；媒体/账户/范围由适配层核对。 */
  lookupCollection?(collectionRef: string, rows: CandidateRow[], binding: CandidateBinding): Promise<CandidateSeed[]> | CandidateSeed[];
  shouldYield?(): boolean;
  /** 同时在途读取上限，不是父作品、关系或候选总数上限。 */
  concurrency?: number;
}

type QualifiedSet = CandidateSet;
interface ParentProgress {
  id: number; nextOffset: number | null; scannedCount: number; total: number | null; totalKind: 'exact' | 'estimated' | 'unknown';
  exhausted: boolean; complete: boolean; committed: boolean; failedCode: string | null; requiresNsfw: boolean;
  excludedNsfwCount: number; unknownNsfwCount: number;
  rows: CandidateRow[]; labels: (string | null)[]; sources: CandidateSource[];
}
interface RelationSnapshot {
  binding: CandidateBinding; originParentRef: string; signature: string; startArgs: RelationQueryArgs; cursor: string | null; depth: number;
  inheritedComplete: boolean; parentFilter: CandidateFilter; parentQueryRef: string; parentCursor: string | null;
  parentResultRef: string | null; parentResponse: CandidateResponse | null; parentsDone: boolean; parentRows: CandidateRow[];
  progress: ParentProgress[]; children: Map<number, CandidateRow>;
  edges: Map<number, { parentId: number; relation: string | null; eligible: boolean }[]>;
  eligibleIds: Set<number>; duplicateChildCount: number; relationScannedCount: number;
  rawChildRef: string | null; childQueryRef: string | null; childCursor: string | null; childResponse: CandidateResponse | null;
  childResultRef: string | null; collectionLinked: boolean; sourceDone: boolean; childDone: boolean;
  sourceRefs: string[]; workingRef: string | null; previewRef: string | null;
}
interface SnapshotRef { state: RelationSnapshot; role: 'working' | 'result'; workingRef: string }
const bindingFailures = new Set(['ACCOUNT_CHANGED', 'CANDIDATE_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH',
  'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN']);
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, ordered(child)])) : value;
function signature(args: RelationQueryArgs): string {
  return JSON.stringify(ordered({ parent_filter: args.parent_filter ?? null, relations: args.relations ?? [], exclude_relations: args.exclude_relations ?? [],
    filter: args.filter ?? {}, fields: args.fields ?? DEFAULT_CANDIDATE_FIELDS, include: args.include ?? [],
    hydrate_fields: args.hydrate_fields ?? true, collection_ref: args.collection_ref ?? null }));
}
const resultRef = (value: CandidateResponse): string => (value as CandidateResponse & { resultRef?: string }).resultRef ?? value.candidateRef;
const completedSources = (set: CandidateSet): boolean => set.sources.every(source => source.complete) && set.coverageDependencies.length === 0;

/** 通用宿主关系漏斗：筛父资格→穷尽关系页→去重/关联→筛子；所有工作窗口均可续，不设候选总预算。 */
export class RelationQuery {
  private readonly snapshots = new Map<string, SnapshotRef>();
  private readonly active = new Set<string>();
  constructor(private readonly store: CandidateStore, private readonly dependencies: RelationQueryDependencies) {
    if (dependencies.concurrency !== undefined && (!Number.isSafeInteger(dependencies.concurrency) || dependencies.concurrency < 1 || dependencies.concurrency > 32))
      throw new AppError('INVALID_INPUT', '关联读取并发必须为1至32；此值只限制同时在途网络请求。');
  }
  /** 恢复宿主冻结计划；允许resultRef作为工作阶段别名，但绝不从caller重新猜filter/fields/include。 */
  continuation(ref: string, cursor: string, binding: CandidateBinding, display: ContinuationDisplay = {}): SubjectContinuationPlan {
    validateContinuationDisplay(display); this.store.get(ref, binding);
    const saved = this.snapshots.get(ref);
    if (!saved || saved.state.cursor !== cursor || !cursor)
      throw new AppError('CANDIDATE_CURSOR_MISMATCH', '关联续查游标不属于指定引用，或该阶段已结束。');
    this.checkBinding(saved.state, binding);
    const request: RelationQueryArgs = { ...structuredClone(saved.state.startArgs), ...display, candidate_ref: saved.workingRef, cursor };
    validateRelationArguments(request); return { tool: 'expand_subject_relations', request };
  }
  async execute(args: RelationQueryArgs, binding: CandidateBinding, accessContext?: AccessContext, signal?: AbortSignal): Promise<RelationResponse> {
    validateRelationArguments(args); validateCandidateFilter(args.parent_filter ?? {}); validateCandidateFilter(args.filter ?? {});
    const input = this.store.get(args.candidate_ref, binding) as QualifiedSet;
    if (input.visibility === 'self' && (!accessContext?.account || accessContext.account.id !== input.account?.id))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '关联候选需要匹配的当前账户。');
    if (input.requiresNsfw && (!accessContext?.account || accessContext.account.id !== binding.accountId
      || accessContext.nsfw.allowed !== true || accessContext.nsfw.preference === false))
      throw new AppError('NSFW_SCOPE_CHANGED', '关联候选的来源可见权限已不可用。');
    const previous = this.snapshots.get(args.candidate_ref);
    let state: RelationSnapshot;
    if (args.cursor) {
      if (!previous || previous.role !== 'working' || previous.state.cursor !== args.cursor || previous.state.signature !== signature(args))
        throw new AppError('CANDIDATE_CURSOR_MISMATCH', '关联续页游标与父条件、关系条件、子条件或候选引用不一致。');
      this.checkBinding(previous.state, binding); state = structuredClone(previous.state);
    } else {
      if (previous) this.checkParentQualifications(previous.state, binding);
      // 自本模块继续下钻时只以确证resultRef为父；尚未处理或资格未知的子作品仍留在上阶段工作集。
      const parents = previous && previous.role === 'working' && previous.state.childResultRef
        ? this.store.get(previous.state.childResultRef, binding) as QualifiedSet : input;
      state = { binding: structuredClone(binding), originParentRef: parents.ref, signature: signature(args), startArgs: structuredClone(args), cursor: null,
        depth: (previous?.state.depth ?? 0) + 1, inheritedComplete: !previous || previous.state.childDone && this.complete(previous.state),
        parentFilter: structuredClone(args.parent_filter ?? parents.qualification?.filter ?? {}), parentQueryRef: parents.ref,
        parentCursor: null, parentResultRef: null, parentResponse: null, parentsDone: false, parentRows: [], progress: [],
        children: new Map(), edges: new Map(), eligibleIds: new Set(), duplicateChildCount: 0, relationScannedCount: 0,
        rawChildRef: null, childQueryRef: null, childCursor: null, childResponse: null, childResultRef: null,
        collectionLinked: false, sourceDone: false, childDone: false, sourceRefs: [parents.ref], workingRef: null, previewRef: null };
      validateCandidateFilter(state.parentFilter);
    }
    const activeKey = JSON.stringify([args.candidate_ref, args.cursor ?? null]);
    if (this.active.has(activeKey)) throw new AppError('CANDIDATE_QUERY_BUSY', '同一关联快照正在读取，不能并发续用同一游标。');
    this.active.add(activeKey);
    try {
      const query = new CandidateQuery(this.store, { loadFacts: this.dependencies.loadFacts,
        ...(this.dependencies.prepareWindow ? { prepareWindow: this.dependencies.prepareWindow } : {}),
        ...(this.dependencies.shouldYield ? { shouldYield: this.dependencies.shouldYield } : {}) });
      await this.qualifyParents(state, query, binding, accessContext, signal);
      this.checkParentQualifications(state, binding);
      if (state.parentsDone && !state.sourceDone && !signal?.aborted && !this.dependencies.shouldYield?.())
        await this.readSources(state, args, binding, accessContext, signal);
      if (state.sourceDone && !signal?.aborted && !this.dependencies.shouldYield?.()) {
        if (!state.rawChildRef) await this.prepareChildren(state, args, binding, accessContext);
        if (!state.childDone) await this.qualifyChildren(state, args, query, binding, accessContext, signal);
      }
      return this.response(state, args, binding, accessContext);
    } finally { this.active.delete(activeKey); }
  }
  /** 宿主按需取回直接父边，任何候选派生后仍可沿parentRef找到原图；不把全图自动塞入模型上下文。 */
  lineage(ref: string, subjectIds: number[], binding: CandidateBinding): RelationLineage[] {
    if (subjectIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(subjectIds).size !== subjectIds.length)
      throw new AppError('INVALID_INPUT', '回溯作品ID必须是去重正整数。');
    let current = this.store.get(ref, binding); const wanted = new Set(current.rows.map(row => row.id));
    if (subjectIds.some(id => !wanted.has(id))) throw new AppError('CANDIDATE_ID_MISMATCH', '回溯作品不属于指定候选集合。');
    const visited = new Set<string>();
    while (!visited.has(current.ref)) {
      visited.add(current.ref); const found = this.snapshots.get(current.ref);
      if (found) { this.checkBinding(found.state, binding); return this.lineageRows(found.state, subjectIds); }
      if (!current.parentRef) break; current = this.store.get(current.parentRef, binding);
    }
    return [];
  }
  readLineage(input: CandidateLineageArgs | Record<string, unknown>, binding: CandidateBinding, context?: AccessContext): CandidateLineageResponse {
    if (!compileSchema(candidateLineageInputSchema)(input)) throw new AppError('INVALID_INPUT', '候选回溯参数不符合固定契约。');
    const args = input as CandidateLineageArgs;
    const set = this.store.get(args.candidate_ref, binding), members = new Set(set.rows.map(row => row.id));
    if (set.visibility === 'self' && (!context?.account || context.account.id !== set.account?.id))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选回溯需要匹配的当前账户。');
    if (set.requiresNsfw && (!context?.account || context.account.id !== binding.accountId || context.nsfw.allowed !== true || context.nsfw.preference === false))
      throw new AppError('NSFW_SCOPE_CHANGED', '候选回溯的来源权限已不可用。');
    if (args.subject_ids?.some(id => !members.has(id))) throw new AppError('CANDIDATE_ID_MISMATCH', '回溯作品不属于指定候选集合。');
    let current = set, snapshot: RelationSnapshot | undefined; const visited = new Set<string>();
    while (!visited.has(current.ref)) {
      visited.add(current.ref); const found = this.snapshots.get(current.ref);
      if (found) { this.checkBinding(found.state, binding); snapshot = found.state; break; }
      if (!current.parentRef) break; current = this.store.get(current.parentRef, binding);
    }
    if (!snapshot) throw new AppError('CANDIDATE_LINEAGE_UNAVAILABLE', '候选引用没有可回溯的关联展开证据。');
    const selected = args.subject_ids ?? set.rows.map(row => row.id), offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (offset > selected.length) throw new AppError('INVALID_INPUT', '回溯分页offset超出候选成员数。');
    const ids = selected.slice(offset, offset + limit), parentFacts = new Map(this.store.get(snapshot.parentResultRef ?? snapshot.originParentRef, binding).rows.map(row => [row.id, row]));
    if ([...parentFacts.values()].some(row => row.requiresNsfw) && (!context?.account || context.nsfw.allowed !== true || context.nsfw.preference === false))
      throw new AppError('NSFW_SCOPE_CHANGED', '父作品回溯资料需要当前已核实的可见权限。');
    const data = this.lineageRows(snapshot, ids).map(row => ({ ...row, parents: row.parents.map(parent => {
      const facts = parentFacts.get(parent.parentId);
      return { ...parent, name: facts?.fieldStates.name === 'known' ? facts.facts.name as string : null,
        nameCn: facts?.fieldStates.nameCn === 'known' ? facts.facts.nameCn as string : null,
        subjectType: facts?.fieldStates.subjectType === 'known' ? facts.facts.subjectType as number : null,
        url: `https://bgm.tv/subject/${parent.parentId}` };
    }) }));
    if (data.length !== ids.length) throw new AppError('CANDIDATE_LINEAGE_UNAVAILABLE', '部分候选尚无完整可回溯的关联证据；请先继续原关联阶段。');
    const nextOffset = offset + data.length < selected.length ? offset + data.length : null;
    return { schemaVersion: 1, kind: 'candidate_lineage', candidateRef: set.ref, scope: structuredClone(args), data,
      page: { offset, nextOffset, limit, returnedCount: data.length, totalCount: selected.length, complete: nextOffset === null },
      coverage: summarizeCandidateCoverage(set, 'summary', set.sources), visibility: set.visibility,
      ...(set.account ? { account: structuredClone(set.account) } : {}), readAt: new Date().toISOString(),
      ...(context ? { accessContext: structuredClone(context) } : {}) };
  }
  endReadContext(turnId: string): void {
    for (const [ref, snapshot] of this.snapshots) if (snapshot.state.binding.turnId === turnId) this.snapshots.delete(ref);
  }
  invalidateAccount(accountId: number): void {
    for (const [ref, snapshot] of this.snapshots) if (snapshot.state.binding.accountId === accountId) this.snapshots.delete(ref);
  }
  close(): void { this.snapshots.clear(); this.active.clear(); }
  private checkBinding(state: RelationSnapshot, binding: CandidateBinding): void {
    if (state.binding.turnId !== binding.turnId || state.binding.scopeKey !== binding.scopeKey
      || state.binding.accountId !== null && state.binding.accountId !== binding.accountId)
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '关系快照不属于当前读取轮次、账户或可见范围。');
  }
  /** 关系前提沿已核父引用检查当前缓存事实，不能让后补资料洗掉父筛选资格。 */
  private checkParentQualifications(state: RelationSnapshot, binding: CandidateBinding): void {
    if (!state.parentsDone || !state.parentResultRef) return;
    const parents = this.store.get(state.parentResultRef, binding), members = new Set(parents.rows.map(row => row.id));
    if (state.parentRows.some(row => !members.has(row.id)))
      throw new AppError('CANDIDATE_STAGE_INCOMPLETE', '已核父集合发生变化；请从原父引用复核后重新展开关联。');
    for (const row of parents.rows) for (const filter of [...parents.factFilters, state.parentFilter]) {
      const result = evaluateCandidateFacts(row, filter).result;
      if (result !== 'match') throw new AppError(result === 'unknown' ? 'CANDIDATE_REQUIRED_FACTS_MISSING' : 'CANDIDATE_STAGE_INCOMPLETE',
        '当前父作品事实不能确证原筛选条件；请从原父引用补证复核后重新展开关联。');
    }
  }
  private async qualifyParents(state: RelationSnapshot, query: CandidateQuery, binding: CandidateBinding,
    context?: AccessContext, signal?: AbortSignal): Promise<void> {
    while (!state.parentsDone && !signal?.aborted && (!state.parentResponse || !this.dependencies.shouldYield?.())) {
      const args: CandidateQueryArgs = { candidate_ref: state.parentQueryRef, filter: state.parentFilter, fields: ['id'], limit: 100,
        response_view: 'reference', ...(state.parentCursor ? { cursor: state.parentCursor } : {}) };
      const response = await query.execute(args, binding, context, signal, { forceStage: true });
      state.parentResponse = response; state.parentQueryRef = response.candidateRef; state.parentCursor = response.page.nextCursor;
      state.parentResultRef = resultRef(response); state.parentsDone = response.page.complete;
      if (state.parentsDone) {
        const qualified = this.store.get(state.parentResultRef, binding) as QualifiedSet;
        // 与旧Query兼容时需剔除pending；新契约resultRef自身只含确证通过者。
        const passing = qualified.refRole === 'result' ? new Set(qualified.rows.map(row => row.id))
          : new Set(qualified.qualification?.matchedIds ?? response.data.map(row => row.id));
        state.parentRows = qualified.rows.filter(row => passing.has(row.id));
        state.progress = state.parentRows.map(row => ({ id: row.id, nextOffset: 0, scannedCount: 0, total: null, totalKind: 'exact',
          exhausted: false, complete: false, committed: false, failedCode: null, requiresNsfw: false,
          excludedNsfwCount: 0, unknownNsfwCount: 0, rows: [], labels: [], sources: [] }));
        state.sourceRefs.push(response.candidateRef, state.parentResultRef); state.sourceDone = state.progress.length === 0;
      }
      if (!state.parentsDone && response.stage.processedCount === 0) break;
    }
  }
  private async readSources(state: RelationSnapshot, args: RelationQueryArgs, binding: CandidateBinding,
    context?: AccessContext, signal?: AbortSignal): Promise<void> {
    const budget = args.source_limit ?? 10000, concurrency = this.dependencies.concurrency ?? 4;
    let spent = 0, reserved = 0; const busy = new Set<number>(); const controller = new AbortController();
    const activeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const worker = async (): Promise<void> => {
      while (!activeSignal.aborted && !this.dependencies.shouldYield?.()) {
        const progress = state.progress.find(parent => !parent.exhausted && !parent.failedCode && !busy.has(parent.id));
        if (!progress || spent + reserved >= budget) return;
        busy.add(progress.id);
        try {
          while (!progress.exhausted && !activeSignal.aborted && !this.dependencies.shouldYield?.()) {
            const limit = Math.min(100, budget - spent - reserved); if (limit < 1) break;
            const offset = progress.nextOffset!; reserved += limit;
            let value: RelationReadPage;
            try { value = await this.dependencies.readRelations(progress.id, offset, limit, activeSignal); }
            finally { reserved -= limit; }
            if (activeSignal.aborted) break;
            const validated = this.validatePage(value, progress.id, offset, limit, binding, context);
            const page = value.page;
            if (progress.scannedCount && progress.total !== page.total || progress.scannedCount && progress.totalKind !== (page.totalKind ?? 'exact'))
              throw new AppError('INCOMPLETE_DATA', '同一父作品关系来源总数或性质在续页期间改变。');
            // 整页校验后才修改进度；中止不会保存半页或把失败当不存在。
            progress.rows.push(...validated.rows); progress.labels.push(...validated.labels); progress.sources = mergeCandidateSources(progress.sources, validated.sources);
            progress.requiresNsfw ||= validated.requiresNsfw;
            progress.total = page.total; progress.totalKind = page.totalKind ?? 'exact'; progress.scannedCount += validated.rawCount;
            progress.excludedNsfwCount += page.excludedNsfwCount ?? 0; progress.unknownNsfwCount += page.unknownNsfwCount ?? 0;
            state.relationScannedCount += validated.rawCount; spent += validated.rawCount; progress.nextOffset = page.nextOffset;
            progress.exhausted = page.nextOffset === null;
            if (progress.exhausted) {
              progress.complete = progress.totalKind === 'exact' && progress.total !== null && progress.scannedCount === progress.total
                && !progress.excludedNsfwCount && !progress.unknownNsfwCount;
              progress.sources = progress.sources.map(source => ({ ...source, scannedCount: progress.scannedCount, total: progress.total,
                complete: progress.complete, nextOffset: progress.complete ? null : progress.nextOffset }));
              this.commitParent(state, progress, args);
            }
          }
        } catch (error) {
          if (error instanceof AppError && bindingFailures.has(error.code)) { controller.abort(error); throw error; }
          if (!activeSignal.aborted) progress.failedCode = error instanceof AppError ? error.code : 'READ_FAILED';
        } finally { busy.delete(progress.id); }
        if (spent + reserved >= budget) return;
      }
    };
    const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, state.progress.length) }, worker));
    const fatal = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected'); if (fatal) throw fatal.reason;
    state.sourceDone = state.progress.every(parent => parent.exhausted || parent.failedCode !== null);
  }
  private validatePage(value: RelationReadPage, parentId: number, offset: number, limit: number,
    binding: CandidateBinding, context?: AccessContext): { rows: CandidateRow[]; labels: (string | null)[]; sources: CandidateSource[]; requiresNsfw: boolean; rawCount: number } {
    if (!value || !Array.isArray(value.data) || !value.page || value.page.offset !== offset || value.page.limit !== limit
      || value.page.returnedCount !== value.data.length || value.data.length > limit || value.scope?.subject_id !== undefined && value.scope.subject_id !== parentId)
      throw new AppError('MCP_INVALID_RESULT', '父作品关系分页对象或范围不一致。');
    checkPageMetadata(value.page as unknown as Record<string, unknown>, value.data.length, value.accessContext?.queryCoverage?.totalKind);
    const rawCount = value.page.returnedCount + (value.page.excludedNsfwCount ?? 0) + (value.page.unknownNsfwCount ?? 0);
    if (!Number.isSafeInteger(rawCount) || rawCount > limit || value.page.nextOffset !== null && value.page.nextOffset !== offset + rawCount)
      throw new AppError('INCOMPLETE_DATA', '关系来源分页存在跳项或无进度。');
    if (value.accessContext?.mode === 'account' && value.accessContext.account?.id !== binding.accountId)
      throw new AppError('ACCOUNT_CHANGED', '关系来源账户与宿主候选绑定不一致。');
    const restricted = value.candidateRequiresNsfw === true || value.accessContext?.nsfwApplied === true || value.data.some(row => row.nsfw === true);
    if (restricted && (!context?.account || context.account.id !== binding.accountId || context.nsfw.allowed !== true || context.nsfw.preference === false))
      throw new AppError('NSFW_SCOPE_CHANGED', '关系子作品的可见权限与当前宿主范围不一致。');
    const sources = mergeCandidateSources(value.sources ?? [{ tool: 'get_subject_relations', source: value.accessContext?.source ?? 'v0',
      scope: JSON.stringify({ subject_id: parentId }), scannedCount: offset + rawCount, total: value.page.total,
      nextOffset: value.page.nextOffset, complete: false, privateRecords: value.accessContext?.source === 'p1' ? 'included' : 'not_applicable' }]);
    const rows: CandidateRow[] = [], labels: (string | null)[] = [];
    for (const raw of value.data) {
      if (raw.relation !== undefined && raw.relation !== null && (typeof raw.relation !== 'string' || raw.relation.length > 300))
        throw new AppError('MCP_INVALID_RESULT', '关系标签类型或长度无效。');
      const facts = Object.fromEntries(CANDIDATE_FIELDS.filter(field => field !== 'relations' && Object.hasOwn(raw, field)).map(field => [field, raw[field]]));
      if (!Object.hasOwn(facts, 'subjectForm')) facts.subjectForm = raw.subjectType === 2 ? candidateSubjectForm(raw) : null;
      rows.push(candidateRow({ id: raw.id, facts, sources, requiresNsfw: restricted || raw.nsfw === true }));
      labels.push(typeof raw.relation === 'string' && raw.relation.trim() ? raw.relation : null);
    }
    return { rows, labels, sources, requiresNsfw: restricted, rawCount };
  }
  private commitParent(state: RelationSnapshot, progress: ParentProgress, args: RelationQueryArgs): void {
    if (progress.committed) return;
    for (let index = 0; index < progress.rows.length; index++) {
      const row = mergeCandidateFacts(progress.rows[index]!, { facts: {}, sources: progress.sources }), relation = progress.labels[index]!;
      const unknown = relation === null && (!!args.relations?.length || !!args.exclude_relations?.length);
      const eligible = !unknown && (!args.relations?.length || relation !== null && args.relations.includes(relation))
        && (!args.exclude_relations?.length || relation === null || !args.exclude_relations.includes(relation));
      if (!eligible && !unknown) continue;
      const previous = state.children.get(row.id); if (previous) state.duplicateChildCount++;
      state.children.set(row.id, previous ? mergeCandidateFacts(previous, row) : candidateRow(row));
      const edges = state.edges.get(row.id) ?? [];
      if (!edges.some(edge => edge.parentId === progress.id && edge.relation === relation)) edges.push({ parentId: progress.id, relation, eligible });
      state.edges.set(row.id, edges); if (eligible) state.eligibleIds.add(row.id);
    }
    progress.committed = true; progress.rows = []; progress.labels = [];
  }
  private sources(state: RelationSnapshot, binding: CandidateBinding): CandidateSource[] {
    return mergeCandidateSources(...state.sourceRefs.map(ref => this.store.get(ref, binding).sources), ...state.progress.map(parent => parent.sources));
  }
  private parentDependencies(state: RelationSnapshot, binding: CandidateBinding) {
    const parent = this.store.get(state.parentQueryRef, binding), gap = candidateCoverageDependency(parent);
    return mergeCandidateCoverageDependencies(parent.coverageDependencies, gap ? [gap] : []);
  }
  /** 来源依赖只描述关系读取；父资格和子资格分别由自己的候选快照保存。 */
  private sourceCoverage(state: RelationSnapshot, binding: CandidateBinding): CandidateScopeCoverage {
    const stage = this.relationStage(state, binding);
    return { complete: stage.relationSourceComplete, pendingCount: 0, remainingCount: stage.relationParentsRemainingCount,
      unknownCount: state.progress.reduce((sum, parent) => sum + parent.excludedNsfwCount + parent.unknownNsfwCount
        + (parent.exhausted && !parent.complete && parent.excludedNsfwCount === 0 && parent.unknownNsfwCount === 0 ? 1 : 0), 0),
      failedCount: stage.failedParentCount };
  }
  private async prepareChildren(state: RelationSnapshot, args: RelationQueryArgs, binding: CandidateBinding, context?: AccessContext): Promise<void> {
    if (args.collection_ref && this.dependencies.lookupCollection && !state.collectionLinked) {
      const eligible = [...state.children.values()].filter(row => state.eligibleIds.has(row.id));
      const patches = await this.dependencies.lookupCollection(args.collection_ref, structuredClone(eligible), binding);
      const allowed = new Set(eligible.map(row => row.id));
      if (new Set(patches.map(patch => patch.id)).size !== patches.length || patches.some(patch => !allowed.has(patch.id)))
        throw new AppError('CANDIDATE_ID_MISMATCH', '批量收藏关联返回了范围之外或重复作品。');
      for (const patch of patches) state.children.set(patch.id, mergeCandidateFacts(state.children.get(patch.id)!, patch));
      state.collectionLinked = true;
    }
    const origin = this.store.get(state.originParentRef, binding);
    const personal = args.include?.includes('own_collection') || (args.fields ?? []).some(field => ['personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState'].includes(field))
      || args.filter?.collection_types || args.filter?.exclude_collection_types || args.filter?.personal_rating || args.filter?.personal_tags;
    const account = origin.account ?? (personal ? context?.account ?? undefined : undefined);
    state.rawChildRef = this.store.create({ binding, rows: [...state.children.values()].filter(row => state.eligibleIds.has(row.id)),
      sources: this.sources(state, binding), parentRef: state.originParentRef, visibility: account ? 'self' : 'public', ...(account ? { account } : {}),
      requiresNsfw: origin.requiresNsfw || state.progress.some(parent => parent.requiresNsfw),
      coverageDependencies: this.parentDependencies(state, binding), inheritParentQualification: false, inheritFactFilters: false,
      scopeCoverage: this.sourceCoverage(state, binding) }).ref;
    state.childQueryRef = state.rawChildRef;
  }
  private childArgs(state: RelationSnapshot, args: RelationQueryArgs): CandidateQueryArgs {
    return { candidate_ref: state.childQueryRef!, filter: args.filter ?? {}, fields: args.fields ?? DEFAULT_CANDIDATE_FIELDS,
      include: args.include ?? [], limit: args.limit ?? 50, ...(args.collection_ref ? { collection_ref: args.collection_ref } : {}),
      ...(args.response_view ? { response_view: args.response_view } : {}), ...(args.coverage_mode ? { coverage_mode: args.coverage_mode } : {}),
      ...(args.hydrate_fields === undefined ? {} : { hydrate_fields: args.hydrate_fields }),
      ...(state.childCursor ? { cursor: state.childCursor } : {}) };
  }
  private async qualifyChildren(state: RelationSnapshot, args: RelationQueryArgs, query: CandidateQuery,
    binding: CandidateBinding, context?: AccessContext, signal?: AbortSignal): Promise<void> {
    const response = await query.execute(this.childArgs(state, args), binding, context, signal, { forceStage: true });
    state.childResponse = response; state.childQueryRef = response.candidateRef; state.childResultRef = resultRef(response);
    state.childCursor = response.page.nextCursor; state.childDone = response.page.complete;
  }
  private relationStage(state: RelationSnapshot, binding: CandidateBinding): RelationStage {
    const parent = state.parentResponse?.stage;
    const phase = !state.parentsDone ? 'parents' : !state.sourceDone ? 'relations' : !state.childDone ? 'children' : 'complete';
    const sourceParent = this.store.get(state.originParentRef, binding) as QualifiedSet;
    const qualifiedGap = sourceParent.refRole === 'result' && (sourceParent.qualification?.pendingIds.length ?? 0) > 0;
    const inheritedPending = sourceParent.refRole === 'result' ? sourceParent.qualification?.pendingIds.length ?? 0 : 0;
    const inheritedRemaining = sourceParent.refRole === 'result' ? sourceParent.qualification?.remainingIds.length ?? 0 : 0;
    return { phase, depth: state.depth, parentInputCount: (parent?.inputCount ?? sourceParent.rows.length) + inheritedPending + inheritedRemaining,
      parentProcessedCount: (parent?.processedCount ?? 0) + inheritedPending, parentMatchedCount: parent?.matchedCount ?? 0, parentExcludedCount: parent?.excludedCount ?? 0,
      parentPendingCount: (parent?.pendingCount ?? 0) + inheritedPending,
      parentRemainingCount: (parent?.remainingCount ?? sourceParent.rows.length) + inheritedRemaining,
      relationParentsProcessedCount: state.progress.filter(progress => progress.exhausted || progress.failedCode !== null).length,
      relationParentsRemainingCount: (parent?.matchedCount ?? 0) - state.progress.filter(progress => progress.exhausted || progress.failedCode !== null).length,
      relationScannedCount: state.relationScannedCount, childCount: state.children.size, duplicateChildCount: state.duplicateChildCount,
      failedParentCount: state.progress.filter(progress => progress.failedCode !== null).length,
      unknownRelationChildCount: [...state.children.keys()].filter(id => !state.eligibleIds.has(id)).length,
      parentSourceComplete: state.inheritedComplete && completedSources(sourceParent) && !qualifiedGap
        && (sourceParent.refRole !== 'result' || sourceParent.qualification?.complete !== false),
      parentQualificationComplete: state.parentsDone && (parent?.pendingCount ?? 0) === 0 && !qualifiedGap && inheritedRemaining === 0,
      relationSourceComplete: state.sourceDone && state.progress.every(progress => progress.complete && !progress.failedCode),
      childFilterComplete: state.childDone && (state.childResponse?.stage.pendingCount ?? 0) === 0
        && [...state.children.keys()].every(id => state.eligibleIds.has(id)) };
  }
  private complete(state: RelationSnapshot): boolean {
    const stage = this.relationStage(state, state.binding);
    return stage.parentSourceComplete && stage.parentQualificationComplete && stage.relationSourceComplete && stage.childFilterComplete;
  }
  private lineageRows(state: RelationSnapshot, subjectIds: number[]): RelationLineage[] {
    return subjectIds.flatMap(subjectId => {
      const parents = (state.edges.get(subjectId) ?? []).map(({ parentId, relation }) => ({ parentId, relation }))
        .sort((a, b) => a.parentId - b.parentId || (a.relation ?? '').localeCompare(b.relation ?? ''));
      return parents.length ? [{ subjectId, parentCount: parents.length, parents: structuredClone(parents) }] : [];
    });
  }
  private response(state: RelationSnapshot, args: RelationQueryArgs, binding: CandidateBinding,
    context?: AccessContext): RelationResponse {
    let response = state.childResponse;
    if (!response) {
      const origin = this.store.get(state.originParentRef, binding);
      const filters = [args.filter ?? {}, ...(args.filter?.any_of ?? [])];
      const privateFields = args.include?.includes('own_collection') || (args.fields ?? [])
        .some(field => ['personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState'].includes(field))
        || filters.some(filter => filter.collection_types || filter.exclude_collection_types || filter.personal_rating || filter.personal_tags);
      const account = origin.account ?? (privateFields && !binding.scopeKey.startsWith('public:collections:') ? context?.account ?? undefined : undefined);
      const emptyStage = { inputCount: 0, processedCount: 0, matchedCount: 0, excludedCount: 0, pendingCount: 0, remainingCount: 0 };
      const temporary = this.store.create({ binding, rows: [], sources: this.sources(state, binding), parentRef: origin.ref,
        ...(state.previewRef ? { replaceRef: state.previewRef } : {}), refRole: 'working', resultIds: [],
        qualification: { ...emptyStage, filter: structuredClone(args.filter ?? {}), originRef: origin.ref,
          matchedIds: [], pendingIds: [], remainingIds: [], complete: true },
        visibility: account ? 'self' : 'public', ...(account ? { account } : {}),
        requiresNsfw: origin.requiresNsfw || state.progress.some(parent => parent.requiresNsfw),
        coverageDependencies: this.parentDependencies(state, binding), inheritParentQualification: false, inheritFactFilters: false,
        scopeCoverage: this.sourceCoverage(state, binding) });
      state.previewRef = temporary.ref;
      response = { schemaVersion: 1, kind: 'candidate_page', entity: 'subject_candidate', candidateRef: temporary.ref,
        resultRef: temporary.resultRef!, parentRef: origin.ref, responseView: 'reference', data: [], pending: [],
        fields: [...(args.fields ?? DEFAULT_CANDIDATE_FIELDS)], include: [...(args.include ?? [])], filter: structuredClone(args.filter ?? {}),
        scope: structuredClone(args), stage: emptyStage, set: { workingCount: 0, resultCount: 0 },
        page: { cursor: null, nextCursor: null, limit: args.limit ?? 50, returnedCount: 0, complete: true },
        coverage: summarizeCandidateCoverage(temporary), visibility: temporary.visibility,
        ...(temporary.account ? { account: temporary.account } : {}), readAt: new Date().toISOString(),
        ...(context ? { accessContext: structuredClone(context) } : {}) };
      state.childResultRef = resultRef(response);
    }
    const relationStage = this.relationStage(state, binding), unknownIds = [...state.children.keys()].filter(id => !state.eligibleIds.has(id));
    const work = this.store.get(state.childResponse?.candidateRef ?? response.candidateRef, binding) as QualifiedSet;
    const unknownRows = unknownIds.map(id => state.children.get(id)!);
    const pending = args.response_view === 'reference' ? [] : [...response.pending,
      ...unknownIds.slice(0, Math.max(0, (args.limit ?? 50) - response.pending.length)).map(id => ({ id, missingFields: ['relations'] as CandidateField[], failedFields: [] }))];
    const stage = state.childResponse ? { ...response.stage, inputCount: response.stage.inputCount + unknownIds.length,
      processedCount: response.stage.processedCount + unknownIds.length, pendingCount: response.stage.pendingCount + unknownIds.length }
      : { inputCount: state.children.size, processedCount: 0, matchedCount: 0, excludedCount: 0, pendingCount: 0, remainingCount: state.children.size };
    const resultIds = this.store.get(state.childResultRef!, binding).rows.map(row => row.id);
    const qualification: CandidateQualification = { ...stage, filter: structuredClone(args.filter ?? {}),
      originRef: state.rawChildRef ?? state.originParentRef, matchedIds: resultIds,
      pendingIds: state.childResponse ? [...new Set([...(work.qualification?.pendingIds ?? []), ...unknownIds])] : [],
      remainingIds: state.childResponse ? work.qualification?.remainingIds ?? [] : [...state.children.keys()], complete: state.childDone };
    const child = this.store.create({ ...work, binding, parentRef: state.originParentRef,
      ...(state.workingRef ? { replaceRef: state.workingRef } : {}),
      rows: state.childResponse ? [...work.rows, ...unknownRows] : [...state.children.values()],
      sources: this.sources(state, binding), qualification, resultIds, refRole: 'working',
      coverageDependencies: mergeCandidateCoverageDependencies(work.coverageDependencies, this.parentDependencies(state, binding)),
      inheritParentQualification: false, unknownFieldCount: work.unknownFieldCount, failedFieldCount: work.failedFieldCount,
    });
    state.workingRef = child.ref; state.childResultRef = child.resultRef!; state.cursor = state.childDone ? null : `rc_${randomUUID()}`;
    const data = args.response_view === 'reference' || !state.childResponse ? [] : response.data;
    const coverage = summarizeCandidateCoverage(child, args.coverage_mode ?? 'summary', work.reportedSources ?? []);
    const result: RelationResponse = { ...response, responseView: args.response_view ?? 'page', candidateRef: child.ref, resultRef: state.childResultRef!, parentRef: state.originParentRef,
      data, pending: state.childResponse ? pending : [], filter: structuredClone(args.filter ?? {}), scope: structuredClone(args), stage,
      page: { cursor: args.cursor ?? null, nextCursor: state.cursor, limit: args.limit ?? 50, returnedCount: data.length, complete: state.childDone },
      coverage: { ...coverage, complete: coverage.complete && this.complete(state) }, relationStage,
      lineage: args.response_view === 'reference' ? [] : this.lineageRows(state, [...data, ...(state.childResponse ? pending : [])].map(row => row.id)),
      ...(args.collection_ref ? { collectionRef: args.collection_ref } : {}), readAt: new Date().toISOString() };
    (result as RelationResponse & { set?: { workingCount: number; resultCount: number } }).set = {
      workingCount: child.rows.length, resultCount: this.store.get(state.childResultRef!, binding).rows.length,
    };
    // 同阶段句柄指向最新进度，旧rc游标失效；历史覆盖快照由store保存。
    const immutable = structuredClone(state);
    this.snapshots.set(child.ref, { state: immutable, role: 'working', workingRef: child.ref });
    this.snapshots.set(state.childResultRef!, { state: immutable, role: 'result', workingRef: child.ref });
    return result;
  }
}
