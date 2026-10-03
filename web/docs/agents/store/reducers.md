# 切片与 reducer（`store/reducers/`）

> 上层：[readme.md](readme.md)。相关：[actions-and-operations.md](actions-and-operations.md)、[../utils/api.md](../utils/api.md)。

## 根 reducer 为什么手写

```ts
export function rootReducer(state: RootState = INITIAL_ROOT_STATE, action: AppAction): RootState {
  return {
    stream: streamReducer(state.stream, action),
    catalog: catalogReducer(state.catalog, action),
    ui: uiReducer(state.ui, action),
  };
}
```

`combineReducers` 在这里会把每个切片的状态推断成 `never`（切片 reducer 带默认参数，`StateFromReducersMapObject` 反推不出状态类型），`createStore` 随之报重载不匹配。手写之后：

- `RootState` 是**显式接口**，不是推断结果；
- 三个切片都接收完整的 `AppAction`（redux 惯例：每个 reducer 都看到所有 action），只在各自的 `type` 上分支；
- 未命中一律 `return state`，保持引用不变（这是 `useSelector` 不误触发重渲染的前提）。

`AppAction` = `StreamAction | CatalogAction | UiAction`，定义在 `reducers/index.ts`，`actions.ts` 再把它转出给 `store/index.ts` 与 `hooks.ts` 使用。

## `stream` 切片（`reducers/stream.ts`）

字段：`ChatScalarsView` 的全部标量（`busy` / `status` / `liveText` / `pending` / `sessionId` …）+ `items` + `connected` + `pendingEcho`。
初始值：`INITIAL_STREAM_STATE` = `INITIAL_SCALARS`（首帧前的占位状态，文案与终端启动提示一致）+ 三个空值。

| action | 行为 |
|---|---|
| `stream/frame` | 见下（帧合并） |
| `stream/fatal` | 写入 `status` 并置 `connected: false`（宿主明确报错，不重试） |
| `stream/connected` | 只改 `connected`；值未变时返回原 state |
| `stream/pendingEchoSet` | 记录乐观回显（文本 + 当时的 `sessionId`） |
| `stream/pendingEchoClear` | 撤下回显 |

### 帧合并（核心不变式）

```ts
const switched = state.sessionId !== '' && frame.state.sessionId !== state.sessionId;
const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
return { ...state, ...frame.state, items, connected: true, pendingEcho };
```

三条规则，缺一不可：

1. **标量每帧覆盖**（`...frame.state`）；
2. **条目按 `id` 合并**（`mergeItems`）：宿主不只追加——工具从"进行中"变完成、确认卡给出结论时会带同一个 `id` 与更高 `version` 重发那一条。必须**替换**而不是追加，否则界面同时留下新旧状态、React key 还会重复；
3. **会话切换整表替换**：`sessionId` 从非空变为另一个值时，丢弃旧条目只接本帧（宿主新建/恢复会话时会重建条目列表，编号继续递增，所以这一帧总是全量）。

### 乐观回显的撤下条件

同一个 reducer 里维护 `pendingEcho`：本帧条目里出现**同文本的 user 条目**（宿主确认），或**帧的 `sessionId` 与回显记录的不一致**（换会话了），即撤下。

放在 reducer 而不是组件 effect 里，是为了让"何时撤下"与帧处理在同一处、同一时刻决定，组件不必再为此挂副作用。

## `catalog` 切片（`reducers/catalog.ts`）

字段：`models`、`sessions`、`providers`、`canPersistCredentials`、`commands`。

只有 `catalog/loaded` 一个 action：把 `CatalogView` 摊平，并把宿主命令与本地命令**合并一次**（`mergeCommands`）后存进 `commands`。

**为什么在这里合并**：合并结果被 `Composer`（补全）、`operations.send`（未登记命令拦截）、`helpText`（`/help` 文案）三处消费，放 reducer 里算一次，三处读到的是同一个稳定引用——放进 selector 会导致每次调用返回新数组，`useSelector` 每帧都判定"变了"。

## `ui` 切片（`reducers/ui.ts`）

字段：`settingsOpen`、`settingsPane`、`sessionsOpen`、`collapsed`、`reveal`、`notice`、`problem`、`credentialProvider`。

| action | 行为 |
|---|---|
| `ui/notice` / `ui/problem` | 设置提示文本（`null` 表示清空） |
| `ui/settingsOpened` | 打开设置并指定 `pane`，**同时关闭会话弹窗**（互斥在这里保证） |
| `ui/settingsClosed` | 关闭设置并清空 `pane` |
| `ui/sessionsOpened` | 打开会话弹窗，**同时关闭设置弹窗** |
| `ui/sessionsClosed` | 关闭会话弹窗 |
| `ui/collapsedSet` / `ui/collapsedToggled` | 侧栏形态（值未变时返回原 state） |
| `ui/revealIncremented` | `/details`：递增展开计数 |
| `ui/credentialProviderSet` | 设置行当前显示的提供方 |

**`settingsPane` 住在 store**（而不是 `SettingsDialog` 的 `useState`），因为 `/model` 命令需要从组件外部直达"模型选择"行。两级关闭语义（`closePane` vs `closeSettings`）见 [../components/dialog.md](../components/dialog.md)。

## 新增一个 action 的步骤

1. **类型**：在所属切片的 `XxxAction` 联合里加成员（`type` 用 `切片/动作` 命名，如 `ui/settingsClosed`）；
2. **reducer**：加 `case`，注意"无变化时返回原 state"；
3. **creator**：在 `actions.ts` 加一个返回该类型的箭头函数，保持一行的形式；
4. **给组件用**：若组件不该直接 dispatch，就在 `operations.ts` 的 `Actions` 里加方法（见 [actions-and-operations.md](actions-and-operations.md)）；
5. 更新本文件与 [readme.md](readme.md) 的表格。
