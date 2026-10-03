import type { ReactNode } from 'react';
import { useAppSelector } from '../../../store/hooks';
import { selectSettingsOpen, selectSessionsOpen } from '../../../store/selectors';
import { LoginDialog } from '../../dialog/LoginDialog';
import { SessionDialog } from '../../dialog/SessionDialog';
import { SettingsDialog } from '../../dialog/SettingsDialog';

/**
 * 浮层挂载点：登录输入、设置与会话弹窗。
 *
 * 只负责「哪个弹窗该出现」，弹窗自身的数据与动作都从 store 取。这里与输入区的
 * 确认卡是两个不同的挂载位置：确认卡在会话流内接管输入区，浮层覆盖在整页之上。
 */
export function DialogHost(): ReactNode {
  const loginPrompt = useAppSelector(state => state.stream.loginPrompt);
  const settingsOpen = useAppSelector(selectSettingsOpen);
  const sessionsOpen = useAppSelector(selectSessionsOpen);
  return (
    <>
      {loginPrompt ? <LoginDialog prompt={loginPrompt} /> : null}
      {settingsOpen ? <SettingsDialog /> : null}
      {sessionsOpen ? <SessionDialog /> : null}
    </>
  );
}
