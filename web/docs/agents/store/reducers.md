# 切片与 reducer（`store/reducers/`）

## 简介

三个切片的字段与全部 action、帧合并的核心不变式、根 reducer 为什么手写，以及新增 action 的步骤。

**不覆盖**：动作层与异步编排（见 [actions-and-operations.md](actions-and-operations.md)）、SSE 订阅本身（见 [hooks-and-stream.md](hooks-and-stream.md)）。

上层：[readme.md](readme.md)。相关：[actions-and-operations.md](actions-and-operations.md)、[../utils/api.md](../utils/api.md)。

## 使用说明

- **改这个目录之前先读完 §规则**：帧合并、应答在途的撤下、乐观回显的撤下，以及 reducer 的「无变化时返回原 state」都在那里；违反会直接表现为界面残留旧状态、React key 重复或整棵树重渲染。
- **只想查某个字段或 action 的行为**：查 §索引 的三张清单表，不必通读 §规则。
- **改帧处理**：先读 §规则 的「帧合并三条规则缺一不可」，再动手改 `stream.ts`。
- 本层的通用规则（引用稳定性、状态边界、依赖方向）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 根 reducer 必须手写，不用 `combineReducers`

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

**违反后果**：改用 `combineReducers` 会直接类型报错；在切片里对未命中的 action 新建对象，会让无关组件被无谓重渲染。

`AppAction` = `StreamAction | CatalogAction | UiAction`，定义在 `reducers/index.ts`，`actions.ts` 再把它转出给 `store/index.ts` 与 `hooks.ts` 使用。

### 帧合并三条规则缺一不可

```ts
if (frame.instanceId === state.instanceId && frame.revision < state.revision) return state;
const switched = frame.instanceId !== state.instanceId || frame.state.sessionId !== state.sessionId;
const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
const answering = state.answering !== null && (switched || frame.state.pending?.id !== state.answering) ? null : state.answering;
return { ...state, ...frame.state, instanceId: frame.instanceId, revision: frame.revision, items, connected: true, pendingEcho, answering };
```

1. **标量每帧覆盖**（`...frame.state`）；
2. **条目按 `id` 合并**（`mergeItems`）：宿主不只追加——工具从"进行中"变完成、确认卡给出结论时会带同一个 `id` 与更高 `version` 重发那一条。必须**替换**而不是追加，否则界面同时留下新旧状态、React key 还会重复；
3. **会话切换或宿主重启整表替换**：`sessionId` 或 `instanceId` 改变时，丢弃旧条目只接本帧；各会话条目独立编号。同一宿主实例中低于当前 `revision` 的帧直接忽略，不能恢复旧确认或切回旧会话。

**违反后果**：缺任一条都会让界面残留旧状态；第 2 条缺失时还会出现 React key 重复。

### 流式内容块走标量 `liveContent`，不进 `items`

助手消息在流式期间**不进 `items`**：它的内容块放在标量 `liveContent`（`MessageBlock[]`）里随每帧覆盖，`message_end` 到了才把同一批块落成一个 `kind:'assistant'` 条目（`content: MessageBlock[]`）。所以上面三条帧合并规则**不需要为块做任何特殊处理**——块的增删改都发生在标量内部，条目合并仍然只看 `id` / `version`。

`liveContent` 与历史条目的 `content` 是**同一个类型、同一套渲染组件**（见 [../components/content.md](../components/content.md)），差别只有"是否处于流式期"（`pending` 与光标）。

**不要在 reducer 里对块做合并或补间**：块由宿主（或调试页的 simulator）投影成整份快照，reducer 只覆盖。这是"快照是唯一入口"那条契约在状态层的体现。

**违反后果**：在 reducer 里按 `contentIndex` 再实现一遍合并，等于把上游的快照语义抄成第二份；两处一旦不一致，就会出现"文本正常、组件错位"这类最难定位的问题。

### 应答在途的撤下条件（`answering`）

`answering` 是**前端本地状态**：正在应答中的确认 id，`null` 表示没有应答在途。它只用来在「已点下、宿主还没返回」这一小段里禁用确认卡按钮，防止重复提交。

**它不能由宿主标量 `busy` 代替**：写入确认必然出现在工具执行期间，此时 `busy` 恒为真，拿它当禁用条件会让确认按钮永远点不动。存 id 而不是布尔值，是为了让旧确认的应答不牵连换上来之后的新确认卡。

撤下有两条路径，都要保留：

1. **reducer**（权威）：本帧的 `pending` 不再是那一条（宿主已给出结论），或整体换了会话 → 清空。宿主给出结论比请求 promise 落地更早也更可靠，请求悬挂时靠它解禁；
2. **动作层**：`answerStarted` / `answerSettled` 配对（见 [actions-and-operations.md](actions-and-operations.md)），兜住网络失败这类宿主不会回应的情况。

### 乐观回显的撤下条件（`pendingEcho`）

同一个 reducer 里维护 `pendingEcho`：本帧条目里出现**同文本的 user 条目**（宿主确认），或**帧的 `sessionId` 与回显记录的不一致**（换会话了），即撤下。

**必须放在 reducer，不能放进组件 effect**：这样"何时撤下"与帧处理在同一处、同一时刻决定，组件不必再为此挂副作用，也不会出现"帧已到、effect 还没跑"的空窗。

**违反后果**：撤下条件写错或漏写，气泡不消失（宿主已确认，界面还挂着）或过早消失（换会话时残留的判断把新会话的回显撤掉）。

### `ui/draft` 与 `ui/draftRestore` 必须分成两个 action

前者是用户在输入框里的每一次编辑，必须**无条件覆盖**；后者是乐观发送失败后的回滚，**只在草稿仍为空时**才写回——否则这段时间里用户重新敲进去的内容会被旧文本冲掉。

### `settingsPane` 住在 store，不放组件的 `useState`

因为 `/model` 命令需要从组件外部直达"模型选择"行。两级关闭语义（`closePane` vs `closeSettings`）见 [../components/dialog.md](../components/dialog.md)。

### 命令合并放在 `catalog` reducer，不放 selector

合并结果被 `Composer`（补全）、`operations.send`（未登记命令拦截）、`helpText`（`/help` 文案）三处消费，放 reducer 里算一次，三处读到的是同一个稳定引用。

**违反后果**：放进 selector 会导致每次调用返回新数组，`useSelector` 每帧都判定"变了"，整棵树重渲染（见本层 [readme.md](readme.md) §规则「selector 不得新建引用」）。

### 新增一个 action 的步骤

1. **类型**：在所属切片的 `XxxAction` 联合里加成员（`type` 用 `切片/动作` 命名，如 `ui/settingsClosed`）；
2. **reducer**：加 `case`，注意"无变化时返回原 state"；
3. **creator**：在 `actions.ts` 加一个返回该类型的箭头函数，保持一行的形式；
4. **给组件用**：若组件不该直接 dispatch，就在 `operations.ts` 的 `Actions` 里加方法（见 [actions-and-operations.md](actions-and-operations.md)）；
5. 更新本文件与 [readme.md](readme.md) 的表格。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §根 reducer 必须手写，不用 `combineReducers` | 想改用 `combineReducers`、或遇到 `never` 推断报错时 |
| §帧合并三条规则缺一不可 | 加或改流字段时；**改帧处理前必读** |
| §流式内容块走标量 `liveContent`，不进 `items` | 想给流式块加合并/补间、或问"组件的流式状态存在哪"时 |
| §应答在途的撤下条件（`answering`） | 改确认卡的禁用与解禁、查"按钮点不动"时 |
| §乐观回显的撤下条件（`pendingEcho`） | 气泡不消失或过早消失时 |
| §`ui/draft` 与 `ui/draftRestore` 必须分成两个 action | 改输入草稿、发送失败回滚时 |
| §`settingsPane` 住在 store，不放组件的 `useState` | 改设置弹窗的打开路径（如 `/model` 直达）时 |
| §命令合并放在 `catalog` reducer，不放 selector | 动目录数据、改命令合并时机时 |
| §新增一个 action 的步骤 | 加 action 时逐步照做 |
| §`stream` 切片的字段与 action、§`catalog` 切片、§`ui` 切片 | 查某个字段或某个 action 的确切行为时 |

### `stream` 切片（`reducers/stream.ts`）

字段：`ChatScalarsView` 的全部标量（`ready` / `busy` / `cancelling` / `status` / `liveContent` / `pending` / `sessionId` …）+ `instanceId` + `revision` + `items` + `connected` + `pendingEcho` + `answering`（前端本地状态，不在协议里）。
初始值：`INITIAL_SCALARS` 加 `instanceId: ''`、`revision: -1`、`items: []`、`connected: false`、`pendingEcho: null`、`answering: null`。

| action | 行为 |
|---|---|
| `stream/frame` | 见 §规则「帧合并三条规则缺一不可」 |
| `stream/fatal` | 写入 `status` 并置 `connected: false`（宿主明确报错，不重试）；顺带清掉 `answering` |
| `stream/connected` | 只改 `connected`；值未变时返回原 state |
| `stream/pendingEchoSet` | 记录乐观回显（文本 + 当时的 `sessionId`） |
| `stream/pendingEchoClear` | 撤下回显 |
| `stream/answerStarted` | 记下正在应答的确认 id |
| `stream/answerSettled` | 只清掉与 id 相同的那一条（值未变时返回原 state） |

### `catalog` 切片（`reducers/catalog.ts`）

字段：`models`、`sessions`、`providers`、`canPersistCredentials`、`commands`。

`catalog/loaded` 把 `CatalogView` 摊平，并把宿主命令与本地命令**合并一次**（`mergeCommands`）后存进 `commands`；`catalog/sessions` 只更新会话目录，供后台任务状态实时显示。

合并为什么放在这里：见 §规则「命令合并放在 `catalog` reducer，不放 selector」。

### `ui` 切片（`reducers/ui.ts`）

字段：`switching`、`drafts`（`Record<string, string>`，键为会话 id）、`settingsOpen`、`settingsPane`、`sessionsOpen`、`collapsed`、`reveal`、`notice`、`problem`、`credentialProvider`。

| action | 行为 |
|---|---|
| `ui/notice` / `ui/problem` | 设置提示文本（`null` 表示清空） |
| `ui/settingsOpened` | 打开设置并指定 `pane`（同一切片上换行也用它），**同时关闭会话弹窗**（互斥在这里保证） |
| `ui/settingsClosed` | 关闭设置并清空 `pane` |
| `ui/sessionsOpened` | 打开会话弹窗，**同时关闭设置弹窗** |
| `ui/sessionsClosed` | 关闭会话弹窗 |
| `ui/collapsedSet` / `ui/collapsedToggled` | 侧栏形态（`collapsedSet` 值未变时返回原 state） |
| `ui/revealIncremented` | `/details`：递增展开计数 |
| `ui/credentialProviderSet` | 设置行当前显示的提供方 |
| `ui/switching` | 会话选择请求在途标记 |
| `ui/draft` | 更新指定 `sessionId` 的草稿 |
| `ui/draftRestore` | 发送失败时仅恢复仍为空的原会话草稿，保留用户新输入 |
