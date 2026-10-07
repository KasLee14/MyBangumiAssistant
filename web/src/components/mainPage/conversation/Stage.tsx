import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { MessageBlock, TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import { projectTurns } from '../../../utils/turns';
import { Streaming } from './Streaming';
import { Turn } from './Turn';

/**
 * 会话容器：滚动、贴底跟随、轮次高亮与轮次导航。
 *
 * props 驱动：数据由调用方从 store 取后传入，组件本身不依赖全局状态。
 *
 * 三处刻意保持的实现细节（改了会出问题）：
 * - `.appStage` 带 `container-type: inline-size`，`.appStageColumn` 的宽度按 `100cqw` 算；
 * - 屏外优化依赖完整祖先链 `.appStageScroll > .appStageFlow > .appStageColumn > .appTurn`
 *   （见 `styles/frame.css`），所以这三层不能被替换或省略；
 * - 贴底跟随由 `ResizeObserver` 观察 `.appStageFlow` 的**尺寸**驱动（理由见下面贴底 effect 的注释）：
 *   屏外轮次的高度是分批算出来的，观察尺寸天然表达这件事，因此不需要在一个短窗口里反复读
 *   `scrollHeight`——那是强制同步布局，实测单次 52~286ms。
 */
export interface StageProps {
  /** 条目列表：与生产同一形状。 */
  items: TranscriptItemView[];
  /** 流式内容块与思考；与 `ChatScalarsView` 同义。 */
  liveContent: MessageBlock[];
  liveThinking: string;
  busy: boolean;
  status: string;
  cancelling: boolean;
  startedAt: number;
  /** 会话标识：变化时复位滚动位置与当前轮次高亮。 */
  sessionId: string;
  /**
   * 收尾播放：流式已经结束，但屏幕上的字还没播完。
   *
   * 此时宿主已经把这一轮的回答落成条目，而流式区还在逐字显示同一段正文——所以要把
   * **最后一轮**的助手正文藏起来，由流式区独占。这也是它能无缝交接的原因：位置不变、
   * 文本相同（流式区与条目走同一个 `MessageBlocks`）。
   */
  pacedTail: boolean;
  /** `/details` 递增的展开计数。 */
  reveal: number;
  /**
   * 过程区的展开状态表（键见 `utils/process.ts`）。
   *
   * 从 store 一路传进来而不是在这里读 store：`Stage` 是 props 驱动的会话容器，
   * 内容组件不读 store 是跨层约束（`web/AGENTS.md` 第 1 条）。
   */
  openMap: Readonly<Record<string, boolean>>;
  onToggleProcess(key: string, open: boolean): void;
  onToggleRow(key: string, open: boolean): void;
  onConfirm(id: string): void;
  onReject(id: string): void;
  /** 输入区槽位；不传则不渲染。 */
  composer?: ReactNode;
  /** 首屏引导内容；不传即始终处于活动阶段。 */
  hero?: ReactNode;
  /** 乐观回显槽位；不传则不渲染。 */
  pendingEcho?: ReactNode;
}

export function Stage({
  items, liveContent, liveThinking, busy, status, cancelling, startedAt,
  sessionId, reveal, pacedTail, openMap, onToggleProcess, onToggleRow, onConfirm, onReject,
  composer, hero, pendingEcho,
}: StageProps): ReactNode {
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** 内容容器：贴底跟随观察的是它的尺寸，而不是每一帧的数据（理由见下面的贴底 effect）。 */
  const flow = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** rAF 句柄与「滚动停止」防抖句柄。 */
  const pendingFrame = useRef(0);
  const scrollIdle = useRef(0);

  // 投影只在条目真正变化时重算：流式帧只改标量，items 引用不变，于是 turns 引用稳定，
  // 配合 Turn 的 memo 让历史轮次整体跳过重渲染。
  const turns = useMemo(() => projectTurns(items), [items]);
  // 轮次导航只标记真实对话轮次；没有用户消息的前导项不算一轮。
  // （C34 决策删掉了会话头，所以这里不再有「会话头占据内容流前导」这件事。）
  const railTurns = useMemo(() => turns.filter(turn => turn.user !== null), [turns]);

  // 槽位是每次渲染都会重建的元素对象，这里只取「有没有」这个稳定布尔值。
  const heroPhase = hero !== undefined && hero !== null;

  /**
   * 切换会话：当前轮次高亮要清掉、视图要在下一帧拉回底部。
   *
   * `pinned` 必须重设为 true——上一会话可能停在半途，不重置的话新会话的跟随滚动
   * 会被跳过，视图就停在历史中段。
   */
  useEffect(() => {
    pinned.current = true;
    setActiveTurn(null);
  }, [sessionId]);

  /**
   * 贴底跟随：由内容容器的**尺寸变化**驱动，而不是由每一帧的数据驱动。
   *
   * 原来这个 effect 依赖 `[items, liveContent, liveThinking, busy, hasPendingEcho]`，于是每个流式
   * 帧都要读一次 `scrollHeight`。而读 `scrollHeight` 是一次**强制同步布局**：`.appTurn` 带
   * `content-visibility: auto`，屏外轮次本应被跳过，但一读总高度就要求把它们全部真实布局——
   * 实测单次 52~286ms，正是它把均匀到达的流式帧在浏览器里攒成「一顿一顿、一次冒几十字」的
   * 爆发（诊断见 `artifacts/web-streaming-diagnosis-and-plan.md`）。
   *
   * `ResizeObserver` 的回调发生在布局之后，此时 `scrollHeight` 已是现成结果，不会再触发第二次
   * 布局；它同时天然表达了「屏外轮次的高度是分批算出来的」——高度每稳定一次就贴一次，取代
   * 原来「立即 + rAF + 120ms」的三连贴。切会话时重建观察并贴一次，避免新会话停在旧位置。
   */
  useEffect(() => {
    const scrollerNode = scroller.current;
    const content = flow.current;
    if (!scrollerNode || !content) return;
    const pin = (): void => {
      if (!pinned.current) return;
      scrollerNode.scrollTop = scrollerNode.scrollHeight;
    };
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    pin();
    return () => observer.disconnect();
  }, [heroPhase, sessionId]);

  const recomputeActiveTurn = useCallback((force = false): void => {
    if (pendingFrame.current && !force) return;
    if (force && pendingFrame.current) { cancelAnimationFrame(pendingFrame.current); pendingFrame.current = 0; }
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = 0;
      const node = scroller.current;
      if (!node) return;
      const edge = node.getBoundingClientRect().top + node.clientHeight * 0.3;
      let latest: number | null = null;
      for (const element of node.querySelectorAll<HTMLElement>('[data-turn]')) {
        if (element.getBoundingClientRect().top <= edge) {
          const id = Number(element.dataset.turn);
          if (!Number.isNaN(id) && (latest === null || id > latest)) latest = id;
        }
      }
      setActiveTurn(current => (current === latest ? current : latest));
    });
  }, []);

  useEffect(() => {
    if (heroPhase) return;
    recomputeActiveTurn();
  }, [turns, heroPhase, recomputeActiveTurn]);

  useEffect(() => () => {
    if (pendingFrame.current) cancelAnimationFrame(pendingFrame.current);
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
  }, []);

  /**
   * 滚动只做两件事：记录是否仍贴着底部、请求重算当前轮次。
   *
   * rAF 节流 + 150ms「滚动停止」兜底：连续滚动时 rAF 会一直跳过重算，停在最终位置后
   * 高亮就不会更新，所以停下来还要再对齐一次。
   */
  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const node = event.currentTarget;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    const last = node.scrollTop;
    recomputeActiveTurn();
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => {
      scrollIdle.current = 0;
      if (scroller.current && scroller.current.scrollTop === last) recomputeActiveTurn(true);
    }, 150);
  };

  /** 轮次跳转：滚动行为交给 CSS 的 `scroll-behavior`，这里只更新高亮与贴底标记。 */
  const jumpTo = useCallback((id: number): void => {
    document.getElementById(`turn-${id}`)?.scrollIntoView({ block: 'start' });
    setActiveTurn(id);
    pinned.current = false;
  }, []);

  return (
    <div className="appStage" data-phase={heroPhase ? 'hero' : 'active'} id="app-stage">
      <div className="appStageBody">
        {/* id 供 `AnimatedContent`（gsap ScrollTrigger）定位滚动容器，见 Turn 的注释。 */}
        <div className="appStageScroll" id="app-stage-scroll" ref={scroller} onScroll={onScroll} data-phase={heroPhase ? 'hero' : 'active'}>
          {heroPhase ? hero : (
            <div className="appStageFlow" ref={flow}>
              <div className="appStageColumn">
                {turns.map((turn, index) => (
                  <Turn
                    key={turn.id}
                    turn={turn}
                    running={busy && index === turns.length - 1}
                    // 收尾播放只为最后一轮让位：更早的轮次与流式区无关。
                    hideAssistant={pacedTail && index === turns.length - 1}
                    reveal={reveal}
                    openMap={openMap}
                    onToggleProcess={onToggleProcess}
                    onToggleRow={onToggleRow}
                    onConfirm={onConfirm}
                    onReject={onReject}
                  />
                ))}
                {pendingEcho}
                <Streaming
                  liveContent={liveContent}
                  liveThinking={liveThinking}
                  busy={busy}
                  status={status}
                  cancelling={cancelling}
                  startedAt={startedAt}
                />
              </div>
            </div>
          )}
        </div>
        {!heroPhase && railTurns.length >= 2 ? (
          <nav className="appRail" aria-label="轮次导航">
            {railTurns.map((turn, index) => (
              <button
                key={turn.id}
                type="button"
                className="appRailButton"
                data-active={turn.id === activeTurn}
                aria-label={`跳到第 ${index + 1} 轮`}
                title={`第 ${index + 1} 轮`}
                onClick={() => jumpTo(turn.id)}
              />
            ))}
          </nav>
        ) : null}
      </div>
      {composer}
    </div>
  );
}
