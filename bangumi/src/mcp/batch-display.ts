import type { Data } from './resource-output.js';

const data = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const text = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
const labels: Record<string, string> = { success: '已核实', submitted: '已提交待核实', unchanged: '无需修改', skipped: '跳过', failed: '失败', unknown: '待核实', blocked: '依赖阻塞', not_executed: '未执行' };

/** CLI/TUI只展示公开事实摘要，完整原值与提交回执仍留给模型和事实记录。 */
export function formatBatchFeedback(raw: unknown): string {
  const value = data(raw), summary = data(value.summary);
  const parts = Object.entries(labels).flatMap(([state, label]) => Number(summary[state]) > 0 ? [`${label} ${summary[state]} 项`] : []);
  const rows = Array.isArray(value.items) ? value.items.map(data) : [];
  const stages = rows.flatMap(row => Array.isArray(row.stageResults) ? row.stageResults.map(data) : []);
  if (stages.length && rows.some(row => Array.isArray(row.stageResults) && row.stageResults.length > 1)) {
    parts.push(`子项：${Object.entries(labels).flatMap(([state, label]) => {
      const count = stages.filter(stage => stage.state === state).length; return count ? [`${label} ${count}`] : [];
    }).join('，')}`);
  }
  const lines = [parts.join('，') || (value.state === 'running' ? '正在准备修改计划。' : '本次没有可执行操作。')];
  if (value.phase === 'rate_limit_wait') {
    const waiting = data(value.waiting);
    const at = typeof waiting.nextAllowedAt === 'number' ? new Date(waiting.nextAllowedAt) : undefined;
    lines.unshift(`等待写入额度${at && Number.isFinite(at.getTime()) ? `，预计 ${at.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false })} 恢复` : ''}；可停止，已提交部分仍会核实。`);
  }
  const explain = (row: Data, step: unknown, child = false) => {
    if (!['skipped', 'failed', 'unknown', 'blocked', 'not_executed'].includes(String(row.state))) return;
    const target = data(row.target), error = data(row.error ?? row.submissionError ?? row.verificationError);
    const name = target.name ?? target.title ?? (target.id ?? target.subjectId ? `对象 #${target.id ?? target.subjectId}` : '');
    lines.push(`第 ${step} 步${child ? ` 子项 ${row.stage}` : ''}${name ? ` ${text(name)}` : ''}：${labels[String(row.state)]}；${text(row.reason ?? error.message ?? '前置操作或保护范围未满足')}`);
  };
  for (const row of rows) { explain(row, row.step); for (const stage of Array.isArray(row.stageResults) ? row.stageResults.map(data) : []) explain(stage, row.step, true); }
  if (value.error) lines.push(text(data(value.error).message));
  return lines.join('\n');
}
