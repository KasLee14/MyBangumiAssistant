import type { AppAction } from './index';

/** 设置行里可以直接进入的子弹窗。 */
export type SettingsPane = 'credential' | 'model' | 'proxy' | 'login' | 'logout';

/**
 * 界面外观版本。
 *
 * v1 是迁移前的既有外观（界面上叫**旧版**），v2 是当前默认的新外观（**新版**）。
 * 两版功能一致、各自独立实现，共用同一份 store；这里只存「当前显示哪一版」，
 * 不存任何外观细节。
 */
export type UiVariant = 'v1' | 'v2';

/** 外观版本的持久化键。切换时写入、首屏读取，因此刷新后保持选择。 */
export const UI_VARIANT_STORAGE_KEY = 'bangumi.uiVariant';

/**
 * 首屏读取上次选择的外观版本。
 *
 * **默认是 v2（新版）**：只有用户显式选过「旧版」才回落到 v1。任何读取失败
 * （隐私模式禁用 localStorage、值被改坏）也回落到 v2——新版是当前默认外观，
 * 读取不到偏好时给默认值比给旧版更符合预期。
 */
export function readStoredVariant(): UiVariant {
  if (typeof window === 'undefined') return 'v2';
  try {
    return window.localStorage.getItem(UI_VARIANT_STORAGE_KEY) === 'v1' ? 'v1' : 'v2';
  } catch {
    return 'v2';
  }
}

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
  /** 当前显示的外观版本：v1（旧版）或 v2（新版，默认）。 */
  variant: UiVariant;
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
  // 默认新版；真实初值由 store/index.ts 经 readStoredVariant() 覆盖（那里才读 localStorage）。
  variant: 'v2',
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
  | { type: 'ui/credentialProviderSet'; provider: string }
  | { type: 'ui/variantSet'; variant: UiVariant };

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
    case 'ui/variantSet':
      // 同值不返回新对象：切换按钮连点两下不该引发两轮重渲染。
      return state.variant === action.variant ? state : { ...state, variant: action.variant };
    default:
      return state;
  }
}
