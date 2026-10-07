import type { ToolFamily } from '../../../bangumi/src/web/protocol';
import type { ProcessItem } from './turns';

/**
 * 过程组的汇总与文案。
 *
 * **这里生成中文文案，是对「文案在宿主」那条约定的一处有意例外**：过程组的标题表达的是
 * 「这一刻正在发生什么」（正在搜索、正在思考），它随流式期的每一帧变化；让宿主每帧下发一句
 * 文案，等于给协议加一个高频字段，而且这条文案不涉及脱敏与业务语义。因此活动词留在前端，
 * 而**工具名、参数摘要、结果文本**仍由宿主导出（见 `bangumi/src/web/tool-view.ts`）。
 */

/** 过程项的族：工具族，或思考。 */
export type ProcessKind = ToolFamily | 'reasoning';

/** 过程组汇总：状态行的标题与计数都从这里来。 */
export interface ProcessSummary {
  readonly total: number;
  /** 各族计数，按数量降序（并列保持首次出现顺序）。 */
  readonly counts: readonly (readonly [ProcessKind, number])[];
  /** 正在进行的项（running / waiting）；没有时是 null。 */
  readonly active: ProcessItem | null;
}

/** 过程项的族。 */
export function processKind(item: ProcessItem): ProcessKind {
  return item.kind === 'reasoning' ? 'reasoning' : item.family;
}

/** 该项是否正在进行。 */
export function isProcessRunning(item: ProcessItem): boolean {
  return item.state === 'running' || item.state === 'waiting';
}

export function summarizeProcess(items: readonly ProcessItem[]): ProcessSummary {
  const counts = new Map<ProcessKind, number>();
  let active: ProcessItem | null = null;
  for (const item of items) {
    const kind = processKind(item);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (active === null && isProcessRunning(item)) active = item;
  }
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return { total: items.length, counts: sorted, active };
}

/** 进行中的活动词。 */
const RUNNING: Readonly<Record<ProcessKind, string>> = {
  calendar: '正在读取放送日历',
  search: '正在搜索',
  candidate: '正在筛选候选作品',
  detail: '正在读取资料',
  image: '正在获取图片',
  list: '正在读取列表',
  single: '正在查询',
  write: '正在修改收藏',
  batch: '正在执行修改计划',
  tools: '正在调用工具',
  reasoning: '正在思考',
};

/** 结束后的活动词（用于「已经做过什么」的汇总）。 */
const DONE: Readonly<Record<ProcessKind, string>> = {
  calendar: '读取放送日历',
  search: '搜索作品',
  candidate: '筛选候选作品',
  detail: '读取资料',
  image: '获取图片',
  list: '读取列表',
  single: '查询状态',
  write: '修改收藏',
  batch: '执行修改计划',
  tools: '调用工具',
  reasoning: '思考',
};

/** 取第一段非空文本的首行；去掉 Markdown 的加粗记号并压平空白。 */
export function firstLine(text: string, limit = 80): string {
  for (const raw of text.split('\n')) {
    const line = raw.replaceAll('**', '').replace(/\s+/gu, ' ').trim();
    if (line) return line.length > limit ? `${line.slice(0, limit)}…` : line;
  }
  return '';
}

/** 活跃项的细节：工具用宿主给的参数摘要，思考用它自己的首行。 */
export function processDetail(item: ProcessItem): string {
  return item.kind === 'tool' ? item.summary : firstLine(item.text, 60);
}

/**
 * 状态行标题（活跃态）：「正在搜索 · 攻壳机动队」。
 *
 * 没有正在进行的项时退回按族汇总（例如模型正在生成本步正文、过程已经跑完）。
 */
export function liveProcessTitle(summary: ProcessSummary): string {
  const active = summary.active;
  if (active === null) return settledProcessTitle(summary);
  const head = RUNNING[processKind(active)];
  const detail = processDetail(active);
  return detail ? `${head} · ${detail}` : head;
}

/**
 * 状态行标题（结束态）：「搜索作品、读取资料」。
 *
 * 只取前两族：过程组默认折叠，标题太长会挤掉右侧的耗时与计数。
 */
export function settledProcessTitle(summary: ProcessSummary): string {
  if (summary.counts.length === 0) return '处理过程';
  const parts = summary.counts.slice(0, 2).map(([kind, count]) => count > 1 ? `${DONE[kind]} ${count} 项` : DONE[kind]);
  const rest = summary.counts.length - parts.length;
  return rest > 0 ? `${parts.join('、')} 等` : parts.join('、');
}

/** 耗时文案；与 `Streaming` 的秒表口径一致（只显示整单位，不补前导零）。 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`;
}

/** 整轮过程的展开状态键。 */
export function turnProcessKey(turn: number): string {
  return String(turn);
}

/** 单个过程行（思考行或工具行）的展开状态键：用条目 id，避免同一步里思考与工具撞键。 */
export function processRowKey(turn: number, id: number): string {
  return `${turn}:${id}`;
}
