import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { object } from '../support/bangumi.js';
import { checkPageMetadata, type SubjectSummary } from './subject-output.js';

export interface CollectionReadBinding {
  readContextId: string;
  accountId: number | null;
  source: 'p1' | 'v0';
}
export interface CollectionSourceScope {
  username: string;
  subject_type: number;
  collection_type?: number;
}
export interface CollectionCheapFilter {
  collection_types?: number[];
  exclude_collection_types?: number[];
  personal_rating?: { min?: number; max?: number };
  personal_tags?: string[];
}
export interface CollectionReadArguments extends CollectionSourceScope {
  filter?: CollectionCheapFilter & Record<string, unknown>;
  source_limit?: number;
  collection_ref?: string;
}
/** 与collectionPage的规范化行兼容；comment只复用来源已读取的字段，不额外发请求。 */
export interface CollectionSourceRow {
  subject: SubjectSummary;
  subjectId: number;
  collectionStatus: number;
  statusMeaning: string;
  personalRating: number | null;
  personalTags: string[] | null;
  personalComment?: string | null;
  private: boolean | null;
  chapters: number | null;
  volumes: number | null;
  updatedAt: string | null;
}
export interface CollectionSourceCoverage {
  source: 'p1' | 'v0';
  scannedCount: number;
  visibleCount: number;
  pagesRead: number;
  collectionTotal: number | null;
  sourceNextOffset: number | null;
  sourceExhausted: boolean;
  sourceComplete: boolean;
  filterComplete: boolean;
  matchedCount: number;
  rejectedCount: number;
  unknownFilterCount: number;
  excludedNsfwCount: number;
  unknownNsfwCount: number;
  privateRecords: 'included' | 'public_only';
  collectionTypes: number[];
  stopReason: 'exhausted' | 'source_budget' | 'work_budget';
}
export interface CollectionReadResult {
  collectionRef: string;
  rows: CollectionSourceRow[];
  unknownRows: CollectionSourceRow[];
  scope: CollectionSourceScope;
  coverage: CollectionSourceCoverage;
  readAt: string;
}
export interface CollectionIndexInfo { collectionRef: string; scope: CollectionSourceScope; total: number | null; scannedCount: number;
  nextOffset: number | null; sourceComplete: boolean; requiresNsfw: boolean }
export interface CollectionPersonalFacts {
  collectionState: 'collected' | 'not_collected' | 'unknown';
  collectionStatus: number | null;
  personalRating: number | null;
  personalTags: string[] | null;
  personalComment: string | null;
}
export interface CollectionLookup {
  subjectId: number;
  state: 'known' | 'unknown';
  membership: 'collected' | 'not_collected' | 'not_in_scope' | 'unknown';
  personalFacts: CollectionPersonalFacts;
  fieldStates: Record<keyof CollectionPersonalFacts, 'known' | 'unknown'>;
  /** 缺席仅证明本引用覆盖的可见范围，不能外推到未读状态或私密记录。 */
  excludesCollectionTypes: number[];
  scope: CollectionSourceScope;
  privateRecords: 'included' | 'public_only';
}
export type ReadCollectionPage = (offset: number, limit: number) => Promise<unknown>;

interface CollectionSnapshot {
  ref: string;
  binding: CollectionReadBinding;
  scope: CollectionSourceScope;
  rows: Map<number, CollectionSourceRow>;
  total: number | null;
  nextOffset: number | null;
  scannedCount: number;
  pagesRead: number;
  excludedNsfwCount: number;
  unknownNsfwCount: number;
  readAt: string;
  busy: boolean;
}

const statuses = [1, 2, 3, 4, 5];
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
function invalid(message: string): never { throw new AppError('INCOMPLETE_DATA', message); }
const validTags = (value: unknown): value is string[] | null => value === null || Array.isArray(value) && value.length <= 100
  && new Set(value).size === value.length && value.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 100);

/** 评分0是未评分；明确数值筛选按来源原值执行，不产生偏好推断。 */
export function matchCollectionCheapFields(row: CollectionSourceRow, filter: CollectionCheapFilter = {}): 'matched' | 'rejected' | 'unknown' {
  if (filter.collection_types && !filter.collection_types.includes(row.collectionStatus)
    || filter.exclude_collection_types?.includes(row.collectionStatus)) return 'rejected';
  let unknown = false;
  if (filter.personal_rating) {
    if (row.personalRating === null) unknown = true;
    else if (filter.personal_rating.min !== undefined && row.personalRating < filter.personal_rating.min
      || filter.personal_rating.max !== undefined && row.personalRating > filter.personal_rating.max) return 'rejected';
  }
  if (filter.personal_tags?.length) {
    if (row.personalTags === null) unknown = true;
    else if (filter.personal_tags.some(tag => !row.personalTags!.includes(tag))) return 'rejected';
  }
  return unknown ? 'unknown' : 'matched';
}

/**
 * 同一宿主读取轮次内的来源快照。来源分页与匹配结果分页分离，结果投影交给候选引擎。
 * 来源每次固定读取100条，source_limit仅控制本次读取预算，可续读任意总量的集合。
 * 宿主运行时间窗口只在页间让出，保留已验证来源进度；不转为取消、未知或源穷尽。
 */
export class CollectionReader {
  private readonly snapshots = new Map<string, CollectionSnapshot>();

  private get(ref: string, binding: CollectionReadBinding): CollectionSnapshot {
    const snapshot = this.snapshots.get(ref);
    if (!snapshot || !isDeepStrictEqual(snapshot.binding, binding)) throw new AppError('COLLECTION_REF_INVALID', '收藏引用已失效或不属于当前读取轮次、账户及来源。');
    return snapshot;
  }

  peek(ref: string, readContextId: string): { binding: CollectionReadBinding; scope: CollectionSourceScope } {
    const snapshot = this.snapshots.get(ref);
    if (!snapshot || snapshot.binding.readContextId !== readContextId) throw new AppError('COLLECTION_REF_INVALID', '收藏引用已失效或不属于当前读取轮次。');
    return { binding: structuredClone(snapshot.binding), scope: structuredClone(snapshot.scope) };
  }
  indexInfo(ref: string, binding: CollectionReadBinding): CollectionIndexInfo {
    const snapshot = this.get(ref, binding);
    return { collectionRef: snapshot.ref, scope: structuredClone(snapshot.scope), total: snapshot.total, scannedCount: snapshot.scannedCount,
      nextOffset: snapshot.nextOffset, sourceComplete: snapshot.nextOffset === null && snapshot.excludedNsfwCount === 0 && snapshot.unknownNsfwCount === 0,
      requiresNsfw: [...snapshot.rows.values()].some(row => row.subject.nsfw === true) };
  }
  /** 仅同轮次/账户/媒体的本人全状态来源；元数据查询不复制原始行。 */
  findOwnAllStates(binding: CollectionReadBinding, subjectType: number): CollectionIndexInfo | undefined {
    let best: CollectionIndexInfo | undefined;
    for (const snapshot of this.snapshots.values()) {
      if (!isDeepStrictEqual(snapshot.binding, binding) || snapshot.scope.username !== '-' || snapshot.scope.subject_type !== subjectType || snapshot.scope.collection_type !== undefined) continue;
      const sourceComplete = snapshot.nextOffset === null && snapshot.excludedNsfwCount === 0 && snapshot.unknownNsfwCount === 0;
      if (best && (best.sourceComplete && !sourceComplete || best.sourceComplete === sourceComplete && best.scannedCount >= snapshot.scannedCount)) continue;
      best = this.indexInfo(snapshot.ref, binding);
    }
    return best;
  }

  clearReadContext(readContextId: string): void {
    for (const [ref, snapshot] of this.snapshots) if (snapshot.binding.readContextId === readContextId) this.snapshots.delete(ref);
  }
  invalidateAccount(accountId: number): void {
    for (const [ref, snapshot] of this.snapshots) if (snapshot.binding.accountId === accountId) this.snapshots.delete(ref);
  }
  clear(): void { this.snapshots.clear(); }

  async read(args: CollectionReadArguments, binding: CollectionReadBinding, readPage: ReadCollectionPage, signal?: AbortSignal,
    shouldYield?: () => boolean): Promise<CollectionReadResult> {
    const self = args.username === '-';
    if (!binding.readContextId || ![1, 2, 3, 4, 6].includes(args.subject_type) || typeof args.username !== 'string' || !args.username
      || args.collection_type !== undefined && !statuses.includes(args.collection_type)
      || self && (binding.source !== 'p1' || !integer(binding.accountId, 1))
      || !self && (binding.source !== 'v0' || binding.accountId !== null)) throw new AppError('INVALID_INPUT', '收藏来源范围或宿主身份绑定无效。');
    const budget = args.source_limit ?? 100;
    if (!integer(budget, 1) || budget > 10000) throw new AppError('INVALID_INPUT', '单次收藏来源读取预算必须为1至10000。');
    const scope: CollectionSourceScope = { username: args.username, subject_type: args.subject_type,
      ...(args.collection_type === undefined ? {} : { collection_type: args.collection_type }) };
    const snapshot = args.collection_ref ? this.get(args.collection_ref, binding) : this.create(scope, binding);
    if (!isDeepStrictEqual(snapshot.scope, scope)) throw new AppError('COLLECTION_REF_SCOPE_MISMATCH', '收藏续读引用与账户、媒体或来源收藏状态范围不一致。');
    if (snapshot.busy) throw new AppError('COLLECTION_REF_BUSY', '同一收藏引用正在读取，待本次读取完成后继续。');
    snapshot.busy = true;
    try {
      let readCount = 0, workBudgetReached = false;
      while (snapshot.nextOffset !== null && readCount < budget) {
        signal?.throwIfAborted();
        if (shouldYield?.()) { workBudgetReached = true; break; }
        const offset = snapshot.nextOffset;
        const raw = object(await readPage(offset, 100));
        signal?.throwIfAborted();
        // 一页先全部校验再提交，不将异常页的一部分写入可续读快照。
        const page = object(raw.page);
        const pageScope = object(raw.scope);
        if (raw.schemaVersion !== 1 || raw.kind !== 'page' || raw.entity !== 'collection'
          || pageScope.username !== scope.username || pageScope.subject_type !== scope.subject_type
          || pageScope.collection_type !== scope.collection_type || pageScope.offset !== offset || pageScope.limit !== 100) invalid('收藏来源DTO身份或查询范围与本次读取不一致。');
        if (!Array.isArray(raw.data)) invalid('收藏来源分页缺少规范化记录。');
        const rows = raw.data as CollectionSourceRow[];
        try { checkPageMetadata(page, rows.length); } catch { invalid('收藏来源分页元数据不一致，不能认定完整。'); }
        const total = page.total;
        if (!integer(total) || page.totalKind !== undefined && page.totalKind !== 'exact' || page.offset !== offset || page.limit !== 100
          || snapshot.total !== null && snapshot.total !== total) invalid('收藏来源总数漂移、分页身份或总数性质无效。');
        const excluded = page.excludedNsfwCount ?? 0, unknown = page.unknownNsfwCount ?? 0;
        const windowLength = Math.min(100, Math.max(0, total - offset));
        const nextOffset = offset + windowLength < total ? offset + windowLength : null;
        if (!integer(excluded) || !integer(unknown) || rows.length + excluded + unknown !== windowLength
          || page.nextOffset !== nextOffset || page.sourceNextOffset !== undefined && page.sourceNextOffset !== nextOffset
          || page.sourceHasMore !== undefined && page.sourceHasMore !== (nextOffset !== null)) invalid('收藏来源窗口缺少记录或游标跳过未核实范围。');
        if (raw.visibility !== (self ? 'self' : 'public') || self && object(raw.account).id !== binding.accountId
          || !self && raw.account !== undefined) throw new AppError('PRIVATE_SCOPE', '收藏来源返回了异账户或私密范围。');
        const pageIds = new Set<number>();
        for (const row of rows) {
          if (!row || !row.subject || !integer(row.subjectId, 1) || row.subject.id !== row.subjectId || row.subject.subjectType !== scope.subject_type
            || row.subject.url !== `https://bgm.tv/subject/${row.subjectId}`
            || typeof row.subject.name !== 'string' || !row.subject.name.trim() || !statuses.includes(row.collectionStatus)
            || scope.collection_type !== undefined && row.collectionStatus !== scope.collection_type
            || pageIds.has(row.subjectId) || snapshot.rows.has(row.subjectId)) invalid('收藏来源包含重复、异作品、异媒体或状态范围之外的记录。');
          if (row.personalRating !== null && (!integer(row.personalRating) || row.personalRating > 10) || !validTags(row.personalTags)
            || row.personalComment !== undefined && row.personalComment !== null && (typeof row.personalComment !== 'string' || row.personalComment.length > 2000)
            || row.private !== null && typeof row.private !== 'boolean') invalid('收藏来源个人字段类型或范围无效。');
          if (!self && row.private !== false) throw new AppError('PRIVATE_SCOPE', '第三方公开收藏不能包含私密或未核实可见性的记录。');
          pageIds.add(row.subjectId);
        }
        snapshot.total = total;
        snapshot.pagesRead++;
        snapshot.scannedCount += windowLength;
        snapshot.excludedNsfwCount += excluded;
        snapshot.unknownNsfwCount += unknown;
        snapshot.nextOffset = nextOffset;
        snapshot.readAt = new Date().toISOString();
        rows.forEach(row => snapshot.rows.set(row.subjectId, structuredClone(row)));
        readCount += windowLength;
      }
      return this.result(snapshot, args.filter, workBudgetReached);
    } finally { snapshot.busy = false; }
  }

  private create(scope: CollectionSourceScope, binding: CollectionReadBinding): CollectionSnapshot {
    const snapshot: CollectionSnapshot = { ref: `collection:${randomUUID()}`, binding: structuredClone(binding), scope,
      rows: new Map(), total: null, nextOffset: 0, scannedCount: 0, pagesRead: 0, excludedNsfwCount: 0, unknownNsfwCount: 0,
      readAt: new Date().toISOString(), busy: false };
    this.snapshots.set(snapshot.ref, snapshot);
    return snapshot;
  }

  private result(snapshot: CollectionSnapshot, filter: CollectionCheapFilter = {}, workBudgetReached = false): CollectionReadResult {
    const rows: CollectionSourceRow[] = [], unknownRows: CollectionSourceRow[] = [];
    let rejectedCount = 0;
    for (const row of snapshot.rows.values()) {
      const match = matchCollectionCheapFields(row, filter);
      if (match === 'matched') rows.push(structuredClone(row));
      else if (match === 'unknown') unknownRows.push(structuredClone(row));
      else rejectedCount++;
    }
    const sourceExhausted = snapshot.nextOffset === null;
    const sourceComplete = sourceExhausted && snapshot.excludedNsfwCount === 0 && snapshot.unknownNsfwCount === 0;
    return { collectionRef: snapshot.ref, rows, unknownRows, scope: structuredClone(snapshot.scope), readAt: snapshot.readAt,
      coverage: { source: snapshot.binding.source, scannedCount: snapshot.scannedCount, visibleCount: snapshot.rows.size,
        pagesRead: snapshot.pagesRead, collectionTotal: snapshot.total, sourceNextOffset: snapshot.nextOffset,
        sourceExhausted, sourceComplete, filterComplete: sourceComplete && unknownRows.length === 0,
        matchedCount: rows.length, rejectedCount, unknownFilterCount: unknownRows.length,
        excludedNsfwCount: snapshot.excludedNsfwCount, unknownNsfwCount: snapshot.unknownNsfwCount,
        privateRecords: snapshot.scope.username === '-' ? 'included' : 'public_only',
        collectionTypes: snapshot.scope.collection_type === undefined ? [...statuses] : [snapshot.scope.collection_type],
        stopReason: sourceExhausted ? 'exhausted' : workBudgetReached ? 'work_budget' : 'source_budget' } };
  }

  /** 原始可见范围的宿主快照；不因个人字段filter删除记录。 */
  snapshot(ref: string, binding: CollectionReadBinding): CollectionReadResult { return this.result(this.get(ref, binding)); }

  /** ID缺席证明仅适用于返回scope.subject_type；调用方须先核实待关联候选的媒体。 */
  lookup(ref: string, subjectIds: number[], binding: CollectionReadBinding): CollectionLookup[] {
    const snapshot = this.get(ref, binding);
    if (subjectIds.some(id => !integer(id, 1)) || new Set(subjectIds).size !== subjectIds.length) throw new AppError('INVALID_INPUT', '收藏关联作品ID必须是去重的正整数。');
    const complete = snapshot.nextOffset === null && snapshot.excludedNsfwCount === 0 && snapshot.unknownNsfwCount === 0;
    const collectionTypes = snapshot.scope.collection_type === undefined ? [...statuses] : [snapshot.scope.collection_type];
    const allOwnStates = complete && snapshot.scope.username === '-' && snapshot.scope.collection_type === undefined;
    return subjectIds.map(subjectId => {
      const row = snapshot.rows.get(subjectId);
      const knownAbsent = !row && complete;
      const personalFacts: CollectionPersonalFacts = { collectionState: row ? 'collected' : allOwnStates ? 'not_collected' : 'unknown',
        collectionStatus: row?.collectionStatus ?? null, personalRating: row?.personalRating ?? null,
        personalTags: row?.personalTags === undefined ? null : structuredClone(row.personalTags), personalComment: row?.personalComment ?? null };
      return { subjectId, state: row || knownAbsent ? 'known' : 'unknown',
        membership: row ? 'collected' : allOwnStates ? 'not_collected' : knownAbsent ? 'not_in_scope' : 'unknown', personalFacts,
        fieldStates: { collectionState: row || allOwnStates ? 'known' : 'unknown', collectionStatus: row ? 'known' : 'unknown',
          personalRating: row?.personalRating !== undefined && row.personalRating !== null ? 'known' : 'unknown',
          personalTags: row?.personalTags !== undefined && row.personalTags !== null ? 'known' : 'unknown',
          personalComment: row?.personalComment !== undefined && row.personalComment !== null ? 'known' : 'unknown' },
        excludesCollectionTypes: knownAbsent ? collectionTypes : [], scope: structuredClone(snapshot.scope),
        privateRecords: snapshot.scope.username === '-' ? 'included' : 'public_only' };
    });
  }
}
