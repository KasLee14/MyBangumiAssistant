import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionOptionView } from '../../../../../bangumi/src/web/protocol';
import { Stagger } from '../../common/Stagger';
import { useActions, useAppSelector } from '../../../store/hooks';
import { enterDebug } from '../../../utils/debugMode';
import { relativeTimeLabel, sessionDayGroup, SESSION_GROUP_ORDER } from '../../../utils/relativeTime';
import { EditIcon, GearIcon, PanelIcon } from './icons';

/** 会话行尾「···」的开合目标。[C45](../../docs/design/decisions/C45-settings-entry.md) 之后，
    侧栏里只剩这一处菜单（底部那套浮层菜单已删）。 */
type OpenMenu = { kind: 'row'; sessionId: string } | null;

/**
 * 侧栏：**唯一的外壳**。
 *
 * [C01](../../docs/design/decisions/C01-app-top-bar.md) 删掉顶栏之后，原来挂在顶栏上的
 * 四件事 + 一条栏目槽全部落到这里（[C43](../../docs/design/decisions/C43-header.md) 定稿 D）：
 *
 * - 顶部一行：品牌（双击进调试页）· 连接状态点（8px，常态可见）· 折叠按钮；
 * - 第二行：实心主色整行「开启新对话」——**侧栏唯一的主色实心操作**
 *   （首屏那枚设置入口取同一组颜色，见 [C45](../../docs/design/decisions/C45-settings-entry.md) 的 2026-10-10 修订）；
 * - 列表：置顶 / 今天 / 昨天 / 7 天内 / 更早（[C44](../../docs/design/decisions/C44-sidebar.md)）；
 * - 底部一行：头像 + 用户名 + 齿轮「设置」入口（[C45](../../docs/design/decisions/C45-settings-entry.md)
 *   定稿 B：原来这里是一枚「···」，点开是「设置 + 目录 / 调试页」浮层菜单；现在齿轮**单击直达设置**，
 *   菜单与那三个入口一并删掉——调试页仍可双击上面的品牌进入）。
 *
 * 行的形态来自共享基类 `.appNavRow`（`styles/common.css`）——文档页左导航用的是同一个类，
 * 所以「当前项是粉底 + 主色描边 + 主色字」这件事只有一处定义。置顶按钮与它的菜单是
 * **行外的兄弟元素**（`.appNavItem` 负责定位）：`.appNavRow` 本身是 `<button>`，
 * 按钮里不能再嵌按钮，所以不动基类、另起组合层。
 */
export function Sidebar(): ReactNode {
  const actions = useActions();
  const sessions = useAppSelector(state => state.catalog.sessions);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const connected = useAppSelector(state => state.stream.connected);
  const collapsed = useAppSelector(state => state.ui.collapsed);
  const switching = useAppSelector(state => state.ui.switching);
  const pinned = useAppSelector(state => state.ui.pinned);
  const username = useAppSelector(state => state.stream.loginUsername);

  const [open, setOpen] = useState<OpenMenu>(null);
  // 一屏里的多行共用一个时刻，避免相邻两行落在不同的时间档上。
  const now = Date.now();

  /* 行内菜单（会话行尾「···」）的点外关闭与 Esc 关闭。判据用 `data-menu-*` 标记而不是
     「是否在侧栏内」：点侧栏里**其它**会话行时也应该收起菜单，只有点在菜单自身与它的触发按钮上
     才不算「点外」。 */
  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-menu-surface], [data-menu-trigger]') !== null) return;
      setOpen(null);
    };
    /* capture 阶段：菜单开着时 Esc 应该只关菜单，不再触达全局的「拒绝写入 / 停止本轮」。 */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  /* 收起时把菜单关掉：菜单挂在侧栏里，收起到 0 宽后它既看不见也不可达，
     留着 `open` 会在下次展开时「自己弹出来」。 */
  useEffect(() => {
    if (collapsed) setOpen(null);
  }, [collapsed]);

  /* 分组：置顶是一档**与时间无关**的分组，先按 `ui.pinned` 挑出去，其余再按日历日归档。
     顺序固定取自 `SESSION_GROUP_ORDER`（宿主下发的顺序不保证），空档不渲染。 */
  const groups = useMemo(() => {
    const buckets = new Map<string, SessionOptionView[]>(SESSION_GROUP_ORDER.map(label => [label, []]));
    const pinnedRows: SessionOptionView[] = [];
    const pinnedSet = new Set(pinned);
    for (const id of pinned) {
      const session = sessions.find(candidate => candidate.id === id);
      // 宿主列表里已经没有这条会话（被删 / 换过配置）时惰性忽略，不清理置顶记录。
      if (session !== undefined) pinnedRows.push(session);
    }
    if (pinnedRows.length > 0) buckets.set('置顶', pinnedRows);
    for (const session of sessions) {
      if (pinnedSet.has(session.id)) continue;
      buckets.get(sessionDayGroup(session.modified, now))?.push(session);
    }
    return SESSION_GROUP_ORDER
      .map(label => ({ label, items: buckets.get(label) ?? [] }))
      .filter(group => group.items.length > 0);
  }, [sessions, pinned, now]);

  /** 行尾那一格：状态优先，其次才是相对时间（与上一版口径一致）。 */
  const metaOf = (session: SessionOptionView): string => {
    if (session.awaitingConfirmation) return '待确认';
    if (session.awaitingLogin) return '待登录';
    if (session.busy) return '运行中';
    if (session.id === sessionId) return '当前';
    return relativeTimeLabel(session.modified, now);
  };

  const resume = (session: SessionOptionView): void => {
    void actions.resumeSession(session).catch(() => { /* 失败已提示。 */ });
  };

  return (
    <aside className="appSidebar">
      <div className="appSidebarTop">
        <span
          className="appBrandAction appSidebarBrand"
          data-debug-toggle="true"
          role="button"
          tabIndex={0}
          title="双击进入调试页"
          onDoubleClick={() => { enterDebug(); }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') enterDebug();
          }}
        >
          Bangumi 助手
        </span>
        {/* 连接状态：8px 点，常态可见、不占一行（C43 定稿 D）。
            两态由 `data-state` 表态，颜色与光环在 `frame.css` 的 `.appSidebarStatus`。 */}
        <span
          className="appSidebarStatus"
          data-state={connected ? 'on' : 'off'}
          title={connected ? '已连接' : '连接中断'}
          aria-label={connected ? '已连接' : '连接中断'}
          role="img"
        />
        <button
          type="button"
          className="appIconButton"
          onClick={actions.toggleSidebar}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <PanelIcon />
        </button>
      </div>

      <button
        type="button"
        className="appSidebarNew"
        disabled={switching}
        onClick={() => { void actions.newSession().catch(() => { /* 失败已提示。 */ }); }}
      >
        <EditIcon />
        开启新对话
      </button>

      <div className="appSidebarScroll">
        {groups.length === 0 ? (
          <div className="appEmpty">
            <div className="appEmptyTitle">还没有会话</div>
            <div className="appEmptyHint">点上面的「开启新对话」，或者直接在输入框里提问。</div>
          </div>
        ) : groups.map(group => (
          <Fragment key={group.label}>
            <div className="appSidebarGroup">{group.label}</div>
            <Stagger>
              {group.items.map(session => {
                const rowOpen = open?.kind === 'row' && open.sessionId === session.id;
                const isPinned = pinned.includes(session.id);
                return (
                  <div className="appNavItem" key={session.id} data-menu-open={rowOpen}>
                    <button
                      type="button"
                      className="appNavRow"
                      data-current={session.id === sessionId}
                      title={`${session.path} · ${session.modified} · ${session.messageCount} 条消息`}
                      onClick={() => { resume(session); }}
                    >
                      <span className="appNavTitle">{session.name || '新会话'}</span>
                      {/* 置顶组里不再显示时间：这一组的排序由用户决定，时间没有意义（C43 样张）。 */}
                      {group.label === '置顶' ? null : <span className="appNavMeta">{metaOf(session)}</span>}
                    </button>
                    {/* 行 hover 时行尾的时间**换成**这个按钮（同一位置交叉淡入，见 `frame.css`）。 */}
                    <button
                      type="button"
                      className="appNavAction"
                      data-menu-trigger="true"
                      title="更多"
                      aria-haspopup="menu"
                      aria-expanded={rowOpen}
                      onClick={() => { setOpen(rowOpen ? null : { kind: 'row', sessionId: session.id }); }}
                    >
                      ···
                    </button>
                    {rowOpen ? (
                      /* 行内菜单是**就地展开**，不是浮层：
                         它挂在会话行里，而行的父级 `.appSidebarScroll` 是 `overflow-y: auto`
                         的滚动容器——绝对定位的浮层会被它裁剪（列表第一行与最后一行最明显）。
                         就地展开不受裁剪，也不需要 JS 去算坐标。 */
                      <div className="appNavMenu" data-menu-surface="true" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="appMenuRow"
                          onClick={() => {
                            actions.togglePinned(session.id);
                            setOpen(null);
                          }}
                        >
                          {isPinned ? '取消置顶' : '置顶'}
                          <span className="appMenuHint">{isPinned ? '移出置顶' : '固定到最前'}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Stagger>
          </Fragment>
        ))}
      </div>

      <div className="appSidebarUser">
        <span className="appSidebarAvatar" aria-hidden="true" />
        <span className="appSidebarUserName" title={username || '未登录 Bangumi'}>
          {username || '未登录'}
        </span>
        <button
          type="button"
          className="appIconButton"
          title="设置"
          aria-label="设置"
          onClick={() => { void actions.openSettings(null).catch(() => { /* 失败已提示。 */ }); }}
        >
          <GearIcon />
        </button>
      </div>
    </aside>
  );
}
