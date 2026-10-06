import type { ReactNode } from 'react';
import './BentoGrid.css';

/**
 * magicui `BentoGrid` / `BentoCard`（源码：https://magicui.design/r/bento-grid.json）。
 *
 * **为什么拷进来**：[C29](../../../docs/design/decisions/C29-settings-dialog.md) 定稿要求设置弹窗
 * 改用这个组件（用户指定「直接用」，不是「参考思路」）。原件是 Tailwind + shadcn `Button` +
 * `@radix-ui/react-icons`，本项目三者都没有，因此按 `web/AGENTS.md` §技术栈约束第 5 条
 * 做「源码拷贝 + 四处改造」，用项目 CSS 重写它的结构与交互。
 *
 * **相对原件的逐条改动**：
 * 1. **配色令牌化**：原件的 `rgba(0,0,0,.03/.05)` 与 `neutral-*` 全部换成 `--bgm-*` 与
 *    `color-mix()` 就地派生（阴影色由深粉棕 `--bgm-primary-text` 派生，不引入中性灰）；
 * 2. **Tailwind 类名换成一份 CSS**：`BentoGrid.css` 随组件走（`Xxx.tsx` 顶部 import），
 *    不并进 `styles/`；
 * 3. **行高改写**：原件的 `auto-rows-[22rem]`（352px）是营销页尺寸，弹窗里放不下两行，
 *    这里取 118px——**这是与原件唯一的尺寸偏差**，值来自样张 `demo.css:3542`；
 * 4. **动画只动 `transform` / `opacity`**；无常驻循环（原件也没有）；`prefers-reduced-motion`
 *    下全部静止。
 *
 * **相对原件的一处必要修正**：小卡（1 行）hover 时**内容不动**，只浮出右下角箭头。
 * 原件用 352px 的行高，内容上移 22px 没有问题；118px 的小卡已被图标 + 标题 + 描述占满，
 * 再上移就会顶出卡片、被 `overflow: hidden` 裁掉。大卡（跨 2 行）仍照原件上移 + CTA 浮出。
 *
 * 可访问性：整卡是一个 `<button>`（原件是 `div` + `onClick`），因此键盘可达；
 * 内部用 `<span>` 而不是 `<h3>` / `<p>`——`button` 内不允许放标题与段落。
 */

/** 四格容器（原件的 `grid grid-cols-3 gap-4`）。 */
export function BentoGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="bentoGrid">{children}</div>;
}

export interface BentoCardProps {
  /** 24×24 的线性图标（`stroke-width: 1.5`），尺寸由 `.bentoIcon` 约束。 */
  icon: ReactNode;
  name: string;
  description: string;
  /** 悬停时才浮出的动作文案（如「配置 →」）。 */
  cta: string;
  /** 跨两行的高卡（原件的 `md:row-span-2`）。 */
  tall?: boolean;
  /** 内容贴底——高卡的效果图是大卡内容在下。 */
  bottom?: boolean;
  /** 未就绪（如「模型选择」在还没配置凭据时）：置灰且不可点。 */
  disabled?: boolean;
  onSelect(): void;
}

export function BentoCard({
  icon,
  name,
  description,
  cta,
  tall = false,
  bottom = false,
  disabled = false,
  onSelect,
}: BentoCardProps): ReactNode {
  const className = [
    'bentoCard',
    ...(tall ? ['bentoCardTall'] : []),
    ...(bottom ? ['bentoCardBottom'] : []),
  ].join(' ');
  return (
    <button type="button" className={className} onClick={onSelect} disabled={disabled} title={description}>
      <span className="bentoBody">
        <span className="bentoIcon" aria-hidden="true">{icon}</span>
        <span className="bentoName">{name}</span>
        <span className="bentoDesc">{description}</span>
      </span>
      {/* CTA 只是同一动作的第二处表态，读屏会重复；动作语义已由按钮本身承担。 */}
      <span className="bentoCta" aria-hidden="true">{cta}</span>
      <span className="bentoVeil" aria-hidden="true" />
    </button>
  );
}
