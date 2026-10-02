import { AppError } from './errors.js';
import { positiveId } from './bangumi.js';
import type { Collection, Episode, MediaType } from './bangumi.js';

export type ChangeValue = string | number | boolean | null | string[] | number[];
export interface FieldChange { field: string; before: ChangeValue; after: ChangeValue }
export interface PlannedAction {
  subjectId: number; title: string; kind: 'collection' | 'progress' | 'delete';
  changes: FieldChange[];
  /** 由领域适配器读取并计算的附带影响，不能由模型声明其不存在。 */
  effects: FieldChange[];
  baseline?: { type: MediaType; collection: Collection | null; episodes?: Episode[] };
  notice?: string;
}
export interface DirectIntent { subjectId: number; patch: Record<string, ChangeValue>; progress?: { mode: string; number?: number; episodeId?: number } }
export interface PermissionDecision { requiresConfirmation: boolean; reasons: string[] }

export function permissionFor(actions: readonly PlannedAction[]): PermissionDecision {
  if (!actions.length || actions.length > 20) throw new AppError('INVALID_INPUT', '操作清单须包含1～20个条目。');
  const reasons = new Set<string>(); const ids = new Set<number>();
  for (const action of actions) {
    positiveId(action.subjectId);
    if (ids.has(action.subjectId)) throw new AppError('INVALID_INPUT', '同一条目的变更应合并为一项。');
    ids.add(action.subjectId);
    if (!action.changes.length) throw new AppError('NO_CHANGE', '请求未产生变更。');
    if (action.kind === 'delete') reasons.add('删除收藏');
    if (action.effects.length) reasons.add('存在未指定字段的附带影响');
    for (const change of action.changes) {
      if (change.field === 'private') reasons.add('公开或私密设置变化');
      if (action.kind === 'progress') {
        if (change.after === 0 || (Array.isArray(change.after) && change.after.length === 0)) reasons.add('清空进度');
        if ((change.field.startsWith('episode:') ? change.before === 2 && change.after !== 2
          : typeof change.before === 'number' && typeof change.after === 'number' && change.after < change.before)
          || (Array.isArray(change.before) && Array.isArray(change.after) && change.before.some(value => !(change.after as unknown[]).includes(value)))) reasons.add('降低进度');
      }
    }
  }
  if (actions.length > 1) reasons.add('多作品批量修改');
  return { requiresConfirmation: reasons.size > 0, reasons: [...reasons] };
}

export function matchesDirectIntent(actions: readonly PlannedAction[], intent: DirectIntent | null): boolean {
  if (!intent || actions.length !== 1 || permissionFor(actions).requiresConfirmation) return false;
  const action = actions[0]!;
  if (intent.progress) return action.subjectId === intent.subjectId && action.kind === 'progress'
    && action.notice?.startsWith(`明确进度语义：${JSON.stringify(intent.progress)}\n`) === true;
  return action.subjectId === intent.subjectId && action.changes.every(change => Object.hasOwn(intent.patch, change.field)
    && JSON.stringify(intent.patch[change.field]) === JSON.stringify(change.after));
}

/** 仅接受完整且有限的明确句式；复杂自然语言由模型生成预览后，用户通过宿主确认。 */
export function directIntentFrom(input: string, selectedId: number | null): DirectIntent | null {
  const match = /^(?:请)?(?:把|将)?\s*(#?\d+|(?:https?:\/\/)?(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/\d+|这部|这个|它|刚才第[一二三四五六七八九十\d]+[部个项]|第[一二三四五六七八九十\d]+[部个项])\s*(?:的)?\s*(.+?)[。！!]?$/u.exec(input.trim());
  if (!match) return null;
  const target = match[1]!; const idMatch = /(?:^#?|\/subject\/)(\d+)$/.exec(target);
  const subjectId = idMatch ? positiveId(idMatch[1]) : selectedId;
  if (subjectId === null) return null;
  const action = match[2]!;
  const through = /^看到第\s*([1-9]\d*)\s*集(?:了)?$/.exec(action);
  if (through) return { subjectId, patch: {}, progress: { mode: 'through', number: Number(through[1]) } };
  const single = /^第\s*([1-9]\d*)\s*集看过(?:了)?$/.exec(action);
  if (single) return { subjectId, patch: {}, progress: { mode: 'single', number: Number(single[1]) } };
  const explicit = /^章节\s*#?([1-9]\d*)\s*看过(?:了)?$/.exec(action);
  if (explicit) return { subjectId, patch: {}, progress: { mode: 'explicit', episodeId: Number(explicit[1]) } };
  const book = /^(?:读到第|(?:阅读进度|进度)改为)\s*([1-9]\d*)\s*(章|卷)(?:了)?$/.exec(action);
  if (book) return { subjectId, patch: { [book[2] === '章' ? 'chapters' : 'volumes']: Number(book[1]) } };
  const rate = /^(?:评分|分数)(?:改成|改为|设为|设置为)\s*(10|[0-9])\s*分?$/.exec(action);
  if (rate) return { subjectId, patch: { rate: Number(rate[1]) } };
  const statuses: Record<string, number> = { 想看: 1, 想读: 1, 想听: 1, 想玩: 1, 看过: 2, 读过: 2, 听过: 2, 玩过: 2, 在看: 3, 在读: 3, 在听: 3, 在玩: 3, 搁置: 4, 抛弃: 5 };
  const status = /^(?:(?:收藏状态|状态)(?:改成|改为|设为)|加入|设为)(想看|想读|想听|想玩|看过|读过|听过|玩过|在看|在读|在听|在玩|搁置|抛弃)$/.exec(action);
  if (status) return { subjectId, patch: { status: statuses[status[1]!]! } };
  const comment = /^短评(?:改成|改为|保存为)[“"]([\s\S]*)[”"]$/.exec(action);
  if (comment) return { subjectId, patch: { comment: comment[1]! } };
  const tags = /^标签(?:改成|改为|设为)\s*(\[[\s\S]*\])$/.exec(action);
  if (tags) {
    try { const values: unknown = JSON.parse(tags[1]!); if (Array.isArray(values) && values.every(value => typeof value === 'string')) return { subjectId, patch: { tags: values } }; }
    catch { /* 不是完整最终值，不生成直接授权。 */ }
  }
  return null;
}
