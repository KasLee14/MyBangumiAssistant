# 状态层（`web/src/store/`）

## 使用说明

### 这份文档是什么

状态层的规则与索引：全局状态的边界、文件分工、三切片结构，以及新增动作与选择器的入口。

**不覆盖**：组件如何消费状态（见 [../components/readme.md](../components/readme.md)）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断"这个状态该放 store 还是组件"、找文件分工时 |
| [reducers.md](reducers.md) | 加 action、改帧合并 / 会话切换 / 乐观回显语义时 |
| [actions-and-operations.md](actions-and-operations.md) | 加异步动作、决定错误处理方式时 |
| [hooks-and-stream.md](hooks-and-stream.md) | 加生命周期订阅、改 SSE 订阅、加全局快捷键时 |
| [selectors-and-instance.md](selectors-and-instance.md) | 加 selector、改 store 初值或类型导出时 |

### 必须遵守的规则

1. **改全局状态只能经 `store/` 的动作**：组件不得绕过动作层自己发请求并写状态。违反后果：状态更新散落各处，提示与错误处理不一致。见 §依赖方向。
2. **`useState` 只承载组件私有状态**：跨组件共享或来自宿主的数据必须进 store。违反后果：状态出现第二个真相，流式帧与界面不同步。判据见 §状态边界。
3. **selector 不得新建引用**：不得在 selector 里 `map` / `filter` / 构造对象或数组。违反后果：`useSelector` 每帧判定"变了"，整棵树每帧重渲染。见 [selectors-and-instance.md](selectors-and-instance.md)。
4. **reducer 无变化时返回原 state**：违反后果：无关组件被无谓重渲染。见 [reducers.md](reducers.md)。
5. **不引入中间件**：异步动作是闭包 `dispatch` 的普通函数。违反后果：与既有约定分叉，两种异步风格并存。见 §没有中间件的后果。
6. **持久化不写进 reducer**：需要落盘的偏好必须由 `operations` 里的动作 `dispatch` + 在**一处订阅**里写 `localStorage`，reducer 只改内存；读取也放在 action 创建之前（首屏初值）。违反后果：reducer 产生副作用，时序与可测性同时变差。**当前 store 只有一例落盘：会话置顶**（`ui.pinned`）——reducer 只负责返回新数组，写到 `localStorage` 的是 `store/index.ts` 里的一处 `store.subscribe`，读写封装在 `utils/pinnedStorage.ts`，组件与 reducer 都不直接碰 `localStorage`。原先的另一例（外观版本 `variant`）已随整套双外观机制移除（见 §状态边界「已移除的机制」）。
7. **流式正文有两份，组件只读「显示投影」**：`stream.liveContent` 是宿主下发的**权威值**，`stream.displayedContent` 是**屏幕上的那一份**（由 `pacing.ts` 按时间逐字推进），`stream.pacedTarget` 是它正在追赶的目标。组件一律经 `selectDisplayedContent` 读投影；判「这一轮是否还在进行」要看权威值（`selectHeroPhase` 就是这么做的）。违反后果：上游的突发批次直接上屏，一次冒出十几个字（这正是本层要解决的问题）。

## 这一层的职责

**全局状态只住在这里。** 组件里出现 `useState` 只允许承载组件私有、高频或临时的状态；凡是"跨组件共享"或"来自宿主"的数据，都必须进 store，并且**只能通过 `store/` 里的动作修改**。

选型是**裸 redux + react-redux**：无 RTK、无中间件。因此异步动作不是 thunk，而是 `operations.ts` 里闭包了 `dispatch` / `getState` 的普通函数（见 [actions-and-operations.md](actions-and-operations.md)）。

## 文件结构

| 文件 | 职责 | 文档 |
|---|---|---|
| `index.ts` | 创建 store、`preloadedState`（`collapsed` + 从 `localStorage` 读入的 `pinned`）、**置顶落盘订阅**、导出 `AppStore` / `AppDispatch` / `RootState` | [selectors-and-instance.md](selectors-and-instance.md) |
| `reducers/index.ts` | 根 reducer、`AppAction`、`RootState`、`INITIAL_ROOT_STATE` | [reducers.md](reducers.md) |
| `reducers/stream.ts` | 会话流切片 + `mergeItems` + `INITIAL_SCALARS` | [reducers.md](reducers.md) |
| `reducers/catalog.ts` | 目录切片（模型/会话/提供方/命令） | [reducers.md](reducers.md) |
| `reducers/ui.ts` | 界面切片（弹窗、侧栏、置顶、`reveal`、**过程展开状态表 `processOpen`**、提示） | [reducers.md](reducers.md) |
| `actions.ts` | 同步 action creators | [actions-and-operations.md](actions-and-operations.md) |
| `operations.ts` | 异步动作编排（请求 + 提示 + 状态写入） | [actions-and-operations.md](actions-and-operations.md) |
| `selectors.ts` | 读取函数 | [selectors-and-instance.md](selectors-and-instance.md) |
| `hooks.ts` | 类型化 hooks、`useActions`、三个生命周期 hook | [hooks-and-stream.md](hooks-and-stream.md) |
| `stream.ts` | SSE 订阅 hook（含 `stream` 增量帧的路由） | [hooks-and-stream.md](hooks-and-stream.md) |
| `pacing.ts` | 流式正文的**逐字摊平**：`advanceFrame` / `hasCaughtUp` / `usePacing` | [hooks-and-stream.md](hooks-and-stream.md) |

## 三个切片

| 切片 | 装什么 | 典型字段 |
|---|---|---|
| `stream` | 宿主下发的会话状态与条目（外加三个前端本地字段：`answering`、`displayedContent`、`pacedTarget`） | `items`、`busy`、`liveContent`、`liveThinking`、`displayedContent`、`pacedTarget`、`pending`、`connected`、`pendingEcho`、`answering` |
| `catalog` | 目录类数据（属于"有哪些东西可选"） | `models`、`sessions`、`providers`、`commands`、`canPersistCredentials` |
| `ui` | 纯界面状态 | `settingsOpen`、`settingsPane`、`lastSettingsPane`、`sessionsOpen`、`collapsed`、`pinned`、`reveal`、`processOpen`、`notice`、`problem`、`credentialProvider`、`switching`、`drafts` |

## 状态边界（最容易犯错的地方）

| 状态 | 放哪 | 理由 |
|---|---|---|
| 宿主下发的任何字段 | `stream` / `catalog` | 它要跨多个组件使用，且必须随帧统一更新 |
| 弹窗开合、`settingsPane` | `ui` | 多个组件要读写（`/model` 命令要能直达某一行） |
| **`lastSettingsPane`**（屏幕上已渲染的那一屏） | `ui` | 设置弹窗的退场动画期间要照它继续渲染原来那一屏——否则渲染分支一换，旧 `Modal` 连同动画一起被卸载，弹窗既不播退场也永不消失。取值口径是 `leaving ? lastSettingsPane : settingsPane`，见 [components/dialog.md](../components/dialog.md) |
| `notice` / `problem` | `ui` | 提示与输入区不在同一棵子树 |
| `reveal`（`/details`） | `ui` | 命令（store）触发、会话视图消费 |
| **过程区的展开状态（`processOpen`）** | `ui.processOpen: Record<string, boolean>` | 键由 [../utils/process.md](../utils/process.md) 的两个 helper 定义（整轮 / 单个思考行或工具行）。放 store 有两个理由：这些行随流式帧反复重渲染，且**轮次在会话切换时会整体重建**，组件私有状态会跟着丢；另外 `undefined`（没记录过 → 走「进行中的轮展开、历史轮折叠」的默认值）与 `false`（用户显式折叠过）必须区分。工具行**子调用**的开合是例外，留在 `ToolRow` 的 `useState`——粒度太细。见 [reducers.md](reducers.md) §规则 |
| **会话置顶（`pinned`）** | `ui.pinned: string[]` | **纯前端状态**：宿主协议里没有「置顶」字段，它只存在浏览器本地；侧栏分组与菜单读写它，落盘由 `store/index.ts` 的一处订阅负责（`utils/pinnedStorage.ts`） |
| **输入草稿** | `ui.drafts[sessionId]` | 由唯一的输入卡 `Composer` 读写，切换会话或授权接管（确认卡替换掉输入卡）都不丢文字；组件私有状态只承载提交标记、补全与菜单，切换会话时重建 |
| **确认应答在途（`answering`）** | `stream` | 确认卡座位（`ComposerSeat`，容器是 `.appSeat`）读、`operations` 写，且必须随帧撤下（宿主给出结论时解禁）——见 [reducers.md](reducers.md) 的「应答在途的撤下条件」 |
| **流式正文的显示进度** | `stream.displayedContent` + `stream.pacedTarget` | 上游以突发批次下发（实测一批 10~90 字符），权威值一帧就能长出十几个字；屏幕上的那份由 `pacing.ts` 按时间摊平（约 60 字/秒，500 字回答写完后再播约 6~7 秒）。`pacedTarget` 在流式结束那一帧被冻住，让剩下的字播完再交回历史条目——见 [reducers.md](reducers.md) 的「收尾播放」 |
| **弹窗内输入框、busy、error** | 各弹窗自己的 `useState` | 组件私有，只服务这一次编辑 |
| **菜单开合、滚动位置、当前轮次** | 组件自己的 `useState` / `useRef` | 纯视觉细节，没有第二个读者 |
| **命令补全游标** | `Composer` 自己的 `useState` | 仅服务当前输入卡 |

**已移除的机制**：**外观版本（`variant`）**与「v1 / v2 双外观版本」整套机制已删除——`ui` 切片里不再有 `variant`，源码里没有 `variant` / `ShellV1` / `ShellV2` / `data-ui` 任何符号，`components/` 与 `styles/` 下也没有 `v2/` 目录。主界面现在只有一套外壳（`page/mainPage/Shell.tsx`），因此**不存在"切回旧版"的入口，也没有任何外观版本要持久化**；`main.tsx` 的 `Root` 仍按 URL hash 在 `MainPage` 与 `DebugPage` 之间分流（`#debug`），这部分未变。看到"默认 v2 / 显式选过 v1 才回落"一类描述，一律以源码为准。

并行会话字段：`stream.instanceId/revision` 阻止迟到帧覆盖当前会话；`ui.switching` 表示选择请求在途；`catalog.sessions` 通过独立的 `sessions` SSE 帧更新后台状态。

判断口诀：**"另一个组件需要知道它吗？" 需要就进 store，不需要就留在组件里。**

## 依赖方向

```
组件 ──useAppSelector──▶ selectors ──▶ RootState
  └──useActions────────▶ operations ──▶ utils/api + dispatch(actions)
                          └───────────▶ reducers（经 dispatch）
```

组件**不得**直接 `import utils/api`：那会绕过"成功提示、失败提示/抛出"的统一处理，也会让状态更新散落在组件里。唯一例外是 `utils/credentialLabel.ts` 这类纯常量。

## 没有中间件的后果

- 异步逻辑是普通函数，**必须显式拿到 store**（`useActions()` 内部已用 `useStore()` 绑定）；
- 不存在 `dispatch(asyncFn)` 这种写法，也不要尝试自己写一个 thunk 中间件——需要新能力时优先加动作，而不是加中间件；
- 每个动作自己负责错误处理，约定见 [actions-and-operations.md](actions-and-operations.md)。
