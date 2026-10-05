/**
 * 来源：React Bits「Star Border」的 CSS 变体 TS 源码
 *       （registry 端点 https://reactbits.dev/r/StarBorder-TS-CSS 的 files[].content，
 *       官方文档页 https://www.reactbits.dev/animations/star-border）。
 * 本地改动（相对官方源码逐条）：
 *   1. 常驻循环改为默认静止：官方两层星光上是 animation: star-movement-* linear infinite alternate，
 *      一进页面就永远在转；本地把它拆成 animation-name + 共享长写，并把 animation-play-state 默认设为 paused，
 *      只有新增的 animated?: boolean（默认 false）为 true 时容器才带 .starBorder--animated 类、把动画放到 running。
 *      speed（默认 '6s'）语义不变，仍只决定周期（animation-duration，由内联 style 写入）。
 *   2. 配色令牌化：backgroundColor 默认 '#000000' -> var(--app-surface)、color 默认 'white' -> var(--bgm-primary)、
 *      textColor 默认 '#ffffff' -> var(--bgm-text)、borderColor 默认 '#222222' -> var(--app-hairline)；
 *      CSS 里 .starBorderInner 的 border: 1px solid #222 / background: #000 / color: white 换成同一批令牌作为回退值。
 *      径向渐变仍写 radial-gradient(circle, <color>, transparent 10%)：transparent 是关键字，不是硬编码色值。
 *   3. 类名加组件前缀：.star-border-container -> .starBorder、.border-gradient-bottom / -top ->
 *      .starBorderGradientBottom / .starBorderGradientTop、.inner-content -> .starBorderInner、
 *      @keyframes star-movement-bottom / -top -> starBorderMoveBottom / starBorderMoveTop。
 *   4. 补 prefers-reduced-motion: reduce：此时不论 animated 是否为 true，两层星光一律 paused（静止在起始位）。
 *   5. props 类型：显式声明 className / children / style 并在 Omit 里去掉 ComponentPropsWithoutRef<T> 的同名键，
 *      这样 style 能被解构出来与官方那句 padding 合并（官方写的是 (rest as any).style）；color 同样 Omit 以避开 HTML color 属性；
 *      新增 animated?: boolean。
 *   6. 形态对齐本项目 vendor：去掉 'use client'；动态标签继续走 as（默认 'button'），其余属性透传到该标签；
 *      命名导出 + default 导出。
 * 为什么改：
 *   - 项目原则「不做常驻循环动画」：星光纯属装饰，不能一进页面就一直转；默认静止、由调用方用 animated 显式打开，
 *     与同层 BorderGlow 的 animated 开关同名同默认值，语义一致。
 *   - 硬编码 #000000 / #222222 / white 在浅色令牌体系下会让卡片变成黑块、描边与底色打架；改令牌后随外观层变化。
 *   - keyframes 只动 transform / opacity（官方如此，保留），不碰 width / height / top / left，不触发布局。
 */

import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type ReactNode
} from 'react';
import './StarBorder.css';

export type StarBorderProps<T extends ElementType> = Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'className' | 'children' | 'color' | 'style'
> & {
  as?: T;
  className?: string;
  children?: ReactNode;
  /** 星光颜色（径向渐变的中心色），默认取令牌 */
  color?: string;
  /** 星光的单程时长，即 animation-duration，默认 '6s' */
  speed?: CSSProperties['animationDuration'];
  /** 容器上下内边距，单位 px */
  thickness?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  /** 为 true 时星光开始循环移动；默认 false（静止，动画暂停在起始位） */
  animated?: boolean;
  style?: CSSProperties;
};

export function StarBorder<T extends ElementType = 'button'>({
  as,
  className = '',
  color = 'var(--bgm-primary)',
  speed = '6s',
  thickness = 1,
  backgroundColor = 'var(--app-surface)',
  textColor = 'var(--bgm-text)',
  borderColor = 'var(--app-hairline)',
  animated = false,
  style,
  children,
  ...rest
}: StarBorderProps<T>) {
  const Component = (as ?? 'button') as ElementType;
  const classNames = ['starBorder', animated ? 'starBorder--animated' : '', className].filter(Boolean).join(' ');
  const glow = `radial-gradient(circle, ${color}, transparent 10%)`;

  return (
    <Component className={classNames} style={{ padding: `${thickness}px 0`, ...style }} {...rest}>
      <div className="starBorderGradientBottom" style={{ background: glow, animationDuration: speed }} />
      <div className="starBorderGradientTop" style={{ background: glow, animationDuration: speed }} />
      <div className="starBorderInner" style={{ background: backgroundColor, color: textColor, borderColor }}>
        {children}
      </div>
    </Component>
  );
}

export default StarBorder;
