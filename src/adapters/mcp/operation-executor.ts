import type { BangumiReadClient } from '../bgm-cli/client.js';
import type { OperationExecutor, ExecutionOutcome } from '../../core/operations.js';
import type { PlannedAction } from '../../domain/permissions.js';
import { object, positiveId } from '../../domain/bangumi.js';
import { mcpMutationSnapshot } from '../../tools/mcp-tools.js';
import type { McpCallClient } from './client.js';

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** 扩展既有宿主执行器；MCP service 的 submitted 从不直接映射成功。 */
export class McpOperationExecutor implements OperationExecutor {
  constructor(private readonly read: BangumiReadClient, private readonly mcp: McpCallClient, private readonly fallback?: OperationExecutor,
    private readonly onPhase?: (phase: 'writing' | 'verifying', targetId: number) => void) {}
  async matchesCurrent(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<boolean> {
    if (action.kind !== 'mcp') return this.fallback ? this.fallback.matchesCurrent(accountId, action, signal) : false;
    if (!action.mcp || (await this.read.currentUser(signal)).id !== accountId) return false;
    const current = await mcpMutationSnapshot(this.mcp, action.mcp.tool, action.mcp.args, accountId, signal);
    return same(current, action.mcp.baseline) && (await this.read.currentUser(signal)).id === accountId;
  }
  async execute(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<ExecutionOutcome | 'success' | 'failed' | 'unknown'> {
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
}
