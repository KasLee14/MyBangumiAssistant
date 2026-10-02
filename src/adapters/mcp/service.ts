import { AppError } from '../../domain/errors.js';
import { findToolDefinition, validateToolArguments } from './catalog.js';
import type { McpTransport } from './transport.js';

export interface McpWriteGuard { accountId: number; subjectId?: number; expectedStatus?: number }
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
function ratedSubject(value: unknown): ObjectValue {
  const item = obj(value);
  const total = item.rating && typeof item.rating === 'object' ? obj(item.rating).total : undefined;
  return { ...item, ratingCount: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null };
}
function canonicalSubject(value: unknown): ObjectValue {
  const item = ratedSubject(value);
  return { ...item, id: positive(item.id), name_cn: item.name_cn ?? item.nameCN ?? '', date: item.date ?? (item.airtime && obj(item.airtime).date), total_episodes: item.total_episodes ?? item.eps };
}
function canonicalEpisode(value: unknown): ObjectValue {
  const item = obj(value); const collection = item.collection == null ? {} : obj(item.collection);
  const id = positive(item.id); const owner = positive(item.subject_id ?? item.subjectID);
  const status = item.collection == null ? 0 : collection.type ?? collection.status;
  if (!Number.isInteger(status) || ![0, 1, 2, 3].includes(Number(status))) throw new AppError('INVALID_RESPONSE', '章节收藏状态不合法。');
  return { ...item, id, subject_id: owner, name_cn: item.name_cn ?? item.nameCN ?? '', collection: { ...collection, type: status } };
}
function canonicalCollection(value: unknown): ObjectValue {
  const item = obj(value); const interest = obj(item.interest, '个人收藏'); const subject = canonicalSubject(item);
  if (![1, 2, 3, 4, 5].includes(Number(interest.type))) throw new AppError('INVALID_RESPONSE', '个人收藏状态无效。');
  return { subject, subject_id: subject.id, type: interest.type, rate: interest.rate, comment: interest.comment, tags: interest.tags,
    private: interest.private, ep_status: interest.epStatus ?? interest.ep_status, vol_status: interest.volStatus ?? interest.vol_status,
    updated_at: interest.updatedAt ?? interest.updated_at };
}
function canonicalIndex(value: unknown): ObjectValue {
  const item = obj(value); const user = item.user == null ? undefined : obj(item.user);
  return { ...item, id: positive(item.id), ownerId: item.ownerId ?? item.uid ?? user?.id, title: item.title, description: item.description ?? item.desc, private: item.private };
}
function canonicalRelated(value: unknown): ObjectValue {
  const item = obj(value); const subject = item.subject == null ? undefined : obj(item.subject);
  return { ...item, subject_id: item.subject_id ?? item.sid ?? subject?.id, comment: item.comment, order: item.order };
}

/** 固定 API 映射；公开请求不会携带账户会话，所有写入仅使用应用 p1 会话。 */
export class BangumiMcpService {
  constructor(private readonly transport: McpTransport) {}
  close(): Promise<void> { return this.transport.close(); }
  private async checkedAccount(signal?: AbortSignal): Promise<{ id: number; username: string }> {
    const user = await this.transport.currentUser(signal);
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
    const all = await this.allAccount('/p1/collections/subjects', accountId, {}, signal);
    const value = all.find(item => obj(item).id === subjectId);
    return value === undefined ? null : canonicalCollection(value);
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
  private checkEpisode(episode: ObjectValue, guard: McpWriteGuard, subjectId?: number): void {
    const target = subjectId ?? guard.subjectId;
    if (!target || episode.subject_id !== target || guard.subjectId !== undefined && guard.subjectId !== target) throw new AppError('STALE_PREVIEW', '章节所属作品与宿主授权不一致。');
    if (guard.expectedStatus !== undefined && obj(episode.collection).type !== guard.expectedStatus) throw new AppError('STALE_PREVIEW', '章节现状已变化，需重新预览。');
  }

  async call(name: string, argumentsValue: unknown, signal?: AbortSignal, guard?: McpWriteGuard): Promise<unknown> {
    const args = validateToolArguments(name, argumentsValue); const definition = findToolDefinition(name);
    signal?.throwIfAborted();
    if (definition.effect === 'write') {
      if (!guard || typeof guard.accountId !== 'number' || !Number.isSafeInteger(guard.accountId) || guard.accountId < 1) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要宿主绑定账户及具体操作的授权。');
      await this.assertAccount(guard.accountId, signal);
      return this.write(name, args, guard, signal);
    }
    const id = (key: string): number => Number(args[key]); const limit = Number(args.limit ?? 30); const offset = Number(args.offset ?? 0);
    const publicCall = (path: string, options: { method?: string; query?: ObjectValue; body?: unknown } = {}): Promise<unknown> => this.transport.public(path, options, signal);
    if (name === 'get_daily_broadcast') {
      const calendar = await publicCall('/calendar');
      if (!Array.isArray(calendar)) throw new AppError('INVALID_RESPONSE', '放送日历必须按星期组织。');
      const data = calendar.map(raw => { const day = obj(raw); const page = this.relationPage(day.items, limit, offset); return { ...day, items: page.data, total: page.total, limit, offset, nextOffset: page.nextOffset, complete: page.complete }; });
      return { data, limit, offset, complete: data.every(day => day.complete), kind: 'weekly_schedule' };
    }
    if (name === 'get_current_user') return this.checkedAccount(signal);
    if (['search_subjects', 'search_characters', 'search_persons'].includes(name)) {
      const entity = name.slice('search_'.length); const filter = entity === 'subjects' ? compact({ type: args.subject_type === undefined ? undefined : [args.subject_type] })
        : entity === 'characters' ? compact({ nsfw: args.nsfw_filter }) : compact({ career: args.career_filter });
      return publicCall(`/v0/search/${entity}`, { method: 'POST', query: { limit, offset }, body: compact({ keyword: args.keyword, sort: args.sort, filter }) });
    }
    if (name === 'browse_subjects') return publicCall('/v0/subjects', { query: compact({ type: args.subject_type, cat: args.cat, series: args.series, platform: args.platform, sort: args.sort, year: args.year, month: args.month, limit, offset }) });
    if (name === 'get_subject_details') return ratedSubject(await publicCall(`/v0/subjects/${id('subject_id')}`));
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
      if (name === 'get_single_episode_collection') { const result = await this.privateEpisode(id('episode_id'), account.id, signal); await this.assertAccount(account.id, signal); return result; }
      const page = this.page(await this.transport.account(`/p1/subjects/${id('subject_id')}/episodes`, { query: compact({ type: args.episode_type, limit, offset }), expectedAccountId: account.id }, signal), limit, offset);
      const data = page.data.map(item => canonicalEpisode(item));
      if (data.some(item => item.subject_id !== id('subject_id') || args.episode_type !== undefined && item.type !== args.episode_type) || new Set(data.map(item => item.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '章节归属、筛选范围或分页记录错误。');
      await this.assertAccount(account.id, signal); return { ...page, data, account };
    }
    if (name === 'get_index' || name === 'get_index_subjects') {
      if (args.own === true) {
        const account = await this.checkedAccount(signal);
        if (name === 'get_index') return this.myIndex(id('index_id'), account.id, signal);
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
        const user = obj(await this.transport.account('/p1/me', { expectedAccountId: account.id }, signal)); const result = { username, avatar_type: args.avatar_type, url: obj(user.avatar, '头像')[String(args.avatar_type)] ?? null };
        await this.assertAccount(account.id, signal); return result;
      }
      if (name === 'get_user_collections') {
        if (!account) return publicCall(`/v0/users/${urlUsername}/collections`, { query: compact({ subject_type: args.subject_type, type: args.collection_type, limit, offset }) });
        const page = this.page(await this.transport.account('/p1/collections/subjects', { query: compact({ subjectType: args.subject_type, type: args.collection_type, limit, offset }), expectedAccountId: account.id }, signal), limit, offset);
        const data = page.data.map(canonicalCollection);
        if (new Set(data.map(item => item.subject_id)).size !== data.length || data.some(item => args.subject_type !== undefined && obj(item.subject).type !== args.subject_type || args.collection_type !== undefined && item.type !== args.collection_type)) throw new AppError('INVALID_RESPONSE', '收藏分页重复或筛选范围错误。');
        await this.assertAccount(account.id, signal); return { ...page, data, account };
      }
      if (name === 'get_user_subject_collection') {
        if (account) return this.myCollection(id('subject_id'), account.id, signal);
        return this.publicNullable(`/v0/users/${urlUsername}/collections/${id('subject_id')}`, signal);
      }
      for (const entity of ['character', 'person'] as const) {
        const plural = entity === 'person' ? 'persons' : 'characters';
        if (name === `get_user_${entity}_collections`) {
          if (!account) return publicCall(`/v0/users/${urlUsername}/collections/-/${plural}`, { query: { limit, offset } });
          const all = await this.allAccount(`/p1/collections/${plural}`, account.id, {}, signal);
          return { data: all.slice(offset, offset + limit).map(item => ({ ...obj(item), collected: true })), total: all.length, limit, offset, account };
        }
        if (name === `get_user_${entity}_collection`) return account ? this.myEntityCollection(plural, id(`${entity}_id`), account.id, signal) : this.publicNullable(`/v0/users/${urlUsername}/collections/-/${plural}/${id(`${entity}_id`)}`, signal);
      }
    }
    throw new AppError('UNKNOWN_TOOL', '工具没有固定 API 映射。');
  }
  private async publicNullable(path: string, signal?: AbortSignal): Promise<unknown> {
    try { return await this.transport.public(path, {}, signal); }
    catch (error) { if (error instanceof AppError && error.code === 'BGM_HTTP_404') return null; throw error; }
  }
  private async write(name: string, args: ObjectValue, guard: McpWriteGuard, signal?: AbortSignal): Promise<unknown> {
    const accountId = guard.accountId;
    const submit = async (path: string, method: string, body?: unknown): Promise<unknown> => {
      await this.assertAccount(accountId, signal); signal?.throwIfAborted();
      return this.transport.account(path, body === undefined ? { method, expectedAccountId: accountId } : { method, body, expectedAccountId: accountId }, signal);
    };
    if (name === 'update_subject_collection') {
      const subjectId = Number(args.subject_id);
      if (guard.subjectId !== undefined && guard.subjectId !== subjectId) throw new AppError('STALE_PREVIEW', '作品与宿主授权不一致。');
      const current = await this.myCollection(subjectId, accountId, signal);
      const fields = ['collection_type', 'rating', 'comment', 'tags', 'private'];
      const changesCollection = fields.some(key => Object.hasOwn(args, key));
      const changesProgress = Object.hasOwn(args, 'ep_status') || Object.hasOwn(args, 'vol_status');
      if (!current && !Object.hasOwn(args, 'collection_type')) throw new AppError('INVALID_INPUT', '未收藏作品必须明确指定收藏状态。');
      if (guard.expectedStatus !== undefined && (current?.type ?? 0) !== guard.expectedStatus) throw new AppError('STALE_PREVIEW', '收藏现状已经变化。');
      if (changesProgress) {
        const subject = current ? obj(current.subject) : obj(await this.transport.public(`/v0/subjects/${subjectId}`, {}, signal));
        if (subject.type !== 1) throw new AppError('UNSUPPORTED_PROGRESS', '章数和卷数写入仅支持书籍；动画和三次元请使用章节工具。');
        if (!current) throw new AppError('INVALID_INPUT', '书籍进度更新要求作品已收藏。');
        for (const [key, totalKey] of [['ep_status', 'total_episodes'], ['vol_status', 'volumes']] as const) {
          const total = subject[totalKey];
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
      const episodes: ObjectValue[] = [];
      for (const id of ids) {
        const episode = await this.privateEpisode(id, accountId, signal); this.checkEpisode(episode, guard, args.subject_id === undefined ? undefined : Number(args.subject_id));
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
      if (name === 'update_index_subject') {
        if (typeof related.comment !== 'string' || !Number.isSafeInteger(related.order)) throw new AppError('INVALID_RESPONSE', '目录条目字段不完整，不能安全修改。');
        await submit(`/p1/indexes/${indexId}/related/${relatedId}`, 'PATCH', { comment: args.comment ?? related.comment, order: args.order ?? related.order });
      } else await submit(`/p1/indexes/${indexId}/related/${relatedId}`, 'DELETE');
      return { submitted: true, id: relatedId, index_id: indexId, subject_id: subjectId };
    }
    throw new AppError('UNKNOWN_TOOL', '未登记的写入映射。');
  }
}
