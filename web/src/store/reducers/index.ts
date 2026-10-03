import { catalogReducer, INITIAL_CATALOG_STATE, type CatalogAction, type CatalogState } from './catalog';
import { INITIAL_STREAM_STATE, streamReducer, type StreamAction, type StreamState } from './stream';
import { INITIAL_UI_STATE, uiReducer, type UiAction, type UiState } from './ui';

/** 全部 action：三个切片各自的联合再取并集。 */
export type AppAction = StreamAction | CatalogAction | UiAction;

export interface RootState {
  stream: StreamState;
  catalog: CatalogState;
  ui: UiState;
}

export const INITIAL_ROOT_STATE: RootState = {
  stream: INITIAL_STREAM_STATE,
  catalog: INITIAL_CATALOG_STATE,
  ui: INITIAL_UI_STATE,
};

/**
 * 根 reducer。
 *
 * 手写而不是 `combineReducers`：三个切片都接收完整的 `AppAction`（这是 redux 的
 * 惯例——每个 reducer 都会看到所有 action），只在自己的 `type` 上分支；这样
 * `RootState` 是显式接口，而不是从 reducer 参数上反推出来的推断结果。
 */
export function rootReducer(state: RootState = INITIAL_ROOT_STATE, action: AppAction): RootState {
  return {
    stream: streamReducer(state.stream, action),
    catalog: catalogReducer(state.catalog, action),
    ui: uiReducer(state.ui, action),
  };
}
