import { PATH } from '../constants/paths';

/**
 * 路径拼装。
 *
 * 与 `constants/paths` 分开：那边是**零依赖叶子**（只放字面量与模式，谁都能引），
 * 这里是可以带逻辑的构造函数。两者都在叶子层，`router` / `page` / `components` 引用它们
 * 都不构成环（`router → page → components` 这条单向链只约束业务依赖）。
 */

/** 文档页某个 kind 的详情地址（给跳转用，带真实 kind）。 */
export function componentPath(kind: string): string {
  return `${PATH.library}/components/${encodeURIComponent(kind)}`;
}
