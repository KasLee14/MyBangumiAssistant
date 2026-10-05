/**
 * 来源：React Bits「Pixel Transition」的 CSS 变体 TS 源码
 *       （registry 端点 https://reactbits.dev/r/PixelTransition-TS-CSS 的 files[].content，
 *       官方文档页 https://www.reactbits.dev/animations/pixel-transition）。
 * 本地改动（相对官方源码逐条）：
 *   1. 像素幕布由 gsap 逐格切 display（none / block）改为 opacity 0 <-> 1：
 *      gsap.to(..., { display: 'block'|'none' }) 全部换成 { opacity: 1|0 }，像素格常驻 DOM 且常驻布局，
 *      幕布的铺满与退场只改合成器属性；幕布铺满那一刻才切内容层（这一条与官方一致，用 delayedCall 表达）。
 *   2. 内容层的切换同样由 display 改为 opacity + pointer-events：官方 JS 直接写 activeEl.style.display /
 *      pointerEvents，本地改为根节点上的 .pixelTransition--active 类 + CSS 过渡（第二层 opacity 0/1、
 *      pointer-events none/auto），层与层之间的交接不再产生任何布局抖动。
 *   3. 像素格由 JS 建 div + 内联 left/top/width/height 改为 React 渲染 + CSS grid：
 *      网格列数由 --pixelTransition-grid 驱动（repeat(var(--pixelTransition-grid), minmax(0, 1fr))），
 *      像素格身上不再有任何定位内联样式（官方每格写 4 个百分比属性）。
 *   4. pixelColor 默认值由 'currentColor'（官方卡片底 #222 / 文字 #fff，currentColor 实际落在白色上）
 *      改为 var(--bgm-primary)，并且不再逐格写 background-color，
 *      改为根节点写 --pixelTransition-pixelColor、CSS 里 background-color: var(--pixelTransition-pixelColor)
 *      （默认值仍是令牌，显式传入 hex / rgb / color-mix 等自由色值的能力保留）。
 *   5. CSS 配色令牌化：卡片底 #222 -> var(--bgm-surface)、文字 #fff -> var(--bgm-text)、
 *      描边 2px #fff -> 1px var(--app-hairline-strong)、圆角 15px -> var(--app-radius-panel)；
 *      层切换过渡用 --app-dur-fast / --app-ease-out。
 *   6. 类名加组件前缀：.pixelated-image-card* -> .pixelTransition / .pixelTransition__*（本项目 vendor 约定）。
 *   7. 补 prefers-reduced-motion: reduce 支持：CSS 去掉层过渡，JS 检测到减少动效时直接切层、不拉幕布
 *      （像素幕布是纯装饰，没有它也不损失信息），并监听 media query 变化。
 *   8. 补 gridSize 防御：Math.max(1, Math.floor(gridSize))，官方传 0 / 负数会算出 0 个像素（幕布静默失效）。
 *   9. 用「意图态」ref 判别悬停/点击，修掉官方的竞态：进场幕布还没铺满就移出指针时，官方会因为
 *      isActive 尚未置位而漏掉 leave，卡片卡在激活态。
 *   10. 形态对齐本项目 vendor：去掉 'use client'；React.FC 改为普通函数组件 + 命名导出（另给 default 导出）；
 *      props 类型导出；去掉从声明到卸载都没被读取的 containerRef；卸载时收掉未跑完的 tweens 与 delayedCall；
 *      firstContent / secondContent 的类型由 React.ReactNode | string 收敛为 ReactNode（string 本就是 ReactNode）。
 * 为什么改：
 *   - 项目硬要求「只允许动 transform / opacity / filter / background-position，不允许用 display 切换驱动动画」：
 *     display 在 none <-> block 之间切换会让节点进出布局树，触发重排，破坏会话流 content-visibility: auto 的屏外优化；
 *     官方注释里写的也是「pixel dissolve transition」，用 opacity 表达才符合它自己的视觉意图。
 *   - 硬编码色值（#222 / #fff）不随外观层变化：幕布默认色必须是 --bgm-primary 这类令牌，
 *     否则在同色系卡片上会突然出现一块深色方块。
 *   - 尊重 prefers-reduced-motion：像素幕布本身不是循环动画，但用户声明减少动效时不该再来一段随机闪光。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { gsap } from 'gsap';
import './PixelTransition.css';

export interface PixelTransitionProps {
  /** 默认展示的内容层（幕布下面的那一层） */
  firstContent: ReactNode;
  /** 交互后展示的内容层，盖在第一层之上 */
  secondContent: ReactNode;
  /** 像素幕布的网格边长（格数 = gridSize²），默认 7 */
  gridSize?: number;
  /** 像素颜色，默认取令牌 --bgm-primary；显式传色值则不随外观层变化 */
  pixelColor?: string;
  /** 幕布铺满（或退场）所需总时长，单位秒 */
  animationStepDuration?: number;
  /** 只切换一次，不再切回第一层 */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  /** 占位比例，作为 padding-top 百分比使用（官方同名 prop，默认 '100%' 即正方形） */
  aspectRatio?: string;
}

export function PixelTransition({
  firstContent,
  secondContent,
  gridSize = 7,
  pixelColor = 'var(--bgm-primary)',
  animationStepDuration = 0.3,
  once = false,
  aspectRatio = '100%',
  className = '',
  style
}: PixelTransitionProps) {
  const pixelGridRef = useRef<HTMLDivElement>(null);
  const delayedCallRef = useRef<gsap.core.Tween | null>(null);
  const tweensRef = useRef<Array<gsap.core.Tween>>([]);
  // 意图态：幕布还在铺的时候 state 尚未更新，判定必须看意图（官方在这一处会漏掉 leave）
  const targetRef = useRef(false);

  const [isSecondVisible, setIsSecondVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // 网格至少 1 格：官方允许 gridSize 传 0 / 负数，那会生成 0 个像素（幕布静默失效）
  const columns = Math.max(1, Math.floor(gridSize));
  const pixelCount = columns * columns;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  // 卸载时收掉还在跑的时间线，避免 delayedCall 在组件消失后 setState
  useEffect(
    () => () => {
      delayedCallRef.current?.kill();
      for (const tween of tweensRef.current) tween.kill();
      tweensRef.current = [];
    },
    []
  );

  const isTouchDevice =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches;

  const reveal = useCallback(
    (activate: boolean): void => {
      targetRef.current = activate;

      const grid = pixelGridRef.current;
      const pixels: Element[] = grid ? Array.from(grid.children) : [];

      // 减少动效（或没有幕布可拉）：不铺幕布，直接切层
      if (reducedMotion || pixels.length === 0) {
        setIsSecondVisible(activate);
        return;
      }

      gsap.killTweensOf(pixels);
      delayedCallRef.current?.kill();
      for (const tween of tweensRef.current) tween.kill();

      // 每格自己的 stagger 间隔：全部铺满正好花掉 animationStepDuration
      const staggerDuration = animationStepDuration / pixels.length;

      // 幕布铺满（随机顺序，总时长 animationStepDuration）→ 铺满那一刻在幕布下面切内容层 →
      // 幕布按同样节奏随机退场。全程只有 opacity 在变，display 与几何尺寸一动不动。
      gsap.set(pixels, { opacity: 0 });
      const fadeIn = gsap.to(pixels, {
        opacity: 1,
        duration: 0,
        stagger: { each: staggerDuration, from: 'random' }
      });
      delayedCallRef.current = gsap.delayedCall(animationStepDuration, () =>
        setIsSecondVisible(activate)
      );
      const fadeOut = gsap.to(pixels, {
        opacity: 0,
        duration: 0,
        delay: animationStepDuration,
        stagger: { each: staggerDuration, from: 'random' }
      });
      tweensRef.current = [fadeIn, fadeOut];
    },
    [animationStepDuration, reducedMotion]
  );

  const handleEnter = (): void => {
    if (!targetRef.current) reveal(true);
  };
  const handleLeave = (): void => {
    if (targetRef.current && !once) reveal(false);
  };
  const handleClick = (): void => {
    if (!targetRef.current) reveal(true);
    else if (!once) reveal(false);
  };

  const classNames = ['pixelTransition', isSecondVisible ? 'pixelTransition--active' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      style={
        {
          // 网格列数与像素色都走 CSS 变量：像素格身上没有任何内联样式
          '--pixelTransition-grid': columns,
          '--pixelTransition-pixelColor': pixelColor,
          ...style
        } as CSSProperties
      }
      onMouseEnter={isTouchDevice ? undefined : handleEnter}
      onMouseLeave={isTouchDevice ? undefined : handleLeave}
      onClick={isTouchDevice ? handleClick : undefined}
      onFocus={isTouchDevice ? undefined : handleEnter}
      onBlur={isTouchDevice ? undefined : handleLeave}
      tabIndex={0}
    >
      <div className="pixelTransition__ratio" style={{ paddingTop: aspectRatio }} />
      <div className="pixelTransition__default" aria-hidden={isSecondVisible}>
        {firstContent}
      </div>
      <div className="pixelTransition__second" aria-hidden={!isSecondVisible}>
        {secondContent}
      </div>
      <div className="pixelTransition__pixels" ref={pixelGridRef}>
        {Array.from({ length: pixelCount }, (_, index) => (
          <div className="pixelTransition__pixel" key={index} />
        ))}
      </div>
    </div>
  );
}

export default PixelTransition;
