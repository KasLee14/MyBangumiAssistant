import { useState, type ReactNode } from 'react';
import { logout } from '../api';
import { Modal } from './Modal';

interface BangumiLogoutDialogProps {
  /** 已登录的用户名；为空时只显示通用说明。 */
  username: string;
  onClose(): void;
  onNotice(message: string): void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/**
 * 退出登录的确认弹窗。
 *
 * 与 `/bangumi-logout` 命令等价，但不经过会话输入：确认后直接调用宿主接口清除
 * 本应用保存的会话，会话流里不会出现命令回显。
 */
export function BangumiLogoutDialog({ username, onClose, onNotice }: BangumiLogoutDialogProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await logout();
      onNotice('已退出 Bangumi 登录。');
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="设置"
      title="退出登录"
      onClose={onClose}
      footer={(
        <>
          <span className="note">只清除本应用保存的会话。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>
            退出登录
          </button>
        </>
      )}
    >
      <p className="modalHint">
        将清除本应用保存的 Bangumi 登录会话{username ? `（${username}）` : ''}，不影响 Bangumi 网站上的登录状态。
      </p>
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
