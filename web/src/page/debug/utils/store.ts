import { createStore } from 'redux';
import { INITIAL_ROOT_STATE, rootReducer } from '../../../store/reducers';
import { DEBUG_INSTANCE_ID } from '../constants/simulator';

/**
 * 调试页专用的 redux store 工厂。
 *
 * 为什么不给 `store/index.ts` 加一个「调试模式」开关：隔离要发生在**实例**层面——调试数据只
 * 进这个 store，主 store 一个字节都不动，所以复用的只是同一份 `rootReducer` 与初始状态。
 * 放在页面目录下也是同一个理由：它只服务这一个页面，主 store 不该知道它的存在。
 */
export function createDebugStore() {
  return createStore(rootReducer, {
    ...INITIAL_ROOT_STATE,
    // `instanceId` 一换，`store/reducers/stream.ts` 的 `switched` 即为真，首帧按「整体替换」
    // 而不是「同实例增量」处理；`revision: -1` 与 `INITIAL_STREAM_STATE` 同口径，表示
    // 「还没有任何帧到达」，于是第一帧无论编号多少都不会被「同实例旧帧丢弃」守卫吃掉。
    stream: { ...INITIAL_ROOT_STATE.stream, instanceId: DEBUG_INSTANCE_ID, revision: -1 },
  });
}

/**
 * 调试 store 的实例类型。
 *
 * 从工厂反推而不是手写 `Store<RootState, AppAction>`：redux 的 `Store` 还带一个 action 泛型，
 * 手写会与工厂的实际返回悄悄漂移；这里要的只是「能 dispatch、能 getState」这一层契约，
 * 装配层（`index.tsx`）与壳组件（`components/shell/DebugShell.tsx`）都按这个别名标注，
 * 于是「谁建 store、谁依赖 store」在类型上就是同一份定义。
 */
export type DebugStore = ReturnType<typeof createDebugStore>;
