import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cancelLogin, startLogin } from '../api';
import { Modal } from './Modal';

interface BangumiLoginDialogProps {
  /** 宿主是否正在登录；进度由状态帧下发。 */
  busy: boolean;
  /** 宿主下发的登录进度文本。 */
  status: string;
  onClose(): void;
  onNotice(message: string): void;
}

/**
 * 设置弹窗里的登录弹窗：邮箱与密码一次提交，进度留在弹窗内。
 *
 * 与 `/bangumi-login` 命令路径的区别是不经过会话输入，因此会话流里不会出现命令
 * 回显与宿主提示。人机验证仍在系统默认浏览器里完成，这里只显示进度；关掉弹窗会
 * 中止宿主侧还在跑的登录。
 */
export function BangumiLoginDialog({ busy, status, onClose, onNotice }: BangumiLoginDialogProps): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const pending = submitting || busy;
  const canSubmit = !pending && email.trim() !== '' && password !== '';

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await startLogin(email.trim(), password);
      if (!alive.current) return;
      onNotice('Bangumi 登录成功。');
      onClose();
    } catch (failure) {
      if (!alive.current) return;
      // 失败时保留邮箱、清空密码，改一下密码就能直接重试。
      setPassword('');
      setError(failure instanceof Error ? failure.message : '登录失败。');
    } finally {
      if (alive.current) setSubmitting(false);
    }
  };

  const close = (): void => {
    // 关掉弹窗就中止宿主侧还在跑的登录，避免留下挂起的请求。
    if (pending) void cancelLogin().catch(() => { /* 已经结束的登录不必再取消。 */ });
    onClose();
  };

  return (
    <Modal
      eyebrow="设置"
      title="Bangumi 登录"
      onClose={close}
      footer={pending ? (
        <>
          <span className="note">人机验证在默认浏览器里完成。</span>
          <button type="button" className="button ghost" onClick={close}>取消</button>
        </>
      ) : (
        <>
          <span className="note">凭据不经聊天、模型或会话条目。</span>
          <button type="button" className="button ghost" onClick={close}>取消</button>
          <button type="button" className="button primary" disabled={!canSubmit} onClick={() => void submit()}>
            登录
          </button>
        </>
      )}
    >
      {pending ? (
        <div className="modalStatus" data-configured>
          <span className="dot" />
          {status || '正在登录…'}
        </div>
      ) : (
        <>
          <div className="modalField">
            <label htmlFor="bangumi-email">邮箱</label>
            <input
              id="bangumi-email"
              className="modalInput"
              type="email"
              value={email}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="name@example.com"
              onChange={event => setEmail(event.target.value)}
            />
          </div>
          <div className="modalField">
            <label htmlFor="bangumi-password">密码</label>
            <input
              id="bangumi-password"
              className="modalInput"
              type="password"
              value={password}
              autoComplete="off"
              spellCheck={false}
              placeholder="密码不会显示或保存"
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }}
            />
          </div>
          {error ? <p className="modalError">{error}</p> : null}
        </>
      )}
    </Modal>
  );
}
