import type { ReactNode } from 'react';
import type { ToolFamily } from '../../../../../bangumi/src/web/protocol';

/**
 * 过程区的图标：14px、`stroke="currentColor"`、`fill="none"`、线宽 1.4。
 *
 * 为什么自绘而不是复用 `shell/icons.tsx`：那三个图标服务侧栏（Panel / Edit / Gear），
 * 尺寸与语义都不同；过程区的图标按**工具族**区分，是另一张表（`utils/toolViews.ts` 之外
 * 只多这一份几何形状）。用 SVG 而不是字形：字形的宽高与基线随字体变化，在 14px 的流水行
 * 里对不齐（同一条理由见 `Streaming` 对流式光标的说明）。
 */

const PATHS: Readonly<Record<ToolFamily, ReactNode>> = {
  // 放大镜
  search: (<><circle cx="6.2" cy="6.2" r="3.7" /><path d="M9 9l3 3" /></>),
  // 文档 + 折角
  detail: (<><path d="M3.5 2.5h5l2.5 2.5v6.5h-7.5z" /><path d="M8.5 2.5V5H11" /></>),
  // 列表
  list: (<><path d="M5 4h6.5M5 7h6.5M5 10h6.5" /><circle cx="2.9" cy="4" r=".7" /><circle cx="2.9" cy="7" r=".7" /><circle cx="2.9" cy="10" r=".7" /></>),
  // 图片框
  image: (<><rect x="2.5" y="3" width="9" height="8" rx="1.4" /><circle cx="5.4" cy="5.9" r=".9" /><path d="M2.9 9.6l2.6-2.2 2.4 1.7 1.6-1.2 1.9 1.5" /></>),
  // 日历
  calendar: (<><rect x="2.5" y="3.2" width="9" height="7.8" rx="1.4" /><path d="M2.5 5.8h9M5 2.2v2M9 2.2v2" /></>),
  // 铅笔
  write: (<><path d="M3 11l.7-2.4 5.2-5.2 1.7 1.7-5.2 5.2z" /><path d="M8.4 3.9l1.7 1.7" /></>),
  // 计划 + 勾
  batch: (<><path d="M2.5 4h6.5M2.5 7h6.5M2.5 10h3.5" /><path d="M8.6 10.2l1.3 1.3 2.4-2.9" /></>),
  // 漏斗
  candidate: (<path d="M2.5 3h9l-3.4 4.2v3.4l-2.2 1.3V7.2z" />),
  // 靶心
  single: (<><circle cx="7" cy="7" r="4.2" /><circle cx="7" cy="7" r="1.1" /></>),
  // 方框 + 横线（兜底）
  tools: (<><rect x="3" y="3" width="8" height="8" rx="2" /><path d="M5.3 7h3.4" /></>),
};

export function ProcessIcon({ family, className }: { family: ToolFamily; className: string }): ReactNode {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[family]}
    </svg>
  );
}

/** 思考行的图标：一个四角星（「想到点子」的通用记号，不表达业务）。 */
export function ReasoningIcon({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2.4l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" />
    </svg>
  );
}

/** 展开指示的箭头（折叠态朝右，展开态由 CSS 转到朝下）。 */
export function ChevronIcon({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
