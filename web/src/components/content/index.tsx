import { memo, type ReactNode } from 'react';
import { warnUnknownBlockType } from '../../../../bangumi/src/web/message-blocks';
import { ContentErrorBoundary } from './ContentErrorBoundary';
import { ContentSkeleton } from './ContentSkeleton';
import { contentRenderer, type ContentBlockView } from './registry';

/**
 * 内容块联合类型。
 *
 * 与协议导出的 `ContentBlockView` 同义，从 `registry` 转出，调用点的 import 路径不需要变
 * （`Turn` / `MessageBlocks` 从这里取）。
 */
export type { ContentBlockView } from './registry';

/**
 * 内容块分发器。
 *
 * 只做**信封**层面的三件事，与载荷语义无关：
 * 1. `pending` → 骨架（载荷还在传，此时不判定——载荷本来就不全）；
 * 2. `type` 未登记 → 整块丢弃 + 开发期告警（未知类型没有可依据的载荷语义）；
 * 3. 其余交给组件，外面套一层 `ContentErrorBoundary`。
 *
 * **载荷判定与降级不在这一层**：每个组件自己带 `readXxx`，自己决定「丢哪一项、回落到
 * 什么、还是整块不可渲染」。改造前这里是「校验 → 骨架 / 降级卡 / 渲染」三分支，代价是
 * 一份 643 行的中央规则表和一张通用的降级卡——任何一条脏数据都会把整块换成 JSON 转储，
 * 而 12 种载荷真正需要的是各自不同的降级方式。
 *
 * `memo` 保证它只在块引用变化时重算：流式期宿主侧对未变的块做了结构共享，文本增长不会
 * 带来额外的判定开销。
 */
export const ContentBlock = memo(function ContentBlock({ block }: { block: ContentBlockView }): ReactNode {
  const render = contentRenderer(block.type);
  if (render === undefined) {
    // 丢弃是刻意的（未知类型没有可依据的载荷语义），但静默丢弃会让上游的映射错误
    // 一直没人发现，所以保留一条开发期告警。
    warnUnknownBlockType(block.type);
    return null;
  }

  return (
    <ContentErrorBoundary kind={block.type} data={block.props}>
      {block.pending === true ? <ContentSkeleton /> : render(block)}
    </ContentErrorBoundary>
  );
});
