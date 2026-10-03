# 状态层（`web/src/store/`）

> 上层入口：[../../AGENTS.md](../../../AGENTS.md)。本文件是状态层的索引与边界规则。

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
| `stream` | 宿主下发的会话状态与条目 | `items`、`busy`、`liveText`、`pending`、`connected`、`pendingEcho` |
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

## 子文档

- [reducers.md](reducers.md)：三切片的字段与全部 action、帧合并语义、根 reducer 为什么手写。
- [actions-and-operations.md](actions-and-operations.md)：`Actions` 接口全表、两种错误处理约定、新增动作模板。
- [hooks-and-stream.md](hooks-and-stream.md)：类型化 hooks、`useActions` 的绑定、SSE 订阅与三个生命周期 hook。
- [selectors-and-instance.md](selectors-and-instance.md)：selector 清单与"稳定引用"要求、store 实例与类型导出。
