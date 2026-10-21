import { memo, type ReactNode } from 'react';
import type { MessageBlock } from '../../../../bangumi/src/web/protocol';
import { DURATION, SHIFT } from '../motion/motionTokens';
import { AnimatedContent } from '../motion/vendor/AnimatedContent';
import { ContentBlock } from './index';
import { Markdown } from './markdown';
import { validateMessageBlock, type ItemValidation } from './validate';

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
  /** 已完成块的校验结果（`pending` 块跳过校验，因此没有）。 */
  validation?: ItemValidation | undefined;
  /** 挂滚动入场动画（只在历史条目里；流式期元素每帧可能变，挂着会让入场反复触发）。 */
  animate: boolean;
}

function sameSlot(prev: BlockSlotProps, next: BlockSlotProps): boolean {
  const before = prev.block;
  const after = next.block;
  if (before === after) return prev.animate === next.animate && prev.validation === next.validation;
  if (before.type === 'text' || after.type === 'text') return false;
  return before.type === after.type
    && before.pending === true
    && after.pending === true
    && prev.animate === next.animate;
}

const BlockSlot = memo(function BlockSlot({ block, validation, animate }: BlockSlotProps): ReactNode {
  if (block.type === 'text') return <Markdown text={block.text} />;
  const rendered = <ContentBlock block={block} validation={validation} />;
  if (!animate) return rendered;
  return (
    <AnimatedContent
      // scroller 必须指向真正的滚动容器（理由见 `Turn.tsx` 的同名注释）。
      container="#app-stage-scroll"
      // [C19](../../docs/design/decisions/C19-message-blocks.md) 定稿：18px / 460ms
      //（样张 `demo.css:3832-3839` 的 `blkInG10`）。原先硬编码 16px / 0.35s，
      // 既与定稿不符，也把参数散在组件里——现在统一从 `motionTokens` 取。
      distance={SHIFT.reveal}
      duration={DURATION.reveal}
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
  /**
   * 是否挂内容块入场动画（默认挂）。
   *
   * 关掉它只有一个场景：**工具结果的展开体**。它在展开那一刻才挂载，此时元素已在视口内
   * （用户刚点开），而 `AnimatedContent` 是滚动触发的：元素已经在视口里时它仍要等一次滚动
   * 事件，于是出现「点了展开却看不到内容」。展开是用户的显式动作，不需要入场动画提示。
   */
  animate?: boolean;
}

/**
 * 已完成块的校验结果缓存，按**块对象引用**索引。
 *
 * 放在模块级而不是组件内 `useRef`：同一个块可能先由流式区渲染、再交给历史条目
 * （组件实例会换），模块级缓存让「同一块只校验一次」跨实例也成立。WeakMap 不持有
 * 载荷，块被回收后条目自动释放。`pending` 块不写入缓存（按约定跳过校验）。
 */
const validationCache = new WeakMap<MessageBlock, ItemValidation>();

/**
 * 块索引即 key：块只追加或原地替换（同一个 `contentIndex` 的快照覆盖同一项），索引稳定，
 * 比用载荷内容做 key 更可靠——载荷在 `pending` 期每帧都在变。
 *
 * 校验在这里**上提**：整条消息的块只在这里校验一次（按块引用缓存），结果作为可选 prop
 * 穿过 `BlockSlot` 交给 `ContentBlock`，后者不再重复校验。`pending` 块按既有约定跳过校验
 * （载荷还没到，校验必然报 degraded），继续渲染骨架。未知 `type` 的块仍在 `ContentBlock`
 * 里丢弃并告警；本条消息的丢弃块数与类型名在这里汇总成一条轻提示，不再逐块静默消失。
 */
export const MessageBlocks = memo(function MessageBlocks({
  blocks, streaming = false, animate = true,
}: MessageBlocksProps): ReactNode {
  const slots: { block: MessageBlock; validation: ItemValidation | undefined }[] = [];
  const droppedKinds: string[] = [];
  let droppedCount = 0;
  for (const block of blocks) {
    if (block.type !== 'text' && block.pending === true) {
      slots.push({ block, validation: undefined });
      continue;
    }
    let outcome = validationCache.get(block);
    if (outcome === undefined) {
      outcome = validateMessageBlock(block);
      validationCache.set(block, outcome);
    }
    if (outcome.status === 'dropped') {
      droppedCount += 1;
      // 提示里列类型名，但计数按块数（同类型两块记 2）。
      if (!droppedKinds.includes(outcome.kind)) droppedKinds.push(outcome.kind);
    }
    slots.push({ block, validation: outcome });
  }
  return (
    <>
      {slots.map((slot, index) => (
        <BlockSlot
          key={index}
          block={slot.block}
          validation={slot.validation}
          animate={animate && !streaming}
        />
      ))}
      {droppedCount > 0 ? (
        <p className="appMicroLabel contentDroppedNote" role="status">
          {`有 ${droppedCount} 块内容未能渲染${droppedKinds.length > 0 ? `（未知类型：${droppedKinds.join('、')}）` : ''}`}
        </p>
      ) : null}
    </>
  );
});
