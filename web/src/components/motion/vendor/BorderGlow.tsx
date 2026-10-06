/**
 * 来源：https://reactbits.dev/components/border-glow（ReactBits 官方源码拷贝）
 *
 * 相对官方的逐条改动：
 * 1. **配色令牌化**：`backgroundColor` 默认值由 `#120F17` 改为 `var(--app-surface)`、
 *    `colors` 默认值由官方那组紫/粉/蓝 hex 改为由 `--bgm-primary` 派生的三色、
 *    `glowColor` 默认值由官方的黄绿（`40 80 80`）改为主色 HSL；
 *    CSS 里描边、六层阴影、七色 mesh 回退值与 `--glow-color*` 回退值全部换成令牌派生。
 * 2. **底色走变量层**：`--card-bg-css`（消费方注入，本项目是玻璃填充）优先于 `--card-bg`，
 *    所以输入卡能吃到 `.appGlass` 那一套玻璃令牌。
 * 3. **`--light` 分支只剩 `mix-blend-mode`**：官方在这里另给一套浅色描边与阴影，
 *    现在基础分支已是同一批 `--app-*` 令牌，两处都写会让同一属性出现两个来源。
 * 4. **扫描编排参数集中为 `SWEEP`**：它们是一次扫过的编排（不是全站过渡节奏），
 *    所以不套 `--app-dur-*`，但必须在一个地方能读全。
 * 5. 过渡时长改用 `--app-dur-*` / `--app-ease-*`；`animated` 开关保持默认关闭。
 *
 * 为什么改：本项目的表面与动效全部由令牌驱动，硬编码色值在浅色令牌体系下要么发灰、
 * 要么与粉调打架；而 `glowColor` 用 `H S L` 三段数字是本组件的 API 格式（装不下 `var()`），
 * 所以 CSS 侧的回退值必须自己令牌化。
 *
 * 保留的官方行为：指针距离与角度算法、锥形遮罩、七点位 mesh 渐变、
 * `isLightColor()`（只认 hex）与 `--light` 类（现在与默认渲染等价，保留是为了与官方结构对齐）。
 */
import { useRef, useCallback, useEffect, type ReactNode, type PointerEvent, type CSSProperties } from 'react';
import './BorderGlow.css';

export interface BorderGlowProps {
  children?: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  animated?: boolean;
  colors?: string[];
  fillOpacity?: number;
}

/**
 * 指针扫描（`animated`）的编排参数，集中在这里。
 *
 * 它们是「一次扫过」的编排，不是全站动效节奏，所以不套 `--app-dur-*` 令牌
 * （那些是过渡时长）；放一处是为了让「扫多久、何时收」一眼可读。
 */
const SWEEP = {
  fadeIn: 500,
  sweepOut: 1500,
  sweepBack: 2250,
  fadeOut: 1500,
  fadeOutDelay: 2500,
  angleStart: 110,
  angleEnd: 465,
} as const;

function parseHSL(hslStr: string): { h: number; s: number; l: number } {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, s: 80, l: 80 };
  return { h: parseFloat(match[1]!), s: parseFloat(match[2]!), l: parseFloat(match[3]!) };
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHSL(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  const vars: Record<string, string> = {};
  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i]! * intensity, 100)}%)`;
  }
  return vars;
}

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function buildGradientVars(colors: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i]!, colors.length - 1)];
    vars[GRADIENT_KEYS[i]!] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
  return vars;
}

function isLightColor(color: string): boolean {
  const value = color.trim().replace('#', '');
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(value)) return false;
  const hex = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 180;
}

function easeOutCubic(x: number) { return 1 - Math.pow(1 - x, 3); }
function easeInCubic(x: number) { return x * x * x; }

interface AnimateOpts {
  start?: number; end?: number; duration?: number; delay?: number;
  ease?: (t: number) => number; onUpdate: (v: number) => void; onEnd?: () => void;
}

function animateValue({ start = 0, end = 100, duration = 1000, delay = 0, ease = easeOutCubic, onUpdate, onEnd }: AnimateOpts) {
  const t0 = performance.now() + delay;
  function tick() {
    const elapsed = performance.now() - t0;
    const t = Math.min(elapsed / duration, 1);
    onUpdate(start + (end - start) * ease(t));
    if (t < 1) requestAnimationFrame(tick);
    else if (onEnd) onEnd();
  }
  setTimeout(() => requestAnimationFrame(tick), delay);
}

export function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  // 默认光色 = 主色的 HSL（`H S L` 是组件的 API 格式，装不下 var()；CSS 侧回退值已令牌化）
  glowColor = '355 78 66',
  backgroundColor = 'var(--app-surface)',
  borderRadius = 20,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  // 默认渐变三色收进默认值：消费方（输入卡）不必再抄一遍同样的三色
  colors = [
    'var(--bgm-primary)',
    'color-mix(in srgb, var(--bgm-primary) 62%, var(--bgm-surface))',
    'color-mix(in srgb, var(--bgm-primary) 38%, var(--bgm-surface))',
  ],
  fillOpacity = 0.5,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const getCenterOfElement = useCallback((el: HTMLElement): [number, number] => {
    const { width, height } = el.getBoundingClientRect();
    return [width / 2, height / 2];
  }, []);

  const getEdgeProximity = useCallback((el: HTMLElement, x: number, y: number) => {
    const [cx, cy] = getCenterOfElement(el);
    const dx = x - cx;
    const dy = y - cy;
    let kx = Infinity;
    let ky = Infinity;
    if (dx !== 0) kx = cx / Math.abs(dx);
    if (dy !== 0) ky = cy / Math.abs(dy);
    return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
  }, [getCenterOfElement]);

  const getCursorAngle = useCallback((el: HTMLElement, x: number, y: number) => {
    const [cx, cy] = getCenterOfElement(el);
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return 0;
    const radians = Math.atan2(dy, dx);
    let degrees = radians * (180 / Math.PI) + 90;
    if (degrees < 0) degrees += 360;
    return degrees;
  }, [getCenterOfElement]);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const edge = getEdgeProximity(card, x, y);
    const angle = getCursorAngle(card, x, y);

    card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  }, [getEdgeProximity, getCursorAngle]);

  useEffect(() => {
    if (!animated || !cardRef.current) return;
    const card = cardRef.current;
    card.classList.add('sweep-active');
    card.style.setProperty('--cursor-angle', `${SWEEP.angleStart}deg`);

    const angleAt = (v: number): string =>
      `${(SWEEP.angleEnd - SWEEP.angleStart) * (v / 100) + SWEEP.angleStart}deg`;

    animateValue({ duration: SWEEP.fadeIn, onUpdate: v => card.style.setProperty('--edge-proximity', `${v}`) });
    animateValue({ ease: easeInCubic, duration: SWEEP.sweepOut, end: 50, onUpdate: v => {
      card.style.setProperty('--cursor-angle', angleAt(v));
    }});
    animateValue({ ease: easeOutCubic, delay: SWEEP.sweepOut, duration: SWEEP.sweepBack, start: 50, end: 100, onUpdate: v => {
      card.style.setProperty('--cursor-angle', angleAt(v));
    }});
    animateValue({ ease: easeInCubic, delay: SWEEP.fadeOutDelay, duration: SWEEP.fadeOut, start: 100, end: 0,
      onUpdate: v => card.style.setProperty('--edge-proximity', `${v}`),
      onEnd: () => card.classList.remove('sweep-active'),
    });
  }, [animated]);

  const glowVars = buildGlowVars(glowColor, glowIntensity);
  const lightSurface = isLightColor(backgroundColor);

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={`border-glow-card${lightSurface ? ' border-glow-card--light' : ''} ${className}`}
      style={{
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        ...glowVars,
        ...buildGradientVars(colors),
      } as CSSProperties}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">
        {children}
      </div>
    </div>
  );
}
