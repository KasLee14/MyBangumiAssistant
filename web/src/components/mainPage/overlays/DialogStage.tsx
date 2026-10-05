import type { ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useAppSelector } from '../../../store/hooks';
import { selectSettingsOpen, selectSessionsOpen } from '../../../store/selectors';
import { LoginDialog } from '../../dialog/LoginDialog';
import { SessionDialog } from '../../dialog/SessionDialog';
import { SettingsDialog } from '../../dialog/SettingsDialog';

/**
 * 浮层挂载点：承载三个弹窗，并用 `AnimatePresence` 包住，于是弹窗的**退出**也是一段过渡。
 *
 * 弹窗组件本身（设置、会话、登录）以及它们内部的 `Modal` 都是共享的：这里不复制
 * 表单与凭据流程，只在最外层决定「什么时候还留在 DOM 里」。`Modal` 渲染 motion 元素
 * 并声明 `exit`，presence 由这里提供。
 *
 * key 必须给：三者可以先后出现（例如从会话弹窗切到设置弹窗），没有 key 的话
 * `AnimatePresence` 会把它们当成同一个子元素，退出过渡就会错位。
 */
export function DialogStage(): ReactNode {
  const loginPrompt = useAppSelector(state => state.stream.loginPrompt);
  const settingsOpen = useAppSelector(selectSettingsOpen);
  const sessionsOpen = useAppSelector(selectSessionsOpen);

  return (
    <AnimatePresence>
      {loginPrompt ? <LoginDialog key="login" prompt={loginPrompt} /> : null}
      {settingsOpen ? <SettingsDialog key="settings" /> : null}
      {sessionsOpen ? <SessionDialog key="sessions" /> : null}
    </AnimatePresence>
  );
}
