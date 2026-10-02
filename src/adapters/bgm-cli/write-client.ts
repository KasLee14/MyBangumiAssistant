import type { BangumiReadClient, ProcessRunner } from './client.js';
import { object, positiveId, type Collection, type CompleteEpisodes } from '../../domain/bangumi.js';
import { collectionFrom } from './normalize.js';
import { AppError } from '../../domain/errors.js';

export interface BangumiWriteClient extends BangumiReadClient {
  collectionSnapshot(id: number, signal?: AbortSignal): Promise<Collection | null>;
  progressEpisodes(id: number, accountId: number, signal?: AbortSignal): Promise<CompleteEpisodes>;
  mutate(id: number, accountId: number, request: object, signal: AbortSignal): Promise<void>;
}
export class BgmWriteClient implements BangumiWriteClient {
  constructor(private readonly read: BangumiReadClient, private readonly bridge: ProcessRunner) {}
  currentUser(signal?: AbortSignal) { return this.read.currentUser(signal); }
  search(...args: Parameters<BangumiReadClient['search']>) { return this.read.search(...args); }
  subject(id: number, signal?: AbortSignal) { return this.read.subject(id, signal); }
  collection(id: number,signal?:AbortSignal) { return this.read.collection(id,signal); }
  collections(...args: Parameters<BangumiReadClient['collections']>) { return this.read.collections(...args); }
  episodes(...args: Parameters<BangumiReadClient['episodes']>) { return this.read.episodes(...args); }
  allEpisodes(id: number,signal?:AbortSignal) { return this.read.allEpisodes(id,signal); }
  private async call(args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
    const result = object(await this.bridge(args, signal));
    if (result.ok !== true) {
      const error = object(result.error); const code = typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : 'BGM_FAILED';
      throw new AppError(code, 'Bangumi 操作未完成，请核对认证、权限和网站状态。');
    }
    return object(result.data);
  }
  async collectionSnapshot(id: number, signal?: AbortSignal): Promise<Collection | null> {
    const result = await this.call(['snapshot', String(positiveId(id))], signal);
    if (result.collection === null) return null;
    const raw = object(result.collection);
    if (raw.subject_id !== id || typeof raw.comment !== 'string' || raw.comment.length > 2000 || !Array.isArray(raw.tags) || raw.tags.length > 40
      || raw.tags.some(tag => typeof tag !== 'string') || typeof raw.private !== 'boolean'
      || ![1,2,3,4,5].includes(Number(raw.type)) || !Number.isInteger(raw.rate) || Number(raw.rate) < 0 || Number(raw.rate) > 10) {
      throw new AppError('INCOMPLETE_COLLECTION', '收藏字段不完整，不能保证保留原值。');
    }
    return collectionFrom(raw, id);
  }
  async progressEpisodes(id: number, accountId: number, signal?: AbortSignal): Promise<CompleteEpisodes> {
    const page = await this.read.allEpisodes(id, signal);
    for (const episode of page.data) {
      signal?.throwIfAborted();
      if (episode.status !== null && [0,1,2,3].includes(episode.status)) continue;
      const result = await this.call(['episode_snapshot', String(episode.id)], signal);
      if (result.accountId !== accountId || result.subjectId !== id || result.id !== episode.id || ![0,1,2,3].includes(Number(result.status))) throw new AppError('INCOMPLETE_EPISODES', '个人章节状态或账户不一致。');
      episode.status = Number(result.status);
    }
    if ((await this.currentUser(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '章节读取期间账户改变。');
    return page;
  }
  async mutate(id: number, accountId: number, request: object, signal: AbortSignal): Promise<void> {
    if (object(request).kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放。');
    await this.call(['mutate', String(positiveId(id)), String(positiveId(accountId)), JSON.stringify(request)], signal);
  }
}
