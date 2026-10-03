import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import { projectTurns } from '../../../utils/turns';
import { StreamingBlock } from './MessageParts';
import { TurnView } from './TurnView';

/**
 * 会话视图。
 *
 * 这是「对话实际长什么样」的唯一实现：滚动容器、轮次列表、流式区、轮次导航与
 * 贴底跟随都在这里。它保持 props 驱动：数据由调用方从 store 取后传入，组件本身
 * 不依赖全局状态，可以独立复用与测试。
 *
 * 边界刻意的选择：
 * - 包含 `.body`，因为 `.column` 的宽度由 `.body` 上的 `container-type: inline-size`
 *   用 `100cqw` 算出（`frame.css:314-349`），少了同一个祖先，列宽与换行都会不同；
 * - 包含 `.scrollBody[data-phase]`，因为屏外优化选择器
 *   `.scrollBody[data-phase='active'] > .scroll > .column > .flowItem`（`frame.css:366`）
 *   依赖完整祖先链；
 * - **不含** `.frame` 与 `.conversation`：它们还要容纳侧栏与会话头，由调用方提供
 *   （调试面板用同宽的 `.frame` 外壳 + 占位列，宽度规则因此与真实页面一致）；
 * - **不含**输入区、弹窗、toast：那些是外壳职责，通过 `composer` 槽位注入。
 */
export interface ConversationViewProps {
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
  /** `/details` 递增的展开计数；调试面板传 0。 */
  reveal: number;
  onConfirm(id: string): void;
  onReject(id: string): void;
  /** 输入区槽位；不传则不渲染。 */
  composer?: ReactNode;
  /** 首屏引导内容；不传即始终处于 active 阶段。 */
  hero?: ReactNode;
  /** 乐观回显槽位；不传则不渲染。 */
  pendingEcho?: ReactNode;
}

export function ConversationView({
  items, liveText, liveThinking, busy, status, cancelling, startedAt,
  sessionId, reveal, onConfirm, onReject, composer, hero, pendingEcho,
}: ConversationViewProps): ReactNode {
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** rAF 句柄与「滚动停止」防抖句柄。 */
  const pendingFrame = useRef(0);
  const scrollIdle = useRef(0);

  // 投影只在条目真正变化时重算：流式帧只改标量（liveText 等），items 引用不变，
  // 于是 turns 引用稳定，配合 TurnView 的 memo 让历史轮次整体跳过重渲染。
  const turns = useMemo(() => projectTurns(items), [items]);
  // 轮次导航只标记真实对话轮次，前导内容（会话头）不算一轮
  const railTurns = useMemo(() => turns.filter(turn => turn.user !== null), [turns]);

  // 槽位是每次渲染都会重建的元素对象，直接进依赖数组会让贴底副作用每帧都跑一次
  // 强制布局，因此这里只取「有没有」这个稳定布尔值。
  const heroPhase = hero !== undefined && hero !== null;
  const hasPendingEcho = pendingEcho !== undefined && pendingEcho !== null;

  /**
   * 切换会话：当前轮次高亮要清掉、视图要在下一帧拉回底部。
   *
   * `pinned` 必须重设为 true——上一会话可能停在半途（`pinned` 为 false），不重置
   * 的话新会话的跟随滚动会被跳过，视图就停在历史中段。
   */
  useEffect(() => {
    pinned.current = true;
    setActiveTurn(null);
  }, [sessionId]);

  /**
   * 只在用户停留在底部时跟随新内容。
   *
   * 读 `scrollHeight` 再写 `scrollTop` 是一次强制布局，因此这个副作用只在内容或
   * 忙碌状态真正变化时执行，不挂到任何计时器上。
   *
   * 贴底要贴几次：屏外轮次带 `content-visibility: auto`，浏览器会在随后的若干帧里
   * 分批算出真实高度，只贴一次会被后续的高度增长推回历史中段。这里在一个很短的
   * 窗口内补贴三次。
   *
   * 注意不要在这一小段里检查 `pinned`：会话切换时滚动容器会因内容替换被浏览器
   * 自动钳制 `scrollTop`，那也会派发 scroll 事件、把 `pinned` 冲成 false。
   */
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
   * 当前轮次的判定对已挂载的轮次读一次 rect 并线性扫描，并用 rAF 节流；停下来的
   * 最终对齐靠一个 150ms 的「滚动停止」定时器——连续滚动时 rAF 节流会一直跳过
   * 重算，停在最终位置后高亮就不会更新。
   */
  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const node = event.currentTarget;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    const last = node.scrollTop;
    recomputeActiveTurn();
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => {
      scrollIdle.current = 0;
      // 期间没有新滚动才对齐，否则留给下一次。
      if (scroller.current && scroller.current.scrollTop === last) recomputeActiveTurn(true);
    }, 150);
  };

  const jumpTo = useCallback((id: number): void => {
    document.getElementById(`turn-${id}`)?.scrollIntoView({ block: 'start' });
    // 跳转后立即更新高亮，不依赖滚动事件的时序。
    setActiveTurn(id);
    pinned.current = false;
  }, []);

  return (
    <div className="body" data-phase={heroPhase ? 'hero' : 'active'}>
      <div className="scrollBody" ref={scroller} onScroll={onScroll} data-phase={heroPhase ? 'hero' : 'active'}>
        {heroPhase ? hero : (
          <div className="scroll">
            <div className="column">
              {turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  running={busy && index === turns.length - 1}
                  busy={busy}
                  reveal={reveal}
                  onConfirm={onConfirm}
                  onReject={onReject}
                />
              ))}
              {pendingEcho}
              <StreamingBlock
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
        <div className="railSlot">
          <nav className="turnRail" aria-label="轮次导航">
            {railTurns.map((turn, index) => (
              <button
                key={turn.id}
                type="button"
                data-active={turn.id === activeTurn}
                aria-label={`跳到第 ${index + 1} 轮`}
                title={`第 ${index + 1} 轮`}
                onClick={() => jumpTo(turn.id)}
              />
            ))}
          </nav>
        </div>
      ) : null}
      {composer}
    </div>
  );
}
