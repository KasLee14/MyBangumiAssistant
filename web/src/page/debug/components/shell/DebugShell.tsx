import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { AppTopBar, AppTopBarTab } from '../../../../components/AppTopBar';
import { PATH } from '../../../../constants/paths';
import { INITIAL_ROOT_STATE } from '../../../../store/reducers';
import type { MessageBlock } from '../../../../types/protocol';
import { DEBUG_INSTANCE_ID, KEEP, SUPPORTED_EVENTS } from '../../constants/simulator';
import type { SimFrame } from '../../types/simulator';
import { parseInputs, CHARS_PER_TICK, PLAY_BUDGET_TICKS, TICK_MS } from '../../utils/playback';
import { applyEvents, createSimulatorState, type SimulatorState } from '../../utils/simulator';
import type { DebugStore } from '../../utils/store';
import { DebugInputPanel } from '../input/DebugInputPanel';
import { DebugPreview } from '../preview/DebugPreview';

/**
 * 调试页的壳：三行装配（顶栏 / 输入列 / 预览区）+ 全部播放状态。
 *
 * 状态为什么留在这一层而不是各自下放：`eventText`、`frameText`、`displayBlocks`、`playing`
 * 是**同一件事的三个视角**（输入 → 提交的帧 → 正在演的块），拆开就得靠回调互相回灌。
 * 往下一层（`DebugInputPanel` / `DebugPreview`）只传值与本层的回调，它们保持纯 props 驱动。
 *
 * `displayBlocks` 是**受控**的流式块数组：`Stage` 显示它，而不是读 store 里的
 * `liveContent`——因为逐字播放发生在 reducer 之外，store 里只保留「已提交帧」的状态。
 */
export function DebugShell({ store }: { store: DebugStore }): ReactNode {
  const navigate = useNavigate();
  const simulator = useRef<SimulatorState>(createSimulatorState());
  const [displayBlocks, setDisplayBlocks] = useState<MessageBlock[]>([]);
  const [eventText, setEventText] = useState('');
  const [frameText, setFrameText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [reveal, setReveal] = useState(0);
  /** 播放令牌：新一次预览或重置会让在途播放立即失效。 */
  const playToken = useRef(0);
  /** 在途播放的目标块数组：跳过动画时用它一次性补齐。 */
  const playTarget = useRef<MessageBlock[]>([]);

  useEffect(() => () => {
    // 卸载时终止在途播放，避免对已卸载组件 setState。
    playToken.current += 1;
  }, []);

  /** 把一帧提交给调试 store，并把它的内容同步回 frame 输入框。 */
  const commit = useCallback((frame: SimFrame, showInInput = true): void => {
    store.dispatch({ type: 'stream/frame', frame });
    if (showInInput) setFrameText(JSON.stringify(frame, null, 2));
    setFrameCount(count => count + 1);
  }, [store]);

  const stopPlay = useCallback((): void => {
    playToken.current += 1;
    setPlaying(false);
  }, []);

  const resetAll = useCallback((): void => {
    stopPlay();
    // 重置帧的编号必须**接上**已提交的那一帧：reducer 丢弃「同一实例、revision 更小」的帧
    // （见 store/reducers/stream.ts），若这里又压回 0，重置帧与随后新预览的帧都会被丢掉，
    // 界面就会停在上一个用例上。
    const revision = store.getState().stream.revision + 1;
    simulator.current = createSimulatorState(undefined, revision - 1);
    store.dispatch({
      type: 'stream/frame',
      frame: {
        type: 'state',
        instanceId: DEBUG_INSTANCE_ID,
        revision,
        full: true,
        items: [],
        // sessionId 取 simulator 的默认值，而不是 INITIAL_ROOT_STATE 的空串：
        // 否则重置后 `Stage` 会因为 sessionId 变化而复位滚动与轮次高亮。
        state: { ...INITIAL_ROOT_STATE.stream, sessionId: simulator.current.sessionId },
      },
    });
    setDisplayBlocks([]);
    setEventText('');
    setFrameText('');
    setError(null);
    setEventCount(0);
    setFrameCount(0);
  }, [store, stopPlay]);

  /**
   * 播放一段块数组：**最后一个文本块**按字符演出来，其余块直接显示。
   *
   * 只演最后一个文本块：流式期增长的只有它，更早的文本块与内容块（含骨架）都不应该重播；
   * 内容块的 `pending` 变化是一次状态切换，直接显示即可。
   *
   * 步长自适应：整段播放控制在 `PLAY_BUDGET_TICKS` 个片段内，所以短文本是逐字出现、
   * 长文本自动加快——调试页不该为了看一段 2000 字的回答让用户等半分钟。
   */
  const playBlocks = useCallback(async (blocks: MessageBlock[]): Promise<void> => {
    const token = playToken.current;
    const alive = (): boolean => playToken.current === token;
    playTarget.current = blocks;
    let lastTextIndex = -1;
    for (const [index, block] of blocks.entries()) if (block.type === 'text') lastTextIndex = index;
    const lastText = lastTextIndex < 0 ? undefined : blocks[lastTextIndex];
    if (lastText === undefined || lastText.type !== 'text') {
      setDisplayBlocks(blocks);
      return;
    }
    const full = lastText.text;
    const head = blocks.slice(0, lastTextIndex);
    const tail = blocks.slice(lastTextIndex + 1);
    /** 把最后一个文本块替换成前缀 `text` 之后的块数组。 */
    const withText = (text: string): MessageBlock[] => {
      const next: MessageBlock[] = [...head, { type: 'text', text }, ...tail];
      return next;
    };
    const step = Math.max(CHARS_PER_TICK, Math.ceil(full.length / PLAY_BUDGET_TICKS));
    setDisplayBlocks(withText(''));
    for (let end = step; end < full.length + step; end += step) {
      await new Promise(resolve => setTimeout(resolve, TICK_MS));
      if (!alive()) return;
      setDisplayBlocks(withText(full.slice(0, end)));
    }
    if (!alive()) return;
    setDisplayBlocks(blocks);
  }, []);

  /** 跳过剩余动画：直接显示这一帧的最终内容（长文本时用）。 */
  const skipPlay = useCallback((): void => {
    playToken.current += 1;
    setPlaying(false);
    setDisplayBlocks(playTarget.current);
  }, []);

  const runPreview = useCallback(async (): Promise<void> => {
    const parsed = parseInputs(eventText, frameText);
    if (parsed.error !== null) {
      setError(parsed.error);
      return;
    }
    setError(null);
    playToken.current += 1;
    setPlaying(true);
    const token = playToken.current;
    const alive = (): boolean => playToken.current === token;

    try {
      const events = parsed.events;
      if (events !== undefined) {
        // 一批 event 只产一帧（flush 语义）；单条仍可能产多帧，见 applyEvents 的注释。
        const steps = applyEvents(simulator.current, events);
        setEventCount(count => count + events.length);
        for (const step of steps) {
          if (!alive()) return;
          commit(step.frame);
          const target = step.play === KEEP ? step.frame.state.liveContent : step.play;
          if (target.length > 0 && target !== displayBlocks) await playBlocks(target);
          else setDisplayBlocks(target);
        }
      } else if (parsed.frame !== undefined) {
        // frame 通道不做补间：这一帧本来就已经是最终状态。
        // 手工粘贴的帧没有「序列」语义——它的 revision 是写死的（组件库文档页生成的帧恒为 1），
        // 而 store 里的编号会随每次预览增长，直接用会被 reducer 的「同实例旧帧丢弃」守卫吃掉，
        // 表现为点了「预览」什么都不发生。这里把编号接到当前之后，粘贴即生效。
        const frame = { ...parsed.frame, revision: store.getState().stream.revision + 1 };
        commit(frame, false);
        setDisplayBlocks(frame.state.liveContent);
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      // 支持的事件类型清单在这里消费，用户不必去翻 simulator.ts 才知道能填什么。
      setError(`${detail}可用类型：${SUPPORTED_EVENTS.join('、')}。`);
    } finally {
      if (alive()) setPlaying(false);
    }
  }, [commit, displayBlocks, eventText, frameText, playBlocks]);

  return (
    <MotionConfig reducedMotion="user">
      {/* 调试页**保留顶栏**：主界面已按 C01 删除顶栏（`.appFrame` 只剩 'side main' 两列），
          而这里仍需要一条「品牌 + 栏目 + 动作」的横条。所以 `styles/debug.css` 在
          `[data-mode='debug']` 作用域内把三段式网格恢复回来——不恢复的话顶栏会被
          自动放置到隐式的第二行（宽度只等于输入列）。
          `data-mode="debug"` 同时让输入列拿到更宽的宽度（styles/debug.css），
          不再靠 `html[data-debug]` 提升某一条规则的特异性。 */}
      <div className="appFrame" data-mode="debug" data-sidebar="expanded">
        <AppTopBar
          brand={(
            <span
              className="appBrandAction"
              data-debug-toggle="true"
              role="button"
              tabIndex={0}
              title="双击返回主界面"
              onDoubleClick={() => { void navigate(PATH.home); }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') void navigate(PATH.home);
              }}
            >
              Bangumi 助手
            </span>
          )}
          tabs={<AppTopBarTab current>调试页</AppTopBarTab>}
          actions={(
            <>
              {/* 新标签打开：调试页的输入只在内存里，同标签跳走会丢 */}
              <Link
                className="debugButton debugLink"
                data-compact="true"
                to={PATH.library}
                target="_blank"
                rel="noreferrer"
                title="打开内容组件库文档（新标签页，不丢当前输入）"
              >
                组件库
              </Link>
              <button type="button" className="debugButton" data-compact="true" onClick={() => { void navigate(PATH.home); }} title="返回主界面">
                返回主界面
              </button>
            </>
          )}
        />
        <aside className="appSidebar">
          <DebugInputPanel
            eventText={eventText}
            onEventChange={setEventText}
            frameText={frameText}
            onFrameChange={setFrameText}
            frameAuto={eventText.trim().length > 0}
            error={error}
            playing={playing}
            source={eventText.trim() ? 'event' : frameText.trim() ? 'frame' : 'none'}
            frameCount={frameCount}
            eventCount={eventCount}
            onPreview={() => { void runPreview(); }}
            onReset={resetAll}
          />
        </aside>
        <DebugPreview
          liveBlocks={displayBlocks}
          source={eventText.trim() ? 'event' : frameText.trim() ? 'frame' : 'none'}
          hasInput={eventText.trim().length > 0 || frameText.trim().length > 0}
          playing={playing}
          frameCount={frameCount}
          eventCount={eventCount}
          reveal={reveal}
          onReveal={() => setReveal(value => value + 1)}
          onSkip={skipPlay}
        />
      </div>
    </MotionConfig>
  );
}
