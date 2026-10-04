import { createHash, randomUUID } from 'node:crypto';
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
import { formatWritePreview } from './write-preview.js';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { confirmationForPlan, type ConfirmationDecision } from './confirmation-policy.js';
import { isEpisodeWrite, verifyWrittenState, type ReadbackVerification } from './write-verification.js';
import { isWatchedUntil, MAX_PROGRESS_EPISODES, watchedUntilIds } from './episode-progress.js';
import type { TraceHost } from '../tracing/schema.js';
import type { McpBatchScope } from './batch-context.js';
import { SubmissionTracker } from './submission.js';
import { allowedWriteSnapshot, definiteWriteRejection, latestWriteFacts, matchesWriteViewValue, pendingWriteFact, recoveryTool, submittedWriteTarget, writeConflictKeys, writeFactIdentity, WRITE_RECOVERY_KINDS } from './write-recovery.js';
import type { WriteFactStore } from './write-journal.js';
import { writeRateRequests, type WriteRateLimiter, type WriteRateWait } from './write-rate-limit.js';
import { splitWriteStages, mergeStageSubmission } from './write-stages.js';
import { isBatchFatal, batchEffectKeys, batchDependencyKeys } from './batch-policy.js';

type State = 'success' | 'failed' | 'unknown' | 'unchanged';
export interface Binding {
  target: Data;
  before: unknown;
  after: unknown;
  guard: McpWriteGuard;
  args: Data;
  effects: string[];
  baseline?: Map<string, unknown> | undefined;
  preflightSkipped?: Data[];
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
function visibleWriteValue(value: Data): Data {
  const result = { ...value };
  for (const key of ['baselineBefore', 'expected', 'protectedExpected', 'pendingEffects', 'submittedArgs']) delete result[key];
  if (result.submissionInferred === true) delete result.submission;
  delete result.submissionInferred;
  return result;
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
export interface WriteInput { text: string; generation: number; requestId?: string }
export interface WriteBoundaryOptions { journal?: WriteFactStore; limiter?: WriteRateLimiter; resetClient?: () => Promise<void> }
interface RecoveryPlanItem { tool: string; args: Data; target?: Data; stepId?: number }
export interface PlannedWrite { name: string; binding: Binding; createdIndex?: number; stepId?: number; dependsOn?: number[] }
interface PendingEffect { key: string; before: unknown; after: unknown; operationId: string; relationSubjectId?: number }
interface SubmittedStage { binding: Binding; value: Data; operationId: string; stage: number }
interface SubmittedOperation { step: PlannedWrite; binding: Binding; value: Data; fingerprint: string; toolCallId: string; stages: SubmittedStage[] }
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
  next: number; indexes: Map<number, number>; stopped?: boolean;
  expected: Map<string, unknown>; submitted: SubmittedOperation[];
  uncertainBefore?: Map<string, unknown>;
  outcomes: Map<number, Data>; blockedDomains: Map<string, Data>; pendingEffects: Map<string, PendingEffect>;
  requestId: string; batchId: string; account: Data;
}
export function createWriteBoundary(
  client: McpCallClient,
  getInput: () => WriteInput,
  onRecord?: (record: unknown) => void,
  channel: InteractionChannel = createTerminalChannel(),
  trace?: TraceHost,
  options: WriteBoundaryOptions = {},
) {
  let generation: number | undefined;
  const completed = new Map<string, AgentToolResult<unknown>>();
  let unknownWrite = false;
  let submittedGeneration: number | undefined;
  const permits = new WeakMap<object, Permit>();
  let batch: McpBatchScope | undefined;
  const subjectCache = new Map<number, Data>();
  const localFacts: Data[] = [];
  let factSequence = 0;
  let requestGeneration: number | undefined; let localRequestId = randomUUID();
  let recoveryIssues: Data[] = [];
  let recoveryBlockedSteps: number[] = [];
  let recoveryTargets: Data[] = [];
  let recoveryRequestId: string | undefined;
  function requestId(input: WriteInput): string {
    if (input.requestId) return input.requestId;
    if (requestGeneration !== input.generation) { requestGeneration = input.generation; localRequestId = randomUUID(); }
    return localRequestId;
  }
  function recordWrite(fact: Data): void {
    const sequence = ++factSequence;
    // 恢复只是给旧保护快照追加核实事实，不能把旧scope冒充为后续执行快照。
    const scopeSequence = fact.scopeSequence ?? (fact.phase === 'reconciled' ? fact.recordSequence : sequence);
    const stamped = { ...fact, schemaVersion: 2, recordSequence: sequence,
      ...(Array.isArray(fact.protectedExpected) ? { scopeSequence } : {}), recordedAt: new Date().toISOString() };
    options.journal?.append(stamped);
    localFacts.push(structuredClone(stamped));
    onRecord?.(stamped);
  }
  function allWriteFacts(ctx: ExtensionToolContext): Data[] {
    const facts: Data[] = [];
    const calls = new Map<string, string>();
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== 'custom' || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) continue;
      const value = entry.data as Data;
      if (entry.customType === 'bangumi/batch' && typeof value.fingerprint === 'string' && typeof value.toolCallId === 'string') calls.set(value.fingerprint, value.toolCallId);
      if (entry.customType === 'bangumi/write' && value.kind !== 'bangumi-batch') facts.push({ kind: 'bangumi-write', recordedAt: entry.timestamp, ...value });
      else if (entry.customType === 'bangumi/batch' && Array.isArray(value.items)) {
        value.items.forEach((raw, i) => {
          const item = record(raw); if (!item.tool) return;
          // 新版父项只是展示聚合；可恢复事实由独立子阶段持久化，不能复活父项未知。
          if (Array.isArray(item.stageResults)) return;
          const parentCall = typeof value.toolCallId === 'string' ? value.toolCallId : calls.get(String(value.fingerprint));
          if (parentCall) facts.push({ kind: 'bangumi-write', accountId: value.accountId, toolCallId: `${parentCall}/${i + 1}`, ...item });
        });
      }
    }
    if (!options.journal) return [...facts, ...localFacts];
    const journal = options.journal.entries().filter(f => f.kind === 'bangumi-write');
    const recorded = new Set(journal.map(writeFactIdentity));
    // 共享账本为权威；另一个聊天已结案的结果不能被本边界旧缓存复活。
    return [...facts.filter(f => !recorded.has(writeFactIdentity(f))), ...journal];
  }
  function recordedRequest(ctx: ExtensionToolContext, input: WriteInput): Data | undefined {
    const id = requestId(input); let prior: Data | undefined;
    const facts = ctx.sessionManager.getEntries().filter(entry => entry.type === 'custom' && (entry.customType === 'bangumi/batch' || entry.customType === 'bangumi/write'))
      .map(entry => record((entry as unknown as Data).data));
    for (const fact of [...facts, ...options.journal?.entries() ?? []]) {
      if (fact.requestId === id && (fact.writeNetworkAttempted === true || ['started', 'progress', 'submission'].includes(String(fact.phase)))) prior = fact;
    }
    return prior;
  }
  function planRecord(token: object): Data {
    const permit = permits.get(token); if (!permit) throw new AppError('AUTHORIZATION_REQUIRED', '写入计划已失效。');
    return { schemaVersion: 2, requestId: permit.requestId, batchId: permit.batchId, count: permit.steps.length,
      operations: permit.steps.map(step => ({ step: step.stepId, dependsOn: step.dependsOn ?? [], tool: step.name, args: step.binding.args, target: step.binding.target, before: step.binding.before,
        after: step.binding.after, baseline: [...step.binding.baseline ?? []], ...(step.createdIndex === undefined ? {} : { createdIndex: step.createdIndex }) })) };
  }

  function checkInput(expected: WriteInput): void {
    const current = getInput();
    if (!expected.text.trim() || current.generation !== expected.generation || current.text !== expected.text) throw new AppError('STALE_PREVIEW', '用户输入已改变或没有本轮输入，未提交旧预览。');
  }

  async function read(name: string, raw: Data, signal?: AbortSignal): Promise<unknown> {
    const args = validateToolArguments(name, raw);
    const value = await client.call(name, args, signal, undefined, batch);
    const definition = findToolDefinition(name);
    if (definition.outputSchema) {
      checkOutput(definition.outputSchema, { value });
      checkSubjectResponse(name, value, args);
      if (resourceOutputSchema(name)) checkResourceResponse(name, value, args, definition.outputSchema);
    }
    return value;
  }

  async function subject(id: number, signal?: AbortSignal): Promise<Data> {
    if (batch?.phase === 'prepare' && subjectCache.has(id)) return structuredClone(subjectCache.get(id)!);
    const value = record(await read('get_subject_details', { subject_id: id, include: [] }, signal));
    if (batch?.phase === 'prepare') subjectCache.set(id, structuredClone(value));
    return value;
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
    let args = structuredClone(original);
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
      return { target: { kind: 'subject', id, name: info.nameCn ?? info.name, subjectType: info.subjectType }, before, after, args, guard,
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
      const preflightSkipped: Data[] = [];
      let parent = name === 'update_episode_collection' ? positive(args.subject_id) : undefined;
      for (const [ordinal, id] of ids.entries()) {
        try {
          const current = await load(`episode:${id}`, async () => episode(await read('get_single_episode_collection', { episode_id: id }, signal), id, accountId, parent));
          if (parent !== undefined && current.subject_id !== parent) throw new AppError('INVALID_RESPONSE', '章节与原操作对象不一致。');
          parent ??= positive(current.subject_id); before.push(current);
        } catch (error) {
          if (name !== 'update_episode_collection' || isBatchFatal(error, 'preflight')) throw error;
          preflightSkipped.push({ stage: ordinal + 1, episodeId: id, target: { kind: 'episode', id, subjectId: parent }, state: 'skipped', phase: 'preflight',
            networkAttempted: false, writeNetworkAttempted: false, error: safeError(error) });
        }
      }
      if (name === 'update_episode_collection' && preflightSkipped.length) args = { ...args, episode_ids: before.map(row => Number(row.episode_id)) };
      const info = await subject(parent!, signal); const current = await load(`collection:${parent}`, () => subjectCollection(parent!, accountId, signal));
      if (![2, 6].includes(Number(info.subjectType))) throw new AppError('UNSUPPORTED_PROGRESS', '单集状态只支持动画和三次元。');
      if (current === null) throw new AppError('COLLECTION_REQUIRED', '作品尚未收藏，请先通过收藏工具确认创建，再修改章节。');
      guard.subjectId = parent!;
      guard.prepared = { type: media[Number(info.subjectType)]!, collection: {
        subjectId: parent!, status: Number(current.collection_type), rate: Number(current.rating), comment: String(current.comment), tags: current.tags as string[], private: current.private as boolean, chapters: Number(current.ep_status), volumes: Number(current.vol_status),
      }, episodes: before.map(row => ({ id: Number(row.episode_id), type: Number(row.episode_type), status: Number(row.collection_type) })) };
      const after = { episodes: before.map(row => ({ ...row, collection_type: args.collection_type })), parentCollection: current };
      return { target: { kind: 'episodes', subjectId: parent, name: info.nameCn ?? info.name, episodeIds: before.map(row => Number(row.episode_id)) }, before: { episodes: before, parentCollection: current }, after, args, guard,
        ...(preflightSkipped.length ? { preflightSkipped } : {}),
        effects: [current.collection_type !== 3 ? '该作品不在在看状态，本次仍仅修改以下明确章节。' : '仅修改以下章节，不联动其他章节或整部作品收藏状态。',
          '网站可能同步更新已看集数汇总；回读会核实目标章节及父收藏其他字段，并单列实际汇总进度。'],
        readback: async (_receipt, active) => {
          const rows: Data[] = [];
          for (const row of before) { const id = Number(row.episode_id); rows.push(episode(await read('get_single_episode_collection', { episode_id: id }, active), id, accountId, parent)); }
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
    const task = async () => {
      const baseline = new Map<string, unknown>();
      // 失败条目不得把部分读取或预测现状泄漏给后续条目。
      const candidate = view ? structuredClone(view) : undefined;
      const value = await bind(name, args, accountId, signal, candidate, baseline);
      if (view && candidate) { view.clear(); for (const [key, snapshot] of candidate) view.set(key, snapshot); }
      return { ...value, baseline };
    };
    return trace ? trace.phase('preflight', task, { tool_name: name, account_id: accountId }) : task();
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
  async function observedView(keys: Iterable<string>, accountId: number, signal?: AbortSignal): Promise<{ observed: Map<string, unknown>; errors: Map<string, unknown> }> {
    const requested = new Set(keys), observed = new Map<string, unknown>(), errors = new Map<string, unknown>();
    for (const key of requested) if (key.startsWith('episodeScope:')) {
      try {
        const rows = await allEpisodeStates(Number(key.split(':')[1]), accountId, signal);
        observed.set(key, episodeScope(rows));
        for (const row of rows) if (requested.has(`episode:${row.id}`)) observed.set(`episode:${row.id}`, row.state);
      } catch (error) { if (isBatchFatal(error, 'verification')) throw error; errors.set(key, error); }
    }
    for (const key of requested) if (!observed.has(key) && !errors.has(key)) {
      try { observed.set(key, await canonical(key, accountId, signal)); }
      catch (error) { if (isBatchFatal(error, 'verification')) throw error; errors.set(key, error); }
    }
    return { observed, errors };
  }
  function allowedView(actual: Map<string, unknown>, before: Map<string, unknown>, after: Map<string, unknown>): boolean {
    return actual.size === after.size && [...after].every(([key, expected]) => {
      let current = actual.get(key);
      if (key.startsWith('relations:') && Array.isArray(expected) && Array.isArray(current)) {
        current = current.map(value => {
          const row = record(value);
          return expected.some(v => record(v).subject_id === row.subject_id && record(v).relationId === null) ? { ...row, relationId: null } : row;
        });
      }
      return allowedWriteSnapshot(before.get(key), expected, current);
    });
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
  async function recoveryActual(name: string, fact: Data, accountId: number, signal: AbortSignal, input: WriteInput, hints: readonly number[]): Promise<{ actual: unknown; target: Data }> {
    const args = record(fact.args); const target = record(fact.target);
    if (name === 'update_subject_collection') return { actual: await subjectCollection(positive(args.subject_id), accountId, signal), target };
    if (isEpisodeWrite(name)) {
      const after = record(fact.after);
      const expectedEpisodes = after.episodes as Data[] | undefined;
      if (!expectedEpisodes?.length) throw new AppError('WRITE_RECOVERY_METADATA_REQUIRED', '旧章节修改缺少完整原始范围，不能从当前现状猜测原授权。');
      const parent = positive(target.subjectId ?? record(expectedEpisodes[0]).subject_id);
      const episodes: Data[] = [];
      for (const ep of expectedEpisodes) episodes.push(episode(await read('get_single_episode_collection', { episode_id: positive(ep.episode_id) }, signal), positive(ep.episode_id), accountId, parent));
      const protectedEpisodes: Data[] = [];
      for (const ep of after.protectedEpisodes as Data[] ?? []) protectedEpisodes.push(episode(await read('get_single_episode_collection', { episode_id: positive(ep.episode_id) }, signal), positive(ep.episode_id), accountId, parent));
      return { actual: { episodes, parentCollection: await subjectCollection(parent, accountId, signal),
        ...(after.protectedEpisodes ? { protectedEpisodes } : {}) }, target };
    }
    if (/^(collect|uncollect)_(character|person)$/.test(name)) {
      const kind = name.endsWith('_character') ? 'character' : 'person'; const id = positive(args[`${kind}_id`]);
      return { actual: { collected: entityCollected(await read(`get_user_${kind}_collection`, { username: '-', [`${kind}_id`]: id }, signal), kind, id, accountId) }, target };
    }
    let id = name === 'create_index' ? Number(record(fact.submission ?? {}).createdId ?? fact.createdId) : Number(args.index_id);
    if (name === 'create_index' && !(Number.isSafeInteger(id) && id > 0)) {
      // 新计划里的 ID 不是人类选择证据；只采用本轮真实输入中明确给出的 ID。
      const explicit = hints.filter(candidate => new RegExp(`(?:index/|\\b)${candidate}(?:\\b|/)`).test(input.text));
      if (explicit.length !== 1) throw new AppError('UNVERIFIABLE_CREATE', '创建响应丢失且真实目录ID未知；请提供已创建目录的链接或ID，核实后继续，不会再次创建。');
      id = explicit[0]!;
    }
    const snapshot = await indexSnapshot(positive(id), accountId, signal);
    if (name === 'create_index' || name === 'update_index' || WRITE_RECOVERY_KINDS[name] === 'relation') {
      if (snapshot.ownerId !== accountId) throw new AppError('ACCOUNT_CHANGED', '恢复目标目录不属于原修改账户。');
    }
    if (WRITE_RECOVERY_KINDS[name] === 'relation') {
      const relation = (await indexSubjects(id, accountId, signal)).find(row => row.subject_id === args.subject_id);
      return { actual: relation ? { subject_id: relation.subject_id, comment: relation.comment, order: relation.order } : null, target };
    }
    const actual = name === 'collect_index' || name === 'uncollect_index' ? { collected: snapshot.collected }
      : { title: snapshot.title, description: snapshot.description, private: snapshot.private };
    return { actual, target: name === 'create_index' ? { kind: 'index', id } : target };
  }
  async function reconcile(ctx: ExtensionToolContext, input: WriteInput, accountId: number, signal?: AbortSignal, hints: readonly number[] = [], planned?: readonly RecoveryPlanItem[]): Promise<void> {
    recoveryIssues = [];
    recoveryBlockedSteps = [];
    const currentRequestId = requestId(input);
    if (recoveryRequestId !== currentRequestId) { recoveryRequestId = currentRequestId; recoveryTargets = []; }
    const facts = latestWriteFacts(allWriteFacts(ctx), accountId);
    for (const fact of facts) if (fact.tool === 'create_index' && fact.phase === 'reconciled' && fact.reconciledForRequestId === currentRequestId && fact.state === 'success') {
      const id = record(fact.target).id;
      if (!recoveryTargets.some(target => target.indexId === id)) recoveryTargets.push({ tool: fact.tool, indexId: id, args: fact.args, actual: fact.actual });
    }
    const pending = facts.filter(pendingWriteFact);
    if (!pending.length) return;
    const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
    const requested = new Map<number, string[]>();
    for (const [index, item] of (planned ?? []).entries()) {
      let target = item.target;
      if (item.tool === 'update_single_episode_collection' && !target?.subjectId) {
        try {
          const state = episodeStateData(await read('get_single_episode_collection', { episode_id: item.args.episode_id }, active), accountId);
          target = { subjectId: state.subject_id };
        } catch (error) {
          if (isBatchFatal(error, 'preflight')) throw error;
          const step = item.stepId ?? index + 1;
          recoveryBlockedSteps.push(step);
          recoveryIssues.push({ tool: item.tool, blocksPlan: true, blockedSteps: [step], error: safeError(error) });
          requested.set(step, [`episode:${item.args.episode_id}`]);
          continue;
        }
      }
      requested.set(item.stepId ?? index + 1, writeConflictKeys(item.tool, item.args, target));
    }
    for (const fact of pending) {
      let conflictKeys: string[];
      try {
        const saved = record(fact.target);
        const episodes = record(fact.after ?? {}).episodes as Data[] | undefined;
        const target = { ...saved, ...(saved.subjectId === undefined && episodes?.[0]?.subject_id ? { subjectId: episodes[0].subject_id } : {}),
          ...(record(fact.submission ?? {}).createdId ? { id: record(fact.submission).createdId } : {}) };
        conflictKeys = writeConflictKeys(recoveryTool(fact), record(fact.args), target);
      } catch { conflictKeys = ['account']; }
      const blockedSteps = [...requested].filter(([, keys]) => conflictKeys.includes('account') || keys.includes('account') || conflictKeys.some(key => keys.includes(key)
        || key === 'index:*' && keys.some(requested => requested.startsWith('index:')))).map(([step]) => step);
      const blocksPlan = planned === undefined || blockedSteps.length > 0;
      // 无关联的旧目标留在账本中，不阻塞本计划，也不为它无谓等待网络恢复。
      if (!blocksPlan) continue;
      try {
        const name = recoveryTool(fact);
        const { actual, target } = await recoveryActual(name, fact, accountId, active, input, hints);
        const viewer = record(await read('get_current_user', {}, active));
        if (viewer.id !== accountId) throw new AppError('ACCOUNT_CHANGED', '恢复核实期间账户改变。');
        let before = fact.before, after = fact.after;
        if (!Object.hasOwn(fact, 'after')) {
          if (name === 'create_index') after = { title: record(fact.args).title, description: record(fact.args).description, private: record(fact.args).private ?? false };
          else throw new AppError('WRITE_RECOVERY_METADATA_REQUIRED', '旧执行记录缺少目标及保护字段基线，不能把当前状态当成原授权。');
        }
        const verification = verifyWrittenState(name, before, after, actual, target);
        const submittedTarget = submittedWriteTarget(name, { ...fact, before, after });
        const submittedVerification = verifyWrittenState(name, before, submittedTarget, actual, target);
        // 阶段记录保留完整中间视图；恢复时也核实范围外字段。
        let groupProtected = false;
        if (Array.isArray(fact.protectedExpected) && Array.isArray(fact.pendingEffects)) {
          // 同批已登记的后续阶段也属于冻结授权；按保护key合并最后事实，不能把
          // 另一合法目录作品/章节的已投递变化误认成范围外修改，也不从现状补造授权。
          const siblings = fact.batchId ? facts.filter(candidate => candidate.batchId === fact.batchId && candidate.requestId === fact.requestId
            && candidate.accountId === fact.accountId && Array.isArray(candidate.protectedExpected) && Array.isArray(candidate.pendingEffects)) : [fact];
          const ordered = siblings.sort((a, b) => Number(a.scopeSequence ?? a.recordSequence ?? 0) - Number(b.scopeSequence ?? b.recordSequence ?? 0)
            || String(a.recordedAt ?? '').localeCompare(String(b.recordedAt ?? '')) || Number(a.stage ?? 0) - Number(b.stage ?? 0));
          const originalKeys = new Set((fact.protectedExpected as [string, unknown][]).map(([key]) => key));
          for (const effect of fact.pendingEffects as Data[]) originalKeys.add(String(effect.key));
          const expected = new Map<string, unknown>(), pending: Data[] = [];
          for (const key of originalKeys) {
            const latestScope = ordered.filter(candidate => (candidate.protectedExpected as [string, unknown][]).some(([candidateKey]) => candidateKey === key)
              || (candidate.pendingEffects as Data[]).some(effect => effect.key === key)).at(-1) ?? fact;
            expected.set(key, new Map(latestScope.protectedExpected as [string, unknown][]).get(key) ?? null);
            pending.push(...(latestScope.pendingEffects as Data[]).filter(effect => effect.key === key));
          }
          for (const effect of pending) if (!expected.has(String(effect.key))) expected.set(String(effect.key), null);
          const observed = await canonicalView(expected.keys(), accountId, active);
          if (isEpisodeWrite(name)) {
            const key = `collection:${target.subjectId}`, current = observed.get(key);
            if (current && expected.get(key)) expected.set(key, { ...record(expected.get(key)), ep_status: record(current).ep_status });
          }
          if (![...expected].every(([key, value]) => matchesWriteViewValue(key, value, observed.get(key), pending))) {
            throw new AppError('UNEXPECTED_CHANGE', '恢复核实发现请求范围或其他保护字段改变，不能自动结案。');
          }
          groupProtected = true;
        } else if (Array.isArray(fact.baselineBefore) && Array.isArray(fact.expected)) {
          const old = new Map(fact.baselineBefore as [string, unknown][]), expected = new Map(fact.expected as [string, unknown][]);
          const observed = await canonicalView(expected.keys(), accountId, active);
          for (const key of expected.keys()) {
            if (isEpisodeWrite(name) && key === `collection:${target.subjectId}`) {
              const current = observed.get(key);
              if (current && expected.get(key)) expected.set(key, { ...record(expected.get(key)), ep_status: record(current).ep_status });
              if (current && old.get(key)) old.set(key, { ...record(old.get(key)), ep_status: record(current).ep_status });
            }
          }
          if (!allowedView(observed, old, expected)) throw new AppError('UNEXPECTED_CHANGE', '恢复核实发现范围外字段改变，不能自动结案。');
        }
        let state: State | undefined; let resolution: string | undefined;
        const requestedFields = name === 'update_subject_collection' && actual && after
          ? Object.keys(record(fact.args)).filter(key => Object.hasOwn(record(after), key)) : [];
        const acknowledgedFields = groupProtected && record(fact.submission ?? {}).submissionState === 'acknowledged'
          && requestedFields.length > 0 && requestedFields.every(key => equal(record(actual)[key], record(after)[key]));
        if (verification.requestedStateMatched && verification.protectedFieldsMatched || acknowledgedFields) { state = 'success'; resolution = 'observed_applied'; }
        else if (!equal(after, submittedTarget) && submittedVerification.requestedStateMatched && submittedVerification.protectedFieldsMatched) {
          state = 'failed'; resolution = 'observed_partial';
        }
        else {
          // 老版本未保存固定拒绝码；仅迁移已有完整回读及固定写路由证据的 429。
          const priorVerification = record(fact.verification ?? {});
          const legacyRejected = fact.schemaVersion !== 2 && record(fact.submissionError ?? {}).code === 'BGM_HTTP_429'
            && priorVerification.readbackCompleted === true && priorVerification.protectedFieldsMatched === true;
          const notAttempted = fact.writeNetworkAttempted === false && fact.phase !== 'started';
          if ((definiteWriteRejection(fact) || legacyRejected || notAttempted) && allowedWriteSnapshot(before, after, actual)) {
            state = 'failed'; resolution = notAttempted ? 'not_attempted' : 'observed_not_applied';
          }
        }
        if (!state) throw new AppError('WRITE_RESULT_UNRESOLVED', '已读取当前状态，但原请求投递结果仍不能确定；未重发，需继续核实原对象。');
        recordWrite({ ...fact, kind: 'bangumi-write', operationId: writeFactIdentity(fact), phase: 'reconciled', state, actual, target,
          reconciledForRequestId: currentRequestId,
          attemptedAt: fact.attemptedAt ?? fact.recordedAt,
          ...(viewer.accessContext ? { accessContext: viewer.accessContext } : {}),
          ...(name === 'create_index' ? { createdId: target.id } : {}),
          verification: { ...verification, ...(acknowledgedFields ? { requestedStateMatched: true, protectedFieldsMatched: true, mismatchedFields: [], superseded: true } : {}), state, scope: 'recovery' }, resolution });
        if (name === 'create_index' && state === 'success') recoveryTargets.push({ tool: name, indexId: target.id, args: fact.args, actual });
        trace?.record('write.reconciled', { operationId: writeFactIdentity(fact), tool: name, accountId, state, resolution });
      } catch (error) {
        if (isBatchFatal(error, 'verification')) throw error;
        recoveryBlockedSteps.push(...blockedSteps);
        recoveryIssues.push({ operationId: writeFactIdentity(fact), tool: fact.tool ?? record(fact.submission ?? {}).tool, target: fact.target,
          blocksPlan, blockedSteps,
          ...(record(fact.args ?? {}).index_id ? { indexId: record(fact.args).index_id } : {}), error: safeError(error),
          recoveryTarget: record(fact.args ?? {}).title ? '请提供已创建目录的真实链接或ID。' : '请恢复原账户及网络，独立核实原操作对象。' });
      }
    }
    recoveryBlockedSteps = [...new Set(recoveryBlockedSteps)];
    if (planned === undefined && recoveryIssues.some(issue => issue.blocksPlan)) throw new AppError('PREVIOUS_WRITE_UNKNOWN', '既有修改尚不能安全结案；已执行宿主只读核实，未重发。');
  }
  async function assertReady(ctx: ExtensionToolContext, input: WriteInput, accountId: number, signal?: AbortSignal, hints: readonly number[] = [], planned?: readonly RecoveryPlanItem[]) {
    checkInput(input); signal?.throwIfAborted();
    if (!channel.canConfirm(ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '写入需要本地Pi交互终端或已连接的Web终端；非交互模式不提交。');
    if (!onRecord) throw new AppError('WRITE_RECORD_REQUIRED', '未连接Pi执行事实记录，不能提交批量修改。');
    if (!batch && record(await read('get_current_user', {}, signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '当前账户与计划账户不一致。');
    await reconcile(ctx, input, accountId, signal, hints, planned);
  }
  async function authorize(steps: PlannedWrite[], initial: Map<string, unknown>, input: WriteInput, account: Data, ctx: ExtensionToolContext, signal?: AbortSignal,
    authorization?: { confirmation?: ConfirmationDecision; skipped?: Data[] }): Promise<object> {
    const accountId = positive(account.id);
    const planned = steps.map((step, index) => ({ tool: step.name, args: step.binding.args, target: step.binding.target, stepId: step.stepId ?? index + 1 }));
    await assertReady(ctx, input, accountId, signal, [], planned);
    if (submittedGeneration === input.generation) throw new AppError('WRITE_PLAN_ALREADY_SUBMITTED', '本轮已有写入提交，不能追加另一个计划；请先一次收齐完整范围。');
    // 存储独立副本，确认期间参数或调用者对象变化不能扩大授权。
    const frozen = steps.map((step, index) => ({ ...step, stepId: step.stepId ?? index + 1, dependsOn: [...step.dependsOn ?? []], binding: { ...step.binding,
      target: structuredClone(step.binding.target), args: structuredClone(step.binding.args), guard: structuredClone(step.binding.guard), before: structuredClone(step.binding.before), after: structuredClone(step.binding.after),
      effects: [...step.binding.effects], baseline: structuredClone(step.binding.baseline),
      ...(step.binding.preflightSkipped ? { preflightSkipped: structuredClone(step.binding.preflightSkipped) } : {}) } }));
    const baseline = structuredClone(initial);
    const confirmation = authorization?.confirmation ?? confirmationForPlan(frozen.map(s => ({ name: s.name, args: s.binding.args, before: s.binding.before, after: s.binding.after })));
    trace?.record('confirmation.policy', confirmation);
    if (confirmation.required) {
      const confirm = () => channel.confirm(ctx, formatWritePreview(account, frozen.map(s => ({ name: s.name, stepId: s.stepId, ...s.binding })), authorization?.skipped), signal,
        { title: '操作授权', confirmLabel: '确认授权' });
      if (!await (trace ? trace.phase('confirmation', confirm) : confirm())) throw new AppError('CANCELLED', '用户取消整批授权，未提交修改。');
    }
    await assertReady(ctx, input, accountId, signal, [], planned);
    checkInput(input);
    const token = {};
    const outcomes = new Map<number, Data>(recoveryBlockedSteps.map(step => [step, { step, state: 'blocked', blockedBy: [], reason: '与此项冲突的旧修改仍待核实',
      error: safeError(new AppError('PREVIOUS_WRITE_UNKNOWN', '与此项冲突的旧修改仍待核实，未重发。')), writeNetworkAttempted: false, networkAttempted: false }]));
    permits.set(token, { input: { ...input }, accountId, ctx, steps: frozen, next: 0, indexes: new Map(), expected: baseline, submitted: [], outcomes,
      blockedDomains: new Map(), pendingEffects: new Map(), requestId: requestId(input), batchId: randomUUID(), account: structuredClone(account) });
    return token;
  }
  function relationRowMatches(actual: unknown, expected: unknown): boolean {
    if (actual === null || expected === null) return actual === expected;
    if (!actual || !expected) return false;
    const planned = record(expected), current = record(actual);
    return planned.relationId === null && typeof current.relationId === 'number' && current.relationId > 0
      ? equal({ ...current, relationId: null }, planned) : equal(current, planned);
  }
  /** 共享整表保护按作品核对；未决行只允许原值/目标候选，不能放宽其他行。 */
  function matchesExpected(permit: Permit, key: string, actual: unknown): boolean {
    return matchesWriteViewValue(key, permit.expected.get(key), actual, [...permit.pendingEffects.values()].map(effect => ({ ...effect })));
  }
  function rememberUnknown(permit: Permit, name: string, binding: Binding, operationId: string, createdIndex?: number): void {
    const target = binding.target;
    if (target.kind === 'indexSubject') {
      const key = 'relations:' + target.indexId;
      const original = (permit.expected.get(key) as Data[] | undefined)?.find(row => row.subject_id === target.subjectId) ?? null;
      const after = binding.after === null ? null : { ...record(binding.after), relationId: original?.relationId ?? null };
      permit.pendingEffects.set(key + ':' + target.subjectId, { key, before: structuredClone(original), after: structuredClone(after), operationId, relationSubjectId: Number(target.subjectId) });
      return;
    }
    const projected = structuredClone(permit.expected);
    if (name === 'create_index' && createdIndex === undefined) return;
    advanceWriteView(projected, { name, binding, ...(createdIndex === undefined ? {} : { createdIndex }) }, permit.accountId);
    for (const [key, after] of projected) if (!equal(after, permit.expected.get(key))) {
      permit.pendingEffects.set(key, { key, before: structuredClone(permit.expected.get(key)), after: structuredClone(after), operationId });
    }
  }
  function updateDerivedProgress(permit: Permit, observed: Map<string, unknown>): void {
    for (const item of permit.submitted.filter(item => isEpisodeWrite(item.step.name) && item.value.writeNetworkAttempted)) {
      const key = 'collection:' + item.binding.target.subjectId;
      const expected = permit.expected.get(key), actual = observed.get(key);
      if (expected && actual) permit.expected.set(key, { ...record(expected), ep_status: record(actual).ep_status });
    }
  }
  async function checkpoint(permit: Permit, keys: Iterable<string>, signal?: AbortSignal): Promise<void> {
    const requested = [...new Set(keys)].filter(key => !/:\-\d+$/.test(key) && permit.expected.has(key));
    if (!requested.length) return;
    if (batch?.phase === 'submit') {
      await endBatch();
      const viewer = await beginBatch(signal);
      if (viewer.id !== permit.accountId) throw new AppError('ACCOUNT_CHANGED', '保护核查时账户改变，旧授权已撤销。');
      const original = record(permit.account.accessContext ?? {}), current = record(viewer.accessContext ?? {});
      if (!equal(original.nsfw, current.nsfw) || original.nsfwApplied !== current.nsfwApplied) throw new AppError('NSFW_SCOPE_CHANGED', '保护核查时权限改变，旧授权已撤销。');
    }
    const snapshots = await observedView(requested, permit.accountId, signal);
    updateDerivedProgress(permit, snapshots.observed);
    const failure = requested.map(key => snapshots.errors.get(key)).find(Boolean);
    if (failure) throw failure;
    if (requested.some(key => !snapshots.observed.has(key) || !matchesExpected(permit, key, snapshots.observed.get(key)))) {
      throw new AppError('STALE_PREVIEW', '该对象的现状或保护范围已改变，已阻断关联操作。');
    }
    if (batch) batch = { ...batch, phase: 'submit' };
  }
  async function executeApproved(token: object, signal: AbortSignal | undefined, toolCallId: string, onWait?: (event: WriteRateWait) => void): Promise<AgentToolResult<unknown>> {
    const permit = permits.get(token);
    if (!permit || permit.stopped || permit.next >= permit.steps.length) throw new AppError('AUTHORIZATION_REQUIRED', '整批授权已失效或已使用完毕。');
    const step = permit.steps[permit.next++]!;
    const stepId = step.stepId ?? permit.next;
    const blocked = (by: number[], error?: unknown, reason = '前置操作未完成') => {
      const value: Data = { step: stepId, tool: step.name, target: step.binding.target, state: 'blocked', blockedBy: by,
        reason, networkAttempted: false, writeNetworkAttempted: false, ...(error ? { error: safeError(error) } : {}) };
      permit.outcomes.set(stepId, value); return result(value);
    };
    const previous = permit.outcomes.get(stepId);
    if (previous?.state === 'blocked') return result(previous);
    const blockedBy = (step.dependsOn ?? []).filter(id => !['submitted', 'success', 'unchanged'].includes(String(permit.outcomes.get(id)?.state)));
    if (blockedBy.length) return blocked(blockedBy);
    const binding = resolved(step.binding, permit.indexes);
    if (typeof binding.args.index_id === 'number' && binding.args.index_id < 0) return blocked([-binding.args.index_id], undefined, '新目录尚无可核实的真实ID');
    const effectKeys = batchEffectKeys(step.name, binding.args, binding.target);
    const guardKeys = [...new Set([...effectKeys, ...batchDependencyKeys(step.name, binding.args, binding.target)])];
    const domainBlocks = guardKeys.filter(key => permit.blockedDomains.has(key));
    if (domainBlocks.length) return blocked([...new Set(domainBlocks.map(key => Number(permit.blockedDomains.get(key)?.step)).filter(Number.isSafeInteger))], undefined, '关联对象的修改或保护范围仍待核实');
    try {
      checkInput(permit.input); signal?.throwIfAborted();
      if (!channel.canConfirm(permit.ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '交互连接已断开，停止后续提交。');
    } catch (error) { permit.stopped = true; throw error; }
    const fingerprint = createHash('sha256').update(JSON.stringify(stable({ accountId: permit.accountId, name: step.name, args: binding.args }))).digest('hex');
    const logicalOperationId = randomUUID();
    const base: Data = { tool: step.name, step: stepId, accountId: permit.accountId, target: binding.target, before: binding.before, after: binding.after,
      requestId: permit.requestId, batchId: permit.batchId, logicalOperationId };
    const item: SubmittedOperation = { step, binding, value: { ...base, state: 'unchanged', networkAttempted: false, writeNetworkAttempted: false },
      fingerprint, toolCallId, stages: [] };
    permit.submitted.push(item);
    const visibleStages = () => [...item.stages.map(value => visibleWriteValue(value.value)), ...structuredClone(binding.preflightSkipped ?? [])]
      .sort((a, b) => Number(a.stage) - Number(b.stage));
    if (equal(binding.before, binding.after)) {
      if (binding.preflightSkipped?.length) item.value = { ...item.value, state: 'skipped', stageResults: visibleStages() };
      permit.outcomes.set(stepId, item.value); return result(item.value);
    }
    if (!batch) { permit.stopped = true; throw new AppError('BATCH_CONTEXT_EXPIRED', '整批上下文已失效。'); }
    batch = { ...batch, phase: 'submit' };
    submittedGeneration = permit.input.generation;
    const stages = splitWriteStages(step.name, binding);
    const changedStages = stages.filter(stage => !equal(stage.before, stage.after));
    const skippedOrdinals = new Set((binding.preflightSkipped ?? []).map(value => Number(value.stage)));
    let ordinal = 0;
    const episodeOrdinals = new Map((binding.target.episodeIds as number[] | undefined ?? []).map(id => {
      do { ordinal++; } while (skippedOrdinals.has(ordinal)); return [id, ordinal];
    }));
    const originalArgs = step.name === 'update_episode_collection' ? { ...binding.args, episode_ids: changedStages.flatMap(stage => stage.args.episode_ids as number[]) }
      : step.name === 'update_subject_collection' ? Object.assign({}, ...changedStages.map(stage => stage.args)) as Data : binding.args;
    let prefixReceipt: SubmissionReceipt | undefined = new SubmissionTracker(step.name, originalArgs, permit.accountId, binding.guard.subjectId).failed();
    let prefixOffset = 0; let stopOperation = false;
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const stageNumber = step.name === 'update_episode_collection' ? episodeOrdinals.get(Number((stage.args.episode_ids as number[])[0]))! : i + 1;
      const operationId = logicalOperationId + '/' + stageNumber;
      if (equal(stage.before, stage.after)) {
        item.stages.push({ binding: stage, operationId, stage: stageNumber, value: { ...base, operationId, stage: stageNumber,
          target: stage.target, before: stage.before, after: stage.after, state: 'unchanged', networkAttempted: false, writeNetworkAttempted: false } });
        continue;
      }
      if (stopOperation) {
        item.stages.push({ binding: stage, operationId, stage: stageNumber, value: { ...base, target: stage.target, state: 'blocked', stage: stageNumber,
          operationId, logicalOperationId, step: stepId, blockedBy: [], stageBlockedBy: [item.stages.at(-1)?.stage], reason: '前置子阶段未完成',
          networkAttempted: false, writeNetworkAttempted: false } });
        continue;
      }
      const initial = structuredClone(permit.expected);
      const scope = new Set(stage.baseline?.keys() ?? []);
      const stageBase: Data = { ...base, operationId, stageId: operationId, stage: stageNumber, target: stage.target, before: stage.before, after: stage.after };
      const snapshotFacts = () => {
        const keys = [...scope].filter(key => !/:\-\d+$/.test(key));
        return { baselineBefore: keys.filter(key => initial.has(key)).map(key => [key, structuredClone(initial.get(key))]),
          expected: keys.filter(key => permit.expected.has(key)).map(key => [key, structuredClone(permit.expected.get(key))]),
          protectedExpected: keys.filter(key => permit.expected.has(key)).map(key => [key, structuredClone(permit.expected.get(key))]),
          pendingEffects: [...permit.pendingEffects.values()].filter(effect => keys.includes(effect.key)).map(effect => structuredClone({ ...effect })) };
      };
      const fact = (phase: string, extra: Data = {}) => {
        try { recordWrite({ kind: 'bangumi-write', phase, fingerprint, generation: permit.input.generation, toolCallId: toolCallId + '/' + stageNumber,
          args: stage.args, ...stageBase, ...snapshotFacts(), ...extra }); }
        catch (error) { permit.stopped = true; throw error; }
      };
      let stageReceipt: SubmissionReceipt | undefined; let stageError: unknown;
      let rpcStarted = false, validReceipt = false, checkpointFailed = false, startedFactAttempted = false;
      let reservation: Awaited<ReturnType<WriteRateLimiter['reserve']>> | undefined;
      let closing: Promise<void> | undefined; let closeError: unknown;
      const rate = writeRateRequests(step.name, stage.args)[0]!;
      try {
        checkInput(permit.input); signal?.throwIfAborted();
        if (!channel.canConfirm(permit.ctx)) throw new AppError('AUTHORIZATION_REQUIRED', '交互连接已断开，停止后续提交。');
        // 只有共享对象出现未决候选时才增加保护核查；普通已知计划沿用已核实基线。
        if ([...permit.pendingEffects.values()].some(effect => scope.has(effect.key))) {
          try { await checkpoint(permit, scope, signal); } catch (error) { checkpointFailed = true; throw error; }
        }
        reservation = await options.limiter?.reserve(permit.accountId, rate.action, rate.count, {
          ...(signal ? { signal } : {}), onWait: event => { closing ??= endBatch().catch(error => { closeError = error; }); onWait?.(event); },
        });
        if (closing) {
          await closing; if (closeError) throw closeError;
          const viewer = await beginBatch(signal);
          if (viewer.id !== permit.accountId) throw new AppError('ACCOUNT_CHANGED', '额度等待后账户改变，旧授权已撤销。');
          const previousAccess = record(permit.account.accessContext ?? {}), currentAccess = record(viewer.accessContext ?? {});
          if (!equal(previousAccess.nsfw, currentAccess.nsfw) || previousAccess.nsfwApplied !== currentAccess.nsfwApplied) throw new AppError('NSFW_SCOPE_CHANGED', '额度等待后权限改变，旧授权已撤销。');
          // 等待后仅重核当前阶段的活动保护域，故障对象不能连带阻断独立对象。
          try { await checkpoint(permit, scope, signal); } catch (error) { checkpointFailed = true; throw error; }
        }
        checkInput(permit.input); signal?.throwIfAborted();
        if (!batch) throw new AppError('BATCH_CONTEXT_EXPIRED', '额度等待后批次上下文失效。');
        batch = { ...batch, phase: 'submit' };
        const relations = permit.expected.get('relations:' + stage.target.indexId) as Data[] | undefined;
        const relationId = relations?.find(row => row.subject_id === stage.target.subjectId)?.relationId;
        const guard: McpWriteGuard = { ...stage.guard, batchPreparation: { tool: step.name, args: stage.args, target: stage.target, before: stage.before, after: stage.after,
          ...(typeof relationId === 'number' ? { relationId } : {}) } };
        // RPC前持久化这个子阶段的保守未知；恢复器不依赖可重放的父聚合回执。
        const pendingReceipt = new SubmissionTracker(step.name, stage.args, permit.accountId, stage.guard.subjectId).failed();
        pendingReceipt.items[0]!.submissionState = 'unknown'; pendingReceipt.submissionState = 'unknown';
        if (isWatchedUntil(step.name, stage.args)) pendingReceipt.affectedEpisodeIds = watchedUntilIds(stage.guard.prepared!.episodes!, Number(stage.args.episode_id));
        const pendingExpected = structuredClone(permit.expected);
        if (step.createdIndex === undefined) advanceWriteView(pendingExpected, { name: step.name, binding: stage }, permit.accountId);
        rememberUnknown(permit, step.name, stage, operationId);
        startedFactAttempted = true;
        fact('started', { submission: pendingReceipt, expected: [...scope].filter(key => pendingExpected.has(key) && !/:\-\d+$/.test(key)).map(key => [key, pendingExpected.get(key)]),
          state: 'unknown', rateAction: rate.action, rateCount: rate.count });
        rpcStarted = true;
        try {
          const submit = () => client.call(step.name, stage.args, signal, guard, batch);
          const submitted = await (trace ? trace.phase('submit', submit, { tool_call_id: toolCallId, stage: i + 1 }) : submit());
          checkOutput(findToolDefinition(step.name).outputSchema!, { value: submitted });
          checkSubmission(step.name, submitted, stage.args, permit.accountId, guard.subjectId, guard.prepared);
          stageReceipt = submitted as SubmissionReceipt; validReceipt = true;
        } catch (error) {
          stageError = error;
          if (error instanceof SubmissionError) {
            try {
              checkOutput(findToolDefinition(step.name).outputSchema!, { error: safeError(error) });
              checkSubmission(step.name, error.submission, stage.args, permit.accountId, guard.subjectId, guard.prepared);
              stageReceipt = error.submission; validReceipt = true;
            } catch (invalidReceipt) { stageError = invalidReceipt; }
          }
        }
      } catch (error) { stageError = error; }
      finally {
        try { if (closing) await closing; }
        finally {
          if (reservation) {
            if (rpcStarted && stageReceipt?.submissionState !== 'not_attempted' && !(stageError instanceof AppError && stageError.networkAttempted === false)) reservation.dispatched();
            else reservation.refundUndispatched();
          }
        }
      }
      const submissionInferred = !stageReceipt;
      if (!stageReceipt) {
        stageReceipt = new SubmissionTracker(step.name, stage.args, permit.accountId, stage.guard.subjectId).failed();
        if (rpcStarted && !(stageError instanceof AppError && stageError.networkAttempted === false)) {
          stageReceipt.items[0]!.submissionState = 'unknown'; stageReceipt.submissionState = 'unknown';
          if (isWatchedUntil(step.name, stage.args)) stageReceipt.affectedEpisodeIds = watchedUntilIds(stage.guard.prepared!.episodes!, Number(stage.args.episode_id));
        }
      }
      const attempted = stageReceipt.submissionState !== 'not_attempted';
      const acknowledged = stageReceipt.submissionState === 'acknowledged' && stageError === undefined;
      const uncertain = attempted && stageReceipt.submissionState !== 'rejected' && !acknowledged;
      if (stageReceipt.createdId && step.createdIndex !== undefined) permit.indexes.set(step.createdIndex, positive(stageReceipt.createdId));
      const createdIndex = step.createdIndex === undefined ? undefined : permit.indexes.get(step.createdIndex);
      if (!uncertain) for (const [key, effect] of permit.pendingEffects) if (effect.operationId === operationId) permit.pendingEffects.delete(key);
      if (acknowledged && (step.createdIndex === undefined || createdIndex !== undefined)) {
        advanceWriteView(permit.expected, { name: step.name, binding: stage, ...(createdIndex === undefined ? {} : { createdIndex }) }, permit.accountId);
        const rows = permit.expected.get('relations:' + binding.target.indexId) as Data[] | undefined;
        if (stageReceipt.relatedId) {
          const row = rows?.find(row => row.subject_id === binding.target.subjectId);
          if (row) row.relationId = stageReceipt.relatedId;
        }
      } else if (uncertain) rememberUnknown(permit, step.name, stage, operationId, createdIndex);
      if (createdIndex !== undefined && step.createdIndex !== undefined) scope.add('index:' + createdIndex);
      // 老展示回执仅在保持合法连续前缀时保留；含洞结果只通过host子阶段事实表达。
      if (submissionInferred) prefixReceipt = undefined;
      if (prefixReceipt) {
        try { prefixReceipt = mergeStageSubmission(prefixReceipt, stageReceipt, prefixOffset); prefixOffset += stageReceipt.items.length; }
        catch { prefixReceipt = undefined; }
      }
      const stageState = !rpcStarted && (checkpointFailed || stageError !== undefined && isBatchFatal(stageError, 'execute')) ? 'blocked'
        : acknowledged ? 'submitted' : uncertain ? 'unknown' : 'failed';
      const stageValue: Data = { ...stageBase, ...snapshotFacts(), submittedArgs: stage.args, attemptedAt: new Date().toISOString(), state: stageState,
        networkAttempted: attempted, writeNetworkAttempted: attempted, submission: stageReceipt,
        verification: { readbackCompleted: false, requestedStateMatched: false, protectedFieldsMatched: false, mismatchedFields: [], state: 'pending', scope: 'batch_final_state' },
        ...(submissionInferred ? { submissionInferred: true } : {}), ...(stageError ? { submissionError: safeError(stageError) } : {}),
        ...(stageState === 'blocked' ? { blockedBy: [], reason: checkpointFailed ? '该对象的保护范围无法核实' : '整批授权已停止' } : {}) };
      item.stages.push({ binding: stage, value: stageValue, operationId, stage: stageNumber });
      if (rpcStarted || attempted || startedFactAttempted) fact('submission', { ...stageValue, rateAction: rate.action, rateCount: attempted ? rate.count : 0 });
      if (startedFactAttempted && !rpcStarted && !attempted) fact('completed', { ...stageValue, resolution: 'not_attempted' });
      if (stageError instanceof AppError && ['BGM_HTTP_429', 'BGM_RATE_LIMIT_REJECTED'].includes(stageError.code)) {
        options.limiter?.limited(permit.accountId, rate.action,
          stageError.rejection?.retryAfterMs ? Date.now() + Math.max(300000, stageError.rejection.retryAfterMs) + 1000 : undefined);
      }
      const fatal = permit.stopped || stageError !== undefined && isBatchFatal(stageError, 'execute')
        || rpcStarted && !validReceipt && !(stageError instanceof AppError && stageError.networkAttempted === false);
      if (fatal) permit.stopped = true;
      if (!acknowledged) {
        for (const key of batchEffectKeys(step.name, stage.args, stage.target)) permit.blockedDomains.set(key, { step: stepId, operationId, state: stageState });
        // 404等有合法回执的目录单行未知可由下一不同作品的整表checkpoint隔离。
        // 章节未知则连同父收藏派生进度一起隔离；复合书籍阶段有真实顺序依赖。
        if (checkpointFailed || uncertain && isEpisodeWrite(step.name) || step.name === 'update_subject_collection') {
          for (const key of batchDependencyKeys(step.name, stage.args, stage.target)) permit.blockedDomains.set(key, { step: stepId, operationId, state: stageState });
        }
        if (fatal || uncertain || step.name !== 'update_episode_collection') stopOperation = true;
      }
      item.value = { ...base, state: item.stages.some(value => value.value.state === 'unknown') ? 'unknown'
        : item.stages.every(value => value.value.state === 'blocked') ? 'blocked'
        : binding.preflightSkipped?.length || item.stages.some(value => ['failed', 'blocked'].includes(String(value.value.state))) ? 'failed' : 'submitted',
        networkAttempted: item.stages.some(value => value.value.writeNetworkAttempted), writeNetworkAttempted: item.stages.some(value => value.value.writeNetworkAttempted),
        stageResults: visibleStages(), ...(prefixReceipt ? { submission: prefixReceipt } : {}),
        ...(stageReceipt.createdId ? { createdId: stageReceipt.createdId } : {}),
        ...(stageError ? { submissionError: safeError(stageError) } : {}), ...(permit.stopped ? { stopBatch: true } : {}) };
    }
    item.value.stageResults = visibleStages();
    permit.outcomes.set(stepId, item.value);
    return result(visibleWriteValue(item.value));
  }
  async function beginBatch(signal?: AbortSignal): Promise<Data> {
    if (batch) throw new AppError('BATCH_SCOPE_ACTIVE', '宿主已有进行中的修改计划。');
    const input = getInput();
    if (generation !== input.generation) { generation = input.generation; completed.clear(); unknownWrite = false; }
    batch = { id: randomUUID(), phase: 'prepare' }; subjectCache.clear();
    return record(await read('get_current_user', {}, signal));
  }
  async function endBatch(): Promise<void> {
    const current = batch; batch = undefined; subjectCache.clear();
    if (current) {
      try { await client.call('get_current_user', {}, AbortSignal.timeout(60000), undefined, { ...current, phase: 'close' }); }
      catch { await options.resetClient?.(); }
    }
  }
  function actualFor(step: PlannedWrite, binding: Binding, observed: Map<string, unknown>): unknown {
    const t = binding.target;
    if (step.name === 'update_subject_collection') return observed.get(`collection:${t.id}`);
    if (isEpisodeWrite(step.name)) {
      const after = record(binding.after); const episodes = (after.episodes as Data[]).map(row => observed.get(`episode:${row.episode_id}`));
      return { episodes, parentCollection: observed.get(`collection:${t.subjectId}`),
        ...(after.protectedEpisodes ? { protectedEpisodes: (after.protectedEpisodes as Data[]).map(row => observed.get(`episode:${row.episode_id}`)) } : {}) };
    }
    if (/^(collect|uncollect)_(character|person)$/.test(step.name)) return observed.get(`entity:${t.kind}:${t.id}`);
    const id = step.name === 'create_index' ? Number(step.createdIndex) : Number(t.kind === 'indexSubject' ? t.indexId : t.id);
    if (t.kind === 'indexSubject') {
      const row = (observed.get(`relations:${id}`) as Data[] | undefined)?.find(row => row.subject_id === t.subjectId);
      return row ? { subject_id: row.subject_id, comment: row.comment, order: row.order } : null;
    }
    const value = observed.get(`index:${id}`); if (!value) return value;
    const raw = record(value);
    return step.name === 'collect_index' || step.name === 'uncollect_index' ? { collected: raw.collected } : { title: raw.title, description: raw.description, private: raw.private };
  }
  async function finishApproved(token: object): Promise<Data[]> {
    const permit = permits.get(token); if (!permit) throw new AppError('BATCH_CONTEXT_EXPIRED', '整批回读上下文失效。');
    if (!batch) await beginBatch(AbortSignal.timeout(300000));
    if (!batch) throw new AppError('BATCH_CONTEXT_EXPIRED', '无法建立独立回读上下文。');
    permit.stopped = true; batch = { ...batch, phase: 'verify' };
    const verify = async () => {
      const signal = AbortSignal.timeout(300000);
      let observed = new Map<string, unknown>(), readErrors = new Map<string, unknown>();
      let verificationError: unknown; let account: Data | undefined;
      try {
        account = record(await read('get_current_user', {}, signal));
        if (account.id !== permit.accountId) throw new AppError('ACCOUNT_CHANGED', '整批结束时账户改变。');
        const original = record(permit.account.accessContext ?? {}), current = record(account.accessContext ?? {});
        if (!equal(original.nsfw, current.nsfw) || original.nsfwApplied !== current.nsfwApplied) throw new AppError('NSFW_SCOPE_CHANGED', '独立回读时账户权限改变，不能报告旧范围已核实。');
        const keys = new Set([...permit.expected.keys(), ...[...permit.pendingEffects.values()].map(effect => effect.key)]);
        const snapshots = await observedView(keys, permit.accountId, signal);
        observed = snapshots.observed; readErrors = snapshots.errors;
        if (record(await read('get_current_user', {}, signal)).id !== permit.accountId) throw new AppError('ACCOUNT_CHANGED', '整批回读期间账户改变。');
        updateDerivedProgress(permit, observed);
      } catch (error) { observed = new Map(); verificationError = error; }
      const outcomes = permit.submitted.map(item => {
        const binding = resolved(item.binding, permit.indexes);
        const createdIndex = item.step.createdIndex === undefined ? undefined : permit.indexes.get(item.step.createdIndex);
        const resolvedStep = { ...item.step, ...(createdIndex === undefined ? {} : { createdIndex }) };
        const actual = actualFor(resolvedStep, binding, observed);
        const stageResults = item.stages.map(stage => {
          if (stage.value.state === 'blocked') return visibleWriteValue(stage.value);
          const own = resolved(stage.binding, permit.indexes);
          const stageActual = actualFor(resolvedStep, own, observed);
          const keys = item.step.name === 'create_index' && createdIndex !== undefined ? ['index:' + createdIndex]
            : [...own.baseline?.keys() ?? []].filter(key => !/:\-\d+$/.test(key));
          const scopeError = verificationError ?? keys.map(key => readErrors.get(key)).find(Boolean);
          const unidentifiable = item.step.createdIndex !== undefined && createdIndex === undefined;
          const readbackCompleted = !scopeError && !unidentifiable && keys.every(key => observed.has(key));
          const protectedMatched = readbackCompleted && keys.every(key => matchesExpected(permit, key, observed.get(key)));
          const ownVerification = readbackCompleted && stageActual !== undefined
            ? verifyWrittenState(item.step.name, own.before, own.after, stageActual, own.target) : undefined;
          const prior = String(stage.value.state);
          const requestedMatched = protectedMatched && (prior === 'submitted' || prior === 'unchanged'
            || prior === 'unknown' && ownVerification?.requestedStateMatched === true);
          const state = requestedMatched ? prior === 'unchanged' ? 'unchanged' : 'success'
            : prior === 'unknown' || stage.value.writeNetworkAttempted === true && !readbackCompleted ? 'unknown' : 'failed';
          if (state === 'unknown') unknownWrite = true;
          const pending = [...permit.pendingEffects.values()].filter(effect => keys.includes(effect.key)).map(effect => structuredClone({ ...effect }));
          const parent = isEpisodeWrite(item.step.name) ? observed.get('collection:' + own.target.subjectId) : undefined;
          const outcome: Data = { ...stage.value, target: own.target, state, actual: stageActual,
            protectedExpected: keys.map(key => [key, structuredClone(permit.expected.get(key) ?? null)]), pendingEffects: pending,
            expected: keys.filter(key => permit.expected.has(key)).map(key => [key, structuredClone(permit.expected.get(key))]),
            verification: { readbackCompleted, requestedStateMatched: requestedMatched, protectedFieldsMatched: protectedMatched,
              mismatchedFields: requestedMatched ? [] : ['batch_final_state'], state, scope: 'batch_final_state',
              superseded: requestedMatched && !equal(stageActual, own.after),
              ...(parent ? { parentProgress: { subjectId: Number(own.target.subjectId), before: record(record(own.before).parentCollection).ep_status, actual: record(parent).ep_status } } : {}) },
            ...(requestedMatched && prior === 'unknown' ? { resolution: 'observed_applied' } : {}),
            ...(state !== 'success' && state !== 'unchanged' ? { verificationError: safeError(scopeError ?? new AppError(protectedMatched ? 'READBACK_MISMATCH' : 'UNEXPECTED_CHANGE', '该子项的请求目标或保护范围未达到要求。')) } : {}) };
          recordWrite({ kind: 'bangumi-write', phase: 'completed', fingerprint: item.fingerprint, generation: permit.input.generation,
            toolCallId: item.toolCallId + '/' + stage.stage, args: own.args, ...outcome });
          return visibleWriteValue(outcome);
        });
        stageResults.push(...structuredClone(binding.preflightSkipped ?? []));
        stageResults.sort((a, b) => Number(a.stage) - Number(b.stage));
        const hasUnknown = stageResults.some(value => value.state === 'unknown');
        const hasFailure = stageResults.some(value => ['failed', 'blocked', 'skipped'].includes(String(value.state)));
        let state = hasUnknown ? 'unknown' : stageResults.length && stageResults.every(value => value.state === 'blocked') ? 'blocked'
          : hasFailure ? 'failed' : stageResults.length ? 'success' : String(item.value.state);
        if (!item.stages.length && binding.preflightSkipped?.length) state = 'skipped';
        const accessContext = account?.accessContext ?? (verificationError instanceof AppError ? verificationError.accessContext : undefined);
        let readbackCompleted = stageResults.filter(value => !['blocked', 'skipped'].includes(String(value.state)))
          .every(value => record(value.verification ?? {}).readbackCompleted === true);
        let protectedMatched = stageResults.filter(value => !['blocked', 'skipped'].includes(String(value.state)))
          .every(value => record(value.verification ?? {}).protectedFieldsMatched === true);
        if (!stageResults.length) {
          const keys = [...binding.baseline?.keys() ?? []].filter(key => !/:\-\d+$/.test(key));
          readbackCompleted = !verificationError && !keys.some(key => readErrors.has(key)) && keys.every(key => observed.has(key));
          protectedMatched = readbackCompleted && keys.every(key => matchesExpected(permit, key, observed.get(key)));
          if (state === 'unchanged' && !protectedMatched) state = 'failed';
        }
        const allRequested = !hasUnknown && !hasFailure && stageResults.every(value => record(value.verification ?? {}).requestedStateMatched === true);
        const parent = isEpisodeWrite(item.step.name) ? observed.get('collection:' + binding.target.subjectId) : undefined;
        const outcomeVerificationError = stageResults.find(value => value.verificationError)?.verificationError
          ?? (['failed', 'unknown'].includes(state) ? safeError(verificationError
            ?? [...binding.baseline?.keys() ?? []].map(key => readErrors.get(key)).find(Boolean)
            ?? new AppError(protectedMatched ? 'READBACK_MISMATCH' : 'UNEXPECTED_CHANGE', '该项的请求目标或保护范围未达到要求。')) : undefined);
        const outcome: Data = { ...item.value, step: item.step.stepId, target: binding.target, state, actual, stageResults,
          ...(accessContext ? { accessContext } : {}),
          ...(outcomeVerificationError ? { verificationError: outcomeVerificationError } : {}),
          ...(state === 'blocked' ? { blockedBy: stageResults.find(value => value.state === 'blocked')?.blockedBy ?? [],
            reason: stageResults.find(value => value.state === 'blocked')?.reason ?? '关联操作未完成' } : {}),
          ...(hasFailure && stageResults.some(value => value.state === 'success') ? { resolution: 'observed_partial', partial: true } : {}),
          verification: { readbackCompleted, requestedStateMatched: item.stages.length ? allRequested : state === 'unchanged',
            protectedFieldsMatched: protectedMatched, mismatchedFields: state === 'success' || state === 'unchanged' ? [] : ['stage_results'], state, scope: 'batch_final_state',
            superseded: stageResults.some(value => record(value.verification ?? {}).superseded === true),
            ...(parent ? { parentProgress: { subjectId: Number(binding.target.subjectId), before: record(record(binding.before).parentCollection).ep_status, actual: record(parent).ep_status } } : {}) } };
        permit.outcomes.set(item.step.stepId!, outcome);
        return visibleWriteValue(outcome);
      });
      for (const [step, value] of permit.outcomes) if (value.state === 'blocked' && !outcomes.some(outcome => outcome.step === step)) outcomes.push(value);
      return outcomes.sort((a, b) => Number(a.step) - Number(b.step));
    };
    return trace ? trace.phase('verify', verify, { scope: 'batch_final_state' }) : verify();
  }
  let standalone: import('@earendil-works/pi-coding-agent').ToolDefinition | undefined;
  const write: McpWriteHandler = async (name, args, signal, ctx, toolCallId) => {
    if (!standalone) {
      const { createBatchWriteTool } = await import('./batch-write.js');
      standalone = createBatchWriteTool(api, value => {
        const fact = { kind: 'bangumi-batch', ...value };
        options.journal?.append(fact); onRecord?.(fact);
      }, trace);
    }
    const outcome = await standalone.execute(toolCallId, { operations: [{ tool: name, args }] }, signal, undefined, ctx);
    const value = record(record(outcome.details).value), items = value.items as Data[] | undefined;
    return items?.[0] ? result({ ...items[0], confirmation: value.confirmation, ...(value.error ? { error: value.error } : {}) }) : outcome;
  };
  const api = { write, prepare, read, authorize, executeApproved, finishApproved, beginBatch, endBatch, assertReady, recordedRequest, planRecord,
    recoveryIssues: () => structuredClone(recoveryIssues), revoke: (token: object) => permits.delete(token),
    recoveryTargets: () => structuredClone(recoveryTargets),
    recoveryBlockedSteps: () => [...recoveryBlockedSteps],
    getInput: () => { const input = getInput(); return { ...input, requestId: requestId(input) }; } };
  return api;
}

export type WriteBoundary = ReturnType<typeof createWriteBoundary>;
/** 单项入口保持原公开签名，整批授权只由宿主批量工具持有。 */
export function createWriteHandler(client: McpCallClient, getInput: () => WriteInput, onRecord?: (record: unknown) => void): McpWriteHandler {
  return createWriteBoundary(client, getInput, onRecord).write;
}
