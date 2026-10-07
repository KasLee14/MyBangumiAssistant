import { SchemaInputError, type InputIssue } from '../support/errors.js';

type Arguments = Record<string, unknown>;
type QueryPlan = { scopeKey: string; hasFilter: boolean };

/** 固定纠参反馈；不把账户资料、原始参数或远端提示写入错误。 */
export function collectionQueryInputIssue(path: string, rule: string): InputIssue | null {
  if (path === '/filter' && rule === 'collection_filter_required') return { path, rule,
    hint: '收藏引用上次查询包含筛选条件，本次遗漏filter。请按原条件重新生成调用参数，日期可用air_date或filter.air_date；明确取消筛选时传filter:{}。不要改变用户范围。' };
  if (path === '/collection_ref' && rule === 'collection_reference_required') return { path, rule,
    hint: '本轮同账户、媒体及收藏状态范围已有收藏快照，本次遗漏collection_ref。请使用此前返回的collectionRef重新生成调用参数，保留本次筛选条件，不要重新采集同一来源。' };
  return null;
}

/** 静态schema之外的读取轮次约束；只记成功返回的来源引用与是否存在筛选。 */
export class CollectionQueryInputState {
  private readonly owners = new Map<string, Map<string, QueryPlan>>();
  clear(owner?: string): void { if (owner === undefined) this.owners.clear(); else this.owners.delete(owner); }
  private scopeKey(scope: Arguments): string {
    return JSON.stringify([scope.username, scope.subject_type, scope.collection_type ?? null]);
  }
  validate(name: string, args: Arguments, owner?: string): void {
    if (!owner || name !== 'query_user_collections' || args.result_mode !== 'candidates') return;
    const plans = this.owners.get(owner);
    if (!plans) return;
    if (typeof args.collection_ref === 'string') {
      if (plans.get(args.collection_ref)?.hasFilter && args.filter === undefined && args.air_date === undefined)
        throw new SchemaInputError([collectionQueryInputIssue('/filter', 'collection_filter_required')!]);
    } else if ([...plans.values()].some(plan => plan.scopeKey === this.scopeKey(args))) {
      throw new SchemaInputError([collectionQueryInputIssue('/collection_ref', 'collection_reference_required')!]);
    }
  }
  remember(name: string, args: Arguments, value: unknown, owner?: string): void {
    if (!owner || name !== 'query_user_collections' || args.result_mode !== 'candidates'
      || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const result = value as Arguments, scope = result.collectionScope as Arguments | undefined;
    if (result.kind !== 'candidate_page' || typeof result.collectionRef !== 'string' || !scope
      || scope.username !== args.username || scope.subject_type !== args.subject_type) return;
    let plans = this.owners.get(owner);
    if (!plans) { plans = new Map(); this.owners.set(owner, plans); }
    plans.set(result.collectionRef, { scopeKey: this.scopeKey(scope),
      hasFilter: args.air_date !== undefined || Object.keys(args.filter as Arguments ?? {}).length > 0 });
  }
}
