import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, ConfigProvider, Input, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { ContentKind } from '../../components/content/registry';
import { ComponentPage, PAGE_ANCHORS } from './ComponentPage';
import { Overview } from './Overview';
import { LIBRARY_GROUPS, LIBRARY_SECTIONS } from './samples';
import { filterSections } from './search';
import { LIBRARY_THEME } from './theme';
import { OVERVIEW_HREF, componentHref, navigate, useRoute } from './router';

/**
 * 组件库文档页的骨架。
 *
 * 形态对齐 ant.design 文档站：顶部工具条（品牌 + 搜索 + 栏目 + 真实入口）、左侧两层分组导航、
 * 中间内容区、右侧页内目录。骨架用 antd 搭（Layout / Menu / Input / Card / Table / Typography），
 * 但**内容渲染一律走项目自己的 `ContentItem`**——antd 不参与内容条目的渲染。
 *
 * 一处刻意的偏离：右侧目录**没有用 antd 的 `Anchor`**。`Anchor` 的锚点实现依赖写
 * `location.hash`，而本页的「一组件一页」路由也占着 hash（`#/components/<kind>`），
 * 两者会互相覆盖。保路由（前进后退、可直连 URL 是确认过的形态），目录自绘（见 `PageToc`）。
 *
 * 左侧导航**完全从 `samples.ts` 的两张表派生**（`LIBRARY_GROUPS` + `LIBRARY_SECTIONS`），
 * 这里不硬编码任何 kind：新增一种内容条目只改数据，不改这个文件。
 */

function sectionOf(kind: ContentKind) {
  return LIBRARY_SECTIONS.find(section => section.kind === kind);
}

function titleOf(kind: ContentKind): string {
  return sectionOf(kind)?.title ?? kind;
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

  const menuItems = useMemo(() => [
    { key: 'overview', label: '组件总览' },
    ...LIBRARY_GROUPS
      .map(group => ({
        key: group.key,
        label: group.label,
        type: 'group' as const,
        children: group.kinds
          .filter(kind => visibleKinds.has(kind))
          .map(kind => ({ key: kind, label: titleOf(kind) })),
      }))
      .filter(group => group.children.length > 0),
  ], [visibleKinds]);

  const selectedKey = route.name === 'component' ? route.kind : 'overview';

  const content = useMemo(() => {
    if (route.name === 'overview') return <Overview sections={sections} />;
    if (route.name === 'component') {
      const section = sectionOf(route.kind);
      return section === undefined ? null : <ComponentPage section={section} />;
    }
    return (
      <>
        <Typography.Title level={2} className="libPageTitle">没有这个组件</Typography.Title>
        <Typography.Paragraph type="secondary">
          路径「{route.path}」不在 12 个内容 kind 里。
          {' '}
          <Typography.Link onClick={() => { navigate(OVERVIEW_HREF); }}>回到组件总览</Typography.Link>
        </Typography.Paragraph>
      </>
    );
  }, [route, sections]);

  return (
    <ConfigProvider theme={LIBRARY_THEME}>
      <Layout className="libFrame">
        <Layout.Header className="libHeader">
          <div className="libBrand">
            <span className="libBrandMark">Bangumi</span>
            <span className="libBrandTitle">内容组件库</span>
          </div>
          <Menu
            className="libTopMenu"
            mode="horizontal"
            selectedKeys={['components']}
            items={[{ key: 'components', label: '组件' }]}
          />
          <Input.Search
            className="libSearch"
            placeholder="搜索组件名 / 字段名，回车跳到第一个"
            allowClear
            value={query}
            onChange={event => setQuery(event.target.value)}
            onSearch={() => {
              const first = sections[0];
              if (first !== undefined) navigate(componentHref(first.kind));
            }}
          />
          <Space className="libHeaderActions" size={4}>
            <Button type="link" href="./index.html">主界面</Button>
            <Button type="link" href="./index.html#debug">调试页</Button>
            <Tag color="#f09199">v1.0.0</Tag>
          </Space>
        </Layout.Header>

        <Layout className="libBody">
          <Layout.Sider width={252} theme="light" className="libSider">
            <Menu
              mode="inline"
              className="libNavMenu"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={({ key }) => {
                navigate(key === 'overview' ? OVERVIEW_HREF : componentHref(key as ContentKind));
              }}
            />
          </Layout.Sider>

          <Layout.Content className="libContent">
            <div className="libContentInner">{content}</div>
          </Layout.Content>

          {/* 右侧页内目录只在详情页出现：总览页没有四块可导航，留一列空白反而像坏了 */}
          {route.name === 'component' ? (
            <Layout.Sider width={180} theme="light" className="libTocSider">
              <PageToc />
            </Layout.Sider>
          ) : null}
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
