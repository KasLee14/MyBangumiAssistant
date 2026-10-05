# 状态层（`web/src/store/`）

## 简介

状态层的规则与索引：全局状态的边界、文件分工、三切片结构，以及新增动作与选择器的入口。

**全局状态只住在这里。** 组件里出现 `useState` 只允许承载组件私有、高频或临时的状态；凡是"跨组件共享"或"来自宿主"的数据，都必须进 store，并且**只能通过 `store/` 里的动作修改**。

选型是**裸 redux + react-redux**：无 RTK、无中间件。因此异步动作不是 thunk，而是 `operations.ts` 里闭包了 `dispatch` / `getState` 的普通函数（见 [actions-and-operations.md](actions-and-operations.md)）。

**不覆盖**：组件如何消费状态（见 [../components/readme.md](../components/readme.md)）；切片的字段与 action、帧合并语义（见 [reducers.md](reducers.md)）；hooks 与 SSE 订阅（见 [hooks-and-stream.md](hooks-and-stream.md)）；selector 与 store 实例（见 [selectors-and-instance.md](selectors-and-instance.md)）。

上层入口：[AGENTS.md](../../../AGENTS.md)。

## 使用说明

- **改这一层之前先读完 §规则**：状态边界、引用稳定性、reducer 的返回约定与"不引入中间件"都在那里；违反会直接表现为流式帧与界面不同步、无关组件每帧重渲染。
- **只想查某件事在哪**：直接查 §索引——"某个文件该看哪篇"查「文件 → 场景」，"某个状态该放 store 还是组件"查「状态边界（最容易犯错的地方）」，"某个文件负责什么"查「文件结构」。
- **加 action / 加 selector 之前**：先读 §规则，再照对应子文档的步骤走（[reducers.md](reducers.md) §规则「新增一个 action 的步骤」、[selectors-and-instance.md](selectors-and-instance.md) §规则「新增一个 selector」）。
- 本篇只写层内通用规则；四个子文档只写各自专属规则。

## 规则

### 改全局状态只能经 `store/` 的动作

组件不得绕过动作层自己发请求并写状态。**违反后果**：状态更新散落各处，提示与错误处理不一致。

```
组件 ──useAppSelector──▶ selectors ──▶ RootState
  └──useActions────────▶ operations ──▶ utils/api + dispatch(actions)
                          └───────────▶ reducers（经 dispatch）
```

组件**不得**直接 `import utils/api`：那会绕过"成功提示、失败提示/抛出"的统一处理，也会让状态更新散落在组件里。唯一例外是 `utils/credentialLabel.ts` 这类纯常量。

### `useState` 只承载组件私有状态

跨组件共享或来自宿主的数据必须进 store。**违反后果**：状态出现第二个真相，流式帧与界面不同步。判据见 §索引「状态边界（最容易犯错的地方）」。

### selector 不得新建引用

不得在 selector 里 `map` / `filter` / 构造对象或数组。**违反后果**：`useSelector` 每帧判定"变了"，整棵树每帧重渲染。见 [selectors-and-instance.md](selectors-and-instance.md) §规则「selector 不得新建引用（稳定引用要求）」。

### reducer 无变化时返回原 state

**违反后果**：无关组件被无谓重渲染。见 [reducers.md](reducers.md) §规则「根 reducer 必须手写，不用 `combineReducers`」。

### 不引入中间件

异步动作是闭包 `dispatch` 的普通函数。**违反后果**：与既有约定分叉，两种异步风格并存。

- 异步逻辑是普通函数，**必须显式拿到 store**（`useActions()` 内部已用 `useStore()` 绑定）；
- 不存在 `dispatch(asyncFn)` 这种写法，也不要尝试自己写一个 thunk 中间件——需要新能力时优先加动作，而不是加中间件；
- 每个动作自己负责错误处理，约定见 [actions-and-operations.md](actions-and-operations.md) §规则「两种错误处理约定（新增动作时必须选一个）」。

### 浏览器环境只在创建 store 时读一次，不写进 reducer

需要按环境定的初值（侧栏形态）在 `store/index.ts` 组装 `preloadedState` 时算好，reducer 只改内存。**违反后果**：reducer 产生副作用，时序与可测性同时变差。见 [selectors-and-instance.md](selectors-and-instance.md) §规则「store 实例（`index.ts`）：`preloadedState` 只覆盖 `collapsed`」。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §改全局状态只能经 `store/` 的动作 | 犹豫某段读写该放组件还是 `operations`、或想在组件里直接用 `utils/api` 时 |
| §`useState` 只承载组件私有状态 | 判断"这个状态要不要进 store"时 |
| §selector 不得新建引用 | 写 selector、或排查整棵树每帧重渲染时 |
| §reducer 无变化时返回原 state | 写 reducer 分支、或怀疑无关组件被重渲染时 |
| §不引入中间件 | 想加中间件、或不确定异步动作该怎么写时 |
| §浏览器环境只在创建 store 时读一次，不写进 reducer | 要加按环境定的初值（如侧栏形态）时 |
| §文件 → 场景、§文件结构、§三个切片 | 找某个文件该看哪篇文档、某个文件负责什么、某个状态存在哪个切片时 |
| §状态边界（最容易犯错的地方） | 判断一个状态该放 store 还是留在组件里时 |

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断"这个状态该放 store 还是组件"、找文件分工时 |
| [reducers.md](reducers.md) | 加 action、改帧合并 / 会话切换 / 乐观回显语义时 |
| [actions-and-operations.md](actions-and-operations.md) | 加异步动作、决定错误处理方式时 |
| [hooks-and-stream.md](hooks-and-stream.md) | 加生命周期订阅、改 SSE 订阅、加全局快捷键时 |
| [selectors-and-instance.md](selectors-and-instance.md) | 加 selector、改 store 初值或类型导出时 |

### 文件结构

| 文件 | 职责 | 文档 |
|---|---|---|
| `index.ts` | 创建 store、`preloadedState`、导出 `AppStore` / `AppDispatch`，并转出 `RootState` / `PendingEcho` / `SettingsPane` | [selectors-and-instance.md](selectors-and-instance.md) |
| `reducers/index.ts` | 根 reducer、`AppAction`、`RootState`、`INITIAL_ROOT_STATE` | [reducers.md](reducers.md) |
| `reducers/stream.ts` | 会话流切片 + `mergeItems` + `INITIAL_SCALARS` | [reducers.md](reducers.md) |
| `reducers/catalog.ts` | 目录切片（模型/会话/提供方/命令） | [reducers.md](reducers.md) |
| `reducers/ui.ts` | 界面切片（切换标记、草稿、弹窗、侧栏、`reveal`、提示） | [reducers.md](reducers.md) |
| `actions.ts` | 同步 action creators | [actions-and-operations.md](actions-and-operations.md) |
| `operations.ts` | 异步动作编排（请求 + 提示 + 状态写入） | [actions-and-operations.md](actions-and-operations.md) |
| `selectors.ts` | 读取函数 | [selectors-and-instance.md](selectors-and-instance.md) |
| `hooks.ts` | 类型化 hooks、`useActions`、三个生命周期 hook | [hooks-and-stream.md](hooks-and-stream.md) |
| `stream.ts` | SSE 订阅 hook | [hooks-and-stream.md](hooks-and-stream.md) |

### 三个切片

| 切片 | 装什么 | 典型字段 |
|---|---|---|
| `stream` | 宿主下发的会话状态与条目（外加一个前端本地字段 `answering`） | `items`、`busy`、`liveContent`、`pending`、`connected`、`pendingEcho`、`answering` |
| `catalog` | 目录类数据（属于"有哪些东西可选"） | `models`、`sessions`、`providers`、`commands`、`canPersistCredentials` |
| `ui` | 纯界面状态 | `switching`、`drafts`、`settingsOpen`、`settingsPane`、`sessionsOpen`、`collapsed`、`reveal`、`notice`、`problem`、`credentialProvider` |

### 状态边界（最容易犯错的地方）

| 状态 | 放哪 | 理由 |
|---|---|---|
| 宿主下发的任何字段 | `stream` / `catalog` | 它要跨多个组件使用，且必须随帧统一更新 |
| 弹窗开合、`settingsPane` | `ui` | 多个组件要读写（`/model` 命令要能直达某一行） |
| `notice` / `problem` | `ui` | 提示与输入区不在同一棵子树 |
| `reveal`（`/details`） | `ui` | 命令（store）触发、会话视图消费 |
| **输入草稿** | `ui.drafts[sessionId]` | `Composer` 与接管卡（`ComposerSeat`）共用，会话切换或授权接管都不丢失；组件私有状态只承载提交标记、补全与菜单，切换会话时重建 |
| **确认应答在途（`answering`）** | `stream` | 确认卡座位（`Shell.tsx` 以 `composer={<ComposerSeat />}` 传进 `Stage` 的槽位，`ComposerSeat` 自己读 selector）、`operations` 写，且必须随帧撤下（宿主给出结论时解禁）——见 [reducers.md](reducers.md) §规则「应答在途的撤下条件（`answering`）」 |
| **弹窗内输入框、busy、error** | 各弹窗自己的 `useState` | 组件私有，只服务这一次编辑 |
| **菜单开合、滚动位置、当前轮次** | 组件自己的 `useState` / `useRef` | 纯视觉细节，没有第二个读者 |
| **命令补全游标** | `Composer` 自己的 `useState` | 仅服务当前输入卡 |

并行会话字段：`stream.instanceId/revision` 阻止迟到帧覆盖当前会话；`ui.switching` 表示选择请求在途；`catalog.sessions` 通过独立的 `sessions` SSE 帧更新后台状态。

判断口诀：**"另一个组件需要知道它吗？" 需要就进 store，不需要就留在组件里。**
