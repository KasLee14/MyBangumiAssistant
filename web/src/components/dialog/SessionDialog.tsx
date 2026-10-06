import { useState, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectSessions } from '../../store/selectors';
import { relativeTimeLabel } from '../../utils/relativeTime';
import { Modal } from './Modal';

/**
 * `/sessions` 的居中选择弹窗；左侧栏的历史会话列表是同一件事的常驻入口。
 *
 * 底部的「切换」才是提交点：点行只改本地选中，于是「翻了一遍又不想切」可以直接取消，
 * 也不会在列表上误点一下就换掉当前会话（恢复会话是有代价的动作）。
 *
 * `leaving` / `onExited` 来自浮层挂载点（见 `overlays/DialogStage.tsx`）：关闭后它还要在
 * DOM 里留到退场动画播完。
 */
export function SessionDialog({ leaving, onExited }: { leaving: boolean; onExited(): void }): ReactNode {
  const actions = useActions();
  const sessions = useAppSelector(selectSessions);
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const [selected, setSelected] = useState(sessionId);
  // 与侧栏同一套措辞与同一时刻：换入口不换文案。
  const now = Date.now();
  const chosen = sessions.find(session => session.id === selected);

  const switchTo = (): void => {
    // `pickSession` 自己会关掉弹窗并接住恢复失败，这里不做额外等待。
    if (chosen) actions.pickSession(chosen);
  };

  return (
    <Modal
      title="历史会话"
      eyebrow="切换后当前会话的草稿会保留。"
      onClose={actions.closeSessions}
      leaving={leaving}
      onExited={onExited}
      footer={(
        <>
          <button type="button" className="dlgBtn dlgBtnGhost" onClick={actions.closeSessions}>取消</button>
          <button type="button" className="dlgBtn dlgBtnPrimary" disabled={!chosen} onClick={switchTo}>切换</button>
        </>
      )}
    >
      {sessions.length === 0 ? (
        <p className="dlgHint">当前工作目录还没有历史会话。</p>
      ) : (
        <div className="dlgList" role="listbox" aria-label="会话">
          {sessions.map(session => (
            <button
              key={session.id}
              type="button"
              role="option"
              className="dlgRow"
              // 选中态只走 `aria-selected`：描边与淡底由 CSS 按这个属性画，不再另加类名。
              aria-selected={session.id === selected}
              title={session.name || '新会话'}
              onClick={() => setSelected(session.id)}
            >
              <span className="dlgRowMain">{session.name || '新会话'}</span>
              <span className="dlgRowMeta">
                {session.awaitingConfirmation ? '待确认' : session.awaitingLogin ? '待登录'
                  : session.busy ? '运行中' : session.id === sessionId ? '当前' : relativeTimeLabel(session.modified, now)}
              </span>
              {session.id === selected ? <span className="dlgRowMark" aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
