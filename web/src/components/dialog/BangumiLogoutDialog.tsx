import { useState, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import { Modal } from './Modal';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/**
 * 退出登录的确认弹窗。
 *
 * 与 `/bangumi-logout` 命令等价，但不经过会话输入：确认后直接调用宿主接口清除
 * 本应用保存的会话，会话流里不会出现命令回显。
 */
export function BangumiLogoutDialog(): ReactNode {
  const actions = useActions();
  const username = useAppSelector(state => state.stream.loginUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 影响范围与「不影响 Bangumi 网站」写在标题下方：确认型弹窗没有字段，
  // 这句话决定用户敢不敢点，所以它是副标题而不是底部的一行小字。
  const scope = `将清除本应用保存的 Bangumi 登录会话${username ? `（${username}）` : ''}，不影响 Bangumi 网站上的登录状态。`;

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await actions.bangumiLogout();
      actions.closePane();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow={scope}
      title="退出登录"
      onClose={actions.closePane}
      footer={(
        <>
          <button type="button" className="dlgBtn dlgBtnGhost" disabled={busy} onClick={actions.closePane}>取消</button>
          <button type="button" className="dlgBtn dlgBtnPrimary" disabled={busy} onClick={() => void submit()}>
            退出登录
          </button>
        </>
      )}
    >
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
