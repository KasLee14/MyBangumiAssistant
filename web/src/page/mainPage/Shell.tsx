import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { ComposerSeat } from '../../components/mainPage/composer/ComposerSeat';
import { Hero } from '../../components/mainPage/conversation/Hero';
import { Stage } from '../../components/mainPage/conversation/Stage';
import { DialogStage } from '../../components/mainPage/overlays/DialogStage';
import { Toast } from '../../components/mainPage/overlays/Toast';
import { Header } from '../../components/mainPage/shell/Header';
import { Sidebar } from '../../components/mainPage/shell/Sidebar';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectHeroPhase } from '../../store/selectors';

/**
 * 主界面外壳：唯一的装配点。
 *
 * 只做两件事：从 store 取数据、按槽位交给组件。业务逻辑一律不在这里。
 *
 * `MotionConfig reducedMotion="user"`：系统开了「减少动态效果」时，motion 会自动
 * 跳过位移/缩放类动画，只保留透明度过渡；CSS 侧还有 `frame.css` 末尾的
 * `prefers-reduced-motion` 段做同样的降级。
 */
export function Shell(): ReactNode {
  const actions = useActions();
  const items = useAppSelector(state => state.stream.items);
  const liveContent = useAppSelector(state => state.stream.liveContent);
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
    <MotionConfig reducedMotion="user">
      <div className="appFrame" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <Sidebar />
        <main className="appConversation">
          <Header />
          <Stage
            items={items}
            liveContent={liveContent}
            liveThinking={liveThinking}
            busy={busy}
            status={status}
            cancelling={cancelling}
            startedAt={startedAt}
            sessionId={sessionId}
            reveal={reveal}
            onConfirm={actions.confirm}
            onReject={actions.reject}
            composer={<ComposerSeat />}
            hero={heroPhase ? <Hero /> : undefined}
            pendingEcho={pendingEcho === null ? undefined : <UserBubble key="pending-echo" text={pendingEcho.text} />}
          />
        </main>
        <DialogStage />
        <Toast />
      </div>
    </MotionConfig>
  );
}
