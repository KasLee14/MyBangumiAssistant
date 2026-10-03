import { useState, type ReactNode } from 'react';
import type { ModelOptionView } from '../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectModels } from '../../store/selectors';
import { Modal } from './Modal';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/** 下拉里用 `provider\u0000model` 作为值：模型 ID 本身可能含斜杠，不能靠拆字符串还原。 */
const keyOf = (model: ModelOptionView): string => `${model.provider}\u0000${model.model}`;

/**
 * 「模型选择」弹窗：单个模型下拉，直接切换当前生效的模型。
 *
 * 与「模型配置」分开：只有当宿主报告了可用模型（即某个提供方的凭据已配置）时，
 * 设置行才允许进入这里，因此打开时下拉里一定有数据。切换会同时写成本机默认模型。
 */
export function ModelPickerDialog(): ReactNode {
  const actions = useActions();
  const models = useAppSelector(selectModels);
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
      await actions.pickModel(provider, model);
      actions.closePane();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="模型选择"
      onClose={actions.closePane}
      footer={(
        <>
          <span className="note">选择会保存为本机默认模型；恢复旧会话时以会话内的记录为准。</span>
          <button type="button" className="button ghost" disabled={busy} onClick={actions.closePane}>取消</button>
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
