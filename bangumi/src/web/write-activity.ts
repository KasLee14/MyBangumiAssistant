import type { ActivityItemView } from './protocol.js';

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const line = (value: unknown, limit = 240): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim().slice(0, limit) : '';
const count = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
const statuses: Record<string, string> = {
  success: '已核实', submitted: '已提交待核实', unchanged: '无需修改', skipped: '已跳过',
  failed: '失败', unknown: '结果待核实', blocked: '依赖阻塞', not_executed: '未执行',
};
const reasons: Record<string, string> = {
  BGM_HTTP_404: '当前可见范围未取得资源', PERMISSION_DENIED: '当前账户无权修改该对象',
  DEPENDENCY_FAILED: '前序依赖未完成', DEPENDENCY_BLOCKED: '前序依赖未完成',
  WRITE_CONFLICT_UNKNOWN: '同一范围有尚未核实的写入', PREVIOUS_WRITE_UNKNOWN: '同一范围有尚未核实的写入',
};
const actions: Record<string, string> = {
  Subject: '作品收藏', Episode: '章节状态', Character: '角色收藏', Person: '人物收藏',
  Index: '目录收藏', IndexEdit: '目录编辑',
};
function reason(item: Data): string {
  const error = object(item.error ?? item.submissionError ?? item.verificationError);
  const raw = object(item.reason);
  return line(error.message ?? raw.message) || reasons[String(error.code ?? raw.code ?? item.reason)]
    || line(item.reason) || line(error.code);
}
function targetName(item: Data): string {
  const target = object(item.target);
  const name = line(target.name ?? target.title, 120);
  const episodeIds = Array.isArray(target.episodeIds) ? target.episodeIds.filter(id => Number.isSafeInteger(id) && Number(id) > 0) : [];
  if (episodeIds.length) return `${name ? `《${name}》 ` : ''}章节 ID ${episodeIds.join('、')}`;
  const id = target.subjectId ?? target.id ?? target.episodeId ?? target.indexId
    ?? item.subjectId ?? item.episodeId ?? item.indexId;
  return name ? `《${name}》` : typeof id === 'number' && id > 0 ? `对象 ID ${id}` : '';
}
function blockedSteps(item: Data): string {
  const values = Array.isArray(item.blockedBy) ? item.blockedBy : item.blockedBy === undefined ? [] : [item.blockedBy];
  const steps = values.map(value => typeof value === 'number' ? value : object(value).step)
    .filter(value => Number.isSafeInteger(value) && Number(value) > 0);
  return steps.length ? `（依赖第 ${steps.join('、')} 步）` : '';
}
function itemLine(item: Data, step: unknown, prefix = ''): string {
  const at = Number.isSafeInteger(step) && Number(step) > 0 ? `第 ${step} 步` : '操作';
  const name = targetName(item);
  const status = statuses[String(item.state)] ?? '未完成';
  const explanation = reason(item);
  return `${prefix}${at}${name ? ` ${name}` : ''}：${status}${blockedSteps(item)}${explanation ? `；${explanation}` : ''}`;
}

/** 只投影批次结果的公开事实；不把回执、guard、完整原值和正文作为界面主反馈。 */
export function projectWriteActivity(result: unknown, final = false): Pick<ActivityItemView, 'state' | 'detail' | 'showDetail'> | undefined {
  const envelope = object(result);
  const value = object(object(envelope.details).value ?? object(envelope.structuredContent).value ?? envelope.value);
  if (typeof value.state !== 'string') return undefined;
  const summary = object(value.summary);
  const counts = Object.fromEntries(Object.keys(statuses).map(key => [key, count(summary[key])]));
  const parts = Object.entries(statuses).flatMap(([key, label]) => counts[key] ? [`${label} ${counts[key]} 项`] : []);
  let detail = parts.join('，') || (final ? '本次计划未完成。' : '正在准备完整计划。');
  if (!final && value.phase === 'rate_limit_wait') {
    const waiting = object(value.waiting);
    const at = typeof waiting.nextAllowedAt === 'number' && Number.isFinite(waiting.nextAllowedAt) ? new Date(waiting.nextAllowedAt) : undefined;
    const time = at && !Number.isNaN(at.getTime()) ? new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(at) : '';
    detail = `${actions[String(waiting.action)] ?? '写入'}额度等待${time ? `，预计 ${time} 恢复（香港时间）` : ''}；${detail}。可按 Esc 停止，已提交部分仍会核实。`;
    return { state: 'waiting', detail, showDetail: true };
  }
  if (!final) return { state: 'running', detail, showDetail: true };
  const items = Array.isArray(value.items) ? value.items.map(object) : [];
  const stages = items.flatMap(item => Array.isArray(item.stageResults) ? item.stageResults.map(object) : []);
  if (stages.length) {
    const stageCounts = Object.entries(statuses).flatMap(([key, label]) => {
      const amount = stages.filter(stage => stage.state === key).length;
      return amount ? [`${label} ${amount} 项`] : [];
    });
    if (stageCounts.length) detail = `操作：${detail}\n子项：${stageCounts.join('，')}`;
  }
  const issueStates = new Set(['skipped', 'failed', 'unknown', 'blocked', 'not_executed']);
  const issues = items.filter(item => issueStates.has(String(item.state))).map(item => itemLine(item, item.step));
  for (const item of items) {
    if (!Array.isArray(item.stageResults)) continue;
    for (const raw of item.stageResults) {
      const stage = object(raw);
      if (issueStates.has(String(stage.state)) || item.state !== 'success' && item.state !== 'unchanged') {
        issues.push(itemLine(stage, item.step, `子项 ${stage.stage ?? stage.offset ?? ''}：`));
      }
    }
  }
  if (issues.length) detail += `\n${issues.join('\n')}`;
  const batchError = reason({ error: value.error });
  if (batchError) detail += `\n本次计划：${batchError}`;
  const missing = counts.skipped! + counts.failed! + counts.blocked! + counts.not_executed!;
  const completed = counts.success! + counts.unchanged!;
  const state: ActivityItemView['state'] = value.state === 'unknown' || counts.unknown! > 0 ? 'unknown'
    : value.state === 'partial' || missing > 0 && (completed > 0 || counts.skipped! > 0 || counts.blocked! > 0) ? 'partial'
    : value.state === 'failed' || counts.failed! > 0 || counts.not_executed! > 0 ? 'error' : 'ok';
  return { state, detail, showDetail: true };
}
