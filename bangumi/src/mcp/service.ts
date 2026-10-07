import { ResourceStore } from './resource-store.js';
import { stripResourceRef, cachedResourceSelection, type CachedResource, type CachedRange, type CachedResourceSelection } from './resource-contract.js';
import { projectModelResult } from './model-projection.js';
import { assertResourceFields } from './resource-policy.js';
import { completeSubjectPageResource, completeSubjectResource } from './subject-output.js';
import { completeResourceResult } from './resource-output.js';
import { AppError, SubmissionError, safeError, diagnosedError } from '../support/errors.js';
import { createErrorDiagnostic } from '../support/error-diagnostic.js';
import { findToolDefinition, validateToolArguments } from './catalog.js';
import type { McpTransport, McpReadScope } from './transport.js';
import { preparedBaseline, type PreparedBaseline } from './prepared.js';
import { subjectDetails, subjectSummary, subjectPage, browseSourceWindow, browseSubjectPage, collectionPage, indexSubjectPage, checkOutput, checkSubjectResponse, type SubjectInclude } from './subject-output.js';
import { resourceResult, checkResourceResponse, entitySummary, episodeCollectionStatus } from './resource-output.js';
import { SubmissionTracker, checkSubmission } from './submission.js';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { isWatchedUntil, watchedUntilIds } from './episode-progress.js';
import { CommunityReader } from './community-service.js';
import { isCommunityTool } from './community-schemas.js';
import { checkCommunityResponse } from './community-output.js';
import { anonymousContext, unverifiedContext, type AccessContext } from './access-context.js';
import { accountRead, normalizeSubject } from './account-read.js';
import { collectionMatch, dateMatches, fullDate, type DateBounds } from './collection-query.js';
import { CollectionQueryInputState } from './collection-query-input.js';
import { batchScope, batchPreparation, type BatchPreparation, type McpBatchScope } from './batch-context.js';
import { PersonCharactersQuery } from './person-characters.js';
import { PersonCandidates, type PersonCandidatePage } from './person-candidates.js';
import { resourceOutputSchema } from './resource-schemas.js';
import { compileSubjectSearch, applySearchPlan, requireBrowseCoverage } from './search-capabilities.js';
import { planRead } from './read-routing.js';
import type { McpReadContext } from './read-context.js';
import { executeReadRecovery, clearReadRecoveryScope } from './read-recovery.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CandidateStore, candidateRow, candidateSourceRef, mergeCandidateFacts, mergeCandidateSources, type CandidateBinding } from './candidate-store.js';
import { CandidateQuery, evaluateCandidateFacts } from './candidate-query.js';
import { CandidateReaders, candidateSubjectForm } from './candidate-readers.js';
import { durationFacts, normalizeCandidateDate } from './subject-facts.js';
import { RelationQuery, type RelationReadPage } from './relation-query.js';
import type { RelationQueryArgs, CandidateLineageResponse } from './relation-contract.js';
import { candidatePresentationSet } from './candidate-presentation.js';
import { prepareCandidateOutput } from './candidate-output.js';
import { effectiveCandidateOutputArgs, type CandidateOutputArgs } from './candidate-output-contract.js';
import {
  CANDIDATE_FIELDS, PERSONAL_CANDIDATE_FIELDS, checkCandidateResponse, type CandidateSeed, type CandidateSource,
  type CandidateQueryArgs, type CandidateRow, type CandidateField, type CandidateFactPatch, type CandidateSourceReadState
} from './candidate-contract.js';
import {
  CollectionReader, type CollectionReadBinding, type CollectionSourceRow, type CollectionSourceScope,
  type CollectionIndexInfo, type CollectionLookup
} from './collection-reader.js';
export interface McpWriteGuard { accountId: number; subjectId?: number; expectedStatus?: number; prepared?: PreparedBaseline; batchPreparation?: BatchPreparation }
type ObjectValue = Record<string, unknown>;
type CandidateDetailCapture = {
  allowAccount: boolean; binding: CandidateBinding; context: AccessContext;
  raw?: ObjectValue; source?: AccessContext['source']; accountId?: number | null
};
function obj(value: unknown, label = 'Bangumi响应'): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', `${label}必须是对象。`);
  return value as ObjectValue;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AppError('INVALID_RESPONSE', 'Bangumi响应缺少有效ID。');
  return value;
}
function compact(input: ObjectValue): ObjectValue { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)); }
function stableCandidateKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCandidateKey);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableCandidateKey(item)]));
  return value;
}
function candidateFactVersion(row: CandidateRow): string {
  return createHash('sha256').update(JSON.stringify(stableCandidateKey({ facts: row.facts, fieldStates: row.fieldStates,
    excludesCollectionTypes: row.excludesCollectionTypes, requiresNsfw: row.requiresNsfw }))).digest('hex');
}
/** 上界/下界由已验证的有类型参数编译；模型不能提交原始查询表达式。 */
function searchFilter(args: ObjectValue): ObjectValue {
  const input = args.filter === undefined ? {} : obj(args.filter);
  const result: ObjectValue = compact({ type: args.subject_type === undefined ? undefined : [args.subject_type], tag: input.tag, meta_tags: input.meta_tags, nsfw: input.nsfw });
  for (const key of ['rating', 'rating_count', 'rank', 'air_date']) {
    if (input[key] === undefined) continue;
    const bounds = obj(input[key]);
    result[key] = [bounds.min === undefined ? undefined : `>=${bounds.min}`, bounds.max === undefined ? undefined : `<=${bounds.max}`].filter(value => value !== undefined);
  }
  return result;
}
function ratedSubject(value: unknown): ObjectValue {
  const item = obj(value);
  const total = item.rating && typeof item.rating === 'object' ? obj(item.rating).total : undefined;
  if (total !== undefined && total !== null && (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)) throw new AppError('INVALID_RESPONSE', '评分人数必须是非负整数或未知。');
  return { ...item, ratingCount: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null };
}
function canonicalSubject(value: unknown): ObjectValue {
  const item = ratedSubject(normalizeSubject(value));
  return { ...item, id: positive(item.id), name_cn: item.name_cn ?? item.nameCN ?? '', date: item.date ?? (item.airtime && obj(item.airtime).date), total_episodes: item.total_episodes ?? item.eps };
}
function canonicalEpisode(value: unknown): ObjectValue {
  const item = obj(value); const checkedStatus = episodeCollectionStatus(item); const collection = item.collection == null ? {} : obj(item.collection);
  const id = positive(item.id); const owner = positive(item.subject_id ?? item.subjectID);
  const status = checkedStatus;
  if (!Number.isInteger(status) || ![0, 1, 2, 3].includes(Number(status))) throw new AppError('INVALID_RESPONSE', '章节收藏状态不合法。');
  return { ...item, id, subject_id: owner, name_cn: item.name_cn ?? item.nameCN ?? '', collection: { ...collection, type: status } };
}
function canonicalCollection(value: unknown): ObjectValue {
  const item = obj(value); const interest = obj(item.interest, '个人收藏'); const subject = subjectSummary(canonicalSubject(item));
  if (typeof interest.type !== 'number' || ![1, 2, 3, 4, 5].includes(interest.type)) throw new AppError('INVALID_RESPONSE', '个人收藏状态无效。');
  return {
    subject, subject_id: subject.id, type: interest.type, rate: interest.rate, comment: interest.comment, tags: interest.tags,
    private: interest.private, ep_status: interest.epStatus ?? interest.ep_status, vol_status: interest.volStatus ?? interest.vol_status,
    updated_at: typeof (interest.updatedAt ?? interest.updated_at) === 'number' ? new Date(Number(interest.updatedAt ?? interest.updated_at) * 1000).toISOString() : interest.updatedAt ?? interest.updated_at
  };
}
/** 仅固定、已认证的作品详情可用省略 interest 表示未收藏；残缺作品不能取得空基线。 */
function checkedUncollectedSubject(item: ObjectValue): void {
  const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (![1, 2, 3, 4, 6].includes(Number(item.type)) || typeof item.type !== 'number'
    || ['name', 'nameCN', 'summary', 'info'].some(key => typeof item[key] !== 'string') || !String(item.name).trim()
    || ['eps', 'volumes', 'redirect', 'seriesEntry'].some(key => !Number.isSafeInteger(item[key]) || Number(item[key]) < 0)
    || ['locked', 'nsfw', 'series'].some(key => typeof item[key] !== 'boolean')
    || ['airtime', 'collection', 'platform', 'rating'].some(key => !record(item[key]))
    || ['infobox', 'metaTags', 'tags'].some(key => !Array.isArray(item[key]))) {
    throw new AppError('INCOMPLETE_COLLECTION', '目标作品快照不完整，无法核实未收藏状态。');
  }
}
function canonicalIndex(value: unknown): ObjectValue {
  const item = obj(value); const user = item.user == null ? undefined : obj(item.user);
  return { ...item, id: positive(item.id), ownerId: item.ownerId ?? item.uid ?? user?.id, title: item.title, description: item.description ?? item.desc, private: item.private };
}
function canonicalRelated(value: unknown): ObjectValue {
  const item = obj(value); const subject = item.subject == null ? undefined : obj(item.subject);
  return { ...item, subject_id: item.subject_id ?? item.sid ?? subject?.id, comment: item.comment, order: item.order };
}
/** 公共读取独立于登录；本人/写入绑定账户，NSFW仅在需要时核实。 */
export class BangumiMcpService {
  private readonly candidates = new CandidateStore();
  private readonly collections = new CollectionReader();
  private readonly collectionQueryInputs = new CollectionQueryInputState();
  private readonly collectionCandidates = new Map<string, { turnId: string; ref: string; inputRef: string }>();
  private readonly sourceCandidateStages = new Map<string, { turnId: string; ref: string; inputRef: string; sourceRef: string }>();
  private readonly candidateDetailCapture = new AsyncLocalStorage<CandidateDetailCapture>();
  private readonly resources = new ResourceStore();
  private readonly captures = new AsyncLocalStorage<{ path: string; raw: unknown; args: unknown; source: string }[]>();
  private readonly transport: McpTransport;
  private resourceEpoch = 0;
  private readonly operationCacheEpoch = new AsyncLocalStorage<{epoch:number}>();
  private currentViewer: AccessContext | undefined;
  private readonly fullValues = new WeakMap<ObjectValue, ObjectValue>();
  private nativeCandidateDetailEpoch = 0;
  private readonly community: CommunityReader;
  private readonly personCharacters: PersonCharactersQuery;
  private readonly personCandidates: PersonCandidates;
  private readonly relations: RelationQuery;
  private readonly relationRun = new AsyncLocalStorage<{ context: AccessContext; binding: CandidateBinding }>();
  private readonly relationCapture = new AsyncLocalStorage<{ raw?: unknown[]; allowAccount: boolean }>();
  private readonly relationSources = new Map<string, { turnId: string; raw: unknown[]; context: AccessContext }>();
  private readonly readTurns = new Set<string>();
  private readonly readContexts = new AsyncLocalStorage<McpReadContext>();
  private readonly candidateWork = new AsyncLocalStorage<number>();
  private batchContext: { id: string; phase: McpBatchScope['phase']; context: AccessContext; usedNsfw: boolean } | undefined;
  constructor(transport: McpTransport) {
    // 公共、账户、社区以及固定账户连接都保留完整实际响应，不记录认证头/Cookie。
    const captured = <T>(source: string, path: string, args: unknown, value: T): T => {
      this.captures.getStore()?.push({ source, path, args, raw: structuredClone(value) });
      return value;
    };
    this.transport = new Proxy(transport, {
get: (target, key) => {
        const member = Reflect.get(target, key, target);
        if (['public', 'account', 'community', 'webCollections'].includes(String(key))) return async (...args: unknown[]) => captured(String(key), String(args[0]), args[1], await member.apply(target, args));
        if (key === 'bindReadScope') return typeof member !== 'function' ? undefined : async (...args: unknown[]) => {
          const scope = await member.apply(target, args);
          return { ...scope, account: async (path: string, options: unknown) => captured('account', path, options, await scope.account(path, options)) };
        };
        return typeof member === 'function' ? member.bind(target) : member;
      }
});
    transport = this.transport;
    this.community = new CommunityReader(transport);
    this.personCharacters = new PersonCharactersQuery(transport);
    this.personCandidates = new PersonCandidates(this.candidates, {
      shouldYield: () => this.candidateShouldYield(),
      readPage: async (args, context, signal) => {
        const raw = obj(await this.personCharacterPage(args, context, signal, true));
        const normalized = resourceResult('get_person_characters', raw, args);
        checkResourceResponse('get_person_characters', normalized, args, resourceOutputSchema('get_person_characters')!);
        return raw as PersonCandidatePage;
      },
    });
    this.relations = new RelationQuery(this.candidates, {
      shouldYield: () => this.candidateShouldYield(),
      readRelations: (parentId, offset, limit, signal) => this.readCandidateRelations(parentId, offset, limit, signal),
      loadFacts: (row, fields, include, signal, args) => {
        const run = this.relationRun.getStore();
        if (!run) throw new AppError('INTERNAL_ERROR', '关联候选缺少宿主读取上下文。');
        return this.loadCandidateFacts(row, fields, include, run.context, run.binding, signal, args ?? {});
      },
      lookupCollection: (ref, rows) => {
        const run = this.relationRun.getStore();
        if (!run) throw new AppError('INTERNAL_ERROR', '关联候选缺少宿主读取上下文。');
        const lookups = this.collections.lookup(ref, rows.map(row => row.id), this.collectionBinding(run.context, ref));
        return rows.map((row, index) => {
          const lookup = lookups[index]!;
          return row.facts.subjectType === lookup.scope.subject_type
            ? { id: row.id, facts: lookup.personalFacts, fieldStates: lookup.fieldStates, excludesCollectionTypes: lookup.excludesCollectionTypes }
            : { id: row.id, facts: {} };
        });
      },
    });
  }
  close(): Promise<void> {
    this.collectionQueryInputs.clear();
    this.clearCandidateDetails(); this.resources.clear();
    this.candidates.close(); this.collections.clear(); this.collectionCandidates.clear(); this.sourceCandidateStages.clear();
    this.relations.close(); this.relationSources.clear();
    this.community.clear(); this.personCharacters.clear();
    for (const turnId of this.readTurns) this.endReadContext(turnId);
    return this.transport.close();
  }
  endReadContext(turnId: string): void {
    this.collectionQueryInputs.clear(turnId);
    this.clearCandidateDetails(turnId); this.resources.clear(turnId);
    this.candidates.endReadContext(turnId); this.collections.clearReadContext(turnId);
    this.relations.endReadContext(turnId);
    this.personCandidates.endReadContext(turnId);
    for (const [key, value] of this.relationSources) if (value.turnId === turnId) this.relationSources.delete(key);
    for (const [key, value] of this.collectionCandidates) if (value.turnId === turnId) this.collectionCandidates.delete(key);
    for (const [key, value] of this.sourceCandidateStages) if (value.turnId === turnId) this.sourceCandidateStages.delete(key);
    clearReadRecoveryScope(turnId); this.transport.clearReadContext?.(turnId); this.readTurns.delete(turnId);
  }
  private async identity(signal?: AbortSignal): Promise<AccessContext> {
    if (this.transport.identity) return this.transport.identity(signal);
    // 兼容离线/嵌入客户端；生产传输不会在身份核实中读取NSFW设置。
    if (this.transport.preflight) return this.transport.preflight(signal);
    const account = await this.checkedAccount(signal);
    return { ...anonymousContext(), mode: 'account', account, source: 'p1', nsfwApplied: false };
  }
  private async nsfw(context: AccessContext, signal?: AbortSignal, fresh = false): Promise<void> {
    if (!context.account) return;
    const checked = this.transport.ensureNsfw
      ? await this.transport.ensureNsfw(context, signal, this.batchContext ? `batch:${this.batchContext.id}` : undefined, { fresh })
      : this.transport.preflight ? await this.transport.preflight(signal) : context;
    if (checked.account?.id !== context.account.id) throw new AppError('ACCOUNT_CHANGED', '权限核实时账户改变。');
    context.nsfw = structuredClone(checked.nsfw); context.nsfwApplied = checked.nsfwApplied;
    if (this.batchContext) {
      this.batchContext.context.nsfw = structuredClone(context.nsfw);
      this.batchContext.context.nsfwApplied = context.nsfwApplied;
    }
  }
  private hasNsfw(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(row => this.hasNsfw(row));
    const row = value as ObjectValue;
    return row.nsfw === true || Object.values(row).some(field => this.hasNsfw(field));
  }
  private async allowNsfw(context: AccessContext, signal?: AbortSignal): Promise<boolean> {
    if (context.nsfw.state === 'not_checked') await this.nsfw(context, signal);
    const allowed = context.nsfw.allowed === true && context.nsfw.preference !== false;
    if (allowed && this.batchContext) this.batchContext.usedNsfw = true;
    return allowed;
  }
  private async gateNsfw(value: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    if (!this.hasNsfw(value)) return value;
    if (context.account && await this.allowNsfw(context, signal)) return value;
    if (Array.isArray(value.data)) {
      const rows = value.data as unknown[]; const data = rows.filter(row => !this.hasNsfw(row));
      const more = Boolean(value.sourceHasMore ?? (typeof value.total === 'number' && Number(value.offset ?? 0) + rows.length < value.total));
      return {
        ...value, data, total: null, totalKind: 'unknown', excludedNsfwCount: rows.length - data.length,
        sourceNextOffset: more ? value.sourceNextOffset ?? (Number(value.offset ?? 0) + Number(value.limit ?? rows.length)) : null,
        sourceHasMore: more
      };
    }
    throw new AppError(context.nsfw.state === 'unknown' ? 'NSFW_PERMISSION_UNKNOWN' : 'NSFW_UNAVAILABLE',
      '此对象需要NSFW可见范围，本次未取得可用权限；可跳过并继续其他对象。', context);
  }
  private async checkedAccount(signal?: AbortSignal): Promise<{ id: number; username: string }> {
    const user = await this.transport.currentUser(signal, false);
    positive(user.id);
    if (typeof user.username !== 'string' || !user.username) throw new AppError('INVALID_RESPONSE', '当前账户缺少用户名。');
    return user;
  }
  private async assertAccount(accountId: number, signal?: AbortSignal): Promise<void> {
    if ((await this.checkedAccount(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '读取或修改期间登录账户改变。');
  }
  private async selfUser(username: string, signal?: AbortSignal): Promise<{ id: number; username: string } | null> {
    if (username === '-') return this.checkedAccount(signal);
    // 显式用户名代表公开读取；绝不为了判断他人身份加载本机凭据或访问 /me。
    return null;
  }
  private relationPage(value: unknown, limit: number, offset: number): ObjectValue {
    if (!Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '关联资料必须是数组。');
    for (const item of value) positive(obj(item).id);
    const data = value.slice(offset, offset + limit); const nextOffset = offset + data.length < value.length ? offset + data.length : null;
    return { data, total: value.length, limit, offset, nextOffset, complete: offset === 0 && data.length === value.length };
  }
  private page(value: unknown, limit: number, offset: number): ObjectValue & { data: unknown[]; total: number } {
    const item = obj(value);
    if (!Array.isArray(item.data) || typeof item.total !== 'number' || !Number.isSafeInteger(item.total) || item.total < 0 || item.data.length > limit || item.data.length > Math.max(0, item.total - offset)
      || item.limit !== undefined && item.limit !== limit || item.offset !== undefined && item.offset !== offset) throw new AppError('INVALID_RESPONSE', '分页结果数量或范围不一致。');
    const expected = Math.min(limit, Math.max(0, item.total - offset));
    if (item.data.length !== expected) throw new AppError('INCOMPLETE_DATA', '分页缺少记录，不能认定结果完整。');
    return { ...item, data: item.data, total: item.total, limit, offset };
  }
  /** 搜索接口每次最多20条；补齐工具请求范围，不放宽双端分页契约。 */
  private async readResource(path: string, options: import('./transport.js').McpRequestOptions, context: AccessContext, signal?: AbortSignal): Promise<unknown> {
    return context.account ? accountRead(this.transport, path, options, context, signal) : this.transport.public(path, options, signal);
  }
  private async personCharacterPage(args: ObjectValue, context: AccessContext, signal?: AbortSignal, candidateMode = false): Promise<unknown> {
    if (context.account && this.transport.bindReadScope) {
      const scope = await this.transport.bindReadScope(context, signal);
      try {
        return await this.personCharacters.call(args, context, signal, {
          scopeKey: scope.key, readAccount: scope.account, verifyScope: scope.verify, candidateMode,
          resolveNsfw: () => this.allowNsfw(context, signal),
        });
      } finally { await scope.close(); }
    }
    // 离线/嵌入客户端仍核对当前账户和权限；生产 transport 总是使用独立的会话绑定。
    const verifyScope = async (): Promise<void> => {
      if (context.account) await this.assertAccount(context.account.id, signal);
    };
    return this.personCharacters.call(args, context, signal, {
      scopeKey: JSON.stringify([context.account, this.readContexts.getStore()?.turnId ?? 'embedded']), verifyScope, candidateMode,
      resolveNsfw: () => this.allowNsfw(context, signal),
      readAccount: (path, options) => this.transport.account(path, {
        ...options,
        ...(context.account ? { expectedAccountId: context.account.id } : {})
      }, signal),
    });
  }
  private async searchPage(name: 'search_subjects' | 'search_characters' | 'search_persons', args: ObjectValue, body: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    const limit = Number(args.limit); const offset = Number(args.offset);
    const data: unknown[] = []; const seen = new Set<number>(); let total: number | undefined;
    let sourceOffset = offset; let sourceHasMore = true;
    const kind = name === 'search_characters' ? 'character' : 'person';
    const entitySchema = name === 'search_subjects' ? undefined : {
      type: 'array', maxItems: 20, items: { $ref: `#/$defs/${kind === 'character' ? 'CharacterSummary' : 'PersonSummary'}` },
      $defs: findToolDefinition(name).outputSchema!.$defs,
    };
    const plan = name === 'search_subjects' ? compileSubjectSearch(body, context) : undefined;
    if (plan) applySearchPlan(context, plan);
    for (let batch = 0; batch < Math.ceil(limit / 20); batch++) {
      signal?.throwIfAborted();
      const batchLimit = Math.min(20, limit - data.length); const batchOffset = sourceOffset;
      const options = { method: 'POST', query: { limit: batchLimit, offset: batchOffset }, body: plan?.body ?? body };
      const raw = plan ? plan.source === 'p1'
        ? await this.transport.account('/p1/search/subjects', { ...options, expectedAccountId: context.account!.id }, signal)
        : await this.transport.public('/v0/search/subjects', options, signal)
        : await this.readResource(`/v0/search/${name.slice('search_'.length)}`, options, context, signal);
      const payload = obj(raw);
      if (!Array.isArray(payload.data) || payload.data.length > batchLimit || typeof payload.total !== 'number'
        || !Number.isSafeInteger(payload.total) || payload.total < 0
        || payload.limit !== undefined && payload.limit !== batchLimit || payload.offset !== undefined && payload.offset !== batchOffset) {
        throw new AppError('INVALID_RESPONSE', '搜索分页身份、页长或估计总数不合法。');
      }
      const page = {
        ...payload, data: payload.data as unknown[], total: payload.total, limit: batchLimit, offset: batchOffset,
        totalKind: 'estimated', sourceHasMore: payload.data.length > 0,
        sourceNextOffset: payload.data.length > 0 ? batchOffset + batchLimit : null
      };
      if (plan?.source === 'p1') page.data = page.data.map(normalizeSubject);
      signal?.throwIfAborted();
      total = page.total;
      // 每页先核对对应实体及固定输出契约，异常页不能推动下一次读取。
      const pageArgs = { ...args, limit: batchLimit, offset: batchOffset };
      if (name === 'search_subjects') subjectPage(page, pageArgs);
      // 内部补页offset可以超过模型参数上限；这里只校验实体，最终合并结果仍完整校验原始scope。
      else checkOutput(entitySchema!, page.data.map(raw => entitySummary(raw, kind)));
      for (const raw of page.data) {
        const id = positive(obj(raw).id);
        if (seen.has(id)) throw new AppError('INCOMPLETE_DATA', '搜索分页记录重复。');
        seen.add(id); data.push(raw);
      }
      sourceOffset += batchLimit; sourceHasMore = page.sourceHasMore;
      if (data.length === limit || page.data.length < batchLimit) break;
    }
    return {
      data, total: total ?? 0, limit, offset, totalKind: 'estimated', sourceHasMore,
      sourceNextOffset: sourceHasMore ? sourceOffset : null
    };
  }
  private async allAccount(path: string, accountId: number, query: ObjectValue = {}, signal?: AbortSignal): Promise<unknown[]> {
    const all: unknown[] = []; const seen = new Set<number>(); let total: number | undefined;
    for (let offset = 0; offset < 10000; offset += 100) {
      signal?.throwIfAborted();
      const page = this.page(await this.transport.account(path, { query: { ...query, limit: 100, offset }, expectedAccountId: accountId }, signal), 100, offset);
      if (total !== undefined && total !== page.total) throw new AppError('INCOMPLETE_DATA', '分页总数在读取期间变化。');
      total = page.total;
      if (total > 10000) throw new AppError('INCOMPLETE_DATA', '账户分页超过安全读取上限。');
      for (const raw of page.data) { const id = positive(obj(raw).id); if (seen.has(id)) throw new AppError('INCOMPLETE_DATA', '分页记录重复。'); seen.add(id); all.push(raw); }
      if (all.length === total) { await this.assertAccount(accountId, signal); return all; }
    }
    throw new AppError('INCOMPLETE_DATA', '账户分页未完整读取。');
  }
  private async myCollection(subjectId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue | null> {
    const value = obj(await this.transport.account(`/p1/subjects/${subjectId}`, { expectedAccountId: accountId }, signal));
    if (value.id !== subjectId) throw new AppError('INVALID_RESPONSE', '作品快照返回了其他对象。');
    if (!Object.hasOwn(value, 'interest') || value.interest === null) {
      checkedUncollectedSubject(value);
      return null;
    }
    return canonicalCollection(value);
  }
  private async myEntityCollection(entity: 'characters' | 'persons', entityId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue | null> {
    const all = await this.allAccount(`/p1/collections/${entity}`, accountId, {}, signal);
    const value = all.find(item => obj(item).id === entityId);
    return value === undefined ? null : { ...obj(value), id: entityId, collected: true };
  }
  private async myIndex(indexId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue> {
    const index = canonicalIndex(await this.transport.account(`/p1/indexes/${indexId}`, { expectedAccountId: accountId }, signal));
    if (index.id !== indexId) throw new AppError('INVALID_RESPONSE', '目录响应返回了其他对象。');
    const all = await this.allAccount('/p1/collections/indexes', accountId, {}, signal);
    return { ...index, collected: all.some(item => obj(item).id === indexId) };
  }
  private async ownedIndex(indexId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue> {
    const index = canonicalIndex(await this.transport.account(`/p1/indexes/${indexId}`, { expectedAccountId: accountId }, signal));
    if (index.id !== indexId) throw new AppError('INVALID_RESPONSE', '目录响应返回了其他对象。');
    if (index.ownerId !== accountId) throw new AppError('PERMISSION_DENIED', '只能修改当前账户拥有的目录。');
    await this.assertAccount(accountId, signal);
    return index;
  }
  private async related(indexId: number, subjectId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue> {
    const all = await this.allAccount(`/p1/indexes/${indexId}/related`, accountId, { cat: 0 }, signal);
    const matches = all.map(canonicalRelated).filter(item => item.subject_id === subjectId);
    if (matches.length !== 1) throw new AppError('INVALID_INPUT', '目录作品不存在或不唯一。');
    return matches[0]!;
  }
  private async privateEpisode(episodeId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue> {
    const result = canonicalEpisode(await this.transport.account(`/p1/episodes/${episodeId}`, { expectedAccountId: accountId }, signal));
    if (result.id !== episodeId) throw new AppError('INVALID_RESPONSE', '章节响应返回了其他对象。');
    return result;
  }
  private async allPrivateEpisodes(subjectId: number, accountId: number, signal?: AbortSignal): Promise<ObjectValue[]> {
    const data = (await this.allAccount(`/p1/subjects/${subjectId}/episodes`, accountId, {}, signal)).map(canonicalEpisode);
    if (data.some(ep => ep.subject_id !== subjectId)) throw new AppError('INVALID_RESPONSE', '章节所属作品与请求不一致。');
    return data;
  }
  private checkEpisode(episode: ObjectValue, guard: McpWriteGuard, subjectId?: number): void {
    const target = subjectId ?? guard.subjectId;
    if (!target || episode.subject_id !== target || guard.subjectId !== undefined && guard.subjectId !== target) throw new AppError('STALE_PREVIEW', '章节所属作品与宿主授权不一致。');
    if (guard.expectedStatus !== undefined && obj(episode.collection).type !== guard.expectedStatus) throw new AppError('STALE_PREVIEW', '章节现状已变化，需重新预览。');
  }
  async call(name: string, argumentsValue: unknown, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope, readContext?: McpReadContext): Promise<unknown> {
    const args = validateToolArguments(name, argumentsValue);
    if(findToolDefinition(name).effect==='read'&&signal?.aborted)throw new AppError('CANCELLED','缓存与API读取已取消。');
    if (name === 'read_cached_resource') return this.readCachedFields(args, readContext?.turnId ?? this.candidateOwner(),signal);
    if (readContext) this.readTurns.add(readContext.turnId);
    const startedEpoch = this.resourceEpoch;
    const deadline = performance.now() + 45_000;
    const operation = () => ['refine_subject_candidates', 'expand_subject_relations', 'continue_subject_query'].includes(name) || args.result_mode === 'candidates'
      ? this.candidateWork.run(deadline, () => this.callScoped(name, args, signal, guard, batch)) : this.callScoped(name, args, signal, guard, batch);
    const publicOperation = async (): Promise<unknown> => {
      try {
        this.collectionQueryInputs.validate(name, args, this.candidateOwner());
        const capture: { path: string; raw: unknown; args: unknown; source: string }[] = [];
        const cacheEpoch={epoch:startedEpoch};
        const value = await this.operationCacheEpoch.run(cacheEpoch,()=>this.captures.run(capture, operation));
        const effect=findToolDefinition(name).effect;
        if (effect==='read' && (signal?.aborted || startedEpoch !== this.resourceEpoch)) throw new AppError('RESOURCE_EXPIRED', '读取完成时轮次缓存已失效，未重新填入迟到资源。');
        const normalized = obj(stripResourceRef(value));
        // 已确认写回执必须保留；轮次结束/取消仅阻止重新填入展示缓存。
        if(effect==='write'&&(signal?.aborted||cacheEpoch.epoch!==this.resourceEpoch))return normalized;
        const accessContext = normalized.accessContext as AccessContext;
        const completeValue=this.fullValues.get(value as ObjectValue);
        let cachedValue = completeValue ?? normalized;
        let fieldStates: ObjectValue = completeValue?.resourceFieldStates as ObjectValue ?? {};
        const targetPath = name === 'get_subject_details' ? `subjects/${args.subject_id}`
          : name === 'get_character_details' ? `characters/${args.character_id}` : name === 'get_person_details' ? `persons/${args.person_id}`
            : name === 'get_episode_details' ? `episodes/${args.episode_id}` : name === 'get_index' ? `${args.own === true ? 'indexes' : 'indices'}/${args.index_id}`
              : name === 'get_user_info' ? `users/${encodeURIComponent(String(args.username === '-' ? accessContext.account?.username : args.username))}`
                : /_revision$/.test(name) ? `revisions/${name.split('_')[1] === 'person' ? 'persons' : `${name.split('_')[1]}s`}/${args.revision_id}` : undefined;
        const mainRaw = targetPath ? capture.findLast(row => row.path === `/v0/${targetPath}` || row.path === `/p1/${targetPath}`)?.raw : undefined;
        if (!completeValue && name === 'get_subject_details' && mainRaw) {
          const complete = completeSubjectResource(mainRaw, Number(args.subject_id));
          cachedValue = { ...complete.value, accessContext };
          fieldStates = complete.fieldStates;
        }
        else if (!completeValue && resourceOutputSchema(name) && findToolDefinition(name).effect === 'read' && mainRaw) {
          const complete = completeResourceResult(name, mainRaw, args, normalized);
          cachedValue = { ...complete.value, accessContext };
          fieldStates = complete.fieldStates;
        }
        const continuedPage = cachedValue.kind === 'candidate_continuation' && obj(cachedValue.result).kind === 'candidate_page';
        let candidateValue = continuedPage ? obj(cachedValue.result) : cachedValue;
        if (candidateValue.kind === 'candidate_page' && typeof candidateValue.resultRef === 'string') {
          const set = this.candidates.get(candidateValue.resultRef, this.candidateBinding(accessContext, candidateValue.resultRef));
          const pageIds = new Set((Array.isArray(candidateValue.data) ? candidateValue.data as ObjectValue[] : []).map(row => Number(row.id)));
          candidateValue = { ...candidateValue, data: set.rows.filter(row => pageIds.has(row.id)).map(row => {
              const key = this.candidateDetailKey(accessContext, set.binding, row.id), detail = key ? this.resources.getRaw(key) : undefined;
              const extra = detail ? completeSubjectResource(detail.raw, row.id).value : {};
              return { ...extra, ...row.facts, id: row.id, fieldStates: row.fieldStates };
            }) };
          cachedValue = continuedPage ? { ...cachedValue, result: candidateValue } : candidateValue;
        }
        if (['candidate_output', 'candidate_output_page'].includes(String(cachedValue.kind)) && typeof cachedValue.candidateRef === 'string') {
          const set = this.candidates.get(cachedValue.candidateRef, this.candidateBinding(accessContext, cachedValue.candidateRef));
          cachedValue = { ...cachedValue, resourceCandidateVersions: set.rows.map(row => ({ id: row.id, version: candidateFactVersion(row) })) };
        }
        const isSubjectList = ['search_subjects','browse_subjects','get_user_collections','query_user_collections','get_index_subjects',
          'get_subject_relations','get_character_subjects','get_person_subjects','get_daily_broadcast'].includes(name);
        if(isSubjectList) {
          const relevant = (path:string):boolean => name==='get_daily_broadcast'?path==='/calendar'||path==='/p1/calendar'
            : name==='search_subjects'?/^\/(v0|p1)\/search\/subjects$/.test(path)
            : name==='browse_subjects'?/^\/(v0|p1)\/subjects$/.test(path)
            : name==='get_subject_relations'?new RegExp(`^/(v0|p1)/subjects/${args.subject_id}/subjects$`).test(path)
            : name==='get_character_subjects'?new RegExp(`^/(v0|p1)/characters/${args.character_id}/subjects$`).test(path)
            : name==='get_person_subjects'?new RegExp(`^/(v0|p1)/persons/${args.person_id}/subjects$`).test(path)
            : name==='get_index_subjects'?new RegExp(`^/(?:v0/indices|p1/indexes)/${args.index_id}/(?:subjects|related)$`).test(path)
            : /\/collections(?:\/subjects)?$/.test(path);
          for(const source of capture)if(relevant(source.path))cachedValue=completeSubjectPageResource(source.raw,cachedValue);
        }
        this.observeViewer(accessContext);
        let resourceRef:string;
        try {resourceRef=this.resources.put(name, { ...cachedValue, resourceFieldStates: fieldStates }, capture, this.candidateOwner(), accessContext, this.transport.cachedContextKey?.(accessContext));}
        catch(error){if(effect==='write')return normalized;throw error;}
        this.collectionQueryInputs.remember(name, args, value, this.candidateOwner());
        const stripCacheStates = (raw:unknown):unknown=>{
          if(Array.isArray(raw))return raw.map(stripCacheStates);
          if(!raw||typeof raw!=='object')return raw;
          return Object.fromEntries(Object.entries(obj(raw)).filter(([field])=>field!=='resourceFieldStates').map(([field,item])=>[field,stripCacheStates(item)]));
        };
        const returned = isSubjectList && args.result_mode!=='candidates' ? obj(stripCacheStates(cachedValue)) : normalized;
        return { ...returned, resourceRef };
      }
      catch (error) {
        // 内部读取失败以本次公开工具为边界返回，不能因sourceTool仍是子工具而被客户端改成契约错误。
        if (findToolDefinition(name).effect === 'read' && error instanceof AppError && error.sourceTool && error.sourceTool !== name) {
          const scoped = new AppError(error.code, error.message, error.accessContext);
          Object.defineProperty(scoped, 'sourceTool', { value: name });
          throw scoped;
        }
        throw error;
      }
    };
    const execute = () => executeReadRecovery(name, args, publicOperation, {
      ...(readContext ? { turnId: readContext.turnId } : {}), ...(signal ? { signal } : {}),
      ...(batch ? { maxRetries: 0 } : {}),
    });
    return readContext ? this.readContexts.run(readContext, () => this.transport.withReadContext ? this.transport.withReadContext(readContext, execute) : execute()) : execute();
  }
  private async verifyCachedBinding(cached: CachedResource, signal?: AbortSignal): Promise<void> {
    if (!cached.accessContext.account) return;
    if (this.transport.validateCachedContext) await this.transport.validateCachedContext(cached.accessContext, signal, this.resources.bindingKey(cached.resourceRef));
    else if (this.transport.identity) {
      // 嵌入mock可提供本地identity；生产永远用上面的零HTTP核对。
      const current = await this.transport.identity(signal);
      if (cached.accessContext.nsfwApplied && current.nsfw.state!=='not_checked' && (current.nsfw.allowed !== true || current.nsfw.preference === false)) throw new AppError('NSFW_SCOPE_CHANGED', '缓存的NSFW权限已改变。');
      if (current.account?.id !== cached.accessContext.account.id) {
        this.resources.clear();
        this.resourceEpoch++;
        throw new AppError('ACCOUNT_CHANGED', '缓存绑定账户已改变。');
      }
    }
  }
  private observeViewer(context: AccessContext): void {
    if (!context.account) return;
    if (this.currentViewer?.account && (this.currentViewer.account.id !== context.account.id
      || this.currentViewer.nsfw.state !== 'not_checked' && context.nsfw.state !== 'not_checked' && !isDeepStrictEqual(this.currentViewer.nsfw, context.nsfw))) {
      this.resources.clear();
      this.resourceEpoch++;
    }
    const previousNsfw = this.currentViewer?.account?.id === context.account.id && context.nsfw.state === 'not_checked'
      ? this.currentViewer.nsfw : undefined;
    this.currentViewer = structuredClone(context);
    // 只核实身份不会撤销同账户此前已核实的权限快照；新的权限核实时才更新或失效。
    if (previousNsfw) this.currentViewer.nsfw = structuredClone(previousNsfw);
  }
  private cacheScope(ref: string, turnId: string): CachedResource {
    const cached = this.resources.get(ref, turnId);
    if (cached.accessContext.account && this.currentViewer?.account?.id !== cached.accessContext.account.id) throw new AppError('ACCOUNT_CHANGED', '缓存绑定的账户已改变。');
    if (cached.accessContext.nsfwApplied && (!this.currentViewer?.account || this.currentViewer.nsfw.allowed !== true || this.currentViewer.nsfw.preference === false)) throw new AppError('NSFW_SCOPE_CHANGED', '缓存绑定的NSFW权限已改变。');
    return cached;
  }
  async readCachedResource(ref: string, context?: McpReadContext, signal?: AbortSignal, selection?: CachedResourceSelection): Promise<CachedResource> {
    const selected = selection === undefined ? undefined : cachedResourceSelection(selection);
    const read = async () => {
      const turnId = context?.turnId ?? this.candidateOwner(), cached = this.resources.get(ref, turnId);
      try {
        this.cacheScope(ref, turnId);
        await this.verifyCachedBinding(cached, signal);
        if(signal?.aborted)throw new AppError('CANCELLED','缓存读取已取消。');
        this.cacheScope(ref, turnId);
        const value = cached.value.kind === 'candidate_continuation' && obj(cached.value.result).kind === 'candidate_page'
          ? obj(cached.value.result) : cached.value;
        const candidateRef = typeof value.resultRef === 'string' ? value.resultRef : typeof value.candidateRef === 'string' ? value.candidateRef : undefined;
        if (candidateRef && ['candidate_page', 'candidate_output', 'candidate_output_page'].includes(String(value.kind))) {
          const pageRows = Array.isArray(value.data) ? value.data as ObjectValue[] : [];
          const prepared = value.presentation !== undefined;
          const completionScope = prepared && value.scope && typeof value.scope === 'object' && obj(value.scope).completion_scope === 'exhaustive'
            ? 'exhaustive' : 'selected';
          const subjectIds = prepared ? undefined : selected?.subjectIds;
          if (subjectIds && subjectIds.some(id => pageRows.filter(row => row.id === id).length !== 1))
            throw new AppError('CANDIDATE_ID_MISMATCH', '展示作品不属于此缓存成员窗口，不能从其他页或引用补入。');
          const binding = this.candidateBinding(cached.accessContext, candidateRef), currentSet = this.candidates.get(candidateRef, binding);
          const currentMembers = new Map(currentSet.rows.map(row => [row.id, row])), selectedIds = subjectIds ? new Set(subjectIds) : undefined;
          if (subjectIds?.some(id => !currentMembers.has(id)))
            throw new AppError('CANDIDATE_ID_MISMATCH', '展示作品已经不属于此引用的已通过结果，需在原范围重新核实。');
          if (Array.isArray(value.resourceCandidateVersions)) {
            const versions = value.resourceCandidateVersions as ObjectValue[];
            if (versions.length !== currentMembers.size || versions.some(row => {
              const current = currentMembers.get(Number(row.id));
              return !current || row.version !== candidateFactVersion(current);
            })) throw new AppError('RESOURCE_VERSION_CHANGED', '候选事实已经刷新，旧展示引用需重新准备。');
          }
          for (const row of pageRows) {
            if (selectedIds && !selectedIds.has(Number(row.id))) continue;
            const current = currentMembers.get(Number(row.id));
            if (!current || Object.entries(current.facts).some(([field, fact]) => Object.hasOwn(row, field) && !isDeepStrictEqual(row[field], fact))
              || row.fieldStates && Object.entries(obj(row.fieldStates)).some(([field, state]) => !isDeepStrictEqual(current.fieldStates[field as CandidateField], state)))
              throw new AppError('RESOURCE_VERSION_CHANGED', '候选事实已经刷新，旧展示引用需重新准备。');
          }
          candidatePresentationSet(this.candidates, candidateRef, binding, cached.accessContext, completionScope, subjectIds);
        }
        return cached;
      } catch (error) {
        if (error instanceof AppError && !error.sourceTool) Object.defineProperty(error, 'sourceTool', { value: cached.sourceTool });
        throw error;
      }
    };
    return context ? this.readContexts.run(context, read) : read();
  }
  private async readCachedFields(args: ObjectValue, turnId: string,signal?:AbortSignal): Promise<ObjectValue> {
    const cached = this.cacheScope(String(args.resource_ref), turnId);
    await this.verifyCachedBinding(cached,signal);
    if(signal?.aborted)throw new AppError('CANCELLED','缓存读取已取消。');
    this.cacheScope(cached.resourceRef,turnId);
    const fields = Array.isArray(args.fields) ? args.fields as string[] : [];
    assertResourceFields(cached.sourceTool, fields);
    let value = cached.value;
    if (Array.isArray(args.keys)) {
      if (!Array.isArray(value.data)) throw new AppError('INVALID_INPUT', '本引用不是可按成员筛选的分页资源。');
      const identities = (item: unknown): ObjectValue => {
        const row = obj(item);
        const target = row.target && typeof row.target === 'object' ? obj(row.target) : undefined;
        return { ...row, ...(target ? { id: target.id, kind: target.kind } : {}), ...(row.subject && typeof row.subject === 'object' ? { subjectId: obj(row.subject).id } : {}), ...(row.person && typeof row.person === 'object' ? { personId: obj(row.person).id } : {}), ...(row.character && typeof row.character === 'object' ? { characterId: obj(row.character).id } : {}) };
      };
      const rows = value.data as unknown[];
      const selected: unknown[] = [];
      for (const key of args.keys) {
        const wanted = typeof key === 'number' ? { id: key } : obj(key);
        const matches = rows.filter(row => Object.entries(wanted).every(([field, expected]) => identities(row)[field] === expected));
        if (matches.length !== 1) throw new AppError('INVALID_INPUT', '成员主键不属于引用或不唯一；关联资源必须提供复合主键。');
        selected.push(matches[0]);
      }
      value = { ...value, data: selected };
    }
    let projected = projectModelResult(value, cached.sourceTool, { fields });
    let range: ObjectValue | undefined;
    const needsRange = (raw: unknown): boolean => {
      if (Array.isArray(raw)) return raw.some(needsRange);
      if (!raw || typeof raw !== 'object') return false;
      return Object.entries(obj(raw)).some(([field,item]) => fields.includes(field)
        ? typeof item === 'string' ? Array.from(item).length > 5000
          : item && typeof item === 'object' && !Array.isArray(item) && typeof obj(item).text === 'string' && Array.from(String(obj(item).text)).length > 5000
        : needsRange(item));
    };
    if (args.range || needsRange(projected)) {
      const input = (args.range ?? {offset:0,limit:5000}) as CachedRange;
      const offset = input.offset ?? 0, limit = input.limit ?? 500;
      const lengths: number[] = [];
      const slice = (raw: unknown): unknown => {
        if (typeof raw === 'string') {
          const chars = Array.from(raw);
          lengths.push(chars.length);
          return chars.slice(offset, offset + limit).join('');
        }
        if (Array.isArray(raw)) {
          lengths.push(raw.length);
          return raw.slice(offset, offset + limit);
        }
        if (raw && typeof raw === 'object' && typeof obj(raw).text === 'string') {
          const row = obj(raw), chars = Array.from(String(row.text));
          lengths.push(chars.length);
          return { ...row, text: chars.slice(offset, offset + limit).join(''), isFullText:offset===0&&offset+limit>=chars.length, range: { offset, returnedChars:Math.min(limit,Math.max(0,chars.length-offset)),totalChars:chars.length,nextOffset:offset + limit < chars.length ? offset + limit : null } };
        }
        return raw;
      };
      const walk = (raw: unknown): unknown => {
        if (Array.isArray(raw)) return raw.map(walk);
        if (!raw || typeof raw !== 'object') return raw;
        return Object.fromEntries(Object.entries(obj(raw)).map(([field, item]) => [field, fields.includes(field) ? slice(item) : walk(item)]));
      };
      projected = walk(projected) as ObjectValue;
      const total = Math.max(0, ...lengths);
      range = { offset, limit, total, nextOffset: offset + limit < total ? offset + limit : null, complete: offset + limit >= total };
    }
    const declaredStates = value.resourceFieldStates as ObjectValue | undefined;
    const hasFact = (raw: unknown, field: string): boolean => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
      const row = obj(raw);
      if (Object.hasOwn(row, field)) return row[field] !== null && row[field] !== undefined;
      return ['subject', 'person', 'character', 'episode', 'target'].some(key => hasFact(row[key], field));
    };
    const fieldStates = Object.fromEntries(fields.map(field => {
      const state = declaredStates?.[field];
      if (state !== undefined) return [field, state];
      const rows = Array.isArray(value.data) ? value.data : [value];
      const failed = (raw:unknown):boolean => {
        if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
        const row=obj(raw);
        return (row.resourceFieldStates as ObjectValue|undefined)?.[field]==='failed'
          || ['subject','person','character','episode'].some(key=>failed(row[key]));
      };
      if(rows.some(failed))return [field,'failed'];
      return [field, rows.length>0&&rows.every(row => hasFact(row, field)) ? 'known' : 'unknown'];
    }));
    return { schemaVersion: 1, kind: 'cached_resource', resourceRef: cached.resourceRef, sourceTool: cached.sourceTool, value: projected, accessContext: cached.accessContext, fields, fieldStates, ...(range ? { range } : {}) };
  }
  private async callScoped(name: string, argumentsValue: unknown, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope): Promise<unknown> {
    const args = validateToolArguments(name, argumentsValue);
    const definition = findToolDefinition(name);
    const detailEpoch = this.nativeCandidateDetailEpoch;
    if (definition.effect === 'write' && !guard) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要宿主绑定账户及具体操作的授权。');
    // 私人状态只描述读取时的快照；任何已授权写入都会使本连接的关系快照失效。
    if (definition.effect === 'write') { this.resources.clear(); this.collectionQueryInputs.clear(); this.clearCandidateDetails(); this.personCharacters.clear(); this.candidates.close(); this.collections.clear(); this.collectionCandidates.clear(); this.sourceCandidateStages.clear(); this.relations.close(); this.relationSources.clear(); }
    const cacheEpoch=this.operationCacheEpoch.getStore();
    if(definition.effect==='write'&&cacheEpoch)cacheEpoch.epoch=this.resourceEpoch;
    let context = anonymousContext();
    let checked = false;
    let dispatched = false;
    let readScope: McpReadScope | undefined;
    try {
      if (batch) {
        const scope = batchScope(batch);
        if (!this.batchContext) {
          if (scope.phase !== 'prepare' || name !== 'get_current_user') throw new AppError('BATCH_CONTEXT_EXPIRED', '批次须从完整账户预检开始。');
          const account = await this.identity(signal);
          if (!account.account) throw new AppError('BGM_AUTH_REQUIRED', '批次写入须先登录。');
          await this.transport.setBatchSession?.(true);
          this.batchContext = { id: scope.id, phase: scope.phase, context: structuredClone(account), usedNsfw: false };
        }
        if (scope.id !== this.batchContext.id) throw new AppError('BATCH_SCOPE_ACTIVE', '已有宿主批次上下文，不能交叉使用。');
        if (scope.phase !== this.batchContext.phase) {
          if (scope.phase === 'verify' && name === 'get_current_user') {
            const previous = structuredClone(this.batchContext.context);
            const fresh = await this.identity(signal);
            if (this.batchContext.usedNsfw) await this.nsfw(fresh, signal, true);
            if (fresh.account?.id !== this.batchContext.context.account?.id) throw new AppError('ACCOUNT_CHANGED', '整批回读前账户改变，不能核实原账户写入。');
            if (this.batchContext.usedNsfw && (!isDeepStrictEqual(fresh.nsfw, previous.nsfw) || fresh.nsfwApplied !== previous.nsfwApplied)) {
              throw new AppError('NSFW_SCOPE_CHANGED', '整批开始与回读的NSFW权限范围不同，未混用预检范围核实写入；已提交结果保留待核实。', fresh);
            }
            this.batchContext.context = structuredClone(fresh);
          } else if (!(scope.phase === 'submit' && this.batchContext.phase === 'prepare') && scope.phase !== 'close') {
            throw new AppError('BATCH_SCOPE_INVALID', '批次阶段不能回退或重新提交。');
          }
          this.batchContext.phase = scope.phase;
        }
        if (definition.effect === 'write' && (scope.phase !== 'submit' || !guard?.batchPreparation)) throw new AppError('AUTHORIZATION_REQUIRED', '批次提交必须使用宿主冻结快照。');
        if (definition.effect === 'read' && scope.phase === 'submit') throw new AppError('BATCH_SCOPE_INVALID', '批次提交阶段不执行逐项预检或回读。');
        context = structuredClone(this.batchContext.context);
      }
      else if (guard?.batchPreparation) throw new AppError('AUTHORIZATION_REQUIRED', '冻结快照只能在宿主批次上下文中提交。');
      else {
        const route = planRead(name, args);
        if (['refine_subject_candidates', 'expand_subject_relations', 'get_candidate_coverage', 'get_candidate_lineage', 'continue_subject_query', 'prepare_candidate_output'].includes(name) || args.result_mode === 'candidates') {
          const owner = this.candidateOwner();
          const ref = args.candidate_ref ?? args.merge_ref;
          if (typeof ref === 'string') {
            const stored = this.candidates.peekBinding(ref, owner);
            if (stored.binding.accountId !== null) route.requiresIdentity = true;
            else if (stored.binding.scopeKey.startsWith('public:collections:')) route.requiresIdentity = false;
          }
          if (typeof args.collection_ref === 'string' && this.collections.peek(args.collection_ref, owner).binding.accountId !== null) route.requiresIdentity = true;
          if (typeof args.coverage_ref === 'string' && this.candidates.peekCoverageBinding(args.coverage_ref, owner).binding.accountId !== null) route.requiresIdentity = true;
        }
        if (route.requiresIdentity || route.requiresNsfw) {
          try {
            context = await this.identity(signal);
            if (route.requiresIdentity && !context.account) throw new AppError('BGM_AUTH_REQUIRED', '本人资料或修改需要先登录。');
            if (route.requiresNsfw || name === 'get_current_user' && args.check_nsfw === true) await this.nsfw(context, signal, name === 'get_current_user');
          } catch (error) {
            if (route.requiresIdentity || signal?.aborted || error instanceof AppError && error.code === 'CANCELLED') throw error;
            context = anonymousContext();
          }
        }
      }
      if (batch && name === 'get_current_user' && args.check_nsfw === true) await this.nsfw(context, signal, true);
      checked = true;
      if (!batch && definition.effect === 'read' && context.account && name !== 'get_person_characters' && this.transport.bindReadScope) {
        readScope = await this.transport.bindReadScope(context, signal);
      }
      if (isCommunityTool(name)) {
        context.source = 'p1'; context.nsfwApplied = context.account !== null && context.nsfw.allowed === true && context.nsfw.preference !== false;
        const source = await this.community.call(name, args, signal, context);
        const result = { ...source, accessContext: context };
        this.fullValues.set(result, { ...this.community.completeResource(source), accessContext: context });
        checkCommunityResponse(name, result, args,definition.outputSchema);
        await readScope?.verify();
        return result;
      }
      if (guard && context.account?.id !== guard.accountId) throw new AppError('ACCOUNT_CHANGED', '当前账户与宿主授权账户不一致，未提交。');
      dispatched = true;
      let value: unknown;
      try { value = await this.dispatch(name, args, context, signal, guard); }
      catch (error) {
        const route = planRead(name, args);
        if (batch || guard || context.account || this.relationCapture.getStore()?.allowAccount === false || this.candidateDetailCapture.getStore()?.allowAccount === false || !route.canFallbackToAccount || !(error instanceof AppError) || error.code !== 'BGM_HTTP_404') throw error;
        const initial = error;
        try {
          const account = await this.identity(signal);
          if (!account.account) throw initial;
          await this.nsfw(account, signal);
          if (account.nsfw.allowed !== true || account.nsfw.preference === false) throw initial;
          context = account;
          value = await this.dispatch(name, args, context, signal);
        } catch (fallback) {
          if (signal?.aborted || fallback instanceof AppError && fallback.code === 'CANCELLED') throw fallback;
          if (this.relationCapture.getStore()?.allowAccount && fallback instanceof AppError
            && ['ACCOUNT_CHANGED', 'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH'].includes(fallback.code)) throw fallback;
          throw initial;
        }
      }
      if (definition.effect === 'read' && !context.account && this.relationCapture.getStore()?.allowAccount !== false && this.candidateDetailCapture.getStore()?.allowAccount !== false && this.hasNsfw(value) && planRead(name, args).canFallbackToAccount) {
        try {
          const account = await this.identity(signal);
          if (account.account) {
            await this.nsfw(account, signal);
            if (account.nsfw.allowed === true && account.nsfw.preference !== false) {
              const recovered = await this.dispatch(name, args, account, signal);
              context = account; value = recovered;
            }
          }
        } catch (error) {
          if (signal?.aborted || error instanceof AppError && error.code === 'CANCELLED') throw error;
          if (this.relationCapture.getStore()?.allowAccount && error instanceof AppError
            && ['ACCOUNT_CHANGED', 'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH'].includes(error.code)) throw error;
        }
      }
      if (definition.effect === 'read' && value && typeof value === 'object' && !Array.isArray(value) && name !== 'query_user_collections') value = await this.gateNsfw(obj(value), context, signal);
      let result = value;
      if (name === 'get_subject_details') result = subjectDetails(value, args.include as SubjectInclude[], Number(args.subject_id));
      if (name === 'get_user_collections') result = collectionPage(value, args);
      if (name === 'get_index_subjects') result = indexSubjectPage(value, args);
      if (name === 'browse_subjects') result = browseSubjectPage(value, args);
      if (['search_subjects', 'get_subject_relations', 'get_character_subjects', 'get_person_subjects'].includes(name)) {
        const page = obj(value);
        result = subjectPage({ ...page, ...(context.queryCoverage ? { totalKind: page.totalKind ?? context.queryCoverage.totalKind } : {}) }, args, !['search_subjects', 'browse_subjects'].includes(name));
      }
      if (name === 'get_daily_broadcast') {
        const raw = obj(value); const days = raw.data as ObjectValue[];
        const data = days.map(day => {
          const weekday = obj(day.weekday); return {
            weekday: compact({ id: weekday.id, en: weekday.en, cn: weekday.cn, ja: weekday.ja }),
            subjects: subjectPage({ data: day.items, total: day.total, limit: day.limit, offset: day.offset }, args, true)
          };
        });
        if (new Set(data.map(day => day.weekday.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '放送日历星期重复。');
        result = {
          schemaVersion: 1, kind: 'weekly_schedule', data, complete: data.length === 7 && data.every(day => day.subjects.page.complete),
          visibility: 'public', readAt: new Date().toISOString()
        };
      }
      if (args.result_mode === 'candidates' && ['search_subjects', 'browse_subjects', 'get_user_collections'].includes(name)) {
        result = await this.recallCandidates(name, obj(result), args, context, signal);
      }
      if (definition.effect === 'read' && !(name === 'get_person_characters' && args.result_mode === 'candidates') && !['refine_subject_candidates', 'expand_subject_relations', 'get_candidate_coverage', 'get_candidate_lineage', 'continue_subject_query', 'prepare_candidate_output', 'query_user_collections', 'get_subject_details', 'get_user_collections', 'get_index_subjects', 'search_subjects', 'browse_subjects', 'get_subject_relations', 'get_character_subjects', 'get_person_subjects', 'get_daily_broadcast'].includes(name)) {
        result = resourceResult(name, value, args);
        checkResourceResponse(name, result, args, definition.outputSchema!);
      }
      result = { ...obj(result), accessContext: context };
      if (context.account && context.nsfw.allowed === false || context.queryCoverage?.nsfw === 'excluded') {
        const verifyScope = (value: unknown): void => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) { value.forEach(verifyScope); return; }
          const row = value as ObjectValue;
          if (row.nsfw === true && (['subject', 'character', 'person'].includes(String(row.entity)) || row.subjectId !== undefined)) throw new AppError('NSFW_SCOPE_MISMATCH', '源数据包含当前账户NSFW权限之外的条目，未返回不一致的结果。');
          Object.values(row).forEach(verifyScope);
        };
        verifyScope(result);
      }
      if (definition.outputSchema) {
        try { checkOutput(definition.outputSchema, { value: result }); }
        catch (error) { if (definition.effect === 'write') throw new SubmissionError('MCP_INVALID_RESULT', '提交回执不符合固定输出契约；仍须独立核实。', result as import('../support/errors.js').SubmissionReceipt); throw error; }
      }
      if (definition.effect === 'write') checkSubmission(name, result, args, guard!.accountId, guard?.subjectId, guard?.prepared);
      checkSubjectResponse(name, result, args, definition.inputSchema);
      await readScope?.verify();
      if (name === 'get_subject_image' && typeof obj(result).url === 'string') {
        const target = obj(obj(result).target); this.candidates.cacheResourceFacts(this.candidateBinding(context), { id: Number(target.id), facts: { image: String(obj(result).url) }, sources: [] });
      }
      if (name === 'get_subject_details' && detailEpoch === this.nativeCandidateDetailEpoch) {
        const capture = this.candidateDetailCapture.getStore();
        // 候选内部读取在调用返回后的来源标记核对结束后提交缓存。
        if (capture) Object.assign(capture, { raw: obj(value), source: context.source, accountId: context.account?.id ?? null });
        else {
          const binding = this.candidateBinding(context);
          const seed = this.candidateSeed(obj(result));
          this.candidates.cacheResourceFacts(binding, {
            ...seed, requiresNsfw: seed.requiresNsfw || context.nsfwApplied,
            sources: [{
              tool: name, source: context.source, scope: JSON.stringify({ subject_id: args.subject_id, include: args.include }),
              complete: true, scannedCount: 1, total: 1, nextOffset: null, privateRecords: 'not_applicable'
            }]
          });
          this.cacheCandidateDetails(obj(value), context, binding, Number(args.subject_id), context);
        }
      }
      if(definition.effect==='read'&&resourceOutputSchema(name)) {
        const full=completeResourceResult(name,value,args,obj(result));
        this.fullValues.set(obj(result),{...full.value,accessContext:context,resourceFieldStates:full.fieldStates});
      } else if(name==='get_subject_details') {
        const full=completeSubjectResource(value,Number(args.subject_id));
        this.fullValues.set(obj(result),{...full.value,accessContext:context,resourceFieldStates:full.fieldStates});
      }
      return result;
    } catch (error) {
      if (!(error instanceof AppError)) error = new AppError(signal?.aborted ? 'CANCELLED' : 'INTERNAL_ERROR', signal?.aborted ? '操作已取消，未返回未核实的结果。' : '本地 MCP 操作异常，未将其解释为资源不存在或未收藏。');
      if (!dispatched && definition.effect === 'write' && guard && error instanceof AppError && !(error instanceof SubmissionError)) {
        error = new SubmissionError(error.code, error.message, new SubmissionTracker(name, args, guard.accountId, guard.subjectId).failed());
      }
      if (error instanceof AppError) {
        if (error.accessContext === undefined) Object.defineProperty(error, 'accessContext', { value: checked ? context : unverifiedContext() });
        if (error.sourceTool === undefined) Object.defineProperty(error, 'sourceTool', { value: name });
      }
      throw error;
    } finally {
      try { await readScope?.close(); }
      catch { throw new AppError('INTERNAL_ERROR', '本地读取上下文关闭失败，未返回成功结果。', checked ? context : unverifiedContext()); }
      if (batch?.phase === 'close' && this.batchContext?.id === batch.id) {
        this.transport.clearReadContext?.(`batch:${batch.id}`);
        this.batchContext = undefined; await this.transport.setBatchSession?.(false);
      }
    }
  }
  private async dispatch(name: string, argumentsValue: unknown, context: AccessContext, signal?: AbortSignal, guard?: McpWriteGuard): Promise<unknown> {
    const args = validateToolArguments(name, argumentsValue); const definition = findToolDefinition(name);
    signal?.throwIfAborted();
    if (definition.effect === 'write') {
      if (!guard || typeof guard.accountId !== 'number' || !Number.isSafeInteger(guard.accountId) || guard.accountId < 1) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要宿主绑定账户及具体操作的授权。');
      if (guard.batchPreparation) {
        const snapshot = batchPreparation(guard.batchPreparation);
        if (snapshot.tool !== name || !isDeepStrictEqual(snapshot.args, args)) throw new AppError('STALE_PREVIEW', '批次提交与冻结工具及参数不一致。');
        guard = { ...guard, batchPreparation: snapshot };
      }
      else if (guard.prepared === undefined) await this.assertAccount(guard.accountId, signal);
      else guard = { ...guard, prepared: preparedBaseline(guard.prepared) };
      return this.write(name, args, guard, signal);
    }
    const id = (key: string): number => Number(args[key]); const limit = Number(args.limit ?? 30); const offset = Number(args.offset ?? 0);
    const publicCall = (path: string, options: { method?: string; query?: ObjectValue; body?: unknown } = {}): Promise<unknown> => this.readResource(path, options, context, signal);
    if (name === 'get_person_characters') return args.result_mode === 'candidates'
      ? this.personCandidates.execute(args, this.candidateBinding(context, typeof args.merge_ref === 'string' ? args.merge_ref : undefined), context, signal)
      : this.personCharacterPage(args, context, signal);
    if (name === 'refine_subject_candidates') return this.refineCandidates(args, context, signal);
    if (name === 'expand_subject_relations') return this.expandCandidates(args, context, signal);
    if (name === 'continue_subject_query') {
      const binding = this.candidateBinding(context, String(args.candidate_ref));
      const display = {
        ...(args.response_view === undefined ? {} : { response_view: args.response_view as 'page' | 'reference' }),
        ...(args.limit === undefined ? {} : { limit: Number(args.limit) })
      };
      const plan = String(args.cursor).startsWith('rc_')
        ? this.relations.continuation(String(args.candidate_ref), String(args.cursor), binding, display)
        : this.candidates.continuation(String(args.candidate_ref), String(args.cursor), binding, display);
      const originalRoute = planRead(plan.tool, plan.request);
      if (originalRoute.requiresIdentity && !context.account) throw new AppError('BGM_AUTH_REQUIRED', '原阶段的本人范围需要匹配账户，不能匿名继续。');
      if (originalRoute.requiresNsfw) await this.nsfw(context, signal, true);
      const result = await this.dispatch(plan.tool, plan.request, context, signal);
      return { schemaVersion: 1, kind: 'candidate_continuation', ...plan, result: { ...obj(result), accessContext: context }, scope: { ...args } };
    }
    if (name === 'prepare_candidate_output') {
      const binding = this.candidateBinding(context, String(args.candidate_ref));
      const set = this.candidates.get(String(args.candidate_ref), binding);
      if (set.requiresNsfw || set.rows.some(row => row.requiresNsfw || row.facts.nsfw === true)) {
        await this.nsfw(context, signal, true);
        if (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '展示快照的NSFW权限已改变。');
      }
      if (set.refRole === 'working' && set.resultRef && set.qualification?.complete === true && set.qualification.remainingCount === 0 && !set.continuation) {
        throw diagnosedError(new AppError('CANDIDATE_STAGE_INCOMPLETE', '准备展示需要本层已通过结果引用；请使用对应resultRef。'), createErrorDiagnostic({
          code: 'CANDIDATE_STAGE_INCOMPLETE', origin: 'domain', stage: 'input', operation: name, reason: 'candidate_result_reference_required',
          issues: [{ path: '/candidate_ref', rule: 'result_reference', message: '请使用本层已通过结果引用。', expected: set.resultRef }],
          evidence: { subjectCount: set.rows.length },
        }));
      }
      const effective = effectiveCandidateOutputArgs(args as unknown as CandidateOutputArgs);
      const checked = candidatePresentationSet(this.candidates, String(args.candidate_ref), binding, context, effective.completion_scope);
      const lineage = (ref: string, ids: number[], owner: CandidateBinding) => {
        const data: CandidateLineageResponse['data'] = [];
        for (let index = 0; index < ids.length; index += 100) data.push(...this.relations.readLineage({
          candidate_ref: ref, subject_ids: ids.slice(index, index + 100), limit: 100,
        }, owner, context).data);
        return data;
      };
      if (effective.format === 'subject_cards' && effective.card_fields.includes('image')) {
        for (const row of checked.rows) if (!row.facts.image) {
          const patch = await this.candidateReads(context, binding).load(row, ['image'], [], signal);
          this.candidates.cacheResourceFacts(binding, { id: row.id, ...patch });
        }
      }
      return prepareCandidateOutput(this.candidates, args as unknown as CandidateOutputArgs, binding, context, lineage);
    }
    if (name === 'get_candidate_lineage') {
      const binding = this.candidateBinding(context, String(args.candidate_ref));
      if (this.candidates.peekBinding(String(args.candidate_ref), binding.turnId).requiresNsfw) {
        await this.nsfw(context, signal, true);
        if (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '回溯快照的NSFW权限已改变。');
      }
      return this.relations.readLineage(args, binding, context);
    }
    if (name === 'get_candidate_coverage') {
      const stored = this.candidates.peekCoverageBinding(String(args.coverage_ref), this.candidateOwner());
      if (stored.requiresNsfw) {
        await this.nsfw(context, signal, true);
        if (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '覆盖快照的NSFW权限已改变。');
      }
      return new CandidateQuery(this.candidates, { loadFacts: async () => ({ facts: {} }) }).readCoverage(args, { ...stored.binding, accountId: context.account?.id ?? null }, context);
    }
    if (name === 'query_user_collections') return args.result_mode === 'candidates'
      ? this.queryCollectionCandidates(args, context, signal) : this.queryCollections(args, context, signal);
    if (name === 'get_daily_broadcast') {
      const calendar = await publicCall('/calendar');
      if (!Array.isArray(calendar)) throw new AppError('INVALID_RESPONSE', '放送日历必须按星期组织。');
      const data = calendar.map(raw => { const day = obj(raw); const page = this.relationPage(day.items, limit, offset); return { ...day, items: page.data, total: page.total, limit, offset, nextOffset: page.nextOffset, complete: page.complete }; });
      return { data, limit, offset, complete: data.every(day => day.complete), kind: 'weekly_schedule' };
    }
    if (name === 'get_current_user') { if (!context.account) throw new AppError('BGM_AUTH_REQUIRED', '请先登录后核实当前账户与NSFW权限。'); return context.account; }
    if (name === 'search_subjects' || name === 'search_characters' || name === 'search_persons') {
      const entity = name.slice('search_'.length); const filter = entity === 'subjects' ? searchFilter(args)
        : entity === 'characters' ? compact({ nsfw: args.nsfw_filter }) : compact({ career: args.career_filter });
      const body = compact({ keyword: args.keyword, sort: args.sort, filter });
      return this.searchPage(name, args, body, context, signal);
    }
    if (name === 'browse_subjects') {
      requireBrowseCoverage(args.nsfw, context, !context.account || args.platform !== undefined);
      return browseSourceWindow(await publicCall('/v0/subjects', { query: compact({ type: args.subject_type, cat: args.cat, series: args.series, platform: args.platform, sort: args.sort, year: args.year, month: args.month, limit, offset }) }), args);
    }
    if (name === 'get_subject_details') {
      const value = canonicalSubject(await publicCall(`/v0/subjects/${id('subject_id')}`));
      return value;
    }
    if (name === 'get_episode_details') return publicCall(`/v0/episodes/${id('episode_id')}`);
    if (name === 'get_episodes') return publicCall('/v0/episodes', { query: compact({ subject_id: args.subject_id, type: args.episode_type, limit, offset }) });
    if (name === 'get_subject_relations') {
      const raw = await publicCall(`/v0/subjects/${id('subject_id')}/subjects`);
      const capture = this.relationCapture.getStore();
      if (capture && Array.isArray(raw)) capture.raw = raw;
      const page = this.relationPage(raw, limit, offset);
      // 展开用完整父来源固定可见范围；不能等后页才发现R18并改变已冻结总数。
      return capture && this.hasNsfw(raw) ? { ...page, nsfw: true } : page;
    }
    for (const entity of ['subject', 'character', 'person'] as const) {
      const plural = entity === 'person' ? 'persons' : `${entity}s`; const target = id(`${entity}_id`);
      if (name === `get_${entity}_details`) return publicCall(`/v0/${plural}/${target}`);
      if (name === `get_${entity}_image`) { const response = obj(await publicCall(`/v0/${plural}/${target}/image`, { query: { type: args.image_type } })); return { id: target, image_type: args.image_type, url: response.Location }; }
      for (const suffix of ['persons', 'characters', 'subjects']) if (name === `get_${entity}_${suffix}`) return this.relationPage(await publicCall(`/v0/${plural}/${target}/${suffix}`), limit, offset);
    }
    for (const entity of ['person', 'character', 'subject', 'episode']) {
      const plural = entity === 'person' ? 'persons' : `${entity}s`;
      if (name === `get_${entity}_revisions`) return publicCall(`/v0/revisions/${plural}`, { query: { [`${entity}_id`]: args[`${entity}_id`], limit, offset } });
      if (name === `get_${entity}_revision`) return publicCall(`/v0/revisions/${plural}/${id('revision_id')}`);
    }
    if (name === 'get_single_episode_collection' || name === 'get_user_episode_collection') {
      const account = await this.checkedAccount(signal);
      if (name === 'get_single_episode_collection') { const result = await this.privateEpisode(id('episode_id'), account.id, signal); await this.assertAccount(account.id, signal); return { ...result, account }; }
      // p1上游用truthiness判断type，type=0会返回所有类型；先完整核实再筛选和分页。
      const all = args.episode_type === 0 ? (await this.allPrivateEpisodes(id('subject_id'), account.id, signal)).filter(ep => ep.type === 0) : undefined;
      const page = all ? { data: all.slice(offset, offset + limit), total: all.length, limit, offset }
        : this.page(await this.transport.account(`/p1/subjects/${id('subject_id')}/episodes`, { query: compact({ type: args.episode_type, limit, offset }), expectedAccountId: account.id }, signal), limit, offset);
      const data = page.data.map(item => canonicalEpisode(item));
      if (data.some(item => item.subject_id !== id('subject_id') || args.episode_type !== undefined && item.type !== args.episode_type) || new Set(data.map(item => item.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '章节归属、筛选范围或分页记录错误。');
      await this.assertAccount(account.id, signal); return { ...page, data, account };
    }
    if (name === 'get_index' || name === 'get_index_subjects') {
      if (args.own === true) {
        const account = await this.checkedAccount(signal);
        if (name === 'get_index') { const result = await this.myIndex(id('index_id'), account.id, signal); await this.assertAccount(account.id, signal); return { ...result, account }; }
        const page = this.page(await this.transport.account(`/p1/indexes/${id('index_id')}/related`, { query: compact({ cat: 0, type: args.subject_type, limit, offset }), expectedAccountId: account.id }, signal), limit, offset);
        await this.assertAccount(account.id, signal); return { ...page, data: page.data.map(canonicalRelated), account };
      }
      if (name === 'get_index') return canonicalIndex(await publicCall(`/v0/indices/${id('index_id')}`));
      return publicCall(`/v0/indices/${id('index_id')}/subjects`, { query: compact({ type: args.subject_type, limit, offset }) });
    }
    if (typeof args.username === 'string') {
      const account = await this.selfUser(args.username, signal); const username = account ? account.username : args.username; const urlUsername = encodeURIComponent(username);
      if (name === 'get_user_info') {
        if (!account) return publicCall(`/v0/users/${urlUsername}`);
        const user = obj(await publicCall(`/v0/users/${urlUsername}`), '用户公开资料');
        if (user.id !== account.id || user.username !== account.username) throw new AppError('ACCOUNT_CHANGED', '公开资料与当前登录账户不一致。');
        if (typeof user.nickname !== 'string' || typeof user.sign !== 'string' || !Number.isInteger(user.user_group)) throw new AppError('INVALID_RESPONSE', '用户公开资料字段不完整。');
        const avatar = obj(user.avatar, '用户头像');
        if (['large', 'medium', 'small'].some(key => typeof avatar[key] !== 'string')) throw new AppError('INVALID_RESPONSE', '用户头像字段不完整。');
        const result = compact({
          id: user.id, username: user.username, nickname: user.nickname, sign: user.sign, user_group: user.user_group,
          avatar: { large: avatar.large, medium: avatar.medium, small: avatar.small }, url: typeof user.url === 'string' ? user.url : undefined
        });
        await this.assertAccount(account.id, signal); return result;
      }
      if (name === 'get_user_avatar') {
        if (!account) { const response = obj(await publicCall(`/v0/users/${urlUsername}/avatar`, { query: { type: args.avatar_type } })); return { username, avatar_type: args.avatar_type, url: response.Location }; }
        const user = obj(await this.transport.account('/p1/me', { expectedAccountId: account.id }, signal));
        if (user.id !== account.id) throw new AppError('ACCOUNT_CHANGED', '头像账户与当前账户不一致。');
        const result = { username, avatar_type: args.avatar_type, url: obj(user.avatar, '头像')[String(args.avatar_type)] ?? null, account };
        await this.assertAccount(account.id, signal); return result;
      }
      if (name === 'get_user_collections') {
        if (!account) {
          const raw = obj(await publicCall(`/v0/users/${urlUsername}/collections`, { query: compact({ subject_type: args.subject_type, type: args.collection_type, limit, offset }) }));
          if (!Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '公开收藏分页缺少数组。');
          for (const value of raw.data) {
            const row = obj(value); const interest = row.interest === undefined ? {} : obj(row.interest);
            if (row.private !== undefined && row.private !== false || interest.private !== undefined && interest.private !== false) {
              throw new AppError('PRIVATE_SCOPE', '公开收藏响应出现私密或非法可见性字段。');
            }
          }
          return context.account ? {
            ...raw, data: raw.data.map(value => {
              const item = obj(value); const interest = obj(item.interest, '公开收藏');
              if (item.private !== undefined && item.private !== false || interest.private !== undefined && interest.private !== false) throw new AppError('PRIVATE_SCOPE', '公开用户收藏响应出现私密或非法可见性字段。');
              return { ...canonicalCollection(value), private: false };
            })
          } : raw;
        }
        const page = this.page(await this.transport.account('/p1/collections/subjects', { query: compact({ subjectType: args.subject_type, type: args.collection_type, limit, offset }), expectedAccountId: account.id }, signal), limit, offset);
        const data = page.data.map(canonicalCollection);
        if (new Set(data.map(item => item.subject_id)).size !== data.length || data.some(item => args.subject_type !== undefined && obj(item.subject).subjectType !== args.subject_type || args.collection_type !== undefined && item.type !== args.collection_type)) throw new AppError('INVALID_RESPONSE', '收藏分页重复或筛选范围错误。');
        await this.assertAccount(account.id, signal); return { ...page, data, account };
      }
      if (name === 'get_user_subject_collection') {
        if (account) { const result = await this.myCollection(id('subject_id'), account.id, signal); await this.assertAccount(account.id, signal); return { _record: result, account }; }
        try { return await publicCall(`/v0/users/${urlUsername}/collections/${id('subject_id')}`); }
        catch (error) { if (error instanceof AppError && error.code === 'BGM_HTTP_404') return null; throw error; }
      }
      for (const entity of ['character', 'person'] as const) {
        const plural = entity === 'person' ? 'persons' : 'characters';
        if (name === `get_user_${entity}_collections`) {
          if (!account) return publicCall(`/v0/users/${urlUsername}/collections/-/${plural}`, { query: { limit, offset } });
          const all = await this.allAccount(`/p1/collections/${plural}`, account.id, {}, signal);
          return { data: all.slice(offset, offset + limit).map(item => ({ ...obj(item), collected: true })), total: all.length, limit, offset, account };
        }
        if (name === `get_user_${entity}_collection`) {
          if (account) { const result = await this.myEntityCollection(plural, id(`${entity}_id`), account.id, signal); return { _record: result, account }; }
          try { return await publicCall(`/v0/users/${urlUsername}/collections/-/${plural}/${id(`${entity}_id`)}`); }
          catch (error) { if (error instanceof AppError && error.code === 'BGM_HTTP_404') return null; throw error; }
        }
      }
    }
    throw new AppError('UNKNOWN_TOOL', '工具没有固定 API 映射。');
  }
  private candidateOwner(): string { return this.readContexts.getStore()?.turnId ?? 'embedded'; }
  private candidateShouldYield(): boolean { const deadline = this.candidateWork.getStore(); return deadline !== undefined && performance.now() >= deadline; }
  private candidateBinding(context: AccessContext, ref?: string): CandidateBinding {
    const turnId = this.candidateOwner();
    return {
      turnId, accountId: context.account?.id ?? null,
      scopeKey: ref ? this.candidates.peekBinding(ref, turnId).binding.scopeKey : context.account ? `account:${context.account.id}` : 'public:sfw'
    };
  }
  private collectionBinding(context: AccessContext, ref?: string): CollectionReadBinding {
    const readContextId = this.candidateOwner();
    return ref ? { ...this.collections.peek(ref, readContextId).binding, accountId: context.account?.id ?? null }
      : { readContextId, accountId: context.account?.id ?? null, source: context.account ? 'p1' : 'v0' };
  }
  private candidateSeed(value: ObjectValue, personal?: ObjectValue): CandidateSeed {
    const facts = Object.fromEntries(CANDIDATE_FIELDS.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
    if (Object.hasOwn(value, 'date')) facts.date = normalizeCandidateDate(value.date);
    facts.subjectForm = candidateSubjectForm(value);
    if (Object.hasOwn(value, 'infobox')) Object.assign(facts, durationFacts(value));
    if (personal) {
      facts.collectionState = 'collected';
      for (const field of ['collectionStatus', 'personalRating', 'personalTags', 'personalComment']) facts[field] = personal[field] ?? null;
    }
    return { id: positive(value.id), facts };
  }
  private clearCandidateDetails(turnId?: string): void {
    this.nativeCandidateDetailEpoch++;
    this.resourceEpoch++;
    this.resources.clear(turnId);
  }
  private candidateDetailKey(context: AccessContext, binding: CandidateBinding, id: number): string | undefined {
    return binding.turnId === 'embedded' ? undefined
      : JSON.stringify([binding.turnId, binding.accountId, binding.scopeKey, context.nsfw.preference, context.nsfw.allowed, id]);
  }
  /** 保存固定详情资源的完整body；模型可见投影不影响后续字段复用。 */
  private cacheCandidateDetails(value: ObjectValue, context: AccessContext, binding: CandidateBinding, id: number, scopeContext: AccessContext): void {
    if (binding.turnId !== this.candidateOwner() || binding.accountId !== (scopeContext.account?.id ?? null)
      || context.account !== null && context.account.id !== binding.accountId) return;
    const key = this.candidateDetailKey(scopeContext, binding, id);
    if (!key) return;
    try {
      this.resources.putRaw(key, value, context, binding.turnId);
    } catch {
      /* 无法缓存时，已验证的读取仍然有效。 */
    }
  }
  private candidateReads(context: AccessContext, binding: CandidateBinding, username = '-'): CandidateReaders {
    return new CandidateReaders({
      image: async (id, signal) => obj(await this.callScoped('get_subject_image', { subject_id: id }, signal)),
      details: async (id, include, signal) => {
        signal?.throwIfAborted();
        const request = validateToolArguments('get_subject_details', { subject_id: id, include });
        if (binding.turnId !== this.candidateOwner()) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '候选详情缓存不属于当前读取轮次。');
        if (binding.accountId !== (context.account?.id ?? null)) throw new AppError('ACCOUNT_CHANGED', '候选详情读取账户与本阶段账户不一致。');
        const key = this.candidateDetailKey(context, binding, id);
        const cached = key ? this.resources.getRaw(key) : undefined;
        const capture: CandidateDetailCapture = { allowAccount: context.account !== null, binding, context };
        const epoch = this.nativeCandidateDetailEpoch;
        const cachedRestricted = cached && (cached.raw.nsfw === true || cached.context.nsfwApplied);
        if (cachedRestricted && (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false))
          throw new AppError('NSFW_SCOPE_MISMATCH', '已缓存候选详情超出本阶段可见范围。');
        const value: ObjectValue = cached
          ? { ...subjectDetails(cached.raw, request.include as SubjectInclude[], id), accessContext: structuredClone(cached.context) }
          : obj(await this.candidateDetailCapture.run(capture, () => this.callScoped('get_subject_details', request, signal)));
        const nativeContext = value.accessContext as AccessContext;
        if (nativeContext.account && nativeContext.account.id !== binding.accountId) throw new AppError('ACCOUNT_CHANGED', '候选详情原生账户与本阶段账户不一致。');
        const restricted = value.nsfw === true || (value.accessContext as AccessContext).nsfwApplied;
        if (restricted && (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false))
          throw new AppError('NSFW_SCOPE_MISMATCH', '候选补字段超出本阶段明确的可见范围。');
        const definition = findToolDefinition('get_subject_details');
        checkOutput(definition.outputSchema!, { value }); checkSubjectResponse('get_subject_details', value, request, definition.inputSchema);
        if (cached && key) { this.resources.putRaw(key, cached.raw, cached.context, binding.turnId); }
        else if (epoch === this.nativeCandidateDetailEpoch && capture.raw && capture.source === nativeContext.source
          && capture.accountId === (nativeContext.account?.id ?? null)) {
          this.cacheCandidateDetails(capture.raw, nativeContext, binding, id, context);
        }
        if (cached) value.candidateCacheSupplementOnly = true;
        value.candidateRequiresNsfw = restricted;
        return value;
      },
      collection: async (id, signal) => {
        const value = obj(await this.callScoped('get_user_subject_collection', { username, subject_id: id }, signal));
        const nativeContext = value.accessContext as AccessContext;
        if (username === '-' && nativeContext.account?.id !== context.account?.id) throw new AppError('ACCOUNT_CHANGED', '候选个人记录账户与本阶段账户不一致。');
        if (nativeContext.nsfwApplied) {
          await this.nsfw(context, signal, true);
          if (context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '个人记录的NSFW可见范围已改变。');
          value.candidateRequiresNsfw = true;
        }
        return value;
      },
      relations: async (id, signal) => {
        const result = obj(await this.callScoped('get_subject_relations', { subject_id: id, limit: 100 }, signal));
        const restricted = (result.data as ObjectValue[]).some(row => row.nsfw === true) || (result.accessContext as AccessContext).nsfwApplied;
        if (restricted && (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false))
          throw new AppError('NSFW_SCOPE_MISMATCH', '候选关系证据超出本阶段明确的可见范围。');
        result.candidateRequiresNsfw = restricted;
        result.data = (result.data as ObjectValue[]).map(row => ({
          id: row.id, relation: row.relation ?? null,
          name: row.name ?? null, nameCn: row.nameCn ?? null, subjectType: row.subjectType ?? null, url: row.url
        }));
        return result;
      },
    });
  }
  private async executeCandidates(args: ObjectValue, context: AccessContext, signal?: AbortSignal, options?: { processIds?: number[]; preserveInput?: boolean; filterAlreadyApplied?: boolean; hydrateProjection?: boolean; freshSource?: boolean; stageRef?: string }): Promise<ObjectValue> {
    const binding = this.candidateBinding(context, typeof args.candidate_ref === 'string' ? args.candidate_ref : undefined);
    if (typeof args.candidate_ref === 'string') {
      const origin = this.candidates.get(args.candidate_ref, binding);
      const completeOrigin = origin.continuation ? this.candidates.get(origin.continuation.originRef, binding) : origin;
      if (origin.requiresNsfw || completeOrigin.requiresNsfw || [...origin.rows, ...completeOrigin.rows].some(row => row.facts.nsfw === true || row.requiresNsfw)) {
        if (!context.account) throw new AppError('NSFW_SCOPE_CHANGED', '候选快照含账户可见资料，当前读取缺少匹配权限。');
        if (!options?.freshSource || context.nsfw.allowed !== true) await this.nsfw(context, signal, true);
        if (context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '候选快照的NSFW可见范围已改变，请重新读取适用范围。');
      }
    }
    const query = new CandidateQuery(this.candidates, {
      shouldYield: () => this.candidateShouldYield(),
      loadFacts: (row, fields, include, activeSignal) => this.loadCandidateFacts(row, fields, include, context, binding, activeSignal, args)
    });
    return await query.execute(args as CandidateQueryArgs, binding, context, signal, options) as unknown as ObjectValue;
  }
  private collectionIndexSource(index: CollectionIndexInfo, binding: CollectionReadBinding): CandidateSource {
    return {
      tool: 'query_user_collections', source: binding.source, scope: JSON.stringify(index.scope), complete: index.sourceComplete,
      scannedCount: index.scannedCount, total: index.total, nextOffset: index.nextOffset, privateRecords: 'included'
    };
  }
  private collectionLookupPatch(row: CandidateRow, fields: readonly CandidateField[], lookup: CollectionLookup): CandidateFactPatch {
    const sameMedia = row.fieldStates.subjectType === 'known' && row.facts.subjectType === lookup.scope.subject_type;
    const patch: CandidateFactPatch = { facts: {}, fieldStates: {}, excludesCollectionTypes: sameMedia ? lookup.excludesCollectionTypes : [] };
    if (!sameMedia) return patch;
    const personal = fields.filter(field => PERSONAL_CANDIDATE_FIELDS.includes(field));
    for (const field of personal) if (lookup.fieldStates[field as keyof typeof lookup.fieldStates] === 'known') {
      patch.facts[field] = lookup.personalFacts[field as keyof typeof lookup.personalFacts]; patch.fieldStates![field] = 'known';
    }
    if (lookup.membership === 'not_collected') {
      patch.facts.collectionState = 'not_collected'; patch.fieldStates!.collectionState = 'known';
      for (const field of personal) if (!Object.hasOwn(patch.facts, field)) { patch.facts[field] = null; patch.fieldStates![field] = 'unknown'; }
      patch.resolvedFields = personal;
    }
    return patch;
  }
  private async loadCandidateFacts(row: CandidateRow, fields: CandidateField[], include: string[], context: AccessContext,
    binding: CandidateBinding, activeSignal: AbortSignal | undefined, args: CandidateQueryArgs): Promise<CandidateFactPatch> {
    const reads = this.candidateReads(context, binding, binding.scopeKey.startsWith('public:collections:') ? binding.scopeKey.slice('public:collections:'.length) : '-');
    let patch: CandidateFactPatch = { facts: {} };
    let missing = fields;
    const collectionRef = typeof args.collection_ref === 'string' ? args.collection_ref : undefined;
    if (collectionRef) {
      const collectionBinding = this.collectionBinding(context, collectionRef);
      const lookup = this.collections.lookup(collectionRef, [row.id], collectionBinding)[0]!;
      patch = this.collectionLookupPatch(row, fields, lookup);
      const index = this.collections.indexInfo(collectionRef, collectionBinding);
      if (index.requiresNsfw) {
        await this.nsfw(context, activeSignal, true);
        if (context.nsfw.allowed !== true || context.nsfw.preference === false)
          throw new AppError('NSFW_SCOPE_CHANGED', '收藏引用所需NSFW权限已改变。');
      }
      patch.sources = [this.collectionIndexSource(index, collectionBinding)]; patch.requiresNsfw = index.requiresNsfw;
      missing = fields.filter(field => !Object.hasOwn(patch.facts, field));
      if (lookup.scope.collection_type !== undefined && missing.some(field => PERSONAL_CANDIDATE_FIELDS.includes(field))) {
        const state = evaluateCandidateFacts(mergeCandidateFacts(row, patch), args.filter ?? {});
        if (state.result === 'unknown' && state.missingFields.some(field => missing.includes(field) && PERSONAL_CANDIDATE_FIELDS.includes(field)))
          throw new AppError('CREF_COVERAGE_INSUFFICIENT', '当前收藏引用只有单一状态，不能核实本次个人条件缺口；旧窄引用保持。请另起query_user_collections，省略collection_type和collection_ref建立全状态来源，再用原母candidate_ref及原条件重新筛选，不带旧cursor。');
      }
    }
    if (missing.length) {
      const fetched = await reads.load(mergeCandidateFacts(row, patch), missing, include, activeSignal);
      patch = {
        ...patch, facts: { ...patch.facts, ...fetched.facts }, fieldStates: { ...patch.fieldStates, ...fetched.fieldStates },
        failureCodes: { ...patch.failureCodes, ...fetched.failureCodes },
        resolvedFields: [...new Set([...(patch.resolvedFields ?? []), ...(fetched.resolvedFields ?? [])])],
        requiresNsfw: patch.requiresNsfw === true || fetched.requiresNsfw === true,
        sources: [...(patch.sources ?? []), ...(fetched.sources ?? [])]
      };
    }
    return patch;
  }
  private async expandCandidates(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<unknown> {
    const binding = this.candidateBinding(context, String(args.candidate_ref));
    const origin = this.candidates.get(String(args.candidate_ref), binding);
    if (binding.scopeKey.startsWith('public:collections:')) {
      const filters = [obj(args.filter ?? {}), ...((obj(args.filter ?? {}).any_of as ObjectValue[] | undefined) ?? [])];
      const personal = (args.fields as string[] | undefined)?.some(field => PERSONAL_CANDIDATE_FIELDS.includes(field as CandidateField))
        || filters.some(filter => ['personal_rating', 'personal_tags', 'collection_types', 'exclude_collection_types'].some(key => filter[key] !== undefined));
      const sameOwner = typeof args.collection_ref === 'string'
        && binding.scopeKey === `public:collections:${this.collections.peek(args.collection_ref, binding.turnId).scope.username}`;
      if ((args.include as string[] | undefined)?.includes('own_collection') || personal && !sameOwner)
        throw new AppError('CANDIDATE_SCOPE_MISMATCH', '第三方父范围与本人子收藏不能共用事实命名空间；请以明确子作品ID另建本人候选集合，并保留原关系引用回溯。');
    }
    if (origin.requiresNsfw || origin.rows.some(row => row.facts.nsfw === true || row.requiresNsfw)) {
      await this.nsfw(context, signal, true);
      if (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '关联父快照的可见范围已改变。');
    }
    return this.relationRun.run({ context, binding }, () => this.relations.execute(args as RelationQueryArgs, binding, context, signal));
  }
  /** 每父完整原始来源只读一次；内部切页仍走规范化和可见范围校验，不受公开offset上限截断。 */
  private async readCandidateRelations(parentId: number, offset: number, limit: number, signal?: AbortSignal): Promise<RelationReadPage> {
    const run = this.relationRun.getStore();
    if (!run) throw new AppError('INTERNAL_ERROR', '关联读取缺少宿主上下文。');
    const key = JSON.stringify([run.binding, parentId]);
    let cached = this.relationSources.get(key), result: ObjectValue;
    if (!cached) {
      const capture: { raw?: unknown[]; allowAccount: boolean } = { allowAccount: run.context.account !== null };
      result = obj(await this.relationCapture.run(capture, () => this.callScoped('get_subject_relations', { subject_id: parentId, limit, offset: 0 }, signal)));
      if (!capture.raw) throw new AppError('INVALID_RESPONSE', '关联来源缺少完整已核实数组。');
      cached = { turnId: run.binding.turnId, raw: capture.raw, context: structuredClone(result.accessContext as AccessContext) };
      this.relationSources.set(key, cached);
    } else result = {};
    const nativeContext = structuredClone(cached.context);
    if (nativeContext.account && nativeContext.account.id !== run.context.account?.id) throw new AppError('ACCOUNT_CHANGED', '关联资料来源账户与当前阶段不一致。');
    if (nativeContext.nsfwApplied) {
      await this.nsfw(run.context, signal, true);
      if (run.context.nsfw.allowed !== true || run.context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '关联来源的NSFW权限已改变。');
      nativeContext.nsfw = structuredClone(run.context.nsfw);
    }
    {
      const rawPage = this.relationPage(cached.raw, limit, offset);
      const page = await this.gateNsfw(this.hasNsfw(cached.raw) ? { ...rawPage, nsfw: true } : rawPage, nativeContext, signal);
      result = { ...subjectPage(page, { subject_id: parentId, limit, offset }, true), accessContext: nativeContext };
      checkSubjectResponse('get_subject_relations', result, { subject_id: parentId, limit, offset });
    }
    const restricted = nativeContext.nsfwApplied || (result.data as ObjectValue[]).some(row => row.nsfw === true);
    if (restricted && (!run.context.account || run.context.nsfw.allowed !== true || run.context.nsfw.preference === false))
      throw new AppError('NSFW_SCOPE_MISMATCH', '关联目标资料超出当前阶段可见范围。');
    return { ...result, candidateRequiresNsfw: restricted } as unknown as RelationReadPage;
  }
  private async refineCandidates(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    if (Array.isArray(args.subject_ids) && typeof args.collection_ref !== 'string') {
      const initial = this.candidates.create({
        binding: this.candidateBinding(context), rows: (args.subject_ids as number[]).map(id => ({ id, facts: {} })),
        ...(context.account ? { visibility: 'self' as const, account: context.account } : { visibility: 'public' as const })
      });
      const rewritten: ObjectValue = { ...args, candidate_ref: initial.ref }; delete rewritten.subject_ids;
      const response = await this.refineCandidates(rewritten, context, signal); response.scope = { ...args }; return response;
    }
    if (typeof args.candidate_ref === 'string') {
      const stored = this.candidates.peekBinding(args.candidate_ref, this.candidateOwner());
      if (stored.binding.scopeKey.startsWith('public:collections:') && (args.include as string[] | undefined)?.includes('own_collection')) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '公开第三方收藏不能作为本人收藏，需以作品ID重建本人范围。');
    }
    if (typeof args.collection_ref === 'string' && Array.isArray(args.subject_ids)) {
      const scope = this.collections.peek(args.collection_ref, this.candidateOwner()).scope;
      const actual = { ...this.candidateBinding(context), ...(scope.username === '-' ? {} : { scopeKey: `public:collections:${scope.username}` }) };
      const snapshot = this.collections.snapshot(args.collection_ref, this.collectionBinding(context, args.collection_ref));
      if (snapshot.rows.some(row => row.subject.nsfw === true)) {
        await this.nsfw(context, signal, true);
        if (context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '收藏快照的NSFW可见范围已改变，请重新读取。');
      }
      const source: CandidateSource = {
        tool: 'query_user_collections', source: snapshot.coverage.source, scope: JSON.stringify(snapshot.scope),
        complete: snapshot.coverage.sourceComplete, scannedCount: snapshot.coverage.scannedCount, total: snapshot.coverage.collectionTotal,
        nextOffset: snapshot.coverage.sourceNextOffset, privateRecords: snapshot.coverage.privateRecords
      };
      const initial = this.candidates.create({
        binding: actual, rows: (args.subject_ids as number[]).map(id => ({ id, facts: {} })), sources: [source],
        visibility: scope.username === '-' ? 'self' : 'public', ...(scope.username === '-' && context.account ? { account: context.account } : {})
      });
      const rewritten: ObjectValue = { ...args, candidate_ref: initial.ref }; delete rewritten.subject_ids;
      const response = await this.refineCandidates(rewritten, context, signal); response.scope = { ...args }; return response;
    }
    if (typeof args.collection_ref === 'string' && typeof args.candidate_ref === 'string') {
      const binding = this.candidateBinding(context, args.candidate_ref);
      const set = this.candidates.get(args.candidate_ref, binding);
      if (set.requiresNsfw) {
        await this.nsfw(context, signal, true);
        if (!context.account || context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '候选祖先来源的可见权限已改变，请重新读取。');
      }
      const lookups = this.collections.lookup(args.collection_ref, set.rows.map(row => row.id), this.collectionBinding(context, args.collection_ref));
      const updated = new Map(set.rows.map(row => [row.id, row]));
      for (const lookup of lookups) {
        if (set.rows.find(row => row.id === lookup.subjectId)?.facts.subjectType !== lookup.scope.subject_type) continue;
        const facts = Object.fromEntries(PERSONAL_CANDIDATE_FIELDS.filter(field => lookup.fieldStates[field as keyof typeof lookup.fieldStates] === 'known')
          .map(field => [field, lookup.personalFacts[field as keyof typeof lookup.personalFacts]]));
        updated.set(lookup.subjectId, mergeCandidateFacts(updated.get(lookup.subjectId)!, { facts, excludesCollectionTypes: lookup.excludesCollectionTypes }));
      }
      const snapshot = this.collections.snapshot(args.collection_ref, this.collectionBinding(context, args.collection_ref));
      if (set.binding.scopeKey.startsWith('public:collections:') && set.binding.scopeKey !== `public:collections:${snapshot.scope.username}`)
        throw new AppError('CANDIDATE_SCOPE_MISMATCH', '不能将不同用户的个人字段合并到同一候选事实范围。');
      if (snapshot.rows.some(row => row.subject.nsfw === true)) {
        await this.nsfw(context, signal, true);
        if (context.nsfw.allowed !== true || context.nsfw.preference === false) throw new AppError('NSFW_SCOPE_CHANGED', '收藏快照的NSFW可见范围已改变，请重新读取。');
      }
      const source: CandidateSource = {
        tool: 'query_user_collections', source: snapshot.coverage.source, scope: JSON.stringify(snapshot.scope),
        complete: snapshot.coverage.sourceComplete, scannedCount: snapshot.coverage.scannedCount, total: snapshot.coverage.collectionTotal,
        nextOffset: snapshot.coverage.sourceNextOffset, privateRecords: snapshot.coverage.privateRecords
      };
      const privateJoin = snapshot.scope.username === '-';
      const joined = this.candidates.create({
        binding: privateJoin ? binding : { ...binding, scopeKey: `public:collections:${snapshot.scope.username}` }, rows: [...updated.values()], sources: [...set.sources, source], parentRef: set.ref,
        // 续查仍属于原资格阶段，旧游标的未处理量由该阶段继续消化；真正祖先的缺口仍由store继承。
        inheritParentQualification: args.cursor === undefined,
        ...(set.reportedSources ? { reportedSources: set.reportedSources } : {}),
        requiresNsfw: set.requiresNsfw || snapshot.rows.some(row => row.subject.nsfw === true),
        visibility: privateJoin ? 'self' : set.visibility, ...(privateJoin && context.account ? { account: context.account } : set.account ? { account: set.account } : {}),
        ...(set.continuation ? { continuation: set.continuation } : {})
      });
      const response = await this.executeCandidates({ ...args, candidate_ref: joined.ref }, context, signal);
      response.scope = { ...args };
      const currentIndex = this.collections.indexInfo(args.collection_ref, this.collectionBinding(context, args.collection_ref));
      const collectionScope = { ...currentIndex.scope, sourceComplete: currentIndex.sourceComplete };
      response.collectionScope = collectionScope;
      checkCandidateResponse(response, args, findToolDefinition('refine_subject_candidates').inputSchema, collectionScope);
      return response;
    }
    return this.executeCandidates(args, context, signal);
  }
  /** 续读同一来源只更新原生输入，来源工作/结果句柄由CandidateQuery沿原阶段推进。 */
  private updateSourceInput(ref: string, binding: CandidateBinding, seeds: CandidateSeed[], sources: CandidateSource[], sort?: unknown) {
    const prior = this.candidates.get(ref, binding), rows = new Map(prior.rows.map(row => [row.id, row]));
    let duplicates = 0;
    for (const seed of seeds) {
      const previous = rows.get(seed.id); if (previous) duplicates++;
      rows.set(seed.id, previous ? mergeCandidateFacts(previous, seed) : candidateRow(seed));
    }
    const orderedRows = [...rows.values()];
    if (sort === 'date_asc' || sort === 'date_desc') orderedRows.sort((a, b) => (sort === 'date_asc' ? 1 : -1)
      * String(a.facts.date ?? '').localeCompare(String(b.facts.date ?? '')) || a.id - b.id);
    return this.candidates.create({
      ...prior, binding, replaceRef: ref, refRole: 'input', rows: orderedRows,
      sources: mergeCandidateSources(prior.sources, sources), changedIds: [...new Set(seeds.map(seed => seed.id))],
      duplicateCount: prior.duplicateCount + duplicates
    });
  }
  private async recallCandidates(name: string, result: ObjectValue, args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    // 投影前保留原生身份、分页和日期精度校验，读取进度只继承同绑定的显式merge链。
    checkSubjectResponse(name, { ...result, accessContext: context }, args, findToolDefinition(name).inputSchema);
    const page = obj(result.page);
    const rows = (result.data as ObjectValue[]).map(row => name === 'get_user_collections' ? this.candidateSeed(obj(row.subject), row) : this.candidateSeed(row));
    const workFields = new Set(['offset', 'limit', 'merge_ref', 'result_mode', 'response_view', 'fields', 'include',
      'hydrate_fields', 'coverage_mode', 'cursor', 'collection_ref', 'source_limit']);
    const nativeScope = Object.fromEntries(Object.entries(obj(result.scope)).filter(([key]) => !workFields.has(key)));
    const binding = this.candidateBinding(context, typeof args.merge_ref === 'string' ? args.merge_ref : undefined);
    if (name === 'get_user_collections' && args.username !== '-') binding.scopeKey = `public:collections:${String(args.username)}`;
    const source: CandidateSource = {
      tool: name, source: context.source,
      scope: JSON.stringify(stableCandidateKey(nativeScope)), complete: false, scannedCount: 0, total: typeof page.total === 'number' ? page.total : null,
      nextOffset: page.nextOffset as number | null, privateRecords: result.visibility === 'self' ? 'included' : name === 'get_user_collections' ? 'public_only' : 'not_applicable'
    };
    const previous = typeof args.merge_ref === 'string' ? this.candidates.get(args.merge_ref, binding).sources
      .find(value => candidateSourceRef(value) === candidateSourceRef(source)) : undefined;
    const prior = previous?.readState, offset = Number(page.offset), dateWindow = name === 'browse_subjects' ? obj(result.filterCoverage) : undefined;
    const excluded = Number(page.excludedNsfwCount ?? 0), unknown = Number(page.unknownNsfwCount ?? 0);
    const visibleUnknown = rows.filter(row => row.facts.nsfw === null || row.facts.nsfw === undefined).length;
    const currentKind = (page.totalKind ?? (source.total === null ? 'unknown' : name === 'search_subjects' ? 'estimated' : 'exact')) as CandidateSourceReadState['totalKind'];
    const stableTotal = !prior || currentKind !== 'exact' || prior.totalKind !== 'exact' || previous!.total === source.total;
    const readState: CandidateSourceReadState = {
      revision: performance.now(), firstOffset: prior?.firstOffset ?? offset,
      pagesRead: (prior?.pagesRead ?? 0) + 1, continuous: prior ? prior.continuous && previous!.nextOffset === offset && stableTotal : offset === 0,
      totalKind: prior && (prior.totalKind !== currentKind || !stableTotal) ? 'unknown' : currentKind,
      excludedNsfwCount: (prior?.excludedNsfwCount ?? 0) + excluded,
      unknownNsfwCount: (prior?.unknownNsfwCount ?? 0) + unknown + visibleUnknown
    };
    if (dateWindow) {
      const old = prior?.filterCoverage, unknownIds = [...new Set([...(old?.unknownDateSubjectIds ?? []), ...(dateWindow.unknownDateSubjectIds as number[])])];
      readState.filterCoverage = {
        scope: 'source_sequence', scannedCount: (old?.scannedCount ?? 0) + Number(dateWindow.scannedCount),
        matchedCount: (old?.matchedCount ?? 0) + Number(dateWindow.matchedCount), unknownDateCount: unknownIds.length,
        unknownDateSubjectIds: unknownIds, complete: unknownIds.length === 0
      };
    }
    source.scannedCount = (previous?.scannedCount ?? 0) + Number(dateWindow?.scannedCount ?? page.returnedCount) + excluded + unknown;
    source.readState = readState;
    source.complete = name !== 'search_subjects' && readState.totalKind === 'exact' && readState.continuous && readState.firstOffset === 0
      && source.nextOffset === null && source.total !== null && source.scannedCount === source.total && readState.excludedNsfwCount === 0
      && readState.unknownNsfwCount === 0 && readState.filterCoverage?.complete !== false;
    const previousStage = typeof args.merge_ref === 'string' ? this.sourceCandidateStages.get(args.merge_ref) : undefined;
    const reusableStage = previousStage?.sourceRef === candidateSourceRef(source) ? previousStage : undefined;
    const set = reusableStage ? this.updateSourceInput(reusableStage.inputRef, binding, rows, [source])
      : typeof args.merge_ref === 'string' ? this.candidates.merge(args.merge_ref, binding, rows, [source])
        : this.candidates.create({ binding, rows, sources: [source], visibility: result.visibility as 'public' | 'self', ...(result.account ? { account: result.account as { id: number; username: string } } : {}) });
    const executeArgs = { ...args, candidate_ref: set.ref };
    const projected = await this.executeCandidates(executeArgs, context, signal, { processIds: set.changedIds, preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false, freshSource: true, ...(reusableStage ? { stageRef: reusableStage.ref } : {}) });
    const sourceStage = { turnId: binding.turnId, ref: String(projected.candidateRef), inputRef: set.ref, sourceRef: candidateSourceRef(source) };
    this.sourceCandidateStages.set(String(projected.candidateRef), sourceStage); this.sourceCandidateStages.set(String(projected.resultRef), sourceStage);
    projected.scope = { ...args }; projected.sourcePage = structuredClone(page); return projected;
  }
  private async readCollectionWindow(scope: CollectionSourceScope, context: AccessContext, offset: number, limit: number, signal?: AbortSignal): Promise<unknown> {
    const pageArgs = validateToolArguments('get_user_collections', { ...scope, offset, limit });
    const raw = obj(await this.dispatch('get_user_collections', pageArgs, context, signal));
    const visible: ObjectValue[] = []; let excludedNsfwCount = 0, unknownNsfwCount = 0;
    for (const row of raw.data as ObjectValue[]) {
      const subject = subjectSummary(obj(row.subject));
      if (subject.nsfw === null) { unknownNsfwCount++; continue; }
      if (subject.nsfw && (!context.account || !await this.allowNsfw(context, signal))) { excludedNsfwCount++; continue; }
      visible.push(row);
    }
    const nextOffset = offset + (raw.data as ObjectValue[]).length < Number(raw.total) ? offset + limit : null;
    const gated = {
      ...raw, data: visible, excludedNsfwCount, unknownNsfwCount,
      sourceNextOffset: nextOffset, sourceHasMore: nextOffset !== null
    };
    const page = collectionPage(gated, pageArgs);
    const comments = new Map((gated.data as ObjectValue[]).map(row => [Number(row.subject_id ?? obj(row.subject).id), typeof row.comment === 'string' ? row.comment : null]));
    page.data = page.data.map(row => ({
      ...row, personalComment: comments.get(Number(row.subjectId)) ?? null,
      ...(scope.username === '-' ? {} : { private: false })
    }));
    return page;
  }
  private async queryCollectionCandidates(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    const binding = this.collectionBinding(context, typeof args.collection_ref === 'string' ? args.collection_ref : undefined);
    const filter: ObjectValue = { ...obj(args.filter ?? {}), ...(args.air_date ? { air_date: args.air_date } : {}) };
    const snapshotScope = typeof args.collection_ref === 'string'
      ? this.collections.peek(args.collection_ref, this.candidateOwner()).scope : undefined;
    // 只按显式来源参数或原引用scope读取；filter不改变后续可复用的证据范围。
    const sourceCollectionType = args.collection_type === undefined ? snapshotScope?.collection_type : Number(args.collection_type);
    const sourceScope: CollectionSourceScope = {
      username: String(args.username), subject_type: Number(args.subject_type),
      ...(sourceCollectionType === undefined ? {} : { collection_type: sourceCollectionType })
    };
    const read = await this.collections.read({
      ...sourceScope, filter,
      ...(args.source_limit === undefined ? {} : { source_limit: Number(args.source_limit) }), ...(args.collection_ref ? { collection_ref: String(args.collection_ref) } : {})
    }, binding,
      (offset, limit) => this.readCollectionWindow(sourceScope, context, offset, limit, signal), signal, () => this.candidateShouldYield());
    const source: CandidateSource = {
      tool: 'query_user_collections', source: read.coverage.source, scope: JSON.stringify(read.scope),
      complete: read.coverage.sourceComplete, scannedCount: read.coverage.scannedCount, total: read.coverage.collectionTotal,
      nextOffset: read.coverage.sourceNextOffset, privateRecords: read.coverage.privateRecords
    };
    const candidateBinding = { ...this.candidateBinding(context), ...(args.username === '-' ? {} : { scopeKey: `public:collections:${String(args.username)}` }) };
    const sourceRows = [...read.rows, ...read.unknownRows];
    if (args.sort === 'date_asc' || args.sort === 'date_desc') sourceRows.sort((a, b) => (args.sort === 'date_asc' ? 1 : -1) * String(a.subject.date ?? '').localeCompare(String(b.subject.date ?? '')) || a.subjectId - b.subjectId);
    const seeds = sourceRows.map(row => this.candidateSeed(row.subject as unknown as ObjectValue, row as unknown as ObjectValue));
    const stageKey = JSON.stringify(stableCandidateKey([candidateBinding, read.collectionRef, filter, args.fields ?? ['id', 'name', 'nameCn', 'subjectType'], args.include ?? [], args.sort]));
    const previous = this.collectionCandidates.get(stageKey);
    const set = previous ? this.updateSourceInput(previous.inputRef, candidateBinding, seeds, [source], args.sort) : this.candidates.create({
      binding: candidateBinding, rows: seeds,
      sources: [source], visibility: args.username === '-' ? 'self' : 'public', ...(args.username === '-' && context.account ? { account: context.account } : {})
    });
    const projected = await this.executeCandidates({ ...args, filter, candidate_ref: set.ref, collection_ref: read.collectionRef }, context, signal,
      // 来源续读新增记录后重新核对完整已缓存snapshot，resultRef包含前窗已通过成员。
      { preserveInput: true, hydrateProjection: false, freshSource: true, ...(previous ? { stageRef: previous.ref } : {}) });
    this.collectionCandidates.set(stageKey, { turnId: candidateBinding.turnId, ref: String(projected.candidateRef), inputRef: set.ref });
    projected.scope = { ...args }; projected.filter = args.filter ?? {}; projected.collectionRef = read.collectionRef;
    const collectionScope = { ...read.scope, sourceComplete: read.coverage.sourceComplete };
    projected.collectionScope = collectionScope;
    checkCandidateResponse(projected, args, findToolDefinition('query_user_collections').inputSchema, collectionScope);
    return projected;
  }
  private async queryCollections(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    const bounds = args.air_date as DateBounds; const extras = args.extra_subject_ids as number[];
    const matches: ReturnType<typeof collectionMatch>[] = []; const seen = new Set<number>();
    let total: number | undefined; let scannedCount = 0; let pagesRead = 0; let unknownDateCount = 0;
    let excludedNsfwCount = 0; let unknownNsfwCount = 0;
    let stopReason: 'exhausted' | 'date_boundary' = 'exhausted';
    const self = args.username === '-'; const account = self ? await this.checkedAccount(signal) : null;
    const finish = (): ObjectValue => {
      const direction = args.sort === 'date_asc' ? 1 : -1;
      matches.sort((a, b) => direction * (a.date ?? '').localeCompare(b.date ?? '') || a.subjectId - b.subjectId);
      return {
        schemaVersion: 1, kind: 'collectionQuery', data: matches, matchedCount: matches.length, scope: { ...args },
        coverage: {
          complete: unknownDateCount === 0 && unknownNsfwCount === 0 && excludedNsfwCount === 0, source: context.source, scannedCount, pagesRead, collectionTotal: total ?? 0,
          unknownDateCount, excludedNsfwCount, unknownNsfwCount, stopReason, privateRecords: self ? 'included' : 'public_only'
        },
        missingExtraSubjectIds: extras.filter(id => !matches.some(row => row.subjectId === id)), visibility: self ? 'self' : 'public', readAt: new Date().toISOString()
      };
    };
    // 第三方公开收藏直接走v0；本人完整记录始终保留p1账户身份。
    for (let offset = 0; offset < 10000; offset += 100) {
      signal?.throwIfAborted();
      const query = compact({ subject_type: args.subject_type, type: args.collection_type, limit: 100, offset });
      const raw = account ? await this.transport.account('/p1/collections/subjects', { query: compact({ subjectType: args.subject_type, type: args.collection_type, limit: 100, offset }), expectedAccountId: account.id }, signal)
        : await this.readResource(`/v0/users/${encodeURIComponent(String(args.username))}/collections`, { query }, context, signal);
      const page = this.page(raw, 100, offset);
      if (total !== undefined && total !== page.total || page.total > 10000) throw new AppError('INCOMPLETE_DATA', '收藏范围查询总数改变或超过完整读取上限。');
      total = page.total; pagesRead++;
      for (const value of page.data) {
        const row = obj(value); const interest = account || context.account ? obj(row.interest, '收藏状态') : row;
        const subjectValue = account || context.account ? row : obj(row.subject);
        const subject = subjectSummary({ ...canonicalSubject(subjectValue), tags: undefined });
        if (typeof interest.type !== 'number') throw new AppError('INVALID_RESPONSE', '收藏状态必须是整数，不能转换字符串状态。');
        const status = interest.type; const subjectId = row.subject_id ?? subject.id;
        if (seen.has(subject.id) || subjectId !== subject.id || subject.subjectType !== args.subject_type || ![1, 2, 3, 4, 5].includes(status)
          || args.collection_type !== undefined && status !== args.collection_type || !subject.name.trim()) throw new AppError('INCOMPLETE_DATA', '收藏范围查询出现重复、异对象或不符合状态筛选的记录。');
        if (!self && (row.private !== undefined && row.private !== false || interest.private !== undefined && interest.private !== false)) throw new AppError('PRIVATE_SCOPE', '公开收藏查询不得包含私密或非法可见性记录。');
        seen.add(subject.id); scannedCount++;
        const date = fullDate(subject.date); const explicit = extras.includes(subject.id);
        if (!explicit && date === null) { unknownDateCount++; continue; }
        if (!explicit && date !== null && !dateMatches(date, bounds)) continue;
        // 先排除本次日期范围之外的记录；不为无关R18条目触发权限检查。
        if (subject.nsfw === true && (!context.account || !await this.allowNsfw(context, signal))) { excludedNsfwCount++; continue; }
        if (subject.nsfw === null) { unknownNsfwCount++; continue; }
        if (explicit || date !== null && dateMatches(date, bounds)) matches.push(collectionMatch(subject, status, interest.rate, explicit));
      }
      if (scannedCount === total) { if (account) await this.assertAccount(account.id, signal); return finish(); }
    }
    throw new AppError('INCOMPLETE_DATA', '收藏范围查询未完整读取，不能返回部分成功。');
  }
  private async publicNullable(path: string, signal?: AbortSignal): Promise<unknown> {
    try { return await this.transport.public(path, {}, signal); }
    catch (error) { if (error instanceof AppError && error.code === 'BGM_HTTP_404') return null; throw error; }
  }
  private async write(name: string, args: ObjectValue, guard: McpWriteGuard, signal?: AbortSignal): Promise<unknown> {
    const tracker = new SubmissionTracker(name, args, guard.accountId, guard.subjectId);
    try { return tracker.finish(await (guard.batchPreparation ? this.writePrepared(name, args, guard, tracker, signal) : this.writeLegacy(name, args, guard, tracker, signal))); }
    catch (error) { const failure = safeError(error); throw new SubmissionError(failure.code, failure.message, tracker.failed()); }
  }
  /** 批次已在开始阶段核实全部对象和原值；这里仅执行固定提交映射。 */
  private async writePrepared(name: string, args: ObjectValue, guard: McpWriteGuard, tracker: SubmissionTracker, signal?: AbortSignal): Promise<unknown> {
    const prepared = guard.batchPreparation!; const target = prepared.target;
    const submit = (path: string, method: string, body?: unknown) => tracker.submit(path, method, () => this.transport.account(path,
      { method, ...(body === undefined ? {} : { body }), expectedAccountId: guard.accountId }, signal));
    if (name === 'update_subject_collection') {
      const id = positive(args.subject_id); if (target.id !== id || guard.subjectId !== id) throw new AppError('STALE_PREVIEW', '收藏对象与冻结计划不一致。');
      const after = obj(prepared.after);
      if (['collection_type', 'rating', 'comment', 'tags', 'private'].some(key => Object.hasOwn(args, key))) {
        await submit(`/p1/collections/subjects/${id}`, 'PUT', { type: after.collection_type, rate: after.rating, comment: after.comment, tags: after.tags, private: after.private, progress: false });
      }
      if (Object.hasOwn(args, 'ep_status') || Object.hasOwn(args, 'vol_status')) {
        if (target.subjectType !== 1 || prepared.before === null) throw new AppError('UNSUPPORTED_PROGRESS', '书籍进度需要开始阶段核实的完整收藏。');
        await submit(`/p1/collections/subjects/${id}`, 'PATCH', compact({ epStatus: args.ep_status, volStatus: args.vol_status }));
      }
      return { subject_id: id };
    }
    if (name === 'update_single_episode_collection' || name === 'update_episode_collection') {
      const parent = positive(guard.subjectId); if (target.subjectId !== parent) throw new AppError('STALE_PREVIEW', '章节所属作品与冻结计划不一致。');
      const ids = name === 'update_single_episode_collection' ? [positive(args.episode_id)] : args.episode_ids as number[];
      for (const id of ids) {
        if (!guard.prepared?.episodes?.some(ep => ep.id === id)) throw new AppError('STALE_PREVIEW', '章节不在开始阶段核实的范围内。');
        tracker.parent(id, parent);
      }
      if (isWatchedUntil(name, args)) {
        const scope = watchedUntilIds(guard.prepared!.episodes!, ids[0]!); tracker.episodeScope(scope);
        await submit(`/p1/collections/episodes/${ids[0]}`, 'PATCH', { batch: true });
      } else for (const id of ids) await submit(`/p1/collections/episodes/${id}`, 'PATCH', { type: args.collection_type, batch: false });
      return { episode_ids: ids };
    }
    for (const entity of ['character', 'person']) if (name === `collect_${entity}` || name === `uncollect_${entity}`) {
      const id = positive(args[`${entity}_id`]); if (target.id !== id || target.kind !== entity) throw new AppError('STALE_PREVIEW', '收藏实体与冻结计划不一致。');
      await submit(`/p1/collections/${entity === 'person' ? 'persons' : 'characters'}/${id}`, name.startsWith('uncollect_') ? 'DELETE' : 'PUT'); return { id };
    }
    if (name === 'create_index') { const value = obj(await submit('/p1/indexes', 'POST', { title: args.title, desc: args.description, private: args.private })); return { id: positive(value.id) }; }
    const indexId = positive(args.index_id); if ((target.kind === 'indexSubject' ? target.indexId : target.id) !== indexId) throw new AppError('STALE_PREVIEW', '目录与冻结计划不一致。');
    if (name === 'collect_index' || name === 'uncollect_index') { await submit(`/p1/collections/indexes/${indexId}`, name === 'collect_index' ? 'PUT' : 'DELETE'); return { id: indexId }; }
    if (name === 'update_index') { await submit(`/p1/indexes/${indexId}`, 'PATCH', compact({ title: args.title, desc: args.description, private: args.private })); return { id: indexId }; }
    const sid = positive(args.subject_id); if (target.subjectId !== sid) throw new AppError('STALE_PREVIEW', '目录作品与冻结计划不一致。');
    if (name === 'add_subject_to_index') { const value = obj(await submit(`/p1/indexes/${indexId}/related`, 'PUT', { cat: 0, sid, comment: args.comment, order: args.order })); return { id: positive(value.id) }; }
    const relationId = positive(prepared.relationId); tracker.related(relationId);
    if (name === 'update_index_subject') { const after = obj(prepared.after); await submit(`/p1/indexes/${indexId}/related/${relationId}`, 'PATCH', { comment: after.comment, order: after.order }); }
    else if (name === 'remove_subject_from_index') await submit(`/p1/indexes/${indexId}/related/${relationId}`, 'DELETE');
    else throw new AppError('UNKNOWN_TOOL', '没有固定批次提交映射。');
    return { id: relationId };
  }
  private async writeLegacy(name: string, args: ObjectValue, guard: McpWriteGuard, tracker: SubmissionTracker, signal?: AbortSignal): Promise<unknown> {
    const accountId = guard.accountId;
    const submit = async (path: string, method: string, body?: unknown): Promise<unknown> => {
      if (guard.prepared === undefined) await this.assertAccount(accountId, signal); signal?.throwIfAborted();
      return tracker.submit(path, method, () => this.transport.account(path, body === undefined ? { method, expectedAccountId: accountId } : { method, body, expectedAccountId: accountId }, signal));
    };
    if (name === 'update_subject_collection') {
      const subjectId = Number(args.subject_id);
      if (guard.subjectId !== undefined && guard.subjectId !== subjectId) throw new AppError('STALE_PREVIEW', '作品与宿主授权不一致。');
      const baseline = guard.prepared?.collection;
      if (baseline && baseline.subjectId !== subjectId) throw new AppError('STALE_PREVIEW', '快照作品与写入对象不一致。');
      const current = guard.prepared === undefined ? await this.myCollection(subjectId, accountId, signal) : baseline === null ? null
        : { type: baseline!.status, rate: baseline!.rate, comment: baseline!.comment, tags: baseline!.tags, private: baseline!.private };
      const fields = ['collection_type', 'rating', 'comment', 'tags', 'private'];
      const changesCollection = fields.some(key => Object.hasOwn(args, key));
      const changesProgress = Object.hasOwn(args, 'ep_status') || Object.hasOwn(args, 'vol_status');
      if (!current && !Object.hasOwn(args, 'collection_type')) throw new AppError('INVALID_INPUT', '未收藏作品必须明确指定收藏状态。');
      if (guard.expectedStatus !== undefined && (current?.type ?? 0) !== guard.expectedStatus) throw new AppError('STALE_PREVIEW', '收藏现状已经变化。');
      if (changesProgress) {
        const subject = current ? obj(current.subject) : obj(await this.transport.public(`/v0/subjects/${subjectId}`, {}, signal));
        if ((subject.subjectType ?? subject.type) !== 1) throw new AppError('UNSUPPORTED_PROGRESS', '章数和卷数写入仅支持书籍；动画和三次元请使用章节工具。');
        if (!current) throw new AppError('INVALID_INPUT', '书籍进度更新要求作品已收藏。');
        for (const [key, totalKey] of [['ep_status', 'total_episodes'], ['vol_status', 'volumes']] as const) {
          const total = subject[totalKey] ?? subject[totalKey === 'total_episodes' ? 'totalEpisodes' : 'totalVolumes'];
          if (Object.hasOwn(args, key) && typeof total === 'number' && total > 0 && Number(args[key]) > total) throw new AppError('INVALID_INPUT', '书籍进度超过作品总量。');
        }
      }
      if (changesCollection) {
        if (current && (typeof current.rate !== 'number' || typeof current.comment !== 'string' || !Array.isArray(current.tags) || typeof current.private !== 'boolean')) throw new AppError('INVALID_RESPONSE', '现有收藏字段不完整，不能安全修改。');
        await submit(`/p1/collections/subjects/${subjectId}`, 'PUT', {
          type: args.collection_type ?? current?.type, rate: args.rating ?? current?.rate ?? 0, comment: args.comment ?? current?.comment ?? '', tags: args.tags ?? current?.tags ?? [], private: args.private ?? current?.private ?? false, progress: false,
        });
      }
      if (changesProgress) await submit(`/p1/collections/subjects/${subjectId}`, 'PATCH', compact({ epStatus: args.ep_status, volStatus: args.vol_status }));
      return { submitted: true, subject_id: subjectId };
    }
    if (name === 'update_single_episode_collection' || name === 'update_episode_collection') {
      const ids = name === 'update_single_episode_collection' ? [Number(args.episode_id)] : args.episode_ids as number[];
      if (isWatchedUntil(name, args)) {
        const baseline = guard.prepared;
        if (!baseline || !['anime', 'real'].includes(baseline.type) || !baseline.collection || baseline.collection.subjectId !== guard.subjectId || !baseline.episodes) {
          throw new AppError('STALE_PREVIEW', '看到此集要求宿主核实完整作品和章节范围。');
        }
        const scope = watchedUntilIds(baseline.episodes, ids[0]!);
        tracker.episodeScope(scope);
        const current = await this.allPrivateEpisodes(guard.subjectId!, accountId, signal);
        const snapshots = current.map(ep => ({ id: Number(ep.id), type: Number(ep.type), status: Number(obj(ep.collection).type), sort: typeof ep.sort === 'number' ? ep.sort : null }));
        const ordered = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => a.id - b.id);
        if (!isDeepStrictEqual(ordered(snapshots), ordered(baseline.episodes)) || !isDeepStrictEqual(watchedUntilIds(snapshots, ids[0]!), scope)) {
          throw new AppError('STALE_PREVIEW', '看到此集的章节范围或现状改变，未提交旧计划。');
        }
        await this.assertAccount(accountId, signal);
        await submit(`/p1/collections/episodes/${ids[0]}`, 'PATCH', { batch: true });
        return { submitted: true, episode_ids: scope };
      }
      if (guard.prepared) {
        const baseline = guard.prepared;
        if (!['anime', 'real'].includes(baseline.type) || !baseline.collection || baseline.collection.subjectId !== guard.subjectId
          || args.subject_id !== undefined && args.subject_id !== guard.subjectId) throw new AppError('STALE_PREVIEW', '章节快照所属作品不一致。');
        for (const id of ids) {
          const episode = baseline.episodes?.find(ep => ep.id === id);
          if (!episode || guard.expectedStatus !== undefined && episode.status !== guard.expectedStatus) throw new AppError('STALE_PREVIEW', '章节不在已核对计划中。');
          tracker.parent(id, guard.subjectId!);
        }
        for (const id of ids) await submit(`/p1/collections/episodes/${id}`, 'PATCH', { type: args.collection_type, batch: false });
        return { submitted: true, episode_ids: ids };
      }
      const episodes: ObjectValue[] = [];
      for (const id of ids) {
        const episode = await this.privateEpisode(id, accountId, signal); this.checkEpisode(episode, guard, args.subject_id === undefined ? undefined : Number(args.subject_id));
        tracker.parent(id, Number(episode.subject_id));
        const subject = obj(await this.transport.public(`/v0/subjects/${episode.subject_id}`, {}, signal));
        if (![2, 6].includes(Number(subject.type))) throw new AppError('UNSUPPORTED_PROGRESS', '单章节状态只支持动画和三次元。');
        episodes.push(episode);
      }
      for (const episode of episodes) {
        const latest = await this.privateEpisode(Number(episode.id), accountId, signal);
        if (obj(latest.collection).type !== obj(episode.collection).type || latest.subject_id !== episode.subject_id) throw new AppError('STALE_PREVIEW', '章节现状在执行前变化。');
        await submit(`/p1/collections/episodes/${episode.id}`, 'PATCH', { type: args.collection_type, batch: false });
      }
      return { submitted: true, episode_ids: ids };
    }
    for (const entity of ['character', 'person'] as const) {
      const plural = entity === 'person' ? 'persons' : 'characters';
      if (name === `collect_${entity}` || name === `uncollect_${entity}`) { await submit(`/p1/collections/${plural}/${args[`${entity}_id`]}`, name.startsWith('uncollect_') ? 'DELETE' : 'PUT'); return { submitted: true, id: args[`${entity}_id`] }; }
    }
    if (name === 'create_index') {
      const response = obj(await submit('/p1/indexes', 'POST', compact({ title: args.title, desc: args.description, private: args.private })));
      return { submitted: true, id: positive(response.id) };
    }
    const indexId = Number(args.index_id);
    if (name === 'collect_index' || name === 'uncollect_index') { await submit(`/p1/collections/indexes/${indexId}`, name === 'collect_index' ? 'PUT' : 'DELETE'); return { submitted: true, id: indexId }; }
    await this.ownedIndex(indexId, accountId, signal);
    if (name === 'update_index') { await submit(`/p1/indexes/${indexId}`, 'PATCH', compact({ title: args.title, desc: args.description, private: args.private })); return { submitted: true, id: indexId }; }
    const subjectId = Number(args.subject_id);
    if (name === 'add_subject_to_index') {
      const related = await this.allAccount(`/p1/indexes/${indexId}/related`, accountId, { cat: 0 }, signal);
      if (related.map(canonicalRelated).some(item => item.subject_id === subjectId)) throw new AppError('STALE_PREVIEW', '作品已在目录中，不重复加入。');
      const result = obj(await submit(`/p1/indexes/${indexId}/related`, 'PUT', compact({ cat: 0, sid: subjectId, comment: args.comment, order: args.order })));
      return { submitted: true, id: positive(result.id), index_id: indexId, subject_id: subjectId };
    }
    if (name === 'update_index_subject' || name === 'remove_subject_from_index') {
      const related = await this.related(indexId, subjectId, accountId, signal); const relatedId = positive(related.id);
      tracker.related(relatedId);
      if (name === 'update_index_subject') {
        if (typeof related.comment !== 'string' || !Number.isSafeInteger(related.order)) throw new AppError('INVALID_RESPONSE', '目录条目字段不完整，不能安全修改。');
        await submit(`/p1/indexes/${indexId}/related/${relatedId}`, 'PATCH', { comment: args.comment ?? related.comment, order: args.order ?? related.order });
      } else await submit(`/p1/indexes/${indexId}/related/${relatedId}`, 'DELETE');
      return { submitted: true, id: relatedId, index_id: indexId, subject_id: subjectId };
    }
    throw new AppError('UNKNOWN_TOOL', '未登记的写入映射。');
  }
}
