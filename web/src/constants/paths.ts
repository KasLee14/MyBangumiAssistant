/**
 * 路径常量：**全应用路径字面量的唯一来源**。
 *
 * 为什么单独一个文件、且**不 import 任何东西**：路由表（`router/routes.tsx`）要 import 页面，
 * 页面 import 组件，而组件里需要知道「调试页在哪」（侧栏品牌行双击进调试页）。只要这些常量从
 * `routes.tsx` 或 `router/index.tsx` 导出，依赖环就成立了：`router → page → components → router`。
 * 这个文件是**叶子模块**——只导出字符串，谁都可以 import，永远不成环。
 *
 * 放在 `constants/` 而不是 `router/`：它被 router / page / components 三层消费（改造前那 4 处
 * 「页面与组件反向引用 router/paths」就是这条性质的证据），属于全局契约而非路由模块的内部实现。
 * 路径**拼接函数**在 `utils/paths.ts`。
 */

/**
 * 页面级路径。
 *
 * 只有「哪个页面」进 URL：会话、弹窗、过程区开合仍在 store 里（见 `web/README.md` §路由），
 * 所以这里没有 `:sessionId` 一类的动态段——唯一的动态段是文档页要展示的组件 kind。
 */
export const PATH = {
  home: '/',
  debug: '/debug',
  library: '/library',
} as const;

/** 文档页详情路径的**路由模式**（给 `useMatch` 用，带 `:kind` 占位）。 */
export const LIBRARY_COMPONENT_PATTERN = `${PATH.library}/components/:kind`;
