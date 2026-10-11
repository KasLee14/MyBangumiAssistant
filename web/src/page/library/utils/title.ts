import type { ContentKind } from '../../../types/content';
import { LIBRARY_SECTIONS } from '../constants/sections';

/**
 * 一个 kind 在导航里的显示名。
 *
 * 取 `LIBRARY_SECTIONS` 的 `title` 而不是另建一张「kind → 中文名」对照表：中文名属于该条目的
 * 契约，只有一份（详情页标题、总览卡片都读它），多一份表就会在多语言或改文案时对不上。
 * 查不到时回落成 kind 本身——这样「新增了 kind 但忘了写 section」在界面上是可读的，
 * 而不是留下一行空白。
 */
export function titleOf(kind: ContentKind): string {
  return LIBRARY_SECTIONS.find(section => section.kind === kind)?.title ?? kind;
}
