import type { ReactNode } from 'react';

/**
 * 逐项错峰入场容器（短列表用）。
 *
 * 参数（55ms 间隔、spring 曲线、8px 位移）全部来自令牌：
 * CSS 侧是 `--app-stagger` / `--app-ease-spring` / `--app-shift-row`，
 * JS 侧是 `components/motion/motionTokens.ts` 的 `STAGGER` 等常量。
 * 这里不写死任何数值。
 *
 * 长列表（会话轮次、长表格）不要用它——最后一项会等太久，用一次性入场。
 */
export interface StaggerProps {
  children?: ReactNode;
  className?: string | undefined;
}

export function Stagger({ children, className = '' }: StaggerProps): ReactNode {
  return <div className={`appStagger ${className}`.trim()}>{children}</div>;
}
