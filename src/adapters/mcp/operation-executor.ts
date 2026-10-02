import type { BangumiReadClient } from '../bgm-cli/client.js';
import type { OperationExecutor, ExecutionOutcome } from '../../core/operations.js';
import type { PlannedAction } from '../../domain/permissions.js';
import { object, positiveId } from '../../domain/bangumi.js';
import { mcpMutationSnapshot } from '../../tools/mcp-tools.js';
import type { McpCallClient } from './client.js';
import { usesPreparedBaseline } from './prepared.js';
import type { BangumiWriteClient } from '../bgm-cli/write-client.js';
import { isDeepStrictEqual } from 'node:util';

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** 扩展既有宿主执行器；MCP service 的 submitted 从不直接映射成功。 */
export class McpOperationExecutor implements OperationExecutor {
  constructor(private readonly read: BangumiReadClient, private readonly mcp: McpCallClient, private readonly fallback?: OperationExecutor,
    private readonly onPhase?: (phase: 'writing' | 'verifying', targetId: number) => void) {}
  async matchesCurrent(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<boolean> {
    // 普通状态/章节计划已在生成前核对；协调器不再触发第二次网站读取。
    if (usesPreparedBaseline(action)) { signal.throwIfAborted(); return accountId > 0; }
    if (action.kind !== 'mcp') return this.fallback ? this.fallback.matchesCurrent(accountId, action, signal) : false;
    if (!action.mcp || (await this.read.currentUser(signal)).id !== accountId) return false;
    const current = await mcpMutationSnapshot(this.mcp, action.mcp.tool, action.mcp.args, accountId, signal);
    return same(current, action.mcp.baseline) && (await this.read.currentUser(signal)).id === accountId;
  }
  async execute(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<ExecutionOutcome | 'success' | 'failed' | 'unknown'> {
    if (usesPreparedBaseline(action)) return this.executePrepared(accountId, action, signal);
    if (action.kind !== 'mcp') return this.fallback ? this.fallback.execute(accountId, action, signal) : 'failed';
    const operation = action.mcp;
    if (!operation || (await this.read.currentUser(signal)).id !== accountId) return 'failed';
    // journal.started 之后再次检查，覆盖预检与持久化之间的现状漂移。
    if (!await this.matchesCurrent(accountId, action, signal)) return 'failed';
    let submitted: unknown;
    try {
      this.onPhase?.('writing', action.subjectId);
      // _meta guard 不属于模型参数。服务在实际请求前再次验证当前账户。
      submitted = await this.mcp.call(operation.tool, operation.args, signal, { accountId,
        ...(operation.tool.startsWith('update_') && operation.tool.includes('episode') ? { subjectId: action.subjectId } : {}),
        ...(operation.tool === 'update_single_episode_collection' ? { expectedStatus: Number(object(operation.baseline).status) } : {}) });
    } catch { /* 写后无论超时或取消，都进行独立回读；绝不重发。 */ }
    const verify = new AbortController(); const timeout = setTimeout(() => verify.abort(), 15_000);
    try {
      this.onPhase?.('verifying', action.subjectId);
      if ((await this.read.currentUser(verify.signal)).id !== accountId) return 'unknown';
      if (operation.tool === 'create_index') {
        const result = object(submitted); const id = positiveId(result.id);
        const after = object(await mcpMutationSnapshot(this.mcp, 'update_index', { index_id: id }, accountId, verify.signal));
        const expected = object(operation.expected);
        return ['ownerId', 'title', 'description', 'private'].every(key => same(after[key], expected[key]))
          && (await this.read.currentUser(verify.signal)).id === accountId ? 'success' : 'unknown';
      }
      const after = await mcpMutationSnapshot(this.mcp, operation.tool, operation.args, accountId, verify.signal);
      if ((await this.read.currentUser(verify.signal)).id !== accountId) return 'unknown';
      if (same(after, operation.expected)) return 'success';
      if (same(after, operation.baseline) && submitted !== undefined) return 'failed';
      return 'unknown';
    } catch { return 'unknown'; }
    finally { clearTimeout(timeout); }
  }
  private async executePrepared(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<ExecutionOutcome | 'unknown' | 'failed'> {
    signal.throwIfAborted();
    const baseline = action.baseline!;
    const expected = structuredClone(baseline.collection ?? { subjectId: action.subjectId, status: null, rate: 0, tags: [], comment: '', private: false, chapters: 0, volumes: 0 });
    const episodes = structuredClone(baseline.episodes);
    for (const change of [...action.changes, ...action.effects]) {
      if (change.field.startsWith('episode:')) {
        const ep = episodes?.find(ep => `episode:${ep.id}` === change.field);
        if (!ep) return 'failed';
        ep.status = Number(change.after);
      } else (expected as unknown as Record<string, unknown>)[change.field] = change.after;
    }
    let submitted = false;
    this.onPhase?.('writing', action.subjectId);
    try {
      if (action.kind === 'collection') {
        await this.mcp.call('update_subject_collection', { subject_id: action.subjectId, collection_type: expected.status,
          rating: expected.rate, comment: expected.comment, tags: expected.tags, private: expected.private }, signal,
        { accountId, subjectId: action.subjectId, prepared: baseline });
      } else {
        for (const change of action.changes) {
          signal.throwIfAborted();
          await this.mcp.call('update_single_episode_collection', { episode_id: Number(change.field.slice(8)), collection_type: change.after }, signal,
            { accountId, subjectId: action.subjectId, expectedStatus: Number(change.before), prepared: baseline });
        }
      }
      submitted = true;
    } catch { /* 一旦可能提交，无论取消或超时均独立回读，绝不重发。 */ }
    const verification = AbortSignal.timeout(30_000);
    this.onPhase?.('verifying', action.subjectId);
    try {
      if ((await this.read.currentUser(verification)).id !== accountId) return 'unknown';
      const writer = this.read as BangumiWriteClient;
      const actual = await writer.collectionSnapshot(action.subjectId, verification);
      if (!actual) return 'unknown';
      const actualEpisodes = episodes ? (await writer.progressEpisodes(action.subjectId, accountId, verification)).data : undefined;
      const episodeState = (items: NonNullable<typeof episodes>) => items.map(ep => [ep.id, ep.number, ep.type, ep.status]).sort((a, b) => Number(a[0]) - Number(b[0]));
      const match = episodes ? ['status', 'rate', 'tags', 'comment', 'private', 'volumes'].every(key => isDeepStrictEqual(actual[key as keyof typeof actual], expected[key as keyof typeof expected]))
        && isDeepStrictEqual(episodeState(actualEpisodes!), episodeState(episodes)) : isDeepStrictEqual(actual, expected);
      const fields = action.changes.map(change => ({ field: change.field, state: (isDeepStrictEqual(change.field.startsWith('episode:')
        ? actualEpisodes?.find(ep => `episode:${ep.id}` === change.field)?.status : actual[change.field as keyof typeof actual], change.after) ? 'success' : 'failed') as 'success' | 'failed' }));
      return { state: match ? 'success' : submitted ? 'failed' : 'unknown', fields };
    } catch { return 'unknown'; }
  }
}
