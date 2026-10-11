import { useEffect, type ReactNode } from 'react';
import {
  Outlet, useLocation, useNavigate, useOutletContext, useParams, type RouteObject,
} from 'react-router';
import { DebugPage } from '../page/debug';
import { MainPage } from '../page/mainPage';
import { LibraryPage } from '../page/library';
import type { LibraryOutletContext } from '../page/library/types/sections';
import { ComponentPage } from '../page/library/components/ComponentPage';
import { Overview } from '../page/library/components/Overview';
import { LIBRARY_SECTIONS } from '../page/library/constants/sections';
import { NotFoundPage } from './NotFound';
import { PATH } from '../constants/paths';

/**
 * 路由表：**全应用页面分支的唯一入口**。
 *
 * 改造前分支散在三处手写路由里（`main.tsx` 的 hash 分流、`page/library/router.ts` 的
 * `#/components/<kind>`、文档页组件里的 `unknown` 兜底）。现在都在这一张表里：
 * 主界面 `/`、调试页 `/debug`、文档页 `/library`（总览为索引路由）与其详情
 * `/library/components/:kind`，外加全局未命中 `*`。
 *
 * 只有页面级分流进 URL；会话、弹窗、过程区开合仍在 store（见 `web/README.md` §路由）。
 */

/** 文档页索引路由：`sections` 由骨架经 `<Outlet context>` 下发，总览页自己仍是 props 驱动。 */
function LibraryOverviewRoute(): ReactNode {
  const { sections } = useOutletContext<LibraryOutletContext>();
  return <Overview sections={sections} />;
}

/**
 * 文档页详情路由：`:kind` 的合法性在这里判定。
 *
 * 非法 kind 显示页内的「没有这个组件」提示，**不是**全局未命中页——它仍然是文档页的一屏
 * （顶栏、左导航、搜索都在），只是内容区没东西。这与改造前 `page/library/router.ts` 的
 * `unknown` 分支是同一个语义：不静默回落。
 *
 * 出口仍是 `<button>` + `navigate`：`.libInlineLink` 是按按钮写的类（文档页现有用法就是 `<button>`）。
 */
function LibraryComponentRoute(): ReactNode {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { kind } = useParams<{ kind: string }>();
  const section = LIBRARY_SECTIONS.find(candidate => candidate.kind === kind);
  if (section !== undefined) return <ComponentPage section={section} />;

  return (
    <>
      <h2 className="libPageTitle">没有这个组件</h2>
      <p className="libPageSummary">
        路径「{pathname}」不在 {LIBRARY_SECTIONS.length} 个内容 kind 里。{' '}
        <button
          type="button"
          className="libInlineLink"
          onClick={() => { void navigate(PATH.library); }}
        >
          回到组件总览
        </button>
      </p>
    </>
  );
}

/**
 * 根布局：只做两件事——同步文档标题、渲染子路由。
 *
 * **不产生 DOM 包裹层**（返回裸 `<Outlet />`）：三个页面各自的 `.appFrame` 网格与
 * `#root` 的布局关系因此与改造前完全一致，`frame.css` 依赖的骨架契约没有被改动。
 */
function RootLayout(): ReactNode {
  const { pathname } = useLocation();

  useEffect(() => {
    // 标题口径沿用改造前的两个 HTML：文档页是「Bangumi 助手 · 内容组件库」，
    // 其余（主界面 / 调试页 / 未命中）用 `index.html` 的原标题——调试页本来就没有独立标题，
    // 这里也不为它新增一个。
    document.title = pathname === PATH.library || pathname.startsWith(`${PATH.library}/`)
      ? 'Bangumi 助手 · 内容组件库'
      : 'Bangumi 助手 Web 终端';
  }, [pathname]);

  return <Outlet />;
}

/** 路由表本体。路径字面量一律从 `./paths` 取，不在表里写裸字符串。 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: PATH.home, element: <MainPage /> },
      { path: PATH.debug, element: <DebugPage /> },
      {
        path: PATH.library,
        element: <LibraryPage />,
        children: [
          { index: true, element: <LibraryOverviewRoute /> },
          { path: 'components/:kind', element: <LibraryComponentRoute /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
