import { memo, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import type { MessageBlock } from '../../../../bangumi/src/web/protocol';
import { Stage } from '../../components/mainPage/conversation/Stage';
import type { RootState } from '../../store/reducers';

/**
 * 调试页右侧的预览区。
 *
 * 只做两件事：给 `<Stage>` 提供受控的流式文本与标量，以及一条说明当前依据的提示条。
 * 「预览就是真实渲染」这条靠复用 `<Stage>` 保证——这里不新增任何渲染逻辑，
 * 所以调试页看到的形态与真实会话完全一致（含 `Turn` 的 memo 与内容条目的入场）。
 *
 * 标量从调试专用 store 读（外层已经套了 `<Provider store={debugStore}>`），
 * 因此这里的 `useSelector` 读到的不是真实会话。
 */

export interface DebugPreviewProps {
  /** 受控的流式内容块：逐字播放由调用方驱动，不读 store 里的 liveContent。 */
  liveBlocks: MessageBlock[];
  /** 当前依据，用于提示条。 */
  source: 'event' | 'frame' | 'none';
  /** 是否有可渲染的输入：决定空态提示。 */
  hasInput: boolean;
  playing: boolean;
  frameCount: number;
  eventCount: number;
  reveal: number;
  onReveal(): void;
  /** 立即结束在途播放（长文本时不用等）。 */
  onSkip(): void;
}

export const DebugPreview = memo(function DebugPreview({
  liveBlocks, source, hasInput, playing, frameCount, eventCount, reveal, onReveal, onSkip,
}: DebugPreviewProps): ReactNode {
  const scalars = useSelector((state: RootState) => state.stream);
  const items = useSelector((state: RootState) => state.stream.items);

  return (
    <main className="appConversation">
      <div className="debugPreviewBar">
        <span>预览</span>
        <span className="debugBadge">
          {source === 'event' ? 'event 通道' : source === 'frame' ? 'frame 通道' : '等待输入'}
        </span>
        <span>帧 {frameCount} 条　event {eventCount} 条</span>
        <button
          type="button"
          className="debugButton"
          data-compact="true"
          onClick={onReveal}
          title="展开过程折叠块，等价于会话里的 /details"
        >
          展开过程
        </button>
        {playing ? (
          <button
            type="button"
            className="debugButton"
            data-compact="true"
            onClick={onSkip}
            title="跳过剩余动画，直接显示这一帧的最终内容"
          >
            跳过动画
          </button>
        ) : null}
      </div>
      <Stage
        items={items}
        liveContent={liveBlocks}
        liveThinking={scalars.liveThinking}
        busy={scalars.busy}
        status={scalars.status}
        cancelling={scalars.cancelling}
        startedAt={scalars.startedAt}
        sessionId={scalars.sessionId}
        reveal={reveal}
        onConfirm={() => { /* 调试页不应答写入确认：那需要宿主。 */ }}
        onReject={() => { /* 同上。 */ }}
        {...(hasInput ? {} : { hero: <DebugHero /> })}
      />
    </main>
  );
});

/** 空态提示：说清两个输入框的关系，避免把「没反应」当成坏了。 */
function DebugHero(): ReactNode {
  return (
    <div className="debugHero">
      <div className="debugHeroTitle">调试预览</div>
      <p>在左侧填入 <code>event</code>（宿主 handleEvent 的入参）或 <code>frame</code>（onFrame 的入参），点「预览」。</p>
      <p>两个都填时，以 <code>event</code> 为准；<code>event</code> 会自动生成对应的 <code>frame</code> 并填入左侧输入框。</p>
    </div>
  );
}
