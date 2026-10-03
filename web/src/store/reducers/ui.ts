import type { AppAction } from './index';

/** 设置行里可以直接进入的子弹窗。 */
export type SettingsPane = 'credential' | 'model' | 'proxy' | 'login' | 'logout';

/**
 * 界面状态：弹窗开关、侧栏形态、过程展开计数与两类瞬时提示。
 *
 * 草稿按会话保存，切换后可恢复；弹窗字段与单次提交标记留在组件内部。
 */
export interface UiState {
  switching: boolean;
  drafts: Record<string, string>;
  settingsOpen: boolean;
  settingsPane: SettingsPane | null;
  sessionsOpen: boolean;
  collapsed: boolean;
  /** `/details` 递增的展开计数：每次递增都强制展开过程折叠块。 */
  reveal: number;
  notice: string | null;
  problem: string | null;
  /** 设置行显示的提供方；null 表示按目录里的当前提供方推导。 */
  credentialProvider: string | null;
}

export const INITIAL_UI_STATE: UiState = {
  switching: false,
  drafts: {},
  settingsOpen: false,
  settingsPane: null,
  sessionsOpen: false,
  collapsed: false,
  reveal: 0,
  notice: null,
  problem: null,
  credentialProvider: null,
};

export type UiAction =
  | { type: 'ui/switching'; switching: boolean }
  | { type: 'ui/draft' | 'ui/draftRestore'; sessionId: string; text: string }
  | { type: 'ui/notice'; message: string | null }
  | { type: 'ui/problem'; message: string | null }
  | { type: 'ui/settingsOpened'; pane: SettingsPane | null }
  | { type: 'ui/settingsClosed' }
  | { type: 'ui/sessionsOpened' }
  | { type: 'ui/sessionsClosed' }
  | { type: 'ui/collapsedSet'; collapsed: boolean }
  | { type: 'ui/collapsedToggled' }
  | { type: 'ui/revealIncremented' }
  | { type: 'ui/credentialProviderSet'; provider: string };

export function uiReducer(state: UiState = INITIAL_UI_STATE, action: AppAction): UiState {
  switch (action.type) {
    case 'ui/switching': return { ...state, switching: action.switching };
    case 'ui/draftRestore':
      if (state.drafts[action.sessionId]) return state;
      return { ...state, drafts: { ...state.drafts, [action.sessionId]: action.text } };
    case 'ui/draft': return { ...state, drafts: { ...state.drafts, [action.sessionId]: action.text } };
    case 'ui/notice':
      return { ...state, notice: action.message };
    case 'ui/problem':
      return { ...state, problem: action.message };
    case 'ui/settingsOpened':
      // 同一时刻只留一个弹窗：会话弹窗与设置弹窗不叠加。
      return { ...state, settingsOpen: true, settingsPane: action.pane, sessionsOpen: false };
    case 'ui/settingsClosed':
      return { ...state, settingsOpen: false, settingsPane: null };
    case 'ui/sessionsOpened':
      return { ...state, sessionsOpen: true, settingsOpen: false, settingsPane: null };
    case 'ui/sessionsClosed':
      return { ...state, sessionsOpen: false };
    case 'ui/collapsedSet':
      return state.collapsed === action.collapsed ? state : { ...state, collapsed: action.collapsed };
    case 'ui/collapsedToggled':
      return { ...state, collapsed: !state.collapsed };
    case 'ui/revealIncremented':
      return { ...state, reveal: state.reveal + 1 };
    case 'ui/credentialProviderSet':
      return { ...state, credentialProvider: action.provider };
    default:
      return state;
  }
}
