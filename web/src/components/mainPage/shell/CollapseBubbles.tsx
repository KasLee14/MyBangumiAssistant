import type { ReactNode } from 'react';
import { useActions } from '../../../store/hooks';
import { EditIcon, PanelIcon } from './icons';

/**
 * 收起态左上角的两个入口气泡（[C44](../../docs/design/decisions/C44-sidebar.md) 的 C44b 定稿）。
 *
 * 抽屉式收起之后侧栏宽度归零，品牌、折叠钮与「开启新对话」都滑出窗口，
 * 所以这两个入口必须落在侧栏**之外**：它们绝对定位在 `.appFrame` 上（不参与 grid），
 * 只在收起态可见。展开态与收起态各有一份入口，两者永远不会同时出现。
 *
 * 形态是玻璃浮起层：常态只给底色与描边，`backdrop-filter` 只在收起态才挂
 * ——展开态这两个按钮不可见，没必要让浏览器为它们各算一遍模糊。
 */
export function CollapseBubbles(): ReactNode {
  const actions = useActions();
  return (
    <div className="appCollapseBubbles">
      <button
        type="button"
        className="appCollapseBubble"
        title="展开侧栏"
        onClick={actions.toggleSidebar}
      >
        <PanelIcon />
        <span className="appCollapseText">展开</span>
      </button>
      <button
        type="button"
        className="appCollapseBubble appCollapseBubbleAccent"
        title="新建会话"
        onClick={() => { void actions.newSession().catch(() => { /* 失败已提示。 */ }); }}
      >
        <EditIcon />
        <span className="appCollapseText">新对话</span>
      </button>
    </div>
  );
}
