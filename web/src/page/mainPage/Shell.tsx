import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { ComposerSeat } from '../../components/mainPage/composer/ComposerSeat';
import { Hero } from '../../components/mainPage/conversation/Hero';
import { Stage } from '../../components/mainPage/conversation/Stage';
import { DialogStage } from '../../components/mainPage/overlays/DialogStage';
import { Toast } from '../../components/mainPage/overlays/Toast';
import { CollapseBubbles } from '../../components/mainPage/shell/CollapseBubbles';
import { Sidebar } from '../../components/mainPage/shell/Sidebar';
import { draftSet } from '../../store/actions';
import { useActions, useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectHeroPhase } from '../../store/selectors';

/**
 * 主界面外壳：唯一的装配点。
 *
 * [C01](../../docs/design/decisions/C01-app-top-bar.md) 删掉顶栏之后，外壳只有两列：
 * **侧栏 | 对话区**。侧栏承载全部应用级入口（品牌、新建、会话列表、用户行），
 * 对话区就是消息流与输入卡；收起态的两个气泡绝对定位在 `.appFrame` 上（不参与 grid）。
 *
 * 只做两件事：从 store 取数据、按槽位交给组件。业务逻辑一律不在这里——
 * 唯一的例外是首屏那两枚入口：示例点击要写输入草稿（全局状态）、
 * 「设置」要开设置弹窗（[C45](../../docs/design/decisions/C45-settings-entry.md) 定稿 ③），
 * 两者都在这里注入回调，让 `Hero` 保持 props 驱动（`components/mainPage/conversation/**` 不读 store）。
 *
 * `MotionConfig reducedMotion="user"`：系统开了「减少动态效果」时，motion 会自动
 * 跳过位移/缩放类动画，只保留透明度过渡；CSS 侧还有 `frame.css` 末尾的
 * `prefers-reduced-motion` 段做同样的降级。
 */
export function Shell(): ReactNode {
  const actions = useActions();
  const dispatch = useAppDispatch();
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
            // C34 决策：删掉会话头槽位——对话区顶部不再有标题行（会话标题只由侧栏表态）。
            composer={<ComposerSeat />}
            hero={heroPhase
              ? (
                <Hero
                  onPick={text => { dispatch(draftSet(sessionId, text)); }}
                  onOpenSettings={() => { void actions.openSettings(null).catch(() => { /* 失败已提示。 */ }); }}
                />
              )
              : undefined}
            pendingEcho={pendingEcho === null ? undefined : <UserBubble key="pending-echo" text={pendingEcho.text} />}
          />
        </main>
        <CollapseBubbles />
        <DialogStage />
        <Toast />
      </div>
    </MotionConfig>
  );
}
