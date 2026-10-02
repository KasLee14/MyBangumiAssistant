import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from '../../domain/errors.js';
import { keyword, mediaType, object, pageLimit, pageOffset, positiveId, type MediaType, type Subject, type Collection, type Episode, type EpisodePage, type CompleteEpisodes } from '../../domain/bangumi.js';
import { collectionFrom, collectionEntryFrom, episodeFrom, subjectFrom } from './normalize.js';
import { collectionQuery, type CollectionSource, type CollectionPage, type CollectionQuery } from '../../domain/collection-library.js';
import { bgmProcessError } from './errors.js';
import { fileURLToPath } from 'node:url';
import { policyFor, type ProxyOptions } from '../../config/proxy.js';

export interface BangumiReadClient extends CollectionSource {
  currentUser(signal?: AbortSignal): Promise<{ id: number; username: string }>;
  search(query: string, type?: MediaType, limit?: number, signal?: AbortSignal): Promise<{ data: Subject[]; total: number | null }>;
  subject(id: number, signal?: AbortSignal): Promise<Subject>;
  collection(id: number, signal?: AbortSignal): Promise<Collection>;
  episodes(id: number, limit?: number, offset?: number, signal?: AbortSignal): Promise<EpisodePage>;
  allEpisodes(id: number, signal?: AbortSignal): Promise<CompleteEpisodes>;
}
export type ProcessRunner = (args: readonly string[], signal?: AbortSignal) => Promise<unknown>;

export function createBgmRunner(options: {
  configDir: string; timeoutMs: number; proxy: ProxyOptions; authDir?: string;
  signal?: AbortSignal; env?: NodeJS.ProcessEnv; entry?: string;
}): ProcessRunner {
  const entry = options.entry ?? fileURLToPath(new URL('./read-worker.js',import.meta.url));
  return async (args, signal) => new Promise<unknown>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), BGM_CONFIG_DIR: options.configDir };
    env.BANGUMI_AUTH_DIRECTORY = options.authDir ?? join(options.configDir,'auth');
    const policy = policyFor(options.proxy);
    env.BANGUMI_PROXY_POLICY = JSON.stringify(policy);
    if (policy.https) env.BGM_PROXY = policy.https; else delete env.BGM_PROXY;
    env.BANGUMI_REQUEST_TIMEOUT_MS=String(options.timeoutMs);
    const activeSignal = signal ?? options.signal;
    if (activeSignal?.aborted) { reject(new AppError('CANCELLED', '操作已取消。')); return; }
    let stdout = ''; let stderr = ''; let failure: AppError | undefined;
    const child = spawn(process.execPath, [entry, '--json', ...args], { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = (error: AppError): void => { failure ??= error; child.kill(); };
    const timer = setTimeout(() => stop(new AppError('BGM_TIMEOUT', 'Bangumi 操作超时。')), options.timeoutMs);
    const abort = (): void => stop(new AppError('CANCELLED', '操作已取消。'));
    activeSignal?.addEventListener('abort', abort, { once: true });
    const cleanup = (): void => { clearTimeout(timer); activeSignal?.removeEventListener('abort', abort); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 2_000_000) stop(new AppError('BGM_OUTPUT_LIMIT', '查询结果过大，请缩小范围。'));
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > 100_000) stop(new AppError('BGM_OUTPUT_LIMIT', '查询错误输出过大。'));
    });
    child.once('error', () => { cleanup(); reject(new AppError('BGM_START_FAILED', '无法启动 Bangumi 桥接，请检查依赖安装。')); });
    child.once('close', (code) => {
      cleanup();
      if (failure) { reject(failure); return; }
      if (code !== 0) {
        reject(bgmProcessError(stderr)); return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new AppError('BGM_INVALID_JSON', 'bgm-cli 未返回有效 JSON。')); }
    });
  });
}

export class BgmReadClient implements BangumiReadClient {
  constructor(private readonly run: ProcessRunner) {}
  async currentUser(signal?: AbortSignal): Promise<{ id: number; username: string }> {
    const result = object(await this.run(['user', 'me'], signal));
    if (typeof result.username !== 'string' || !result.username.trim() || result.username.length > 200) {
      throw new AppError('INVALID_RESPONSE', '账户响应缺少有效用户名。');
    }
    return { id: positiveId(result.id), username: result.username };
  }
  async search(query: string, type?: MediaType, limit = 5, signal?: AbortSignal): Promise<{ data: Subject[]; total: number | null }> {
    const args = ['subject', 'search', keyword(query), '--limit', String(pageLimit(limit))];
    if (type !== undefined) args.push('--type', mediaType(type));
    const result = object(await this.run(args, signal));
    if (!Array.isArray(result.data)) throw new AppError('INVALID_RESPONSE', '搜索结果缺少 data 数组。');
    return { data: result.data.slice(0, limit).map(subjectFrom), total: typeof result.total === 'number' ? result.total : null };
  }
  async subject(id: number, signal?: AbortSignal): Promise<Subject> {
    return subjectFrom(await this.run(['subject', 'get', String(positiveId(id)), '--verbose'], signal));
  }
  async collection(id: number, signal?: AbortSignal): Promise<Collection> {
    const result = object(await this.run(['collection', 'get', String(positiveId(id))], signal));
    return collectionFrom(result.collection, id);
  }
  async collections(value: CollectionQuery = {}, signal?: AbortSignal): Promise<CollectionPage> {
    const query = collectionQuery(value); signal?.throwIfAborted();
    const args = ['collection', 'list', '--limit', String(query.limit), '--offset', String(query.offset)];
    if (query.type) args.push('--type', query.type);
    if (query.status) args.push('--status', query.status);
    const result = object(await this.run(args, signal)); signal?.throwIfAborted();
    const account = object(result.account);
    if (typeof account.username !== 'string' || !account.username.trim() || account.username.length > 200) throw new AppError('INVALID_RESPONSE', '收藏账户缺少有效用户名。');
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.total) || Number(result.total) < 0
      || (result.offset !== undefined && result.offset !== query.offset) || (result.limit !== undefined && result.limit !== query.limit)) throw new AppError('INCOMPLETE_COLLECTION', '收藏列表、总数或分页信息无效；无法确认完整性。');
    const total = Number(result.total); const data = result.data.map(collectionEntryFrom);
    if (data.length !== Math.min(query.limit, Math.max(0, total - query.offset)) || new Set(data.map(item => item.subjectId)).size !== data.length
      || data.some(item => query.type && item.type !== query.type || query.status && item.status !== query.status)) throw new AppError('INCOMPLETE_COLLECTION', '收藏页缺失、重复或筛选范围不一致。');
    return { account: { id: positiveId(account.id), username: account.username }, data, total, limit: query.limit, offset: query.offset,
      nextOffset: query.offset + data.length < total ? query.offset + data.length : null,
      complete: query.offset === 0 && data.length === total, readAt: new Date().toISOString(),
      scope: { ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}) } };
  }
  async episodes(id: number, limit = 20, offset = 0, signal?: AbortSignal): Promise<EpisodePage> {
    const subjectId = positiveId(id); const size = pageLimit(limit); const start = pageOffset(offset);
    const result = object(await this.run(['episode', 'list', String(subjectId), '--limit', String(size), '--offset', String(start)], signal));
    if (!Array.isArray(result.data)) throw new AppError('INVALID_RESPONSE', '章节结果缺少 data 数组。');
    if (result.offset !== undefined && result.offset !== start) throw new AppError('INVALID_RESPONSE', '章节响应偏移与请求不一致。');
    if (result.subjectId !== undefined && result.subjectId !== subjectId) throw new AppError('INVALID_RESPONSE', '章节响应属于其他条目。');
    if (result.total !== undefined && result.total !== null && (typeof result.total !== 'number' || !Number.isSafeInteger(result.total) || result.total < 0)) {
      throw new AppError('INVALID_RESPONSE', '章节响应总数必须为非负整数。');
    }
    const total = typeof result.total === 'number' ? result.total : null;
    const data = result.data.map(episodeFrom);
    if (data.length > size || new Set(data.map(ep => ep.id)).size !== data.length) throw new AppError('INVALID_RESPONSE', '章节页超出数量限制或包含重复章节。');
    if (total !== null && data.length !== Math.min(size, Math.max(0, total - start))) {
      throw new AppError('INCOMPLETE_EPISODES', '章节页数量与总数不一致，请重新查询；当前结果不能作为完整清单。');
    }
    return { data, total, offset: start, limit: size,
      nextOffset: total !== null ? start + data.length < total ? start + data.length : null : data.length === size ? start + data.length : null,
      complete: start === 0 && total !== null && data.length === total };
  }
  async allEpisodes(id: number, signal?: AbortSignal): Promise<CompleteEpisodes> {
    const subjectId = positiveId(id); const data: Episode[] = []; const seen = new Set<number>();
    let offset = 0; let total: number | null = null;
    // 限制最多100页/2000章，避免异常上游导致无限请求或无界模型上下文。
    for (let page = 0; page < 100; page++) {
      const result = await this.episodes(subjectId, 20, offset, signal);
      if (result.total === null) throw new AppError('INCOMPLETE_EPISODES', '章节响应缺少总数，无法确认完整清单。');
      if (result.total > 2000) throw new AppError('BGM_EPISODE_LIMIT', '章节超过2000项，请使用分页查询；本次没有生成完整清单。');
      if (total !== null && total !== result.total) throw new AppError('INCOMPLETE_EPISODES', '分页期间章节总数发生变化，请重新查询。');
      total = result.total;
      for (const episode of result.data) {
        if (seen.has(episode.id)) throw new AppError('INCOMPLETE_EPISODES', '分页返回重复章节，无法确认完整清单。');
        seen.add(episode.id); data.push(episode);
      }
      if (data.length === total) return { data, total, complete: true };
      if (result.nextOffset === null || result.nextOffset <= offset) throw new AppError('INCOMPLETE_EPISODES', '章节分页未继续推进，无法确认完整清单。');
      offset = result.nextOffset;
    }
    throw new AppError('BGM_EPISODE_LIMIT', '章节分页超过100页，本次没有生成完整清单。');
  }
}
