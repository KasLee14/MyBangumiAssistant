/**
 * LineSidebar —— React Bits 组件（本项目 vendor 形态）
 *
 * ① 来源
 *    - registry 端点：https://reactbits.dev/r/LineSidebar-TS-CSS
 *    - 官方页面：https://www.reactbits.dev/components/line-sidebar
 *    官方依赖为 `[]`（只用 React），本地同样不引入任何新依赖。
 *
 * ② 本地相对官方源码改了什么
 *    1. 配色令牌化：官方硬编码的 `#A855F7` / `#c4c4c4` / `#6c6c6c`，在 props 默认值
 *       与 CSS 回退值里统一换成 `var(--bgm-primary)` / `var(--bgm-border)` /
 *       `var(--bgm-text-muted)`；就近高亮按 color-mix 从 `--bgm-primary` 派生。
 *       本文件（含默认值）不再出现任何字面色值。
 *    2. 类名与自定义属性加组件前缀：`.lineSidebar*` / `--lineSidebar-*`。官方的
 *       `.line-sidebar__item`、`--accent-color` 等是通用名，而本项目 CSS 是全局作用域
 *       （无 CSS Modules），不加前缀会与 `.app*` / `.content*` 以及同目录其它 vendor
 *       组件互相污染。
 *    3. 尊重 `prefers-reduced-motion: reduce`：JS 侧不再走 rAF 缓动，直接把终值写进
 *       `--effect`；CSS 侧用 `--lineSidebar-shiftFactor: 0` 关掉标签的位移动画。
 *    4. 删掉官方声明、但没有任何规则消费的 `--smoothing` 死变量（真正的平滑由 JS 的
 *       rAF 缓动负责，官方注释里也这么写）。
 *    5. 类型收口：`PointerEvent` / `CSSProperties` 用具名 type 导入（本项目开了
 *       `verbatimModuleSyntax`，类型不能当值导入）；`ref` 回调保持块体写法。
 *
 * ③ 为什么改
 *    本项目只走 Bangumi 浅色令牌（`styles/bgm.css`）、样式文件是全局作用域、且动效
 *    必须能随系统的「减少动态效果」降级。官方源码面向深色演示页、用全局类名、没有
 *    任何无障碍降级，直接落地会同时带来硬编码色值、类名冲突与「关了动效仍在位移」
 *    三个问题。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import './LineSidebar.css';

type Falloff = 'linear' | 'smooth' | 'sharp';

export interface LineSidebarProps {
  items?: string[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showIndex?: boolean;
  showMarker?: boolean;
  proximityRadius?: number;
  maxShift?: number;
  falloff?: Falloff;
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  fontSize?: number;
  smoothing?: number;
  defaultActive?: number | null;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
}

const FALLOFF_CURVES: Record<Falloff, (p: number) => number> = {
  linear: p => p,
  smooth: p => p * p * (3 - 2 * p),
  sharp: p => p * p * p
};

const DEFAULT_ITEMS = [
  'Overview',
  'Components',
  'Animations',
  'Backgrounds',
  'Showcase',
  'Playground',
  'Templates',
  'Changelog',
  'Community',
  'Resources',
  'Documentation',
  'Support'
];

export function LineSidebar({
  items = DEFAULT_ITEMS,
  // 官方是 #A855F7 / #c4c4c4 / #6c6c6c：这里按要求换成令牌。注意浅色底上的观感差异——
  // `--bgm-border` 当静息**文字**色对比度极低（浅底上几乎看不见），若实际用起来
  // 「像没字」，把 textColor 改成 var(--bgm-text-muted)、markerColor 改成
  // var(--bgm-border) 即可（只改这三个默认值，样式文件不用动）。
  accentColor = 'var(--bgm-primary)',
  textColor = 'var(--bgm-border)',
  markerColor = 'var(--bgm-text-muted)',
  showIndex = true,
  showMarker = true,
  proximityRadius = 100,
  maxShift = 30,
  falloff = 'smooth',
  markerLength = 60,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 20,
  fontSize = 1.1,
  smoothing = 100,
  defaultActive = null,
  onItemClick,
  className = ''
}: LineSidebarProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const activeRef = useRef<number | null>(defaultActive);
  const smoothingRef = useRef(smoothing);
  const reducedMotionRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(defaultActive);

  activeRef.current = activeIndex;
  smoothingRef.current = smoothing;

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // 单条 rAF 循环：用与帧率无关的指数平滑，把每条目的 --effect 逼向目标值。
  // 颜色、位移、透明度都读同一个 --effect，所以它们天然同步，不需要 CSS transition
  // 去对齐时间轴（官方注释同样这么解释）。
  const syncFrame = useCallback(
    (now: number) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.05);
      lastRef.current = now;
      const tau = Math.max(smoothingRef.current, 1) / 1000;
      const k = 1 - Math.exp(-dt / tau);

      let moving = false;
      const els = itemRefs.current;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const target = Math.max(targetsRef.current[i] || 0, activeRef.current === i ? 1 : 0);
        const cur = currentRef.current[i] || 0;
        const next = cur + (target - cur) * k;
        const settled = Math.abs(target - next) < 0.0015;
        const value = settled ? target : next;
        currentRef.current[i] = value;
        el.style.setProperty('--effect', value.toFixed(4));
        if (!settled) moving = true;
      }

      rafRef.current = moving ? requestAnimationFrame(syncFrame) : null;
    },
    []
  );

  // 不做缓动，直接把目标值落成终值。prefers-reduced-motion 分支用它。
  const applyImmediate = useCallback(() => {
    stopLoop();
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const target = Math.max(targetsRef.current[i] || 0, activeRef.current === i ? 1 : 0);
      currentRef.current[i] = target;
      el.style.setProperty('--effect', target.toFixed(4));
    }
  }, [stopLoop]);

  const startLoop = useCallback(() => {
    // 减少动态效果：不排帧、不缓动，指针一动就直接跳到终值
    if (reducedMotionRef.current) {
      applyImmediate();
      return;
    }
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(syncFrame);
  }, [applyImmediate, syncFrame]);

  // 系统「减少动态效果」开关：跟随变化，切换时立刻把当前状态对齐
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = () => {
      reducedMotionRef.current = mq.matches;
      startLoop();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [startLoop]);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLUListElement>) => {
      const list = listRef.current;
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const ease = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;
      const els = itemRefs.current;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const center = el.offsetTop + el.offsetHeight / 2;
        const distance = Math.abs(pointerY - center);
        targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
      }
      startLoop();
    },
    [falloff, proximityRadius, startLoop]
  );

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  const handleClick = useCallback(
    (index: number, label: string) => {
      setActiveIndex(index);
      onItemClick?.(index, label);
    },
    [onItemClick]
  );

  useEffect(() => {
    startLoop();
  }, [activeIndex, startLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  return (
    <nav
      className={`lineSidebar${showMarker ? ' lineSidebar--markers' : ''}${scaleTick ? ' lineSidebar--scaleTick' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          // 自定义属性全部加 lineSidebar 前缀，避免污染子树里的同名变量
          '--lineSidebar-accent': accentColor,
          '--lineSidebar-text': textColor,
          '--lineSidebar-marker': markerColor,
          '--lineSidebar-markerLength': `${markerLength}px`,
          '--lineSidebar-markerGap': `${markerGap}px`,
          '--lineSidebar-tickScale': tickScale,
          '--lineSidebar-maxShift': `${maxShift}px`,
          '--lineSidebar-itemGap': `${itemGap}px`,
          '--lineSidebar-fontSize': `${fontSize}rem`
          // --lineSidebar-shiftFactor 故意不内联：它要留给 CSS 的
          // prefers-reduced-motion 段覆盖（内联样式优先级更高，内联了就关不掉）
        } as CSSProperties
      }
    >
      <ul ref={listRef} className="lineSidebarList" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
        {items.map((label, index) => (
          <li
            key={`${label}-${index}`}
            ref={el => {
              itemRefs.current[index] = el;
            }}
            className="lineSidebarItem"
            aria-current={activeIndex === index ? 'true' : undefined}
            onClick={() => handleClick(index, label)}
          >
            {showMarker && <span className="lineSidebarMarker" aria-hidden="true" />}
            <span className="lineSidebarLabel">
              {showIndex && <span className="lineSidebarIndex">{String(index + 1).padStart(2, '0')}</span>}
              <span className="lineSidebarText">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default LineSidebar;
