import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { UiVariantToggle } from './UiVariantToggle';

/* 图标统一 16px、fill/stroke 走 currentColor，与既有图标槽的约定一致。 */
const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

/**
 * 顶栏：标题、当前栏、连接状态与设置入口。
 *
 * 数据来源遵循规则 B（外壳直接消费 store），因此这里不接收任何 props。
 * 连接状态点的变化、按钮的按下与聚焦都由 `styles/frame.css` 给出过渡。
 */
export function Header(): ReactNode {
  const actions = useActions();
  const connected = useAppSelector(state => state.stream.connected);

  return (
    <header className="appHeader">
      <div className="appTitleRow">
        <span className="appTitle">Bangumi 助手</span>
        <span className="appTab" aria-current="page">会话</span>
      </div>
      <div className="appHeaderMeta">
        <span className="appChip" data-state={connected ? 'on' : 'off'} title="连接状态">
          <span className="appChipDot" aria-hidden="true" />
          {connected ? '已连接' : '连接中断'}
        </span>
        <button
          type="button"
          className="appIconButton"
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
