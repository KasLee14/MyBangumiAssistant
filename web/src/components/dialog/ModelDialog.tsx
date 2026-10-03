import { useState, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectCanPersistCredentials, selectCredentialProvider, selectProviders } from '../../store/selectors';
import { AUTH_LABEL } from '../../utils/credentialLabel';
import { Modal } from './Modal';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/**
 * 「模型配置」弹窗：为某个提供方填入或清除 API Key。
 *
 * 与「模型选择」拆成两个独立动作：这里不切换模型（宿主只在填完密钥、且当前模型
 * 不可用时才会兜底切到第一个可用模型）。保存方式由「保存到本机」决定：
 *
 * - 勾选（默认）：密钥写入本机 Pi 凭据存储 `auth.json`，重启后仍然生效；
 * - 取消勾选：只注入宿主本次运行的运行时凭据，进程重启后需要重新填写。
 *
 * 两种方式都不回显密钥。已经保存在本机的提供方可以在这里清除，清除只删 `auth.json`
 * 里的条目，环境变量与 `models.json` 内联密钥不受影响。
 */
export function ModelDialog(): ReactNode {
  const actions = useActions();
  const providers = useAppSelector(selectProviders);
  const canPersist = useAppSelector(selectCanPersistCredentials);
  const initialProvider = useAppSelector(selectCredentialProvider);

  const [provider, setProvider] = useState(() => initialProvider || providers[0]?.id || '');
  const [key, setKey] = useState('');
  // 默认保存到本机：这是「重启后不用重填」的默认路径，取消勾选即退回仅本次运行。
  const [persist, setPersist] = useState(canPersist);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedKey = key.trim();
  const canSubmit = !busy && provider !== '' && trimmedKey !== '';
  const active = providers.find(candidate => candidate.id === provider);
  // 只有凭据来自本机存储时才允许清除；环境变量与 models.json 内联密钥都不在这里删。
  const canClear = !busy && active?.authSource === 'stored';

  const apply = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await actions.applyCredential(provider, trimmedKey, persist);
      setKey('');
      // 密钥生效后可用模型与凭据来源都会变，重取目录让设置行的值立刻更新。
      await actions.loadCatalog().catch(() => { /* 行内值可能略旧。 */ });
      actions.closePane();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!canClear) return;
    setBusy(true);
    setError(null);
    try {
      await actions.clearCredential(provider);
      await actions.loadCatalog().catch(() => { /* 同上。 */ });
      actions.closePane();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="模型配置"
      onClose={actions.closePane}
      footer={(
        <>
          <span className="note">
            {persist && canPersist
              ? '密钥将写入本机 Pi 凭据存储，重启后仍然生效。'
              : '密钥只用于本次运行，不会写入磁盘。'}
          </span>
          {canClear ? (
            <button type="button" className="button ghost" disabled={busy} onClick={() => void clear()}>
              清除已保存的密钥
            </button>
          ) : null}
          <button type="button" className="button ghost" disabled={busy} onClick={actions.closePane}>取消</button>
          <button type="button" className="button primary" disabled={!canSubmit} onClick={() => void apply()}>
            应用
          </button>
        </>
      )}
    >
      {providers.length === 0 ? (
        <>
          <p className="modalHint">宿主没有报告任何可配置的模型提供方，无法在这里填入密钥。</p>
          <ol className="modalSteps">
            <li>检查数据目录里的 <code>pi/models.json</code> 是否存在且格式正确。</li>
            <li>确认 Pi 的模型目录已随项目初始化下载（<code>node bootstrap-pi.mjs</code>）。</li>
            <li>重启 <code>npm start -- web</code> 后回到这里。</li>
          </ol>
        </>
      ) : (
        <>
          <div className="modalField">
            <label htmlFor="model-provider">提供方</label>
            <select
              id="model-provider"
              name="provider"
              className="modalInput"
              value={provider}
              onChange={event => { setProvider(event.target.value); setError(null); }}
            >
              {providers.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label} · {AUTH_LABEL[candidate.authSource]} · {candidate.modelCount} 个模型
                </option>
              ))}
            </select>
          </div>
          <div className="modalField">
            <label htmlFor="model-key">API Key</label>
            <input
              id="model-key"
              name="api-key"
              className="modalInput"
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder="粘贴该提供方的 API Key"
              onChange={event => { setKey(event.target.value); setError(null); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void apply(); } }}
            />
          </div>
          {canPersist ? (
            <label className="modalCheck">
              <input
                type="checkbox"
                name="persist-credential"
                checked={persist}
                onChange={event => { setPersist(event.target.checked); setError(null); }}
              />
              保存到本机（重启后仍生效）
            </label>
          ) : null}
          {active?.authSource === 'stored' ? (
            <p className="modalHint">
              该提供方已有保存在本机的密钥：重新填入会覆盖它，也可以用「清除已保存的密钥」删除。
            </p>
          ) : null}
          {error ? <p className="modalError">{error}</p> : null}
        </>
      )}
    </Modal>
  );
}
