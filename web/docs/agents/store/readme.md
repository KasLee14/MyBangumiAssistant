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
6. **reducer 保持纯净、不读浏览器环境**：reducer 只改内存；落盘与浏览器环境读取都放在动作层或 store 创建之前（首屏初值）。违反后果：reducer 产生副作用，时序与可测性同时变差。范例：`index.ts` 的 `initialCollapsed()` 在 `preloadedState` 里定下 `ui.collapsed`；将来若新增需要落盘的偏好，也照此办理——由 `operations` 里的动作写存储，读取放在 store 创建之前。

## 这一层的职责

**全局状态只住在这里。** 组件里出现 `useState` 只允许承载组件私有、高频或临时的状态；凡是"跨组件共享"或"来自宿主"的数据，都必须进 store，并且**只能通过 `store/` 里的动作修改**。

选型是**裸 redux + react-redux**：无 RTK、无中间件。因此异步动作不是 thunk，而是 `operations.ts` 里闭包了 `dispatch` / `getState` 的普通函数（见 [actions-and-operations.md](actions-and-operations.md)）。

## 文件结构

| 文件 | 职责 | 文档 |
|---|---|---|
| `index.ts` | 创建 store、`preloadedState`、导出 `AppStore` / `AppDispatch` / `RootState` | [selectors-and-instance.md](selectors-and-instance.md) |
| `reducers/index.ts` | 根 reducer、`AppAction`、`RootState`、`INITIAL_ROOT_STATE` | [reducers.md](reducers.md) |
| `reducers/stream.ts` | 会话流切片 + `mergeItems` + `INITIAL_SCALARS` | [reducers.md](reducers.md) |
| `reducers/catalog.ts` | 目录切片（模型/会话/提供方/命令） | [reducers.md](reducers.md) |
| `reducers/ui.ts` | 界面切片（弹窗、侧栏、`reveal`、提示） | [reducers.md](reducers.md) |
| `actions.ts` | 同步 action creators | [actions-and-operations.md](actions-and-operations.md) |
| `operations.ts` | 异步动作编排（请求 + 提示 + 状态写入） | [actions-and-operations.md](actions-and-operations.md) |
| `selectors.ts` | 读取函数 | [selectors-and-instance.md](selectors-and-instance.md) |
| `hooks.ts` | 类型化 hooks、`useActions`、三个生命周期 hook | [hooks-and-stream.md](hooks-and-stream.md) |
| `stream.ts` | SSE 订阅 hook | [hooks-and-stream.md](hooks-and-stream.md) |

## 三个切片

| 切片 | 装什么 | 典型字段 |
|---|---|---|
| `stream` | 宿主下发的会话状态与条目（外加一个前端本地字段 `answering`） | `items`、`busy`、`liveText`、`pending`、`connected`、`pendingEcho`、`answering` |
| `catalog` | 目录类数据（属于"有哪些东西可选"） | `models`、`sessions`、`providers`、`commands`、`canPersistCredentials` |
| `ui` | 纯界面状态 | `settingsOpen`、`settingsPane`、`sessionsOpen`、`collapsed`、`reveal`、`notice`、`problem`、`credentialProvider` |

## 状态边界（最容易犯错的地方）

| 状态 | 放哪 | 理由 |
|---|---|---|
| 宿主下发的任何字段 | `stream` / `catalog` | 它要跨多个组件使用，且必须随帧统一更新 |
| 弹窗开合、`settingsPane` | `ui` | 多个组件要读写（`/model` 命令要能直达某一行） |
| `notice` / `problem` | `ui` | 提示与输入区不在同一棵子树 |
| `reveal`（`/details`） | `ui` | 命令（store）触发、会话视图消费 |
| **输入草稿** | `Composer` 自己的 `useState` | 每个按键都变，且输入卡挂载点必须稳定（卸载重建会丢焦点与 IME 组合态） |
| **确认应答在途（`answering`）** | `stream` | 确认卡（`ComposerSeat`）读、`operations` 写，且必须随帧撤下（宿主给出结论时解禁）——见 [reducers.md](reducers.md) 的「应答在途的撤下条件」 |
| **弹窗内输入框、busy、error** | 各弹窗自己的 `useState` | 组件私有，只服务这一次编辑 |
| **菜单开合、滚动位置、当前轮次** | 组件自己的 `useState` / `useRef` | 纯视觉细节，没有第二个读者 |
| **命令补全游标** | `Composer` 自己的 `useState` | 同上 |

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

