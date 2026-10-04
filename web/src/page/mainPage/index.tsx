import type { ReactNode } from 'react';
import { useAppSelector } from '../../store/hooks';
import { selectVariant } from '../../store/selectors';
import {
  useCatalogSync,
  useEscapeShortcut,
  useResponsiveCollapse,
} from '../../store/hooks';
import { useStreamSubscription } from '../../store/stream';
import { ShellV1 } from './ShellV1';
import { ShellV2 } from './ShellV2';

/**
 * 主界面薄壳：生命周期订阅 + 外观版本分流。
 *
 * 四个订阅各管一件事，且都只在主界面挂载时生效（与新增 v2 之前完全一致）：
 * - `useStreamSubscription` 建立宿主事件流；
 * - `useCatalogSync` 在首屏与会话切换后重取目录；
 * - `useResponsiveCollapse` 按窗口宽度收放侧栏；
 * - `useEscapeShortcut` 处理 Esc 的「停止本轮 / 拒绝确认」。
 *
 * 订阅**必须留在这一层**：它们驱动的是 store 里的共享状态（会话流、目录、侧栏、
 * Esc），与外观版本无关。放在外壳里会让切换版本时重建事件流——那是真的重连宿主，
 * 不是一次外观切换。
 *
 * 这里只做一件事：按 `store.ui.variant` 选一棵外壳树。两棵树的组件、样式与动效
 * 完全独立，共用同一份 store 与同一套订阅，因此「功能一致」由数据来源保证，
 * 而不是靠两份代码手工对齐。
 */
export function MainPage(): ReactNode {
  useStreamSubscription();
  useCatalogSync();
  useResponsiveCollapse();
  useEscapeShortcut();

  const variant = useAppSelector(selectVariant);
  return variant === 'v2' ? <ShellV2 /> : <ShellV1 />;
}
