import { useEffect, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { ComposerSeatV2 } from '../../components/v2/composer/ComposerSeatV2';
import { HeroV2 } from '../../components/v2/conversation/HeroV2';
import { StageV2 } from '../../components/v2/conversation/StageV2';
import { DialogStageV2 } from '../../components/v2/overlays/DialogStageV2';
import { ToastV2 } from '../../components/v2/overlays/ToastV2';
import { HeaderV2 } from '../../components/v2/shell/HeaderV2';
import { SidebarV2 } from '../../components/v2/shell/SidebarV2';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectHeroPhase } from '../../store/selectors';

/**
 * v2 主界面外壳：动效版的装配。
 *
 * 与 `ShellV1` 承载同样的区域与同样的数据，区别在组件、类名、样式与动效全部
 * 另起一套。两版共用同一份 store 与同一套订阅（订阅在 `page/mainPage/index.tsx`），
 * 因此「功能一致」由数据来源保证，切换外观不会重连宿主、不会重取会话。
 *
 * `MotionConfig reducedMotion="user"`：系统开了「减少动态效果」时，motion 会自动
 * 跳过位移/缩放类动画，只保留透明度过渡。v1 的 CSS 也有同样的降级（frame.css 末尾
 * 的 `prefers-reduced-motion` 段），两版行为一致。
 */
export function ShellV2(): ReactNode {
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

  /*
   * 外观作用域属性：写在 <html> 上而不是这棵子树的根节点上，因为统计浮层与弹窗
   * 是 portal 到 body 的——属性挂在子树里，它们就落在作用域之外，v2 的覆写会失效。
   * `main.tsx` 已在首帧前预置一次，这里只负责在运行期（切到 v2 / 切回 v1）同步。
   */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset['ui'] = 'v2';
    return () => { delete root.dataset['ui']; };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="v2Frame" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <SidebarV2 />
        <main className="v2Conversation">
          <HeaderV2 />
          <StageV2
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
            composer={<ComposerSeatV2 />}
            hero={heroPhase ? <HeroV2 /> : undefined}
            pendingEcho={pendingEcho === null ? undefined : <UserBubble key="pending-echo" text={pendingEcho.text} />}
          />
        </main>
        <DialogStageV2 />
        <ToastV2 />
      </div>
    </MotionConfig>
  );
}
