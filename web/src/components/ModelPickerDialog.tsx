import { useState, type ReactNode } from 'react';
import type { ModelOptionView } from '../../../bangumi/src/web/protocol';
import { selectModel } from '../api';
import { Modal } from './Modal';

interface ModelPickerDialogProps {
  /** 可用模型；为空时调用方不会打开这个弹窗。 */
  models: ModelOptionView[];
  onClose(): void;
  onNotice(message: string): void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/** 下拉里用 `provider\u0000model` 作为值：模型 ID 本身可能含斜杠，不能靠拆字符串还原。 */
const keyOf = (model: ModelOptionView): string => `${model.provider}\u0000${model.model}`;

/**
 * 「模型选择」弹窗：单个模型下拉，直接切换当前生效的模型。
 *
 * 与「模型配置」分开：只有当宿主报告了可用模型（即某个提供方的凭据已配置）时，
 * 设置行才允许进入这里，因此打开时下拉里一定有数据。
 */
export function ModelPickerDialog({ models, onClose, onNotice }: ModelPickerDialogProps): ReactNode {
  const [selected, setSelected] = useState(() => {
    const active = models.find(model => model.current) ?? models[0];
    return active ? keyOf(active) : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider = '', model = ''] = selected.split('\u0000');
  const canSubmit = !busy && provider !== '' && model !== '';

  const apply = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await selectModel(provider, model);
      onNotice(`已切换到 ${provider}/${model}。`);
      onClose();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="模型选择"
      onClose={onClose}
      footer={(
        <>
          <span className="note">切换只影响本次运行，不写入磁盘。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="button primary" disabled={!canSubmit} onClick={() => void apply()}>
            应用
          </button>
        </>
      )}
    >
      {models.length === 0 ? (
        <p className="modalHint">宿主没有报告可用模型，请先在「模型配置」里填入提供方密钥。</p>
      ) : (
        <div className="modalField">
          <label htmlFor="model-pick">模型</label>
          <select
            id="model-pick"
            name="model"
            className="modalInput"
            value={selected}
            onChange={event => { setSelected(event.target.value); setError(null); }}
          >
            {models.map(candidate => (
              <option key={keyOf(candidate)} value={keyOf(candidate)}>
                {candidate.label}{candidate.current ? '（当前）' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
