import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { relativeTimeLabel } from '../../../utils/relativeTime';
import { DURATION, EASE_OUT, SHIFT } from '../../motion/motionTokens';
import { enterDebug } from '../../../utils/debugMode';
import { SidebarBrand } from './SidebarBrand';

/* 图标统一 16px、fill/stroke 走 currentColor，与既有图标槽的约定一致。 */
const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

function PanelIcon(): ReactNode {
  return <svg {...ICON}><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function PlusIcon(): ReactNode {
  return <svg {...ICON}><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

/** 逐项入场的错峰间隔：最多累积到 8 项，避免长列表让最后一项等太久。 */
const STAGGER_S = 0.03;
const STAGGER_MAX = 8;

/**
 * 侧栏：品牌行、折叠、新建会话与历史会话列表。
 *
 * 每行右侧是状态或时间：待确认 / 待登录 / 运行中优先于「当前」，其余显示相对时间。
 * 折叠是列宽与文字透明度的过渡，列表是逐项错峰的浮入。
 *
 * 关于 ReactBits 的 `AnimatedList`：它只接受 `items: string[]` 并统一渲染成
 * `<p class="item-text">`，而这里每行要分成「标题 + 状态」两栏（状态要弱化显示），
 * 且它内部固定 `marginBottom: 1rem`、默认还会全局拦下 Tab/方向键。为了不牺牲信息
 * 分层与键盘可用性，这里按它同样的动势（`scale 0.7 → 1` + 淡入）自己实现，
 * 未采用该组件。
 */
export function Sidebar(): ReactNode {
  const actions = useActions();
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const sessions = useAppSelector(state => state.catalog.sessions);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  // 一屏里的多行共用一个时刻，避免相邻两行落在不同的时间档上。
  const now = Date.now();

  return (
    <aside className="appSidebar">
      <SidebarBrand
        title="双击进入调试页"
        onDoubleClick={() => { enterDebug(); }}
      >
        <button
          type="button"
          className="appIconButton"
          onClick={actions.toggleSidebar}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <PanelIcon />
        </button>
      </SidebarBrand>
      <button
        type="button"
        className="appNewSession"
        onClick={() => { void actions.newSession().catch(() => { /* 失败已提示。 */ }); }}
        title="新建会话"
      >
        <PlusIcon />
        <span className="appNewSessionLabel">新建会话</span>
      </button>
      <div className="appRegionArea">
        <div className="appRegionLabel">历史会话</div>
        {sessions.length ? sessions.map((session, index) => (
          <motion.button
            key={session.id}
            type="button"
            className="appSessionRow"
            data-current={session.id === sessionId}
            // 只在挂载时入场：同一条会话的 key 不变，因此切换会话不会整列重播。
            initial={{ opacity: 0, y: SHIFT.row, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: Math.min(index, STAGGER_MAX) * STAGGER_S }}
            onClick={() => { void actions.resumeSession(session).catch(() => { /* 失败已提示。 */ }); }}
            title={`${session.path} · ${session.modified} · ${session.messageCount} 条消息`}
          >
            <span className="appSessionTitle">{session.name || '新会话'}</span>
            <span className="appSessionTime">{session.awaitingConfirmation ? '待确认' : session.awaitingLogin ? '待登录'
              : session.busy ? '运行中' : session.id === sessionId ? '当前' : relativeTimeLabel(session.modified, now)}</span>
          </motion.button>
        )) : <div className="appRegionLabel">暂无历史会话</div>}
      </div>
    </aside>
  );
}
