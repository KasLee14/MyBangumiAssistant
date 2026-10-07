import { useCallback, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { UserBubble } from '../../components/mainPage/conversation/MessageParts';
import { ComposerSeat } from '../../components/mainPage/composer/ComposerSeat';
import { Hero } from '../../components/mainPage/conversation/Hero';
import { Stage } from '../../components/mainPage/conversation/Stage';
import { DialogStage } from '../../components/mainPage/overlays/DialogStage';
import { Toast } from '../../components/mainPage/overlays/Toast';
import { CollapseBubbles } from '../../components/mainPage/shell/CollapseBubbles';
import { Sidebar } from '../../components/mainPage/shell/Sidebar';
import { draftSet, processToggled } from '../../store/actions';
import { useActions, useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectDisplayedContent, selectHeroPhase, selectPacedTail } from '../../store/selectors';

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
  // 正文读**显示投影**而不是权威值：上游以突发批次下发，摊平由 store/pacing.ts 按时间推进。
  const liveContent = useAppSelector(selectDisplayedContent);
  const liveThinking = useAppSelector(state => state.stream.liveThinking);
  const busy = useAppSelector(state => state.stream.busy);
  const status = useAppSelector(state => state.stream.status);
  const cancelling = useAppSelector(state => state.stream.cancelling);
  const startedAt = useAppSelector(state => state.stream.startedAt);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const pendingEcho = useAppSelector(state => state.stream.pendingEcho);
  // 收尾播放：历史条目里已经落库的同一段回答要让位给流式区（见 Stage 的同名 prop）。
  const pacedTail = useAppSelector(selectPacedTail);
  const reveal = useAppSelector(state => state.ui.reveal);
  /** 过程区的展开状态表：整轮与单个过程行共用同一张表（键不同，见 `utils/process.ts`）。 */
  const openMap = useAppSelector(state => state.ui.processOpen);
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const heroPhase = useAppSelector(selectHeroPhase);

  /**
   * 过程开合：整轮与单行是同一个动作（只差键的形态）。
   *
   * `useCallback` 是必要的——`Turn` 与 `ProcessGroup` 都是 `memo`，每次都新建回调会让它们
   * 在流式帧里全部重渲染，把 `Stage` 那层「引用稳定 → 跳过历史轮次」的优化抵消掉。
   */
  const toggleProcess = useCallback((key: string, open: boolean): void => {
    dispatch(processToggled(key, open));
  }, [dispatch]);

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
            pacedTail={pacedTail}
            openMap={openMap}
            onToggleProcess={toggleProcess}
            onToggleRow={toggleProcess}
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
