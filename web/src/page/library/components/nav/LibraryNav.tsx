import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PATH } from '../../../../constants/paths';
import type { ContentKind } from '../../../../types/content';
import { componentPath } from '../../../../utils/paths';
import { titleOf } from '../../utils/title';

/**
 * 左导航：总览入口 + 分组列表。
 *
 * 这里不硬编码任何 kind——`groups` 由装配层从 `LIBRARY_GROUPS` 与过滤结果派生（分组内没有
 * 命中的 kind 时该分组整体消失也在那边做完），新增一种内容条目只改数据。
 *
 * 导航行用 `<button>` + `navigate()` 而不是 `<Link>`：`.appNavRow` 的既定契约挂在按钮上
 *（`common.css` 与 `frame.css` 的注释都写着「它本身是 `<button>`」），换成 `<a>` 会把浏览器
 * 默认的链接颜色与下划线带进来，破坏「不写裸色值」与「链接只有一种蓝」两条硬约定。
 */
export interface LibraryNavGroup {
  key: string;
  label: string;
  /** 过滤后仍有命中的 kind；顺序即渲染顺序。 */
  kinds: ContentKind[];
}

export interface LibraryNavProps {
  groups: LibraryNavGroup[];
  /** 当前高亮项：命中的 `kind`，或总览时的 `'overview'`。 */
  selectedKey: string;
  /** 过滤后一个命中都没有（渲染空态而不是一列空分组）。 */
  empty: boolean;
}

export function LibraryNav({ groups, selectedKey, empty }: LibraryNavProps): ReactNode {
  const navigate = useNavigate();

  return (
    <nav className="libNav" aria-label="组件导航">
      <button
        type="button"
        className="appNavRow"
        data-current={selectedKey === 'overview'}
        onClick={() => { void navigate(PATH.library); }}
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
              onClick={() => { void navigate(componentPath(kind)); }}
            >
              <span className="appNavTitle">{titleOf(kind)}</span>
              <span className="appNavMeta">{kind}</span>
            </button>
          ))}
        </div>
      ))}
      {empty ? (
        <div className="appEmpty">
          <div className="appEmptyTitle">没有匹配的组件</div>
          <div className="appEmptyHint">清空搜索框试试。</div>
        </div>
      ) : null}
    </nav>
  );
}
