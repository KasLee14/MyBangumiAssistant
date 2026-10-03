import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import { projectTurns } from '../../../utils/turns';
import { StreamingV2 } from './StreamingV2';
import { TurnV2 } from './TurnV2';

/**
 * v2 会话容器。
 *
 * 这是 v1 `ConversationView` 在 v2 的对应实现：滚动、贴底跟随、轮次高亮与轮次导航
 * 的取舍与它逐条一致（包括那几个「为什么这么做」的边界），换的是 DOM 与类名，
 * 因为 v2 要自己掌控轮次与行的入场动效，也要按自己的结构重写屏外优化选择器。
 *
 * 与 v1 一样保持 props 驱动：数据由调用方从 store 取后传入，组件本身不依赖全局状态。
 *
 * 三处刻意与 v1 保持一致的实现细节（改了会出问题）：
 * - `.v2Stage` 带 `container-type: inline-size`，`.v2StageColumn` 的宽度按 `100cqw` 算；
 * - 屏外优化依赖完整祖先链 `.v2StageScroll > .v2StageFlow > .v2StageColumn > .v2Turn`
 *   （见 `styles/v2/conversation.css`），所以这三层不能被替换或省略；
 * - 贴底要在一个短窗口内贴三次：屏外轮次分批算出真实高度，只贴一次会被推回中段。
 */
export interface StageV2Props {
  /** 条目列表：与生产同一形状。 */
  items: TranscriptItemView[];
  /** 流式正文与思考；与 `ChatScalarsView` 同义。 */
  liveText: string;
  liveThinking: string;
  busy: boolean;
  status: string;
  cancelling: boolean;
  startedAt: number;
  /** 会话标识：变化时复位滚动位置与当前轮次高亮。 */
  sessionId: string;
  /** `/details` 递增的展开计数。 */
  reveal: number;
  onConfirm(id: string): void;
  onReject(id: string): void;
  /** 输入区槽位；不传则不渲染。 */
  composer?: ReactNode;
  /** 首屏引导内容；不传即始终处于活动阶段。 */
  hero?: ReactNode;
  /** 乐观回显槽位；不传则不渲染。 */
  pendingEcho?: ReactNode;
}

export function StageV2({
  items, liveText, liveThinking, busy, status, cancelling, startedAt,
  sessionId, reveal, onConfirm, onReject, composer, hero, pendingEcho,
}: StageV2Props): ReactNode {
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** rAF 句柄与「滚动停止」防抖句柄。 */
  const pendingFrame = useRef(0);
  const scrollIdle = useRef(0);

  // 投影只在条目真正变化时重算：流式帧只改标量，items 引用不变，于是 turns 引用稳定，
  // 配合 TurnV2 的 memo 让历史轮次整体跳过重渲染。
  const turns = useMemo(() => projectTurns(items), [items]);
  // 轮次导航只标记真实对话轮次，前导内容（会话头）不算一轮。
  const railTurns = useMemo(() => turns.filter(turn => turn.user !== null), [turns]);

  // 槽位是每次渲染都会重建的元素对象，直接进依赖数组会让贴底副作用每帧都跑一次
  // 强制布局，因此这里只取「有没有」这个稳定布尔值。
  const heroPhase = hero !== undefined && hero !== null;
  const hasPendingEcho = pendingEcho !== undefined && pendingEcho !== null;

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

  /** 只在用户停留在底部时跟随新内容。读 `scrollHeight` 是一次强制布局，故只在内容变化时执行。 */
  useEffect(() => {
    const node = scroller.current;
    if (!node || !pinned.current) return;
    const pin = (): void => {
      const target = scroller.current;
      if (target) target.scrollTop = target.scrollHeight;
    };
    pin();
    const raf = requestAnimationFrame(pin);
    const timer = setTimeout(pin, 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [items, liveText, liveThinking, busy, hasPendingEcho]);

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

  /** v2 的轮次跳转：滚动行为交给 CSS 的 `scroll-behavior`，这里只更新高亮与贴底标记。 */
  const jumpTo = useCallback((id: number): void => {
    document.getElementById(`turn-${id}`)?.scrollIntoView({ block: 'start' });
    setActiveTurn(id);
    pinned.current = false;
  }, []);

  return (
    <div className="v2Stage" data-phase={heroPhase ? 'hero' : 'active'} id="v2-stage">
      <div className="v2StageBody">
        {/* id 供 `AnimatedContent`（gsap ScrollTrigger）定位滚动容器，见 TurnV2 的注释。 */}
        <div className="v2StageScroll" id="v2-stage-scroll" ref={scroller} onScroll={onScroll} data-phase={heroPhase ? 'hero' : 'active'}>
          {heroPhase ? hero : (
            <div className="v2StageFlow">
              <div className="v2StageColumn">
                {turns.map((turn, index) => (
                  <TurnV2
                    key={turn.id}
                    turn={turn}
                    running={busy && index === turns.length - 1}
                    reveal={reveal}
                    onConfirm={onConfirm}
                    onReject={onReject}
                  />
                ))}
                {pendingEcho}
                <StreamingV2
                  liveText={liveText}
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
          <nav className="v2Rail" aria-label="轮次导航">
            {railTurns.map((turn, index) => (
              <button
                key={turn.id}
                type="button"
                className="v2RailButton"
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
