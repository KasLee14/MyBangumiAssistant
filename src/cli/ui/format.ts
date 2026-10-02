import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import type { OperationPlan, ActionResult } from '../../core/operations.js';
import { credentialValues, redact } from '../../domain/errors.js';

/** 外部文本不能向终端注入光标移动、OSC、铃声或其他控制序列。 */
export function displayText(text: string): string {
  return stripVTControlCharacters(redact(text, credentialValues()).replace(/\r\n/g, '\n'))
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}
export const FIELD_LABELS: Record<string, string> = {
  status: '收藏状态', rate: '评分', tags: '标签', comment: '短评', private: '私密', chapters: '章数', volumes: '卷数', collection: '收藏',
};
const STATES: Record<ActionResult['state'], string> = { success: '回读验证成功', failed: '失败', unknown: '结果未知', not_started: '尚未开始' };
export function fieldLabel(field: string): string { return FIELD_LABELS[field] ?? (field.startsWith('episode:') ? `章节 #${field.slice(8)}` : field); }
function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined) return '无';
  if (field === 'status' && typeof value === 'number') return ({1:'想看',2:'看过',3:'在看',4:'搁置',5:'抛弃'} as Record<number,string>)[value] ?? String(value);
  if (field === 'status' && typeof value === 'string') return ({ wish: '想看', collect: '看过', do: '在看', on_hold: '搁置', dropped: '抛弃' } as Record<string,string>)[value] ?? value;
  if (field === 'private' && typeof value === 'boolean') return value ? '私密' : '公开';
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('、') : '空';
  return typeof value === 'string' ? value || '空' : JSON.stringify(value);
}
export function resultLines(results: readonly ActionResult[], plan?: OperationPlan): string {
  return displayText(results.map(result => {
    const title = plan?.actions.find(action => action.subjectId === result.subjectId)?.title;
    const fields = result.fields?.map(field => `  ${fieldLabel(field.field)}：${STATES[field.state]}`) ?? [];
    const related = result.relatedProgress ? [`  关联进度：${{ retained: '保留', changed: '已改变', unknown: '未知' }[result.relatedProgress.state]}`] : [];
    return [`${result.state === 'success' ? '✓' : result.state === 'failed' ? '×' : '·'} #${result.subjectId}${title ? ` ${title}` : ''}：${STATES[result.state]}`, ...fields, ...related].join('\n');
  }).join('\n'));
}
export function planText(plan: OperationPlan): string {
  if (plan.results) return resultLines(plan.results, plan) + (plan.stopped ? `\n后续操作已停止：${plan.stopped}；未知项先核对网站，勿重复提交。` : '');
  return displayText([`账户：${plan.accountId}`, ...plan.actions.flatMap(action => [
    `#${action.subjectId} ${action.title}`,
    ...action.changes.map(change => `  ${fieldLabel(change.field)}：${valueText(change.field, change.before)} → ${valueText(change.field, change.after)}`),
    ...action.effects.map(change => `  附带影响 ${fieldLabel(change.field)}：${valueText(change.field, change.before)} → ${valueText(change.field, change.after)}`),
    ...(action.notice ? [`  ${action.notice}`] : []),
  ]), ...(plan.requiresConfirmation ? [`需确认：${plan.reasons.join('；')}`] : ['明确单项请求，按既有授权执行。']),
    ...(!plan.writeAvailable ? ['此入口仅预览，确认也不会修改账户。'] : [])].join('\n'));
}
export const TOOL_LABELS: Record<string,string> = {
  list_collections: '读取收藏列表', get_collection_summary: '读取并统计收藏',
  search_subjects: '搜索作品', get_subject: '读取作品详情', get_collection: '读取个人收藏', request_subject_selection: '等待选择作品',
  list_episodes: '读取章节', get_progress: '读取原生进度', resolve_reference: '解析作品指代',
  preview_collection_changes: '规划收藏变更', preview_progress_changes: '规划进度变更',
  propose_dialogue_request: '解析修改请求',
};
export function toolLabel(name: string): string { return TOOL_LABELS[name] ?? '处理作品请求'; }
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(1, width); const lines: string[] = [];
  for (const source of displayText(text).replace(/\t/g, '  ').split('\n')) {
    let line = ''; let size = 0;
    for (const { segment } of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(source)) {
      const next = stringWidth(segment);
      if (size && size + next > limit) { lines.push(line); line = ''; size = 0; }
      line += segment; size += next;
    }
    lines.push(line);
  }
  return lines;
}
