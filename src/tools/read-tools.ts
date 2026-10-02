import type { BangumiReadClient } from '../adapters/bgm-cli/client.js';
import type { CompleteEpisodes } from '../domain/bangumi.js';
import type { ToolRegistry, ToolSchema } from '../core/types.js';
import { keyword, mediaType, object, pageLimit, pageOffset, positiveId, progressCapability, collectionMeaning } from '../domain/bangumi.js';
import { AppError } from '../domain/errors.js';
import { CollectionReader } from '../core/collection-reader.js';
import { collectionQuery, collectionStatus, COLLECTION_STATUSES, type CollectionQuery } from '../domain/collection-library.js';

const properties = {
  subjectId: { type: 'integer', minimum: 1, description: '已从搜索或用户链接确认的 Bangumi 条目 ID' },
  limit: { type: 'integer', minimum: 1, maximum: 20 },
  offset: { type: 'integer', minimum: 0, description: '使用上一页返回的 nextOffset 继续查询' },
};
function schema(name: string, description: string, props: Record<string, unknown>, required: string[]): ToolSchema {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties: props, required, additionalProperties: false } } };
}
const schemas: ToolSchema[] = [
  schema('list_collections', '分页读取当前账户的现存收藏（含私密），可按媒体及状态筛选，每页最多20项；尾页不代表全部清单，不包含已删除历史。', {
    type: { type: 'string', enum: ['book', 'anime', 'music', 'game', 'real'] },
    status: { type: 'string', enum: [...COLLECTION_STATUSES] }, limit: properties.limit, offset: properties.offset,
  }, []),
  schema('get_collection_summary', '完整读取当前账户收藏并在本地统计数量、各状态和个人评分分布；可按媒体及收藏状态筛选。只统计看过/读过/听过/玩过时使用status=completed；不传status包含所有状态。计数、评分及平均分均仅覆盖返回scope。0为未评分，未知单列；不包含已删除历史，失败不返回全量统计。', {
    type: { type: 'string', enum: ['book', 'anime', 'music', 'game', 'real'] },
    status: { type: 'string', enum: [...COLLECTION_STATUSES] },
  }, []),
  schema('search_subjects', '按关键词搜索各类作品；同名作品先列出候选，不能擅自选择。', {
    keyword: { type: 'string', minLength: 1, maxLength: 200 },
    type: { type: 'string', enum: ['book', 'anime', 'music', 'game', 'real'] }, limit: properties.limit,
  }, ['keyword']),
  schema('get_subject', '查询确定条目的资料与来源链接，score为全站评分，ratingCount为打分人数；null表示未取得，不能用收藏人数替代。', { subjectId: properties.subjectId }, ['subjectId']),
  schema('get_collection', '查询当前账户的单个条目收藏；需要 Bangumi 认证。', { subjectId: properties.subjectId }, ['subjectId']),
  schema('list_episodes', '分页读取作品章节，每页最多20项；complete 为 true 才持有完整清单，未提供个人状态不代表没看过。', properties, ['subjectId']),
  schema('get_progress', '查询原生进度能力与个人收藏；动画/三次元读取完整章节（最多2000项），书籍返回章数/卷数；需要认证。', { subjectId: properties.subjectId }, ['subjectId']),
];

export class ReadTools implements ToolRegistry {
  constructor(private readonly client: BangumiReadClient) {}
  schemas(): ToolSchema[] { return structuredClone(schemas); }
  async execute(name: string, value: unknown, options?: { signal: AbortSignal }): Promise<unknown> {
    const signal = options?.signal; signal?.throwIfAborted();
    const definition = schemas.find(item => item.function.name === name);
    if (!definition) throw new AppError('TOOL_UNAVAILABLE', '此工具未登记；请使用已声明的领域工具，不能执行任意shell或社区操作。');
    const args = object(value, '工具参数');
    const props = definition.function.parameters.properties as Record<string, unknown>;
    if (Object.keys(args).some(key => !Object.hasOwn(props, key))) throw new AppError('INVALID_INPUT', '工具参数包含未声明字段。');
    switch (name) {
      case 'list_collections': return this.client.collections(collectionQuery(args as CollectionQuery, 20), signal);
      case 'get_collection_summary': return new CollectionReader(this.client).summary({
        ...(args.type === undefined ? {} : { type: mediaType(args.type) }),
        ...(args.status === undefined ? {} : { status: collectionStatus(args.status) }),
      }, signal);
      case 'search_subjects': return this.client.search(keyword(args.keyword), args.type === undefined ? undefined : mediaType(args.type), pageLimit(args.limit ?? 5), signal);
      case 'get_subject': return this.client.subject(positiveId(args.subjectId), signal);
      case 'get_collection': return collectionMeaning(await this.client.collection(positiveId(args.subjectId), signal));
      case 'list_episodes': return this.client.episodes(positiveId(args.subjectId), pageLimit(args.limit ?? 20), pageOffset(args.offset ?? 0), signal);
      case 'get_progress': {
        const id = positiveId(args.subjectId); const subject = await this.client.subject(id, signal);
        const capability = progressCapability(subject.type);
        const collection = await this.client.collection(id, signal);
        const personal = this.client as BangumiReadClient & { personalEpisodes?: (id: number, signal?: AbortSignal) => Promise<CompleteEpisodes> };
        return { subject, capability, collection: collectionMeaning(collection), source: 'bangumi', detail: subject.type === 'book'
          ? { chapters: collection.chapters, volumes: collection.volumes }
          : capability.supported ? personal.personalEpisodes ? await personal.personalEpisodes(id, signal) : await this.client.allEpisodes(id, signal) : null };
      }
      default: throw new AppError('TOOL_UNAVAILABLE', '工具尚未实现。');
    }
  }
}
