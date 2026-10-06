import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThinkingLevelName } from '../../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../../store/hooks';

/**
 * 输入卡右侧的思考强度入口：常驻标签显示当前级别，点开就地选择。
 *
 * 级别清单完全来自宿主（Pi 的模型能力决定，随状态帧下发），这里不维护副本；切换与
 * 模型切换不同，会写成本机 Pi 的默认思考强度，因此标签的 title 与菜单底部都明确
 * 写出这一点。
 *
 * 未选择模型、或当前模型不支持思考时整体置灰：点了也没有可选值，不如直接说明原因。
 * 菜单锚在标签上方，Esc 在捕获阶段拦下，避免顺带触发会话层的「停止本轮 / 拒绝确认」。
 */
export function ThinkingPicker(): ReactNode {
  const actions = useActions();
  const thinking = useAppSelector(state => state.stream.thinking);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (anchor.current && event.target instanceof Node && !anchor.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // 切换模型或会话后可用级别会变：菜单开着也要收起，免得停在一个已经不存在的级别上。
  useEffect(() => { setOpen(false); }, [thinking.current, thinking.supported]);

  const pick = async (level: ThinkingLevelName, label: string): Promise<void> => {
    setBusy(true);
    try {
      // 成功与失败都由动作层给出提示；这里失败不抛出，避免留下未接管的 rejection。
      await actions.pickThinkingLevel(level, label);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const noModel = thinking.available.length === 0;
  const unsupported = !noModel && !thinking.supported;
  const text = noModel ? '思考' : unsupported ? '思考 · 不支持' : `思考 · ${thinking.currentLabel || '未设置'}`;
  const title = noModel
    ? '尚未选择模型，无法设置思考强度'
    : unsupported
      ? '当前模型不支持思考'
      : `思考强度：${thinking.currentLabel}（${thinking.current}）；点选会保存为本机默认`;

  return (
    <div className="thinkingAnchor" ref={anchor}>
      <button
        type="button"
        className="thinkingTrigger"
        disabled={noModel || unsupported || busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(value => !value)}
      >
        {text}
      </button>
      {open ? (
        <div className="appGlass thinkingMenu" role="listbox" aria-label="思考强度">
          <div className="menuMaterial" />
          <div className="menuViewport">
            <div className="menuLabel">思考强度</div>
            {thinking.available.map(option => (
              <button
                key={option.level}
                type="button"
                role="option"
                aria-selected={option.level === thinking.current}
                className={`menuItem${option.level === thinking.current ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void pick(option.level, option.label)}
              >
                <span>{option.label}</span>
                <span className="hint">{option.level}</span>
              </button>
            ))}
            <div className="menuSeparator" />
            <div className="menuLabel">选择会保存为本机默认，重启后保留</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
