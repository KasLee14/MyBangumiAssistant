import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { relativeTimeLabel } from '../../../utils/relativeTime';
import { V2_DURATION, V2_EASE_OUT, V2_SHIFT } from '../../motion/motionTokens';

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
 * v2 侧栏：品牌行、折叠、新建会话与历史会话列表。
 *
 * 承载的信息与 v1 侧栏完全一致（标题 + 「当前」/相对时间），只是呈现与动势不同：
 * 折叠是列宽与文字透明度的过渡，列表是逐项错峰的浮入。
 *
 * 关于 ReactBits 的 `AnimatedList`：它只接受 `items: string[]` 并统一渲染成
 * `<p class="item-text">`，而这里每行要分成「标题 + 相对时间」两栏（时间要弱化显示），
 * 且它内部固定 `marginBottom: 1rem`、默认还会全局拦下 Tab/方向键。为了不牺牲信息
 * 分层与键盘可用性，这里按它同样的动势（`scale 0.7 → 1` + 淡入）自己实现，
 * 未采用该组件——这一点会在交付说明里写明。
 */
export function SidebarV2(): ReactNode {
  const actions = useActions();
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const sessions = useAppSelector(state => state.catalog.sessions);
  // 一屏里的多行共用一个时刻，避免相邻两行落在不同的时间档上。
  const now = Date.now();

  return (
    <aside className="v2Sidebar">
      <div className="v2LogoRow">
        <span className="v2Brand">Bangumi 助手</span>
        <button
          type="button"
          className="v2IconButton"
          onClick={actions.toggleSidebar}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <PanelIcon />
        </button>
      </div>
      <button
        type="button"
        className="v2NewSession"
        onClick={() => { void actions.newSession().catch(() => { /* 失败已提示。 */ }); }}
        title="新建会话"
      >
        <PlusIcon />
        <span className="v2NewSessionLabel">新建会话</span>
      </button>
      <div className="v2RegionArea">
        <div className="v2RegionLabel">历史会话</div>
        {sessions.length ? sessions.map((session, index) => (
          <motion.button
            key={session.path}
            type="button"
            className="v2SessionRow"
            data-current={session.current}
            // 只在挂载时入场：同一条会话的 key 不变，因此切换会话不会整列重播。
            initial={{ opacity: 0, y: V2_SHIFT.row, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: V2_DURATION.slow, ease: V2_EASE_OUT, delay: Math.min(index, STAGGER_MAX) * STAGGER_S }}
            onClick={() => { void actions.resumeSession(session).catch(() => { /* 失败已提示。 */ }); }}
            title={`${session.path} · ${session.modified} · ${session.messageCount} 条消息`}
          >
            <span className="v2SessionTitle">{session.name || session.id}</span>
            {session.current
              ? <span className="v2SessionTime">当前</span>
              : <span className="v2SessionTime">{relativeTimeLabel(session.modified, now)}</span>}
          </motion.button>
        )) : <div className="v2RegionLabel">暂无历史会话</div>}
      </div>
    </aside>
  );
}
