import { useState, type ReactNode } from 'react';
import type { ModelOptionView } from '../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectModels } from '../../store/selectors';
import { Modal } from './Modal';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/** 下拉里用 `provider\u0000model` 作为值：模型 ID 本身可能含斜杠，不能靠拆字符串还原。 */
const keyOf = (model: ModelOptionView): string => `${model.provider}\u0000${model.model}`;

/**
 * 「模型选择」弹窗：从宿主报告的可用模型里挑一个，确认后切换当前生效的模型。
 *
 * 与「模型配置」分开：只有当宿主报告了可用模型（即某个提供方的凭据已配置）时，
 * 设置行才允许进入这里，因此打开时列表里一定有数据。切换会同时写成本机默认模型。
 *
 * 列表是**整行可点**的按钮：选中只改本地状态，真正的切换由底部的「使用」提交，
 * 于是「看一下别的模型再取消」不会留下副作用。
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
  // 副标题里的「当前 …」取列表里标了 `current` 的那一项，好让副标题与行上的勾同源。
  const currentModel = models.find(candidate => candidate.current)?.model ?? '';
  const subtitle = currentModel === ''
    ? '选择会保存为本机默认。'
    : `当前 ${currentModel}；选择会保存为本机默认。`;

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
      eyebrow={subtitle}
      onClose={actions.closePane}
      /* 两个动作交给 `Modal` 放进 `.dlgActions`：它的 space-between 就是样张里的
         「取消靠左、主按钮靠右」，不需要再包一层。 */
      footer={(
        <>
          <button type="button" className="dlgBtn dlgBtnGhost" disabled={busy} onClick={actions.closePane}>取消</button>
          <button type="button" className="dlgBtn dlgBtnPrimary" disabled={!canSubmit} onClick={() => void apply()}>
            使用
          </button>
        </>
      )}
    >
      {models.length === 0 ? (
        <p className="dlgHint">宿主没有报告可用模型，请先在「模型配置」里填入提供方密钥。</p>
      ) : (
        <div className="dlgList" role="listbox" aria-label="可用模型">
          {models.map(candidate => {
            const candidateKey = keyOf(candidate);
            return (
              <button
                key={candidateKey}
                type="button"
                role="option"
                className="dlgRow"
                // 选中态只走 `aria-selected`：描边与淡底由 CSS 按这个属性画，不再另加类名。
                aria-selected={candidateKey === selected}
                onClick={() => { setSelected(candidateKey); setError(null); }}
              >
                <span className="dlgRowMain">{candidate.model}</span>
                {/* 勾只表达「本次要切换过去的那一个」，所以「当前生效」另写一份——
                    选别的模型后这个信息就没地方看了（与侧栏行尾写「当前」同一套做法）。 */}
                <span className="dlgRowMeta">
                  {candidate.current ? `${candidate.provider} · 当前` : candidate.provider}
                </span>
                {candidateKey === selected ? <span className="dlgRowMark" aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      )}
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
