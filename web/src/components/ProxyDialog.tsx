import { useState, type ReactNode } from 'react';
import type { ProxyPayload } from '../../../bangumi/src/web/protocol';
import { submitProxy } from '../api';
import { Modal } from './Modal';

interface ProxyDialogProps {
  /** 当前选中的配置项，用于回显。 */
  currentMode: ProxyPayload['mode'];
  /** 当前生效的代理地址；直连时为空字符串。 */
  currentAddress: string;
  onClose(): void;
  onNotice(message: string): void;
}

const MODES: { value: ProxyPayload['mode']; label: string }[] = [
  { value: 'auto', label: '自动发现' },
  { value: 'direct', label: '直连' },
  { value: 'manual', label: '手动指定' },
];

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/**
 * 网络线路弹窗：只保留「配置项 + 代理地址」两件事。
 *
 * 与模型密钥同一套语义：改动只影响本次运行，进程重启后回到启动时的线路，
 * 因此这里不提供「保存到本机」。切换会立刻作用于模型请求、Bangumi 工具
 * 请求（宿主会重启本地 MCP 子进程）与之后的登录请求。
 */
export function ProxyDialog({ currentMode, currentAddress, onClose, onNotice }: ProxyDialogProps): ReactNode {
  const [mode, setMode] = useState<ProxyPayload['mode']>(currentMode);
  const [url, setUrl] = useState(currentAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const address = url.trim();
    if (mode === 'manual' && address === '') return;
    setBusy(true);
    setError(null);
    try {
      await submitProxy(mode, mode === 'manual' ? address : undefined);
      onNotice('网络线路已切换，仅本次运行生效。');
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
      title="网络线路"
      onClose={onClose}
      footer={(
        <>
          <span className="note">只影响本次运行，不写入磁盘。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="button primary"
            disabled={busy || (mode === 'manual' && url.trim() === '')}
            onClick={() => void submit()}
          >
            应用
          </button>
        </>
      )}
    >
      <div className="modalChoiceRow">
        {MODES.map(option => (
          <label key={option.value} className="modalCheck">
            <input
              type="radio"
              name="proxy-mode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => { setMode(option.value); setError(null); }}
            />
            {option.label}
          </label>
        ))}
      </div>

      <div className="modalField">
        <label htmlFor="proxy-url">代理地址</label>
        <input
          id="proxy-url"
          name="proxy-url"
          className="modalInput"
          type="text"
          value={url}
          disabled={mode !== 'manual'}
          autoComplete="off"
          spellCheck={false}
          placeholder="http://127.0.0.1:7890"
          onChange={event => setUrl(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }}
        />
      </div>

      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
