import { createStore } from 'redux';
import { INITIAL_ROOT_STATE, rootReducer } from './reducers';
import { INITIAL_UI_STATE } from './reducers/ui';

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
  ui: { ...INITIAL_UI_STATE, collapsed: initialCollapsed() },
});

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;

export type { PendingEcho } from './reducers/stream';
export type { SettingsPane } from './reducers/ui';
export type { RootState } from './reducers';
