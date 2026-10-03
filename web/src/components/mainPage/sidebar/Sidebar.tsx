import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';

/* 图标统一 16px、fill/stroke 走 currentColor，与上游图标槽一致。 */
const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

function PanelIcon(): ReactNode {
  return <svg {...ICON}><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function PlusIcon(): ReactNode {
  return <svg {...ICON}><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

/**
 * 侧栏只承载会话：品牌行与折叠、新建会话、历史会话列表。
 *
 * 模型、密钥、代理线路与 Bangumi 登录状态都收进了顶栏的设置弹窗，
 * 因此这里不再有对应的功能行。会话列表、折叠状态与动作都来自 store。
 */
export function Sidebar(): ReactNode {
  const actions = useActions();
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const sessions = useAppSelector(state => state.catalog.sessions);
  return (
    <aside className="sidebar">
      <div className="logoRow">
        <span className="brandName">Bangumi 助手</span>
        <button type="button" className="iconButton" onClick={actions.toggleSidebar} title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>
          <PanelIcon />
        </button>
      </div>
      <button type="button" className="newSession" onClick={() => { void actions.newSession().catch(() => { /* 失败已提示。 */ }); }} title="新建会话">
        <PlusIcon />
        <span className="label">新建会话</span>
      </button>
      <div className="regionArea">
        <div className="regionLabel">历史会话</div>
        {sessions.length ? sessions.map(session => (
          <button
            key={session.path}
            type="button"
            className={`sessionRow${session.current ? ' selected' : ''}`}
            onClick={() => { void actions.resumeSession(session).catch(() => { /* 失败已提示。 */ }); }}
            title={`${session.path} · ${session.modified} · ${session.messageCount} 条消息`}
          >
            <span className="title">{session.name || session.id}</span>
            {session.current ? <span className="time">当前</span> : <span className="time">{session.messageCount}</span>}
          </button>
        )) : <div className="regionLabel">暂无历史会话</div>}
      </div>
    </aside>
  );
}
