import { memo, type ReactNode } from 'react';
import { warnUnknownBlockType } from '../../../../bangumi/src/web/message-blocks';
import { ContentFallback } from './ContentFallback';
import { ContentSkeleton } from './ContentSkeleton';
import { contentRenderer, type ContentBlockView } from './registry';
import { validateMessageBlock } from './validate';

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
 * 分发本身由注册表完成（`registry.tsx` 的 `type → 渲染器`），这里只做四件事：
 * `pending` 走骨架、接收侧校验、未知 type 丢弃 + 告警、非法载荷降级。
 *
 * 为什么在渲染前再校验一次：宿主映射、历史回放、调试面板粘贴的数据都可能与当前协议有出入，
 * 接收侧这道检查是唯一能兜住版本漂移的地方。`memo` 保证它只在块引用变化时执行——流式帧里
 * 文本增长不会带来额外的校验开销（配合 `MessageBlocks` 的块级比较与宿主侧的结构共享）。
 *
 * 失败不回退成「什么都不显示」——那会让上游以为渲染成功——而是换成可读提示加折叠的原始数据；
 * 只有 `type` 未登记才整块丢弃（未知类型没有可依据的载荷语义）。
 */
export const ContentBlock = memo(function ContentBlock({ block }: { block: ContentBlockView }): ReactNode {
  // `pending`：载荷还在传，此时**不校验**——载荷本来就不全，校验必然报 degraded，
  // 那会把"还没到"显示成"数据有问题"。骨架与降级卡的边界就划在这里。
  if (block.pending === true) return <ContentSkeleton />;
  const outcome = validateMessageBlock(block);
  if (outcome.status === 'dropped') {
    // 开发期告警：上游下发了本组件库未覆盖的块。丢弃是刻意的（未知类型没有可依据的
    // 载荷语义），但静默丢弃会让上游的映射错误一直没人发现。
    warnUnknownBlockType(outcome.kind);
    return null;
  }
  if (outcome.status === 'degraded') {
    return <ContentFallback kind={outcome.kind} issues={outcome.issues} raw={block} />;
  }
  const render = contentRenderer(block.type);
  return render === undefined ? null : render(block);
});
