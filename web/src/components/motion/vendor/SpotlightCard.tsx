/**
 * 来源：React Bits「Spotlight Card」的 CSS 变体 TS 源码
 *       （registry 端点 https://reactbits.dev/r/SpotlightCard-TS-CSS 的 files[].content，
 *       官方文档页 https://www.reactbits.dev/components/spotlight-card）。
 * 本地改动（相对官方源码逐条）：
 *   1. 配色令牌化：props 默认 spotlightColor 由 'rgba(255, 255, 255, 0.25)' 改为 var(--app-primary-veil)；
 *      CSS 里卡片底色 #111 -> var(--app-surface)、描边 #222 -> var(--app-hairline)、--spotlight-color 的回退值
 *      rgba(255, 255, 255, 0.05) -> var(--app-accent-veil)；圆角 1.5rem -> var(--app-radius-panel)。
 *      透明度一律用 color-mix(in srgb, var(--令牌) N%, transparent) 就地派生（令牌定义见 styles/tokens.css 的 --app-*-veil）。
 *   2. props 类型：spotlightColor 由模板字面量类型 `rgba(${number}, ${number}, ${number}, ${number})` 放宽为 string
 *      —— 令牌 var(...) / color-mix(...) 都不是 rgba 字面量，原类型会直接编译失败；显式传 rgba / hex 的能力保留。
 *   3. 常驻循环：官方本就是「指针驱动的非循环光斑」，保持不循环；补 prefers-reduced-motion: reduce 支持——
 *      CSS 去掉 opacity 过渡（静止），JS 侧用 matchMedia 检测到减少动效时不再写 --mouse-x / --mouse-y，
 *      光斑停在中心、不跟随指针（hover / focus-within 的可见性提示保留）。
 *   4. 动效令牌化：transition: opacity 0.5s ease -> opacity var(--app-dur-slower) var(--app-ease-out)。
 *   5. 类名加组件前缀：.card-spotlight -> .spotlightCard（本项目 vendor 约定，避免与既有 .app* / .content* 冲突）。
 *   6. 形态对齐本项目 vendor：去掉 'use client'；React.FC 改为普通函数组件 + 命名导出（另给 default 导出）；
 *      React 按需 type 导入（verbatimModuleSyntax）；补 HTMLAttributes<HTMLDivElement> 透传（onMouseMove 合并、style 合并）。
 * 为什么改：
 *   - 硬编码色值（#111 / #222 / rgba(255,255,255,…)）不随外观层变化，白色光斑落在浅色底上又会糊成一片；
 *     改为令牌派生后，同一份源码在 --bgm-* 浅色令牌下自动得到合适对比度。
 *   - 项目原则「不做无意义的常驻循环 + 尊重 prefers-reduced-motion」：指针光斑本身不是循环，
 *     但用户声明减少动效时不应再有淡入过渡与跟随位移。
 *   - 只动 opacity（不碰 width / height / top / left），与会话区 content-visibility: auto 的屏外优化不冲突。
 */

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type MouseEvent } from 'react';
import './SpotlightCard.css';

export interface SpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
  /** 光斑颜色，默认取令牌；显式传 rgba(...) / hex 也可，但不随主题变化 */
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'var(--app-primary-veil)',
  onMouseMove,
  style,
  ...rest
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // 跟随指针是纯装饰，用户声明减少动效时连跟随一起停掉
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onMouseMove?.(event);

      const card = cardRef.current;
      if (reducedMotion || !card) return;

      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // 只写自定义属性，光斑位置由 ::before 的 radial-gradient 消费，不触发任何布局
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
      card.style.setProperty('--spotlight-color', spotlightColor);
    },
    [onMouseMove, reducedMotion, spotlightColor]
  );

  const classNames = ['spotlightCard', className].filter(Boolean).join(' ');

  return (
    <div
      {...rest}
      ref={cardRef}
      onMouseMove={handleMouseMove}
      className={classNames}
      style={style}
    >
      {children}
    </div>
  );
}

export default SpotlightCard;
