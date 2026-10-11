# store：全局状态层

> 覆盖 `web/src/store/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/store/` 是**跨页面共享的真相**：会话流（宿主下发的条目与标量）、目录（模型 / 历史会话 / 提供方 / 命令）、界面（弹窗、草稿、侧栏、过程展开）。用**裸 redux**（不引 RTK、不挂中间件）+ `react-redux`，异步动作是闭包 `dispatch` 的普通函数。

三个切片：`stream` / `catalog` / `ui`。切片之外还有两件事住在这里：**事件流订阅**（`web/src/store/stream.ts`）与**流式逐字摊平**（`web/src/store/pacing.ts`）。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.ts` | store 装配：`createStore(rootReducer, …)`；首屏定死侧栏形态与读入置顶；**唯一的置顶落盘订阅**；导出 `AppStore` / `AppDispatch` 与几个类型 | `web/src/store/index.ts` | 改首屏初值、置顶落盘订阅或 store 导出类型 |
| `actions.ts` | action creator 的集中出口，按会话流 / 目录 / 界面三组排列；`AppAction` 从 `reducers` 转出 | `web/src/store/actions.ts` | 加一个同步动作 |
| `operations.ts` | 异步动作：`createActions(store)` 返回一束闭包 `dispatch` 的普通函数（提交、取消、确认、登录、模型、思考、凭据、代理、会话切换、目录加载等） | `web/src/store/operations.ts` | 加一个打宿主接口的异步动作 |
| `hooks.ts` | 类型化 hooks（`useAppDispatch` / `useAppSelector` / `useActions`）与三个生命周期订阅：`useCatalogSync` / `useResponsiveCollapse` / `useEscapeShortcut` | `web/src/store/hooks.ts` | 在组件里读状态或派发；改目录同步、侧栏响应式收放、Esc 行为 |
| `selectors.ts` | 状态读取入口，按会话流 / 目录 / 界面分组；含 `selectDisplayedContent`（读显示投影）与 `selectPacedTail`（收尾播放） | `web/src/store/selectors.ts` | 查某个字段该从哪个 selector 取 |
| `stream.ts` | `useStreamSubscription`：订阅宿主事件流，按帧类型分派（`fatal` / `sessions` / `stream` 增量 / 其余全量），不在这里做合并语义 | `web/src/store/stream.ts` | 改宿主事件流的订阅与分派 |
| `pacing.ts` | `usePacing`：把突发到达的正文按**时间**摊平（约 60 字/秒），流式结束后把剩余字播完；含积压追赶与单帧上限 | `web/src/store/pacing.ts` | 改逐字显示速度、积压追赶或播放节奏 |
| `reducers/index.ts` | `rootReducer`（手写，不用 `combineReducers`）+ `RootState` + `AppAction` + `INITIAL_ROOT_STATE` | `web/src/store/reducers/index.ts` | 改根状态形状或 action 联合 |
| `reducers/stream.ts` | 会话流切片：标量覆盖、条目合并/整体替换、乐观回显、确认应答在途标记、连接状态；`INITIAL_SCALARS` 是首帧到达前的占位 | `web/src/store/reducers/stream.ts` | 加 / 改会话流字段；改帧的处理语义 |
| `reducers/catalog.ts` | 目录切片：模型、历史会话、提供方、能否保存凭据、**已与本地合并**的命令表 | `web/src/store/reducers/catalog.ts` | 改目录字段（模型、会话列表、命令表） |
| `reducers/ui.ts` | 界面切片：切换标记、按会话 id 的草稿、设置弹窗的「目标屏 / 已渲染屏」、会话弹窗、侧栏收起、置顶、过程展开计数、瞬时提示 | `web/src/store/reducers/ui.ts` | 改界面状态（弹窗屏、按会话草稿、侧栏、过程展开计数） |

## 规则

### 引用方向

**1. 组件不直接碰 store。**

- **规则**：组件用 `web/src/store/hooks.ts` 的 `useAppSelector` / `useAppDispatch` / `useActions` 与 `web/src/store/selectors.ts` 的 selector；不在组件里 `store.getState()` 或自建 selector 泛型。
- **为什么**：类型化 hooks 让 `RootState` / `AppDispatch` 只有一处来源；`useActions` 保证动作与当前 store 实例绑定（调试页有独立 store）。
- **后果**：绕过 `useActions` 拿主 store 的动作，会让调试页的按钮作用到主界面状态上。

### 单一真相源

**2. 帧语义只在 `reducers/stream.ts`。**

- **规则**：`web/src/store/stream.ts` 只做「按帧类型分派」，标量覆盖、条目合并、整体替换、增量累加全在 reducer 里。
- **为什么**：宿主可能在任何时候退回全量帧自愈，语义集中才看得出「哪些帧是权威、哪些是增量」。
- **后果**：把合并逻辑写进订阅回调，会与 reducer 的合并规则打架，出现条目重复或版本停滞。

### 归位与命名

**3. 五个生命周期订阅只在主界面挂载。**

- **规则**：`useStreamSubscription` / `usePacing` / `useCatalogSync` / `useResponsiveCollapse` / `useEscapeShortcut` 都调用在 `web/src/page/mainPage/index.tsx`，不往外壳里下沉。
- **为什么**：它们驱动的是共享状态；外壳的任何一次重挂载都会重建事件流，那是真的重连宿主。
- **后果**：事件流反复重连、摊平计时器被重置，表现为「流式一半停住」或「连接状态闪烁」。

### 副作用位置

**4. reducer 保持纯净。**

- **规则**：reducer 只改 state——不发请求、不读 `localStorage`、不 `Date.now()`。落盘只发生在 `web/src/store/index.ts` 的一处订阅里（置顶）。
- **为什么**：副作用进 reducer 后无法从 action 序列推出状态变化，纯函数保证也会失效。
- **后果**：调试与回放失真；同一 action 播两次得到不同状态。

### 失败与降级

**5. 增量帧与全量帧走不同 action，不可合并。**

- **规则**：`stream/delta`（只带正文与思考的追加部分）与 `stream/frame`（全量、自愈）分别处理。
- **为什么**：任何接不上的情况都必须能靠全量帧恢复；增量帧只负责流式期的高频通路。
- **后果**：用增量帧兜底会丢掉「文本被改写」「块数变化」这类需要整体替换的情况，屏幕停在旧正文。

### 技术边界

**6. 裸 redux：不引 RTK，也不挂中间件。**

- **规则**：新增能力用普通函数 + 普通 action；异步动作写在 `web/src/store/operations.ts` 里，形如 `createActions(store)` 返回的闭包。
- **为什么**：这个项目的异步只有「打宿主接口后派发结果」一种形状，中间件与 RTK 带来的抽象成本高于收益。
- **后果**：引入 RTK 会让 `RootState` / `AppAction` 的类型来源分叉，`web/src/store/selectors.ts` 与 `web/src/store/reducers/index.ts` 的口径同时失效。
