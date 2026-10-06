# 调试页（`web/src/page/debug/`）

## 简介

调试页：**左侧填 JSON、右侧用真实渲染链路预览结果**的开发期页面。它把宿主 `WebSession.handleEvent` 的入参（event）或宿主下发的 state 帧（frame）单独喂进来，看会话区会长成什么样，不必真的发起一次对话。

**不覆盖**：hash 入口开关（见 [../utils/debugMode.md](../utils/debugMode.md)）、调试页皮肤（见 [../styles/debug.md](../styles/debug.md)）、主界面装配（见 [main-page.md](main-page.md)）、宿主 `handleEvent` 的本体（`bangumi/src/web/session.ts`）。

上层：[readme.md](readme.md)；跨层规则：[AGENTS.md](../../../AGENTS.md)。

### 四个文件的分工

| 文件 | 职责 |
|---|---|
| `index.tsx` | 装配：建调试专用 store、解析两个输入框、按字符播放；外壳**复用主界面的同一套类**——`.appFrame[data-mode='debug']` 上装配共享 `AppTopBar`（品牌双击返回主界面 + 栏目「调试页」+ 动作区「组件库」/「返回主界面」），下面是「输入列 `aside.appSidebar` \| 预览」两列。导出 `DebugPage`（内部是 `DebugShell`） |
| `simulator.ts` | 纯映射：event（或一个 flush 窗口的 event 数组）→ frame，是宿主 `handleEvent` 加 `server.ts` 合并行为的复刻；不碰 React、不碰 DOM、不读 store。内容块的投影**不在这里实现**，它调宿主侧共享的 `message-blocks.ts` |
| `DebugInputPanel.tsx` | 左侧输入区：两个 textarea、8 个 mock 用例按钮、预览 / 清空并重置、状态栏；纯 props 驱动。品牌、顶栏入口与「返回主界面」都**不在**这里了（见 `index.tsx`） |
| `DebugPreview.tsx` | 右侧预览区：依据提示条（预览 / 通道 / 计数 / 展开过程 / 跳过动画）与 `<Stage>` 接线，渲染 `<main className="appConversation">`；空态 `DebugHero` 也在本文件 |

### 与主界面的关系

两个页面由 `main.tsx` 的 `Root` 按 hash 互斥挂载（见 [readme.md](readme.md) §规则「新增一个页面时」）。调试页自带一个 store（`createStore(rootReducer, …)`），主 store 完全隔离；调试期间不建立 SSE、不拉目录，全程不需要宿主。

外壳复用主界面那一套类：`.appFrame[data-mode='debug'][data-sidebar='expanded']` + `AppTopBar` + 输入列（`aside.appSidebar`）+ 预览区（`main.appConversation`）；输入列的宽度由 [../styles/debug.md](../styles/debug.md) 的 `.appFrame[data-mode='debug'] { --app-sidebar-width: 400px }` 声明（页面自己声明，不靠 `html[data-debug]` 提特异性）。`html[data-debug]` 属性仍由 `main.tsx` 的 `Root` 维护，但 `debug.css` 已不用它圈定作用域。主界面那套「抽屉锁宽 + 整体左移」只在**没有** `data-mode` 的外壳上生效（见 `frame.css`），所以调试页的输入列不会被锁宽、也不会左移。

> **已知不一致（待裁决）**：`.appFrame` 的网格已按 C01 收敛成 `grid-template-areas: 'side main'` 两格，`frame.css` 里不再有 `top` 行、也没有 `.appFrame > .appTopBar { grid-area: top }`。因此调试页的 `AppTopBar` **不在具名网格区域里**（实测被自动放置到隐式第二行、宽度等于输入列），与「顶栏横跨全宽、下面两列」的意图不符。本文件不按意图描述，等你裁决是补网格还是改结构。

## 使用说明

- **改这几个文件之前先读 §规则**：数据隔离、必须复用 `<Stage>`、simulator 与宿主的复刻关系、`play` 语义、首帧 `instanceId`、`parseInputs` 的优先级都在那里；违反的后果分别是污染真实会话、预览与真实会话不一致、首帧被 reducer 当成增量帧。
- **想把某条宿主事件加进调试页**：先读 §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」里的三步，再查 §索引 的「符号一览」。
- **只想查某个符号在哪、某条 event 映射成什么**：直接查 §索引 的三张表（文件 → 场景、符号一览、章节 → 场景），不必通读 §规则。
- **只改外观或入口**：外观去 [../styles/debug.md](../styles/debug.md)，入口开关去 [../utils/debugMode.md](../utils/debugMode.md)。
- **想模拟一次 40ms 合并窗口**：event 框填**数组**，整批会在预览时合并成**一帧**（对应宿主 `server.ts` 的 flush），所以界面只呈现批次结束时的状态——中间态（工具「进行中」、流式半成品）本来就到不了浏览器。想看清中间态就一次只喂一条。规则见 §规则「event 数组 = 一个 flush 窗口，合并成一帧」。
- **想在调试页看内容块（12 种 kind）**：event 框粘一条 `message_end`，`message.content` 里放这个块即可，不必先发 user 消息（预览区会自建一个轮次）：

  ```json
  {"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"InfoBox","props":{"title":"轻音少女","rows":[{"label":"放送开始","value":"2009-04-03"}]}}]}}
  ```

  把 `type` 换成上面那 12 个**组件名**之一，载荷放在 `props` 里——定制组件的块形状统一为 `{ type, pending?, props }`（`TagCloud` 的 `props` 是数组本身）。**加 `"pending": true` 就是骨架态**：预览区渲染骨架而不是真实数据，去掉它（或置 `false`）才校验并渲染——这是回归用例 `S12` 的核心。也可以粘 custom 消息（`{"role":"custom","customType":"infobox","display":true,"details":{…}}`）：宿主把它投影成只含一个块的条目，`display` 为 `false` 时不产生条目。映射逻辑见 §规则「内容块的投影走共享纯函数，不复刻」。未知 `type` 在预览区什么都不显示，但会在控制台留一条 `[content] 未登记的内容块 type「…」，该块已丢弃。`（同一个 type 只报一次）。

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

右侧预览直接渲染 `components/mainPage/conversation/Stage`，props 与 `Shell` 给的那一组同形：`items` / `liveContent` / `liveThinking` / `busy` / `status` / `cancelling` / `startedAt` / `sessionId` / `reveal` / `hero` / `onConfirm` / `onReject`。与主界面不同的是 `composer` 槽位**不传**——调试页没有输入区（粘性会话头已在 C34 决策中删除，`Stage` 上不再有对应槽位）。左侧「展开过程」按钮自增 `reveal`，等价于会话里的 `/details`。

**为什么**：`Stage` 连同 `Turn` / `Streaming` / `MessageBlocks` / `ContentBlock` / `Markdown` 都是 props 驱动的展示组件（[../components/readme.md](../components/readme.md) §规则「展示组件一律 props 驱动」）。复用它们，调试页才真的在"预览真实渲染"；另写一套渲染，预览只是一张示意图，第一处漂移之后就再也对不上。

`onConfirm` / `onReject` 在调试页是**空实现**：应答写入确认需要宿主，而调试页全程不连宿主。

**违反后果**：预览与真实会话出现第二套渲染，调试结论不可信。

### `simulator.ts` 是宿主 `handleEvent` 的复刻

`applyEvent(state, event)` 逐条对照 `bangumi/src/web/session.ts` 的 `handleEvent` 写：条目生成、标量改写、`message_start` 的 user 去重（`echoPending`）、`tool_execution_end` 对同一条 activity 的**原地更新并 `version + 1`**（不递增版本，增量帧不会重发，界面就停在「进行中」）。

**两处刻意差异**（文件注释里也写了）：notice 文案只保留与调试相关的少数几条；`redactText` 是简化实现（调试页不经手真实凭据，只挡 `sk-…` / `Bearer …` 形状）。另有一处**结构性差异**：宿主把内容块的投影与 `emit()` 分开（`message_update` 不单独下发），调试页一次只喂一个 event，所以让每次投影也产出一帧，否则看不到变化。

**改宿主逻辑时这份要跟着核**：动了 `handleEvent` 的分支、字段名或 `emit` 时机，就要回来确认这里是否还等价。新增一条 event 支持走三步：

1. 在 `applyEvent` 里加 `case`（缺了会落到 `default` 并抛「未支持的事件类型「…」。」）；
2. 把类型名加进 `SUPPORTED_EVENTS`；
3. 按需要给 `DebugInputPanel` 的 `SAMPLES` 加一个用例。

**例外**：内容块的投影（`message_update` 从 `partial.content` 投影、`message_end` 落块、以及 custom 分支）**不是**复刻，它调的是跨端共享的纯函数，见下一节。

**违反后果**：调试页给出与真实宿主不同的结论，据此去改宿主会改错地方。

### event 数组 = 一个 flush 窗口，合并成一帧

event 输入框接受两种形状：单个 `AgentSessionEvent` 对象，或它的**数组**。数组表示**一个 flush 窗口内的一批事件**，语义对应宿主：`handleEvent` 每收到一条就改会话状态，`server.ts` 的 `schedule()` 用 40ms 定时器把窗口内的改动合并成**一帧**（`flush()` → `flushClient()` → `writeEvent()`）经 SSE 下发。所以一批 N 条事件在预览区只产**一帧**，"已处理 event" 计数按元素个数累加，而"已提交帧"只 +1。

实现是 `simulator.ts` 的 `applyEvents`：多条时依次复用 `applyEvent`（同一个 state 连续生效），**只保留最后一步**。每一步的 `emit` 都基于 `state.items` 的全量快照，因此最后一帧天然包含整批变更；被丢弃的中间帧在真实链路上本来也会被后续帧覆盖。流式区同理——批次末尾若清空了流式区（如 `message_end`），`play` 就是空数组。

**单条 event 不走合并**：仍原样返回 `applyEvent` 的每一步。一个事件刻意可能产多帧（例如 `message_update` 也提交一帧，否则逐字过程看不见），那是调试页与真实链路的已知结构性差异，不属于 flush 语义。

**数组校验**：必须非空，逐项是 JSON 对象且带非空字符串 `type`；报错指明是第几项（`event 数组第 2 项缺少 type 字段。`）。空数组按错误处理，而不是"什么都不做"。

**违反后果**：把一批事件按条逐帧提交，预览里会看到真实浏览器永远看不到的中间态（工具「进行中」一闪而过），据此判断界面行为会得出错误结论。

### 内容块的投影走共享纯函数，不复刻

宿主 `session.ts` 的三条路径（`message_update` 从 `partial.content` 投影、`message_end` 的事件分支、`rebuild()` 的 `custom_message` 分支）与调试页 `simulator.ts` 的对应分支调的是**同一份** `bangumi/src/web/message-blocks.ts`：`blocksFromContent()`（含结构共享）、`blocksFromMessage()`、`customContentBlocks()`。它只排除 Pi 的原生块（`thinking` / `toolCall` / `image` / …），其余块原样透传——**宿主与调试页都不知道有哪些 kind、也不知道每种 kind 的载荷字段名**，形状是否合法由接收侧 `validateMessageBlock` 判定。

**为什么共享**：这类映射一旦在调试页手写一份，判定条件会各自演化，而调试页的全部价值就在于"预览所见 = 真实会话所见"。共享之后调试页演练的仍是宿主真实逻辑，只有事件入口是复刻的。块投影比旧的 custom 映射更容易漂移——它还要管 `pending` 与结构共享。

**跨端 import 的两条约束**：

- 该模块只允许 `import type`（宿主侧 `NodeNext` 因此能解析 `./protocol.js`，而浏览器侧 Vite 打包根本看不到这条 import，不会去解析 `./protocol.js` 这个不存在的文件）；
- 它必须放在 `bangumi/src/` 下：宿主 `tsconfig.json` 用 `include: ["src/**/*.ts"]` 覆盖它，web 侧则通过相对路径 import 解析；放到别处两边都可能看不到它。

`message_end` 的 custom 分支 `play` 传 `KEEP`：custom 消息与流式区无关，不像助手回答那样要清空流式区。

**违反后果**：两处各自维护一份投影，判定条件漂移（例如一处认 `pending === true`、另一处不看），调试结论不再可信。

### `play` 的语义：`KEEP` 哨兵与空数组

`applyEvent` 返回 `SimStep[]`，每步带一个 `play`：这一帧**播放完之后**流式区应该显示的块数组。

| `play` | 含义 | 页面行为 |
|---|---|---|
| `KEEP`（`Symbol('keep-live-content')`） | 这一步不改动流式区当前内容 | 用 `step.frame.state.liveContent` 覆盖显示 |
| 非空块数组 | 该帧播放完后的块数组 | 交给 `playBlocks` 演出来（只逐字演最后一个文本块） |
| 空数组 | 清空流式区 | 立即清空，不做补间 |

`message_end` 传的正是空数组：提交这一帧时流式区被清空，而块已经落成历史条目——「流式区消失、条目出现」的交接因此是可观察的。

**违反后果**：流式区停在上一帧的内容上，交接过程看不见。

### 逐字播放由 `playBlocks` 驱动，`displayBlocks` 是受控 prop

- `displayBlocks` 是**受控**的流式块数组：`<Stage liveContent={displayBlocks}>` 显示它，而不是读 store 里的 `liveContent`——逐字播放发生在 reducer 之外，store 里只保留「已提交帧」的状态。
- `playBlocks` **只逐字演最后一个文本块**，其余块（更早的文本块、内容块与骨架）直接显示：流式期增长的只有最后那一段文本；内容块的 `pending` 变化是一次状态切换，不做补间。每 `TICK_MS`（24ms）提交 `CHARS_PER_TICK`（2）个字符，对应宿主约 40ms 一帧的观感；`frame` 通道不做补间（那一帧本来就是最终状态）。
- `playToken`（ref）是**取消令牌**：`runPreview` 开始时自增并记下 token，`playBlocks` 每步比对，不一致立刻 `return`；组件卸载时也自增一次，避免对已卸载组件 setState。
- `commit(frame, showInInput)` 在提交后将帧的 JSON 写回 frame 输入框；`resetAll` 会先停止播放、重建 `simulator`、提交一帧空快照，再清空全部输入与计数。

**违反后果**：在途播放写到下一次预览上，两段内容互相覆盖；或每帧重播整段（包括已出现的内容块），骨架与真实数据来回闪烁。

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

入口在顶栏的**动作区**（`page/debug/index.tsx` 交给 `AppTopBar` 的 `actions`），与「返回主界面」并排——顶栏顺序因此是「品牌（双击返回）| 调试页 |（右）组件库 | 返回主界面」。它**不在** `DebugInputPanel` 里：输入面板只剩输入区本身，顶栏是装配层的事（见 §简介「四个文件的分工」）。两个控件都带 `data-compact="true"` 复用 `.debugButton` 的紧凑尺寸：

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
| `DebugInputPanel.tsx` | 改左侧输入区、加 mock 用例、改状态栏时（顶栏入口已不在这里） |
| `DebugPreview.tsx` | 改右侧预览条、空态提示、或预览给 `<Stage>` 传哪些 props 时 |
| [../utils/debugMode.md](../utils/debugMode.md) | 改调试页入口（hash 开关）时 |
| [../styles/debug.md](../styles/debug.md) | 改调试页皮肤时 |

### 符号一览

| 符号 | 位置 | 作用 | 什么时候读 |
|---|---|---|---|
| `DebugPage` | `index.tsx` | 建独立 store + `Provider`，导出给 `Root` | 改 store 装配、隔离边界时 |
| `DebugShell` | `index.tsx` | 调试页装配：顶栏、输入状态、播放，把受控的流式块交给 `DebugPreview`（`<Stage>` 接线在 `DebugPreview.tsx`） | 改播放与预览行为时 |
| `DebugHero` | `DebugPreview.tsx` | 空态提示（无条目且无流式文本时） | 改首屏提示文案时 |
| `createDebugStore` | `index.tsx` | 用 `rootReducer` + 调试初始 `stream` 建 store | 改调试 store 初始值时 |
| `parseInputs` | `index.tsx` | 解析两个输入框，event 优先，返回帧或错误；event 支持对象或数组（数组逐项校验） | 改输入校验、报错文案时 |
| `commit` / `resetAll` | `index.tsx` | 提交帧（并回写输入框）/ 停播 + 重置全部；`resetAll` 的 `revision` 接上当前编号 | 改提交与重置语义时 |
| `playBlocks` / `playToken` / `CHARS_PER_TICK` / `TICK_MS` | `index.tsx` | 块级逐字播放（只演最后一个文本块）与取消令牌、播放节奏常量 | 调播放节奏、改取消逻辑、改骨架/内容块的呈现时机时 |
| `applyEvent` | `simulator.ts` | event → `SimStep[]`（13 种事件 + `default` 抛错） | 加事件、核对宿主映射时 |
| `applyEvents` | `simulator.ts` | 一批 event → `SimStep[]`：单条原样走 `applyEvent`，多条合并成一帧（对应宿主 40ms flush） | 改批量语义、排查"数组预览只出一帧"时 |
| `createSimulatorState` / `SimulatorState` | `simulator.ts` | 模拟器的私有状态（`nextItemId`、`items`、`activities`、`echoPending`、标量）；第二参数是帧编号起点，重置时要接上当前编号 | 改状态字段、看 `activities` 索引时 |
| `SimStep` / `KEEP` | `simulator.ts` | 一步的结果与「不改动流式区」哨兵 | 改 `play` 语义时 |
| `DEBUG_INSTANCE_ID` | `simulator.ts` | 首帧与每帧的 `instanceId` | 改帧的实例标识时 |
| `SUPPORTED_EVENTS` | `simulator.ts` | 13 种已知事件名的清单；**当前没有调用方**（`applyEvent` 的 `default` 用的是字面量报错），加事件时按它对齐 | 加事件、核对清单时 |
| `messageText` / `resultDetail` / `redactText` | `simulator.ts` | 对应宿主同名辅助函数；`redactText` 是简化脱敏 | 核对文本提取与脱敏时 |
| `blocksFromContent` / `blocksFromMessage` / `customContentBlocks` | `bangumi/src/web/message-blocks.ts`（宿主侧，被 `simulator.ts` 调用） | 内容快照 → `MessageBlock[]` 的投影（含结构共享），以及 custom 消息 → 单块；**宿主与调试页共用这一份** | 加内容来源、核对块投影、调试页内容块不显示或一直停在骨架时 |
| `DebugInputPanel` / `DebugInputPanelProps` | `DebugInputPanel.tsx` | 左侧输入区组件与它的 props 契约（只有输入区：两个框、用例、动作、状态栏，没有顶栏入口） | 改 props、加输入控件时 |
| `DebugPreview` / `DebugPreviewProps` | `DebugPreview.tsx` | 右侧预览区：提示条 + `<Stage>` 接线 + 空态 `DebugHero`；渲染 `<main className="appConversation">` | 改预览条、空态、或预览的 props 时 |
| `SAMPLES` | `DebugInputPanel.tsx` | 8 个 mock 用例（用例 2、3 必须按顺序；用例 5 走 frame 通道，会先清空 event；用例 6 是 event 数组，演示一个 flush 窗口；用例 7、8 按顺序点，演示内容块的骨架 → 真实数据 → 落条目） | 加或改用例时 |
| `MODE_LABEL` | `DebugInputPanel.tsx` | 「当前依据」三态文案（`event` / `frame` / `none`） | 改状态栏措辞时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「四个文件的分工」 | 找某个改动该落在哪个文件时 |
| §简介「与主界面的关系」 | 疑惑调试期间会不会连宿主、会不会污染主 store 时 |
| §规则「调试数据不得进入主 store」 | 动 store 装配、想复用主 store 时 |
| §规则「预览必须复用 `<Stage>`，不得另写一套渲染」 | 想给预览写专门渲染时 |
| §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」 | **改了宿主 `handleEvent`、或要加一条 event 支持时必读** |
| §规则「event 数组 = 一个 flush 窗口，合并成一帧」 | **改批量输入、纳闷"数组为什么只出一帧"时必读** |
| §规则「内容块的投影走共享纯函数，不复刻」 | 内容块在调试页不出现、一直停在骨架、或要给宿主加内容来源时 |
| §规则「`play` 的语义：`KEEP` 哨兵与空数组」 | 流式区没有按预期变化时 |
| §规则「逐字播放由 `playBlocks` 驱动，`displayBlocks` 是受控 prop」 | 调播放节奏、改取消逻辑、改骨架/内容块的呈现时机时 |
| §规则「首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`，重置时 `revision` 必须接上」 | 首帧条目被合并而不是替换时；点了重置/预览却像没反应时 |
| §规则「`parseInputs`：event 非空优先」 | 两个输入框同时有内容、或预览报输入错误时 |
| §规则「顶栏的「组件库」入口是新标签 `<a>`，用组合类 `.debugLink`」 | 改顶栏入口、或想把跳转改成同标签 / `<button>` 时 |
