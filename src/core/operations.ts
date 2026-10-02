import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import { matchesDirectIntent, permissionFor, type DirectIntent, type PlannedAction } from '../domain/permissions.js';
import { positiveId } from '../domain/bangumi.js';
import type { OperationJournal, OperationState } from '../storage/operations.js';

export interface OperationPlan {
  id: string; digest: string; accountId: number; actions: PlannedAction[];
  requiresConfirmation: boolean; reasons: string[];
  state: 'pending' | 'authorized' | 'rejected' | 'invalidated' | 'executing' | 'finished';
  writeAvailable: boolean;
  results?: ActionResult[];
  unchanged?: { subjectId: number; title: string }[];
  stopped?: string;
}
export interface ActionResult { subjectId: number; state: 'success' | 'failed' | 'unknown' | 'not_started'; fields?: { field: string; state: 'success' | 'failed' | 'unknown' }[]; relatedProgress?:{state:'retained'|'changed'|'unknown';before:unknown;after?:unknown} }
export type ExecutionOutcome = { state: 'success' | 'failed' | 'unknown'; fields?: ActionResult['fields']; relatedProgress?:ActionResult['relatedProgress'] };
export interface OperationExecutor {
  /** 核对现状或采用计划阶段已核实的绑定快照；返回 false 时整个授权失效。 */
  matchesCurrent(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<boolean>;
  /** M4 适配器负责写入与回读验证；请求完成或退出码不能直接映射为 success。 */
  execute(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<'success' | 'failed' | 'unknown' | ExecutionOutcome>;
}

export class OperationCoordinator {
  private readonly plans = new Map<string, OperationPlan>();
  private busy = false;
  constructor(private readonly journal: OperationJournal, private readonly executor?: OperationExecutor) {}
  prepare(accountId: number, actions: PlannedAction[], intent: DirectIntent | null, unchanged: { subjectId: number; title: string }[] = []): OperationPlan {
    positiveId(accountId);
    if (actions.some(action => action.kind === 'delete')) throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
    const decision = permissionFor(actions);
    const body = structuredClone(actions);
    const direct = unchanged.length === 0 && matchesDirectIntent(body, intent);
    const reasons = [...decision.reasons, ...(unchanged.length && actions.length + unchanged.length > 1 ? ['多作品批量修改（含无需改动项）'] : []), ...(!direct && !decision.requiresConfirmation ? ['尚无绑定最终对象与参数的明确用户授权'] : [])];
    const plan: OperationPlan = { id: randomUUID(), digest: createHash('sha256').update(JSON.stringify({ accountId, actions: body, ...(unchanged.length ? { unchanged } : {}) })).digest('hex'),
      accountId, actions: body, requiresConfirmation: !direct, reasons, state: direct ? 'authorized' : 'pending', writeAvailable: Boolean(this.executor) };
    if (unchanged.length) plan.unchanged = structuredClone(unchanged);
    this.plans.set(plan.id, plan); return structuredClone(plan);
  }
  get(id: string): OperationPlan {
    const plan = this.plans.get(id);
    if (!plan) throw new AppError('PLAN_UNAVAILABLE', '变更预览不存在或已随会话恢复失效，请重新生成。');
    return structuredClone(plan);
  }
  /** 仅供宿主从真实用户交互调用，不注册为模型工具。digest 绑定展示过的全部对象和参数。 */
  confirm(id: string, digest: string): OperationPlan {
    const plan = this.plans.get(id);
    if (!plan || plan.digest !== digest || plan.state !== 'pending') throw new AppError('PLAN_UNAVAILABLE', '确认不匹配或预览已失效，请重新生成。');
    plan.state = 'authorized'; return structuredClone(plan);
  }
  reject(id: string): OperationPlan {
    const plan = this.plans.get(id);
    if (!plan || !['pending', 'authorized'].includes(plan.state)) throw new AppError('PLAN_UNAVAILABLE', '此预览已失效或正在执行。');
    plan.state = 'rejected'; return structuredClone(plan);
  }
  invalidate(): void {
    for (const plan of this.plans.values()) if (plan.state === 'pending' || plan.state === 'authorized') plan.state = 'invalidated';
  }
  async execute(id: string, signal: AbortSignal): Promise<{ plan: OperationPlan; results: ActionResult[]; stopped?: string }> {
    const plan = this.plans.get(id);
    if (!plan || plan.state !== 'authorized') throw new AppError('AUTHORIZATION_REQUIRED', '执行前需要针对当前具体变更的用户授权。');
    if (!this.executor) return { plan: structuredClone(plan), results: plan.actions.map(action => ({ subjectId: action.subjectId, state: 'not_started' })) };
    if (this.busy) throw new AppError('OPERATION_BUSY', '已有变更正在执行。');
    this.busy = true; plan.state = 'executing';
    const results: ActionResult[] = plan.actions.map(action => ({ subjectId: action.subjectId, state: 'not_started' }));
    let stopped: string | undefined;
    try {
      const previous = await this.journal.states();
      for (let index = 0; index < plan.actions.length; index++) {
        if (signal.aborted) { stopped = 'CANCELLED'; break; }
        const action = plan.actions[index]!; const operationId = `${plan.id}:${index}`;
        if (previous.has(operationId)) throw new AppError('OPERATION_REPLAY', '已记录开始执行的操作不得重放，请先核对网站状态。');
        let matches: boolean;
        try { matches = await this.executor.matchesCurrent(plan.accountId, structuredClone(action), signal); }
        catch { stopped = signal.aborted ? 'CANCELLED' : 'PRECONDITION_READ_FAILED'; break; }
        if (!matches) { stopped = 'PLAN_STALE'; break; }
        if (signal.aborted) { stopped = 'CANCELLED'; break; }
        // 必须在调用执行器前持久化；崩溃或超时后 started 被视为结果未知。
        await this.journal.append({ operationId, planId: plan.id, state: 'started' });
        let state: OperationState;
        let fields: ActionResult['fields'];
        let relatedProgress:ActionResult['relatedProgress'];
        try {
          signal.throwIfAborted(); const outcome = await this.executor.execute(plan.accountId, structuredClone(action), signal);
          state = typeof outcome === 'string' ? outcome : outcome.state;
          if (typeof outcome !== 'string') fields = outcome.fields;
          if (typeof outcome !== 'string') relatedProgress = outcome.relatedProgress;
        }
        catch { state = 'unknown'; }
        if (!['success', 'failed', 'unknown'].includes(state)) state = 'unknown';
        results[index] = { subjectId: action.subjectId, state: state as ActionResult['state'], ...(fields ? { fields } : {}),...(relatedProgress ? {relatedProgress} : {}) };
        await this.journal.append({ operationId, planId: plan.id, state });
        // 结果未知时停止后续项；明确失败的独立项允许继续。
        if (state === 'unknown' || signal.aborted) { stopped = signal.aborted ? 'CANCELLED' : 'RESULT_UNKNOWN'; break; }
      }
      plan.results = structuredClone(results);
      if (stopped) plan.stopped = stopped;
      return { plan: { ...structuredClone(plan), state: 'finished' }, results, ...(stopped ? { stopped } : {}) };
    } finally { plan.state = 'finished'; this.busy = false; }
  }
}
