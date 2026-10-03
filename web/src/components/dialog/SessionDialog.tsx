import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectSessions } from '../../store/selectors';
import { Modal } from './Modal';

/** `/sessions` 的居中选择弹窗；左侧栏的历史会话列表是同一件事的常驻入口。 */
export function SessionDialog(): ReactNode {
  const actions = useActions();
  const sessions = useAppSelector(selectSessions);
  return (
    <Modal
      title="历史会话"
      onClose={actions.closeSessions}
      footer={(
        <>
          <span className="note">左侧栏的「历史会话」也可以直接切换。</span>
          <button type="button" className="button ghost" onClick={actions.closeSessions}>关闭</button>
        </>
      )}
    >
      {sessions.length === 0 ? (
        <p className="modalHint">当前工作目录还没有历史会话。</p>
      ) : (
        <div className="pickerList">
          {sessions.map(session => (
            <button
              key={session.path}
              type="button"
              className={`pickerRow${session.current ? ' selected' : ''}`}
              title={session.path}
              onClick={() => actions.pickSession(session)}
            >
              <span className="title">{session.name || session.id}</span>
              <span className="meta">{session.current ? '当前' : `${session.messageCount} 条 · ${session.modified}`}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
