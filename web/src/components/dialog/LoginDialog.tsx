import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LoginInputPayload } from '../../../../bangumi/src/web/protocol';
import { useActions } from '../../store/hooks';
import { Modal } from './Modal';

/**
 * `/bangumi-login` 命令路径的凭据弹窗：邮箱与密码在同一个弹窗里一次提交。
 *
 * 输入只发往本机宿主（宿主再经 HTTPS 直发 Bangumi），不进聊天记录、不进模型；
 * 取消发 `{ id, cancelled: true }`，与终端里的 Esc 一致。`prompt.id` 变化即代表换了
 * 一次登录请求。
 */
export function LoginDialog({ prompt }: { prompt: { id: number } }): ReactNode {
  const actions = useActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 换一次登录请求就清空输入，避免上一次的凭据留在框里。
  useEffect(() => { setEmail(''); setPassword(''); setError(null); }, [prompt.id]);

  const send = (body: LoginInputPayload, done: string): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void actions.answerLoginInput(body, done)
      .then(() => { setEmail(''); setPassword(''); })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : '请求失败。'))
      .finally(() => setBusy(false));
  };

  const submit = (): void => {
    if (!email.trim() || !password) return;
    send({ id: prompt.id, email: email.trim(), password }, '登录凭据已提交。');
  };
  const cancel = (): void => { send({ id: prompt.id, cancelled: true }, '已取消登录输入。'); };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
  };

  return (
    <Modal
      eyebrow="Bangumi 登录"
      title="输入邮箱与密码"
      onClose={cancel}
      footer={(
        <>
          <span className="note">登录输入不进入聊天记录或模型。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={cancel}>取消</button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !email.trim() || !password}
            onClick={submit}
          >
            提交
          </button>
        </>
      )}
    >
      <div className="modalField">
        <label htmlFor="login-email">邮箱</label>
        <input
          id="login-email"
          className="modalInput"
          type="email"
          value={email}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="name@example.com"
          onChange={event => setEmail(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="modalField">
        <label htmlFor="login-password">密码</label>
        <input
          id="login-password"
          className="modalInput"
          type="password"
          value={password}
          autoComplete="off"
          spellCheck={false}
          placeholder="密码不会显示或保存"
          onChange={event => setPassword(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className="modalHint">提交后宿主会打开默认浏览器完成人机验证，通过后才会向 Bangumi 提交凭据。</p>
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
