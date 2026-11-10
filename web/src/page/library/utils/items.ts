import type { ContentBlockView } from '../../../components/content';
import type { ContentKind } from '../../../types/content';
import type { LibrarySection } from '../types/sections';

/**
 * 示例载荷 → 块 / JSON 的转换。
 *
 * 页面上的 UI 预览与「复制载荷」都由**同一份载荷**现场生成，所以「预览所见 = 粘进卡片
 * 实验室所得」，不存在手抄的第二份数据。
 */

/**
 * 把示例载荷包成一个内容块。
 *
 * 形状与宿主 `message-blocks.ts` 的投影完全一致：`{ type, props }`——定制组件的参数一律
 * 写在 `props` 里。所以文档页看到的形状就是会话里渲染的形状。
 */
export function blockOf(kind: ContentKind, payload: unknown): ContentBlockView {
  return { type: kind, props: payload } as ContentBlockView;
}

/**
 * 一份可直接粘进卡片实验室「原始 JSON」的载荷。
 *
 * 只给 `props` 本体（实验室直接编辑的是它），不包 `{ type, props }` 信封——信封由实验室
 * 按当前选中的 kind 补上。
 */
export function payloadText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/** 主载荷对应的 JSON 文本；形态变体也走同一个函数，所以变体卡上的「复制」不是手抄数据。 */
export function payloadTextOf(section: LibrarySection): string {
  return payloadText(section.payload);
}
