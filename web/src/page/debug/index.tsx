import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { INITIAL_ROOT_STATE, rootReducer } from '../../store/reducers';
import { exitDebug } from '../../utils/debugMode';
import { DebugInputPanel } from './DebugInputPanel';
import { DebugPreview } from './DebugPreview';
import {
  KEEP, SUPPORTED_EVENTS, applyEvent, createSimulatorState, DEBUG_INSTANCE_ID,
  type SimFrame, type SimEvent, type SimulatorState,
} from './simulator';

/**
 * 调试页：左侧输入 event 或 frame，右侧用真实渲染链路预览结果。
 *
 * 三条设计约束：
 * 1. **与真实会话完全隔离**：这里自己建一个 redux store，用同一份 `rootReducer`。
 *    调试数据只进这个 store，主 store 一个字节都不动。
 * 2. **预览就是真实渲染**：直接复用 `<Stage>`（它连同 `Turn` / `Streaming` /
 *    `ContentItem` / `Markdown` 都是 props 驱动的），所以「预览所见 = 真实会话所见」。
 * 3. **流式由播放驱动**：模拟器按事件给出目标帧，页面把 `liveText` 按字符演一遍
 *    再提交——对应宿主每 40ms 一帧的下发节奏。
 *
 * 每个动画片段提交的字符数与间隔：对应宿主 40ms 一帧的观感。
 */
const CHARS_PER_TICK = 1;
const TICK_MS = 24;
/** 一次播放的片段预算：整段控制在约 1.4 秒，长文本自动加大每片段的字符数。 */
const PLAY_BUDGET_TICKS = 60;

type DebugStore = ReturnType<typeof createDebugStore>;

function createDebugStore() {
  return createStore(rootReducer, {
    ...INITIAL_ROOT_STATE,
    stream: { ...INITIAL_ROOT_STATE.stream, instanceId: DEBUG_INSTANCE_ID, revision: -1 },
  });
}

interface ParsedInput {
  event?: SimEvent;
  frame?: SimFrame;
  error: string | null;
}

/** 解析两个输入框；event 非空时忽略 frame（已确认：以 event 为准）。 */
function parseInputs(eventText: string, frameText: string): ParsedInput {
  const eventRaw = eventText.trim();
  const frameRaw = frameText.trim();

  if (eventRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(eventRaw);
    } catch (cause) {
      return { error: `event 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'event 必须是一个 JSON 对象。' };
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== 'string' || !type) return { error: 'event 缺少 type 字段。' };
    return { event: parsed as SimEvent, error: null };
  }

  if (frameRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frameRaw);
    } catch (cause) {
      return { error: `frame 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'frame 必须是一个 JSON 对象。' };
    }
    const frame = parsed as Partial<SimFrame>;
    if (frame.type !== 'state') return { error: 'frame 的 type 必须是 "state"。' };
    if (!Array.isArray(frame.items)) return { error: 'frame 缺少 items 数组。' };
    if (!frame.state || typeof frame.state !== 'object') return { error: 'frame 缺少 state 标量对象。' };
    return {
      frame: {
        type: 'state',
        instanceId: frame.instanceId ?? DEBUG_INSTANCE_ID,
        revision: frame.revision ?? 0,
        full: frame.full ?? true,
        items: frame.items,
        state: frame.state,
      },
      error: null,
    };
  }

  return { error: '请先填入 event 或 frame。' };
}

/** 退出调试页：清掉 hash，`main.tsx` 的 hashchange 监听会把主界面换回来。 */
export function DebugPage(): ReactNode {
  // 独立 store：整个调试页唯一的状态容器，主 store 不参与。
  // 用 useMemo 而不是 useRef：Provider 需要的是一个稳定的 store 实例。
  const debugStore = useMemo<DebugStore>(createDebugStore, []);
  return (
    <Provider store={debugStore}>
      <DebugShell store={debugStore} />
    </Provider>
  );
}

/**
 * 预览区装配。
 *
 * `displayLiveText` 是**受控**的流式文本：`Stage` 显示它，而不是读 store 里的
 * `liveText`——因为逐字播放发生在 reducer 之外，store 里只保留「已提交帧」的状态。
 */
function DebugShell({ store }: { store: DebugStore }): ReactNode {
  const simulator = useRef<SimulatorState>(createSimulatorState());
  const [displayLiveText, setDisplayLiveText] = useState('');
  const [eventText, setEventText] = useState('');
  const [frameText, setFrameText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [reveal, setReveal] = useState(0);
  /** 播放令牌：新一次预览或重置会让在途播放立即失效。 */
  const playToken = useRef(0);
  /** 在途播放的目标文本：跳过动画时用它一次性补齐。 */
  const playTarget = useRef('');

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
    simulator.current = createSimulatorState();
    store.dispatch({
      type: 'stream/frame',
      frame: {
        type: 'state',
        instanceId: DEBUG_INSTANCE_ID,
        revision: 0,
        full: true,
        items: [],
        // sessionId 取 simulator 的默认值，而不是 INITIAL_ROOT_STATE 的空串：
        // 否则重置后 `Stage` 会因为 sessionId 变化而复位滚动与轮次高亮。
        state: { ...INITIAL_ROOT_STATE.stream, sessionId: simulator.current.sessionId },
      },
    });
    setDisplayLiveText('');
    setEventText('');
    setFrameText('');
    setError(null);
    setEventCount(0);
    setFrameCount(0);
  }, [store, stopPlay]);

  /**
   * 按字符播放一段文本，播完即止。
   *
   * 步长自适应：整段播放控制在 `PLAY_BUDGET_TICKS` 个片段内，所以短文本是逐字出现、
   * 长文本自动加快——调试页不该为了看一段 2000 字的回答让用户等半分钟。
   */
  const playText = useCallback(async (text: string): Promise<void> => {
    const token = playToken.current;
    const alive = (): boolean => playToken.current === token;
    playTarget.current = text;
    const step = Math.max(CHARS_PER_TICK, Math.ceil(text.length / PLAY_BUDGET_TICKS));
    setDisplayLiveText('');
    for (let end = step; end < text.length + step; end += step) {
      await new Promise(resolve => setTimeout(resolve, TICK_MS));
      if (!alive()) return;
      setDisplayLiveText(text.slice(0, end));
    }
    if (!alive()) return;
    setDisplayLiveText(text);
  }, []);

  /** 跳过剩余动画：直接显示这一帧的最终内容（长文本时用）。 */
  const skipPlay = useCallback((): void => {
    playToken.current += 1;
    setPlaying(false);
    setDisplayLiveText(playTarget.current);
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
      if (parsed.event !== undefined) {
        const steps = applyEvent(simulator.current, parsed.event);
        setEventCount(count => count + 1);
        for (const step of steps) {
          if (!alive()) return;
          commit(step.frame);
          const target = step.play === KEEP ? step.frame.state.liveText : step.play;
          if (target.length > 0 && target !== displayLiveText) await playText(target);
          else setDisplayLiveText(target);
        }
      } else if (parsed.frame !== undefined) {
        // frame 通道不做补间：这一帧本来就已经是最终状态。
        commit(parsed.frame, false);
        setDisplayLiveText(parsed.frame.state.liveText);
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      // 支持的事件类型清单在这里消费，用户不必去翻 simulator.ts 才知道能填什么。
      setError(`${detail}可用类型：${SUPPORTED_EVENTS.join('、')}。`);
    } finally {
      if (alive()) setPlaying(false);
    }
  }, [commit, displayLiveText, eventText, frameText, playText]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="appFrame" data-sidebar="expanded">
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
            onExit={exitDebug}
          />
        </aside>
        <DebugPreview
          liveText={displayLiveText}
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

