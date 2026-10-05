# 调试页（`web/src/page/debug/`）

## 简介

调试页：**左侧填 JSON、右侧用真实渲染链路预览结果**的开发期页面。它把宿主 `WebSession.handleEvent` 的入参（event）或宿主下发的 state 帧（frame）单独喂进来，看会话区会长成什么样，不必真的发起一次对话。

**不覆盖**：hash 入口开关（见 [../utils/debugMode.md](../utils/debugMode.md)）、调试页皮肤（见 [../styles/debug.md](../styles/debug.md)）、主界面装配（见 [main-page.md](main-page.md)）、宿主 `handleEvent` 的本体（`bangumi/src/web/session.ts`）。

上层：[readme.md](readme.md)；跨层规则：[AGENTS.md](../../../AGENTS.md)。

### 三个文件的分工

| 文件 | 职责 |
|---|---|
| `index.tsx` | 装配：建调试专用 store、解析两个输入框、按字符播放、把结果交给 `<Stage>`；导出 `DebugPage`（内部是 `DebugShell` 与 `DebugHero`） |
| `simulator.ts` | 纯映射：event（或一个 flush 窗口的 event 数组）→ frame，是宿主 `handleEvent` 加 `server.ts` 合并行为的复刻；不碰 React、不碰 DOM、不读 store。唯一例外是内容条目的 custom 分支，它调宿主侧共享的 `customContentDraft` |
| `DebugInputPanel.tsx` | 左侧输入区：两个 textarea、6 个 mock 用例按钮、预览 / 清空并重置、状态栏；另在顶栏（`SidebarBrand` 的 children）挂了一个「组件库」链接（`./library.html`，新标签）；纯 props 驱动 |

### 与主界面的关系

两个页面由 `main.tsx` 的 `Root` 按 hash 互斥挂载（见 [readme.md](readme.md) §规则「新增一个页面时」）。调试页自带一个 store（`createStore(rootReducer, …)`），主 store 完全隔离；调试期间不建立 SSE、不拉目录，全程不需要宿主。

## 使用说明

- **改这三个文件之前先读 §规则**：数据隔离、必须复用 `<Stage>`、simulator 与宿主的复刻关系、`play` 语义、首帧 `instanceId`、`parseInputs` 的优先级都在那里；违反的后果分别是污染真实会话、预览与真实会话不一致、首帧被 reducer 当成增量帧。
- **想把某条宿主事件加进调试页**：先读 §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」里的三步，再查 §索引 的「符号一览」。
- **只想查某个符号在哪、某条 event 映射成什么**：直接查 §索引 的三张表（文件 → 场景、符号一览、章节 → 场景），不必通读 §规则。
- **只改外观或入口**：外观去 [../styles/debug.md](../styles/debug.md)，入口开关去 [../utils/debugMode.md](../utils/debugMode.md)。
- **想模拟一次 40ms 合并窗口**：event 框填**数组**，整批会在预览时合并成**一帧**（对应宿主 `server.ts` 的 flush），所以界面只呈现批次结束时的状态——中间态（工具「进行中」、流式半成品）本来就到不了浏览器。想看清中间态就一次只喂一条。规则见 §规则「event 数组 = 一个 flush 窗口，合并成一帧」。
- **想在调试页看内容组件（12 种 kind）**：event 框粘一条 custom 消息即可，不必先发 user 消息（预览区会自建一个轮次）：

  ```json
  {"type":"message_end","message":{"role":"custom","customType":"infobox","display":true,"details":{"info":{"title":"轻音少女","rows":[{"label":"放送开始","value":"2009-04-03"}]}}}}
  ```

  `customType` 换注册表里的 kind 名，`details` 换成该 kind 的载荷本体（多数 kind 是带字段名的包装，如 infobox 的 `{ info: {…} }`；`tags` 是数组本身 `{ tags: […] }`）；`display` 为 `false` 时不产生条目。映射逻辑见 §规则「内容条目的 custom 分支走共享纯函数」。未知 `customType` 在预览区什么都不显示，但会在控制台留一条 `[content] 未登记的内容 kind「…」，该条目已丢弃。`（同一个 kind 只报一次）。

## 规则

### 调试数据不得进入主 store

`DebugPage` 用 `useMemo` 建一个**只属于调试页**的 store，并用 `<Provider>` 只包住 `DebugShell`：

```ts
createStore(rootReducer, {
  ...INITIAL_ROOT_STATE,
  stream: { ...INITIAL_ROOT_STATE.stream, instanceId: DEBUG_INSTANCE_ID, revision: -1 },
})
```

所有调试帧（`{ type: 'stream/frame', frame }`）都 dispatch 到这个 store。

**为什么**：主 store 承载着真实会话的流式状态与乐观回显，调试帧一旦进去，切回主界面就会看到凭空多出来的条目与错乱的 `revision`。reducer 用的是**同一份** `rootReducer`，所以"预览所见 = 真实会话所见"靠的是同一套合并语义，而不是复制一份 reducer。

**违反后果**：调试内容混进真实会话，界面出现幽灵条目。

### 预览必须复用 `<Stage>`，不得另写一套渲染

右侧预览直接渲染 `components/mainPage/conversation/Stage`，props 与 `Shell` 给的那一组同形：`items` / `liveText` / `liveThinking` / `busy` / `status` / `cancelling` / `startedAt` / `sessionId` / `reveal` / `hero` / `onConfirm` / `onReject`。左侧「展开过程」按钮自增 `reveal`，等价于会话里的 `/details`。

**为什么**：`Stage` 连同 `Turn` / `Streaming` / `ContentItem` / `Markdown` 都是 props 驱动的展示组件（[../components/readme.md](../components/readme.md) §规则「展示组件一律 props 驱动」）。复用它们，调试页才真的在"预览真实渲染"；另写一套渲染，预览只是一张示意图，第一处漂移之后就再也对不上。

`onConfirm` / `onReject` 在调试页是**空实现**：应答写入确认需要宿主，而调试页全程不连宿主。

**违反后果**：预览与真实会话出现第二套渲染，调试结论不可信。

### `simulator.ts` 是宿主 `handleEvent` 的复刻

`applyEvent(state, event)` 逐条对照 `bangumi/src/web/session.ts` 的 `handleEvent` 写：条目生成、标量改写、`message_start` 的 user 去重（`echoPending`）、`tool_execution_end` 对同一条 activity 的**原地更新并 `version + 1`**（不递增版本，增量帧不会重发，界面就停在「进行中」）。

**两处刻意差异**（文件注释里也写了）：notice 文案只保留与调试相关的少数几条；`redactText` 是简化实现（调试页不经手真实凭据，只挡 `sk-…` / `Bearer …` 形状）。另有一处**结构性差异**：宿主把 `liveText` 的累加与 `emit()` 分开（`message_update` 不单独下发），调试页一次只喂一个 event，所以让 delta 也产出一帧，否则看不到变化。

**改宿主逻辑时这份要跟着核**：动了 `handleEvent` 的分支、字段名或 `emit` 时机，就要回来确认这里是否还等价。新增一条 event 支持走三步：

1. 在 `applyEvent` 里加 `case`（缺了会落到 `default` 并抛「未支持的事件类型「…」。」）；
2. 把类型名加进 `SUPPORTED_EVENTS`；
3. 按需要给 `DebugInputPanel` 的 `SAMPLES` 加一个用例。

**例外**：`message_end` 的 custom 分支（内容条目）**不是**复刻，它调的是跨端共享的纯函数，见下一节。

**违反后果**：调试页给出与真实宿主不同的结论，据此去改宿主会改错地方。

### event 数组 = 一个 flush 窗口，合并成一帧

event 输入框接受两种形状：单个 `AgentSessionEvent` 对象，或它的**数组**。数组表示**一个 flush 窗口内的一批事件**，语义对应宿主：`handleEvent` 每收到一条就改会话状态，`server.ts` 的 `schedule()` 用 40ms 定时器把窗口内的改动合并成**一帧**（`flush()` → `flushClient()` → `writeEvent()`）经 SSE 下发。所以一批 N 条事件在预览区只产**一帧**，"已处理 event" 计数按元素个数累加，而"已提交帧"只 +1。

实现是 `simulator.ts` 的 `applyEvents`：多条时依次复用 `applyEvent`（同一个 state 连续生效），**只保留最后一步**。每一步的 `emit` 都基于 `state.items` 的全量快照，因此最后一帧天然包含整批变更；被丢弃的中间帧在真实链路上本来也会被后续帧覆盖。流式区同理——批次末尾若清空了流式区（如 `message_end`），`play` 就是空串。

**单条 event 不走合并**：仍原样返回 `applyEvent` 的每一步。一个事件刻意可能产多帧（例如 `message_update` 也提交一帧，否则逐字过程看不见），那是调试页与真实链路的已知结构性差异，不属于 flush 语义。

**数组校验**：必须非空，逐项是 JSON 对象且带非空字符串 `type`；报错指明是第几项（`event 数组第 2 项缺少 type 字段。`）。空数组按错误处理，而不是"什么都不做"。

**违反后果**：把一批事件按条逐帧提交，预览里会看到真实浏览器永远看不到的中间态（工具「进行中」一闪而过），据此判断界面行为会得出错误结论。

### 内容条目的 custom 分支走共享纯函数，不复刻

宿主 `session.ts` 的两条路径（`message_end` 的事件分支、`rebuild()` 的 `custom_message` 分支）与调试页 `simulator.ts` 的 `message_end` 调的是**同一个** `customContentDraft()`，定义在 `bangumi/src/web/custom-content.ts`：它只按「`display` 为 true、`customType` 是非空字符串、`details` 是对象」三条通用条件把载荷原样展开成 `{ …details, kind: customType }`，不知道有哪些 kind，也不知道每种 kind 的载荷字段名。

**为什么共享**：这类映射一旦在调试页手写一份，判定条件会各自演化，而调试页的全部价值就在于"预览所见 = 真实会话所见"。共享之后调试页演练的仍是宿主真实逻辑，只有事件入口是复刻的。

**跨端 import 的两条约束**：

- 该模块只允许 `import type`（宿主侧 `NodeNext` 因此能解析 `./protocol.js`，而浏览器侧 Vite 打包根本看不到这条 import，不会去解析 `./protocol.js` 这个不存在的文件）；
- 它已登记在 [../../../tsconfig.json](../../../tsconfig.json) 的 `include` 里；新增同类共享模块时照此登记，否则 `npm run typecheck` 的 web 一阶段看不到它。

`message_end` 的 custom 分支 `play` 传 `KEEP`：custom 消息与流式区无关，不像助手回答那样要清空流式区。

**违反后果**：两处各自维护一份 custom 映射，判定条件漂移（例如一处认 `display === true`、另一处不看 `display`），调试结论不再可信。

### `play` 的语义：`KEEP` 哨兵与空串

`applyEvent` 返回 `SimStep[]`，每步带一个 `play`：这一帧**播放完之后**流式区应该显示的文本。

| `play` | 含义 | 页面行为 |
|---|---|---|
| `KEEP`（`Symbol('keep-live-text')`） | 这一步不改动流式区当前内容 | 用 `step.frame.state.liveText` 覆盖显示 |
| 非空字符串 | 该帧播放完后的流式文本 | 交给 `playText` 逐字演出来 |
| 空串 | 清空流式区 | 立即清空，不做补间 |

`message_end` 传的正是空串：提交这一帧时流式区被清空，而文本已经落成历史条目——「流式区消失、条目出现」的交接因此是可观察的。

**违反后果**：流式区停在上一帧的文本上，交接过程看不见。

### 逐字播放由 `playText` 驱动，`displayLiveText` 是受控 prop

- `displayLiveText` 是**受控**的流式文本：`<Stage liveText={displayLiveText}>` 显示它，而不是读 store 里的 `liveText`——逐字播放发生在 reducer 之外，store 里只保留「已提交帧」的状态。
- `playText` 每 `TICK_MS`（24ms）提交 `CHARS_PER_TICK`（2）个字符，对应宿主约 40ms 一帧的观感；`frame` 通道不做补间（那一帧本来就是最终状态）。
- `playToken`（ref）是**取消令牌**：`runPreview` 开始时自增并记下 token，`playText` 每步比对，不一致立刻 `return`；组件卸载时也自增一次，避免对已卸载组件 setState。
- `commit(frame, showInInput)` 在提交后将帧的 JSON 写回 frame 输入框；`resetAll` 会先停止播放、重建 `simulator`、提交一帧空快照，再清空全部输入与计数。

**违反后果**：在途播放写到下一次预览上，两段文本互相覆盖。

### 首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`，重置时 `revision` 必须接上

调试 store 的初始 `stream` 用 `instanceId: DEBUG_INSTANCE_ID` + `revision: -1`；`simulator.ts` 的 `emit` 与 `resetAll` 提交的帧也一律带 `DEBUG_INSTANCE_ID`（`'debug-instance'`）。

**为什么**：`store/reducers/stream.ts` 用

```ts
if (frame.instanceId === state.instanceId && frame.revision < state.revision) return state;
const switched = frame.instanceId !== state.instanceId || frame.state.sessionId !== state.sessionId;
const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
```

判定帧是否该收、条目是整体替换还是增量合并，而 `INITIAL_STREAM_STATE.instanceId` 是**空串**。首帧若也带空串，它就会被当成「同实例的增量帧」而不是整体替换；`revision` 同时压到 -1，让首帧不被 `frame.revision < state.revision` 的守卫丢弃。

**`resetAll` 的编号必须接上当前已提交的编号**：`revision` 从 `store.getState().stream.revision + 1` 起算（并据此给 `createSimulatorState` 传起点），不能再压回 0。压回 0 会让重置帧与之后所有新预览帧都小于 store 里的编号而被**静默丢弃**——表现是「点了清空并重置、又点了预览，界面却还停在上一个用例」。

**违反后果**：首帧按增量合并，调试页的合并语义与真实会话不同；或重置失效、预览无反应。

### `parseInputs`：event 非空优先

两个框都填时**以 event 为准**（event 非空即忽略 frame），提交后把 event 生成的帧写回 frame 框（`DebugInputPanel` 的 `frameAuto` 会提示它会被覆盖）。event 部分是 JSON **对象或数组**：对象必须带非空字符串 `type`；数组不能为空且逐项都要满足同样条件，报错指明第几项。frame 必须是 JSON 对象且 `type === 'state'`、`items` 是数组、`state` 是对象，`instanceId` / `revision` / `full` 缺省时分别补 `DEBUG_INSTANCE_ID` / `0` / `true`。两个框都空时报「请先填入 event 或 frame。」。

**frame 通道会改写 `revision`**：手工粘贴的帧没有「序列」语义（组件库文档页生成的帧里 `revision` 恒为 1），而 store 里的编号随每次预览增长，直接用会被 `streamReducer` 的「同实例旧帧」守卫丢掉——表现就是「点了预览什么都没发生」。所以 `runPreview` 在提交前把 `revision` 接到 `store.getState().stream.revision + 1`。**这一行不要删**：删了之后从组件库复制 frame 粘贴会静默失效。

**违反后果**：预览依据与用户以为的不一致（改了 frame 却没生效，或数组少写一项却当整批处理）。

### 顶栏的「组件库」入口是新标签 `<a>`，用组合类 `.debugLink`

`DebugInputPanel.tsx` 把入口作为 `SidebarBrand` 的 children 传入，位置在既有的「返回」按钮**之前**——顶栏顺序因此是「Bangumi 助手 | 组件库 | 返回」（品牌行右侧的两个控件同尺寸，实机测到的紧凑尺寸是 54×24）：

```tsx
<a className="debugButton debugLink" data-compact="true" href="./library.html" target="_blank" rel="noreferrer"
   title="打开内容组件库文档（新标签页，不丢当前输入）">组件库</a>
```

三个刻意的选择：

1. **新标签打开**（`target="_blank"` + `rel="noreferrer"`）：调试页的输入只在内存里，同标签跳走就会丢；
2. **用 `<a>` 而不是 `<button>`**：中键与右键都能"在新标签页打开"，`<button>` 不行；形态复用既有的 `.debugButton`，只加 `data-compact="true"` 压尺寸；
3. **新增组合类 `.debugLink`**（在 [../styles/debug.md](../styles/debug.md) 与 `styles/debug.css`，只补 `text-decoration: none`）：给既有组件类加属性要起组合类，不在第二个文件里改 `.debugButton` 本身。

`href` 是相对路径 `./library.html`：与 [library.md](library.md) §使用说明「开发期打开这一页」指的是同一份产物，**不经过宿主**。

**违反后果**：改成同标签跳转会丢调试输入，改成 `<button>` 会让中键/右键新标签打开失效；把 `text-decoration` 写进 `.debugButton` 则让按钮基元多出一条只服务链接的属性。

## 索引

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 改调试页任何一处之前；想知道"预览为什么等于真实会话"时 |
| `index.tsx` | 改输入解析、播放节奏、预览装配、重置逻辑时 |
| `simulator.ts` | 加事件支持、核对宿主映射、确认 `play` 语义时 |
| `DebugInputPanel.tsx` | 改左侧输入区、加 mock 用例、改状态栏、或改顶栏的「组件库」入口时 |
| [../utils/debugMode.md](../utils/debugMode.md) | 改调试页入口（hash 开关）时 |
| [../styles/debug.md](../styles/debug.md) | 改调试页皮肤时 |

### 符号一览

| 符号 | 位置 | 作用 | 什么时候读 |
|---|---|---|---|
| `DebugPage` | `index.tsx` | 建独立 store + `Provider`，导出给 `Root` | 改 store 装配、隔离边界时 |
| `DebugShell` | `index.tsx` | 预览区装配：输入状态、播放、`<Stage>` 接线 | 改播放与预览行为时 |
| `DebugHero` | `index.tsx` | 空态提示（无条目且无流式文本时） | 改首屏提示文案时 |
| `createDebugStore` | `index.tsx` | 用 `rootReducer` + 调试初始 `stream` 建 store | 改调试 store 初始值时 |
| `parseInputs` | `index.tsx` | 解析两个输入框，event 优先，返回帧或错误；event 支持对象或数组（数组逐项校验） | 改输入校验、报错文案时 |
| `commit` / `resetAll` | `index.tsx` | 提交帧（并回写输入框）/ 停播 + 重置全部；`resetAll` 的 `revision` 接上当前编号 | 改提交与重置语义时 |
| `playText` / `playToken` / `CHARS_PER_TICK` / `TICK_MS` | `index.tsx` | 逐字播放与取消令牌、播放节奏常量 | 调播放节奏、改取消逻辑时 |
| `applyEvent` | `simulator.ts` | event → `SimStep[]`（13 种事件 + `default` 抛错） | 加事件、核对宿主映射时 |
| `applyEvents` | `simulator.ts` | 一批 event → `SimStep[]`：单条原样走 `applyEvent`，多条合并成一帧（对应宿主 40ms flush） | 改批量语义、排查"数组预览只出一帧"时 |
| `createSimulatorState` / `SimulatorState` | `simulator.ts` | 模拟器的私有状态（`nextItemId`、`items`、`activities`、`echoPending`、标量）；第二参数是帧编号起点，重置时要接上当前编号 | 改状态字段、看 `activities` 索引时 |
| `SimStep` / `KEEP` | `simulator.ts` | 一步的结果与「不改动流式区」哨兵 | 改 `play` 语义时 |
| `DEBUG_INSTANCE_ID` | `simulator.ts` | 首帧与每帧的 `instanceId` | 改帧的实例标识时 |
| `SUPPORTED_EVENTS` | `simulator.ts` | 13 种已知事件名的清单；**当前没有调用方**（`applyEvent` 的 `default` 用的是字面量报错），加事件时按它对齐 | 加事件、核对清单时 |
| `messageText` / `resultDetail` / `redactText` | `simulator.ts` | 对应宿主同名辅助函数；`redactText` 是简化脱敏 | 核对文本提取与脱敏时 |
| `customContentDraft` | `bangumi/src/web/custom-content.ts`（宿主侧，被 `simulator.ts` 调用） | custom 消息 → 内容条目草稿的通用映射：`display` 为 true、`customType` 非空、`details` 是对象时展开成 `{ …details, kind }`；**宿主与调试页共用这一份** | 加内容来源、核对 custom 映射、调试页内容条目不显示时 |
| `DebugInputPanel` / `DebugInputPanelProps` | `DebugInputPanel.tsx` | 左侧输入区组件与它的 props 契约；组件同时负责顶栏的「组件库」链接（`<a href="./library.html" target="_blank">`） | 改 props、加输入控件、改顶栏入口时 |
| `SAMPLES` | `DebugInputPanel.tsx` | 6 个 mock 用例（用例 2、3 必须按顺序；用例 5 走 frame 通道，会先清空 event；用例 6 是 event 数组，演示一个 flush 窗口） | 加或改用例时 |
| `MODE_LABEL` | `DebugInputPanel.tsx` | 「当前依据」三态文案（`event` / `frame` / `none`） | 改状态栏措辞时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「三个文件的分工」 | 找某个改动该落在哪个文件时 |
| §简介「与主界面的关系」 | 疑惑调试期间会不会连宿主、会不会污染主 store 时 |
| §规则「调试数据不得进入主 store」 | 动 store 装配、想复用主 store 时 |
| §规则「预览必须复用 `<Stage>`，不得另写一套渲染」 | 想给预览写专门渲染时 |
| §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」 | **改了宿主 `handleEvent`、或要加一条 event 支持时必读** |
| §规则「event 数组 = 一个 flush 窗口，合并成一帧」 | **改批量输入、纳闷"数组为什么只出一帧"时必读** |
| §规则「内容条目的 custom 分支走共享纯函数，不复刻」 | 内容条目在调试页不出现、或要给宿主加内容来源时 |
| §规则「`play` 的语义：`KEEP` 哨兵与空串」 | 流式区没有按预期变化时 |
| §规则「逐字播放由 `playText` 驱动，`displayLiveText` 是受控 prop」 | 调播放节奏、改取消逻辑时 |
| §规则「首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`，重置时 `revision` 必须接上」 | 首帧条目被合并而不是替换时；点了重置/预览却像没反应时 |
| §规则「`parseInputs`：event 非空优先」 | 两个输入框同时有内容、或预览报输入错误时 |
| §规则「顶栏的「组件库」入口是新标签 `<a>`，用组合类 `.debugLink`」 | 改顶栏入口、或想把跳转改成同标签 / `<button>` 时 |
