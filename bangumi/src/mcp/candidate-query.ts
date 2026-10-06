import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { type AccessContext } from './access-context.js';
import { fullDate, dateMatches } from './collection-query.js';
import { CandidateStore, candidateRow, candidateSourceRef, candidateStage, candidateCoverageDependency, mergeCandidateCoverageDependencies,
  mergeCandidateFacts, mergeCandidateSources, summarizeCandidateCoverage,
  type CandidateBinding, type CandidateSet } from './candidate-store.js';
import { CANDIDATE_FIELDS, CANDIDATE_SUBJECT_FACT_FIELDS, DEFAULT_CANDIDATE_FIELDS, PERSONAL_CANDIDATE_FIELDS, validateCandidateArguments, validateCandidateFilter,
  validateCandidateCoverageArguments, type CandidateBaseFilter, type CandidateCoverageArgs, type CandidateCoverageResponse,
  type CandidateField, type CandidateFilter, type CandidateFactPatch, type CandidateInclude, type CandidateQueryArgs, type CandidateResponse,
  type CandidateRow, type CandidateView, type CandidateSource } from './candidate-contract.js';

type Match = 'match' | 'mismatch' | 'unknown';
const bindingFailures = new Set(['ACCOUNT_CHANGED', 'CANDIDATE_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH',
  'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN', 'CREF_COVERAGE_INSUFFICIENT']);
interface Rule { fields: CandidateField[]; check(row: CandidateRow): Match; missing?(row: CandidateRow): CandidateField[]; nextMissing?(row: CandidateRow): CandidateField[] }
export interface CandidateQueryDependencies {
  loadFacts(row: CandidateRow, fields: CandidateField[], include: CandidateInclude[], signal?: AbortSignal, args?: CandidateQueryArgs): Promise<CandidateFactPatch>;
  /** 在真实执行窗口准备可复用证据，来源在0-consumed/yield时也保留。 */
  prepareWindow?(rows: CandidateRow[], args: CandidateQueryArgs, signal?: AbortSignal): Promise<CandidateSource[]>;
  /** 宿主执行期限，仅结束当前输入窗口；不限制候选总量，也不表示读取失败。 */
  shouldYield?(): boolean;
  /** reference视图最多同时在途4个候选读取，page保持串行；不限制候选总量。 */
  concurrency?: number;
}
export interface CandidateExecutionOptions {
  /** 关系等内部调用需要独立资格结果，不使用字段投影引用。 */
  forceStage?: boolean;
  /** 来源producer更新raw输入后复用同参数的工作阶段，不对模型公开。 */
  stageRef?: string;
  /** 召回merge只展示本次新或有变化的作品；完整合并成员仍在返回引用中。 */
  processIds?: number[]; preserveInput?: boolean; filterAlreadyApplied?: boolean; hydrateProjection?: boolean;
}
function known(row: CandidateRow, field: CandidateField): boolean { return row.fieldStates[field] === 'known'; }
function test(row: CandidateRow, field: CandidateField, check: (value: unknown) => boolean): Match {
  return !known(row, field) ? 'unknown' : check(row.facts[field]) ? 'match' : 'mismatch';
}
function baseRules(filter: CandidateBaseFilter): Rule[] {
  const result: Rule[] = [];
  if (filter.subject_ids) { const selected = new Set(filter.subject_ids); result.push({ fields: ['id'], check: row => selected.has(row.id) ? 'match' : 'mismatch' }); }
  if (filter.subject_type !== undefined) result.push({ fields: ['subjectType'], check: row => test(row, 'subjectType', value => value === filter.subject_type) });
  if (filter.subject_form) result.push({ fields: ['subjectType', 'subjectForm'], check: row => {
    if (!known(row, 'subjectType')) return 'unknown'; if (row.facts.subjectType !== 2) return 'mismatch';
    return test(row, 'subjectForm', value => filter.subject_form!.includes(String(value)));
  } });
  if (filter.nsfw === 'exclude') result.push({ fields: ['nsfw'], check: row => test(row, 'nsfw', value => value === false) });
  for (const [input, field] of [['rating', 'score'], ['rating_count', 'ratingCount'], ['rank', 'rank'], ['personal_rating', 'personalRating'], ['duration', 'durationMinutes']] as const) {
    const bounds = filter[input]; if (bounds) result.push({ fields: [field], check: row => test(row, field, value => typeof value === 'number'
      && (bounds.min === undefined || value >= bounds.min) && (bounds.max === undefined || value <= bounds.max)) });
  }
  for (const [input, field] of [['tag', 'tags'], ['meta_tags', 'metaTags'], ['personal_tags', 'personalTags']] as const) {
    const tags = filter[input]; if (tags) result.push({ fields: [field], check: row => test(row, field, value => Array.isArray(value)
      && tags.every(tag => input === 'meta_tags' && tag.startsWith('-') ? !value.includes(tag.slice(1)) : value.includes(tag))) });
  }
  if (filter.air_date) result.push({ fields: ['date'], check: row => {
    if (!known(row, 'date')) return 'unknown'; const date = fullDate(row.facts.date); return !date ? 'unknown' : dateMatches(date, filter.air_date!) ? 'match' : 'mismatch';
  } });
  if (filter.collection_types) result.push({ fields: ['collectionStatus', 'collectionState'], check: row => {
    if (row.facts.collectionState === 'not_collected' || filter.collection_types!.every(status => row.excludesCollectionTypes.includes(status))) return 'mismatch';
    return test(row, 'collectionStatus', value => filter.collection_types!.includes(Number(value)));
  } });
  if (filter.exclude_collection_types) result.push({ fields: ['collectionStatus', 'collectionState'], check: row => {
    if (row.facts.collectionState === 'not_collected' || filter.exclude_collection_types!.every(status => row.excludesCollectionTypes.includes(status))) return 'match';
    return test(row, 'collectionStatus', value => !filter.exclude_collection_types!.includes(Number(value)));
  } });
  return result;
}
function rules(filter: CandidateFilter): Rule[] {
  const result = baseRules(filter);
  if (filter.any_of) {
    const branches = filter.any_of.map(baseRules), states = (row: CandidateRow) => branches.map(branch => filterState(row, branch));
    result.push({ fields: [...new Set(branches.flatMap(branch => branch.flatMap(rule => rule.fields)))], check: row => {
      const results = states(row); return results.some(state => state.result === 'match') ? 'match'
        : results.some(state => state.result === 'unknown') ? 'unknown' : 'mismatch';
    }, missing: row => [...new Set(states(row).filter(state => state.result === 'unknown').flatMap(state => state.missing))],
    // 依次核实OR分支；第一条已充分匹配后不再补另一个分支的昂贵证据。
    nextMissing: row => states(row).find(state => state.result === 'unknown' && state.nextMissing.length)?.nextMissing ?? [] });
  }
  return result;
}
function filterState(row: CandidateRow, tests: Rule[]): { result: Match; missing: CandidateField[]; nextMissing: CandidateField[] } {
  const pending: CandidateField[] = [], nextMissing: CandidateField[] = [];
  for (const rule of tests) {
    const state = rule.check(row);
    if (state === 'mismatch') return { result: 'mismatch', missing: [], nextMissing: [] };
    if (state !== 'unknown') continue;
    // 完整日期不足精度时即使字段已取得也保留待核实，不能当作通过。
    const missing = rule.missing?.(row) ?? (rule.fields.every(field => known(row, field)) ? rule.fields : rule.fields.filter(field => !known(row, field)));
    pending.push(...missing);
    nextMissing.push(...(rule.nextMissing?.(row) ?? missing.filter(field => !known(row, field) && !row.resolvedFields.includes(field))));
  }
  return { result: pending.length ? 'unknown' : 'match', missing: [...new Set(pending)], nextMissing: [...new Set(nextMissing)] };
}
function includeFields(include: CandidateInclude[]): CandidateField[] {
  return [...new Set(include.flatMap(group => group === 'subject_facts' ? CANDIDATE_SUBJECT_FACT_FIELDS
    : group === 'own_collection' ? ['collectionState', 'collectionStatus'] as CandidateField[] : [group] as CandidateField[]))];
}
/** 只核对宿主已有事实；不补取、不改字段状态，也不生成已判定结论。 */
export function evaluateCandidateFacts(row: CandidateRow, filter: CandidateFilter): { result: 'match' | 'mismatch' | 'unknown'; missingFields: CandidateField[] } {
  validateCandidateFilter(filter);
  const state = filterState(row, rules(filter));
  return { result: state.result, missingFields: [...state.missing] };
}
function privateRequest(args: CandidateQueryArgs): boolean {
  const personalFilter = (filter: CandidateBaseFilter): boolean => filter.personal_rating !== undefined || filter.personal_tags !== undefined
    || filter.collection_types !== undefined || filter.exclude_collection_types !== undefined;
  return args.include?.includes('own_collection') === true || (args.fields ?? []).some(field => PERSONAL_CANDIDATE_FIELDS.includes(field))
    || personalFilter(args.filter ?? {}) || (args.filter?.any_of ?? []).some(personalFilter);
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
  return value;
}
function signature(args: CandidateQueryArgs): string {
  return JSON.stringify(ordered({ filter: { ...(args.subject_type !== undefined ? { subject_type: args.subject_type } : {}), ...(args.filter ?? {}) },
    fields: ['id', ...((args.fields ?? DEFAULT_CANDIDATE_FIELDS).filter(field => field !== 'id'))],
    include: args.include ?? [], collection_ref: args.collection_ref ?? null, hydrate_fields: args.hydrate_fields ?? true }));
}
function projected(row: CandidateRow, fields: CandidateField[]): CandidateView {
  const value: CandidateView = { id: row.id }, states: NonNullable<CandidateView['fieldStates']> = {};
  for (const field of fields.filter(field => field !== 'id')) {
    const state = row.fieldStates[field]; value[field] = state === 'known' ? structuredClone(row.facts[field]) : null;
    if (state !== 'known') states[field] = state === 'failed' ? 'failed' : 'unknown';
  }
  if (Object.keys(states).length) value.fieldStates = states;
  return value;
}

/** 明确筛选先使用已有事实，只有未淘汰作品才读缺失证据。 */
export class CandidateQuery {
  constructor(private readonly store: CandidateStore, private readonly dependencies: CandidateQueryDependencies) {
    if (dependencies.concurrency !== undefined && (!Number.isSafeInteger(dependencies.concurrency) || dependencies.concurrency < 1 || dependencies.concurrency > 4))
      throw new AppError('INVALID_INPUT', '候选读取同时在途上限必须为1至4。');
  }
  async execute(args: CandidateQueryArgs, binding: CandidateBinding, accessContext?: AccessContext, signal?: AbortSignal, options: CandidateExecutionOptions = {}): Promise<CandidateResponse> {
    validateCandidateArguments(args);
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError('INVALID_INPUT', '候选输入窗口必须为1至100。');
    const fields = [...new Set(['id', ...(args.fields ?? DEFAULT_CANDIDATE_FIELDS)])] as CandidateField[], include = args.include ?? [], filter = args.filter ?? {};
    const responseView = args.response_view ?? 'page';
    let input: CandidateSet;
    if (args.candidate_ref) input = this.store.get(args.candidate_ref, binding);
    else if (args.subject_ids?.length) input = this.store.create({ binding, rows: args.subject_ids.map(id => ({ id, facts: {} })), sources: [] });
    else throw new AppError('INVALID_INPUT', '进一步筛选必须指定候选引用或明确作品ID。');
    // 字段所属用户由绑定定义；祖先来源仍保留审计，不能误当成当前子集的个人事实owner。
    const usingPrivate = privateRequest(args), publicCollection = input.visibility === 'public' && input.binding.scopeKey.startsWith('public:collections:');
    if (accessContext && input.requiresNsfw && (accessContext.mode !== 'account' || accessContext.nsfw.allowed !== true))
      throw new AppError('NSFW_SCOPE_CHANGED', '候选引用所需NSFW权限已不可用。');
    if (publicCollection && include.includes('own_collection')) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '第三方公开收藏与本人收藏不能共用事实字段；请以明确作品ID重新查询本人事实。');
    if (usingPrivate && !publicCollection && (binding.accountId === null || !accessContext?.account || accessContext.account.id !== binding.accountId))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '补充本人收藏事实必须有匹配的已核实账户。');
    const account = input.account ?? (usingPrivate && !publicCollection ? accessContext?.account ?? undefined : undefined);
    const visibility = input.visibility === 'self' || account ? 'self' : 'public';
    let querySignature = signature(args);
    let effectiveFilter: CandidateFilter = { ...(args.subject_type !== undefined ? { subject_type: args.subject_type as number } : {}), ...filter };
    let frozenArgs: CandidateQueryArgs = { filter: structuredClone(effectiveFilter), fields: [...fields],
      ...(args.include !== undefined ? { include: [...include] } : {}), ...(args.hydrate_fields !== undefined ? { hydrate_fields: args.hydrate_fields } : {}),
      response_view: responseView, ...(args.coverage_mode !== undefined ? { coverage_mode: args.coverage_mode } : {}), limit,
      ...(args.collection_ref ? { collection_ref: args.collection_ref } : {}) };
    let origin = input, offset = 0, matchedIds: number[] = [], pendingIds: number[] = [], excludedCount = 0;
    let workingStage = input;
    if (options.stageRef) {
      const existing = this.store.get(options.stageRef, binding);
      if (existing.refRole !== 'working' || !isDeepStrictEqual(existing.binding, binding))
        throw new AppError('CANDIDATE_SCOPE_MISMATCH', '来源producer阶段必须是同绑定的真实工作引用。');
      if (existing.qualification?.originRef === input.ref && existing.querySignature === querySignature) workingStage = existing;
    }
    const sameStage = workingStage.refRole === 'working' && workingStage.qualification !== undefined && isDeepStrictEqual(workingStage.binding, binding) && workingStage.visibility === visibility
      && isDeepStrictEqual(ordered(workingStage.qualification.filter), ordered(effectiveFilter));
    if (sameStage && !args.cursor && !options.stageRef) origin = this.store.get(workingStage.qualification!.originRef, binding);
    let inputIds = options.processIds, preserveInput = options.preserveInput ?? false;
    let filterAlreadyApplied = options.filterAlreadyApplied ?? false;
    let hydrateProjection = responseView === 'page' && (args.hydrate_fields ?? true) && (options.hydrateProjection ?? true);
    if (args.cursor) {
      const continuation = args.cursor.startsWith('cp_') ? this.store.projectionContinuation(input.ref, args.cursor, binding) : input.continuation;
      const implicitSourceType = continuation?.frozenArgs.filter?.subject_type;
      const continuationSignature = args.subject_type === undefined && filter.subject_type === undefined && implicitSourceType !== undefined
        ? signature({ ...args, filter: { subject_type: implicitSourceType, ...filter } }) : querySignature;
      if (!continuation || continuation.cursor !== args.cursor || continuation.signature !== continuationSignature)
        throw new AppError('CANDIDATE_CURSOR_MISMATCH', '候选续页游标与本阶段字段或筛选条件不一致。');
      querySignature = continuation.signature; frozenArgs = structuredClone(continuation.frozenArgs);
      effectiveFilter = structuredClone(frozenArgs.filter ?? {});
      origin = this.store.get(continuation.originRef, binding); offset = continuation.nextOffset; matchedIds = [...continuation.matchedIds]; pendingIds = [...continuation.pendingIds]; excludedCount = continuation.excludedCount;
      inputIds = continuation.inputIds; preserveInput = continuation.preserveInput;
      if (args.cursor.startsWith('cp_')) { inputIds = undefined; matchedIds = origin.rows.slice(0, offset).map(row => row.id); }
      filterAlreadyApplied = continuation.filterAlreadyApplied; hydrateProjection = continuation.hydrateProjection;
    }
    if (accessContext && origin.requiresNsfw && (accessContext.mode !== 'account' || accessContext.nsfw.allowed !== true))
      throw new AppError('NSFW_SCOPE_CHANGED', '阶段原输入所需NSFW权限已不可用。');
    const inputIdSet = inputIds === undefined ? undefined : new Set(inputIds);
    const sourceRows = inputIdSet ? origin.rows.filter(row => inputIdSet.has(row.id)) : origin.rows;
    if (inputIds !== undefined && sourceRows.length !== inputIds.length)
      throw new AppError('CANDIDATE_CURSOR_MISMATCH', '阶段原输入成员已改变；请沿原集合重新筛选。');
    const factFilters = [...(origin.factFilters ?? []), ...(!filterAlreadyApplied && Object.keys(effectiveFilter).length ? [effectiveFilter] : [])]
      .filter((filter, index, filters) => filters.findIndex(other => isDeepStrictEqual(ordered(other), ordered(filter))) === index);
    const tests = factFilters.flatMap(rules);
    if (args.cursor && !args.cursor.startsWith('cp_')) {
      // 前缀结论随当前缓存事实重核，不沿用可能已经失效的历史matched/pending。
      matchedIds = []; pendingIds = []; excludedCount = 0;
      for (const row of sourceRows.slice(0, offset)) {
        const state = filterState(row, tests);
        if (state.result === 'match') matchedIds.push(row.id);
        else if (state.result === 'unknown') pendingIds.push(row.id);
        else excludedCount++;
      }
    }
    if (args.cursor?.startsWith('cp_') && sourceRows.some(row => filterState(row, tests).result !== 'match'))
      throw new AppError('CANDIDATE_CURSOR_MISMATCH', '字段读取期间事实资格已改变；请沿原集合重新筛选。');
    const window = responseView === 'reference' ? sourceRows.slice(offset) : sourceRows.slice(offset, offset + limit);
    const preparedSources = await this.dependencies.prepareWindow?.(window, { ...args, filter: effectiveFilter, fields, include,
      response_view: responseView, hydrate_fields: hydrateProjection }, signal) ?? [];
    const changed = new Map<number, CandidateRow>(), data: CandidateView[] = [], pending: CandidateResponse['pending'] = [];
    let consumed = 0, fatalError: unknown;
    const processRow = async (initial: CandidateRow): Promise<{ row: CandidateRow; state: ReturnType<typeof filterState>; consumed: boolean }> => {
      let row = candidateRow(initial);
      // 同一次执行最多尝试一次；后续明确调用refine可恢复暂时读取失败。
      row.resolvedFields = row.resolvedFields.filter(field => row.fieldStates[field] !== 'failed');
      let state = filterState(row, tests);
      // 已中止保留准确输入游标，由上层决定继续或报告部分结果。
      if (signal?.aborted || fatalError || this.dependencies.shouldYield?.()) return { row, state, consumed: false };
      if (state.result !== 'mismatch') {
        const fill = async (required: CandidateField[], requestedInclude: CandidateInclude[]): Promise<boolean> => {
          const missing = [...new Set(required)].filter(field => field !== 'id' && !known(row, field) && !row.resolvedFields.includes(field));
          if (!missing.length) return false;
          if (fatalError || signal?.aborted || this.dependencies.shouldYield?.()) return true;
          try {
            const patch = await this.dependencies.loadFacts(structuredClone(row), missing, requestedInclude, signal, args);
            row = mergeCandidateFacts(row, { ...patch, resolvedFields: [...new Set([...(patch.resolvedFields ?? []), ...missing])] });
          } catch (error) {
            if (signal?.aborted) return false;
            // 账户/认证/范围变化使整个本次绑定失效，不能降为单作品资料缺口。
            if (error instanceof AppError && bindingFailures.has(error.code)) { fatalError ??= error; throw error; }
            if (fatalError) return true;
            const code = error instanceof AppError ? error.code : 'READ_FAILED';
            row = mergeCandidateFacts(row, { facts: {}, fieldStates: Object.fromEntries(missing.map(field => [field, 'failed'])),
              failureCodes: Object.fromEntries(missing.map(field => [field, code])), resolvedFields: missing });
          }
          return false;
        };
        // 先解筛选缺口；只有明确通过者补比较/展示字段。接口已附带字段直接缓存复用。
        let filterYielded = false;
        while (state.result === 'unknown' && state.nextMissing.length) {
          if (await fill(state.nextMissing, include.filter(group => includeFields([group]).some(field => state.nextMissing.includes(field))))) { filterYielded = true; break; }
          if (signal?.aborted) break;
          state = filterState(row, tests);
        }
        if (filterYielded || signal?.aborted) return { row, state, consumed: false };
        if (state.result === 'match') {
          if (await fill([...(hydrateProjection ? fields : []), ...includeFields(include)], include) || signal?.aborted) return { row, state, consumed: false };
          // 展示/额外证据接口可能同时返回更新后的评分、媒体或日期，不能沿用补取前的硬条件结果。
          state = filterState(row, tests);
        }
      }
      return { row, state, consumed: true };
    };
    const concurrency = responseView === 'reference' ? this.dependencies.concurrency ?? 4 : 1;
    while (consumed < window.length) {
      if (signal?.aborted || this.dependencies.shouldYield?.()) break;
      // 先等待整组settle再提交，账户/范围fatal不会写入任何候选事实或成功引用。
      const batch = await Promise.allSettled(window.slice(consumed, consumed + concurrency).map(processRow));
      const rejected = batch.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw fatalError ?? rejected.reason;
      let contiguous = true;
      for (const result of batch) {
        if (result.status !== 'fulfilled') continue;
        const { row, state } = result.value; changed.set(row.id, row);
        // 已完成尾行先缓存成功事实；游标只前进连续完成的输入前缀，不跳过尚未完成的头行。
        if (!result.value.consumed) contiguous = false;
        if (!contiguous) continue;
        consumed++;
        if (state.result === 'mismatch') { excludedCount++; continue; }
        if (state.result === 'unknown') {
          pendingIds.push(row.id); const failedFields = state.missing.filter(field => row.fieldStates[field] === 'failed');
          if (responseView === 'page') pending.push({ id: row.id, missingFields: state.missing.filter(field => !failedFields.includes(field)), failedFields });
        } else { matchedIds.push(row.id); if (responseView === 'page') data.push(projected(row, fields)); }
      }
      if (!contiguous) break;
    }
    const nextOffset = offset + consumed, complete = nextOffset === sourceRows.length, nextCursor = complete ? null : `cc_${randomUUID()}`;
    const remainingIds = sourceRows.slice(nextOffset).map(row => row.id), survivors = new Set([...matchedIds, ...pendingIds, ...remainingIds]);
    const previous = new Map(input.rows.map(row => [row.id, row]));
    // 当前行的硬条件已核实但展示字段尚未补完时保留其成功事实；处理游标仍停在该行。
    const childRows = (preserveInput ? origin.rows : sourceRows.filter(row => survivors.has(row.id))).map(row => changed.get(row.id) ?? previous.get(row.id) ?? row);
    const sources = mergeCandidateSources(origin.sources, input.sources, preparedSources, ...childRows.map(row => row.sources), ...[...changed.values()].map(row => row.sources));
    const resultIds = preserveInput && filterAlreadyApplied ? childRows.map(row => row.id) : matchedIds;
    const resultIdSet = new Set(resultIds), evidenceFields = [...new Set([...(hydrateProjection ? fields : []), ...includeFields(include)])].filter(field => field !== 'id');
    let unknownFieldCount = 0, failedFieldCount = 0;
    for (const row of childRows) if (resultIdSet.has(row.id)) for (const field of evidenceFields) {
      // 明确未收藏证明意味着个人值不适用，null收藏状态不能制造不存在的证据缺口。
      if (known(row, 'collectionState') && row.facts.collectionState === 'not_collected' && PERSONAL_CANDIDATE_FIELDS.includes(field)) continue;
      if (row.fieldStates[field] === 'failed') failedFieldCount++; else if (row.fieldStates[field] !== 'known') unknownFieldCount++;
    }
    const stage = { inputCount: sourceRows.length, processedCount: nextOffset, matchedCount: matchedIds.length, excludedCount,
      pendingCount: pendingIds.length, remainingCount: sourceRows.length - nextOffset };
    const projectionOnly = !options.forceStage && !Object.keys(effectiveFilter).length && !preserveInput && !filterAlreadyApplied && options.processIds === undefined
      && (!args.cursor || args.cursor.startsWith('cp_')) && isDeepStrictEqual(input.binding, binding) && input.visibility === visibility
      && excludedCount === 0 && pendingIds.length === 0;
    const cursor = projectionOnly && nextCursor ? `cp_${randomUUID()}` : nextCursor;
    const continuation = cursor ? { cursor, originRef: origin.ref, signature: querySignature, nextOffset, matchedIds: projectionOnly ? [] : matchedIds,
      pendingIds: projectionOnly ? [] : pendingIds, excludedCount, inputIds: projectionOnly ? [] : sourceRows.map(row => row.id),
      preserveInput, filterAlreadyApplied, hydrateProjection,
      frozenArgs: { ...frozenArgs, response_view: responseView, ...(args.coverage_mode !== undefined ? { coverage_mode: args.coverage_mode } : {}), limit } } : undefined;
    let child: CandidateSet;
    const baseline = this.store.projectionBaseline(workingStage.ref) ?? workingStage.reportedSources ?? input.reportedSources ?? [];
    if (projectionOnly) {
      this.store.cacheFacts(input.ref, binding, [...changed.values()]);
      const parentGap = candidateCoverageDependency(input);
      child = this.store.recordProjection({ ...input, sources, rows: childRows, reportedSources: sources, unknownFieldCount, failedFieldCount,
        requiresNsfw: input.requiresNsfw || childRows.some(row => row.requiresNsfw),
        coverageDependencies: mergeCandidateCoverageDependencies(input.coverageDependencies, parentGap ? [parentGap] : []),
        qualification: { ...stage, filter: {}, originRef: origin.ref, matchedIds: [], pendingIds: [], remainingIds: [], complete } }, continuation);
    } else child = this.store.create({ binding, rows: childRows, sources,
      ...(sameStage ? { replaceRef: workingStage.ref } : {}), parentRef: sameStage ? workingStage.parentRef : input.ref,
      visibility, ...(account ? { account } : {}),
      inheritParentQualification: !args.cursor && !(input.refRole === 'working' && isDeepStrictEqual(ordered(input.qualification?.filter), ordered(filter))),
      querySignature, factFilters, refRole: 'working', resultIds, qualification: { ...stage, filter: structuredClone(effectiveFilter), originRef: origin.ref,
        matchedIds, pendingIds, remainingIds, complete }, reportedSources: sources, unknownFieldCount, failedFieldCount,
      requiresNsfw: origin.requiresNsfw || input.requiresNsfw,
      cacheRows: [...changed.values()],
      ...(continuation ? { continuation } : {}) });
    const response: CandidateResponse = {
      schemaVersion: 1, kind: 'candidate_page', entity: 'subject_candidate', candidateRef: child.ref, resultRef: child.resultRef ?? child.ref,
      parentRef: projectionOnly ? input.parentRef : sameStage ? workingStage.parentRef : input.ref, responseView,
      data, pending, fields, include, filter: structuredClone(filter), scope: structuredClone(args),
      stage, set: { workingCount: child.rows.length, resultCount: projectionOnly ? child.rows.length : resultIds.length },
      page: { cursor: args.cursor ?? null, nextCursor: cursor, limit, returnedCount: data.length, complete },
      coverage: summarizeCandidateCoverage(child, args.coverage_mode ?? 'summary', baseline),
      visibility, ...(account ? { account } : {}), readAt: new Date().toISOString(), ...(accessContext ? { accessContext: structuredClone(accessContext) } : {}),
    };
    return response;
  }
  readCoverage(args: CandidateCoverageArgs | Record<string, unknown>, binding: CandidateBinding, accessContext?: AccessContext): CandidateCoverageResponse {
    validateCandidateCoverageArguments(args);
    const set = this.store.getCoverage(args.coverage_ref, binding), offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (offset > set.sources.length) throw new AppError('INVALID_INPUT', '候选覆盖详情offset超出来源数量。');
    if (accessContext && set.binding.accountId !== null && (accessContext.mode !== 'account' || accessContext.account?.id !== set.binding.accountId))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选覆盖详情与已核实账户不一致。');
    if (accessContext && set.requiresNsfw && (accessContext.mode !== 'account' || accessContext.nsfw.allowed !== true))
      throw new AppError('NSFW_SCOPE_CHANGED', '候选覆盖详情所需NSFW权限已不可用。');
    const sources = set.sources.slice(offset, offset + limit).map(source => ({ ...source, sourceRef: candidateSourceRef(source) }));
    const complete = offset + sources.length === set.sources.length;
    return { schemaVersion: 1, kind: 'candidate_coverage', coverageRef: set.coverageRef, candidateRef: set.ref, scope: structuredClone(args),
      coverage: summarizeCandidateCoverage(set, 'summary', set.sources), stage: candidateStage(set), sources,
      dependencies: structuredClone(set.coverageDependencies),
      page: { offset, nextOffset: complete ? null : offset + sources.length, limit, returnedCount: sources.length, totalCount: set.sources.length, complete },
      visibility: set.visibility, ...(set.account ? { account: set.account } : {}), readAt: new Date().toISOString(),
      ...(accessContext ? { accessContext: structuredClone(accessContext) } : {}) };
  }
}
