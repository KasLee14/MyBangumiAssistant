import { useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { DURATION, EASE_OUT, SHIFT } from '../motion/motionTokens';

interface ModalProps {
  title: string;
  eyebrow?: string | undefined;
  wide?: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * 居中弹窗：遮罩 + 浅色玻璃表面，形态对齐 bgm.tv 的 #TB_window
 * （15px 圆角 + 40px 标题栏 + 15px 细线 ×）。
 *
 * Esc 在捕获阶段处理并阻止冒泡，避免同时触发会话层的「停止本轮 / 拒绝确认」。
 * 点击遮罩等同于关闭（调用方把它映射成取消语义）。
 * eyebrow 与标题相同时不渲染，避免「设置 / 设置」这种重复。
 *
 * 遮罩与表面用 motion 渲染，从而获得进出过渡——`exit` 由 `DialogStage`
 * （`AnimatePresence`）驱动，因此关闭时也会先播完再卸载。
 */
export function Modal({ title, eyebrow, wide = false, onClose, children, footer }: ModalProps): ReactNode {
  const variant = useAppSelector(selectVariant);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const label = eyebrow && eyebrow !== title ? eyebrow : null;
  const content = (
    <>
      <div className="menuMaterial" />
      <header className="modalHeader">
        {label ? <span className="modalEyebrow">{label}</span> : null}
        <h2>{title}</h2>
        <button type="button" className="modalClose" onClick={onClose} aria-label="关闭" title="关闭" />
      </header>
      <div className="modalBody">{children}</div>
      {footer ? <footer className="modalFooter">{footer}</footer> : null}
    </>
  );

  return (
    <motion.div
      className="modalOverlay"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        className="modalSurface"
        data-wide={wide}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: .97, y: SHIFT.row }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: .98, y: 4 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      >
        {content}
      </motion.section>
    </motion.div>
  );
}
