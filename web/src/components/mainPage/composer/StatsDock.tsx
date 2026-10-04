import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ContextUsageView, TokenUsageView } from '../../../../../bangumi/src/web/protocol';
import { CountUp } from '../../motion/vendor/CountUp';

/**
 * 输入卡底栏：token 胶囊与上下文占用环。
 *
 * 形态与交互对齐 deepseek-harness 的 composer 统计条（MIT）：
 * `ui-chat/chat/StatsPills.tsx` 的用量胶囊、`ui-conversation/skeleton/ContextMeter.tsx`
 * 的圆环与占用面板。两处按本仓库的约定改写：
 *
 * 1. 浮层 portal 到 body 并用 fixed 定位（同 DSH）。这一条不是可选的：
 *    输入卡位于 `.scrollBody`（`overflow-y: auto`）内，任何留在卡内的绝对定位浮层
 *    都会被那个滚动容器裁掉。
 * 2. 配色走 Bangumi 令牌（`--bgm-*`）与站点卡片形态（1px 淡描边、10/15px 圆角、
 *    无投影、无玻璃模糊），不再用 DSH 的菜单材质。
 *
 * 同时只允许一个浮层展开：点开另一个会收起前一个，点面板外或按 Esc 收起。
 */
interface StatsDockProps {
  tokenUsage: TokenUsageView | null;
  contextUsage: ContextUsageView | null;
  /**
   * 精确读数是否改用滚动数字（ReactBits 的 `CountUp`）呈现。
   *
   * 缺省 `false`：v1 渲染静态文本，DOM 与引入 v2 之前完全一致。
   * 只有**精确数字**参与滚动——胶囊上那个 `103K tok` 是缩写读数，滚动一个缩写没有
   * 意义（中途会经过 `57K` 这类并不对应任何真实值的中间态）。
   */
  countUp?: boolean;
}

/**
 * 滚动读数的时长（秒）。
 *
 * `CountUp` 用它换算弹簧参数（`damping = 20 + 40/duration`、`stiffness = 100/duration`），
 * 而不是精确时长，因此实际收敛比这个数字长：实测 0.9 时 16 万级的读数要 2 秒才到 97%，
 * 对一条常驻读数偏拖沓。0.5 大约 1 秒出头收敛到位，仍然看得出是「滚上去」的。
 */
const COUNT_UP_DURATION = 0.5;

/** 圆环几何：16px 视口、2px 描边（与 DSH 的 5.5 半径同比例）。 */
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 上下文占用到这个百分比就换成警示色，提醒该压缩或收尾了。 */
const CONTEXT_WARN_PERCENT = 90;

/** 浮层与触发器的间距、以及距视口边缘的最小留白。 */
const PANEL_GAP = 8;
const PANEL_MARGIN = 12;

/**
 * 紧凑 token 数：517 / 12.2K / 1.2M。
 *
 * 规则与 DSH 的 `formatTokens` 一致：超过 100 之后不再给小数位，
 * 否则「126.4K」这种读数在底栏里没有意义。
 */
function formatTokens(value: number): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`;
  return `${scaled(value / 1_000_000)}M`;
}

/** 精确 token 数：按中文习惯每三位加千分位。 */
function formatExactTokens(value: number): string {
  return value.toLocaleString('zh-CN');
}

/** 数据堆图标：用量读数的固定前缀符号。 */
function DatabaseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      <ellipse cx="8" cy="4" rx="5" ry="2.1" />
      <path d="M3 4v8c0 1.16 2.24 2.1 5 2.1s5-.94 5-2.1V4" />
      <path d="M3 8c0 1.16 2.24 2.1 5 2.1s5-.94 5-2.1" />
    </svg>
  );
}

/**
 * 浮层的位置与开关。
 *
 * 位置在视口坐标系里算：面板比触发器宽，先水平居中再夹到视口内，垂直方向贴着
 * 触发器上沿（输入卡在底部，向下展开会跑出屏幕）。滚动与缩放时重算——面板是
 * portal 出去的，不会跟着卡自己移动。
 */
function usePopup(available: boolean): {
  open: boolean;
  rootRef: RefObject<HTMLSpanElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties | null;
  toggle(): void;
} {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 数据失效（例如压缩后上下文占用未知）时不能再留着一个空面板。
  useEffect(() => {
    if (!available && open) setOpen(false);
  }, [available, open]);

  const place = useCallback((): void => {
    const anchor = rootRef.current;
    const panel = panelRef.current;
    if (anchor === null || panel === null) return;
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const left = Math.min(
      Math.max(PANEL_MARGIN, rect.left + rect.width / 2 - width / 2),
      Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
    );
    const top = Math.max(PANEL_MARGIN, rect.top - PANEL_GAP - height);
    setPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    // 首帧先量尺寸再落位：面板宽度是 max-content，只有渲染出来才知道多大。
    place();
    // scroll 用捕获阶段，滚动发生在任何一个祖先容器里都能跟上。
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const anchor = rootRef.current;
      const panel = panelRef.current;
      const inside = (anchor !== null && anchor.contains(target)) || (panel !== null && panel.contains(target));
      if (!inside) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, rootRef, panelRef, position, toggle: () => setOpen(value => !value) };
}

/**
 * 浮层外壳：portal 到 body，首帧先隐藏（等量完尺寸再落位），点面板本身不关闭。
 */
function PopupSurface({ panelRef, position, label, className, children }: {
  panelRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties | null;
  label: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  return createPortal(
    <div
      ref={panelRef}
      className={`statsPanel${className === undefined ? '' : ` ${className}`}`}
      role="dialog"
      aria-label={label}
      style={position === null ? { left: 0, top: 0, visibility: 'hidden' } : position}
    >
      <div className="statsPanelMaterial" aria-hidden />
      <div className="statsPanelBody">{children}</div>
    </div>,
    document.body,
  );
}

/** 明细面板里的一行：左侧名称，右侧等宽数字。 */
function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="statsRow">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * 累计量胶囊：主数字是「已计费输入 ＋ 输出」。
 *
 * 提示词侧的三个桶（未缓存输入、缓存读取、缓存写入）都会计费，因此主数字必须
 * 把它们全算进去；`total` 只在明细面板里作标题右侧的精确值出现。
 */
function UsagePill({ usage, countUp }: { usage: TokenUsageView; countUp: boolean }): ReactNode {
  const { open, rootRef, panelRef, position, toggle } = usePopup(true);
  const billed = usage.input + usage.cacheRead + usage.cacheWrite;
  const total = billed + usage.output;
  const totalText = `${formatTokens(total)} tok`;
  const hitText = usage.cacheHitPercent === null ? null : `缓存命中 ${usage.cacheHitPercent}%`;

  return (
    <span ref={rootRef} className="statsAnchor">
      <button
        type="button"
        className="statsPill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hitText === null ? totalText : `${totalText}，${hitText}`}
        onClick={toggle}
      >
        <DatabaseIcon />
        <span className="statsLabel">
          {totalText}
          {hitText !== null ? (
            <>
              <span className="statsSep" aria-hidden>·</span>
              {hitText}
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <PopupSurface panelRef={panelRef} position={position} label="Token 用量">
          <div className="statsTitle">
            <span className="statsTitleLabel">
              <DatabaseIcon />
              Token 用量
            </span>
            <span className="statsTitleValue">
              {countUp
                ? <><CountUp to={total} separator="," duration={COUNT_UP_DURATION} /> tok</>
                : `${formatExactTokens(total)} tok`}
            </span>
          </div>
          <dl className="statsRows">
            {usage.cacheHitPercent !== null ? <Row label="缓存命中" value={`${usage.cacheHitPercent}%`} /> : null}
            <Row label="未缓存输入" value={formatExactTokens(usage.input)} />
            <Row label="缓存读取" value={formatExactTokens(usage.cacheRead)} />
            {usage.cacheWrite !== 0 ? <Row label="缓存写入" value={formatExactTokens(usage.cacheWrite)} /> : null}
            <Row label="输出" value={formatExactTokens(usage.output)} />
            {usage.cost > 0 ? <Row label="费用" value={`$${usage.cost.toFixed(4)}`} /> : null}
          </dl>
        </PopupSurface>
      ) : null}
    </span>
  );
}

/**
 * 上下文占用环：环长就是占用比例，读数直接来自 Pi。
 *
 * 这个数与会话累计消耗是两回事——压缩后它会掉下来，而累计消耗只增不减，因此
 * 面板里明确写「上下文已用」而不是「已用」。
 */
function ContextRing({ usage, countUp }: { usage: ContextUsageView; countUp: boolean }): ReactNode {
  const { open, rootRef, panelRef, position, toggle } = usePopup(true);
  // 估算值可能略微超过窗口（Pi 的 percent 不做上限），读数与图形都按 100 封顶，
  // 否则会出现「环画满了、数字写 103%」这种自相矛盾的画面。
  const shown = Math.min(100, usage.percent);
  const reading = `${Math.round(shown)}%`;
  const label = `上下文已用 ${reading}`;
  const warn = shown >= CONTEXT_WARN_PERCENT;

  return (
    <span ref={rootRef} className="statsAnchor contextAnchor">
      <button
        type="button"
        className="contextTrigger"
        data-warn={warn}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <circle className="contextTrack" cx="8" cy="8" r={RADIUS} />
          <circle
            className="contextFill"
            cx="8"
            cy="8"
            r={RADIUS}
            strokeDasharray={`${(CIRCUMFERENCE * shown) / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span>
          {countUp ? <><CountUp to={Math.round(shown)} duration={COUNT_UP_DURATION} />%</> : reading}
        </span>
      </button>
      {open ? (
        <PopupSurface panelRef={panelRef} position={position} label="上下文已用" className="contextPanel">
          <div className="contextHeader">
            <span className="contextHeadline">上下文已用</span>
            <span className="contextPercent">{reading}</span>
            <span className="contextFigures">
              {`~${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)}`}
            </span>
          </div>
          <div className="contextBar">
            <div className="contextSegment" data-warn={warn} style={{ width: `${shown}%` }} />
          </div>
        </PopupSurface>
      ) : null}
    </span>
  );
}

export function StatsDock({ tokenUsage, contextUsage, countUp = false }: StatsDockProps): ReactNode {
  // 整条底栏没有任何可展示的读数时直接不渲染，避免输入卡下面留一条空行。
  if (tokenUsage === null && contextUsage === null) return null;
  return (
    <div className="statsDock" data-composer-stats>
      {tokenUsage !== null ? <UsagePill usage={tokenUsage} countUp={countUp} /> : null}
      {contextUsage !== null ? <ContextRing usage={contextUsage} countUp={countUp} /> : null}
    </div>
  );
}
