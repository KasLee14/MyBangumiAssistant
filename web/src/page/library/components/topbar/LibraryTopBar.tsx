import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { AppTopBar, AppTopBarTab } from '../../../../components/AppTopBar';
import { PATH } from '../../../../constants/paths';
import type { LibrarySection } from '../../types/sections';
import { componentPath } from '../../../../utils/paths';
import { Pill } from '../Pill';

/**
 * 文档页顶栏：品牌 + 栏目 + 动作区（搜索框、两个入口链接、版本胶囊）。
 *
 * 搜索框为什么在**动作区**而不是居中：顶栏形态由共享组件 `AppTopBar` 定义（本页与调试页
 * 共用一份），不为了让搜索居中而给文档页开一个顶栏特例。
 *
 * 回车跳「第一条命中」而不是留在原地过滤：过滤已经即时反映在左导航上，回车这一步的语义是
 * 「进第一条结果」——文档页的正内容在详情页里。跳转用 `useNavigate`（而不是把回调交给装配层）
 * 是因为这里没有跨组件共享的状态，只有「回车/点击 → 换路由」这一件事。
 *
 * 两个入口是 `<Link>` 而不是裸 `<a>`：`.libHeaderLink` 本来就是按 `<a>` 写的，换成 `<Link>`
 * 只是补上客户端跳转，形态与配色都不变（「链接只有一种蓝」这条硬约定仍由那个类维持）。
 */
export interface LibraryTopBarProps {
  /** 搜索框内容（由装配层持有：它同时决定左导航的过滤结果）。 */
  query: string;
  onQueryChange(query: string): void;
  /** 当前过滤结果；只为「回车进第一条命中」取首项。 */
  sections: LibrarySection[];
}

export function LibraryTopBar({ query, onQueryChange, sections }: LibraryTopBarProps): ReactNode {
  const navigate = useNavigate();

  return (
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
            onChange={event => onQueryChange(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              const first = sections[0];
              if (first !== undefined) void navigate(componentPath(first.kind));
            }}
          />
          <Link className="libHeaderLink" to={PATH.home}>主界面</Link>
          <Link className="libHeaderLink" to={PATH.debug}>调试页</Link>
          <Pill>v1.0.0</Pill>
        </>
      )}
    />
  );
}
