import type { AppAction } from './index';

/** 设置行里可以直接进入的子弹窗。 */
export type SettingsPane = 'credential' | 'model' | 'proxy' | 'login' | 'logout';

/**
 * 界面状态：切换标记、按会话保存的输入草稿、弹窗开关、侧栏形态、过程展开计数
 * 与两类瞬时提示。
 *
 * 草稿按会话保存，切换会话后可恢复；弹窗内的字段、单次提交标记与补全状态留在组件内部。
 */
export interface UiState {
  /** 正在切换会话：切换期间输入与发送一并禁用，避免把命令提交给旧会话。 */
  switching: boolean;
  /** 输入草稿，键是会话 id。 */
  drafts: Record<string, string>;
  settingsOpen: boolean;
  settingsPane: SettingsPane | null;
  /**
   * 设置弹窗**屏幕上此刻渲染的是哪一屏**（`null` = 主屏）。
   *
   * 与 `settingsPane` 的分工：后者是「用户要去的屏」，前者是「已经画出来的屏」。
   * 两者在两种时刻会分开，而分开的每一刻都必须照后者渲染：
   *
   * - **退场期间**（`settingsClosed` 之后）：`settingsPane` 已被清空，若照它算渲染分支，
   *   弹窗会在关闭的同一帧从「模型配置」跳成「设置主屏」——换分支就是换子树，正在播的
   *   退场动画会连同旧 `Modal` 一起被卸载，于是既不播退场、也永远不会消失（实测症状：
   *   `data-leaving` 从未出现、元素留在 DOM 里）。
   * - **子弹窗刚关、弹窗还开着**（`settingsOpened(null)` 之后）：这一屏已经不存在了，
   *   要立刻让位给主屏，所以它是跟着 `settingsPane` 走的。
   *
   * 因此 `SettingsDialog` 的取值口径是 `leaving ? lastSettingsPane : settingsPane`。
   */
  lastSettingsPane: SettingsPane | null;
  sessionsOpen: boolean;
  collapsed: boolean;
  /**
   * 置顶的会话 id（按置顶顺序）。
   *
   * **纯前端状态**：宿主协议里没有「置顶」字段（见 `utils/pinnedStorage.ts` 的说明），
   * 所以它只存在浏览器本地，由 `store/index.ts` 的一处订阅落盘。
   */
  pinned: string[];
  /** `/details` 递增的展开计数：每次递增都强制展开过程折叠块。 */
  reveal: number;
  /**
   * 过程区的展开状态，键由 `utils/process.ts` 的两个 helper 给出：`` `${turn}` `` 是整轮过程
   * （`turnProcessKey`），`` `${turn}:${条目 id}` `` 是单个思考行或工具行（`processRowKey`）。
   *
   * 单行键用**条目 id** 而不是 `step`：同一步里思考行与工具行会同时存在，用 step 会撞键。
   *
   * 放在 store 而不是组件的 `useState`：这些行会随流式帧反复重渲染，而轮次在会话切换时
   * 会整体重建，组件私有状态会在重建时丢掉。另外 `undefined`（没记录过）与 `false`
   * （用户显式折叠过）必须区分开——前者走「进行中的轮展开、历史轮折叠」的默认值。
   */
  processOpen: Record<string, boolean>;
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
  lastSettingsPane: null,
  sessionsOpen: false,
  collapsed: false,
  // 真实的初始值在 `store/index.ts` 里从 localStorage 读入（这里只给同样的空默认值）。
  pinned: [],
  reveal: 0,
  processOpen: {},
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
  | { type: 'ui/pinnedToggled'; sessionId: string }
  | { type: 'ui/revealIncremented' }
  | { type: 'ui/processToggled'; key: string; open: boolean }
  | { type: 'ui/credentialProviderSet'; provider: string };

export function uiReducer(state: UiState = INITIAL_UI_STATE, action: AppAction): UiState {
  switch (action.type) {
    case 'ui/switching': return { ...state, switching: action.switching };
    case 'ui/draftRestore':
      // 只在草稿仍为空时写回：乐观发送的失败回滚不该冲掉这段时间里的新输入。
      if (state.drafts[action.sessionId]) return state;
      return { ...state, drafts: { ...state.drafts, [action.sessionId]: action.text } };
    case 'ui/draft': return { ...state, drafts: { ...state.drafts, [action.sessionId]: action.text } };
    case 'ui/notice':
      return { ...state, notice: action.message };
    case 'ui/problem':
      return { ...state, problem: action.message };
    case 'ui/settingsOpened':
      /* 同一时刻只留一个弹窗：会话弹窗与设置弹窗不叠加。
         `lastSettingsPane` 跟着 `action.pane` 走——它是「这一刻屏幕上真渲染的是哪一屏」，
         退场动画期间还要照它渲染（见 `lastSettingsPane` 的字段注释）。 */
      return { ...state, settingsOpen: true, settingsPane: action.pane, lastSettingsPane: action.pane, sessionsOpen: false };
    case 'ui/settingsClosed':
      /* 只关开关，**刻意不清** `lastSettingsPane`：`Modal` 还要照它把退场动画播完
         （内容一换分支就是换子树，旧 `Modal` 会被卸载，动画一帧都播不出来）。 */
      return { ...state, settingsOpen: false, settingsPane: null };
    case 'ui/sessionsOpened':
      return { ...state, sessionsOpen: true, settingsOpen: false, settingsPane: null, lastSettingsPane: null };
    case 'ui/sessionsClosed':
      return { ...state, sessionsOpen: false };
    case 'ui/collapsedSet':
      return state.collapsed === action.collapsed ? state : { ...state, collapsed: action.collapsed };
    case 'ui/collapsedToggled':
      return { ...state, collapsed: !state.collapsed };
    case 'ui/pinnedToggled': {
      // 新数组（而不是原地 splice）：订阅处用引用比较判断「值真的变了」，原地改会漏掉落盘。
      const pinned = state.pinned.includes(action.sessionId)
        ? state.pinned.filter(id => id !== action.sessionId)
        : [action.sessionId, ...state.pinned];
      return { ...state, pinned };
    }
    case 'ui/revealIncremented':
      return { ...state, reveal: state.reveal + 1 };
    case 'ui/processToggled':
      // 同值即无变化：展开状态由用户点击驱动，重复派发不该引起一次渲染。
      return state.processOpen[action.key] === action.open
        ? state
        : { ...state, processOpen: { ...state.processOpen, [action.key]: action.open } };
    case 'ui/credentialProviderSet':
      return { ...state, credentialProvider: action.provider };
    default:
      return state;
  }
}
