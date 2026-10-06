/**
 * 调试页的开关（URL hash）。
 *
 * 放在工具层而不是页面层：组件层需要触发「进入 / 退出调试页」，
 * 而组件层不允许依赖页面层。这里只有两个纯函数与一个判定，没有状态。
 *
 * 调用方是**品牌元素**：主界面在**侧栏品牌行**（`components/mainPage/shell/Sidebar.tsx` 的
 * `.appBrandAction.appSidebarBrand`）传 `enterDebug`——主界面已按 C01 删除顶栏；
 * 调试页 `page/debug/index.tsx` 仍在 `AppTopBar` 的品牌槽传 `exitDebug`（两处都是双击或回车 / 空格触发）。
 *
 * 用 hash 而不是 store 字段：刷新后保持、可直接把链接发给别人复现，
 * 且不需要给 `ui` 切片加一个只在开发时用到的字段。
 */

export function isDebugHash(): boolean {
  return window.location.hash === '#debug';
}

export function enterDebug(): void {
  if (window.location.hash !== '#debug') window.location.hash = '#debug';
}

export function exitDebug(): void {
  if (window.location.hash === '#debug') window.location.hash = '';
}
