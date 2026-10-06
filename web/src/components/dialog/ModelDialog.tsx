import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProviderOptionView } from '../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../store/hooks';
import { selectCanPersistCredentials, selectCredentialProvider, selectProviders } from '../../store/selectors';
import { AUTH_LABEL } from '../../utils/credentialLabel';
import { Modal } from './Modal';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

/** 触发器与选项共用同一份措辞：提供方 · 凭据来源 · 模型数量。 */
const providerText = (provider: ProviderOptionView): string =>
  `${provider.label} · ${AUTH_LABEL[provider.authSource]} · ${provider.modelCount} 个模型`;

/** 副标题的后半句：按凭据来源换说法，拼在提供方名之后；`stored` 那一档照样张定稿。 */
const AUTH_SUBTITLE: Record<ProviderOptionView['authSource'], string> = {
  stored: '已有保存在本机的密钥；重新填入会覆盖它。',
  runtime: '本次运行已填入密钥；重新填入会覆盖它。',
  environment: '的密钥来自环境变量；填入后会优先用这一份。',
  none: '还没有配置密钥；填入后会立刻更新可用模型。',
};

interface ProviderComboProps {
  providers: ProviderOptionView[];
  value: string;
  /** 「提供方」这个可见标签的 id：触发器用它命名，标签本身仍由调用点渲染在 `.dlgField` 里。 */
  labelId: string;
  onChange(id: string): void;
}

/**
 * 提供方自绘下拉（`.dlgCombo`）。
 *
 * 原生 `<select>` 的弹出面板由系统绘制，套不上 `.dlg*` 的描边、圆角与选中色，所以改成
 * 触发器 + `role="listbox"`。选项用真实的 `<button>`、方向键把**焦点**移过去（而不是只画
 * 一个高亮）：Enter 自带的激活语义就够用，也省掉一份 `aria-activedescendant` 状态。
 *
 * Esc 的监听在**挂载时**就注册，而不是像 `ThinkingPicker` 那样等菜单打开：`Modal` 的 Esc
 * 同样挂在 window 捕获阶段，且它在自己挂载时就注册了；子组件的 effect 先于父组件执行，
 * 只有更早注册才抢得到，从而在下拉打开时先收下拉、把焦点还给触发器，而不是直接关掉整个
 * 弹窗。下拉没打开时它什么都不做，Esc 照旧关弹窗。
 */
function ProviderCombo({ providers, value, labelId, onChange }: ProviderComboProps): ReactNode {
  const [open, setOpen] = useState(false);
  // 上面那个监听只注册一次，靠 ref 读当下的开合状态，避免每次开合重注册（重注册就会排在
  // Modal 的监听之后，Esc 又会被 Modal 先吃掉）。
  const openRef = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  // 展开后焦点该落到哪个选项：收起时菜单是 `display: none`，当场 focus 不生效，只能等提交后再做。
  const pendingFocus = useRef<number | null>(null);
  const uid = useId();
  const menuId = `${uid}-menu`;
  const selectedIndex = providers.findIndex(candidate => candidate.id === value);
  const current = providers[selectedIndex];

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !openRef.current) return;
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    if (index !== null) options.current[index]?.focus();
  }, [open]);

  const openAt = (index: number): void => {
    pendingFocus.current = Math.max(0, Math.min(index, providers.length - 1));
    setOpen(true);
  };

  const pick = (id: string): void => {
    onChange(id);
    setOpen(false);
    // 选项还在 DOM 里、只是菜单被 `display: none` 藏起来，焦点得主动交回触发器。
    trigger.current?.focus();
  };

  return (
    <div className="dlgCombo" data-open={open} ref={root}>
      <button
        type="button"
        ref={trigger}
        className="dlgTrigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        /* 名字走可见标签（`aria-labelledby`）而不是另写一个 `aria-label`：
           `<label for>` 对 `<button>` 不参与可访问名计算，写在这里才是唯一来源。 */
        aria-labelledby={labelId}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          // 还没选过任何提供方时，往下从第一项开始、往上从最后一项开始。
          const fallback = event.key === 'ArrowDown' ? 0 : providers.length - 1;
          const index = selectedIndex >= 0 ? selectedIndex : fallback;
          if (open) options.current[index]?.focus();
          else openAt(index);
        }}
      >
        {current ? providerText(current) : value}
        <span className="dlgCaret" aria-hidden="true">▾</span>
      </button>
      <div className="dlgMenu" id={menuId} role="listbox" aria-labelledby={labelId}>
        {providers.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            role="option"
            className="dlgOption"
            aria-selected={candidate.id === value}
            ref={element => { options.current[index] = element; }}
            onClick={() => pick(candidate.id)}
            onKeyDown={event => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              options.current[Math.max(0, Math.min(index + step, providers.length - 1))]?.focus();
            }}
          >
            {providerText(candidate)}
            {candidate.id === value ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const providerLabelId = useId();

  const trimmedKey = key.trim();
  const canSubmit = !busy && provider !== '' && trimmedKey !== '';
  const active = providers.find(candidate => candidate.id === provider);
  // 只有凭据来自本机存储时才允许清除；环境变量与 models.json 内联密钥都不在这里删。
  const canClear = !busy && active?.authSource === 'stored';
  // 副标题是定稿的一部分：没有提供方时改说「为什么这里没法填」，其余按当前凭据来源。
  const subtitle = providers.length === 0
    ? '宿主没有报告可配置的模型提供方，无法在这里填入密钥。'
    : active === undefined
      ? '填入密钥后会立刻更新可用模型。'
      : `${active.label} ${AUTH_SUBTITLE[active.authSource]}`;

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

  const confirmActions = (
    <>
      <button type="button" className="dlgBtn dlgBtnGhost" disabled={busy} onClick={actions.closePane}>取消</button>
      <button type="button" className="dlgBtn dlgBtnPrimary" disabled={!canSubmit} onClick={() => void apply()}>
        应用
      </button>
    </>
  );

  return (
    <Modal
      title="模型配置"
      eyebrow={subtitle}
      onClose={actions.closePane}
      /* 底部两端：清除靠左，取消 / 应用靠右。这一块由 `Modal` 放进 `.dlgActions`
         （space-between）里；有清除键时两个确认动作要先捆成一个右侧组，否则它们
         会被摊到两端、把「取消」推到中间；没有清除键时就直接给两个按钮——那时
         分居两端正是样张里的样子。 */
      footer={(
        <>
          {canClear ? (
            <button type="button" className="dlgBtn dlgBtnGhost" disabled={busy} onClick={() => void clear()}>
              清除已保存的密钥
            </button>
          ) : null}
          {canClear ? <div className="dlgActions dlgActionsEnd">{confirmActions}</div> : confirmActions}
        </>
      )}
    >
      {providers.length === 0 ? (
        <ol className="modalSteps">
          <li>检查数据目录里的 <code>pi/models.json</code> 是否存在且格式正确。</li>
          <li>确认已运行项目初始化，生成并构建内置的 Pi 模型目录（<code>node bootstrap-pi.mjs</code>）。</li>
          <li>重启 <code>npm start -- web</code> 后回到这里。</li>
        </ol>
      ) : (
        <>
          <div className="dlgFields">
            <div className="dlgField">
              <label id={providerLabelId}>提供方</label>
              <ProviderCombo
                providers={providers}
                value={provider}
                labelId={providerLabelId}
                onChange={id => { setProvider(id); setError(null); }}
              />
            </div>
            <div className="dlgField">
              <label htmlFor="model-key">API Key</label>
              <input
                id="model-key"
                name="api-key"
                className="dlgInput"
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴该提供方的 API Key"
                onChange={event => { setKey(event.target.value); setError(null); }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void apply(); } }}
              />
            </div>
          </div>
          {canPersist ? (
            <label className="dlgCheck">
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
            <p className="dlgHint">
              也可以用「清除已保存的密钥」删掉本机保存的条目；环境变量与 models.json 内联密钥不受影响。
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="modalError">{error}</p> : null}
    </Modal>
  );
}
