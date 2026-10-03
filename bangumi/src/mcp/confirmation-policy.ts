import { isDeepStrictEqual } from 'node:util';
import { TOOL_DEFINITIONS } from './catalog.js';
import { record, type Data } from './resource-output.js';
import { AppError } from '../support/errors.js';

const writes = new Set([
  'update_subject_collection', 'update_single_episode_collection', 'update_episode_collection',
  'collect_character', 'uncollect_character', 'collect_person', 'uncollect_person',
  'create_index', 'update_index', 'add_subject_to_index', 'update_index_subject',
  'remove_subject_from_index', 'collect_index', 'uncollect_index',
]);
const registered = TOOL_DEFINITIONS.filter(tool => tool.effect === 'write');
if (registered.length !== writes.size || registered.some(tool => !writes.has(tool.name))) {
  throw new Error('固定写工具必须全部登记确认政策。');
}
export interface ConfirmationItem { name: string; args: Data; before: unknown; after: unknown }
export interface ConfirmationDecision { required: boolean; reasons: string[] }

/** 只根据固定能力、显式短评字段及完整计划范围决定确认，不解析自然语言风险。 */
export function confirmationForPlan(items: readonly ConfirmationItem[]): ConfirmationDecision {
  if (!items.length || items.some(item => !writes.has(item.name))) throw new AppError('UNKNOWN_TOOL', '确认政策只接受完整的固定写操作计划。');
  const changes = items.filter(item => !isDeepStrictEqual(item.before, item.after));
  if (!changes.length) return { required: false, reasons: [] };
  const reasons: string[] = [];
  if (items.length > 1 || items.some(item => item.name === 'update_episode_collection' && (item.args.episode_ids as number[]).length > 1
    || item.name === 'update_single_episode_collection' && item.args.batch === true && (record(item.after).episodes as unknown[]).length > 1)) {
    reasons.push('批量修改完整范围');
  }
  if (changes.some(item => item.name === 'update_subject_collection' && Object.hasOwn(item.args, 'comment')
    && typeof item.args.comment === 'string' && item.args.comment.trim().length > 0
    && item.args.comment !== (item.before === null ? '' : record(item.before).comment))) {
    reasons.push('发布或修改作品短评');
  }
  return { required: reasons.length > 0, reasons };
}
