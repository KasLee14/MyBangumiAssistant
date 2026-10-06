import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema } from '../support/tool-schema.js';
import { CANDIDATE_FIELDS, PERSONAL_CANDIDATE_FIELDS, candidateFieldSchemas, candidateSourceSchema, candidateSourceRef, candidateCoverageDependencySchema, candidateScopeCoverageSchema,
  type CandidateCoverage, type CandidateCoverageDependency, type CandidateScopeCoverage, type CandidateField, type CandidateFactPatch, type CandidateFilter, type CandidateRow, type CandidateSeed,
  type CandidateQueryArgs, type CandidateSource, type CandidateSourceChange, type CandidateStage } from './candidate-contract.js';

export interface CandidateBinding { turnId: string; accountId: number | null; scopeKey: string }
export interface CandidateContinuation {
  cursor: string; originRef: string; signature: string; nextOffset: number; matchedIds: number[]; pendingIds: number[]; excludedCount: number;
  inputIds: number[]; preserveInput: boolean;
  filterAlreadyApplied: boolean; hydrateProjection: boolean;
  frozenArgs: CandidateQueryArgs;
}
export interface CandidateQualification extends CandidateStage {
  filter: CandidateFilter; originRef: string; matchedIds: number[]; pendingIds: number[]; remainingIds: number[]; complete: boolean;
}
export interface CandidateSet {
  ref: string; parentRef: string | null; binding: CandidateBinding; rows: CandidateRow[]; sources: CandidateSource[];
  visibility: 'public' | 'self'; account?: { id: number; username: string }; continuation?: CandidateContinuation;
  changedIds: number[]; duplicateCount: number; coverageRef: string; refRole: 'input' | 'working' | 'result'; resultRef?: string;
  qualification?: CandidateQualification; reportedSources?: CandidateSource[]; unknownFieldCount: number; failedFieldCount: number; requiresNsfw: boolean;
  coverageDependencies: CandidateCoverageDependency[];
  /** 同成员漏斗中实际执行过的事实条件；关系目标不继承父作品资格。 */
  factFilters: CandidateFilter[];
  querySignature?: string;
}
export interface CandidateSetInput {
  binding: CandidateBinding; rows: CandidateSeed[]; sources?: CandidateSource[]; parentRef?: string | null;
  visibility?: 'public' | 'self'; account?: { id: number; username: string }; continuation?: CandidateContinuation;
  changedIds?: number[]; duplicateCount?: number; refRole?: CandidateSet['refRole']; resultIds?: number[];
  qualification?: CandidateQualification; reportedSources?: CandidateSource[]; unknownFieldCount?: number; failedFieldCount?: number; requiresNsfw?: boolean;
  coverageDependencies?: CandidateCoverageDependency[]; scopeCoverage?: CandidateScopeCoverage; inheritParentQualification?: boolean;
  /** 本阶段成功读取的事实即使后来被筛掉也原子缓存，不改变集合成员。 */
  cacheRows?: CandidateSeed[];
  factFilters?: CandidateFilter[]; inheritFactFilters?: boolean;
  /** 同阶段推进更新原工作/结果句柄；历史coverage另存紧凑快照。 */
  replaceRef?: string;
  querySignature?: string;
}
interface CandidateResultView { ref: string; baseRef: string; memberIds: number[] }
type StoredCandidateSet = Omit<CandidateSet, 'rows' | 'sources' | 'reportedSources'> & { memberIds: number[]; sourceKey: string; reportedSourceKey?: string };
interface SourceSnapshot { values: CandidateSource[]; refs: number; bytes: number; pooled?: string[] }
interface SharedSource { key: string; value: CandidateSource; refs: number; bytes: number }
const validators = new Map(CANDIDATE_FIELDS.map(field => [field, compileSchema(candidateFieldSchemas[field])]));
const sourceValidator = compileSchema(candidateSourceSchema);
const dependencyValidator = compileSchema(candidateCoverageDependencySchema), scopeCoverageValidator = compileSchema(candidateScopeCoverageSchema);
const publicSubjectTools = new Set(['search_subjects', 'browse_subjects', 'get_subject_details', 'get_subject_relations',
  'get_character_subjects', 'get_person_subjects', 'get_index_subjects', 'get_daily_broadcast']);
function invalid(message: string): never { throw new AppError('INVALID_RESPONSE', message); }
export { candidateSourceRef } from './candidate-contract.js';
export function mergeCandidateSources(...groups: CandidateSource[][]): CandidateSource[] {
  const result = new Map<string, CandidateSource>();
  for (const source of groups.flat()) {
    if (!sourceValidator(source)) invalid('候选来源不符合固定覆盖契约。');
    try { const scope: unknown = JSON.parse(source.scope); if (!scope || typeof scope !== 'object' || Array.isArray(scope)) invalid('候选来源范围无效。'); } catch { invalid('候选来源范围无效。'); }
    if (source.complete && source.nextOffset !== null) invalid('已穷尽的候选来源仍含续页。');
    const state = source.readState;
    if (state && (!Number.isFinite(state.revision) || state.filterCoverage && (state.filterCoverage.unknownDateCount !== state.filterCoverage.unknownDateSubjectIds.length
      || state.filterCoverage.complete !== (state.filterCoverage.unknownDateCount === 0)
      || state.filterCoverage.scannedCount < state.filterCoverage.matchedCount + state.filterCoverage.unknownDateCount))) invalid('候选来源读取进度或累计筛选覆盖无效。');
    if (source.complete && state && (!state.continuous || state.firstOffset !== 0 || state.totalKind !== 'exact' || source.total === null || source.scannedCount !== source.total
      || state.excludedNsfwCount !== 0 || state.unknownNsfwCount !== 0 || state.filterCoverage?.complete === false)) invalid('候选来源没有从0连续且无缺口的完整读取证明。');
    const key = candidateSourceRef(source);
    const previous = result.get(key);
    const revision = state?.revision ?? 0, previousRevision = previous?.readState?.revision ?? 0;
    let newer = !previous;
    if (previous) {
      if (revision !== previousRevision) newer = revision > previousRevision;
      else if ((state?.pagesRead ?? 0) !== (previous.readState?.pagesRead ?? 0)) newer = (state?.pagesRead ?? 0) > (previous.readState?.pagesRead ?? 0);
      else if (source.scannedCount !== previous.scannedCount) newer = source.scannedCount > previous.scannedCount;
      // legacy完整producer已明确证明完整；旧行的同计数partial不能回盖该证明。
      else if (!state && !previous.readState && source.complete !== previous.complete) newer = source.complete;
      else newer = source.nextOffset === null && previous.nextOffset !== null || source.nextOffset === previous.nextOffset;
    }
    if (newer) result.set(key, structuredClone(source));
  }
  return [...result.values()];
}
export function candidateStage(set: CandidateSet): CandidateStage {
  if (set.qualification) {
    const { inputCount, processedCount, matchedCount, excludedCount, pendingCount, remainingCount } = set.qualification;
    return { inputCount, processedCount, matchedCount, excludedCount, pendingCount, remainingCount };
  }
  return { inputCount: set.rows.length, processedCount: set.rows.length, matchedCount: set.rows.length, excludedCount: 0, pendingCount: 0, remainingCount: 0 };
}
export function candidateCoverageDependency(set: Pick<CandidateSet, 'ref' | 'coverageRef' | 'qualification' | 'unknownFieldCount' | 'failedFieldCount'>): CandidateCoverageDependency | undefined {
  const stage = set.qualification ?? { pendingCount: 0, remainingCount: 0 };
  if (stage.pendingCount === 0 && stage.remainingCount === 0 && set.unknownFieldCount === 0 && set.failedFieldCount === 0 && set.qualification?.complete !== false) return undefined;
  return { candidateRef: set.ref, coverageRef: set.coverageRef, kind: 'qualification', complete: false,
    pendingCount: stage.pendingCount, remainingCount: stage.remainingCount, unknownCount: set.unknownFieldCount, failedCount: set.failedFieldCount };
}
export function mergeCandidateCoverageDependencies(...groups: CandidateCoverageDependency[][]): CandidateCoverageDependency[] {
  const result = new Map<string, CandidateCoverageDependency>();
  for (const dependency of groups.flat()) {
    if (!dependencyValidator(dependency)) invalid('候选依赖覆盖不符合固定契约。');
    const key = JSON.stringify([dependency.coverageRef, dependency.kind]), previous = result.get(key);
    if (previous && !isDeepStrictEqual({ ...previous, candidateRef: '' }, { ...dependency, candidateRef: '' })) invalid('同一候选覆盖引用的依赖事实不一致。');
    result.set(key, structuredClone(previous ?? dependency));
  }
  return [...result.values()];
}
export function summarizeCandidateCoverage(set: CandidateSet, mode: CandidateCoverage['mode'] = 'summary', baseline: CandidateSource[] = []): CandidateCoverage {
  const stage = candidateStage(set), prior = new Map(baseline.map(source => [candidateSourceRef(source), source]));
  const changes = new Map<string, CandidateSourceChange>();
  for (const source of set.sources) {
    const previous = prior.get(candidateSourceRef(source)); if (previous && isDeepStrictEqual(previous, source)) continue;
    const key = JSON.stringify([source.tool, source.source, source.privateRecords]);
    const change = changes.get(key) ?? { tool: source.tool, source: source.source, privateRecords: source.privateRecords, sourceCount: 0,
      addedCount: 0, updatedCount: 0, completeSourceCount: 0, incompleteSourceCount: 0, unknownTotalSourceCount: 0, scannedCount: 0 };
    change.sourceCount++; change[previous ? 'updatedCount' : 'addedCount']++;
    change[source.complete ? 'completeSourceCount' : 'incompleteSourceCount']++; if (source.total === null) change.unknownTotalSourceCount++;
    change.scannedCount += source.scannedCount; changes.set(key, change);
  }
  const completeSourceCount = set.sources.filter(source => source.complete).length, incompleteSourceCount = set.sources.length - completeSourceCount;
  return { scope: 'candidate_set', coverageRef: set.coverageRef, mode,
    complete: stage.remainingCount === 0 && stage.pendingCount === 0 && incompleteSourceCount === 0 && set.unknownFieldCount === 0 && set.failedFieldCount === 0 && set.coverageDependencies.length === 0,
    sourceCount: set.sources.length, completeSourceCount, incompleteSourceCount, unknownTotalSourceCount: set.sources.filter(source => source.total === null).length,
    pendingCount: stage.pendingCount, remainingCount: stage.remainingCount, unknownFieldCount: set.unknownFieldCount, failedFieldCount: set.failedFieldCount,
    dependencyIncompleteCount: set.coverageDependencies.length, dependencyPendingCount: set.coverageDependencies.reduce((sum, dependency) => sum + dependency.pendingCount, 0),
    dependencyRemainingCount: set.coverageDependencies.reduce((sum, dependency) => sum + dependency.remainingCount, 0),
    dependencyUnknownCount: set.coverageDependencies.reduce((sum, dependency) => sum + dependency.unknownCount, 0),
    dependencyFailedCount: set.coverageDependencies.reduce((sum, dependency) => sum + dependency.failedCount, 0),
    sourceChanges: [...changes.values()], ...(mode === 'full' ? { sources: structuredClone(set.sources) } : {}) };
}
export function candidateRow(seed: CandidateSeed): CandidateRow {
  if (!Number.isSafeInteger(seed.id) || seed.id < 1) invalid('候选作品ID无效。');
  const row: CandidateRow = { id: seed.id, facts: { id: seed.id }, fieldStates: { id: 'known' }, failureCodes: {}, sources: [], resolvedFields: [], excludesCollectionTypes: [], requiresNsfw: false };
  return mergeCandidateFacts(row, seed);
}
/** 不将未知覆盖掉同范围已核实事实；写入后应让整个个人缓存失效。 */
export function mergeCandidateFacts(current: CandidateRow, patch: CandidateFactPatch): CandidateRow {
  const row = structuredClone(current);
  if ([...Object.keys(patch.facts), ...Object.keys(patch.fieldStates ?? {}), ...Object.keys(patch.failureCodes ?? {})].some(field => !CANDIDATE_FIELDS.includes(field as CandidateField)))
    invalid('候选事实含白名单之外字段。');
  for (const field of CANDIDATE_FIELDS) {
    const hasFact = Object.hasOwn(patch.facts, field), state = patch.fieldStates?.[field];
    if (!hasFact && state === undefined) continue;
    const value = patch.facts[field];
    if (hasFact && !validators.get(field)!(value)) invalid(`候选事实字段 ${field} 类型或范围无效。`);
    if (field === 'id') {
      if (hasFact && value !== row.id || state !== undefined && state !== 'known') invalid('候选事实身份与输入ID不一致。');
      continue;
    }
    let actualState = state ?? (value === null || value === undefined || field === 'collectionState' && value === 'unknown' ? 'unknown' : 'known');
    if (!['known', 'unknown', 'failed'].includes(actualState)) invalid('候选字段读取状态无效。');
    if (actualState === 'known' && (!hasFact || value === null || field === 'collectionState' && value === 'unknown')) invalid('已核实候选字段缺少有效事实。');
    if (actualState !== 'known' && value !== undefined && value !== null && !(field === 'collectionState' && value === 'unknown')) invalid('未知候选字段错误地带有事实。');
    if (actualState !== 'known' && row.fieldStates[field] === 'known') continue;
    row.facts[field] = actualState === 'known' ? structuredClone(value) : null;
    row.fieldStates[field] = actualState;
    delete row.failureCodes[field];
    if (actualState === 'failed') {
      const code = patch.failureCodes?.[field] ?? 'READ_FAILED';
      if (typeof code !== 'string' || !code.length || code.length > 100) invalid('候选字段失败码无效。');
      row.failureCodes[field] = code;
    }
  }
  row.sources = mergeCandidateSources(row.sources, patch.sources ?? []);
  if (patch.resolvedFields?.some(field => !CANDIDATE_FIELDS.includes(field))) invalid('候选补字段完成标记无效。');
  if (patch.excludesCollectionTypes?.some(status => ![1, 2, 3, 4, 5].includes(status))) invalid('候选收藏范围缺席证明无效。');
  row.resolvedFields = [...new Set([...row.resolvedFields, ...(patch.resolvedFields ?? [])])];
  row.excludesCollectionTypes = [...new Set([...row.excludesCollectionTypes, ...(patch.excludesCollectionTypes ?? [])])];
  if (patch.requiresNsfw !== undefined && typeof patch.requiresNsfw !== 'boolean') invalid('候选资料的NSFW权限标记无效。');
  row.requiresNsfw = row.requiresNsfw || patch.requiresNsfw === true || row.facts.nsfw === true;
  if (row.facts.collectionState === 'not_collected' && typeof row.facts.collectionStatus === 'number') invalid('未收藏事实与收藏状态冲突。');
  return row;
}

/** 只存宿主内存；容量拒绝是明确资源错误，不静默截断候选或伪造穷尽。 */
export class CandidateStore {
  private readonly sets = new Map<string, StoredCandidateSet>();
  private readonly resultViews = new Map<string, CandidateResultView>();
  private readonly coverageRefs = new Map<string, string>();
  private readonly projectionWindows = new Map<string, CandidateContinuation>();
  private readonly projectionCoverage = new Map<string, StoredCandidateSet>();
  private readonly projectionReports = new Map<string, string>();
  private readonly factCache = new Map<string, CandidateRow>();
  private readonly factSizes = new Map<string, number>();
  private readonly sourceSnapshots = new Map<string, SourceSnapshot>();
  private readonly projectionSources = new Map<string, SharedSource>();
  private readonly factIndex = new Map<string, Set<string>>();
  private bytes = 0;
  constructor(private readonly options: { maxBytes?: number; maxRefs?: number } = {}) {}
  create(input: CandidateSetInput): CandidateSet {
    this.validateBinding(input.binding);
    const replaced = input.replaceRef ? this.sets.get(input.replaceRef) : undefined;
    if (input.replaceRef && (!replaced || !['working', 'input'].includes(replaced.refRole) || !isDeepStrictEqual(replaced.binding, input.binding)))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '只有同绑定的真实输入或工作阶段可以沿原引用推进。');
    if (replaced?.refRole === 'input' && ((input.refRole ?? 'input') !== 'input' || input.resultIds !== undefined || input.qualification !== undefined
      || replaced.resultRef !== undefined || replaced.qualification !== undefined)) invalid('原始输入更新不能混入筛选结果或资格阶段。');
    if (replaced?.refRole === 'working' && (input.refRole ?? 'input') !== 'working') invalid('工作阶段更新不能改为原始输入。');
    if (input.replaceRef && input.parentRef === input.replaceRef) invalid('候选阶段父引用不能指向自身。');
    let parent: StoredCandidateSet | undefined;
    if (input.parentRef) {
      const view = this.resultViews.get(input.parentRef), stored = this.sets.get(view?.baseRef ?? input.parentRef);
      if (!stored) throw new AppError('CANDIDATE_REF_EXPIRED', '派生候选的祖先引用已失效。');
      if (stored.binding.turnId !== input.binding.turnId || stored.binding.accountId !== null && stored.binding.accountId !== input.binding.accountId)
        throw new AppError('CANDIDATE_SCOPE_MISMATCH', '派生候选不能跨读取任务或个人账户继承覆盖。');
      parent = { ...stored, ref: input.parentRef, refRole: view ? 'result' : stored.refRole };
    }
    const parentGap = parent && input.inheritParentQualification !== false ? candidateCoverageDependency(parent) : undefined;
    const coverageDependencies = mergeCandidateCoverageDependencies(parent?.coverageDependencies ?? [], input.coverageDependencies ?? [], parentGap ? [parentGap] : []);
    if (input.scopeCoverage && (!scopeCoverageValidator(input.scopeCoverage) || input.scopeCoverage.complete
      && (input.scopeCoverage.pendingCount || input.scopeCoverage.remainingCount || input.scopeCoverage.unknownCount || input.scopeCoverage.failedCount))) invalid('候选来源阶段覆盖无效。');
    const map = new Map<number, CandidateRow>(); let duplicates = 0;
    for (const seed of input.rows) {
      const prior = map.get(seed.id), cached = this.factCache.get(this.cacheKey(input.binding, seed.id));
      if (prior) duplicates++;
      const publicSeed = this.publicFacts(seed.id, input.binding.turnId), existing = prior ?? cached;
      const base = publicSeed ? existing ? mergeCandidateFacts(candidateRow(publicSeed), existing) : candidateRow(publicSeed)
        : existing ?? candidateRow({ id: seed.id, facts: {} });
      let row = mergeCandidateFacts(base, seed);
      // 初始来源页的事实要保留来源；已补字段的派生集合沿用逐行已有证据。
      if (!row.sources.length) row = mergeCandidateFacts(row, { facts: {}, sources: input.sources ?? [] });
      map.set(seed.id, row);
    }
    const cache = new Map(map);
    const parentMembers = new Set<number>((input.parentRef ? this.resultViews.get(input.parentRef)?.memberIds : undefined) ?? parent?.memberIds ?? []);
    for (const seed of input.cacheRows ?? []) {
      if (!map.has(seed.id) && !parentMembers.has(seed.id)) throw new AppError('CANDIDATE_ID_MISMATCH', '已读事实不属于本阶段候选范围。');
      const previous = cache.get(seed.id) ?? this.factCache.get(this.cacheKey(input.binding, seed.id)) ?? candidateRow({ id: seed.id, facts: {} });
      cache.set(seed.id, mergeCandidateFacts(previous, seed));
    }
    const visibility = input.visibility ?? 'public';
    if (visibility === 'self' && (!input.account || input.account.id !== input.binding.accountId)) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '个人候选集合缺少匹配的已核实账户。');
    if (visibility === 'public' && input.account) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '公开候选集合不能声明个人账户。');
    const sources = mergeCandidateSources(input.sources ?? [], ...[...cache.values()].map(row => row.sources));
    const publicCollection = sources.some(source => source.privateRecords === 'public_only' && ['get_user_collections', 'query_user_collections'].includes(source.tool)
      && typeof JSON.parse(source.scope).username === 'string' && JSON.parse(source.scope).username !== '-');
    if ([...cache.values()].some(row => PERSONAL_CANDIDATE_FIELDS.some(field => row.fieldStates[field] !== undefined)) && input.binding.accountId === null && !publicCollection)
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '个人候选事实必须绑定已核实账户。');
    const resultView: CandidateResultView | undefined = input.resultIds ? { ref: replaced?.resultRef ?? `cr_${randomUUID()}`, baseRef: '', memberIds: [...input.resultIds] } : undefined;
    if (input.resultIds && (new Set(input.resultIds).size !== input.resultIds.length || input.resultIds.some(id => !map.has(id)))) invalid('已核实结果引用成员不属于候选工作集。');
    const set: CandidateSet = { ref: replaced?.ref ?? `c_${randomUUID()}`, parentRef: input.parentRef ?? null, binding: structuredClone(input.binding), rows: [...map.values()], sources,
      visibility, ...(input.account ? { account: structuredClone(input.account) } : {}), ...(input.continuation ? { continuation: structuredClone(input.continuation) } : {}),
      changedIds: input.changedIds ?? [...map.keys()], duplicateCount: input.duplicateCount ?? duplicates, coverageRef: `cv_${randomUUID()}`,
      refRole: input.refRole ?? 'input', ...(resultView ? { resultRef: resultView.ref } : {}),
      ...(input.qualification ? { qualification: structuredClone(input.qualification) } : {}),
      ...(input.querySignature ? { querySignature: input.querySignature } : {}),
      ...(input.reportedSources ? { reportedSources: structuredClone(input.reportedSources) } : {}),
      unknownFieldCount: input.unknownFieldCount ?? 0, failedFieldCount: input.failedFieldCount ?? 0,
      requiresNsfw: input.requiresNsfw === true || parent?.requiresNsfw === true || [...cache.values()].some(row => row.requiresNsfw), coverageDependencies,
      factFilters: structuredClone(input.factFilters ?? [
        ...(parent && input.inheritFactFilters !== false && [...map.keys()].every(id => parentMembers.has(id)) ? parent.factFilters : []),
        ...(input.qualification && Object.keys(input.qualification.filter).length ? [input.qualification.filter] : []),
      ]).filter((filter, index, filters) => filters.findIndex(other => isDeepStrictEqual(other, filter)) === index) };
    if (input.scopeCoverage && !input.scopeCoverage.complete) set.coverageDependencies = mergeCandidateCoverageDependencies(set.coverageDependencies,
      [{ ...input.scopeCoverage, complete: false, kind: 'source', candidateRef: set.ref, coverageRef: set.coverageRef }]);
    if (resultView) resultView.baseRef = set.ref;
    const { rows: _rows, sources: _sources, reportedSources: _reported, ...metadata } = set;
    const sourcePlans = new Map<string, CandidateSource[]>(), sourceKey = this.sourceKey(sources); sourcePlans.set(sourceKey, sources);
    const reportedSourceKey = set.reportedSources ? this.sourceKey(set.reportedSources) : undefined;
    if (reportedSourceKey) sourcePlans.set(reportedSourceKey, set.reportedSources!);
    const stored: StoredCandidateSet = { ...metadata, memberIds: [...map.keys()], sourceKey, ...(reportedSourceKey ? { reportedSourceKey } : {}) };
    const metadataSize = Buffer.byteLength(JSON.stringify(stored)) + (resultView ? Buffer.byteLength(JSON.stringify(resultView)) : 0);
    const plannedSourceKeys = new Set<string>();
    const sourceSize = [...sourcePlans].reduce((sum, [key, values]) => sum + (this.sourceSnapshots.has(key) ? 0
      : replaced ? this.projectionSourceSize(values, plannedSourceKeys) : Buffer.byteLength(JSON.stringify(values))), 0);
    const factDelta = [...cache.values()].reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) - (this.factSizes.get(this.cacheKey(set.binding, row.id)) ?? 0), 0);
    const size = metadataSize + sourceSize + factDelta;
    const replacedView = replaced?.resultRef ? this.resultViews.get(replaced.resultRef) : undefined;
    const replacedBytes = replaced ? Buffer.byteLength(JSON.stringify(replaced)) + (replacedView ? Buffer.byteLength(JSON.stringify(replacedView)) : 0) : 0;
    const historyPlan = replaced ? this.planProjectionCoverage(this.materialize(replaced, replaced.binding), replaced.coverageRef) : undefined;
    if (this.sets.size + this.resultViews.size + 1 + (resultView ? 1 : 0) - (replaced ? 1 : 0) - (replacedView ? 1 : 0) > (this.options.maxRefs ?? 256)
      || this.bytes + size - replacedBytes + (historyPlan?.size ?? 0) > (this.options.maxBytes ?? 64 * 1024 * 1024))
      throw new AppError('CANDIDATE_CAPACITY', '宿主候选缓存容量不足；已保留原集合，可缩小本次字段或重新读取所需范围。');
    if (replaced) {
      this.commitProjectionCoverage(historyPlan!);
      this.delete(replaced.ref, replaced);
    }
    this.sets.set(set.ref, stored); this.coverageRefs.set(set.coverageRef, set.ref); this.bytes += metadataSize;
    if (replaced) {
      this.retainProjectionSources(sourceKey, sources); if (reportedSourceKey) this.retainProjectionSources(reportedSourceKey, set.reportedSources!);
    } else {
      this.retainSources(sourceKey, sources); if (reportedSourceKey) this.retainSources(reportedSourceKey, set.reportedSources!);
    }
    if (resultView) this.resultViews.set(resultView.ref, resultView);
    for (const row of cache.values()) this.cacheRow(set.binding, row);
    if (replaced?.refRole === 'input') for (const stage of this.sets.values()) {
      if (stage.continuation?.originRef === set.ref) {
        const before = Buffer.byteLength(JSON.stringify(stage)); delete stage.continuation;
        this.bytes += Buffer.byteLength(JSON.stringify(stage)) - before;
      }
      if (stage.qualification?.originRef === set.ref) for (const ref of [stage.ref, ...(stage.resultRef ? [stage.resultRef] : [])]) {
        const continuation = this.projectionWindows.get(ref);
        if (continuation) { this.bytes -= Buffer.byteLength(JSON.stringify(continuation)); this.projectionWindows.delete(ref); }
      }
    }
    return structuredClone(set);
  }
  get(ref: string, binding: CandidateBinding): CandidateSet {
    const view = this.resultViews.get(ref), set = this.sets.get(view?.baseRef ?? ref);
    if (!set) throw new AppError('CANDIDATE_REF_EXPIRED', '候选引用已失效，需重新读取必要来源。');
    this.validateBinding(binding);
    if (set.binding.turnId !== binding.turnId || set.binding.scopeKey !== binding.scopeKey
      || set.binding.accountId !== null && set.binding.accountId !== binding.accountId)
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选引用不属于本次读取轮次、账户或可见范围。');
    const result = this.materialize(set, binding, view?.memberIds);
    if (view) {
      const members = new Set(view.memberIds); result.ref = view.ref; result.parentRef = set.ref; result.refRole = 'result'; result.resultRef = view.ref;
      result.changedIds = result.changedIds.filter(id => members.has(id)); delete result.continuation;
    }
    result.requiresNsfw ||= result.rows.some(row => row.requiresNsfw);
    return result;
  }
  /** 只恢复游标所属真实工作集，不采纳模型重新拼装的筛选/证据/收藏条件。 */
  continuationArgs(ref: string, cursor: string, binding: CandidateBinding, display: { response_view?: 'page' | 'reference'; limit?: number } = {}): CandidateQueryArgs {
    const view = this.resultViews.get(ref), set = this.sets.get(view?.baseRef ?? ref);
    if (!set) throw new AppError('CANDIDATE_REF_EXPIRED', '候选续查引用已失效，需重新读取必要来源。');
    this.validateBinding(binding);
    if (set.binding.turnId !== binding.turnId || set.binding.scopeKey !== binding.scopeKey
      || set.binding.accountId !== null && set.binding.accountId !== binding.accountId)
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选续查不属于本次读取任务、账户或可见范围。');
    const continuation = typeof cursor === 'string' && cursor.startsWith('cp_') ? this.projectionContinuation(ref, cursor, binding) : set.continuation;
    if (typeof cursor !== 'string' || !cursor || !continuation || continuation.cursor !== cursor)
      throw new AppError('CANDIDATE_CURSOR_MISMATCH', '候选续查游标不属于指定工作引用。');
    if (Object.keys(display).some(key => !['response_view', 'limit'].includes(key))
      || display.response_view !== undefined && !['page', 'reference'].includes(display.response_view)
      || display.limit !== undefined && (!Number.isSafeInteger(display.limit) || display.limit < 1 || display.limit > 100))
      throw new AppError('INVALID_INPUT', '候选续查仅允许调整显示视图和1至100的显示窗口。');
    return { ...structuredClone(continuation.frozenArgs), ...display, candidate_ref: cursor.startsWith('cp_') ? ref : set.ref, cursor };
  }
  continuation(ref: string, cursor: string, binding: CandidateBinding, display: { response_view?: 'page' | 'reference'; limit?: number } = {}):
    { tool: 'refine_subject_candidates'; request: CandidateQueryArgs } {
    return { tool: 'refine_subject_candidates', request: this.continuationArgs(ref, cursor, binding, display) };
  }
  peekBinding(ref: string, turnId: string): { binding: CandidateBinding; visibility: 'public' | 'self'; requiresNsfw: boolean } {
    const set = this.sets.get(this.resultViews.get(ref)?.baseRef ?? ref);
    if (!set) throw new AppError('CANDIDATE_REF_EXPIRED', '候选引用已失效，需重新读取必要来源。');
    if (set.binding.turnId !== turnId) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选引用不属于本次读取轮次。');
    const requiresNsfw = set.requiresNsfw || set.memberIds.some(id => this.factCache.get(this.cacheKey(set.binding, id))?.requiresNsfw);
    return { binding: structuredClone(set.binding), visibility: set.visibility, requiresNsfw };
  }
  /** 覆盖详情读取存储时的证据快照，不被以后同ID事实缓存更新改写。 */
  getCoverage(ref: string, binding: CandidateBinding): CandidateSet {
    const set = this.projectionCoverage.get(ref) ?? this.sets.get(this.coverageRefs.get(ref) ?? '');
    if (!set) throw new AppError('CANDIDATE_REF_EXPIRED', '候选覆盖引用已失效，需重新读取必要来源。');
    this.validateBinding(binding);
    if (set.binding.turnId !== binding.turnId || set.binding.scopeKey !== binding.scopeKey
      || set.binding.accountId !== null && set.binding.accountId !== binding.accountId)
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选覆盖引用不属于本次读取轮次、账户或可见范围。');
    return this.materialize(set, set.binding);
  }
  peekCoverageBinding(ref: string, turnId: string): { binding: CandidateBinding; visibility: 'public' | 'self'; requiresNsfw: boolean } {
    const set = this.projectionCoverage.get(ref) ?? this.sets.get(this.coverageRefs.get(ref) ?? '');
    if (!set) throw new AppError('CANDIDATE_REF_EXPIRED', '候选覆盖引用已失效，需重新读取必要来源。');
    if (set.binding.turnId !== turnId) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选覆盖引用不属于本次读取轮次。');
    return { binding: structuredClone(set.binding), visibility: set.visibility, requiresNsfw: set.requiresNsfw };
  }
  /** 同轮次只复制明确SFW且有v0作品来源支持的公共字段，不迁移账户字段或权限范围。 */
  publicFacts(id: number, turnId: string): CandidateSeed | undefined {
    if (!Number.isSafeInteger(id) || id < 1 || !turnId) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '公共候选事实身份或读取轮次无效。');
    let merged: CandidateRow | undefined;
    for (const key of this.factIndex.get(JSON.stringify([turnId, id])) ?? []) {
      const row = this.factCache.get(key); if (!row) continue;
      const [owner, , , subjectId] = JSON.parse(key) as [string, number | null, string, number];
      if (owner !== turnId || subjectId !== id || row.requiresNsfw || row.fieldStates.nsfw !== 'known' || row.facts.nsfw !== false) continue;
      const sources = row.sources.filter(source => source.source === 'v0' && source.privateRecords !== 'included' && publicSubjectTools.has(source.tool));
      if (!sources.length) continue;
      const safeFields = CANDIDATE_FIELDS.filter(field => !PERSONAL_CANDIDATE_FIELDS.includes(field) && row.fieldStates[field] !== undefined && row.fieldStates[field] !== 'failed');
      const seed: CandidateSeed = { id, facts: Object.fromEntries(safeFields.map(field => [field, row.facts[field]])),
        fieldStates: Object.fromEntries(safeFields.map(field => [field, row.fieldStates[field]])),
        resolvedFields: row.resolvedFields.filter(field => safeFields.includes(field)), sources };
      merged = merged ? mergeCandidateFacts(merged, seed) : candidateRow(seed);
    }
    return merged ? { id: merged.id, facts: merged.facts, fieldStates: merged.fieldStates, resolvedFields: merged.resolvedFields, sources: merged.sources } : undefined;
  }
  merge(ref: string, binding: CandidateBinding, seeds: CandidateSeed[], sources: CandidateSource[] = []): CandidateSet {
    const prior = this.get(ref, binding), rows = new Map(prior.rows.map(row => [row.id, row])); let duplicates = 0; const changedIds: number[] = [];
    const owners = new Set(mergeCandidateSources(prior.sources, sources).filter(source => source.privateRecords === 'public_only'
      && ['get_user_collections', 'query_user_collections'].includes(source.tool)).map(source => String(JSON.parse(source.scope).username)));
    if (owners.size > 1) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '不同用户的公开收藏事实不能合并为同一候选集合。');
    for (const seed of seeds) {
      const previous = rows.get(seed.id), sourced = { ...seed, sources: mergeCandidateSources(seed.sources ?? [], sources) };
      const next = previous ? mergeCandidateFacts(previous, sourced) : candidateRow(sourced);
      if (previous) duplicates++;
      if (!previous || !isDeepStrictEqual({ ...previous, sources: [] }, { ...next, sources: [] })) changedIds.push(seed.id);
      rows.set(seed.id, next);
    }
    const reportedSources = this.projectionBaseline(prior.ref) ?? prior.reportedSources;
    return this.create({ binding, rows: [...rows.values()], sources: mergeCandidateSources(prior.sources, sources), parentRef: prior.ref,
      visibility: prior.visibility, ...(prior.account ? { account: prior.account } : {}), changedIds: [...new Set(changedIds)], duplicateCount: duplicates,
      ...(reportedSources ? { reportedSources } : {}), requiresNsfw: prior.requiresNsfw, inheritParentQualification: false });
  }
  updateFacts(ref: string, binding: CandidateBinding, id: number, patch: CandidateFactPatch): CandidateSet {
    const set = this.get(ref, binding);
    if (!set.rows.some(row => row.id === id)) throw new AppError('CANDIDATE_ID_MISMATCH', '补字段作品不属于候选集合。');
    return this.merge(ref, binding, [{ id, ...patch }]);
  }
  /** 字段补全更新事实，不创建成员/结果快照；所有改动在容量与范围检查后提交。 */
  cacheFacts(ref: string, binding: CandidateBinding, seeds: CandidateSeed[]): void {
    const set = this.get(ref, binding), members = new Map(set.rows.map(row => [row.id, row]));
    if (!isDeepStrictEqual(set.binding, binding)) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '字段缓存不能改变原集合账户或范围。');
    const changes = seeds.map(seed => {
      const current = members.get(seed.id);
      if (!current) throw new AppError('CANDIDATE_ID_MISMATCH', '补字段作品不属于候选集合。');
      const next = mergeCandidateFacts(current, seed);
      if (binding.accountId === null && !binding.scopeKey.startsWith('public:collections:') && PERSONAL_CANDIDATE_FIELDS.some(field => next.fieldStates[field] !== undefined))
        throw new AppError('CANDIDATE_SCOPE_MISMATCH', '个人事实必须绑定已核实账户。');
      return next;
    });
    const delta = changes.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) - (this.factSizes.get(this.cacheKey(binding, row.id)) ?? 0), 0);
    if (this.bytes + delta > (this.options.maxBytes ?? 64 * 1024 * 1024)) throw new AppError('CANDIDATE_CAPACITY', '宿主候选事实缓存容量不足；原集合已保留。');
    for (const row of changes) this.cacheRow(binding, row);
  }
  /** 仅新鲜资源读取调用：同步已缓存事实，不创建集合；公共/SFW基础事实可跨安全域更新。 */
  cacheResourceFacts(binding: CandidateBinding, seed: CandidateSeed): void {
    this.validateBinding(binding);
    const resource = candidateRow(seed), exactKey = this.cacheKey(binding, resource.id);
    if (binding.accountId === null && !binding.scopeKey.startsWith('public:collections:')
      && PERSONAL_CANDIDATE_FIELDS.some(field => resource.fieldStates[field] !== undefined))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '个人资源事实必须绑定已核实账户。');
    const sources = resource.sources.filter(source => source.source === 'v0' && source.privateRecords !== 'included' && publicSubjectTools.has(source.tool));
    const sharePublic = !resource.requiresNsfw && resource.fieldStates.nsfw === 'known' && resource.facts.nsfw === false && sources.length > 0;
    const fields = CANDIDATE_FIELDS.filter(field => !PERSONAL_CANDIDATE_FIELDS.includes(field) && field !== 'relations'
      && resource.fieldStates[field] !== undefined && resource.fieldStates[field] !== 'failed');
    const publicPatch: CandidateFactPatch = { facts: Object.fromEntries(fields.map(field => [field, resource.facts[field]])),
      fieldStates: Object.fromEntries(fields.map(field => [field, resource.fieldStates[field]])),
      resolvedFields: resource.resolvedFields.filter(field => fields.includes(field)), sources };
    const changes = new Map<string, CandidateRow>();
    for (const key of this.factIndex.get(JSON.stringify([binding.turnId, resource.id])) ?? []) {
      const current = this.factCache.get(key)!;
      if (key === exactKey) changes.set(key, mergeCandidateFacts(current, resource));
      else if (sharePublic && !current.requiresNsfw && current.fieldStates.nsfw === 'known' && current.facts.nsfw === false)
        changes.set(key, mergeCandidateFacts(current, publicPatch));
    }
    const delta = [...changes].reduce((sum, [key, row]) => sum + Buffer.byteLength(JSON.stringify(row)) - (this.factSizes.get(key) ?? 0), 0);
    if (this.bytes + delta > (this.options.maxBytes ?? 64 * 1024 * 1024)) throw new AppError('CANDIDATE_CAPACITY', '新资源事实同步超出宿主缓存容量；原事实已保留。');
    for (const [key, row] of changes) {
      const [turnId, accountId, scopeKey] = JSON.parse(key) as [string, number | null, string, number];
      this.cacheRow({ turnId, accountId, scopeKey }, row);
    }
  }
  projectionContinuation(ref: string, cursor: string, binding: CandidateBinding): CandidateContinuation {
    this.get(ref, binding);
    const continuation = this.projectionWindows.get(ref);
    if (!continuation || continuation.cursor !== cursor) throw new AppError('CANDIDATE_CURSOR_MISMATCH', '字段读取游标已失效或不属于指定集合。');
    return structuredClone(continuation);
  }
  projectionBaseline(ref: string): CandidateSource[] | undefined {
    const snapshot = this.projectionCoverage.get(this.projectionReports.get(ref) ?? '');
    return snapshot ? structuredClone(this.sourceSnapshots.get(snapshot.sourceKey)!.values) : undefined;
  }
  /** 字段分页仅保留最新游标，历史覆盖只存来源与计数，不重复存全体成员。 */
  recordProjection(set: CandidateSet, continuation?: CandidateContinuation, coverageRef = `cv_${randomUUID()}`): CandidateSet {
    const plan = this.planProjectionCoverage(set, coverageRef);
    const size = plan.size
      + (continuation ? Buffer.byteLength(JSON.stringify(continuation)) : 0) - (this.projectionWindows.has(set.ref) ? Buffer.byteLength(JSON.stringify(this.projectionWindows.get(set.ref))) : 0);
    if (this.bytes + size > (this.options.maxBytes ?? 64 * 1024 * 1024)) throw new AppError('CANDIDATE_CAPACITY', '宿主字段读取缓存容量不足；原集合已保留。');
    this.commitProjectionCoverage(plan);
    this.projectionReports.set(set.ref, coverageRef);
    const previous = this.projectionWindows.get(set.ref); if (previous) this.bytes -= Buffer.byteLength(JSON.stringify(previous));
    if (continuation) { this.projectionWindows.set(set.ref, structuredClone(continuation)); this.bytes += Buffer.byteLength(JSON.stringify(continuation)); }
    else this.projectionWindows.delete(set.ref);
    return { ...set, coverageRef };
  }
  private planProjectionCoverage(set: CandidateSet, coverageRef: string): {
    snapshot: StoredCandidateSet; sources: CandidateSource[]; reportedSources?: CandidateSource[]; size: number;
  } {
    const { rows: _rows, sources, reportedSources, ...metadata } = set;
    const qualification = metadata.qualification ? { ...metadata.qualification, matchedIds: [], pendingIds: [], remainingIds: [] } : undefined;
    const sourceKey = this.sourceKey(sources), reportedSourceKey = reportedSources ? this.sourceKey(reportedSources) : undefined;
    const snapshot: StoredCandidateSet = { ...metadata, coverageRef, memberIds: [], changedIds: [], sourceKey,
      ...(qualification ? { qualification } : {}), ...(reportedSourceKey ? { reportedSourceKey } : {}) };
    delete snapshot.continuation;
    const plans = new Map([[sourceKey, sources], ...(reportedSourceKey ? [[reportedSourceKey, reportedSources!]] as [string, CandidateSource[]][] : [])]);
    const newSourceKeys = new Set<string>();
    const size = Buffer.byteLength(JSON.stringify(snapshot)) + [...plans].reduce((sum, [key, values]) => sum + (this.sourceSnapshots.has(key) ? 0 : this.projectionSourceSize(values, newSourceKeys)), 0);
    return { snapshot, sources, ...(reportedSources ? { reportedSources } : {}), size };
  }
  private commitProjectionCoverage(plan: ReturnType<CandidateStore['planProjectionCoverage']>): void {
    const { snapshot, sources, reportedSources } = plan;
    this.bytes += Buffer.byteLength(JSON.stringify(snapshot)); this.projectionCoverage.set(snapshot.coverageRef, snapshot);
    this.retainProjectionSources(snapshot.sourceKey, sources);
    if (snapshot.reportedSourceKey) this.retainProjectionSources(snapshot.reportedSourceKey, reportedSources!);
  }
  endReadContext(turnId: string): void {
    this.deleteProjectionCoverage(set => set.binding.turnId === turnId);
    for (const [ref, set] of this.sets) if (set.binding.turnId === turnId) this.delete(ref, set);
    for (const key of this.factCache.keys()) if (JSON.parse(key)[0] === turnId) this.removeCache(key);
  }
  invalidateAccount(accountId: number): void {
    this.deleteProjectionCoverage(set => set.binding.accountId === accountId);
    for (const [ref, set] of this.sets) if (set.binding.accountId === accountId) this.delete(ref, set);
    for (const key of this.factCache.keys()) if (JSON.parse(key)[1] === accountId) this.removeCache(key);
  }
  close(): void { this.sets.clear(); this.resultViews.clear(); this.coverageRefs.clear(); this.projectionCoverage.clear(); this.projectionWindows.clear(); this.projectionReports.clear(); this.factCache.clear(); this.factSizes.clear(); this.sourceSnapshots.clear(); this.projectionSources.clear(); this.factIndex.clear(); this.bytes = 0; }
  private cacheRow(binding: CandidateBinding, row: CandidateRow): void {
    const key = this.cacheKey(binding, row.id), indexKey = JSON.stringify([binding.turnId, row.id]);
    this.removeCache(key); this.factCache.set(key, structuredClone(row));
    const size = Buffer.byteLength(JSON.stringify(row)); this.factSizes.set(key, size); this.bytes += size;
    const ids = this.factIndex.get(indexKey) ?? new Set<string>(); ids.add(key); this.factIndex.set(indexKey, ids);
  }
  private removeCache(key: string): void {
    const [turnId, , , id] = JSON.parse(key) as [string, number | null, string, number];
    const indexKey = JSON.stringify([turnId, id]), ids = this.factIndex.get(indexKey);
    ids?.delete(key); if (ids?.size === 0) this.factIndex.delete(indexKey);
    this.factCache.delete(key); this.bytes -= this.factSizes.get(key) ?? 0; this.factSizes.delete(key);
  }
  private cacheKey(binding: CandidateBinding, id: number): string { return JSON.stringify([binding.turnId, binding.accountId, binding.scopeKey, id]); }
  private delete(ref: string, set: StoredCandidateSet): void {
    for (const key of [ref, ...[...this.resultViews.values()].filter(view => view.baseRef === ref).map(view => view.ref)]) {
      const continuation = this.projectionWindows.get(key); if (continuation) this.bytes -= Buffer.byteLength(JSON.stringify(continuation)); this.projectionWindows.delete(key);
      this.projectionReports.delete(key);
    }
    this.bytes -= Buffer.byteLength(JSON.stringify(set)); this.sets.delete(ref); this.coverageRefs.delete(set.coverageRef);
    this.releaseSources(set.sourceKey); if (set.reportedSourceKey) this.releaseSources(set.reportedSourceKey);
    for (const [viewRef, view] of this.resultViews) if (view.baseRef === ref) { this.bytes -= Buffer.byteLength(JSON.stringify(view)); this.resultViews.delete(viewRef); }
  }
  private deleteProjectionCoverage(predicate: (set: StoredCandidateSet) => boolean): void {
    for (const [ref, set] of this.projectionCoverage) if (predicate(set)) {
      this.bytes -= Buffer.byteLength(JSON.stringify(set)); this.projectionCoverage.delete(ref);
      this.releaseSources(set.sourceKey); if (set.reportedSourceKey) this.releaseSources(set.reportedSourceKey);
    }
  }
  private sourceKey(sources: CandidateSource[]): string { return createHash('sha256').update(JSON.stringify(sources)).digest('hex'); }
  private retainSources(key: string, sources: CandidateSource[]): void {
    const existing = this.sourceSnapshots.get(key);
    if (existing) { existing.refs++; return; }
    const size = Buffer.byteLength(JSON.stringify(sources)); this.sourceSnapshots.set(key, { values: structuredClone(sources), refs: 1, bytes: size }); this.bytes += size;
  }
  private projectionSourceSize(sources: CandidateSource[], planned: Set<string>): number {
    let size = sources.length * 16;
    for (const source of sources) {
      const encoded = JSON.stringify(source), key = createHash('sha256').update(encoded).digest('hex');
      if (!this.projectionSources.has(key) && !planned.has(key)) { size += Buffer.byteLength(encoded); planned.add(key); }
    }
    return size;
  }
  private retainProjectionSources(key: string, sources: CandidateSource[]): void {
    const existing = this.sourceSnapshots.get(key); if (existing) { existing.refs++; return; }
    const pooled: string[] = [], values: CandidateSource[] = [];
    for (const source of sources) {
      const encoded = JSON.stringify(source), sourceKey = createHash('sha256').update(encoded).digest('hex');
      let entry = this.projectionSources.get(sourceKey);
      if (!entry) {
        entry = { key: sourceKey, value: structuredClone(source), refs: 0, bytes: Buffer.byteLength(encoded) };
        this.projectionSources.set(sourceKey, entry); this.bytes += entry.bytes;
      }
      entry.refs++; pooled.push(entry.key); values.push(entry.value);
    }
    const bytes = sources.length * 16;
    this.sourceSnapshots.set(key, { values, pooled, refs: 1, bytes }); this.bytes += bytes;
  }
  private releaseSources(key: string): void {
    const snapshot = this.sourceSnapshots.get(key); if (!snapshot) return;
    if (--snapshot.refs === 0) {
      this.sourceSnapshots.delete(key); this.bytes -= snapshot.bytes;
      for (const sourceKey of snapshot.pooled ?? []) {
        const entry = this.projectionSources.get(sourceKey)!;
        if (--entry.refs === 0) { this.projectionSources.delete(sourceKey); this.bytes -= entry.bytes; }
      }
    }
  }
  /** 返回阶段当前成员与资格；历史coverage另存，事实复用同账户同范围最新缓存。 */
  private materialize(stored: StoredCandidateSet, binding: CandidateBinding, members = stored.memberIds): CandidateSet {
    const { memberIds: _members, sourceKey, reportedSourceKey, ...metadata } = stored;
    const rows = members.map(id => {
      const base = this.factCache.get(this.cacheKey(stored.binding, id));
      if (!base) throw new AppError('CANDIDATE_REF_EXPIRED', '候选成员事实已失效，需重新读取必要来源。');
      const current = this.factCache.get(this.cacheKey(binding, id));
      return current && current !== base ? mergeCandidateFacts(base, current) : base;
    });
    return structuredClone({ ...metadata, rows, sources: this.sourceSnapshots.get(sourceKey)!.values,
      ...(reportedSourceKey ? { reportedSources: this.sourceSnapshots.get(reportedSourceKey)!.values } : {}) });
  }
  private validateBinding(binding: CandidateBinding): void {
    if (!binding.turnId || !binding.scopeKey || binding.accountId !== null && (!Number.isSafeInteger(binding.accountId) || binding.accountId < 1))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '宿主候选读取绑定无效。');
  }
}
