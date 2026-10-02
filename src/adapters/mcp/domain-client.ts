import type { BangumiWriteClient } from '../bgm-cli/write-client.js';
import { collectionFrom, collectionEntryFrom, episodeFrom, subjectFrom } from '../bgm-cli/normalize.js';
import { collectionPatch } from '../../domain/collection-plan.js';
import { keyword, mediaType, object, pageLimit, pageOffset, positiveId, type Collection, type CompleteEpisodes, type Episode, type EpisodePage, type MediaType, type Subject } from '../../domain/bangumi.js';
import { collectionQuery, STATUS_IDS, type CollectionPage, type CollectionQuery } from '../../domain/collection-library.js';
import { AppError } from '../../domain/errors.js';
import type { McpCallClient } from './client.js';

const TYPE_IDS: Record<MediaType, number> = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
function accountFrom(value: unknown): { id: number; username: string } {
  const user = object(value);
  if (typeof user.username !== 'string' || !user.username.trim() || user.username.length > 200) throw new AppError('INVALID_RESPONSE', '账户响应缺少有效用户名。');
  return { id: positiveId(user.id), username: user.username };
}
function collectionEntry(value: unknown) {
  const raw = object(value);
  if (Object.hasOwn(raw, 'subjectId') || Object.hasOwn(raw, 'interest')) return collectionEntryFrom(raw);
  const subject = object(raw.subject);
  return collectionEntryFrom({ ...subject, id: raw.subject_id ?? subject.id, type: raw.subject_type ?? subject.type, interest: raw });
}

/** MCP 传输替换原子进程；确定性分页、账户及写后验证仍由宿主领域链路管理。 */
export class McpBangumiClient implements BangumiWriteClient {
  constructor(private readonly mcp: McpCallClient) {}
  currentUser(signal?: AbortSignal) { return this.mcp.call('get_current_user', {}, signal).then(accountFrom); }
  async search(query: string, type?: MediaType, limit = 5, signal?: AbortSignal): Promise<{ data: Subject[]; total: number | null }> {
    const size = pageLimit(limit);
    const result = object(await this.mcp.call('search_subjects', { keyword: keyword(query), limit: size, offset: 0, sort: 'match', ...(type === undefined ? {} : { subject_type: TYPE_IDS[mediaType(type)] }) }, signal));
    if (!Array.isArray(result.data)) throw new AppError('INVALID_RESPONSE', '搜索结果缺少 data 数组。');
    return { data: result.data.slice(0, size).map(subjectFrom), total: typeof result.total === 'number' ? result.total : null };
  }
  async subject(id: number, signal?: AbortSignal): Promise<Subject> { return subjectFrom(await this.mcp.call('get_subject_details', { subject_id: positiveId(id) }, signal)); }
  async collection(id: number, signal?: AbortSignal): Promise<Collection> {
    const result = await this.collectionSnapshot(id, signal);
    if (result === null) throw new AppError('COLLECTION_NOT_FOUND', '此条目尚未收藏。');
    return result;
  }
  async collections(value: CollectionQuery = {}, signal?: AbortSignal): Promise<CollectionPage> {
    const query = collectionQuery(value); signal?.throwIfAborted();
    const account = await this.currentUser(signal);
    const result = object(await this.mcp.call('get_user_collections', { username: '-', limit: query.limit, offset: query.offset,
      ...(query.type ? { subject_type: TYPE_IDS[query.type] } : {}), ...(query.status ? { collection_type: STATUS_IDS[query.status] } : {}) }, signal));
    if (result.account !== undefined && accountFrom(result.account).id !== account.id || (await this.currentUser(signal)).id !== account.id) throw new AppError('ACCOUNT_CHANGED', '收藏查询期间账户改变。');
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.total) || Number(result.total) < 0
      || (result.offset !== undefined && result.offset !== query.offset) || (result.limit !== undefined && result.limit !== query.limit)) throw new AppError('INCOMPLETE_COLLECTION', '收藏列表、总数或分页信息无效；无法确认完整性。');
    const total = Number(result.total); const data = result.data.map(collectionEntry);
    if (data.length !== Math.min(query.limit, Math.max(0, total - query.offset)) || new Set(data.map(item => item.subjectId)).size !== data.length
      || data.some(item => query.type && item.type !== query.type || query.status && item.status !== query.status)) throw new AppError('INCOMPLETE_COLLECTION', '收藏页缺失、重复或筛选范围不一致。');
    return { account, data, total, limit: query.limit, offset: query.offset, nextOffset: query.offset + data.length < total ? query.offset + data.length : null,
      complete: query.offset === 0 && data.length === total, readAt: new Date().toISOString(), scope: { ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}) } };
  }
  async episodes(id: number, limit = 20, offset = 0, signal?: AbortSignal): Promise<EpisodePage> {
    const subjectId = positiveId(id); const size = pageLimit(limit); const start = pageOffset(offset);
    const result = object(await this.mcp.call('get_episodes', { subject_id: subjectId, limit: size, offset: start }, signal));
    if (!Array.isArray(result.data)) throw new AppError('INVALID_RESPONSE', '章节结果缺少 data 数组。');
    if (result.offset !== undefined && result.offset !== start || result.subjectId !== undefined && result.subjectId !== subjectId) throw new AppError('INVALID_RESPONSE', '章节响应偏移或作品与请求不一致。');
    if (result.total !== undefined && result.total !== null && (!Number.isSafeInteger(result.total) || Number(result.total) < 0)) throw new AppError('INVALID_RESPONSE', '章节响应总数必须为非负整数。');
    const total = typeof result.total === 'number' ? result.total : null; const data = result.data.map(episodeFrom);
    if (data.length > size || new Set(data.map(ep => ep.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '章节页超出数量限制或包含重复章节。');
    if (total !== null && data.length !== Math.min(size, Math.max(0, total - start))) throw new AppError('INCOMPLETE_EPISODES', '章节页数量与总数不一致，当前结果不能作为完整清单。');
    return { data, total, offset: start, limit: size, nextOffset: total !== null ? start + data.length < total ? start + data.length : null : data.length === size ? start + data.length : null,
      complete: start === 0 && total !== null && data.length === total };
  }
  async allEpisodes(id: number, signal?: AbortSignal): Promise<CompleteEpisodes> {
    const subjectId = positiveId(id); const data: Episode[] = []; const seen = new Set<number>(); let offset = 0; let total: number | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await this.episodes(subjectId, 20, offset, signal);
      if (result.total === null) throw new AppError('INCOMPLETE_EPISODES', '章节响应缺少总数，无法确认完整清单。');
      if (result.total > 2000) throw new AppError('BGM_EPISODE_LIMIT', '章节超过2000项，请使用分页查询。');
      if (total !== null && total !== result.total) throw new AppError('INCOMPLETE_EPISODES', '分页期间章节总数发生变化，请重新查询。');
      total = result.total;
      for (const episode of result.data) { if (seen.has(episode.id)) throw new AppError('INCOMPLETE_EPISODES', '分页返回重复章节。'); seen.add(episode.id); data.push(episode); }
      if (data.length === total) return { data, total, complete: true };
      if (result.nextOffset === null || result.nextOffset <= offset) throw new AppError('INCOMPLETE_EPISODES', '章节分页未继续推进。');
      offset = result.nextOffset;
    }
    throw new AppError('BGM_EPISODE_LIMIT', '章节分页超过100页。');
  }
  async collectionSnapshot(id: number, signal?: AbortSignal): Promise<Collection | null> {
    const subjectId = positiveId(id); const account = await this.currentUser(signal);
    const result = await this.mcp.call('get_user_subject_collection', { username: '-', subject_id: subjectId }, signal);
    if ((await this.currentUser(signal)).id !== account.id) throw new AppError('ACCOUNT_CHANGED', '收藏读取期间账户改变。');
    if (result === null) return null;
    const raw = object(result);
    if (raw.subject_id !== subjectId || typeof raw.comment !== 'string' || raw.comment.length > 2000 || !Array.isArray(raw.tags) || raw.tags.length > 40
      || raw.tags.some(tag => typeof tag !== 'string') || typeof raw.private !== 'boolean' || ![1, 2, 3, 4, 5].includes(Number(raw.type))
      || !Number.isInteger(raw.rate) || Number(raw.rate) < 0 || Number(raw.rate) > 10) throw new AppError('INCOMPLETE_COLLECTION', '收藏字段不完整，不能保证保留原值。');
    return collectionFrom(raw, subjectId);
  }
  private async episodeSnapshot(id: number, subjectId: number, signal?: AbortSignal) {
    const raw = object(await this.mcp.call('get_single_episode_collection', { episode_id: positiveId(id) }, signal));
    const collection = object(raw.collection); const status = collection.type ?? collection.status;
    if (raw.id !== id || raw.subject_id !== subjectId || typeof status !== 'number' || ![0, 1, 2, 3].includes(status)) throw new AppError('INCOMPLETE_EPISODES', '个人章节状态或所属作品不一致。');
    return status;
  }
  async progressEpisodes(id: number, accountId: number, signal?: AbortSignal): Promise<CompleteEpisodes> {
    const subjectId = positiveId(id);
    if ((await this.currentUser(signal)).id !== positiveId(accountId)) throw new AppError('ACCOUNT_CHANGED', '读取账户不匹配。');
    const data: Episode[] = []; const seen = new Set<number>(); let total: number | undefined;
    for (let offset = 0; offset < 2000; offset += 100) {
      signal?.throwIfAborted();
      const page = object(await this.mcp.call('get_user_episode_collection', { subject_id: subjectId, limit: 100, offset }, signal));
      if (page.account !== undefined && accountFrom(page.account).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '章节分页账户不匹配。');
      if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.total) > 2000
        || total !== undefined && total !== page.total || page.limit !== undefined && page.limit !== 100 || page.offset !== undefined && page.offset !== offset
        || page.data.length !== Math.min(100, Math.max(0, Number(page.total) - offset))) throw new AppError('INCOMPLETE_EPISODES', '个人章节分页不完整、总数变化或超过2000项。');
      total = Number(page.total);
      for (const value of page.data) {
        const raw = object(value); const episode = episodeFrom(raw);
        if (raw.subject_id !== subjectId || episode.status === null || ![0, 1, 2, 3].includes(episode.status) || seen.has(episode.id)) throw new AppError('INCOMPLETE_EPISODES', '个人章节归属、状态或重复记录不一致。');
        seen.add(episode.id); data.push(episode);
      }
      if (data.length === total) {
        if ((await this.currentUser(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '章节读取期间账户改变。');
        return { data, total, complete: true };
      }
    }
    throw new AppError('BGM_EPISODE_LIMIT', '个人章节分页超过2000项。');
  }
  async personalEpisodes(id: number, signal?: AbortSignal): Promise<CompleteEpisodes> {
    return this.progressEpisodes(id, (await this.currentUser(signal)).id, signal);
  }
  async mutate(id: number, accountId: number, value: object, signal: AbortSignal): Promise<void> {
    positiveId(id); positiveId(accountId); const request = object(value);
    if (request.kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放。');
    if ((await this.currentUser(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '写入账户不匹配。');
    if (request.kind === 'collection') {
      const patch = collectionPatch(request.patch);
      if (typeof patch.status !== 'number') throw new AppError('INVALID_INPUT', '收藏写入需要完整状态。');
      await this.mcp.call('update_subject_collection', { subject_id: id, collection_type: patch.status,
        ...(patch.rate === undefined ? {} : { rating: patch.rate }), ...(patch.tags === undefined ? {} : { tags: patch.tags }),
        ...(patch.comment === undefined ? {} : { comment: patch.comment }), ...(patch.private === undefined ? {} : { private: patch.private }) }, signal, { accountId });
    } else if (request.kind === 'book') {
      const patch = object(request.patch);
      if (!Object.keys(patch).length || Object.keys(patch).some(key => !['epStatus', 'volStatus'].includes(key)) || Object.values(patch).some(item => !Number.isSafeInteger(item) || Number(item) < 0)) throw new AppError('INVALID_INPUT', '书籍进度参数无效。');
      await this.mcp.call('update_subject_collection', { subject_id: id, ...(patch.epStatus === undefined ? {} : { ep_status: patch.epStatus }), ...(patch.volStatus === undefined ? {} : { vol_status: patch.volStatus }) }, signal, { accountId });
    } else if (request.kind === 'episode') {
      const subjectId = positiveId(request.subjectId);
      if (typeof request.status !== 'number' || ![0, 1, 2, 3].includes(request.status) || typeof request.expectedStatus !== 'number' || ![0, 1, 2, 3].includes(request.expectedStatus)) throw new AppError('INVALID_INPUT', '章节状态无效。');
      if (await this.episodeSnapshot(id, subjectId, signal) !== request.expectedStatus) throw new AppError('PLAN_STALE', '章节现状改变，请重新预览。');
      if ((await this.currentUser(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '写入账户改变。');
      await this.mcp.call('update_single_episode_collection', { episode_id: id, collection_type: request.status }, signal, { accountId, subjectId, expectedStatus: request.expectedStatus });
    } else throw new AppError('UNSUPPORTED_OPERATION', '当前适配器不支持此操作。');
  }
}
