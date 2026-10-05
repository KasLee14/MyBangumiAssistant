/**
 * 来源：React Bits「Glare Hover」的 CSS 变体 TS 源码
 *       （registry 端点 https://reactbits.dev/r/GlareHover-TS-CSS 的 files[].content，
 *       官方文档页 https://www.reactbits.dev/animations/glare-hover）。
 * 本地改动（相对官方源码逐条）：
 *   1. background 默认值 '#000' -> 'transparent'：底色交给使用方的容器决定，组件不自带深色底。
 *   2. glareColor 默认值 '#ffffff' -> 'color-mix(in srgb, var(--bgm-surface) 70%, transparent)'；
 *      borderColor 默认值 '#333' -> var(--app-hairline)；CSS 里 4 处 hsla(0, 0%, 0%, 0) 透明停点 -> transparent 关键字。
 *   3. 颜色解析分两路：hex 仍走官方那条「hex -> rgba(r, g, b, glareOpacity)」，行为不变；
 *      非 hex（令牌 var(...) / 具名色）改为 color-mix(in srgb, <颜色> <glareOpacity * 100>%, transparent) 就地派生；
 *      已经自带透明度的 color-mix(...) 值原样透传（默认值走这一路，glareOpacity 不再叠乘——它本身已是 70% 的 veiling）。
 *   4. 配色/动效令牌化：过渡曲线 ease -> var(--app-ease-out)；CSS 里的变量补上与默认 props 一致的回退值
 *      （--gh-bg 回退 transparent、--gh-border 回退 var(--app-hairline)、--gh-rgba 回退默认光斑色）。
 *   5. 类名加组件前缀：.glare-hover -> .glareHover、.glare-hover--play-once -> .glareHover--playOnce。
 *   6. 常驻循环：官方本就是「hover 时把 background-position 从 -100% -100% 移到 100% 100%」的非循环效果，
 *      保持不循环；补 prefers-reduced-motion: reduce -> ::before 的 transition: none（hover 直接落到终点，无扫光过程）。
 *   7. 形态对齐本项目 vendor：去掉 'use client'；React.FC 改为普通函数组件 + 命名导出（另给 default 导出）；
 *      React 按需 type 导入（verbatimModuleSyntax）；变量对象与 style 合并时只做一次 CSSProperties 断言。
 * 为什么改：
 *   - 硬编码 #000 / #ffffff / #333 在浅色令牌体系下要么突兀、要么看不见；光斑改由 --bgm-surface 派生后，
 *     表现成「比卡片更亮一档的掠光」，而不是白块。
 *   - 只动 background-position（合成器属性），不碰 width / height / top / left / display，
 *     不与会话区 content-visibility: auto 的屏外优化抢帧。
 *   - 减少动效时不做扫光过渡，避免纯装饰效果在用户已声明「减少动效」时仍然运动。
 */

import { type CSSProperties, type ReactNode } from 'react';
import './GlareHover.css';

export interface GlareHoverProps {
  width?: string;
  height?: string;
  /** 容器底色，默认 transparent（由使用方的容器决定） */
  background?: string;
  borderRadius?: string;
  borderColor?: string;
  children?: ReactNode;
  /** 光斑颜色；hex 走官方 rgba 换算，令牌 / color-mix 走 color-mix 派生 */
  glareColor?: string;
  /** 仅作用于 hex 与纯色输入的透明度（0–1）；自带透明度的 color-mix 值不使用它 */
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
  playOnce?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** hex -> rgba(r, g, b, glareOpacity)（官方行为）；其余颜色交给 color-mix 就地派生透明度。 */
function resolveGlareColor(glareColor: string, glareOpacity: number): string {
  const value = glareColor.trim();

  if (/^#[\da-f]{3}([\da-f]{3})?$/i.test(value)) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${glareOpacity})`;
  }

  // 已自带透明度的写法（默认值即是），再叠一层只会越叠越淡
  if (value.includes('color-mix(')) return value;

  return `color-mix(in srgb, ${value} ${Math.round(glareOpacity * 100)}%, transparent)`;
}

export function GlareHover({
  width = '500px',
  height = '500px',
  background = 'transparent',
  borderRadius = '10px',
  borderColor = 'var(--app-hairline)',
  children,
  glareColor = 'color-mix(in srgb, var(--bgm-surface) 70%, transparent)',
  glareOpacity = 0.5,
  glareAngle = -45,
  glareSize = 250,
  transitionDuration = 650,
  playOnce = false,
  className = '',
  style
}: GlareHoverProps) {
  const vars = {
    '--gh-width': width,
    '--gh-height': height,
    '--gh-bg': background,
    '--gh-br': borderRadius,
    '--gh-angle': `${glareAngle}deg`,
    '--gh-duration': `${transitionDuration}ms`,
    '--gh-size': `${glareSize}%`,
    '--gh-rgba': resolveGlareColor(glareColor, glareOpacity),
    '--gh-border': borderColor
  } as CSSProperties;

  const classNames = ['glareHover', playOnce ? 'glareHover--playOnce' : '', className].filter(Boolean).join(' ');

  return (
    <div className={classNames} style={{ ...vars, ...style }}>
      {children}
    </div>
  );
}

export default GlareHover;
