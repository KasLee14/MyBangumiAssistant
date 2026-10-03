import { memo, type ReactNode } from 'react';
import { ContentFallback } from './ContentFallback';
import { contentRenderer, type ContentItemView } from './registry';
import { validateTranscriptItem } from './validate';

/**
 * 内容条目联合类型。
 *
 * 从 `registry` 转出，调用点的 import 路径不需要变（`TurnView` 从这里取）。
 */
export type { ContentItemView } from './registry';

/**
 * 内容条目分发器。
 *
 * 分发本身由注册表完成（`registry.ts` 的 `kind → 渲染器`），这里只做三件事：
 * 接收侧校验、未知 kind 丢弃、非法载荷降级。
 *
 * 为什么在渲染前再校验一次：宿主映射、历史回放、调试面板粘贴的数据都可能与当前
 * 协议有出入，接收侧这道检查是唯一能兜住版本漂移的地方。`memo` 保证它只在条目
 * 引用变化时执行，流式帧（只改标量）不会带来额外的校验开销。
 *
 * 失败不回退成「什么都不显示」——那会让宿主以为渲染成功——而是换成可读提示加
 * 折叠的原始数据；只有 `kind` 未知才整条丢弃（未知类型没有可依据的载荷语义）。
 */
export const ContentItem = memo(function ContentItem({ item }: { item: ContentItemView }): ReactNode {
  const outcome = validateTranscriptItem(item);
  if (outcome.status === 'dropped') {
    // 开发期告警：宿主下发了本组件库未覆盖的 kind。丢弃是刻意的（未知类型没有可
    // 依据的载荷语义），但静默丢弃会让宿主的映射错误一直没人发现。
    console.warn(`[content] 未登记的内容 kind「${outcome.kind}」，该条目已丢弃。`);
    return null;
  }
  if (outcome.status === 'degraded') {
    return <ContentFallback kind={outcome.kind} issues={outcome.issues} raw={item} />;
  }
  const render = contentRenderer(item.kind);
  return render === undefined ? null : render(item);
});
