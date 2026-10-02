import type { ToolSchema } from '../core/types.js';
import type { PlannedAction, FieldChange, DirectIntent } from '../domain/permissions.js';
import { AppError } from '../domain/errors.js';
import { object, positiveId } from '../domain/bangumi.js';
import { unsafeMutationText } from '../domain/dialogue-intent.js';
import { TOOL_DEFINITIONS, validateToolArguments } from '../adapters/mcp/catalog.js';
import type { McpCallClient } from '../adapters/mcp/client.js';
import { subjectFrom, collectionFrom } from '../adapters/bgm-cli/normalize.js';
import { collectionWriteAction } from '../domain/collection-plan.js';
import { progressAction, progressRequest } from '../domain/progress-plan.js';

export function mcpSchemas(): ToolSchema[] {
  return TOOL_DEFINITIONS.map(tool => ({ type: 'function', function: { name: tool.name,
    description: `${tool.description}${tool.effect === 'write' ? '。仅根据本轮真实用户的明确修改要求生成宿主预览；明确的单项新增收藏由宿主精确绑定授权，其余新增领域操作须用户确认，模型不能授予权限。' : ''}`,
    parameters: structuredClone(tool.inputSchema) } }));
}

/** 方案 B：仅完整句式的新增角色/人物/目录收藏可直接授权，参数必须一字不差。 */
export function directMcpIntentFrom(input: string): DirectIntent | null {
  if (unsafeMutationText(input)) return null;
  const match = /^(?:请)?\s*收藏\s*(角色|人物|目录)\s*#?\s*([1-9]\d*)[。！!]?\s*$/.exec(input);
  if (!match) return null;
  const kind = { 角色: 'character', 人物: 'person', 目录: 'index' }[match[1]!]!;
  const id = positiveId(match[2]);
  return { subjectId: id, patch: {}, mcp: { tool: `collect_${kind}`, args: { [`${kind}_id`]: id } } };
}

/** 非 subject 实体保持独立类型，绝不借用当前作品/候选编号推断 ID。 */
function explicitId(input: string, kind: 'character' | 'person' | 'index' | 'subject' | 'episode', id: number): boolean {
  const words = { character: '角色', person: '人物|声优|制作人员', index: '目录', subject: '条目|作品', episode: '章节|单集' };
  const path = kind === 'episode' ? 'episode|ep' : kind;
  return new RegExp(`(?:/(?:${path})/|(?:${words[kind]})(?:\\s*ID)?\\s*#?\\s*)${id}(?!\\d)`, 'i').test(input);
}

export function assertMcpMutationIntent(name: string, args: Record<string, unknown>, input: string): void {
  if (unsafeMutationText(input) || !input.trim() || /(?:不能|不可|不应|禁止|无须|无需|不打算)/.test(input.replace(/[“"][\s\S]*?[”"]/g, '正文'))) throw new AppError('AUTHORIZATION_REQUIRED', '必须由本轮真实用户明确提出修改；查询、假设、引述不能创建写入预览。');
  const command = input.trim().replace(/^(?:请帮我|请|麻烦你|麻烦|帮我)\s*/, '').replace(/[“"][\s\S]*?[”"]/g, '正文');
  if (/^(?:查询|查看|查查|查一下|看看|显示|展示|列出|搜索|检索|告诉我|解释|介绍|读取|获取)|(?:是什么|多少|是否|是不是|有没有)/.test(command)) throw new AppError('AUTHORIZATION_REQUIRED', '普通资料或现状查询不能由模型升级为修改预览。');
  const allowed = name === 'create_index' ? /(?:创建|新建|建立).*目录|目录.*(?:创建|新建|建立)/
    : name === 'update_index' ? /(?:修改|更新|改为|改成|设置|调整)/
    : name === 'add_subject_to_index' ? /(?:添加|加入|放入|放到)/
    : name === 'update_index_subject' ? /(?:修改|更新|改为|改成|设置|调整)/
    : name === 'remove_subject_from_index' ? /(?:移除|删除|去掉)/
    : name.startsWith('uncollect_') ? /(?:取消|移除|删除|不再)[\s\S]*收藏/
    : name.startsWith('collect_') ? /(?:收藏|关注)/
    : name === 'update_subject_collection' ? /(?:修改|更新|保存|设置|调整|加入|收藏|标记|改为|改成|设为|读到|读完|清空|(?:打|评)\s*(?:\d+|[一二三四五六七八九十]+)\s*分)/
    : /(?:修改|更新|设置|调整|标记|改为|改成|清空|取消已看|章节\s*#?\d+\s*(?:看过|想看|抛弃))/;
  if (!allowed.test(input) || name.startsWith('collect_') && /(?:取消|移除|删除|不再)[\s\S]*收藏/.test(input)) throw new AppError('AUTHORIZATION_REQUIRED', '工具操作与真实用户的修改目标不一致。');
  for (const kind of ['character', 'person', 'index'] as const) {
    const value = args[`${kind}_id`];
    if (value !== undefined && !explicitId(input, kind, positiveId(value))) throw new AppError('SELECTION_REQUIRED', `请明确${{ character: '角色', person: '人物', index: '目录' }[kind]}的链接或类型及 ID；不能沿用作品候选编号。`);
  }
  if (/^(?:add_subject_to_index|update_index_subject|remove_subject_from_index)$/.test(name)
    && !explicitId(input, 'subject', positiveId(args.subject_id))) throw new AppError('SELECTION_REQUIRED', '请明确目录内条目的链接或条目 ID。');
  if (name === 'update_single_episode_collection' && !explicitId(input, 'episode', positiveId(args.episode_id))) throw new AppError('SELECTION_REQUIRED', '请明确章节链接或章节 ID。');
}

function pageData(value: unknown): { data: unknown[]; total: number } {
  const page = object(value, '完整分页');
  if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new AppError('INCOMPLETE_RESPONSE', '分页缺少完整 data/total，不能生成修改预览。');
  return { data: page.data, total: Number(page.total) };
}
async function allPages(client: McpCallClient, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown[]> {
  const result: unknown[] = []; let total: number | undefined;
  while (result.length < (total ?? 1)) {
    signal?.throwIfAborted(); const page = pageData(await client.call(tool, { ...args, limit: 50, offset: result.length }, signal));
    if (total !== undefined && total !== page.total || page.total > 2000 || !page.data.length && result.length < page.total) throw new AppError('INCOMPLETE_RESPONSE', '分页期间清单变化或超过安全读取上限，请重新读取。');
    if (page.data.length !== Math.min(50, Math.max(0, page.total - result.length))) throw new AppError('INCOMPLETE_RESPONSE', '分页记录缺失，不能认为已持有完整清单。');
    total = page.total; result.push(...page.data);
    if (result.length > total) throw new AppError('INCOMPLETE_RESPONSE', '分页数量与 total 不一致。');
  }
  return result;
}

export interface IndexSnapshot { id: number; ownerId: number; title: string; description: string; private: boolean; collected: boolean; subjects?: { subject_id: number; comment: string; order: number }[] }
function indexSnapshot(value: unknown, id: number): IndexSnapshot {
  const raw = object(value, '目录现状');
  if (Number(raw.id) !== id || !Number.isSafeInteger(raw.ownerId) || Number(raw.ownerId) < 1 || typeof raw.title !== 'string'
    || typeof raw.description !== 'string' || typeof raw.private !== 'boolean' || typeof raw.collected !== 'boolean') throw new AppError('INCOMPLETE_RESPONSE', '目录归属、正文、私密或本人收藏状态不完整，不能修改。');
  return { id, ownerId: Number(raw.ownerId), title: raw.title, description: raw.description, private: raw.private, collected: raw.collected };
}

async function episodeParentSnapshot(client: McpCallClient, subjectId: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const subject = object(await client.call('get_subject_details', { subject_id: subjectId }, signal));
  if (subject.id !== subjectId || ![2, 6].includes(Number(subject.type))) throw new AppError('UNSUPPORTED_PROGRESS', '章节状态仅支持动画和三次元。');
  const value = await client.call('get_user_subject_collection', { username: '-', subject_id: subjectId }, signal);
  if (value === null) throw new AppError('COLLECTION_REQUIRED', '请先明确选择父作品的收藏状态，不能通过章节工具自动创建或联动收藏。');
  const collection = object(value);
  if (collection.subject_id !== subjectId || ![1, 2, 3, 4, 5].includes(Number(collection.type)) || !Number.isInteger(collection.rate)
    || typeof collection.comment !== 'string' || !Array.isArray(collection.tags) || collection.tags.some(tag => typeof tag !== 'string')
    || typeof collection.private !== 'boolean') throw new AppError('INCOMPLETE_COLLECTION', '父作品收藏字段不完整，不能保证章节操作保留已有收藏。');
  return { subject_id: subjectId, type: collection.type, rate: collection.rate, comment: collection.comment, tags: collection.tags, private: collection.private };
}

/** 预览/前置校验/回读使用同一完整快照；写后调用方必须用独立取消信号。 */
export async function mcpMutationSnapshot(client: McpCallClient, name: string, args: Record<string, unknown>, accountId: number, signal?: AbortSignal): Promise<unknown> {
  if (name === 'create_index') return null;
  if (name === 'update_subject_collection') {
    const id = positiveId(args.subject_id); const subject = object(await client.call('get_subject_details', { subject_id: id }, signal));
    if (subject.id !== id || subject.type !== 1) throw new AppError('UNSUPPORTED_PROGRESS', '收藏与章数/卷数混合修改仅支持书籍。');
    const value = await client.call('get_user_subject_collection', { username: '-', subject_id: id }, signal);
    if (value === null) throw new AppError('COLLECTION_REQUIRED', '先明确创建书籍收藏，再重新预览进度；混合修改不自动创建收藏。');
    const collection = object(value);
    if (collection.subject_id !== id || ![1, 2, 3, 4, 5].includes(Number(collection.type)) || !Number.isInteger(collection.rate)
      || Number(collection.rate) < 0 || Number(collection.rate) > 10 || typeof collection.comment !== 'string' || !Array.isArray(collection.tags)
      || collection.tags.some(tag => typeof tag !== 'string') || typeof collection.private !== 'boolean'
      || !Number.isSafeInteger(collection.ep_status) || Number(collection.ep_status) < 0 || !Number.isSafeInteger(collection.vol_status) || Number(collection.vol_status) < 0) throw new AppError('INCOMPLETE_COLLECTION', '书籍完整收藏或章数/卷数字段缺失，不能生成混合修改预览。');
    return { subject: { id, type: subject.type, name: subject.name, name_cn: subject.name_cn ?? '', total_episodes: subject.total_episodes ?? null, volumes: subject.volumes ?? null },
      collection: { subject_id: id, type: collection.type, rate: collection.rate, comment: collection.comment, tags: collection.tags, private: collection.private, ep_status: collection.ep_status, vol_status: collection.vol_status } };
  }
  if (/(?:collect|uncollect)_(character|person)$/.test(name)) {
    const kind = name.endsWith('character') ? 'character' : 'person'; const id = positiveId(args[`${kind}_id`]);
    const record = await client.call(`get_user_${kind}_collection`, { username: '-', [`${kind}_id`]: id }, signal);
    if (record !== null) {
      const raw = object(record); const returnedId = Number(raw.id ?? raw[`${kind}_id`] ?? object(raw[kind] ?? {}).id);
      if (returnedId !== id) throw new AppError('INVALID_RESPONSE', '收藏查询返回了其他对象。');
    }
    return { kind, id, collected: record !== null };
  }
  if (name.includes('index')) {
    const id = positiveId(args.index_id); const snapshot = indexSnapshot(await client.call('get_index', { index_id: id, own: true }, signal), id);
    if (/^(?:update_index|add_subject_to_index|update_index_subject|remove_subject_from_index)$/.test(name) && snapshot.ownerId !== accountId) throw new AppError('AUTHORIZATION_REQUIRED', '只能修改当前账户创建的目录。');
    if (/^(?:add_subject_to_index|update_index_subject|remove_subject_from_index)$/.test(name)) {
      const rows = await allPages(client, 'get_index_subjects', { index_id: id, own: true }, signal);
      const seen = new Set<number>();
      snapshot.subjects = rows.map(value => {
        const row = object(value); const subjectId = positiveId(row.subject_id ?? object(row.subject ?? {}).id ?? row.id);
        if (seen.has(subjectId) || typeof row.comment !== 'string' || !Number.isSafeInteger(row.order) || Number(row.order) < 0) throw new AppError('INCOMPLETE_RESPONSE', '目录条目编号、评语或排序不完整。');
        seen.add(subjectId); return { subject_id: subjectId, comment: row.comment, order: Number(row.order) };
      }).sort((a, b) => a.subject_id - b.subject_id);
    }
    return snapshot;
  }
  if (name === 'update_single_episode_collection') {
    const id = positiveId(args.episode_id); const raw = object(await client.call('get_single_episode_collection', { episode_id: id }, signal));
    const detail = object(await client.call('get_episode_details', { episode_id: id }, signal));
    const returnedId = positiveId(raw.episode_id ?? raw.id ?? object(raw.episode ?? {}).id);
    const status = Number(object(raw.collection ?? {}).type ?? raw.status);
    if (returnedId !== id || ![0, 1, 2, 3].includes(status)) throw new AppError('INCOMPLETE_EPISODES', '章节状态不完整。');
    const subjectId = positiveId(detail.subject_id ?? detail.subjectId);
    if (Number(raw.subject_id ?? raw.subjectId) !== subjectId) throw new AppError('INVALID_RESPONSE', '个人章节与详情所属作品不一致。');
    return { id, subjectId, collection: await episodeParentSnapshot(client, subjectId, signal), status };
  }
  if (name === 'update_episode_collection') {
    const rows = await allPages(client, 'get_user_episode_collection', { subject_id: positiveId(args.subject_id) }, signal);
    const seen = new Set<number>();
    const subjectId = positiveId(args.subject_id);
    const episodes = rows.map(value => {
      const row = object(value); const id = positiveId(row.episode_id ?? row.id ?? object(row.episode ?? {}).id); const status = Number(object(row.collection ?? {}).type ?? row.status);
      if (seen.has(id) || ![0, 1, 2, 3].includes(status) || row.subject_id !== subjectId) throw new AppError('INCOMPLETE_EPISODES', '章节状态不完整、重复或所属作品不符。');
      seen.add(id); return { id, status };
    }).sort((a, b) => a.id - b.id);
    return { subjectId, collection: await episodeParentSnapshot(client, subjectId, signal), episodes };
  }
  throw new AppError('TOOL_UNAVAILABLE', '此写工具没有对应的宿主领域适配。');
}

function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]): FieldChange[] {
  return keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => ({ field: key,
    before: typeof before[key] === 'object' ? JSON.stringify(before[key]) : before[key] as string | number | boolean | null,
    after: typeof after[key] === 'object' ? JSON.stringify(after[key]) : after[key] as string | number | boolean | null }));
}

export async function mcpMutationAction(client: McpCallClient, name: string, inputArgs: unknown, input: string, accountId: number, signal?: AbortSignal): Promise<PlannedAction> {
  const args = validateToolArguments(name, inputArgs) as Record<string, unknown>;
  assertMcpMutationIntent(name, args, input);
  const baseline = await mcpMutationSnapshot(client, name, args, accountId, signal);
  let expected = structuredClone(baseline); let title: string; let id: number; let changes: FieldChange[]; let effects: FieldChange[] = [];
  if (name === 'update_subject_collection') {
    const before = object(baseline); const subject = subjectFrom(before.subject); id = subject.id; title = subject.nameCn || subject.name;
    const current = collectionFrom(before.collection, id); const patch: Record<string, unknown> = {};
    for (const [key, field] of Object.entries({ collection_type: 'status', rating: 'rate', comment: 'comment', tags: 'tags', private: 'private' })) if (args[key] !== undefined) patch[field] = args[key];
    let collectionAction: PlannedAction | undefined;
    try { collectionAction = collectionWriteAction(subject, current, patch); }
    catch (error) { if (!(error instanceof AppError && error.code === 'NO_CHANGE')) throw error; }
    let progress: PlannedAction | undefined;
    try { progress = progressAction(subject, current, progressRequest({ mode: 'book', ...(args.ep_status === undefined ? {} : { chapters: args.ep_status }), ...(args.vol_status === undefined ? {} : { volumes: args.vol_status }) })); }
    catch (error) { if (!(error instanceof AppError && error.code === 'NO_CHANGE')) throw error; }
    changes = [...(collectionAction?.changes ?? []), ...(progress?.changes ?? [])]; effects = collectionAction?.effects ?? [];
    if (!changes.length) throw new AppError('NO_CHANGE', '书籍收藏与进度已和请求一致。');
    const after = object(object(expected).collection);
    const fields: Record<string, string> = { status: 'type', rate: 'rate', comment: 'comment', tags: 'tags', private: 'private', chapters: 'ep_status', volumes: 'vol_status' };
    for (const change of [...changes, ...effects]) after[fields[change.field]!] = structuredClone(change.after);
    Object.assign(args, { collection_type: after.type, rating: after.rate, comment: after.comment, tags: after.tags, private: after.private });
    return { subjectId: id, title, kind: 'mcp', changes, effects, notice: '书籍收藏与原生章数/卷数组合修改：保留其他字段；任一提交阶段失败或取消均独立回读完整现状，不重发。', mcp: { tool: name, args, baseline, expected } };
  }
  if (name === 'create_index') {
    id = accountId; title = `创建目录：${String(args.title)}`;
    expected = { ownerId: accountId, title: args.title, description: args.description, private: args.private ?? false };
    changes = [{ field: '新建目录', before: null, after: JSON.stringify(expected) }];
  } else if (/(?:collect|uncollect)_(character|person)$/.test(name)) {
    const after = object(expected); after.collected = !name.startsWith('uncollect_'); expected = after;
    id = positiveId(after.id); title = `${after.kind === 'character' ? '角色' : '人物'} #${id}`;
    changes = fieldChanges(object(baseline), after, ['collected']);
  } else if (name.includes('index')) {
    const before = baseline as IndexSnapshot; const after = expected as IndexSnapshot; id = before.id; title = `目录 #${id} ${before.title}`;
    if (name === 'update_index') {
      for (const key of ['title', 'description', 'private'] as const) if (args[key] !== undefined) (after as unknown as Record<string, unknown>)[key] = args[key];
      // 全量更新协议始终携带宿主已读现状，保留未指定字段。
      Object.assign(args, { title: after.title, description: after.description, private: after.private });
      changes = fieldChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ['title', 'description', 'private']);
    } else if (name === 'collect_index' || name === 'uncollect_index') {
      after.collected = name === 'collect_index'; changes = fieldChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ['collected']);
    } else {
      const subjectId = positiveId(args.subject_id); const row = after.subjects!.find(item => item.subject_id === subjectId);
      const previous = before.subjects!.find(item => item.subject_id === subjectId);
      if (name === 'add_subject_to_index') {
        if (row) throw new AppError('NO_CHANGE', '目录已包含该条目。');
        const order = args.order ?? Math.max(0, ...after.subjects!.map(item => item.order)) + 1;
        Object.assign(args, { comment: args.comment ?? '', order });
        after.subjects!.push({ subject_id: subjectId, comment: String(args.comment), order: Number(args.order) });
      } else {
        if (!row) throw new AppError('NO_CHANGE', '目录中不存在该条目。');
        if (name === 'remove_subject_from_index') after.subjects = after.subjects!.filter(item => item !== row);
        else {
          if (args.comment !== undefined) row.comment = String(args.comment);
          if (args.order !== undefined) row.order = Number(args.order);
          Object.assign(args, { comment: row.comment, order: row.order });
        }
      }
      after.subjects!.sort((a, b) => a.subject_id - b.subject_id);
      const next = after.subjects!.find(item => item.subject_id === subjectId);
      title += ` / 条目 #${subjectId}`;
      changes = fieldChanges({ present: Boolean(previous), comment: previous?.comment ?? null, order: previous?.order ?? null },
        { present: Boolean(next), comment: next?.comment ?? null, order: next?.order ?? null }, ['present', 'comment', 'order'])
        .map(change => ({ ...change, field: `subject:${subjectId}:${change.field}` }));
    }
  } else if (name === 'update_single_episode_collection') {
    const after = object(expected); after.status = args.collection_type ?? 2; expected = after;
    id = positiveId(after.subjectId); title = `条目 #${id} 章节 #${positiveId(args.episode_id)}`;
    changes = fieldChanges(object(baseline), after, ['status']);
  } else {
    id = positiveId(args.subject_id); title = `条目 #${id} 指定章节`;
    const rows = object(expected).episodes as { id: number; status: number }[]; const ids = args.episode_ids as number[];
    if (!Array.isArray(ids) || !ids.length || ids.some(episodeId => !rows.some(row => row.id === episodeId))) throw new AppError('INVALID_INPUT', '章节不属于目标作品或个人章节清单不完整。');
    for (const row of rows) if (ids.includes(row.id)) row.status = Number(args.collection_type ?? 2);
    const before = object(baseline).episodes as { id: number; status: number }[];
    changes = rows.filter(row => row.status !== before.find(item => item.id === row.id)!.status)
      .map(row => ({ field: `episode:${row.id}`, before: before.find(item => item.id === row.id)!.status, after: row.status }));
  }
  if (!changes.length) throw new AppError('NO_CHANGE', '请求未产生变更。');
  return { subjectId: id, title, kind: 'mcp', changes, effects, notice: `MCP ${name}：执行前再核当前账户与完整现状，提交一次并独立回读。`, mcp: { tool: name, args, baseline, expected } };
}
