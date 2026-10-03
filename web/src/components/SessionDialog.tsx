import type { ReactNode } from 'react';
import type { SessionOptionView } from '../../../bangumi/src/web/protocol';
import { Modal } from './Modal';

interface SessionDialogProps {
  sessions: SessionOptionView[];
  onPick(session: SessionOptionView): void;
  onClose(): void;
}

/** `/sessions` 的居中选择弹窗；左侧栏的历史会话列表是同一件事的常驻入口。 */
export function SessionDialog({ sessions, onPick, onClose }: SessionDialogProps): ReactNode {
  return (
    <Modal
      title="历史会话"
      onClose={onClose}
      footer={(
        <>
          <span className="note">左侧栏的「历史会话」也可以直接切换。</span>
          <button type="button" className="button ghost" onClick={onClose}>关闭</button>
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
              onClick={() => onPick(session)}
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
