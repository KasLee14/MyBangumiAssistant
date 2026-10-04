import { AppError, SubmissionError, safeError } from '../support/errors.js';
import { findToolDefinition, validateToolArguments } from './catalog.js';
import type { McpTransport, McpReadScope } from './transport.js';
import { preparedBaseline, type PreparedBaseline } from './prepared.js';
import { subjectDetails, subjectSummary, subjectPage, collectionPage, indexSubjectPage, checkOutput, checkSubjectResponse, type SubjectInclude } from './subject-output.js';
import { resourceResult, checkResourceResponse, entitySummary, episodeCollectionStatus } from './resource-output.js';
import { SubmissionTracker, checkSubmission } from './submission.js';
import { isDeepStrictEqual } from 'node:util';
import { isWatchedUntil, watchedUntilIds } from './episode-progress.js';
import { CommunityReader } from './community-service.js';
import { isCommunityTool } from './community-schemas.js';
import { checkCommunityResponse } from './community-output.js';
import { anonymousContext, unverifiedContext, type AccessContext } from './access-context.js';
import { accountRead, normalizeSubject } from './account-read.js';
import { collectionMatch, dateMatches, fullDate, parseWebCollectionPage, type DateBounds } from './collection-query.js';
import { batchScope, batchPreparation, type BatchPreparation, type McpBatchScope } from './batch-context.js';
import { PersonCharactersQuery } from './person-characters.js';
import { compileSubjectSearch, applySearchPlan, requireBrowseCoverage } from './search-capabilities.js';

export interface McpWriteGuard { accountId: number; subjectId?: number; expectedStatus?: number; prepared?: PreparedBaseline; batchPreparation?: BatchPreparation }
type ObjectValue = Record<string, unknown>;
function obj(value: unknown, label = 'Bangumi响应'): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', `${label}必须是对象。`);
  return value as ObjectValue;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AppError('INVALID_RESPONSE', 'Bangumi响应缺少有效ID。');
  return value;
}
function compact(input: ObjectValue): ObjectValue { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)); }
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
  return { subject, subject_id: subject.id, type: interest.type, rate: interest.rate, comment: interest.comment, tags: interest.tags,
    private: interest.private, ep_status: interest.epStatus ?? interest.ep_status, vol_status: interest.volStatus ?? interest.vol_status,
    updated_at: typeof (interest.updatedAt ?? interest.updated_at) === 'number' ? new Date(Number(interest.updatedAt ?? interest.updated_at) * 1000).toISOString() : interest.updatedAt ?? interest.updated_at };
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

/** 所有业务调用统一预检；登录查询使用固定账户映射，匿名请求不携带会话，写入保留宿主授权边界。 */
export class BangumiMcpService {
  private readonly community: CommunityReader;
  private readonly personCharacters: PersonCharactersQuery;
  private batchContext: { id: string; phase: McpBatchScope['phase']; context: AccessContext } | undefined;
  constructor(private readonly transport: McpTransport) {
    this.community = new CommunityReader(transport);
    this.personCharacters = new PersonCharactersQuery(transport);
  }
  close(): Promise<void> { this.community.clear(); this.personCharacters.clear(); return this.transport.close(); }
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
  private async personCharacterPage(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<unknown> {
    if (context.account && this.transport.bindReadScope) {
      const scope = await this.transport.bindReadScope(context, signal);
      try {
        return await this.personCharacters.call(args, context, signal, {
          scopeKey: scope.key, readAccount: scope.account, verifyScope: scope.verify,
        });
      } finally { await scope.close(); }
    }
    // 离线/嵌入客户端仍核对当前账户和权限；生产 transport 总是使用独立的会话绑定。
    const verifyScope = async (): Promise<void> => {
      if (this.transport.preflight) {
        const latest = await this.transport.preflight(signal);
        if (!isDeepStrictEqual(latest.account, context.account) || !isDeepStrictEqual(latest.nsfw, context.nsfw)) {
          throw new AppError('ACCOUNT_CHANGED', '关系读取期间账户或 NSFW 权限改变。');
        }
      } else if (context.account) await this.assertAccount(context.account.id, signal);
    };
    return this.personCharacters.call(args, context, signal, {
      scopeKey: JSON.stringify([context.account, context.nsfw]), verifyScope,
      readAccount: (path, options) => this.transport.account(path, { ...options,
        ...(context.account ? { expectedAccountId: context.account.id } : {}) }, signal),
    });
  }
  private async searchPage(name: 'search_subjects' | 'search_characters' | 'search_persons', args: ObjectValue, body: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    const limit = Number(args.limit); const offset = Number(args.offset);
    const data: unknown[] = []; const seen = new Set<number>(); let total: number | undefined;
    const kind = name === 'search_characters' ? 'character' : 'person';
    const entitySchema = name === 'search_subjects' ? undefined : {
      type: 'array', maxItems: 20, items: { $ref: `#/$defs/${kind === 'character' ? 'CharacterSummary' : 'PersonSummary'}` },
      $defs: findToolDefinition(name).outputSchema!.$defs,
    };
    const plan = name === 'search_subjects' ? compileSubjectSearch(body, context) : undefined;
    if (plan) applySearchPlan(context, plan);
    for (let batch = 0; batch < Math.ceil(limit / 20); batch++) {
      signal?.throwIfAborted();
      const batchLimit = Math.min(20, limit - data.length); const batchOffset = offset + data.length;
      const options = { method: 'POST', query: { limit: batchLimit, offset: batchOffset }, body: plan?.body ?? body };
      const raw = plan ? plan.source === 'p1'
        ? await this.transport.account('/p1/search/subjects', { ...options, expectedAccountId: context.account!.id }, signal)
        : await this.transport.public('/v0/search/subjects', options, signal)
        : await this.readResource(`/v0/search/${name.slice('search_'.length)}`, options, context, signal);
      const page = this.page(raw, batchLimit, batchOffset);
      if (plan?.source === 'p1') page.data = page.data.map(normalizeSubject);
      signal?.throwIfAborted();
      if (total !== undefined && total !== page.total) throw new AppError('INCOMPLETE_DATA', '搜索总数在分页读取期间变化。');
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
      if (data.length === limit || offset + data.length >= total) return { data, total, limit, offset };
    }
    throw new AppError('INCOMPLETE_DATA', '搜索分页未补齐请求范围。');
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

  async call(name: string, argumentsValue: unknown, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope): Promise<unknown> {
    const args = validateToolArguments(name, argumentsValue);
    const definition = findToolDefinition(name);
    if (definition.effect === 'write' && !guard) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要宿主绑定账户及具体操作的授权。');
    // 私人状态只描述读取时的快照；任何已授权写入都会使本连接的关系快照失效。
    if (definition.effect === 'write') this.personCharacters.clear();
    let context = anonymousContext();
    let checked = false;
    let dispatched = false;
    let readScope: McpReadScope | undefined;
    try {
    if (batch) {
      const scope = batchScope(batch);
      if (!this.batchContext) {
        if (scope.phase !== 'prepare' || name !== 'get_current_user') throw new AppError('BATCH_CONTEXT_EXPIRED', '批次须从完整账户预检开始。');
        const account = this.transport.preflight ? await this.transport.preflight(signal) : { ...anonymousContext(), mode: 'account' as const,
          account: await this.transport.currentUser(signal, true), source: 'p1' as const, nsfwApplied: true };
        if (!account.account) throw new AppError('BGM_AUTH_REQUIRED', '批次写入须先登录。');
        await this.transport.setBatchSession?.(true);
        this.batchContext = { id: scope.id, phase: scope.phase, context: structuredClone(account) };
      }
      if (scope.id !== this.batchContext.id) throw new AppError('BATCH_SCOPE_ACTIVE', '已有宿主批次上下文，不能交叉使用。');
      if (scope.phase !== this.batchContext.phase) {
        if (scope.phase === 'verify' && name === 'get_current_user') {
          const fresh = this.transport.preflight ? await this.transport.preflight(signal) : { ...this.batchContext.context, account: await this.transport.currentUser(signal, true) };
          if (fresh.account?.id !== this.batchContext.context.account?.id) throw new AppError('ACCOUNT_CHANGED', '整批回读前账户改变，不能核实原账户写入。');
          if (!isDeepStrictEqual(fresh.nsfw, this.batchContext.context.nsfw) || fresh.nsfwApplied !== this.batchContext.context.nsfwApplied) {
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
    else if (this.transport.preflight) context = await this.transport.preflight(signal);
    else if (definition.access === 'account' || args.username === '-' || args.own === true) {
      const account = await this.checkedAccount(signal); context = { ...context, mode: 'account', account,
        nsfw: { preference: null, allowed: null, state: 'unknown' }, source: 'p1', nsfwApplied: true };
    }
    checked = true;
    if (!batch && definition.effect === 'read' && context.account && name !== 'get_person_characters' && this.transport.bindReadScope) {
      readScope = await this.transport.bindReadScope(context, signal);
    }
    if (isCommunityTool(name)) {
      context.source = 'p1'; context.nsfwApplied = context.account !== null;
      const result = { ...await this.community.call(name, args, signal, context), accessContext: context };
      checkCommunityResponse(name, result, args);
      await readScope?.verify();
      return result;
    }
    if (guard && context.account?.id !== guard.accountId) throw new AppError('ACCOUNT_CHANGED', '当前账户与宿主授权账户不一致，未提交。');
    dispatched = true;
    const value = await this.dispatch(name, args, context, signal, guard);
    let result = value;
    if (name === 'get_subject_details') result = subjectDetails(value, args.include as SubjectInclude[], Number(args.subject_id));
    if (name === 'get_user_collections') result = collectionPage(value, args);
    if (name === 'get_index_subjects') result = indexSubjectPage(value, args);
    if (['search_subjects', 'browse_subjects', 'get_subject_relations', 'get_character_subjects', 'get_person_subjects'].includes(name)) {
      result = subjectPage(value, args, !['search_subjects', 'browse_subjects'].includes(name));
    }
    if (name === 'get_daily_broadcast') {
      const raw = obj(value); const days = raw.data as ObjectValue[];
      const data = days.map(day => {
        const weekday = obj(day.weekday); return { weekday: compact({ id: weekday.id, en: weekday.en, cn: weekday.cn, ja: weekday.ja }),
          subjects: subjectPage({ data: day.items, total: day.total, limit: day.limit, offset: day.offset }, args, true) };
      });
      if (new Set(data.map(day => day.weekday.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '放送日历星期重复。');
      result = { schemaVersion: 1, kind: 'weekly_schedule', data, complete: data.length === 7 && data.every(day => day.subjects.page.complete),
        visibility: 'public', readAt: new Date().toISOString() };
    }
    if (definition.effect === 'read' && !['query_user_collections','get_subject_details','get_user_collections','get_index_subjects','search_subjects','browse_subjects','get_subject_relations','get_character_subjects','get_person_subjects','get_daily_broadcast'].includes(name)) {
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
    checkSubjectResponse(name, result, args);
    await readScope?.verify();
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
      if (batch?.phase === 'close' && this.batchContext?.id === batch.id) { this.batchContext = undefined; await this.transport.setBatchSession?.(false); }
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
    if (name === 'get_person_characters') return this.personCharacterPage(args, context, signal);
    if (name === 'query_user_collections') return this.queryCollections(args, context, signal);
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
      return publicCall('/v0/subjects', { query: compact({ type: args.subject_type, cat: args.cat, series: args.series, platform: args.platform, sort: args.sort, year: args.year, month: args.month, limit, offset }) });
    }
    if (name === 'get_subject_details') return canonicalSubject(await publicCall(`/v0/subjects/${id('subject_id')}`));
    if (name === 'get_episode_details') return publicCall(`/v0/episodes/${id('episode_id')}`);
    if (name === 'get_episodes') return publicCall('/v0/episodes', { query: compact({ subject_id: args.subject_id, type: args.episode_type, limit, offset }) });
    if (name === 'get_subject_relations') return this.relationPage(await publicCall(`/v0/subjects/${id('subject_id')}/subjects`), limit, offset);
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
        const result = compact({ id: user.id, username: user.username, nickname: user.nickname, sign: user.sign, user_group: user.user_group,
          avatar: { large: avatar.large, medium: avatar.medium, small: avatar.small }, url: typeof user.url === 'string' ? user.url : undefined });
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
          return context.account ? { ...raw, data: raw.data.map(value => {
            const item = obj(value); const interest = obj(item.interest, '公开收藏');
            if (item.private !== undefined && item.private !== false || interest.private !== undefined && interest.private !== false) throw new AppError('PRIVATE_SCOPE', '公开用户收藏响应出现私密或非法可见性字段。');
            return { ...canonicalCollection(value), private: false };
          }) } : raw;
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
  private async queryCollections(args: ObjectValue, context: AccessContext, signal?: AbortSignal): Promise<ObjectValue> {
    const bounds = args.air_date as DateBounds; const extras = args.extra_subject_ids as number[];
    const matches: ReturnType<typeof collectionMatch>[] = []; const seen = new Set<number>();
    let total: number | undefined; let scannedCount = 0; let pagesRead = 0; let unknownDateCount = 0;
    let stopReason: 'exhausted' | 'date_boundary' = 'exhausted';
    const self = args.username === '-'; const account = self ? await this.checkedAccount(signal) : null;
    const finish = (): ObjectValue => {
      const direction = args.sort === 'date_asc' ? 1 : -1;
      matches.sort((a, b) => direction * (a.date ?? '').localeCompare(b.date ?? '') || a.subjectId - b.subjectId);
      return { schemaVersion: 1, kind: 'collectionQuery', data: matches, matchedCount: matches.length, scope: { ...args },
        coverage: { complete: unknownDateCount === 0, source: context.source, scannedCount, pagesRead, collectionTotal: total ?? 0,
          unknownDateCount, stopReason, privateRecords: self ? 'included' : 'public_only' },
        missingExtraSubjectIds: extras.filter(id => !matches.some(row => row.subjectId === id)), visibility: self ? 'self' : 'public', readAt: new Date().toISOString() };
    };
    // 登录时不能用匿名网页替代账户读取。网页仅对未登录、明确状态的公开查询开放。
    if (!context.account && !self && args.collection_type !== undefined && this.transport.webCollections) {
      const media = ({ 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' } as Record<number, string>)[Number(args.subject_type)]!;
      const status = ['wish', 'collect', 'do', 'on_hold', 'dropped'][Number(args.collection_type) - 1]!;
      let previousDate: string | undefined; context.source = 'web'; context.nsfwApplied = false;
      try {
        for (let number = 1; number <= 417; number++) {
          signal?.throwIfAborted();
          const page = parseWebCollectionPage(await this.transport.webCollections(String(args.username), media, status, number, signal), String(args.username), media, status, number);
          if (total !== undefined && total !== page.total || page.total > 10000) throw new AppError('WEB_COLLECTION_INVALID', '公开收藏网页总数改变或超出完整读取上限。');
          total = page.total; pagesRead++; let below = false;
          for (const row of page.rows) {
            if (seen.has(row.id) || row.date === null || previousDate !== undefined && row.date > previousDate) throw new AppError('WEB_COLLECTION_INVALID', '公开收藏网页重复、日期缺失或不是开播日期倒序。');
            seen.add(row.id); scannedCount++; previousDate = row.date;
            const explicit = extras.includes(row.id);
            if (explicit || dateMatches(row.date, bounds)) matches.push(collectionMatch(subjectSummary({ id: row.id, type: args.subject_type, name: row.name, date: row.date }), Number(args.collection_type), null, explicit));
            if (bounds.min !== undefined && row.date < bounds.min) below = true;
          }
          // 同一天可跨页：只有严格越过下界且补入项已核实，才停止后续分页。
          if (below && extras.every(id => seen.has(id))) { stopReason = 'date_boundary'; return finish(); }
          if (number === page.pageCount) return finish();
        }
        throw new AppError('INCOMPLETE_DATA', '公开收藏网页未完整覆盖请求范围。');
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'WEB_COLLECTION_INVALID') throw error;
        // 仅结构校验失败切换固定公开 API；认证/网络/超时/取消不重复或降级。
        total = undefined; scannedCount = 0; pagesRead = 0; matches.length = 0; seen.clear(); context.source = 'v0';
      }
    }
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
        if (explicit || date !== null && dateMatches(date, bounds)) matches.push(collectionMatch(subject, status, interest.rate, explicit));
        else if (date === null) unknownDateCount++;
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
