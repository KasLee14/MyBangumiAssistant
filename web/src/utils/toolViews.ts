import type { ToolItemView } from '../types/protocol';
import type { ToolBodyKind } from '../types/tools';

/**
 * 工具行的视觉表。
 *
 * 分工：宿主导出**文案与载荷**（工具标题、参数摘要、结果内容块），这里只决定**怎么画**
 * ——状态记号与展开体类型。新增一种状态或一种展开体，只改这张表。
 */

/**
 * 判定展开体类型。
 *
 * 优先级即信息量优先级：结构化内容块 > 纯文本 > 什么都没有。`blocks` 与 `text` 可能同时
 * 存在（结果结构化之后仍留了文本兜底），此时内容块更完整，文本只作为失败原因的补充显示。
 */
export function toolBodyKind(item: ToolItemView): ToolBodyKind {
  const result = item.result;
  if (result === undefined) return 'empty';
  if (result.blocks.length > 0) return 'blocks';
  if (result.text !== undefined && result.text.trim().length > 0) return 'text';
  return 'empty';
}

/** 这一行是否有可展开的内容（没有就不渲染展开钮，避免点了没反应）。 */
export function toolExpandable(item: ToolItemView): boolean {
  if (item.subCalls !== undefined && item.subCalls.length > 0) return true;
  if (item.argsText !== undefined && item.argsText.trim().length > 0) return true;
  return toolBodyKind(item) !== 'empty';
}
