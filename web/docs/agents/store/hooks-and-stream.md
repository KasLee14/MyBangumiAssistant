# hooks 与事件流（`store/hooks.ts` + `store/stream.ts`）

> 上层：[readme.md](readme.md)。使用方：`page/mainPage/index.tsx`（生命周期订阅）与各外壳组件（读状态、取动作）。

## 类型化 hooks（`hooks.ts`）

```ts
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

用法与原生一致，但泛型已经绑好：组件里写 `useAppSelector(state => state.stream.busy)`，不需要再标 `<RootState>`。**不要绕过它们直接用 `useSelector`** —— 那会丢掉类型检查。

## `useActions()`：把异步动作绑到当前 store

```ts
export function useActions(): Actions {
  const store = useStore<RootState, AppAction>() as AppStore;
  return useMemo(() => createActions(store), [store]);
}
```

- store 实例在 Provider 生命周期内稳定，因此 `useMemo` 只会创建一次；
- 返回的 `Actions` 对象引用稳定，可以安全地放进 effect 依赖数组；
- 组件拿到的是一组"能力"，不需要知道 `dispatch` 的存在。

## 三个生命周期 hook

都只在**主界面挂载期间**生效，页面按名调用、一行一个：

| hook | 做什么 | 细节 |
|---|---|---|
| `useCatalogSync()` | 首屏与 `sessionId` 变化后重取目录 | 失败静默：打开设置/会话弹窗时会再取一次。会话切换后模型与历史会话列表都可能变，所以依赖 `sessionId` |
| `useResponsiveCollapse()` | 监听 `resize`，`innerWidth <= 1024` → `collapsedSet(true)` | 是**强制**语义：手动展开后下一次 resize 仍会重置。首屏初值由 `preloadedState` 决定（见 [selectors-and-instance.md](selectors-and-instance.md)），避免先展开再收起的一次闪动 |
| `useEscapeShortcut()` | `keydown` 且 `key === 'Escape'`：`busy` → `stopRound()`；否则有 `pending` → `reject(id)` | 弹窗（`Modal`）与思考菜单各自在**捕获阶段**拦截并 `stopPropagation`，所以弹窗打开时 Esc 只作用于弹窗 |

## SSE 订阅（`stream.ts`）

```ts
export function useStreamSubscription(): void {
  const dispatch = useAppDispatch();
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') { dispatch(streamFatal(frame.message)); return; }
      dispatch(frameReceived(frame));
    },
    onStatus: connected => { dispatch(connectionChanged(connected)); },
  }), [dispatch]);
}
```

- `openStream` 返回清理函数（`EventSource.close()`），`useEffect` 直接把它当返回值 → 卸载即断开；
- 状态合并（标量覆盖、条目按 `id` 合并、会话切换整表替换）全在 reducer 里，**这个 hook 只负责转发**，不要在这里写业务判断；
- 只在主界面挂载时建立：页面不挂载就不连宿主（这一性质曾被调试面板依赖）；
- `EventSource` 自带重连，宿主重启会自动接回，因此不写重试逻辑；连接状态由 `onStatus` 反映到顶栏 chip。

## 新增一个生命周期 hook 的步骤

1. 想清楚"它属于哪个时机"：与 store 数据同步 → `hooks.ts`；与事件流相关 → `stream.ts`；
2. 用 `useAppSelector` 读它需要的状态、`useActions()` 取动作（**不要**在 hook 里直接 `import utils/api`）；
3. 依赖数组里放稳定的引用（`dispatch`、`actions` 对象、原始值），避免每帧重建监听；
4. 在 `page/mainPage/index.tsx` 里加一行调用，并在 [../page/main-page.md](../page/main-page.md) 的订阅表里登记。

## 常见错误

| 症状 | 原因 |
|---|---|
| 监听器每帧重绑 | 依赖数组里放了每次渲染都新建的对象/数组（例如在 selector 里 `map` 出的新数组） |
| Esc 同时关弹窗并停止本轮 | 在冒泡阶段监听，或在弹窗里忘了 `stopPropagation()` |
| 侧栏形态在窗口缩放时"跳回去" | 这是 `useResponsiveCollapse` 的强制语义，不是 bug；要改语义需先确认产品预期 |
| 卸载后仍在收帧 | 订阅 hook 没返回清理函数，或 effect 依赖不稳定导致反复订阅 |
