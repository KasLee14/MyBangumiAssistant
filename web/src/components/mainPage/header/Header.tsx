import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';

const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

/**
 * 会话顶栏：标题行、连接状态与设置入口。
 *
 * 连接状态来自会话流切片（`EventSource` 的 open / error），设置入口把设置弹窗
 * 打开到主面板（`pane` 为 null）。
 */
export function Header(): ReactNode {
  const actions = useActions();
  const connected = useAppSelector(state => state.stream.connected);
  return (
    <header className="conversationHeader">
      <div className="titleRow">
        <span className="title">Bangumi 助手</span>
        <span className="tab" aria-selected="true">会话</span>
      </div>
      <div className="headerMeta">
        <span className="chip" data-state={connected ? 'on' : 'off'} title="连接状态">
          <span className="dot" />
          {connected ? '已连接' : '连接中断'}
        </span>
        <button
          type="button"
          className="iconButton"
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
