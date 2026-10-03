import { useState, type ReactNode } from 'react';
import type { ProviderOptionView } from '../../../bangumi/src/web/protocol';
import { submitCredential } from '../api';
import { AUTH_LABEL } from './credentialLabel';
import { Modal } from './Modal';

interface ModelDialogProps {
  /** 可填入密钥的提供方，附带当前凭据来源。 */
  providers: ProviderOptionView[];
  /** 默认选中的提供方（设置行里回显的那一个）。 */
  initialProvider: string;
  onClose(): void;
  /** 应用成功后把提供方回报给设置行，让行内状态立刻更新。 */
  onApplied(provider: string): void;
  onNotice(message: string): void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/**
 * 「模型配置」弹窗：只负责为某个提供方填入 API Key。
 *
 * 与「模型选择」拆成两个独立动作：这里不切换模型（宿主只在填完密钥、且当前模型
 * 不可用时才会兜底切到第一个可用模型）。密钥只注入宿主本次运行的运行时凭据：
 * 刻意不提供「保存到本机」，密钥不进 localStorage、不回显，也不写任何文件，
 * 进程重启后需要重新填写。
 */
export function ModelDialog({
  providers, initialProvider, onClose, onApplied, onNotice,
}: ModelDialogProps): ReactNode {
  const [provider, setProvider] = useState(() => initialProvider || providers[0]?.id || '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedKey = key.trim();
  const canSubmit = !busy && provider !== '' && trimmedKey !== '';

  const apply = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await submitCredential(provider, trimmedKey);
      setKey('');
      onNotice(`已为 ${provider} 填入密钥；密钥只用于本次运行。`);
      onApplied(provider);
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="模型配置"
      onClose={onClose}
      footer={(
        <>
          <span className="note">密钥只用于本次运行，不会写入磁盘。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button>
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
          {error ? <p className="modalError">{error}</p> : null}
        </>
      )}
    </Modal>
  );
}
