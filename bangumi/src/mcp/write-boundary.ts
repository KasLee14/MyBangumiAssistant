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
import { confirmWrite } from './confirm.js';

type State = 'success' | 'failed' | 'unknown' | 'unchanged';
interface Binding {
  target: Data;
  before: unknown;
  after: unknown;
  guard: McpWriteGuard;
  args: Data;
  effects: string[];
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
function submissionArguments(name: string, raw: Data): Data {
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
export function createWriteHandler(
  client: McpCallClient,
  getInput: () => { text: string; generation: number },
  onRecord?: (record: unknown) => void,
): McpWriteHandler {
  let generation: number | undefined;
  const completed = new Map<string, AgentToolResult<unknown>>();
  let unknownWrite = false;

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
      if (all.length === total) return all;
    }
    throw new AppError('INCOMPLETE_DATA', '目录关系超过完整读取上限。');
  }

  async function bind(name: string, original: Data, accountId: number, signal?: AbortSignal): Promise<Binding> {
    const args = structuredClone(original);
    const guard: McpWriteGuard = { accountId };
    if (name === 'update_subject_collection') {
      const id = positive(args.subject_id); const info = await subject(id, signal);
      const before = await subjectCollection(id, accountId, signal);
      if (before === null && args.collection_type === undefined) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先明确收藏状态。');
      const after: Data = before === null ? { collection_type: args.collection_type, rating: 0, comment: '', tags: [], private: false, ep_status: 0, vol_status: 0 } : structuredClone(before);
      for (const key of Object.keys(after)) if (Object.hasOwn(args, key)) after[key] = key === 'tags' ? [...args.tags as string[]].sort() : args[key];
      const progress = Object.hasOwn(args, 'ep_status') || Object.hasOwn(args, 'vol_status');
      if (progress) {
        if (info.subjectType !== 1 || before === null) throw new AppError('UNSUPPORTED_PROGRESS', '章数/卷数修改要求书籍已经收藏，请分别完成收藏与进度修改。');
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
      const ids = name === 'update_single_episode_collection' ? [positive(args.episode_id)] : args.episode_ids as number[];
      const before: Data[] = [];
      let parent = name === 'update_episode_collection' ? positive(args.subject_id) : undefined;
      for (const id of ids) {
        const current = episode(await read('get_single_episode_collection', { episode_id: id }, signal), id, accountId, parent);
        parent ??= positive(current.subject_id); before.push(current);
      }
      const info = await subject(parent!, signal); const current = await subjectCollection(parent!, accountId, signal);
      if (![2, 6].includes(Number(info.subjectType))) throw new AppError('UNSUPPORTED_PROGRESS', '单集状态只支持动画和三次元。');
      if (current === null) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先通过收藏工具确认创建，再修改章节。');
      guard.subjectId = parent!;
      guard.prepared = { type: media[Number(info.subjectType)]!, collection: {
        subjectId: parent!, status: Number(current.collection_type), rate: Number(current.rating), comment: String(current.comment), tags: current.tags as string[], private: current.private as boolean, chapters: Number(current.ep_status), volumes: Number(current.vol_status),
      }, episodes: before.map(row => ({ id: Number(row.episode_id), type: Number(row.episode_type), status: Number(row.collection_type) })) };
      const after = { episodes: before.map(row => ({ ...row, collection_type: args.collection_type })), parentCollection: current };
      return { target: { kind: 'episodes', subjectId: parent, name: info.nameCn ?? info.name, episodeIds: ids }, before: { episodes: before, parentCollection: current }, after, args, guard,
        effects: [current.collection_type !== 3 ? '该作品不在在看状态，本次仍仅修改以下明确章节。' : '仅修改以下章节，不联动其他章节或整部作品收藏状态。'],
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
      return { target: { kind, id, name: info.name }, before: await load(signal), after: { collected: name.startsWith('collect_') }, args, guard, effects: ['只修改该实体的收藏状态。'], readback: (_receipt, active) => load(active) };
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
    const id = positive(args.index_id); const current = await indexSnapshot(id, accountId, signal);
    if (name === 'collect_index' || name === 'uncollect_index') {
      return { target: { kind: 'index', id, title: current.title }, before: { collected: current.collected }, after: { collected: name === 'collect_index' }, args, guard,
        effects: ['仅修改目录收藏状态，不修改目录内容。'], readback: async (_receipt, active) => ({ collected: (await indexSnapshot(id, accountId, active)).collected }) };
    }
    if (current.ownerId !== accountId) throw new AppError('PERMISSION_DENIED', '只能修改当前账户拥有的目录。');
    if (name === 'update_index') {
      const before = { title: current.title, description: current.description, private: current.private };
      const after: Data = { ...before };
      for (const key of Object.keys(after)) if (Object.hasOwn(args, key)) after[key] = args[key];
      return { target: { kind: 'index', id }, before, after, args, guard, effects: ['保留未修改的目录标题、介绍与私密设置。'],
        readback: async (_receipt, active) => {
          const actual = await indexSnapshot(id, accountId, active);
          if (actual.ownerId !== accountId) throw new AppError('ACCOUNT_CHANGED', '目录所有者已改变。');
          return { title: actual.title, description: actual.description, private: actual.private };
        } };
    }
    if (!['add_subject_to_index', 'update_index_subject', 'remove_subject_from_index'].includes(name)) throw new AppError('UNKNOWN_TOOL', '写入工具没有固定宿主映射。');
    const sid = positive(args.subject_id); const info = await subject(sid, signal);
    const relations = await indexSubjects(id, accountId, signal); const row = relations.find(row => row.subject_id === sid);
    const before = row ? { subject_id: sid, comment: row.comment, order: row.order } : null;
    let after: Data | null;
    if (name === 'add_subject_to_index') {
      if (row) return { target: { kind: 'indexSubject', indexId: id, subjectId: sid }, before, after: before, args, guard, effects: [], readback: async () => before };
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

  return async (name, raw, signal, ctx, toolCallId) => {
    const input = { ...getInput() };
    if (generation !== input.generation) { generation = input.generation; completed.clear(); unknownWrite = false; }
    let fingerprint: string | undefined; let attempted = false; let binding: Binding | undefined; let accountId: number | undefined;
    try {
      const args = submissionArguments(name, validateToolArguments(name, raw));
      if (findToolDefinition(name).effect !== 'write') throw new AppError('INVALID_INPUT', '写入边界只接受固定写工具。');
      if (!input.text.trim()) throw new AppError('AUTHORIZATION_REQUIRED', '没有真实本轮用户输入，不能从恢复历史或模型输出取得修改授权。');
      signal?.throwIfAborted();
      accountId = positive(record(await read('get_current_user', {}, signal)).id);
      fingerprint = createHash('sha256').update(JSON.stringify(stable({ accountId, name, args }))).digest('hex');
      const previous = completed.get(fingerprint);
      if (previous) return previous;
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
      binding = await bind(name, args, accountId, signal);
      const base = { tool: name, accountId, target: binding.target, before: binding.before, after: binding.after };
      if (equal(binding.before, binding.after)) {
        const unchanged = result({ ...base, state: 'unchanged', networkAttempted: false }); completed.set(fingerprint, unchanged); return unchanged;
      }
      if (ctx.mode !== 'tui' || !ctx.hasUI) throw new AppError('AUTHORIZATION_REQUIRED', '每次写入需要本地 Pi 完整预览确认；非交互模式不提交修改。');
      const preview = JSON.stringify({ accountId, tool: name, target: binding.target, before: binding.before, after: binding.after, effects: binding.effects }, null, 2);
      const accepted = await confirmWrite(ctx, preview, signal);
      signal?.throwIfAborted();
      if (!accepted) throw new AppError('CANCELLED', '用户取消，未提交修改。');
      const latest = getInput();
      if (latest.generation !== input.generation || latest.text !== input.text) throw new AppError('STALE_PREVIEW', '用户输入已改变，旧预览不能授权新操作。');
      if (positive(record(await read('get_current_user', {}, signal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '确认期间账户改变，旧预览不能授权新账户。');
      const refreshed = await bind(name, args, accountId, signal);
      if (!equal(refreshed.before, binding.before) || !equal(refreshed.after, binding.after) || !equal(refreshed.args, binding.args) || !equal(refreshed.target, binding.target)) throw new AppError('STALE_PREVIEW', '确认期间网站现状改变，请重新生成具体预览。');
      binding = refreshed;
      signal?.throwIfAborted();
      const finalInput = getInput();
      if (finalInput.generation !== input.generation || finalInput.text !== input.text) throw new AppError('STALE_PREVIEW', '核对期间用户输入改变，未提交旧预览。');
      if (!onRecord) throw new AppError('WRITE_RECORD_REQUIRED', '未连接Pi提交事实记录，不能安全提交可恢复会话中的修改。');
      onRecord({ kind: 'bangumi-write', phase: 'started', fingerprint, generation: input.generation, tool: name, toolCallId, accountId, target: binding.target, args: binding.args });
      attempted = true;
      let receipt: SubmissionReceipt | undefined; let submissionError: unknown;
      try {
        const submitted = await client.call(name, binding.args, signal, binding.guard);
        const definition = findToolDefinition(name);
        checkOutput(definition.outputSchema!, { value: submitted });
        checkSubmission(name, submitted, binding.args, accountId, binding.guard.subjectId);
        receipt = submitted as SubmissionReceipt;
      } catch (error) {
        submissionError = error;
        if (error instanceof SubmissionError) {
          try {
            checkOutput(findToolDefinition(name).outputSchema!, { error: safeError(error) });
            checkSubmission(name, error.submission, binding.args, accountId, binding.guard.subjectId);
            receipt = error.submission;
          } catch {}
        }
      }
      let state: State = receipt?.submissionState === 'not_attempted' ? 'failed' : 'unknown'; let actual: unknown; let verificationError: unknown;
      // 独立生命周期；模型工具取消不会取消已提交操作的回读，不自动重试写入。
      try {
        const verificationSignal = AbortSignal.timeout(60000);
        if (positive(record(await read('get_current_user', {}, verificationSignal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '回读前账户已改变，不能验证原账户写入。');
        actual = await binding.readback(receipt, verificationSignal);
        if (positive(record(await read('get_current_user', {}, verificationSignal)).id) !== accountId) throw new AppError('ACCOUNT_CHANGED', '回读后账户已改变，不能报告原账户写入成功。');
        if (equal(actual, binding.after)) state = 'success';
        else if (receipt?.submissionState === 'acknowledged' || receipt?.submissionState === 'not_attempted') state = 'failed';
      } catch (error) { verificationError = error; }
      if (state === 'unknown') unknownWrite = true;
      const outcome = { ...base, state, networkAttempted: true, ...(actual === undefined ? {} : { actual }),
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
}
