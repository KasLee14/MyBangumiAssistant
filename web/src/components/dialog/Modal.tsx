import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';

/**
 * 弹窗的「留场」信息：正在退场吗、退场播完了没。
 *
 * 为什么要一个 Context：`SettingsDialog` 会把内容交给五个子面板（`.dlg*` 那一套），
 * 每个子面板自己渲染一个 `Modal`。设置弹窗退场时，**这五个里当下渲染的那个**才需要
 * 播退场动画，而它是 `SettingsDialog` 运行时才决定的——逐层透传要改 5 个文件，
 * 用一个 context 就只改各自的 `Modal`。
 */
interface DialogPresence {
  leaving: boolean;
  onExited(): void;
}

const PRESENCE_IDLE: DialogPresence = { leaving: false, onExited: () => {} };
const DialogPresenceContext = createContext<DialogPresence>(PRESENCE_IDLE);

/** 设置弹窗用它把「留场」信息发给当时代渲染的那个子面板。 */
export function DialogPresenceProvider({ leaving, onExited, children }: { leaving: boolean; onExited(): void; children: ReactNode }): ReactNode {
  const memo = useMemo(() => ({ leaving, onExited }), [leaving, onExited]);
  return <DialogPresenceContext.Provider value={memo}>{children}</DialogPresenceContext.Provider>;
}

/**
 * 供 `Modal` 的调用点取用：显式 props 优先（`DialogStage` 直接挂载的那几个走这条路），
 * 没有就落回 `SettingsDialog` 发下来的 context。
 */
export function useDialogPresence(): DialogPresence {
  return useContext(DialogPresenceContext);
}

interface ModalProps {
  title: string;
  eyebrow?: string | undefined;
  wide?: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * 正在退场：由 `DialogStage`（或 `SettingsDialog` 经由 `DialogPresenceProvider`）在
   * 「已关闭但还要留在 DOM 里播完退场动画」期间传入。
   *
   * 之所以要外部告诉它，是因为**退场动画播完才允许卸载**——见
   * `overlays/DialogStage.tsx` 与 `docs/design/decisions/C41-dialog-stage.md`。
   */
  leaving?: boolean;
  /**
   * 退场动画已播完（或本来就播不了），可以卸载了。
   *
   * 用 `animationend` 而不是 JS 计时器：时长只留在 CSS 的 `--app-dur-slow` 一处，
   * JS 侧不再抄一份数字去跟它对齐。
   */
  onExited?: (() => void) | undefined;
}

/**
 * 居中弹窗：遮罩 + 浅色玻璃表面，内容按 C22–C28 的表单骨架排
 * （标题 17/600 + 副标题 → 内容 → 底部两端对齐的动作行）。
 *
 * Esc 在捕获阶段处理并阻止冒泡，避免同时触发会话层的「停止本轮 / 拒绝确认」。
 * 点击遮罩等同于关闭（调用方把它映射成取消语义）。
 * eyebrow 与标题相同时不渲染，避免「设置 / 设置」这种重复。
 *
 * **进出动画由 CSS 驱动**（`modal.css` 的 `.modalSurface` + `modalIn` / `modalOut`），
 * 不走 `motion`。两条原因，都是实测结论：
 *
 * ① **不能给弹窗做透明度淡入**：Chromium 在元素的有效 `opacity` 小于 1 时会**跳过它的
 *    `backdrop-filter`**（最小复现：同一条 `blur(20px)` 规则，`opacity: 1` 时背后的字是糊的、
 *    `opacity: .5` 时清晰可读；`will-change: opacity`、`translateZ(0)`、把模糊挪到子层，
 *    四种写法都救不回来）。于是淡入的那 360ms 里 `.modalSurface` 只是「74% 白 + 完全清晰的
 *    背景文字」，动画一结束模糊才突然生效——那一下就是「突然就不透明了」。所以这里只做
 *    `scale .98 → 1` 与 `y 4px → 0`，**不碰 opacity**，玻璃材质从第一帧起就是完整的。
 * ② **不把动画交给主线程**：`motion` 的 `animate` 由 JS 逐帧写内联样式，主线程被 SSE 帧事件
 *    或 React 挂载占住时动画会跳帧（实测单帧掉 20–50ms、透明度一步跳 0.12–0.16）。
 *    CSS keyframes 的 `transform` 动画可以交给合成线程，主线程忙也照常播。
 */
export function Modal({ title, eyebrow, wide = false, onClose, children, footer, leaving, onExited }: ModalProps): ReactNode {
  // 显式 props 优先；没有就取上层（`SettingsDialog`）发下来的留场信息。
  const fallback = useDialogPresence();
  const isLeaving = leaving ?? fallback.leaving;
  const notifyExited = onExited ?? fallback.onExited;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 退场兜底：`prefers-reduced-motion: reduce` 下 `modal.css` 会把动画整个关掉，
  // 于是永远不会有 `animationend`——不补这一条，弹窗会留在 DOM 里关不掉。
  useLayoutEffect(() => {
    if (!isLeaving) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) notifyExited();
  }, [isLeaving, notifyExited]);

  // `eyebrow` 现在是标题下方那句说明（`.dlgSub`），判重仍然留在组件里：
  // 与标题撞车时应当什么都不渲染，而不是让调用点各自去判断。
  const subtitleText = eyebrow && eyebrow !== title ? eyebrow : null;
  const content = (
    <div className="dlgPane">
      {/* 保留这一层是为了不制造「产品规则指向不存在的元素」——材质本身已由 `.appGlass` 提供，
          `modal.css` 只把它隐掉；要删得连同那条规则一起，属于后续清理。 */}
      <div className="menuMaterial" />
      <button type="button" className="dlgCloseTop" onClick={onClose} aria-label="关闭" title="关闭">×</button>
      <div className="dlgHead">
        <h2 className="dlgTitle">{title}</h2>
        {subtitleText ? <p className="dlgSub">{subtitleText}</p> : null}
      </div>
      {children}
      {footer ? <div className="dlgActions">{footer}</div> : null}
    </div>
  );

  return (
    /* 遮罩层**不带动画也不带背景**（[C21](../../docs/design/decisions/C21-modal.md) 定稿 B：无蒙层），
       只负责整屏定位与接住外部点击。此前它自己有一段 opacity 淡入——那是纯属多余的合成层：
       它没有背景，透明度变了也看不见，却把 `.modalSurface` 一起拖进「opacity < 1」的子树里，
       正好触发上面第 ① 条的平台限制。 */
    <div
      className="modalOverlay"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="appGlass modalSurface"
        data-wide={wide}
        data-leaving={isLeaving || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onAnimationEnd={event => {
          // 只在退场动画结束时通知；子元素里任何 keyframes（如 `appStaggerIn`）冒泡上来都要忽略。
          if (event.target !== event.currentTarget || event.animationName !== 'modalOut') return;
          notifyExited();
        }}
      >
        {content}
      </section>
    </div>
  );
}
