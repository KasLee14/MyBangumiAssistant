import type { ReactNode } from 'react';
import type { ConfirmationView } from '../../../../../bangumi/src/web/protocol';

interface ConfirmationCardProps {
  confirmation: ConfirmationView;
  /**
   * 本条确认的应答请求是否在途。
   *
   * 只用来在「已点下、宿主还没返回」这一小段里禁用按钮，防止重复提交。它**不是**
   * 宿主的 `busy`：写入确认本来就发生在工具执行期间（`busy` 恒为真），拿 `busy`
   * 当禁用条件会让按钮永远点不动。
   */
  answering: boolean;
  /** 接管输入区时显示确认与取消；会话里的历史条目只显示结果。 */
  showActions: boolean;
  onConfirm(id: string): void;
  onReject(id: string): void;
}

/* 状态标签由宿主给出的 state 决定；文案是浏览器侧的呈现，不参与判定。 */
const STATE_LABEL: Record<ConfirmationView['state'], string> = {
  pending: '待确认',
  accepted: '已确认',
  rejected: '已拒绝',
  expired: '已过期',
};

/**
 * 写入预览确认卡。
 *
 * preview 是宿主生成的完整预览文本：按等宽、保留换行地整体呈现，
 * 浏览器不做截断也不改写内容，只有 pending 才给动作按钮。
 *
 * 按钮的禁用只跟 `answering`（本条应答在途）有关，与「本轮是否进行中」无关：
 * 确认本来就是在一轮的中途发生的，用 `busy` 会让按钮恒为禁用。
 */
export function ConfirmationCard({ confirmation, answering, showActions, onConfirm, onReject }: ConfirmationCardProps): ReactNode {
  const pending = confirmation.state === 'pending';
  const actions = showActions && pending;
  return (
    <section className="planCard" data-state={confirmation.state} aria-label="写入确认">
      <header className="planStrip">
        <span>{STATE_LABEL[confirmation.state]}</span>
        <span className="spacer">{confirmation.title}</span>
      </header>
      <div className="planBody">
        <pre className="previewText">{confirmation.preview}</pre>
        {confirmation.hint ? <p className="planNote">{confirmation.hint}</p> : null}
        {pending && !showActions ? <p className="planNote">可以在输入区确认或取消这次修改。</p> : null}
      </div>
      {actions ? (
        <div className="planActions">
          <button type="button" className="button outline reject" disabled={answering} onClick={() => onReject(confirmation.id)}>取消</button>
          <button type="button" className="button primary" disabled={answering} onClick={() => onConfirm(confirmation.id)}>{confirmation.confirmLabel ?? '确认修改'}</button>
        </div>
      ) : null}
    </section>
  );
}
