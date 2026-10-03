import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { AppError, SubmissionError, safeError, type SubmissionReceipt } from '../support/errors.js';
import type { MediaType } from '../support/bangumi.js';
import { findToolDefinition, validateToolArguments } from './catalog.js';
import type { McpCallClient, McpWriteGuard } from './client.js';
import type { McpWriteHandler } from './pi-tools.js';
import { collectionRecord, entityCollected, episodeStateData, indexRecord, pageRecord } from './resource-decode.js';
import { checkResourceResponse, record, positive, type Data } from './resource-output.js';
import { resourceOutputSchema } from './resource-schemas.js';
import { checkOutput, checkSubjectResponse } from './subject-output.js';
import { checkSubmission } from './submission.js';
import { createTerminalChannel, type InteractionChannel } from '../interaction.js';
import { formatWritePreview, WRITE_LABELS } from './write-preview.js';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { confirmationForPlan } from './confirmation-policy.js';
import { isEpisodeWrite, verifyWrittenState, type ReadbackVerification } from './write-verification.js';
import { isWatchedUntil, MAX_PROGRESS_EPISODES, watchedUntilIds } from './episode-progress.js';

type State = 'success' | 'failed' | 'unknown' | 'unchanged';
export interface Binding {
  target: Data;
  before: unknown;
  after: unknown;
  guard: McpWriteGuard;
  args: Data;
  effects: string[];
  baseline?: Map<string, unknown> | undefined;
  readback(receipt: SubmissionReceipt | undefined, signal: AbortSignal): Promise<unknown>;
}
const media: Record<number, MediaType> = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
const equal = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stable(value)]));
  return value;
}
/** 输入省略项与宿主明确预览的安全初始值使用同一提交身份。 */
export function submissionArguments(name: string, raw: Data): Data {
  const args = structuredClone(raw);
  if (name === 'create_index') args.private ??= false;
  if (name === 'add_subject_to_index') { args.comment ??= ''; args.order ??= 0; }
  return args;
}
function result(value: Data): AgentToolResult<unknown> {
  const details = { value };
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
}
function collection(value: unknown, id: number, accountId: number): Data | null {
  const current = collectionRecord(value, id, accountId);
  if (current === null) return null;
  return { collection_type: current.type, rating: current.rate, comment: current.comment,
    tags: [...current.tags as string[]].sort(), private: current.private, ep_status: current.ep_status, vol_status: current.vol_status };
}
function episode(value: unknown, id: number, accountId: number, parent?: number): Data {
  const current = episodeStateData(value, accountId);
  if (current.id !== id || parent !== undefined && current.subject_id !== parent) throw new AppError('INVALID_RESPONSE', '章节与原操作对象不一致。');
  return { episode_id: id, subject_id: positive(current.subject_id), episode_type: current.type, collection_type: record(current.collection).type };
}
function index(value: unknown, id: number, accountId: number): Data {
  const current = indexRecord(value, accountId);
  if (current.id !== id) throw new AppError('INVALID_RESPONSE', '目录与原操作对象不一致。');
  return { index_id: id, ownerId: current.ownerId, title: current.title, description: current.description, private: current.private, collected: current.collected };
}

/** 仅每轮保留提交指纹与事实，不维护对话、候选、修改草稿或恢复授权。 */
export interface WriteInput { text: string; generation: number }
export interface PlannedWrite { name: string; binding: Binding; createdIndex?: number }
/** 临时计划视图只预测固定映射的业务字段，用于整批预览和独立回读；不保存授权。 */
export function advanceWriteView(view: Map<string, unknown>, step: PlannedWrite, accountId: number): void {
  const { name, binding: b } = step;
  if (equal(b.before, b.after)) return;
  const t = b.target;
  if (name === 'update_subject_collection') view.set(`collection:${t.id}`, structuredClone(b.after));
  else if (name.includes('episode_collection')) {
    for (const row of record(b.after).episodes as Data[]) view.set(`episode:${row.episode_id}`, structuredClone(row));
  } else if (/^(collect|uncollect)_(character|person)$/.test(name)) view.set(`entity:${t.kind}:${t.id}`, structuredClone(b.after));
  else if (name === 'create_index') {
    view.set(`index:${step.createdIndex}`, { index_id: step.createdIndex, ownerId: accountId, ...record(b.after), collected: false });
    view.set(`relations:${step.createdIndex}`, []);
  } else if (name === 'update_index' || name === 'collect_index' || name === 'uncollect_index') {
    const key = `index:${t.id}`; view.set(key, { ...record(view.get(key)), ...record(b.after) });
  } else {
    const key = `relations:${t.indexId}`; const rows = structuredClone(view.get(key)) as Data[];
    const existing = rows.find(row => row.subject_id === t.subjectId);
    if (name === 'remove_subject_from_index') view.set(key, rows.filter(row => row.subject_id !== t.subjectId));
    else {
      if (existing) Object.assign(existing, record(b.after));
      else rows.push({ ...record(b.after), relationId: null });
      view.set(key, rows.sort((a, c) => Number(a.subject_id) - Number(c.subject_id)));
    }
  }
}
interface Permit {
  input: WriteInput; accountId: number; ctx: ExtensionToolContext; steps: PlannedWrite[];
  next: number; indexes: Map<number, number>;
}
export function createWriteBoundary(
  client: McpCallClient,
  getInput: () => { text: string; generation: number },
  onRecord?: (record: unknown) => void,
  channel: InteractionChannel = createTerminalChannel(),
) {
  let generation: number | undefined;
  const completed = new Map<string, AgentToolResult<unknown>>();
  let unknownWrite = false;
  let submittedGeneration: number | undefined;
  const permits = new WeakMap<object, Permit>();

  function checkInput(expected: WriteInput): void {
    const current = getInput();
    if (!expected.text.trim() || current.generation !== expected.generation || current.text !== expected.text) throw new AppError('STALE_PREVIEW', '用户输入已改变或没有本轮输入，未提交旧预览。');
  }

  async function read(name: string, raw: Data, signal?: AbortSignal): Promise<unknown> {
    const args = validateToolArguments(name, raw);
    const value = await client.call(name, args, signal);
    const definition = findToolDefinition(name);
    if (definition.outputSchema) {
      checkOutput(definition.outputSchema, { value });
      checkSubjectResponse(name, value, args);
      if (resourceOutputSchema(name)) checkResourceResponse(name, value, args, definition.outputSchema);
    }
    return value;
  }

  async function subject(id: number, signal?: AbortSignal): Promise<Data> {
    return record(await read('get_subject_details', { subject_id: id, include: [] }, signal));
  }
  async function subjectCollection(id: number, accountId: number, signal?: AbortSignal): Promise<Data | null> {
    return collection(await read('get_user_subject_collection', { username: '-', subject_id: id }, signal), id, accountId);
  }
  async function allEpisodeStates(subjectId: number, accountId: number, signal?: AbortSignal): Promise<{ state: Data; id: number; type: number; sort: number | null }[]> {
    const rows: { state: Data; id: number; type: number; sort: number | null }[] = []; const seen = new Set<number>(); let total: number | undefined;
    for (let offset = 0; offset < MAX_PROGRESS_EPISODES; offset += 100) {
      const page = pageRecord(await read('get_user_episode_collection', { subject_id: subjectId, limit: 100, offset }, signal), accountId);
      if (!Number.isSafeInteger(page.total) || Number(page.total) > MAX_PROGRESS_EPISODES || total !== undefined && total !== page.total) throw new AppError('INCOMPLETE_DATA', '看到此集要求稳定的完整章节分页，范围超过上限或读取期间改变。');
      total = Number(page.total);
      for (const raw of page.data as Data[]) {
        const ep = record(raw.episode); const id = positive(ep.id);
        if (ep.subjectId !== subjectId || seen.has(id)) throw new AppError('INCOMPLETE_DATA', '看到此集的完整章节归属错误或重复。');
        seen.add(id);
        rows.push({ id, type: Number(ep.episodeType), sort: typeof ep.sort === 'number' ? ep.sort : null,
          state: { episode_id: id, subject_id: subjectId, episode_type: ep.episodeType, collection_type: raw.episodeStatus } });
      }
      if (rows.length === total) return rows.sort((a, b) => a.id - b.id);
    }
    throw new AppError('INCOMPLETE_DATA', '看到此集的完整章节超过读取上限。');
  }
  function episodeScope(rows: Awaited<ReturnType<typeof allEpisodeStates>>): Data[] {
    return rows.map(({ id, type, sort }) => ({ id, type, sort }));
  }
  async function indexSnapshot(id: number, accountId: number, signal?: AbortSignal): Promise<Data> {
    return index(await read('get_index', { index_id: id, own: true }, signal), id, accountId);
  }
  async function indexSubjects(id: number, accountId: number, signal?: AbortSignal): Promise<Data[]> {
    const all: Data[] = []; const seen = new Set<number>(); let total: number | undefined;
    for (let offset = 0; offset <= 10000; offset += 100) {
      const page = pageRecord(await read('get_index_subjects', { index_id: id, own: true, limit: 100, offset }, signal), accountId);
      if (!Number.isSafeInteger(page.total) || Number(page.total) > 10000 || total !== undefined && page.total !== total) throw new AppError('INCOMPLETE_DATA', '目录关系未完整读取，不能用于修改。');
      total = Number(page.total);
      for (const value of page.data as unknown[]) {
        const row = record(value); const sid = positive(record(row.subject).id);
        if (seen.has(sid) || typeof row.comment !== 'string' || !Number.isSafeInteger(row.order)) throw new AppError('INCOMPLETE_DATA', '目录关系重复或短评/顺序缺失。');
        seen.add(sid);
        all.push({ subject_id: sid, relationId: positive(row.relationId), comment: row.comment, order: row.order });
      }
      if (all.length === total) return all.sort((a, b) => Number(a.subject_id) - Number(b.subject_id));
    }
    throw new AppError('INCOMPLETE_DATA', '目录关系超过完整读取上限。');
  }

  async function bind(name: string, original: Data, accountId: number, signal?: AbortSignal, view?: Map<string, unknown>, baseline = new Map<string, unknown>()): Promise<Binding> {
    const args = structuredClone(original);
    const guard: McpWriteGuard = { accountId };
    const load = async <T>(key: string, fetch: () => Promise<T>): Promise<T> => {
      const value = view?.has(key) ? structuredClone(view.get(key)) as T : await fetch();
      view?.set(key, structuredClone(value)); baseline.set(key, structuredClone(value)); return value;
    };
    if (name === 'update_subject_collection') {
      const id = positive(args.subject_id); const info = await subject(id, signal);
      const progress = Object.hasOwn(args, 'ep_status') || Object.hasOwn(args, 'vol_status');
      if (progress && info.subjectType !== 1) throw new AppError('UNSUPPORTED_PROGRESS', 'ep_status/vol_status仅支持书籍；动画和三次元请使用章节工具并回读已看集数。');
      const before = await load(`collection:${id}`, () => subjectCollection(id, accountId, signal));
      if (progress && before === null) throw new AppError('COLLECTION_REQUIRED', '书籍尚未收藏，请先完成收藏，再修改章数/卷数。');
      if (before === null && args.collection_type === undefined) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先明确收藏状态。');
      const after: Data = before === null ? { collection_type: args.collection_type, rating: 0, comment: '', tags: [], private: false, ep_status: 0, vol_status: 0 } : structuredClone(before);
      for (const key of Object.keys(after)) if (Object.hasOwn(args, key)) after[key] = key === 'tags' ? [...args.tags as string[]].sort() : args[key];
      if (progress) {
        for (const [key, totalKey] of [['ep_status', 'totalEpisodes'], ['vol_status', 'totalVolumes']]) {
          if (args[key!] !== undefined && typeof info[totalKey!] === 'number' && Number(info[totalKey!]) > 0 && Number(args[key!]) > Number(info[totalKey!])) throw new AppError('INVALID_INPUT', '书籍进度超过作品总量。');
        }
      }
      guard.subjectId = id;
      // 书籍进度的现有服务需完整原生作品快照，不能把简化prepared当作该快照。
      if (!progress) guard.prepared = { type: media[Number(info.subjectType)]!, collection: before === null ? null : {
        subjectId: id, status: Number(before.collection_type), rate: Number(before.rating), comment: String(before.comment), tags: before.tags as string[], private: before.private as boolean, chapters: Number(before.ep_status), volumes: Number(before.vol_status),
      } };
      return { target: { kind: 'subject', id, name: info.nameCn ?? info.name }, before, after, args, guard,
        effects: before === null ? ['创建收藏，未指定的评分/短评/标签/私密及进度采用预览中的初始值。'] : ['保留未修改的评分、短评、标签、私密及原生进度；收藏状态不会自动标记全部章节。'],
        readback: (_receipt, active) => subjectCollection(id, accountId, active) };
    }
    if (name === 'update_single_episode_collection' || name === 'update_episode_collection') {
      if (isWatchedUntil(name, args)) {
        const anchorId = positive(args.episode_id);
        const anchor = episode(await read('get_single_episode_collection', { episode_id: anchorId }, signal), anchorId, accountId);
        const parent = positive(anchor.subject_id); const info = await subject(parent, signal);
        if (![2, 6].includes(Number(info.subjectType))) throw new AppError('UNSUPPORTED_PROGRESS', '看到此集仅支持动画和三次元。');
        const current = await load(`collection:${parent}`, () => subjectCollection(parent, accountId, signal));
        if (current === null) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先明确创建收藏，再设置看到此集。');
        const all = await allEpisodeStates(parent, accountId, signal);
        const scope = episodeScope(all);
        await load(`episodeScope:${parent}`, async () => scope);
        const ids = watchedUntilIds(all, anchorId); const affected = new Set(ids);
        const snapshots: Data[] = [];
        for (const row of all) snapshots.push(await load(`episode:${row.id}`, async () => row.state));
        const byId = new Map(snapshots.map(row => [Number(row.episode_id), row]));
        const before = { episodes: ids.map(id => byId.get(id)!), protectedEpisodes: snapshots.filter(row => !affected.has(Number(row.episode_id))), parentCollection: current };
        const after = { ...before, episodes: before.episodes.map(row => ({ ...row, collection_type: 2 })) };
        guard.subjectId = parent;
        guard.prepared = { type: media[Number(info.subjectType)]!, collection: {
          subjectId: parent, status: Number(current.collection_type), rate: Number(current.rating), comment: String(current.comment), tags: current.tags as string[], private: current.private as boolean, chapters: Number(current.ep_status), volumes: Number(current.vol_status),
        }, episodes: all.map(row => ({ id: row.id, type: row.type, sort: row.sort, status: Number(byId.get(row.id)!.collection_type) })) };
        return { target: { kind: 'episodes', subjectId: parent, name: info.nameCn ?? info.name, episodeId: anchorId, episodeIds: ids, batch: true }, before, after, args, guard,
          effects: ['官方看到此集：一次请求将同作品sort不大于目标的正篇标记为看过；保留后续章节和特殊章节。',
            '已看章节的观看时间可能更新；汇总集数由网站计算并独立回读，不直接写ep_status，也不改变整部收藏状态。'],
          readback: async (_receipt, active) => {
            const rows = await allEpisodeStates(parent, accountId, active);
            if (!equal(episodeScope(rows), scope)) throw new AppError('INCOMPLETE_DATA', '回读章节范围改变，无法验证原看到此集计划。');
            const map = new Map(rows.map(row => [row.id, row.state]));
            return { episodes: ids.map(id => map.get(id)!), protectedEpisodes: rows.filter(row => !affected.has(row.id)).map(row => row.state), parentCollection: await subjectCollection(parent, accountId, active) };
          } };
      }
      const ids = name === 'update_single_episode_collection' ? [positive(args.episode_id)] : args.episode_ids as number[];
      const before: Data[] = [];
      let parent = name === 'update_episode_collection' ? positive(args.subject_id) : undefined;
      for (const id of ids) {
        const current = await load(`episode:${id}`, async () => episode(await read('get_single_episode_collection', { episode_id: id }, signal), id, accountId, parent));
        if (parent !== undefined && current.subject_id !== parent) throw new AppError('INVALID_RESPONSE', '章节与原操作对象不一致。');
        parent ??= positive(current.subject_id); before.push(current);
      }
      const info = await subject(parent!, signal); const current = await load(`collection:${parent}`, () => subjectCollection(parent!, accountId, signal));
      if (![2, 6].includes(Number(info.subjectType))) throw new AppError('UNSUPPORTED_PROGRESS', '单集状态只支持动画和三次元。');
      if (current === null) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先通过收藏工具确认创建，再修改章节。');
      guard.subjectId = parent!;
      guard.prepared = { type: media[Number(info.subjectType)]!, collection: {
        subjectId: parent!, status: Number(current.collection_type), rate: Number(current.rating), comment: String(current.comment), tags: current.tags as string[], private: current.private as boolean, chapters: Number(current.ep_status), volumes: Number(current.vol_status),
      }, episodes: before.map(row => ({ id: Number(row.episode_id), type: Number(row.episode_type), status: Number(row.collection_type) })) };
      const after = { episodes: before.map(row => ({ ...row, collection_type: args.collection_type })), parentCollection: current };
      return { target: { kind: 'episodes', subjectId: parent, name: info.nameCn ?? info.name, episodeIds: ids }, before: { episodes: before, parentCollection: current }, after, args, guard,
        effects: [current.collection_type !== 3 ? '该作品不在在看状态，本次仍仅修改以下明确章节。' : '仅修改以下章节，不联动其他章节或整部作品收藏状态。',
          '网站可能同步更新已看集数汇总；回读会核实目标章节及父收藏其他字段，并单列实际汇总进度。'],
        readback: async (_receipt, active) => {
          const rows: Data[] = [];
          for (const id of ids) rows.push(episode(await read('get_single_episode_collection', { episode_id: id }, active), id, accountId, parent));
          return { episodes: rows, parentCollection: await subjectCollection(parent!, accountId, active) };
        } };
    }
    if (/^(collect|uncollect)_(character|person)$/.test(name)) {
      const kind = name.endsWith('_character') ? 'character' : 'person'; const id = positive(args[`${kind}_id`]);
      const info = record(await read(`get_${kind}_details`, { [`${kind}_id`]: id, include: [] }, signal));
      const load = async (active?: AbortSignal) => ({ collected: entityCollected(await read(`get_user_${kind}_collection`, { username: '-', [`${kind}_id`]: id }, active), kind, id, accountId) });
      const before = view?.has(`entity:${kind}:${id}`) ? structuredClone(view.get(`entity:${kind}:${id}`)) : await load(signal);
      view?.set(`entity:${kind}:${id}`, structuredClone(before)); baseline.set(`entity:${kind}:${id}`, structuredClone(before));
      return { target: { kind, id, name: info.name }, before, after: { collected: name.startsWith('collect_') }, args, guard, effects: ['只修改该实体的收藏状态。'], readback: (_receipt, active) => load(active) };
    }
    if (name === 'create_index') {
      args.private ??= false;
      const after = { title: args.title, description: args.description, private: args.private };
      return { target: { kind: 'newIndex' }, before: null, after, args, guard, effects: ['创建一个新目录；请求超时后不重复创建。'],
        readback: async (receipt, active) => {
          if (!receipt?.createdId) throw new AppError('UNVERIFIABLE_CREATE', '未取得新目录ID，不能猜测创建结果或再次创建。');
          const actual = await indexSnapshot(receipt.createdId, accountId, active);
          if (actual.ownerId !== accountId) throw new AppError('ACCOUNT_CHANGED', '新目录不属于原账户。');
          return { title: actual.title, description: actual.description, private: actual.private };
        } };
    }
    const id = typeof args.index_id === 'number' && args.index_id < 0 && view?.has(`index:${args.index_id}`) ? args.index_id : positive(args.index_id);
    const current = await load(`index:${id}`, () => indexSnapshot(id, accountId, signal));
    if (name === 'collect_index' || name === 'uncollect_index') {
      return { target: { kind: 'index', id, title: current.title }, before: { collected: current.collected }, after: { collected: name === 'collect_index' }, args, guard,
        effects: ['仅修改目录收藏状态，不修改目录内容。'], readback: async (_receipt, active) => ({ collected: (await indexSnapshot(id, accountId, active)).collected }) };
    }
    if (current.ownerId !== accountId) throw new AppError('PERMISSION_DENIED', '只能修改当前账户拥有的目录。');
    if (name === 'update_index') {
      const before = { title: current.title, description: current.description, private: current.private };
      const after: Data = { ...before };
      for (const key of Object.keys(after)) if (Object.hasOwn(args, key)) after[key] = args[key];
      return { target: { kind: 'index', id, title: current.title }, before, after, args, guard, effects: ['保留未修改的目录标题、介绍与私密设置。'],
        readback: async (_receipt, active) => {
          const actual = await indexSnapshot(id, accountId, active);
          if (actual.ownerId !== accountId) throw new AppError('ACCOUNT_CHANGED', '目录所有者已改变。');
          return { title: actual.title, description: actual.description, private: actual.private };
        } };
    }
    if (!['add_subject_to_index', 'update_index_subject', 'remove_subject_from_index'].includes(name)) throw new AppError('UNKNOWN_TOOL', '写入工具没有固定宿主映射。');
    const sid = positive(args.subject_id); const info = await subject(sid, signal);
    const relations = await load(`relations:${id}`, () => indexSubjects(id, accountId, signal)); const row = relations.find(row => row.subject_id === sid);
    const before = row ? { subject_id: sid, comment: row.comment, order: row.order } : null;
    let after: Data | null;
    if (name === 'add_subject_to_index') {
      if (row) return { target: { kind: 'indexSubject', indexId: id, title: current.title, subjectId: sid, name: info.nameCn ?? info.name }, before, after: before, args, guard, effects: ['作品已在目录中，本次跳过；原有短评和顺序保持不变。'], readback: async () => before };
      args.comment ??= ''; args.order ??= 0;
      after = { subject_id: sid, comment: args.comment, order: args.order };
    } else if (name === 'remove_subject_from_index') after = null;
    else {
      if (!row) throw new AppError('INVALID_INPUT', '该作品不在目录中，无法修改关系字段。');
      after = { ...before!, ...(args.comment === undefined ? {} : { comment: args.comment }), ...(args.order === undefined ? {} : { order: args.order }) };
    }
    return { target: { kind: 'indexSubject', indexId: id, title: current.title, subjectId: sid, name: info.nameCn ?? info.name }, before, after, args, guard,
      effects: [name === 'remove_subject_from_index' ? '移除该作品及其目录短评和顺序，不修改作品个人收藏。' : '保留未修改的关系字段；顺序修改会改变该作品在目录中的相对位置。'],
      readback: async (_receipt, active) => {
        const current = await indexSnapshot(id, accountId, active);
        if (current.ownerId !== accountId) throw new AppError('ACCOUNT_CHANGED', '目录所有者已改变。');
        const relation = (await indexSubjects(id, accountId, active)).find(row => row.subject_id === sid);
        return relation ? { subject_id: sid, comment: relation.comment, order: relation.order } : null;
      } };
  }

  async function prepare(name: string, args: Data, accountId: number, signal?: AbortSignal, view?: Map<string, unknown>): Promise<Binding> {
    const baseline = new Map<string, unknown>();
    const value = await bind(name, args, accountId, signal, view, baseline);
    return { ...value, baseline };
  }
  async function canonical(key: string, accountId: number, signal?: AbortSignal): Promise<unknown> {
    const [kind, id, entityId] = key.split(':');
    if (kind === 'collection') return subjectCollection(Number(id), accountId, signal);
    if (kind === 'episode') return episode(await read('get_single_episode_collection', { episode_id: Number(id) }, signal), Number(id), accountId);
    if (kind === 'episodeScope') return episodeScope(await allEpisodeStates(Number(id), accountId, signal));
    if (kind === 'index') return indexSnapshot(Number(id), accountId, signal);
    if (kind === 'relations') return indexSubjects(Number(id), accountId, signal);
    if (kind === 'entity') return { collected: entityCollected(await read(`get_user_${id}_collection`, { username: '-', [`${id}_id`]: Number(entityId) }, signal), id!, Number(entityId), accountId) };
    throw new AppError('INVALID_INPUT', '未登记的批量现状类型。');
  }
  /** 看到此集的完整分页同时覆盖范围与逐集基线，避免为同一快照逐集发起HTTP读取。 */
  async function canonicalView(keys: Iterable<string>, accountId: number, signal?: AbortSignal): Promise<Map<string, unknown>> {
    const requested = new Set(keys); const result = new Map<string, unknown>();
    for (const key of requested) if (key.startsWith('episodeScope:')) {
      const rows = await allEpisodeStates(Number(key.split(':')[1]), accountId, signal);
      result.set(key, episodeScope(rows));
      for (const row of rows) if (requested.has(`episode:${row.id}`)) result.set(`episode:${row.id}`, row.state);
    }
    for (const key of requested) if (!result.has(key)) result.set(key, await canonical(key, accountId, signal));
    return result;
  }
  function sameBaseline(actual: Map<string, unknown> | undefined, expected: Map<string, unknown> | undefined): boolean {
    if (!actual || !expected || actual.size !== expected.size) return false;
    for (const [key, value] of expected) {
      let observed = actual.get(key);
      if (key.startsWith('relations:') && Array.isArray(value) && Array.isArray(observed)) {
        // 新增关系的ID由网站分配；仅这些宿主生成的null占位允许绑定到实际ID。
        observed = observed.map(raw => {
          const row = record(raw);
          return value.some(v => record(v).subject_id === row.subject_id && record(v).relationId === null) ? { ...row, relationId: null } : row;
        });
      }
      if (!equal(observed, value)) return false;
    }
    return true;
  }
  function sameBinding(actual: Binding, expected: Binding): boolean {
    return equal(actual.before, expected.before) && equal(actual.after, expected.after) && equal(actual.args, expected.args)
      && equal(actual.target, expected.target) && sameBaseline(actual.baseline, expected.baseline);
  }

  const execute = async (name: string, raw: Data, signal: AbortSignal | undefined, ctx: ExtensionToolContext, toolCallId: string, approved?: { input: WriteInput; accountId: number; binding: Binding }): Promise<AgentToolResult<unknown>> => {
    const input = { ...getInput() };
    if (generation !== input.generation) { generation = input.generation; completed.clear(); unknownWrite = false; }
    let fingerprint: string | undefined; let attempted = false; let binding: Binding | undefined; let accountId: number | undefined;
    try {
      const args = submissionArguments(name, validateToolArguments(name, raw));
      if (findToolDefinition(name).effect !== 'write') throw new AppError('INVALID_INPUT', '写入边界只接受固定写工具。');
      if (!input.text.trim()) throw new AppError('AUTHORIZATION_REQUIRED', '没有真实本轮用户输入，不能从恢复历史或模型输出取得修改授权。');
      signal?.throwIfAborted();
      accountId = positive(record(await read('get_current_user', {}, signal)).id);
      if (approved) { checkInput(approved.input); if (accountId !== approved.accountId) throw new AppError('ACCOUNT_CHANGED', '当前账户与整批授权账户不一致，已停止。'); }
      fingerprint = createHash('sha256').update(JSON.stringify(stable({ accountId, name, args }))).digest('hex');
      const previous = completed.get(fingerprint);
      if (previous && !approved) return previous;
      if (unknownWrite) throw new AppError('PREVIOUS_WRITE_UNKNOWN', '本轮已有未知修改，先核实既有结果；不继续提交或重发。');
      // Pi原生append-only事实覆盖全部分支；恢复不复活确认，也不忽略另一分支已提交的修改。
      let prior: Data | undefined;
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === 'custom' && entry.customType === 'bangumi/write' && entry.data !== null && typeof entry.data === 'object' && !Array.isArray(entry.data)) {
          const data = entry.data as Data;
          if (data.fingerprint === fingerprint && data.accountId === accountId) prior = data;
        }
      }
      if (prior?.phase === 'started' || prior?.state === 'unknown') throw new AppError('PREVIOUS_WRITE_UNKNOWN', 'Pi会话记录中该修改尚未核实，恢复或分支后禁止再次提交，请先独立读取网站现状。');
      if (!approved && submittedGeneration === input.generation) throw new AppError('WRITE_PLAN_ALREADY_SUBMITTED', '本轮已有提交，不再追加单项修改；多个操作须一次提交完整计划。');
      binding = await prepare(name, args, accountId, signal);
      if (approved && !sameBinding(binding, approved.binding)) throw new AppError('STALE_PREVIEW', '网站现状与整批已确认计划不一致，已停止后续操作。');
      const base = { tool: name, accountId, target: binding.target, before: binding.before, after: binding.after };
      if (equal(binding.before, binding.after)) {
        const unchanged = result({ ...base, state: 'unchanged', networkAttempted: false }); completed.set(fingerprint, unchanged); return unchanged;
      }
      if (!channel.canConfirm(ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要本地Pi交互终端或已连接的Web终端，非交互模式不提交修改。');
      const account = record(await read('get_current_user', {}, signal));
      const confirmation = confirmationForPlan([{ name, args: binding.args, before: binding.before, after: binding.after }]);
      const accepted = approved || !confirmation.required ? true : await channel.confirm(ctx, formatWritePreview(account, [{ name, ...binding }]), signal, { confirmLabel: `确认${WRITE_LABELS[name] ?? '修改'}` });
      signal?.throwIfAborted();
      if (!accepted) throw new AppError('CANCELLED', '用户取消，未提交修改。');
      const latest = getInput();
      if (latest.generation !== input.generation || latest.text !== input.text) throw new AppError('STALE_PREVIEW', '用户输入已改变，旧预览不能授权新操作。');
      if (positive(record(await read('get_current_user', {}, signal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '确认期间账户改变，旧预览不能授权新账户。');
      const refreshed = await prepare(name, args, accountId, signal);
      if (!sameBinding(refreshed, binding)) throw new AppError('STALE_PREVIEW', '确认期间网站现状改变，请重新生成具体预览。');
      binding = refreshed;
      signal?.throwIfAborted();
      const finalInput = getInput();
      if (finalInput.generation !== input.generation || finalInput.text !== input.text) throw new AppError('STALE_PREVIEW', '核对期间用户输入改变，未提交旧预览。');
      if (!channel.canConfirm(ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '交互通道已断开，未提交修改。');
      if (!onRecord) throw new AppError('WRITE_RECORD_REQUIRED', '未连接Pi提交事实记录，不能安全提交可恢复会话中的修改。');
      onRecord({ kind: 'bangumi-write', phase: 'started', fingerprint, generation: input.generation, tool: name, toolCallId, accountId, target: binding.target, args: binding.args });
      submittedGeneration = input.generation;
      attempted = true;
      let receipt: SubmissionReceipt | undefined; let submissionError: unknown;
      try {
        const submitted = await client.call(name, binding.args, signal, binding.guard);
        const definition = findToolDefinition(name);
        checkOutput(definition.outputSchema!, { value: submitted });
        checkSubmission(name, submitted, binding.args, accountId, binding.guard.subjectId, binding.guard.prepared);
        receipt = submitted as SubmissionReceipt;
      } catch (error) {
        submissionError = error;
        if (error instanceof SubmissionError) {
          try {
            checkOutput(findToolDefinition(name).outputSchema!, { error: safeError(error) });
            checkSubmission(name, error.submission, binding.args, accountId, binding.guard.subjectId, binding.guard.prepared);
            receipt = error.submission;
          } catch {}
        }
      }
      let state: State = receipt?.submissionState === 'not_attempted' ? 'failed' : 'unknown'; let actual: unknown; let verificationError: unknown;
      let verification: ReadbackVerification = { readbackCompleted: false, requestedStateMatched: false, protectedFieldsMatched: false, mismatchedFields: [] };
      // 独立生命周期；模型工具取消不会取消已提交操作的回读，不自动重试写入。
      try {
        const verificationSignal = AbortSignal.timeout(60000);
        if (positive(record(await read('get_current_user', {}, verificationSignal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '回读前账户已改变，不能验证原账户写入。');
        actual = await binding.readback(receipt, verificationSignal);
        if (positive(record(await read('get_current_user', {}, verificationSignal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '回读后账户已改变，不能报告原账户写入成功。');
        verification = verifyWrittenState(name, binding.before, binding.after, actual, binding.target);
        if (verification.requestedStateMatched && verification.protectedFieldsMatched) {
          if (approved) {
            const expected = structuredClone(binding.baseline ?? new Map<string, unknown>());
            advanceWriteView(expected, { name, binding, ...(name === 'create_index' ? { createdIndex: positive(receipt?.createdId) } : {}) }, accountId);
            // 汇总进度来自本次独立回读，不把网站派生更新当作未授权字段修改。
            if (verification.parentProgress) {
              const key = `collection:${verification.parentProgress.subjectId}`;
              expected.set(key, { ...record(expected.get(key)), ep_status: verification.parentProgress.actual });
            }
            const observed = await canonicalView(expected.keys(), accountId, verificationSignal);
            if (isEpisodeWrite(name)) {
              // 两次读取之间网站仍可能推进汇总；使用最后完整回读，不要求派生计数冻结。
              const subjectId = Number(binding.target.subjectId); const key = `collection:${subjectId}`;
              const expectedState = record(binding.after);
              actual = { episodes: (expectedState.episodes as Data[]).map(row => observed.get(`episode:${row.episode_id}`)), parentCollection: observed.get(key),
                ...(expectedState.protectedEpisodes ? { protectedEpisodes: (expectedState.protectedEpisodes as Data[]).map(row => observed.get(`episode:${row.episode_id}`)) } : {}) };
              verification = verifyWrittenState(name, binding.before, binding.after, actual, binding.target);
              if (verification.parentProgress) expected.set(key, { ...record(expected.get(key)), ep_status: verification.parentProgress.actual });
            }
            if (!sameBaseline(observed, expected)) {
              state = 'failed';
              if (!isEpisodeWrite(name)) verification.protectedFieldsMatched = false;
              verification.mismatchedFields.push('baseline');
              verificationError = new AppError('UNEXPECTED_CHANGE', '完整回读与已确认计划不一致，已停止后续。');
            }
            else {
              if (positive(record(await read('get_current_user', {}, verificationSignal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '完整回读后账户改变，不能报告成功。');
              state = 'success';
            }
          } else state = 'success';
        }
        else if (receipt?.submissionState === 'acknowledged' || receipt?.submissionState === 'not_attempted') state = 'failed';
        if (state === 'failed' && verification.mismatchedFields.length) verificationError ??= new AppError('READBACK_MISMATCH', `回读不符合预期：${verification.mismatchedFields.join('、')}。`);
      } catch (error) { verification.readbackCompleted = false; verificationError = error; }
      if (state === 'unknown') unknownWrite = true;
      const outcome = { ...base, state, networkAttempted: true, verification: { ...verification, state }, ...(actual === undefined ? {} : { actual }),
        ...(receipt === undefined ? {} : { submission: receipt }), ...(submissionError === undefined ? {} : { submissionError: safeError(submissionError) }),
        ...(verificationError === undefined ? {} : { verificationError: safeError(verificationError) }) };
      const value = result(outcome); completed.set(fingerprint, value);
      try { onRecord({ kind: 'bangumi-write', phase: 'completed', fingerprint, generation: input.generation, toolCallId, args: binding.args, ...outcome }); } catch {}
      return value;
    } catch (error) {
      if (attempted) unknownWrite = true;
      const value = result({ state: attempted ? 'unknown' : 'failed', tool: name, ...(accountId === undefined ? {} : { accountId }), networkAttempted: attempted, error: safeError(error) });
      if (fingerprint) completed.set(fingerprint, value);
      return value;
    }
  };

  function remap(value: unknown, indexes: Map<number, number>): unknown {
    if (Array.isArray(value)) return value.map(v => remap(v, indexes));
    if (!value || typeof value !== 'object') return value;
    const data = value as Data;
    return Object.fromEntries(Object.entries(data).map(([key, item]) => [key,
      typeof item === 'number' && (key === 'index_id' || key === 'indexId' || key === 'id' && data.kind === 'index') && item < 0
        ? indexes.get(item) ?? item : remap(item, indexes)]));
  }
  function resolved(binding: Binding, indexes: Map<number, number>): Binding {
    return { ...binding, args: remap(binding.args, indexes) as Data, target: remap(binding.target, indexes) as Data,
      before: remap(binding.before, indexes), after: remap(binding.after, indexes),
      baseline: new Map([...binding.baseline ?? []].map(([key, value]) => {
        const match = /^(index|relations):(-\d+)$/.exec(key);
        return [match ? `${match[1]}:${indexes.get(Number(match[2])) ?? match[2]}` : key, remap(value, indexes)];
      })) };
  }
  async function assertReady(ctx: ExtensionToolContext, input: WriteInput, accountId: number, signal?: AbortSignal) {
    checkInput(input); signal?.throwIfAborted();
    if (!channel.canConfirm(ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要本地Pi交互终端或已连接的Web终端；非交互模式不提交。');
    if (!onRecord) throw new AppError('WRITE_RECORD_REQUIRED', '未连接Pi执行事实记录，不能提交批量修改。');
    if (record(await read('get_current_user', {}, signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '当前账户与计划账户不一致。');
    const facts = new Map<string, Data>();
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === 'bangumi/write' && entry.data && typeof entry.data === 'object') {
        const fact = entry.data as Data;
        if (fact.accountId === accountId && typeof fact.fingerprint === 'string') facts.set(fact.fingerprint, fact);
      }
    }
    if ([...facts.values()].some(f => f.phase === 'started' || f.state === 'unknown')) throw new AppError('PREVIOUS_WRITE_UNKNOWN', 'Pi记录中存在尚未核实的修改，先独立核实，不能继续或重发。');
  }
  async function authorize(steps: PlannedWrite[], initial: Map<string, unknown>, input: WriteInput, account: Data, ctx: ExtensionToolContext, signal?: AbortSignal): Promise<object> {
    const accountId = positive(account.id);
    await assertReady(ctx, input, accountId, signal);
    if (submittedGeneration === input.generation) throw new AppError('WRITE_PLAN_ALREADY_SUBMITTED', '本轮已有写入提交，不能追加另一个计划；请先一次收齐完整范围。');
    // 存储独立副本，确认期间参数或调用者对象变化不能扩大授权。
    const frozen = steps.map(step => ({ ...step, binding: { ...step.binding,
      target: structuredClone(step.binding.target), args: structuredClone(step.binding.args), guard: structuredClone(step.binding.guard), before: structuredClone(step.binding.before), after: structuredClone(step.binding.after),
      effects: [...step.binding.effects], baseline: structuredClone(step.binding.baseline) } }));
    const baseline = structuredClone(initial);
    const skipped = frozen.filter(s => equal(s.binding.before, s.binding.after)).length;
    const confirmation = confirmationForPlan(frozen.map(s => ({ name: s.name, args: s.binding.args, before: s.binding.before, after: s.binding.after })));
    if (confirmation.required && !await channel.confirm(ctx, formatWritePreview(account, frozen.map(s => ({ name: s.name, ...s.binding })), skipped), signal,
      { title: 'Bangumi 整批修改预览', confirmLabel: `确认执行全部${frozen.length - skipped}项修改` })) throw new AppError('CANCELLED', '用户取消整批授权，未提交修改。');
    await assertReady(ctx, input, accountId, signal);
    const actual = await canonicalView(baseline.keys(), accountId, signal);
    if (!sameBaseline(actual, baseline)) throw new AppError('STALE_PREVIEW', '确认期间网站现状改变，旧计划未提交，请重新核对完整范围。');
    checkInput(input);
    const token = {};
    permits.set(token, { input: { ...input }, accountId, ctx, steps: frozen, next: 0, indexes: new Map() });
    return token;
  }
  async function executeApproved(token: object, signal: AbortSignal | undefined, toolCallId: string): Promise<AgentToolResult<unknown>> {
    const permit = permits.get(token);
    if (!permit || permit.next >= permit.steps.length) throw new AppError('AUTHORIZATION_REQUIRED', '整批授权已失效或已使用完毕。');
    const step = permit.steps[permit.next++]!;
    const binding = resolved(step.binding, permit.indexes);
    const outcome = await execute(step.name, binding.args, signal, permit.ctx, toolCallId, { input: permit.input, accountId: permit.accountId, binding });
    const value = record(record(outcome.details).value);
    if (value.state === 'success' && step.createdIndex !== undefined) permit.indexes.set(step.createdIndex, positive(record(value.submission).createdId));
    if (value.state === 'success' && isEpisodeWrite(step.name)) {
      const progress = record(value.verification).parentProgress;
      if (progress) {
        const observed = record(progress); const subjectId = Number(observed.subjectId); const epStatus = Number(observed.actual);
        // 仅承接已成功核实的派生进度，不替换已冻结的目标、显式参数或受保护字段。
        for (const later of permit.steps.slice(permit.next)) {
          const b = later.binding; const key = `collection:${subjectId}`;
          if (b.baseline?.has(key)) b.baseline.set(key, { ...record(b.baseline.get(key)), ep_status: epStatus });
          if (isEpisodeWrite(later.name) && b.target.subjectId === subjectId) {
            for (const snapshot of [record(b.before), record(b.after)]) snapshot.parentCollection = { ...record(snapshot.parentCollection), ep_status: epStatus };
          } else if (later.name === 'update_subject_collection' && b.target.id === subjectId) {
            if (b.before !== null) b.before = { ...record(b.before), ep_status: epStatus };
            if (!Object.hasOwn(b.args, 'ep_status')) b.after = { ...record(b.after), ep_status: epStatus };
          }
          if (b.guard.prepared?.collection?.subjectId === subjectId) b.guard.prepared.collection.chapters = epStatus;
        }
      }
    }
    if (!['success', 'unchanged'].includes(String(value.state))) permits.delete(token);
    return outcome;
  }
  const write: McpWriteHandler = (name, args, signal, ctx, toolCallId) => execute(name, args, signal, ctx, toolCallId);
  return { write, prepare, read, authorize, executeApproved, assertReady, revoke: (token: object) => permits.delete(token), getInput };
}

export type WriteBoundary = ReturnType<typeof createWriteBoundary>;
/** 单项入口保持原公开签名，整批授权只由宿主批量工具持有。 */
export function createWriteHandler(client: McpCallClient, getInput: () => WriteInput, onRecord?: (record: unknown) => void): McpWriteHandler {
  return createWriteBoundary(client, getInput, onRecord).write;
}
