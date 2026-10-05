import { memo, type ReactNode } from 'react';
import type { MessageBlock } from '../../../../bangumi/src/web/protocol';
import { AnimatedContent } from '../motion/vendor/AnimatedContent';
import { ContentBlock } from './index';
import { Markdown } from './markdown';

/**
 * 助手消息正文的**唯一渲染入口**。
 *
 * 流式区（`Streaming`）与历史条目（`Turn`）都走这里，因此「文本 + 内容块」的顺序与形态在
 * 两个阶段天然一致——否则文本写完那一瞬会跳变。这条是 `web/AGENTS.md` §跨层强制约束第 5 条。
 *
 * 分工：块序列由本组件排布，外层容器与流式光标由调用方提供（流式区在末尾单独挂一行光标，
 * 与 Markdown 的块级结构无关）。
 *
 * `memo` 与其比较函数解决的是**流式期的重渲染放大**：`partial` 每帧重新解析，块数组每帧都是
 * 新引用；若不做块级比较，文本每多一个字都会让所有内容块重新校验、重新渲染。比较规则：
 * - 引用相同 → 不变（宿主侧的投影做了结构共享，非 `pending` 的块引用稳定）；
 * - 任一侧是文本块 → 变了就重渲染（文本本来就该跟着变）；
 * - 两侧都是**还在 `pending`** 的内容块 → 相等。骨架的渲染只由"是不是 pending"决定，
 *   与载荷无关，所以载荷每帧变化也该跳过。
 */
interface BlockSlotProps {
  block: MessageBlock;
  /** 挂滚动入场动画（只在历史条目里；流式期元素每帧可能变，挂着会让入场反复触发）。 */
  animate: boolean;
}

function sameSlot(prev: BlockSlotProps, next: BlockSlotProps): boolean {
  const before = prev.block;
  const after = next.block;
  if (before === after) return prev.animate === next.animate;
  if (before.type === 'text' || after.type === 'text') return false;
  return before.type === after.type
    && before.pending === true
    && after.pending === true
    && prev.animate === next.animate;
}

const BlockSlot = memo(function BlockSlot({ block, animate }: BlockSlotProps): ReactNode {
  if (block.type === 'text') return <Markdown text={block.text} />;
  const rendered = <ContentBlock block={block} />;
  if (!animate) return rendered;
  return (
    <AnimatedContent
      // scroller 必须指向真正的滚动容器（理由见 `Turn.tsx` 的同名注释）。
      container="#app-stage-scroll"
      distance={16}
      duration={0.35}
      ease="power2.out"
      threshold={0.05}
    >
      {rendered}
    </AnimatedContent>
  );
}, sameSlot);

export interface MessageBlocksProps {
  blocks: MessageBlock[];
  /** 流式期：内容块不挂滚动入场动画。 */
  streaming?: boolean;
}

/**
 * 块索引即 key：块只追加或原地替换（同一个 `contentIndex` 的快照覆盖同一项），索引稳定，
 * 比用载荷内容做 key 更可靠——载荷在 `pending` 期每帧都在变。
 */
export const MessageBlocks = memo(function MessageBlocks({ blocks, streaming = false }: MessageBlocksProps): ReactNode {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockSlot key={index} block={block} animate={!streaming} />
      ))}
    </>
  );
});
