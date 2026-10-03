import type { ReactNode } from 'react';
import { ComposerSlot } from '../../components/mainPage/composer/ComposerSlot';
import { ConversationView } from '../../components/mainPage/conversation/ConversationView';
import { Hero } from '../../components/mainPage/conversation/Hero';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { Header } from '../../components/mainPage/header/Header';
import { DialogHost } from '../../components/mainPage/overlays/DialogHost';
import { Toast } from '../../components/mainPage/overlays/Toast';
import { Sidebar } from '../../components/mainPage/sidebar/Sidebar';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectHeroPhase } from '../../store/selectors';

/**
 * v1 主界面外壳：既有外观的装配。
 *
 * 从 `index.tsx` 移出来的原因是页面层现在要多一步「选哪一版」：订阅与分流留在
 * `index.tsx`，两版各自的装配在这里与 `ShellV2.tsx` 各自成文件。**这里的 JSX 与
 * 数据读取逐字保持原样**——v1 的外观与行为不因为新增 v2 而改变。
 *
 * 唯一的外来变化是顶栏多了一个外观切换按钮（`UiVariantToggle`），那是「能切回
 * 旧版」这个需求本身要求的入口，见 `components/mainPage/header/Header.tsx`。
 */
export function ShellV1(): ReactNode {
  const actions = useActions();
  const items = useAppSelector(state => state.stream.items);
  const liveText = useAppSelector(state => state.stream.liveText);
  const liveThinking = useAppSelector(state => state.stream.liveThinking);
  const busy = useAppSelector(state => state.stream.busy);
  const status = useAppSelector(state => state.stream.status);
  const cancelling = useAppSelector(state => state.stream.cancelling);
  const startedAt = useAppSelector(state => state.stream.startedAt);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const pendingEcho = useAppSelector(state => state.stream.pendingEcho);
  const reveal = useAppSelector(state => state.ui.reveal);
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const heroPhase = useAppSelector(selectHeroPhase);

  return (
    <div className="frame" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar />
      <main className="conversation">
        <Header />
        {/* 会话视图的两个槽位：内容由页面决定，渲染位置与形态仍在 ConversationView 内，
            因此首屏引导与乐观回显不会各自长成另一份实现。
            输入区槽位只给组件：输入卡与接管卡片（如写入确认）之间的取舍由 ComposerSlot
            自己判定并渲染，页面这里不做分支。 */}
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
          composer={<ComposerSlot />}
          hero={heroPhase ? <Hero /> : undefined}
          pendingEcho={pendingEcho === null ? undefined : <UserBubble key="pending-echo" text={pendingEcho.text} />}
        />
      </main>
      <DialogHost />
      <Toast />
    </div>
  );
}
