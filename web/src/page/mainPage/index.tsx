import type { ReactNode } from 'react';
import { Composer } from '../../components/mainPage/composer/Composer';
import { ConfirmationCard } from '../../components/mainPage/conversation/ConfirmationCard';
import { ConversationView } from '../../components/mainPage/conversation/ConversationView';
import { Hero } from '../../components/mainPage/conversation/Hero';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { Header } from '../../components/mainPage/header/Header';
import { DialogHost } from '../../components/mainPage/overlays/DialogHost';
import { Toast } from '../../components/mainPage/overlays/Toast';
import { Sidebar } from '../../components/mainPage/sidebar/Sidebar';
import {
  useActions,
  useAppSelector,
  useCatalogSync,
  useEscapeShortcut,
  useResponsiveCollapse,
} from '../../store/hooks';
import { selectHeroPhase } from '../../store/selectors';
import { useStreamSubscription } from '../../store/stream';

/**
 * 主界面：布局装配与生命周期订阅，不含业务状态。
 *
 * 四个订阅各管一件事，且都只在主界面挂载时生效：
 * - `useStreamSubscription` 建立宿主事件流；
 * - `useCatalogSync` 在首屏与会话切换后重取目录；
 * - `useResponsiveCollapse` 按窗口宽度收放侧栏；
 * - `useEscapeShortcut` 处理 Esc 的「停止本轮 / 拒绝确认」。
 *
 * 其余一切（会话流、目录、弹窗、提示）都由 store 提供：这里只把切片接到
 * `ConversationView` 的 props 上；`ConversationView` 本身保持 props 驱动，
 * 不直接依赖 store。
 */
export function MainPage(): ReactNode {
  useStreamSubscription();
  useCatalogSync();
  useResponsiveCollapse();
  useEscapeShortcut();

  const actions = useActions();
  const items = useAppSelector(state => state.stream.items);
  const liveText = useAppSelector(state => state.stream.liveText);
  const liveThinking = useAppSelector(state => state.stream.liveThinking);
  const busy = useAppSelector(state => state.stream.busy);
  const status = useAppSelector(state => state.stream.status);
  const cancelling = useAppSelector(state => state.stream.cancelling);
  const startedAt = useAppSelector(state => state.stream.startedAt);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const pending = useAppSelector(state => state.stream.pending);
  const pendingEcho = useAppSelector(state => state.stream.pendingEcho);
  const reveal = useAppSelector(state => state.ui.reveal);
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const heroPhase = useAppSelector(selectHeroPhase);

  // 需要用户决定时接管输入区。写入确认只可能出现在工具执行期间（此时 busy
  // 为真），因此这里不能再看 busy，否则确认按钮永远不会出现。
  const takeover = pending ? (
    <div className="cardSeat">
      <ConfirmationCard
        confirmation={pending}
        busy={busy}
        showActions
        onConfirm={actions.confirm}
        onReject={actions.reject}
      />
    </div>
  ) : null;

  /**
   * 输入卡挂载在唯一位置（`.composerSeat`），首屏与活动态只靠容器的 `data-phase`
   * 切换外观。原先首屏把同一个元素渲染在 `.heroStack`、活动态渲染在 `.composerSeat`，
   * 状态翻转会让 textarea 被卸载重建，输入焦点与 IME 组合态一起丢失。
   */
  const composer = (
    <div className="composerSeat">
      {takeover ?? <Composer />}
    </div>
  );

  return (
    <div className="frame" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar />
      <main className="conversation">
        <Header />
        {/* 会话视图的两个槽位：内容由页面决定，渲染位置与形态仍在 ConversationView 内，
            因此首屏引导与乐观回显不会各自长成另一份实现。 */}
        <ConversationView
          items={items}
          liveText={liveText}
          liveThinking={liveThinking}
          busy={busy}
          status={status}
          cancelling={cancelling}
          startedAt={startedAt}
          sessionId={sessionId}
          reveal={reveal}
          onConfirm={actions.confirm}
          onReject={actions.reject}
          composer={composer}
          hero={heroPhase ? <Hero /> : undefined}
          pendingEcho={pendingEcho === null ? undefined : <UserBubble key="pending-echo" text={pendingEcho.text} />}
        />
      </main>
      <DialogHost />
      <Toast />
    </div>
  );
}
