/**
 * 内容组件库文档页（`library.html` 的挂载点）。
 *
 * 页面被拆成几个文件，各自一件事：
 * - `App.tsx`      骨架：顶部工具条、左侧分组导航、内容区、右侧页内目录
 * - `router.ts`    极简 hash 路由（一组件一页 + 总览页）
 * - `search.ts`    顶部搜索的过滤口径
 * - `Overview.tsx` 总览页（12 张卡）
 * - `ComponentPage.tsx` 详情页（严格四块：UI 预览 / 参数 / event / frame）
 * - `items.ts`     载荷 → 条目 / event / frame 文本
 * - `samples.ts`   12 个 kind 的示例数据与参数表（数据源，改协议要同步改它）
 * - `theme.ts`     antd 主题（配色映射到 `--bgm-*` 的当前色值）
 *
 * 这一页**不连宿主**：只渲染静态示例，不发任何请求。
 */
export { LibraryPage } from './App';
