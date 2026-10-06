import { createStore } from 'redux';
import { INITIAL_ROOT_STATE, rootReducer } from './reducers';
import { INITIAL_UI_STATE } from './reducers/ui';
import { loadPinned, savePinned } from '../utils/pinnedStorage';

/** 首屏即按窗口宽度决定侧栏形态，避免先展开再收起的一次闪动。 */
function initialCollapsed(): boolean {
  return typeof window === 'undefined' ? false : window.innerWidth <= 1024;
}

/**
 * 全局状态容器。
 *
 * 裸 `redux` + `react-redux` 的既定选择：不引入 RTK，也不挂中间件；异步动作是
 * `operations.ts` 里闭包 `dispatch` 的普通函数。会话流、目录与界面各占一个切片。
 */
export const store = createStore(rootReducer, {
  ...INITIAL_ROOT_STATE,
  // 侧栏形态在首屏定死：先渲染再纠正会看到一次闪动。
  // 置顶同样在首屏一次读入（它是纯前端本地状态），避免先渲染成未置顶再跳一次。
  ui: { ...INITIAL_UI_STATE, collapsed: initialCollapsed(), pinned: loadPinned() },
});

/*
 * 置顶落盘。
 *
 * reducer 保持纯净（只改 state），持久化只在这一处订阅里发生——组件与 reducer
 * 都不直接碰 `localStorage`。用引用比较过滤掉其它 action 引起的通知：
 * `ui/pinnedToggled` 每次都返回新数组，所以「引用变了」就等于「值变了」。
 */
let persistedPinned = store.getState().ui.pinned;
store.subscribe(() => {
  const pinned = store.getState().ui.pinned;
  if (pinned === persistedPinned) return;
  persistedPinned = pinned;
  savePinned(pinned);
});

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;

export type { PendingEcho } from './reducers/stream';
export type { SettingsPane } from './reducers/ui';
export type { RootState } from './reducers';
