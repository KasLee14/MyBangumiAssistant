import { useMemo, useState, type ReactNode } from 'react';
import { Outlet, useMatch } from 'react-router';
import { isContentKind } from '../../components/content/registry';
import { LIBRARY_COMPONENT_PATTERN } from '../../constants/paths';
import { LibraryNav, type LibraryNavGroup } from './components/nav/LibraryNav';
import { PageToc } from './components/toc/PageToc';
import { LibraryTopBar } from './components/topbar/LibraryTopBar';
import { LIBRARY_GROUPS } from './constants/sections';
import type { LibraryOutletContext } from './types/sections';
import { filterSections } from './utils/search';

/**
 * 内容组件库文档页（`/library`）的骨架（**自绘**）。
 *
 * 形态与调试页一致：顶栏横跨全宽（复用共享组件 `AppTopBar`），下面才是
 * 「左导航 | 内容 | 页内目录」。主界面已按 C01 删除顶栏（功能迁进侧栏），本页与调试页仍需要它。
 * 工具页没有「另有一套外观」的例外——玻璃、圆角、弹性曲线、导航行都来自同一套令牌与共享类
 *（`.appNavRow` / `.appTopBar*` / `.appEmpty`）。
 *
 * 路由改造后这一层多了一件事：**内容区是 `<Outlet />`**。「总览」与「某个 kind 的详情」是两条
 * 子路由（见 `src/router/routes.tsx`），骨架只负责搜索过滤、左导航与页内目录；过滤结果
 * `sections` 经 `<Outlet context>` 下发，两个子页面自己仍是 props 驱动。
 *
 * 三处刻意的形态决定（各自落在实现它的文件里，这里只留结论）：
 * 1. **右目录自绘**：锚点不能走 `location.hash`——详情页的地址本身就是路径，会互相覆盖。
 *    保路由、目录自己滚动，见 `components/toc/PageToc.tsx`。
 * 2. **左导航从两张表派生**（`LIBRARY_GROUPS` + `LIBRARY_SECTIONS`），这里不硬编码任何 kind：
 *    新增一种内容条目只改数据，渲染在 `components/nav/LibraryNav.tsx`。
 * 3. **搜索框放在顶栏动作区**（不是居中），见 `components/topbar/LibraryTopBar.tsx`。
 *
 * 本文件只做装配：过滤与派生（`sections` / `groups` / `selectedKey` / `outletContext`）在这里，
 * 三块 UI 各自是 props 驱动的组件。
 */
export function LibraryPage(): ReactNode {
  /**
   * 命中的详情路由的 `:kind`（索引路由即总览时为 `undefined`）。
   *
   * `kind` 还要再判一次合法性：路径参数是任意字符串，而右目录只该给**真实的**详情页——
   * 非法 kind 那一屏没有 UI 预览 / 参数 / event / frame 四块，留一列点不动的目录反而像坏了
   *（与改造前 `route.name === 'component'` 的口径一致）。
   */
  const detailKind = useMatch(LIBRARY_COMPONENT_PATTERN)?.params['kind'];
  const componentKind = detailKind !== undefined && isContentKind(detailKind) ? detailKind : null;
  const [query, setQuery] = useState('');
  const sections = useMemo(() => filterSections(query), [query]);
  const visibleKinds = useMemo(() => new Set(sections.map(section => section.kind)), [sections]);

  // 导航完全由数据派生：分组内没有命中的 kind 时，这个分组整体不出现。
  const groups = useMemo<LibraryNavGroup[]>(
    () => LIBRARY_GROUPS
      .map(group => ({
        key: group.key,
        label: group.label,
        kinds: group.kinds.filter(kind => visibleKinds.has(kind)),
      }))
      .filter(group => group.kinds.length > 0),
    [visibleKinds],
  );

  const selectedKey: string = componentKind ?? 'overview';
  // 稳定引用：`sections` 不变时子路由不因为 context 是新对象而重渲染。
  const outletContext = useMemo<LibraryOutletContext>(() => ({ sections }), [sections]);

  return (
    <div className="libFrame">
      <LibraryTopBar query={query} onQueryChange={setQuery} sections={sections} />

      <div className="libBody">
        <LibraryNav groups={groups} selectedKey={selectedKey} empty={sections.length === 0} />

        <main className="libContent">
          <div className="libContentInner"><Outlet context={outletContext} /></div>
        </main>

        {/* 右侧页内目录只在**合法的**详情页出现：总览页与「没有这个组件」都没有这四块可导航，
            留一列点不动的目录反而像坏了（与改造前 `route.name === 'component'` 同一口径） */}
        {componentKind === null ? null : (
          <aside className="libTocSider">
            <PageToc />
          </aside>
        )}
      </div>
    </div>
  );
}
