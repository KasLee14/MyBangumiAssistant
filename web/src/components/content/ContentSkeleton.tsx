import type { ReactNode } from 'react';

/**
 * 内容块的骨架。
 *
 * 只在块处于 `pending`（载荷还在传）时出现。它与**降级卡**是两件事：降级卡表示
 * 「数据到了、但不合法」，骨架表示「还没到」——所以骨架期不校验载荷，也不显示任何提示。
 *
 * 三处刻意设计：
 * 1. **与 kind 无关**：骨架期载荷可能一个字段都没有，按 12 种 kind 各画一套既没有依据、
 *    也没有收益（将来某个 kind 需要专属骨架，再加可选 props 即可）；
 * 2. **扫光由 `aria-busy` 开关**（[C17](../../docs/design/decisions/C17-content-skeleton.md) 定稿 B）：
 *    这里无条件带 `aria-busy="true"`，扫光挂在 `[aria-busy='true']` 上——语义本身就是开关，
 *    容器还有 `prefers-reduced-motion` 的兜底。此前写的是「不做无限扫光」，那是被推翻的 A 方案；
 * 3. **不要求与真实块等高**：强求等高会在替换那一帧引入 layout 抖动，只用 `min-height` 兜底。
 */
export function ContentSkeleton(): ReactNode {
  return (
    <div
      className="contentBlock contentSkeleton"
      role="status"
      aria-busy="true"
      aria-label="正在接收内容"
    >
      <div className="contentSkeletonBar contentSkeletonTitle" />
      <div className="contentSkeletonBar" />
      <div className="contentSkeletonBar contentSkeletonShort" />
    </div>
  );
}
