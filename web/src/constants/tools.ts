import type { ToolState } from '../types/protocol';

/**
 * 工具行的视觉表：六种状态的记号与文案。
 *
 * 分工：宿主导出**文案与载荷**（工具标题、参数摘要、结果内容块），这里只决定**怎么画**
 * ——状态记号。新增一种状态只改这张表。判定函数（`toolBodyKind` / `toolExpandable`）
 * 留在 `utils/toolViews.ts`：常量是零依赖的表，函数属于工具层。
 */
export const TOOL_STATE: Readonly<Record<ToolState, { mark: string; label: string }>> = {
  running: { mark: '·', label: '进行中' },
  waiting: { mark: '…', label: '额度等待' },
  ok: { mark: '✓', label: '完成' },
  partial: { mark: '!', label: '未全部完成' },
  unknown: { mark: '?', label: '结果待核实' },
  error: { mark: '×', label: '失败' },
};
