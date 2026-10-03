# 切片与 reducer（`store/reducers/`）

## 使用说明

### 这份文档是什么

三个切片的字段与全部 action、帧合并的核心不变式、根 reducer 为什么手写，以及新增 action 的步骤。

上层：[readme.md](readme.md)。相关：[actions-and-operations.md](actions-and-operations.md)、[../utils/api.md](../utils/api.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §根 reducer 为什么手写 | 想改用 `combineReducers`、或遇到 `never` 推断报错时 |
| §`stream` 切片 | 加或改流字段时；**改帧处理前必读「帧合并（核心不变式）」** |
| §`catalog` 切片 | 动目录数据、改命令合并时机时 |
| §`ui` 切片 | 加弹窗开关、提示、布局状态时 |
| §新增一个 action 的步骤 | 加 action 时逐步照做 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **帧合并三条规则缺一不可**（标量每帧覆盖 / 条目按 `id` 合并 / 会话切换整表替换）—— 违反后果：界面残留旧状态，React key 重复。
2. **乐观回显的撤下条件只写在这里**（出现同文本 user 条目，或帧的 `sessionId` 与记录不一致）—— 违反后果：气泡不消失或过早消失。
3. **命令合并放在 `catalog` reducer，不放 selector** —— 违反后果：每帧返回新数组，整棵树重渲染（见本层「selector 不得新建引用」）。
4. **每个切片接收完整 `AppAction`，未命中 `return state`** —— 违反后果：无关组件被无谓重渲染（见本层「reducer 无变化时返回原 state」）。

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

字段：`ChatScalarsView` 的全部标量（`busy` / `status` / `liveText` / `pending` / `sessionId` …）+ `items` + `connected` + `pendingEcho` + `answering`（前端本地状态，不在协议里）。
初始值：`INITIAL_STREAM_STATE` = `INITIAL_SCALARS`（首帧前的占位状态，文案与终端启动提示一致）+ 三个空值 + `answering: null`。

| action | 行为 |
|---|---|
| `stream/frame` | 见下（帧合并） |
| `stream/fatal` | 写入 `status` 并置 `connected: false`（宿主明确报错，不重试）；顺带清掉 `answering` |
| `stream/connected` | 只改 `connected`；值未变时返回原 state |
| `stream/pendingEchoSet` | 记录乐观回显（文本 + 当时的 `sessionId`） |
| `stream/pendingEchoClear` | 撤下回显 |
| `stream/answerStarted` | 记下正在应答的确认 id |
| `stream/answerSettled` | 只清掉与 id 相同的那一条（值未变时返回原 state） |

### 帧合并（核心不变式）

```ts
const switched = state.sessionId !== '' && frame.state.sessionId !== state.sessionId;
const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
const answering = state.answering !== null && (switched || frame.state.pending?.id !== state.answering) ? null : state.answering;
return { ...state, ...frame.state, items, connected: true, pendingEcho, answering };
```

三条规则，缺一不可：

1. **标量每帧覆盖**（`...frame.state`）；
2. **条目按 `id` 合并**（`mergeItems`）：宿主不只追加——工具从"进行中"变完成、确认卡给出结论时会带同一个 `id` 与更高 `version` 重发那一条。必须**替换**而不是追加，否则界面同时留下新旧状态、React key 还会重复；
3. **会话切换整表替换**：`sessionId` 从非空变为另一个值时，丢弃旧条目只接本帧（宿主新建/恢复会话时会重建条目列表，编号继续递增，所以这一帧总是全量）。

### 应答在途的撤下条件（`answering`）

`answering` 是**前端本地状态**：正在应答中的确认 id，`null` 表示没有应答在途。它只用来在「已点下、宿主还没返回」这一小段里禁用确认卡按钮，防止重复提交。

**它不能由宿主标量 `busy` 代替**：写入确认必然出现在工具执行期间，此时 `busy` 恒为真，拿它当禁用条件会让确认按钮永远点不动。存 id 而不是布尔值，是为了让旧确认的应答不牵连换上来之后的新确认卡。

撤下有两条路径，都要保留：

1. **reducer**（权威）：本帧的 `pending` 不再是那一条（宿主已给出结论），或整体换了会话 → 清空。宿主给出结论比请求 promise 落地更早也更可靠，请求悬挂时靠它解禁；
2. **动作层**：`answerStarted` / `answerSettled` 配对（见 [actions-and-operations.md](actions-and-operations.md)），兜住网络失败这类宿主不会回应的情况。

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
