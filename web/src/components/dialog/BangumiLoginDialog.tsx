import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import { Modal } from './Modal';

/**
 * 设置弹窗里的登录弹窗：邮箱与密码一次提交，进度留在弹窗内。
 *
 * 与 `/bangumi-login` 命令路径的区别是不经过会话输入，因此会话流里不会出现命令
 * 回显与宿主提示。人机验证仍在系统默认浏览器里完成，这里只显示进度（由状态帧
 * 下发 `loginBusy` / `loginStatus`）；关掉弹窗会中止宿主侧还在跑的登录。
 */
export function BangumiLoginDialog(): ReactNode {
  const actions = useActions();
  const busy = useAppSelector(state => state.stream.loginBusy);
  const status = useAppSelector(state => state.stream.loginStatus);
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
      await actions.startBangumiLogin(email.trim(), password);
      if (!alive.current) return;
      actions.closePane();
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
    if (pending) actions.cancelBangumiLogin();
    actions.closePane();
  };

  return (
    <Modal
      /* 新骨架下 `eyebrow` 是**标题下方的副标题**（`.dlgSub`），不再是旧骨架的分组名——
         原先传的「设置」会显示成「Bangumi 登录 / 设置」。这里换成 C23 定稿的副标题
         （样张 `demo.js:1963`）。 */
      eyebrow="人机验证在默认浏览器里完成，这里只显示进度。"
      title="Bangumi 登录"
      onClose={close}
      footer={pending ? (
        /* 单个次要按钮：`.dlgActions` 默认两端对齐，只有一个子元素时会贴左；
           这里再加上它的「靠右」变体。**必须同时带 `.dlgActions`**——`.dlgActionsEnd`
           只声明 `justify-content`，自身没有 `display: flex`，单独用时作为 flex 子项
           宽度只有内容宽，仍然贴左。 */
        <div className="dlgActions dlgActionsEnd">
          <button type="button" className="dlgBtn dlgBtnGhost" onClick={close}>取消</button>
        </div>
      ) : (
        <>
          <button type="button" className="dlgBtn dlgBtnGhost" onClick={close}>取消</button>
          <button type="button" className="dlgBtn dlgBtnPrimary" disabled={!canSubmit} onClick={() => void submit()}>
            登录
          </button>
        </>
      )}
    >
      {pending ? (
        <div className="dlgStatus" data-configured>
          <span className="dlgDot" />
          {status || '正在登录…'}
        </div>
      ) : (
        <>
          {/* 字段区包一层：`.dlgPane` 的 gap 是块与块之间的距离（18px），
              字段之间按定稿是 14px，得靠这个容器给。 */}
          <div className="dlgFields">
            <div className="dlgField">
              <label htmlFor="bangumi-email">邮箱</label>
              <input
                id="bangumi-email"
                className="dlgInput"
                type="email"
                value={email}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="name@example.com"
                onChange={event => setEmail(event.target.value)}
              />
            </div>
            <div className="dlgField">
              <label htmlFor="bangumi-password">密码</label>
              <input
                id="bangumi-password"
                className="dlgInput"
                type="password"
                value={password}
                autoComplete="off"
                spellCheck={false}
                placeholder="密码不会显示或保存"
                onChange={event => setPassword(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }}
              />
            </div>
          </div>
          {/* 原先这句占着底部一栏（`.note`）。新骨架的底部只放按钮，说明文字归字段下方。 */}
          <p className="dlgHint">凭据不经聊天、模型或会话条目。</p>
          {error ? <p className="modalError">{error}</p> : null}
        </>
      )}
    </Modal>
  );
}
