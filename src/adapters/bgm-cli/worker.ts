/** 固定 bgm-cli 1.1.2 客户端桥接；不接受 URL、任意方法或 shell 命令。 */
import { object, positiveId } from '../../domain/bangumi.js';
import { collectionPatch } from '../../domain/collection-plan.js';
import { AppError, safeError } from '../../domain/errors.js';
import { unifiedUpstream } from './upstream.js';

interface Upstream {
  getMe(): Promise<unknown>; getSubject(id: number): Promise<unknown>;
  listCollections(user: string, query: object): Promise<unknown>;
  upsertMyCollection(id: number, patch: object): Promise<unknown>;
  patchMyCollection(id: number, patch: object): Promise<unknown>;
  getEpisode(id: number): Promise<unknown>;
  updateMyEpisodeCollection(id: number, patch: object): Promise<unknown>;
}
async function snapshot(client: Upstream, id: number, user: string): Promise<unknown> {
  // 先确认条目可读，再完整查询本账户；前100项查找失败绝不作为创建依据。
  await client.getSubject(id);
  const seen = new Set<number>(); let total: number | undefined;
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = object(await client.listCollections(user, { limit: 100, offset }));
    if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.total) > 10000
      || (total !== undefined && total !== page.total)) throw new AppError('INCOMPLETE_COLLECTION', '无法完整核实账户收藏，停止写入规划。');
    total = Number(page.total);
    if (page.data.length !== Math.min(100, Math.max(0, total - offset))) throw new AppError('INCOMPLETE_COLLECTION', '收藏分页不完整。');
    let found: unknown;
    for (const value of page.data) {
      const item = object(value); const itemId = positiveId(item.subject_id);
      if (seen.has(itemId)) throw new AppError('INCOMPLETE_COLLECTION', '收藏分页存在重复项。');
      seen.add(itemId); if (itemId === id) found = item;
    }
    if (found) return found;
    if (seen.size === total) return null;
  }
  throw new AppError('INCOMPLETE_COLLECTION', '收藏查询超过上限。');
}
async function main(): Promise<unknown> {
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--json'));
  if (args[0] === 'delete_check' || args[0] === 'mutate' && object(JSON.parse(args[3] ?? '{}')).kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
  const {client,transport,session} = await unifiedUpstream();
  try {
  const user = object(await client.getMe()); const accountId = positiveId(user.id);
  if(session && session.accountId !== accountId) throw new AppError('ACCOUNT_CHANGED','当前认证账户改变。');
  const id = positiveId(args[1]);
  if (args[0] === 'snapshot' && args.length === 2) {
    if (typeof user.username !== 'string') throw new AppError('INVALID_RESPONSE', '账户用户名无效。');
    const collection = await snapshot(client, id, user.username);
    if (positiveId(object(await client.getMe()).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '读取期间账户改变。');
    return { collection, accountId };
  }
  if (args[0] === 'episode_snapshot' && args.length === 2) {
    const episode = object(await client.getEpisode(id));
    return { id, subjectId: positiveId(episode.subject_id ?? episode.subjectID), status: episode.collection == null ? 0 : object(episode.collection).type ?? object(episode.collection).status, accountId };
  }
  if (args[0] !== 'mutate' || args.length !== 4 || positiveId(args[2]) !== accountId) throw new AppError('ACCOUNT_CHANGED', '写入账户不匹配或参数无效。');
  const request = object(JSON.parse(args[3]!));
  if (request.kind === 'collection') {
    const patch = collectionPatch(request.patch);
    if (typeof patch.status !== 'number') throw new AppError('INVALID_INPUT', '收藏写入需要完整状态。');
    const { status, ...fields } = patch;
    await client.upsertMyCollection(id, { ...fields, type: status, progress: false });
  } else if (request.kind === 'book') {
    const patch = object(request.patch);
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !['epStatus', 'volStatus'].includes(key))
      || Object.values(patch).some(value => !Number.isSafeInteger(value) || Number(value) < 0)) throw new AppError('INVALID_INPUT', '书籍进度参数无效。');
    await client.patchMyCollection(id, patch);
  } else if (request.kind === 'episode') {
    if (![0, 1, 2, 3].includes(Number(request.status)) || typeof request.status !== 'number') throw new AppError('INVALID_INPUT', '章节状态无效。');
    const episode = object(await client.getEpisode(id));
    if (positiveId(episode.subject_id ?? episode.subjectID) !== positiveId(request.subjectId)) throw new AppError('INVALID_INPUT', '章节所属作品改变。');
    const currentStatus = episode.collection == null ? 0 : object(episode.collection).type ?? object(episode.collection).status;
    if (![0,1,2,3].includes(Number(request.expectedStatus)) || currentStatus !== request.expectedStatus) throw new AppError('PLAN_STALE', '章节现状改变，请重新预览。');
    await client.updateMyEpisodeCollection(id, { type: request.status, batch: false });
  } else throw new AppError('UNSUPPORTED_OPERATION', '当前适配器不支持此操作。');
  return { submitted: true };
  } finally { await transport.close(); }
}
main().then(data => process.stdout.write(JSON.stringify({ ok: true, data }))).catch(error => {
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const info = error instanceof AppError ? safeError(error) : { code: status ? `BGM_HTTP_${status}` : 'BGM_FAILED', message: 'Bangumi 请求失败，未回显原始错误。' };
  process.stdout.write(JSON.stringify({ ok: false, error: info }));
});
