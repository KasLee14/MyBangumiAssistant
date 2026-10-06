import type { ReactNode } from 'react';

/**
 * 外壳图标（侧栏与收起态气泡共用）。
 *
 * 统一 16×16 显示、`fill="none"`、颜色一律 `currentColor`，
 * 描边粗细折算到屏幕上是 **1.4px**（见 `GearIcon`：它画在 24 网格上，线宽写 2.1）。
 * 规格只有这一处——同一个外壳里混用 1.2/1.3/1.5 会让图标看起来「有的粗有的细」。
 */
const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

/** 折叠 / 展开侧栏（横线组）。 */
export function PanelIcon(): ReactNode {
  return <svg {...ICON}><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

/** 新建会话（纸笔）。 */
export function EditIcon(): ReactNode {
  return (
    <svg {...ICON}>
      <path d="M2.8 13.2h10.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.2 10.4l6.6-6.6 2.2 2.2-6.6 6.6H4.2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 设置（齿轮）。
 *
 * 与上面两枚不同，这一枚画在 **24 网格**上：16 网格里塞 8 个齿 + 中心圆，缩到 16px
 * 显示会糊成一团。线宽按 `16 / 24` 折算，屏幕上的视觉线宽仍是图标族的 1.4px
 * （`2.1 × 16 / 24 = 1.4`）。画法由 [C45](../../docs/design/decisions/C45-settings-entry.md)
 * 的图标对照里「甲 · 描边齿轮（feather）」定稿。
 */
export function GearIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2.1" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
