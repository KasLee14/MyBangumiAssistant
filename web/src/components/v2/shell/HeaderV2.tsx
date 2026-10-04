import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { UiVariantToggle } from '../../mainPage/header/UiVariantToggle';

/* 图标统一 16px、fill/stroke 走 currentColor，与既有图标槽的约定一致。 */
const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

/**
 * v2 顶栏：标题、连接状态、外观切换与设置入口。
 *
 * 与 v1 顶栏承载完全相同的信息与动作，区别只在承载方式（分组、间距、材质）与
 * 状态过渡：连接状态点的变化、按钮的按下与聚焦都由 `v2/shell.css` 给出过渡。
 *
 * 数据来源与 v1 一致（规则 B：外壳直接消费 store），因此这里不接收任何 props。
 */
export function HeaderV2(): ReactNode {
  const actions = useActions();
  const connected = useAppSelector(state => state.stream.connected);

  return (
    <header className="v2Header">
      <div className="v2TitleRow">
        <span className="v2Title">Bangumi 助手</span>
        <span className="v2Tab" aria-current="page">会话</span>
      </div>
      <div className="v2HeaderMeta">
        <UiVariantToggle />
        <span className="v2Chip" data-state={connected ? 'on' : 'off'} title="连接状态">
          <span className="v2ChipDot" aria-hidden="true" />
          {connected ? '已连接' : '连接中断'}
        </span>
        <button
          type="button"
          className="v2IconButton"
          title="设置：模型、代理端口、登录状态"
          aria-label="设置"
          onClick={() => void actions.openSettings(null)}
        >
          <svg {...ICON}>
            <path d="M8 2.2l4.8 2.7v5.9L8 13.8 3.2 10.8V4.9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
