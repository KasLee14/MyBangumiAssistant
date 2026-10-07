# 切片与 reducer（`store/reducers/`）

## 简介

三个切片的字段与全部 action、帧合并的核心不变式、根 reducer 为什么手写，以及新增 action 的步骤。

**不覆盖**：动作层与异步编排（见 [actions-and-operations.md](actions-and-operations.md)）、SSE 订阅本身（见 [hooks-and-stream.md](hooks-and-stream.md)）。

上层：[readme.md](readme.md)。相关：[actions-and-operations.md](actions-and-operations.md)、[../utils/api.md](../utils/api.md)。

## 使用说明

- **改这个目录之前先读完 §规则**：帧合并、应答在途的撤下、乐观回显的撤下，以及 reducer 的「无变化时返回原 state」都在那里；违反会直接表现为界面残留旧状态、React key 重复或整棵树重渲染。
- **只想查某个字段或 action 的行为**：查 §索引 的三张清单表，不必通读 §规则。
- **改帧处理**：先读 §规则 的「帧合并三条规则缺一不可」，再动手改 `stream.ts`。
- **改流式正文的显示行为**：先读 §规则 的「正文与思考走增量帧」与「流式正文的显示投影与收尾播放」——`liveContent` / `pacedTarget` / `displayedContent` 三者分工不同，改错哪一份的表现都是肉眼可见的（"一次冒十几个字"、"最后一段整段跳出"）。
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

上面只列与「标量 + 条目」有关的部分：`stream/frame` 还要决定两个本地显示字段 `pacedTarget` / `displayedContent`（见 §规则「流式正文的显示投影与收尾播放」）。它们**不**参与这三条规则——条目合并仍只看 `id`（`version` 是宿主侧的重发判据），显示投影也允许在流式结束那一帧故意落后于权威值。

### 思考 / 工具 / 轮次三类条目走同一套条目合并，没有专属规则

`reasoning`、`tool`、`turn` 三类条目就是普通条目：进 `items`，与其余条目一样由 `mergeItems` **按 `id` 原地替换**（见上一条第 2 点）。两件事必须分清：

- **宿主**按 `id` + `version` 决定增量帧里重发哪些条目（`protocol.ts` 的 `TranscriptItemBase` 注释）：工具从「进行中」变完成、轮次条目封口时补齐 `endedAt` / `usage` / 计数，都会带同一个 `id` 与更高的 `version` 重发那一条；
- **浏览器**这边 `mergeItems` **只看 `id`、不比较 `version`**——同 `id` 一律替换，`version` 的递增只是宿主侧的判定依据。

所以 `frame.full` 为假时**也必须**能处理「同一 `id` 再次出现」：工具行的「进行中 → 完成」、轮控制行的耗时与计数，全靠这条。给这三类条目加「只在整表替换的帧里更新」之类的特判，界面就会永远停在「进行中」、轮次耗时永远不出现。

**流式期与它们无关的地方**：思考在流式期仍是标量 `liveThinking`（落条目发生在 `message_end`，见 `session.ts` 的 `flushReasoning`），工具则**一开始就是条目**（`tool_execution_start` 就 push 一条 `state: 'running'`）。因此过程区渲染的是 `items` 里的 `tool` / `reasoning` 条目，`liveThinking` 只服务流式区那一行思考（见 [../components/main-page.md](../components/main-page.md) §规则「思考行在流式期与历史期共用同一个组件」）。

**违反后果**：三类条目停在旧状态——工具行一直「进行中」、轮控制行的耗时与计数永不补齐。

### 流式内容块走标量 `liveContent`，不进 `items`

助手消息在流式期间**不进 `items`**：它的内容块放在标量 `liveContent`（`MessageBlock[]`）里随每帧覆盖，`message_end` 到了才把同一批块落成一个 `kind:'assistant'` 条目（`content: MessageBlock[]`）。所以上面三条帧合并规则**不需要为块做任何特殊处理**——块的增删改都发生在标量内部，条目合并仍然只看 `id` / `version`。

`liveContent` 与历史条目的 `content` 是**同一个类型、同一套渲染组件**（见 [../components/content.md](../components/content.md)），差别只有"是否处于流式期"（`pending` 与光标）。

**不要在 reducer 里对块做合并或补间**：块由宿主（或调试页的 simulator）投影成整份快照，reducer 只覆盖。这是"快照是唯一入口"那条契约在状态层的体现。

**违反后果**：在 reducer 里按 `contentIndex` 再实现一遍合并，等于把上游的快照语义抄成第二份；两处一旦不一致，就会出现"文本正常、组件错位"这类最难定位的问题。

**正文现在有两份，动手前先确认改的是哪一份**：`liveContent` 是宿主下发的**权威值**（随帧覆盖），`displayedContent` 是**屏幕上的那一份**，`pacedTarget` 是它正在追赶的目标（两者都是前端本地字段，由 `store/pacing.ts` 推进）。上面这条"reducer 只覆盖、不做补间"，说的是 `liveContent`；显示投影的推进与收尾规则见下一节。

### 正文与思考走增量帧（`stream/delta`）

`ServerEvent` 的 `stream` 分支只带**追加**部分，不携带条目：

```ts
{ type: 'stream'; instanceId: string; revision: number; delta: StreamDeltaView }
// StreamDeltaView = {
//   text: { index: number; delta: string } | null;   // 正文追加：活动文本块的下标 + 本次追加的文本
//   thinking: string;                                // 思考追加；空串表示没变
//   scalars: Omit<ChatScalarsView, 'liveContent' | 'liveThinking'>;  // 其余标量仍全量
// }
```

`stream/delta` 因此是**纯累加**：把 `delta.text.delta` 接在 `liveContent[delta.text.index]` 那块文本的尾部、把 `delta.thinking` 接在 `liveThinking` 的尾部，`delta.scalars` 照旧整份覆盖，并把 `pacedTarget` 同步为新的 `liveContent`（权威值动了，摊平目标必须跟着动）。它**不动** `displayedContent`：屏幕上的进度只由 `stream/paced` 推进。

两条守卫，缺一条就会把增量接到错的地方：

1. **实例相同且 `revision` 更大**——`frame.instanceId !== state.instanceId || frame.revision <= state.revision` 直接丢弃。增量是"相对上一帧"的差分，重放迟到的帧会让同一段文本接两遍；
2. **`delta.scalars.sessionId` 与当前会话一致**——不一致直接丢弃。换会话后的第一帧增量接不上旧正文。

下标越界、或那一格不是 `text` 块时，**只跳过正文累加、其余标量照旧写入**，不猜结构。

**"接不上就丢弃、不做增量回退"是协议约定，不是偷懒**：宿主（`takeLiveDelta` / `flushClient`）保证任何无法安全表达增量的情况——会话切换、历史重建、打断恢复重写回答、内容块结构变化、文本被改写、条目有变化——都改发**全量 `state` 帧**（自愈）。所以丢弃一帧不必自己设法补：随后的全量帧会整体覆盖（流式结束时清空正文本身也是一次全量帧，漏掉的文本不会被当成正确内容留在屏幕上）。自己写一套增量回退，反而会与宿主的判定分叉。

**违反后果**：漏守卫 → 文本重复一段或新会话接上旧正文；把 `displayedContent` 也一起累加 → 摊平失效，屏幕直接跟着上游的批次跳字；在这里写增量回退 → 与宿主自愈协议出现两套判定，出问题时无法判断以哪一套为准。

### 流式正文的显示投影与收尾播放

`StreamState` 里有三个正文数组，分工不能混：

| 字段 | 是什么 | 谁改 |
|---|---|---|
| `liveContent` | 宿主下发的**权威值**（协议标量，每帧整份覆盖） | `stream/frame`、`stream/delta` |
| `pacedTarget` | 摊平正在追赶的**目标** | 流式期等于 `liveContent`；流式结束那一帧被**冻住**；`stream/pacedDone` 清空 |
| `displayedContent` | **屏幕上的那一份**（组件经 `selectDisplayedContent` 读它） | `stream/paced` 推进；`stream/frame` 在本帧不进入收尾时跟随权威值；`stream/pacedDone` 清空 |

后两个是**前端本地字段**：协议里没有它们，`INITIAL_STREAM_STATE` 里都是 `[]`。

**为什么要有投影**：上游正文以**突发批次**到达（宿主每 16ms 合并一帧，实测每帧正文中位数 10 字符；窗口 40ms 时中位数 27 字符、单帧最多 127 字符）。按到达直接渲染就是"停一下、冒十几个字"。同期把窗口收到 16ms 并发增量帧之后，浏览器长任务从每轮 24 个（最大 286ms）降到 0 个；但每帧仍可能有几个到十几个字，所以显示要再按**时间**摊平一次（实测 59.5 字/秒）。

**代价必须知道**：上游正文实测约 330 字符/秒，是摊平速度的五倍多，显示必然滞后——500 字的回答写完时，屏幕上大约还要再播 6~7 秒。这是"看着像逐字"的固有代价，不是可以优化掉的开销。**思考文本不摊平**（思考动辄上千字，逐字播要几十秒）。

推进由 `store/pacing.ts` 的 `usePacing` 每帧算好后 dispatch：

| action | 行为 |
|---|---|
| `stream/paced`（creator `pacedUpdated(content)`） | 只改 `displayedContent`；**同引用直接返回原 state**（推进到"已经是目标值"时不该引起一次渲染） |
| `stream/pacedDone`（creator `pacedDone()`） | 把 `displayedContent` 与 `pacedTarget` **一起清空**，屏幕交回历史条目；两者本已为空时返回原 state |

**收尾播放**：`stream/frame` 里除了上面三条帧合并规则，还要决定这一帧要不要让投影"继续播完"：

```ts
const nextRound = frame.items.some(item => item.kind === 'user');
const tail = !switched && !nextRound
  && live.length === 0 && state.pacedTarget.length > 0 && state.displayedContent.length > 0;
// ...
pacedTarget: tail ? state.pacedTarget : live,
displayedContent: tail ? state.displayedContent : live,
```

即：**权威正文刚被清空**（`live.length === 0`，说明流式这一轮结束）、**不是换会话**、**本帧没有新的 `user` 条目**，且两个本地字段都非空时，把 `pacedTarget` / `displayedContent` **冻在上一帧的值上**，让剩下的字播完；其余情况两者都跟随权威值 `live`。

两个"不让位"的分支各对应一种错：

- **换会话**（`switched`）：整块状态重建，旧会话的尾巴不能带进新会话；
- **本帧出现新的 `user` 条目**（`nextRound`）：旧回答的尾巴若继续播，会挂在新问题下面。

**违反后果**：不冻住 → 最后一段直接跳出来（实测显示到 475/545 就消失，用户看到的是"回答没写完"）；把 `nextRound` 那条判据漏掉 → 旧回答的尾巴显示在新一轮问答下面；把 `live.length === 0` 那条判据漏掉（流式期就判定为收尾）→ 目标与投影一起冻住，屏幕上的正文停住不再增长。

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

### `ui.processOpen` 装过程区的展开状态，`undefined` 与 `false` 必须区分

```ts
case 'ui/processToggled':
  // 同值即无变化：展开状态由用户点击驱动，重复派发不该引起一次渲染。
  return state.processOpen[action.key] === action.open
    ? state
    : { ...state, processOpen: { ...state.processOpen, [action.key]: action.open } };
```

- **键的形态由 `utils/process.ts` 的两个 helper 定义**（整轮过程 `turnProcessKey(turn)`、单个过程行 `processRowKey(turn, id)`），组件不自己拼字符串——行键用的是**条目 `id`**（同一步里思考与工具会撞键），见 [../utils/process.md](../utils/process.md) §规则「展开状态的键由两个 helper 定义」；
- **`undefined`（没记录过）与 `false`（用户显式折叠过）必须区分**：消费侧 `Turn` 用「没记录 → 进行中的轮展开、历史轮折叠」的默认值，而用户一旦折过就一律以用户为准——把两者合并处理，用户就折不起进行中的轮次（每帧被默认值重新拉开）；
- **放 store 而不是组件的 `useState`**：这些行随流式帧反复重渲染，且轮次在会话切换时整体重建，组件私有状态会连同重建一起丢；
- 同值不新建对象（与其它 `ui` action 一致）：展开动作由用户点击驱动，重复派发不该引起一次渲染。

工具行**子调用**的开合是刻意的例外：它留在 `ToolRow` 内部的 `useState`，粒度太细，不值得进全局状态。

**违反后果**：`false` 与 `undefined` 合并处理 → 折叠点了没反应；放进组件 `useState` → 切会话后展开状态随机重置。

### 命令合并放在 `catalog` reducer，不放 selector

合并结果被 `Composer`（补全）、`operations.send`（未登记命令拦截）、`helpText`（`/help` 文案）三处消费，放 reducer 里算一次，三处读到的是同一个稳定引用。

**违反后果**：放进 selector 会导致每次调用返回新数组，`useSelector` 每帧都判定"变了"，整棵树重渲染（见本层 [readme.md](readme.md) §规则「selector 不得新建引用」）。

### `ui/pinnedToggled` 只改数组，落盘交给订阅

置顶是**纯前端状态**（宿主协议里没有这一项），`ui/pinned: string[]` 只装会话 id：

```ts
case 'ui/pinnedToggled': {
  // 新数组（而不是原地 splice）：订阅处用引用比较判断「值真的变了」，原地改会漏掉落盘。
  const pinned = state.pinned.includes(action.sessionId)
    ? state.pinned.filter(id => id !== action.sessionId)
    : [action.sessionId, ...state.pinned];
  return { ...state, pinned };
}
```

两条要点：

1. **必须返回新数组**（置顶项放到最前，取消置顶按 id 过滤）——落盘订阅靠**引用比较**过滤掉其它 action 引起的通知，原地 `push` / `splice` 会让「引用没变 = 值没变」的判据失效，置顶就写不进 `localStorage`；
2. **不要在这里碰 `localStorage`**：reducer 保持纯净（只改 state），落盘只在 `store/index.ts` 的一处 `store.subscribe` 里发生，读写封装在 `utils/pinnedStorage.ts`（见 [selectors-and-instance.md](selectors-and-instance.md) §规则）。

宿主会话列表里已经没有这条会话时，**不清理** `ui.pinned` 里的记录——那是侧栏的惰性忽略（`sessions.find(...)` 找不到就不渲染），不是 reducer 的职责。

**违反后果**：置顶刷新后丢失（引用没变，订阅跳过），或 reducer 产生副作用、时序与可测性同时变差。

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
| §思考 / 工具 / 轮次三类条目走同一套条目合并，没有专属规则 | 给这三类条目加合并特判、或工具行停在「进行中」时 |
| §流式内容块走标量 `liveContent`，不进 `items` | 想给流式块加合并/补间、或问"组件的流式状态存在哪"时（先分清权威值与显示投影） |
| §正文与思考走增量帧（`stream/delta`） | 改增量帧的累加与守卫、排查"文本重复一段 / 新会话接上旧正文"时 |
| §流式正文的显示投影与收尾播放 | 动 `displayedContent` / `pacedTarget`、排查"一次冒十几个字""最后一段整段跳出"时 |
| §应答在途的撤下条件（`answering`） | 改确认卡的禁用与解禁、查"按钮点不动"时 |
| §乐观回显的撤下条件（`pendingEcho`） | 气泡不消失或过早消失时 |
| §`ui/draft` 与 `ui/draftRestore` 必须分成两个 action | 改输入草稿、发送失败回滚时 |
| §`settingsPane` 住在 store，不放组件的 `useState` | 改设置弹窗的打开路径（如 `/model` 直达）时 |
| §`ui.processOpen` 装过程区的展开状态，`undefined` 与 `false` 必须区分 | **改过程区折叠行为、或折叠点了没反应 / 进行中的轮被重新拉开时必读** |
| §命令合并放在 `catalog` reducer，不放 selector | 动目录数据、改命令合并时机时 |
| §`ui/pinnedToggled` 只改数组，落盘交给订阅 | 改置顶行为、或置顶刷新后丢失时 |
| §新增一个 action 的步骤 | 加 action 时逐步照做 |
| §`stream` 切片的字段与 action、§`catalog` 切片、§`ui` 切片 | 查某个字段或某个 action 的确切行为时 |

### `stream` 切片（`reducers/stream.ts`）

字段：`ChatScalarsView` 的全部标量（`ready` / `busy` / `cancelling` / `status` / `liveContent` / `pending` / `sessionId` …）+ `instanceId` + `revision` + `items` + `connected` + `pendingEcho` + `answering` + `displayedContent` / `pacedTarget`（后三者是前端本地状态，不在协议里）。
初始值：`INITIAL_SCALARS` 加 `instanceId: ''`、`revision: -1`、`items: []`、`connected: false`、`pendingEcho: null`、`displayedContent: []`、`pacedTarget: []`、`answering: null`。

`items` 里除文本条目外还有三类**结构化条目**：`reasoning`（思考）、`tool`（工具调用，含 `subCalls` 与结果内容块）、`turn`（轮次边界与元数据）。它们不额外占标量——过程区与轮控制行都从 `items` 里读（见 §规则「思考 / 工具 / 轮次三类条目走同一套条目合并」）。

| action | 行为 |
|---|---|
| `stream/frame` | 见 §规则「帧合并三条规则缺一不可」；另按 §规则「流式正文的显示投影与收尾播放」决定 `pacedTarget` / `displayedContent` |
| `stream/delta` | 见 §规则「正文与思考走增量帧（`stream/delta`）」：只累加 `liveContent` / `liveThinking` 与覆盖 `scalars`，并同步 `pacedTarget` |
| `stream/paced` | 只写 `displayedContent`（摊平推进一格；同引用时返回原 state） |
| `stream/pacedDone` | 摊平播完：`displayedContent` 与 `pacedTarget` 一起清空（本已为空时返回原 state） |
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

字段：`switching`、`drafts`（`Record<string, string>`，键为会话 id）、`settingsOpen`、`settingsPane`、`lastSettingsPane`、`sessionsOpen`、`collapsed`、`pinned`（`string[]`，置顶会话 id，按置顶顺序）、`reveal`、`processOpen`（过程区展开状态表，键见 [../utils/process.md](../utils/process.md)）、`notice`、`problem`、`credentialProvider`。
初始值：`INITIAL_UI_STATE` 里 `pinned: []`、`processOpen: {}`；真实初值在 `store/index.ts` 里从 `localStorage` 读入（`loadPinned()`）。

| action | 行为 |
|---|---|
| `ui/notice` / `ui/problem` | 设置提示文本（`null` 表示清空） |
| `ui/settingsOpened` | 打开设置并指定 `pane`（同一切片上换行也用它），**同时关闭会话弹窗**（互斥在这里保证） |
| `ui/settingsClosed` | 关闭设置并清空 `pane` |
| `ui/sessionsOpened` | 打开会话弹窗，**同时关闭设置弹窗** |
| `ui/sessionsClosed` | 关闭会话弹窗 |
| `ui/collapsedSet` / `ui/collapsedToggled` | 侧栏形态（`collapsedSet` 值未变时返回原 state） |
| `ui/pinnedToggled` | 置顶 / 取消置顶指定会话（**每次都返回新数组**，落盘由 store 订阅负责，见 §规则） |
| `ui/revealIncremented` | `/details`：递增展开计数（消费侧是 `TurnProcessBar` 的 `reveal`，递增即强制展开整轮过程） |
| `ui/processToggled` | 写 `processOpen[key]`（整轮过程或单个过程行）；同值返回原 state，见 §规则 |
| `ui/credentialProviderSet` | 设置行当前显示的提供方 |
| `ui/switching` | 会话选择请求在途标记 |
| `ui/draft` | 更新指定 `sessionId` 的草稿 |
| `ui/draftRestore` | 发送失败时仅恢复仍为空的原会话草稿，保留用户新输入 |
