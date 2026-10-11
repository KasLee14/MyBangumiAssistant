import type { ReactNode } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { routes } from './routes';

/**
 * 前端路由的唯一装配点（`main.tsx` 只 `import { AppRouter } from './router'`）。
 *
 * 用 History 模式（`createBrowserRouter`）而不是 hash：地址是 `/debug`、`/library/components/DataTable`。
 * 代价在宿主侧——`bangumi/src/web/server.ts` 必须为无扩展名的未知路径回落 `index.html`（SPA 兜底），
 * 否则深链与刷新都是 404。见 `web/README.md` §路由。
 *
 * `router` 实例建在**模块作用域**：放进组件或 `useMemo` 会在每次重渲染时重建，
 * 丢掉内存里的导航状态；StrictMode 的双调用更会造出两个实例。
 */
const router = createBrowserRouter(routes);

export function AppRouter(): ReactNode {
  return <RouterProvider router={router} />;
}
