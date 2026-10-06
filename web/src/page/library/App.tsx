import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppTopBar, AppTopBarTab } from '../../components/common/AppTopBar';
import { Pill } from '../../components/common/Pill';
import type { ContentKind } from '../../components/content/registry';
import { ComponentPage, PAGE_ANCHORS } from './ComponentPage';
import { Overview } from './Overview';
import { LIBRARY_GROUPS, LIBRARY_SECTIONS } from './samples';
import { filterSections } from './search';
import { OVERVIEW_HREF, componentHref, navigate, useRoute } from './router';

/**
 * 组件库文档页的骨架（**自绘**）。
 *
 * 形态与调试页一致：顶栏横跨全宽（复用共享组件 `AppTopBar`），下面才是
 * 「左导航 | 内容 | 页内目录」。主界面已按 [C01](../../docs/design/decisions/C01-app-top-bar.md)
 * 删除顶栏（功能迁进侧栏），本页与调试页仍需要它。工具页不再有「另有一套外观」的例外——
 * 玻璃、圆角、弹性曲线、导航行都来自同一套令牌与共享类（`.appNavRow` / `.appTopBar*` / `.appEmpty`）。
 *
 * 三处刻意的形态决定：
 * 1. **右目录自绘**：`PAGE_ANCHORS` 的锚点若走 `location.hash`，会与「一组件一页」的
 *    hash 路由（`#/components/<kind>`）互相覆盖。保路由，目录用 `PageToc` 自己滚动。
 * 2. **左导航从两张表派生**（`LIBRARY_GROUPS` + `LIBRARY_SECTIONS`），这里不硬编码任何
 *    kind：新增一种内容条目只改数据，不改这个文件。
 * 3. **搜索框放在顶栏动作区**（不是居中）：顶栏形态由共享组件定义，本页与调试页共用一份，
 *    不为了让搜索居中而给文档页开一个顶栏特例。
 */

function titleOf(kind: ContentKind): string {
  return LIBRARY_SECTIONS.find(section => section.kind === kind)?.title ?? kind;
}

/** 右侧页内目录：自绘（理由见文件头注释），滚动时同步高亮。 */
function PageToc(): ReactNode {
  const [active, setActive] = useState<string>(PAGE_ANCHORS[0].id);

  useEffect(() => {
    const targets = PAGE_ANCHORS
      .map(anchor => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible !== undefined) setActive(visible.target.id);
    }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <ul className="libToc">
      {PAGE_ANCHORS.map(anchor => (
        <li key={anchor.id}>
          <button
            type="button"
            className="libTocLink"
            data-active={anchor.id === active}
            onClick={() => { document.getElementById(anchor.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          >
            {anchor.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LibraryPage(): ReactNode {
  const route = useRoute();
  const [query, setQuery] = useState('');
  const sections = useMemo(() => filterSections(query), [query]);
  const visibleKinds = useMemo(() => new Set(sections.map(section => section.kind)), [sections]);

  // 导航完全由数据派生：分组内没有命中的 kind 时，这个分组整体不出现。
  const groups = useMemo(
    () => LIBRARY_GROUPS
      .map(group => ({
        key: group.key,
        label: group.label,
        kinds: group.kinds.filter(kind => visibleKinds.has(kind)),
      }))
      .filter(group => group.kinds.length > 0),
    [visibleKinds],
  );

  const selectedKey: string = route.name === 'component' ? route.kind : 'overview';

  const content = useMemo(() => {
    if (route.name === 'overview') return <Overview sections={sections} />;
    if (route.name === 'component') {
      const section = LIBRARY_SECTIONS.find(candidate => candidate.kind === route.kind);
      return section === undefined ? null : <ComponentPage section={section} />;
    }
    return (
      <>
        <h2 className="libPageTitle">没有这个组件</h2>
        <p className="libPageSummary">
          路径「{route.path}」不在 {LIBRARY_SECTIONS.length} 个内容 kind 里。
          {' '}
          <button type="button" className="libInlineLink" onClick={() => { navigate(OVERVIEW_HREF); }}>
            回到组件总览
          </button>
        </p>
      </>
    );
  }, [route, sections]);

  return (
    <div className="libFrame">
      <AppTopBar
        brand={(
          <span className="libBrand">
            <span className="libBrandMark">Bangumi</span>
            <span className="libBrandTitle">内容组件库</span>
          </span>
        )}
        tabs={<AppTopBarTab current>组件</AppTopBarTab>}
        actions={(
          <>
            <input
              className="libSearch"
              type="search"
              value={query}
              placeholder="搜索组件名 / 字段名"
              aria-label="搜索组件"
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return;
                const first = sections[0];
                if (first !== undefined) navigate(componentHref(first.kind));
              }}
            />
            <a className="libHeaderLink" href="./index.html">主界面</a>
            <a className="libHeaderLink" href="./index.html#debug">调试页</a>
            <Pill>v1.0.0</Pill>
          </>
        )}
      />

      <div className="libBody">
        <nav className="libNav" aria-label="组件导航">
          <button
            type="button"
            className="appNavRow"
            data-current={selectedKey === 'overview'}
            onClick={() => { navigate(OVERVIEW_HREF); }}
          >
            组件总览
          </button>
          {groups.map(group => (
            <div key={group.key} className="libNavGroup">
              <div className="libNavGroupLabel">{group.label}</div>
              {group.kinds.map(kind => (
                <button
                  key={kind}
                  type="button"
                  className="appNavRow"
                  data-current={selectedKey === kind}
                  onClick={() => { navigate(componentHref(kind)); }}
                >
                  <span className="appNavTitle">{titleOf(kind)}</span>
                  <span className="appNavMeta">{kind}</span>
                </button>
              ))}
            </div>
          ))}
          {sections.length === 0 ? (
            <div className="appEmpty">
              <div className="appEmptyTitle">没有匹配的组件</div>
              <div className="appEmptyHint">清空搜索框试试。</div>
            </div>
          ) : null}
        </nav>

        <main className="libContent">
          <div className="libContentInner">{content}</div>
        </main>

        {/* 右侧页内目录只在详情页出现：总览页没有这四块可导航，留一列空白反而像坏了 */}
        {route.name === 'component' ? (
          <aside className="libTocSider">
            <PageToc />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
