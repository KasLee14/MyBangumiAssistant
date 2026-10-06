# hooks 与事件流（`store/hooks.ts` + `store/stream.ts`）

## 简介

类型化 hooks、`useActions` 的绑定方式、三个生命周期 hook（目录同步 / 响应式折叠 / Esc）与 SSE 订阅，以及新增订阅的步骤和常见错误。

**不覆盖**：状态合并与帧语义（见 [reducers.md](reducers.md)）；异步动作与错误约定（见 [actions-and-operations.md](actions-and-operations.md)）；`openStream` 的实现与端点（见 [../utils/api.md](../utils/api.md)）。

上层：[readme.md](readme.md)。相关：[selectors-and-instance.md](selectors-and-instance.md)、[reducers.md](reducers.md)。使用方：`page/mainPage/index.tsx`（生命周期订阅）与各外壳组件（读状态、取动作）。

## 使用说明

- **改这两个文件之前先读完 §规则**：`useActions` 的引用稳定性、订阅必须返回清理函数、effect 依赖只放稳定引用、SSE hook 只做转发都在那里；违反会表现为每帧重绑监听器、卸载后仍收帧，或状态逻辑出现第二个实现。
- **只想查某个 hook 的签名或行为**：直接查 §索引 的「`useActions()`」「三个生命周期 hook」与「SSE 订阅」，不必通读 §规则。
- **加订阅之前**：先照 §规则「新增一个生命周期 hook 的步骤」逐步做，再在 [../page/main-page.md](../page/main-page.md) 的订阅表里登记。
- 本层通用规则见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 不用原生 `useSelector` / `useDispatch`

一律用 `hooks.ts` 里绑好泛型的 `useAppSelector` / `useAppDispatch`（用法见 §索引「类型化 hooks（`hooks.ts`）」）。**违反后果**：丢掉类型检查。

### 订阅 hook 必须返回清理函数

**违反后果**：卸载后仍收帧、重复订阅。

### effect 依赖只放稳定引用

`dispatch`、`actions`、原始值。**违反后果**：每帧重绑监听器。

### SSE hook 只做转发

状态合并（标量覆盖、条目按 `id` 合并、会话切换整表替换）全在 reducer 里（见 [reducers.md](reducers.md)），**这个 hook 只负责转发**，不要在这里写业务判断。**违反后果**：状态逻辑出现第二个实现。

### 新增一个生命周期 hook 的步骤

1. 想清楚"它属于哪个时机"：与 store 数据同步 → `hooks.ts`；与事件流相关 → `stream.ts`；
2. 用 `useAppSelector` 读它需要的状态、`useActions()` 取动作（**不要**在 hook 里直接 `import utils/api`）；
3. 依赖数组里放稳定的引用（`dispatch`、`actions` 对象、原始值），避免每帧重建监听；
4. 在 `page/mainPage/index.tsx` 里加一行调用，并在 [../page/main-page.md](../page/main-page.md) 的订阅表里登记。

### 常见错误

| 症状 | 原因 |
|---|---|
| 监听器每帧重绑 | 依赖数组里放了每次渲染都新建的对象/数组（例如在 selector 里 `map` 出的新数组） |
| Esc 同时关弹窗并停止本轮 | 在冒泡阶段监听，或在弹窗里忘了 `stopPropagation()` |
| 侧栏形态在窗口缩放时"跳回去" | 这是 `useResponsiveCollapse` 的强制语义，不是 bug；要改语义需先确认产品预期 |
| 卸载后仍在收帧 | 订阅 hook 没返回清理函数，或 effect 依赖不稳定导致反复订阅 |

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §类型化 hooks（`hooks.ts`） | 组件里读状态、不确定泛型怎么标时 |
| §`useActions()`：把异步动作绑到当前 store | 组件里发起动作、想确认引用稳定性时 |
| §三个生命周期 hook | 改侧栏响应式、Esc 行为、目录重取时机时 |
| §SSE 订阅（`stream.ts`） | 动事件流、连接状态、帧转发时 |
| §新增一个生命周期 hook 的步骤 | 加订阅前照做 |
| §常见错误 | 出现"每帧重绑""卸载后仍收帧"等症状时 |

### 类型化 hooks（`hooks.ts`）

```ts
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

用法与原生一致，但泛型已经绑好：组件里写 `useAppSelector(state => state.stream.busy)`，不需要再标 `<RootState>`。**不要绕过它们直接用 `useSelector`** —— 那会丢掉类型检查。

### `useActions()`：把异步动作绑到当前 store

```ts
export function useActions(): Actions {
  const store = useStore<RootState, AppAction>() as AppStore;
  return useMemo(() => createActions(store), [store]);
}
```

- store 实例在 Provider 生命周期内稳定，因此 `useMemo` 只会创建一次；
- 返回的 `Actions` 对象引用稳定，可以安全地放进 effect 依赖数组；
- 组件拿到的是一组"能力"，不需要知道 `dispatch` 的存在。

### 三个生命周期 hook

都只在**主界面挂载期间**生效，页面按名调用、一行一个：

| hook | 做什么 | 细节 |
|---|---|---|
| `useCatalogSync()` | 首屏、`sessionId` 或 `sessionName` 变化后重取目录 | 失败静默：打开设置/会话弹窗时会再取一次；标题变化也需同步 |
| `useResponsiveCollapse()` | 监听 `resize`，每次按当前宽度写入 `collapsedSet(window.innerWidth <= 1024)` | 是**强制**语义：手动展开后下一次 resize 仍会重置。首屏初值由 `preloadedState` 决定（见 [selectors-and-instance.md](selectors-and-instance.md)），避免先展开再收起的一次闪动 |
| `useEscapeShortcut()` | `keydown` 且 `key === 'Escape'`：`ui.switching` 为真时**直接返回**；有 `pending` → `reject(id)`；否则 `busy` → `stopRound()` | **顺序不能反**：待确认时 `busy` 也为真（确认发生在工具执行期间），先判 `busy` 会把 Esc 变成"中止整轮"。会话切换在途时不应答也不停止任务，所以 `switching` 排在最前。弹窗（`Modal`）与思考菜单各自在**捕获阶段**（`addEventListener(..., true)`）拦截并 `stopPropagation`，所以弹窗打开时 Esc 只作用于弹窗；输入区的候选下拉与统计浮层只关自己、不拦事件，Esc 会继续走这条全局判定 |

### SSE 订阅（`stream.ts`）

SSE 的 `sessions` 帧走 `sessionsUpdated`，状态帧走 `frameReceived`，接收后用 store 中实际接受的 `sessionId` 调用 `rememberSession`；`fatal` 帧走 `streamFatal`。下列片段仅展示订阅结构，完整分支见源码。

```ts
export function useStreamSubscription(): void {
  const dispatch = useAppDispatch();
  const store = useStore<RootState, AppAction>() as AppStore;
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') { dispatch(streamFatal(frame.message)); return; }
      if (frame.type === 'sessions') { dispatch(sessionsUpdated(frame.sessions)); return; }
      dispatch(frameReceived(frame));
      rememberSession(store.getState().stream.sessionId);
    },
    onStatus: connected => { dispatch(connectionChanged(connected)); },
  }), [dispatch, store]);
}
```

- `openStream` 返回清理函数（`EventSource.close()`），`useEffect` 直接把它当返回值 → 卸载即断开；
- 依赖数组是 `[dispatch, store]`：两个都是稳定引用，effect 只跑一次（`store` 也要放进去，因为回调里要用它读实际接受的会话 id）；
- 三类帧各有落点：`fatal` → `streamFatal`（写 `status` 并断开标记），`sessions` → `sessionsUpdated`（后台会话状态），其余状态帧 → `frameReceived`；
- `rememberSession` 只记录 store 里**实际接受**的 `sessionId`（reducer 可能因迟到帧丢弃本帧），所以它读的是 `store.getState()` 而不是帧里的字段；
- 状态合并全在 reducer 里，**这个 hook 只负责转发**，不要在这里写业务判断（见 §规则「SSE hook 只做转发」）；
- 只在主界面挂载时建立：页面不挂载就不连宿主（这一性质曾被调试面板依赖）；
- `EventSource` 自带重连，宿主重启会自动接回，因此不写重试逻辑；连接状态由 `onStatus` 反映到侧栏品牌行里那颗 8px 连接状态点（`.appSidebarStatus` 的 `data-state`，主界面已无顶栏）。
