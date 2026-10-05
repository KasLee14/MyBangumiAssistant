/**
 * 来源：React Bits「Shiny Text」的 CSS 变体 TS 源码（registry 端点 https://reactbits.dev/r/ShinyText-TS-CSS 的 files[].content），
 *       官方文档页 https://www.reactbits.dev/text-animations/shiny-text 。
 * 本地改动（相对官方源码逐条）：
 *   1. 动画载体由 motion 的 useAnimationFrame + useMotionValue 逐帧写 background-position，换成纯 CSS keyframes 动画
 *      （官方 CSS 变体本来就有 .shiny-text / @keyframes shine，改为 CSS 是回归它自己的形态）；相应去掉 useMotionValue /
 *      useAnimationFrame / useTransform / useEffect / useCallback / useRef 与 motion.span，组件退化为一个 <span>。
 *   2. 常驻循环改为「默认只扫一次」：animation-iteration-count 默认 1，新增 shimmer?: boolean（默认 false），
 *      只有 shimmer 为 true 时才 infinite；同时补 @media (prefers-reduced-motion: reduce) 静止。
 *   3. 公版 2 秒/次（speed = 2）改为 CSS 变量 --shinyText-duration 由 speed 秒数驱动（speed = 2 -> 2s，语义一致但可读）。
 *   4. delay 语义对齐 CSS：公版把 delay 计入扫描周期（作为末尾停顿），本地改为 animation-delay 起延迟 + fill-mode: both
 *      在延迟期间停在起点（底色可见），扫描本身仍只跑一遍。
 *   5. 配色令牌化：公版 color = '#b5b5b5' / shineColor = '#ffffff'（CSS 里是 #b5b5b5a4 与 rgba(255,255,255,.8)），
 *      改为默认 color = 'var(--bgm-text-muted)'、shineColor = 'var(--bgm-primary)'。
 *      高光为什么不用白色：浅色主题的底色就是白面，「更亮」等于更看不见；改主色后扫过时才有对比。
 *      另外渐变两端必须用**底字色**而不是 transparent——文字靠 background-clip 着色，
 *      两端透明等于「没扫到的地方就是透明」，扫完停在终点后整段标题会消失。
 *   6. 类名加组件前缀：.shiny-text -> .shinyText（本项目 vendor 约定，避免与既有 .app* / .content* 冲突）。
 *   7. 补 HTML 属性透传（HTMLAttributes<HTMLSpanElement>）与 style 透传合并，便于在页面里定位/微调；去掉 'use client'。
 * 为什么改：
 *   - 项目原则「不做无意义的常驻循环」，无限扫光是典型例子；只有表达「进行中 / 可交互」时才允许循环，所以默认一次、
 *     循环交给调用方按需用 shimmer 打开，并尊重 prefers-reduced-motion。
 *   - 逐帧 JS 动画（useAnimationFrame 每帧 set 一个 MotionValue）要持续占用主线程并与会话流的 content-visibility: auto
 *     抢帧；CSS 动画跑在合成器侧，只动 background-position，不触发布局，成本更低。
 *   - 配色必须走令牌（--bgm-*）才能同时适配浅色令牌体系与外观看层，硬编码 #b5b5b5 / #ffffff 不随主题变化。
 */

import { type CSSProperties, type HTMLAttributes } from 'react';
import './ShinyText.css';

export interface ShinyTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** 要高光扫过的文本 */
  text: string;
  /** 停用动画，直接显示底字（官方同名 prop） */
  disabled?: boolean;
  /** 单次扫描时长，单位秒（官方 speed = 2 表示 2 秒） */
  speed?: number;
  /** 扫描开始前的延迟，单位秒 */
  delay?: number;
  /** 为 true 时无限循环扫描；默认 false（只扫一次） */
  shimmer?: boolean;
  /** 渐变角度，单位度（官方 spread） */
  spread?: number;
  /** 底字颜色，默认取令牌；如需硬编码色值请自行承担主题适配 */
  color?: string;
  /** 高光颜色，默认取令牌 */
  shineColor?: string;
}

export function ShinyText({
  text,
  disabled = false,
  speed = 2,
  delay = 0,
  shimmer = false,
  spread = 120,
  color = 'var(--bgm-text-muted)',
  shineColor = 'var(--bgm-primary)',
  className = '',
  style,
  ...rest
}: ShinyTextProps) {
  const classNames = ['shinyText', disabled ? 'shinyText--disabled' : '', shimmer ? 'shinyText--shimmer' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classNames}
      style={
        {
          // 时长 / 延迟 / 角度 / 两档颜色都走 CSS 变量，keyframes 与渐变在 ShinyText.css 里
          '--shinyText-duration': `${speed}s`,
          '--shinyText-delay': `${delay}s`,
          '--shinyText-spread': `${spread}deg`,
          '--shinyText-color': color,
          '--shinyText-shine': shineColor,
          ...style
        } as CSSProperties
      }
      {...rest}
    >
      {text}
    </span>
  );
}

export default ShinyText;
