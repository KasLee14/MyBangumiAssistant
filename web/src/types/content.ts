/**
 * 内容块的 kind 清单（12 个定制组件的 `type`）。
 *
 * 取值就是**组件名**（与 `components/content/` 的文件名一致），因此不需要「语义名 → 组件」
 * 的对照表。注册表 `components/content/registry.tsx` 用
 * `satisfies { [K in ContentKind]: ContentRenderer<K> }` 要求 12 个键逐键齐全，文件末尾的
 * `ContentRegistryCoverage` 断言再保证协议里不存在未登记的块 type——**这两处联动留在注册表里**，
 * 因为它们是「清单 ↔ 渲染函数」的同一张表。
 *
 * 类型本身放这里（而不是注册表）：它同时被注册表、接收侧校验（`content/validate.ts`）、
 * 文档页数据与调试页消费，是跨模块共享的叶子定义。留在注册表会让纯数据层反向依赖组件实现。
 */
export type ContentKind =
  | 'SubjectCards' | 'StatsCard' | 'ProgressView' | 'InfoBox' | 'DataTable' | 'Timeline'
  | 'TagCloud' | 'Gallery' | 'CompareTable' | 'QuoteBlock' | 'Callout' | 'LinkList';
