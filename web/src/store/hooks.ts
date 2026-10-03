import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { fetchCatalog } from '../utils/api';
import { catalogLoaded, collapsedSet } from './actions';
import type { AppAction } from './actions';
import type { AppDispatch, AppStore } from './index';
import { createActions, type Actions } from './operations';
import type { RootState } from './reducers';

/** 类型化的 dispatch 与 selector：组件不再各自标注泛型。 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/** 把异步动作绑到当前 store 上；组件只调用返回的动作集合。 */
export function useActions(): Actions {
  const store = useStore<RootState, AppAction>() as AppStore;
  return useMemo(() => createActions(store), [store]);
}

/**
 * 首屏与会话切换时重取目录。
 *
 * 会话切换后模型与历史会话列表都可能变化；列表失败不影响对话本身，打开设置或
 * 会话弹窗时还会再取一次。
 */
export function useCatalogSync(): void {
  const dispatch = useAppDispatch();
  const sessionId = useAppSelector(state => state.stream.sessionId);
  useEffect(() => {
    void fetchCatalog()
      .then(catalog => { dispatch(catalogLoaded(catalog)); })
      .catch(() => { /* 打开设置或会话弹窗时会再取一次。 */ });
  }, [dispatch, sessionId]);
}

/**
 * 窗口宽度决定侧栏形态：跨过 1024px 时自动收放。
 *
 * 与首屏一致，这是**强制**收放：缩到窄屏后再手动展开，下一次 resize 仍会重新收起。
 */
export function useResponsiveCollapse(): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const onResize = (): void => { dispatch(collapsedSet(window.innerWidth <= 1024)); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dispatch]);
}

/**
 * Esc：有待确认的写入则拒绝它，否则本轮进行中时停止本轮。
 *
 * 顺序不能反：待确认时 `busy` 也为真（确认发生在工具执行期间），先判 `busy` 会把
 * Esc 变成「中止整轮」，而用户按 Esc 的意图是拒绝这次写入。
 */
export function useEscapeShortcut(): void {
  const actions = useActions();
  const busy = useAppSelector(state => state.stream.busy);
  const pending = useAppSelector(state => state.stream.pending);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (pending) { actions.reject(pending.id); return; }
      if (busy) actions.stopRound();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, busy, pending]);
}
