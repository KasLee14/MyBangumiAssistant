import type { ReactNode } from 'react';
import {
  useCatalogSync,
  useEscapeShortcut,
  useResponsiveCollapse,
} from '../../store/hooks';
import { useStreamSubscription } from '../../store/stream';
import { Shell } from './Shell';

/**
 * 主界面薄壳：四个生命周期订阅 + 外壳装配。
 *
 * 四个订阅各管一件事，且都只在主界面挂载时生效：
 * - `useStreamSubscription` 建立宿主事件流；
 * - `useCatalogSync` 在首屏与会话切换后重取目录；
 * - `useResponsiveCollapse` 按窗口宽度收放侧栏；
 * - `useEscapeShortcut` 处理 Esc 的「停止本轮 / 拒绝确认」。
 *
 * 订阅**必须留在这一层**：它们驱动的是 store 里的共享状态（会话流、目录、侧栏、
 * Esc），与外壳内部的结构无关；放到外壳里会让外壳的任何一次重挂载都重建事件流。
 */
export function MainPage(): ReactNode {
  useStreamSubscription();
  useCatalogSync();
  useResponsiveCollapse();
  useEscapeShortcut();

  return <Shell />;
}
