import { AppError } from '../domain/errors.js';
import type { MediaType } from '../domain/bangumi.js';
import type { CollectionSource, CollectionSnapshot } from '../domain/collection-library.js';
import { summarizeCollections } from '../domain/collection-library.js';

/** 完整列表只留在请求内存，供统计及后续推荐筛选使用；不写入会话或持久缓存。 */
export class CollectionReader {
  constructor(private readonly source: CollectionSource) {}
  async all(type?: MediaType, signal?: AbortSignal): Promise<CollectionSnapshot> {
    signal?.throwIfAborted();
    const startedAt = new Date().toISOString(); const account = await this.source.currentUser(signal);
    const data: CollectionSnapshot['data'] = []; const seen = new Set<number>(); let total: number | undefined;
    for (let offset = 0; offset < 10000; offset += 100) {
      signal?.throwIfAborted();
      const page = await this.source.collections({ ...(type ? { type } : {}), limit: 100, offset }, signal);
      signal?.throwIfAborted();
      if (page.account.id !== account.id || page.account.username !== account.username) throw new AppError('ACCOUNT_CHANGED', '收藏读取期间账户改变，请重新登录后查询。');
      if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10000) throw new AppError('BGM_COLLECTION_LIMIT', '收藏总数无效或超过10000项，请缩小媒体范围；未生成完整统计。');
      if ((total !== undefined && total !== page.total) || page.offset !== offset || page.limit !== 100 || page.scope.type !== type || page.scope.status !== undefined
        || page.data.length !== Math.min(100, Math.max(0, page.total - offset))) throw new AppError('INCOMPLETE_COLLECTION', '收藏分页缺失、总数变化或范围不一致；未生成完整统计。');
      total = page.total;
      for (const item of page.data) {
        if (seen.has(item.subjectId) || (type && item.type !== type)) throw new AppError('INCOMPLETE_COLLECTION', '收藏分页包含重复或其他类型；未生成完整统计。');
        seen.add(item.subjectId); data.push(item);
      }
      if (data.length === total) {
        const finalAccount = await this.source.currentUser(signal); signal?.throwIfAborted();
        if (finalAccount.id !== account.id || finalAccount.username !== account.username) throw new AppError('ACCOUNT_CHANGED', '收藏读取期间账户改变；未生成统计。');
        return { account, data, total, complete: true, startedAt, readAt: new Date().toISOString(), scope: type ? { type } : {} };
      }
      if (page.nextOffset !== offset + 100) throw new AppError('INCOMPLETE_COLLECTION', '收藏分页未推进；未生成完整统计。');
    }
    throw new AppError('BGM_COLLECTION_LIMIT', '收藏查询超过100页；未生成完整统计。');
  }
  async summary(type?: MediaType, signal?: AbortSignal) { return summarizeCollections(await this.all(type, signal)); }
}
