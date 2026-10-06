import { useState, type ReactNode } from 'react';
import { useAppSelector } from '../../../store/hooks';
import { selectSettingsOpen, selectSessionsOpen } from '../../../store/selectors';
import { LoginDialog } from '../../dialog/LoginDialog';
import { DialogPresenceProvider } from '../../dialog/Modal';
import { SessionDialog } from '../../dialog/SessionDialog';
import { SettingsDialog } from '../../dialog/SettingsDialog';

/** 三个弹窗的固定顺序——key 用它，不用位置索引，切换弹窗时才能各播各的进出过渡。 */
const DIALOG_IDS = ['login', 'settings', 'sessions'] as const;
type DialogId = typeof DIALOG_IDS[number];

/**
 * `exited` 的初值：**三个弹窗都算「已经退场」**。
 *
 * 这不是可有可无的默认值，缺了它页面一加载就会闪一遍弹窗：`render` 的判据是
 * `!open && exited[id]`，「从未打开过」与「退场播完了」共用这一个标记——初值为空对象时，
 * 首次渲染的三个弹窗全都落进「没打开、也没被标记退场」那一支，于是一律按 `leaving` 渲染一遍
 * （实测：加载后 758ms 时 `输入邮箱与密码(leaving) | 设置(leaving) | 历史会话(leaving)`
 * 三个 `.modalSurface` 同时在 DOM 里，各自播完 360ms 的 `modalOut` 才消失）。
 * 因为弹窗**不做 opacity 淡入**（[C41](../../docs/design/decisions/C41-dialog-stage.md)：
 * `opacity < 1` 会让 `backdrop-filter` 失效），这段退场动画全程不透明，肉眼就是
 * 「一打开页面闪出两个弹窗」（登录那个 `prompt` 为空、没有内容，所以数出来是两个）。
 *
 * 从 `DIALOG_IDS` 生成而不是手写三个键：将来加第 4 个弹窗时不会漏。
 */
const NEVER_OPENED: Record<string, true> = Object.fromEntries(DIALOG_IDS.map(id => [id, true]));

/**
 * 浮层挂载点：承载三个弹窗，并让**退出也是一段过渡**。
 *
 * 原先这里用 `AnimatePresence` 提供 presence；现在弹窗的进出动画在 CSS 里
 * （`Modal.tsx` + `modal.css`，原因见那份文件的注释：不能给带 `backdrop-filter`
 * 的弹窗做透明度淡入，也不该让动画跑在主线程上），所以 presence 改由这里自己管：
 *
 * 1. 弹窗从「打开」变成「关闭」时**先留在 DOM 里**，只把 `leaving` 传下去播退场动画；
 * 2. `Modal` 在退场动画结束时报 `onExited`，这里才不再渲染它。
 *
 * 这里最容易写错的一步是第 1 条：**绝不能**用 `settingsOpen` 这类开关决定渲不渲染——
 * 那个值在关闭的同一帧就变成 false，子树会连同退场动画一起被卸载（实测：关闭后 76ms
 * 元素就消失、`data-leaving` 从未出现在 DOM 上）。所以「还要不要渲染」只看一件事：
 * **退场动画播完了没**（`exited`）。而「从未打开过」必须一并算作已退场（`NEVER_OPENED`），
 * 否则首次渲染会把三个弹窗都当成「正在退场」渲染一遍——页面一加载就闪一遍它们。
 *
 * 另一半坑在**弹窗内部换屏**：设置弹窗的分支（主屏 / 五个子面板）由 store 的
 * `settingsPane` 决定，而「回主屏」换的就是分支。弹窗还开着时换屏是对的，**退场期间换屏
 * 就等于把正在播的退场动画一起卸掉**（旧 `Modal` 卸载、新 `Modal` 挂载，新实例的
 * `leaving` 是初始值 `false`，元素于是永远留在 DOM 里）。所以那一屏在退场期间冻结：
 * 取值口径见 `SettingsDialog`（`leaving ? selectLastSettingsPane : selectSettingsPane`）
 * 与 `store/reducers/ui.ts` 的 `lastSettingsPane` 字段。
 */
export function DialogStage(): ReactNode {
  const loginPrompt = useAppSelector(state => state.stream.loginPrompt);
  const settingsOpen = useAppSelector(selectSettingsOpen);
  const sessionsOpen = useAppSelector(selectSessionsOpen);

  const activeId: DialogId | null = loginPrompt ? 'login' : settingsOpen ? 'settings' : sessionsOpen ? 'sessions' : null;

  // 退场动画已经播完（或**从未打开过**）的弹窗，按 id 记——渲染与否只看这张表。
  const [exited, setExited] = useState<Record<string, true>>(NEVER_OPENED);

  // 重新打开时立刻清掉「已退场」标记，否则它会被上一次的标记继续挡住不渲染。
  // 这是 React 的「渲染中按条件 setState」模式：真相在渲染期就知道了，放进 effect 会晚一帧。
  if (activeId !== null && exited[activeId]) {
    setExited(previous => {
      const next = { ...previous };
      delete next[activeId];
      return next;
    });
  }

  const render = (id: DialogId): ReactNode => {
    const open = id === activeId;
    // 没打开、但退场动画已经播完（或从未打开过）：不渲染。
    if (!open && exited[id]) return null;
    const leaving = !open;
    const onExited = (): void => {
      // 退场动画期间它可能已经被重新打开，这时不能把它标成已退场。
      setExited(previous => (previous[id] ? previous : { ...previous, [id]: true }));
    };
    /* 三个入口都套一层 `DialogPresenceProvider`：`SettingsDialog` 会把内容交给五个子面板，
       每个子面板自己渲染 `Modal`，退场信息走 context 下去，不必逐层透传。 */
    const wrap = (node: ReactNode): ReactNode => (
      <DialogPresenceProvider key={id} leaving={leaving} onExited={onExited}>{node}</DialogPresenceProvider>
    );
    if (id === 'login') return wrap(<LoginDialog prompt={loginPrompt ?? undefined} leaving={leaving} onExited={onExited} />);
    if (id === 'settings') return wrap(<SettingsDialog leaving={leaving} onExited={onExited} />);
    if (id === 'sessions') return wrap(<SessionDialog leaving={leaving} onExited={onExited} />);
    return null;
  };

  return <>{DIALOG_IDS.map(render)}</>;
}
