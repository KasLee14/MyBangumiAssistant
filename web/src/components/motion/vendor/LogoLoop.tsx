/**
 * 来源：React Bits「Logo Loop」的 CSS 变体 TS 源码
 *       （registry 端点 https://reactbits.dev/r/LogoLoop-TS-CSS 的 files[].content，
 *       官方文档页 https://www.reactbits.dev/animations/logo-loop）。
 * 本地改动（相对官方源码逐条）：
 *   1. 删掉 useAnimationLoop（requestAnimationFrame 常驻循环 + 速度积分 + 指数缓动）与悬停的 useState，
 *      改由 CSS @keyframes 驱动 transform: translate3d(...)：JS 只在尺寸变化时量一次「一个序列」的长度，
 *      据此算 animation-duration（= 序列长度 / speed，等价于官方 speed 的 px/s 语义）并写进 CSS 变量；
 *      暂停交给 animation-play-state，悬停不再触发任何 React 重渲染（官方每帧都会 set 一次 transform）。
 *   2. 补 speed <= 0 的静止分支：官方对 speed 取绝对值，传 0 时视觉上不动但 rAF 循环照跑，传负数反而反向滚动；
 *      本地只有 speed > 0 且量到尺寸时才挂 logoLoop--animated，speed <= 0 时 track 上没有任何动画。
 *   3. pauseOnHover 默认值由 undefined（官方在 effectiveHoverSpeed 里兜底成 0，效果就是默认暂停）改为显式 true；
 *      hoverSpeed 语义保留（正数 = left/up 方向，负数反向，0 = 暂停），注意：CSS 换向是瞬时的，
 *      悬停时方向与基础方向相反会跳一帧，官方用速度积分平滑过渡，这里没做。
 *   4. 补 @media (prefers-reduced-motion: reduce) 静止（官方只用 !important 把 transform 钉回 0，rAF 仍在跑）。
 *   5. fadeOut 的遮罩色默认由 #ffffff（深色偏好下 #0b0b0b）改为 --app-surface，渐变终点用 color-mix 就地派生；
 *      fadeOutColor 仍可显式传入任意色值。
 *   6. 配色与时长令牌化：过渡 0.3s / 0.2s 与 cubic-bezier(0.4, 0, 0.2, 1) 改用 --app-dur-slow /
 *      --app-dur-base / --app-ease-out；链接焦点环由 currentColor 改为 --bgm-interactive；圆角 4px 改为 --bgm-r-sm。
 *   7. 类名加组件前缀：.logoloop* -> .logoLoop*（本项目 vendor 约定，避免与既有 .app* / .content* 冲突）；
 *      BEM 修饰类改 camelCase（--scale-hover -> --scaleHover），与本目录既有组件一致。
 *   8. CSS 补列表重置（margin / padding / list-style）：本项目没有 Tailwind preflight，官方样式依赖了它。
 *   9. 形态对齐本项目 vendor：去掉 'use client'；React.memo 保留但改为命名函数组件；
 *      type 导入按 verbatimModuleSyntax 拆出；去掉官方对 containerRef.style.height 的写入
 *      （纵向模式改由 CSS 的 height: 100% 承担，需要父级有确定高度）。
 *      数据源 prop 仍是官方的 logos: LogoItem[]（未引入 items 别名），LogoItem 联合类型逐字保留，
 *      renderItem / width / ariaLabel / style / className 等 props 一个没减。
 *   10. speed 默认值 120 -> 40（项目动效节奏，120px/s 偏快）。
 * 为什么改：
 *   - 项目原则「不做无意义的常驻循环，但允许表达『进行中 / 可交互』的循环」：LogoLoop 表达的是「这排还在滚动、
 *     可交互」，循环本身保留；但官方用 requestAnimationFrame 无条件跑，页面上每多一个实例就多一条常驻主线程循环，
 *     且会话流的 content-visibility: auto 让屏外区块不再渲染时它仍在算。CSS keyframes 归合成器，成本低一个量级。
 *   - 硬编码色值（#ffffff / #0b0b0b）不随外观层变化，遮罩落在 --bgm-surface 白面上会糊出灰边。
 *   - 动画只动 transform（悬停缩放动 transform、链接 hover 动 opacity），不碰 width / height / top / left，
 *     不触发布局重排，也不破坏会话流 content-visibility: auto 的屏外优化。
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DependencyList,
  type Key,
  type ReactNode,
  type RefObject
} from 'react';
import './LogoLoop.css';

export type LogoItem =
  | {
      node: ReactNode;
      href?: string;
      title?: string;
      ariaLabel?: string;
    }
  | {
      src: string;
      alt?: string;
      href?: string;
      title?: string;
      srcSet?: string;
      sizes?: string;
      width?: number;
      height?: number;
    };

export interface LogoLoopProps {
  /** 循环数据源：node 项（自绘节点）或 src 项（图片），形状与官方一致 */
  logos: LogoItem[];
  /** 滚动速度，单位 px/s；<= 0 时完全静止（官方此处只取绝对值，做不到「0 = 静止」） */
  speed?: number;
  /** 滚动方向，默认 left；up / down 走纵向轨道（需要父级有确定高度） */
  direction?: 'left' | 'right' | 'up' | 'down';
  /** 轨道可视宽度，默认 100% */
  width?: number | string;
  /** logo 高度，单位 px */
  logoHeight?: number;
  /** 相邻 logo 的间距，单位 px */
  gap?: number;
  /** 悬停暂停，默认 true */
  pauseOnHover?: boolean;
  /** 悬停时的速度，单位 px/s：正数 = left/up 方向，负数反向，0 = 在悬停时暂停 */
  hoverSpeed?: number;
  /** 两侧渐隐遮罩 */
  fadeOut?: boolean;
  /** 遮罩颜色，默认取令牌 --app-surface；显式传色值则不随外观层变化 */
  fadeOutColor?: string;
  /** 悬停时放大 logo */
  scaleOnHover?: boolean;
  /** 自定义每项渲染（官方同名 prop） */
  renderItem?: (item: LogoItem, key: Key) => ReactNode;
  /** 区域 aria-label */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** 至少铺两份，保证位移到头时接得上 */
const MIN_COPIES = 2;
/** 多铺几份，让轨道永远比容器宽，序列短时也不会露白 */
const COPY_HEADROOM = 2;

const toCssLength = (value?: number | string): string | undefined =>
  typeof value === 'number' ? `${value}px` : value;

/**
 * 只做「量尺寸 → 回调」，不参与动画驱动。
 * 尺寸变化只需要重算 duration 与份数，动画本身由 CSS 接管，因此这里没有逐帧逻辑。
 */
function useResizeObserver(
  onResize: () => void,
  refs: Array<RefObject<Element | null>>,
  dependencies: DependencyList
): void {
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', onResize);
      onResize();
      return () => window.removeEventListener('resize', onResize);
    }

    const observer = new ResizeObserver(onResize);
    for (const ref of refs) {
      if (ref.current) observer.observe(ref.current);
    }
    onResize();

    return () => observer.disconnect();
    // 依赖由调用方给出：logos / gap / logoHeight / 方向变化都要重量一次
  }, dependencies);
}

export const LogoLoop = memo(function LogoLoop({
  logos,
  // 默认静止（0 = 不挂 --animated）：与 web/AGENTS.md 外观约定第 4 条「常驻循环默认静止」一致。
  // 需要流动时由调用方显式传正数，例如 speed={32}。
  speed = 0,
  direction = 'left',
  width = '100%',
  logoHeight = 28,
  gap = 32,
  pauseOnHover = true,
  hoverSpeed,
  fadeOut = false,
  fadeOutColor,
  scaleOnHover = false,
  renderItem,
  ariaLabel = 'Partner logos',
  className = '',
  style
}: LogoLoopProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef<HTMLUListElement>(null);

  const [seqWidth, setSeqWidth] = useState(0);
  const [seqHeight, setSeqHeight] = useState(0);
  const [copyCount, setCopyCount] = useState(MIN_COPIES);

  const isVertical = direction === 'up' || direction === 'down';

  const measure = useCallback(() => {
    const container = containerRef.current;
    const sequence = seqRef.current;
    if (!container || !sequence) return;

    const rect = sequence.getBoundingClientRect();
    // 第一个 <ul> 的 border-box 宽度 = 一份序列（含末尾 gap），位移 = 轨道宽 / 份数 = 一份序列，无缝
    const viewport = isVertical ? container.clientHeight : container.clientWidth;

    if (isVertical) {
      if (rect.height <= 0) return;
      setSeqHeight(Math.ceil(rect.height));
      setCopyCount(Math.max(MIN_COPIES, Math.ceil(viewport / rect.height) + COPY_HEADROOM));
    } else {
      if (rect.width <= 0) return;
      setSeqWidth(Math.ceil(rect.width));
      setCopyCount(Math.max(MIN_COPIES, Math.ceil(viewport / rect.width) + COPY_HEADROOM));
    }
  }, [isVertical]);

  useResizeObserver(measure, [containerRef, seqRef], [measure, logos, gap, logoHeight, isVertical]);

  const animation = useMemo(() => {
    const sequence = isVertical ? seqHeight : seqWidth;

    // speed <= 0（或还没量到尺寸）→ 完全静止：不挂 logoLoop--animated，track 上没有任何动画
    const cycle = sequence > 0 && speed > 0 ? sequence / speed : 0;

    // keyframes 以 left / up 为正方向，right / down 用 animation-direction: reverse 复用同一组关键帧
    const baseDirection = direction === 'left' || direction === 'up' ? 'normal' : 'reverse';

    // 官方 hoverSpeed 是不带方向乘数的原始速度：正数 = left/up，负数反向，0 = 暂停
    const effectiveHoverSpeed = hoverSpeed ?? (pauseOnHover ? 0 : undefined);
    const hoverPauses = cycle > 0 && effectiveHoverSpeed === 0;
    const hoverCycle =
      cycle > 0 && effectiveHoverSpeed !== undefined && effectiveHoverSpeed !== 0
        ? sequence / Math.abs(effectiveHoverSpeed)
        : 0;

    return {
      cycle,
      baseDirection,
      hoverPauses,
      hoverCycle,
      hoverReverses: effectiveHoverSpeed !== undefined && effectiveHoverSpeed < 0
    };
  }, [direction, hoverSpeed, pauseOnHover, seqHeight, seqWidth, speed, isVertical]);

  const cssVariables = useMemo(() => {
    const vars: Record<string, string | number> = {
      '--logoLoop-gap': `${gap}px`,
      '--logoLoop-logoHeight': `${logoHeight}px`,
      '--logoLoop-copies': copyCount,
      '--logoLoop-direction': animation.baseDirection
    };
    if (animation.cycle > 0) vars['--logoLoop-duration'] = `${animation.cycle}s`;
    if (animation.hoverCycle > 0) vars['--logoLoop-hover-duration'] = `${animation.hoverCycle}s`;
    if (animation.hoverReverses) vars['--logoLoop-hover-direction'] = 'reverse';
    if (fadeOutColor !== undefined) vars['--logoLoop-fadeColor'] = fadeOutColor;
    return vars;
  }, [animation, copyCount, fadeOutColor, gap, logoHeight]);

  const renderLogoItem = useCallback(
    (item: LogoItem, key: Key) => {
      if (renderItem) {
        return (
          <li className="logoLoop__item" key={key} role="listitem">
            {renderItem(item, key)}
          </li>
        );
      }

      const content =
        'node' in item ? (
          <span
            className="logoLoop__node"
            aria-hidden={item.href !== undefined && item.ariaLabel === undefined}
          >
            {item.node}
          </span>
        ) : (
          <img
            src={item.src}
            srcSet={item.srcSet}
            sizes={item.sizes}
            width={item.width}
            height={item.height}
            alt={item.alt ?? ''}
            title={item.title}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        );

      const itemAriaLabel = 'node' in item ? item.ariaLabel ?? item.title : item.alt ?? item.title;
      const itemContent =
        item.href !== undefined ? (
          <a
            className="logoLoop__link"
            href={item.href}
            aria-label={itemAriaLabel ?? 'logo link'}
            target="_blank"
            rel="noreferrer noopener"
          >
            {content}
          </a>
        ) : (
          content
        );

      return (
        <li className="logoLoop__item" key={key} role="listitem">
          {itemContent}
        </li>
      );
    },
    [renderItem]
  );

  const logoLists = useMemo(
    () =>
      Array.from({ length: copyCount }, (_, copyIndex) => (
        <ul
          className="logoLoop__list"
          key={`copy-${copyIndex}`}
          role="list"
          aria-hidden={copyIndex > 0}
          ref={copyIndex === 0 ? seqRef : undefined}
        >
          {logos.map((item, itemIndex) => renderLogoItem(item, `${copyIndex}-${itemIndex}`))}
        </ul>
      )),
    [copyCount, logos, renderLogoItem]
  );

  const rootClassName = [
    'logoLoop',
    isVertical ? 'logoLoop--vertical' : 'logoLoop--horizontal',
    animation.cycle > 0 ? 'logoLoop--animated' : 'logoLoop--static',
    animation.hoverPauses ? 'logoLoop--hoverPause' : '',
    animation.hoverCycle > 0 ? 'logoLoop--hoverSpeed' : '',
    fadeOut ? 'logoLoop--fade' : '',
    scaleOnHover ? 'logoLoop--scaleHover' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  const resolvedWidth = toCssLength(width) ?? '100%';

  const containerStyle = {
    // 纵向模式宽度交给父级（与官方一致：'100%' 不写死）
    ...(isVertical && resolvedWidth === '100%' ? {} : { width: resolvedWidth }),
    ...cssVariables,
    ...style
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      style={containerStyle}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="logoLoop__track">{logoLists}</div>
    </div>
  );
});

LogoLoop.displayName = 'LogoLoop';

export default LogoLoop;
