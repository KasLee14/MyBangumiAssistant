# 调试页（`web/src/page/debug/`）

## 简介

调试页：**左侧填 JSON、右侧用真实渲染链路预览结果**的开发期页面。它把宿主 `WebSession.handleEvent` 的入参（event）或宿主下发的 state 帧（frame）单独喂进来，看会话区会长成什么样，不必真的发起一次对话。

**不覆盖**：hash 入口开关（见 [../utils/debugMode.md](../utils/debugMode.md)）、调试页皮肤（见 [../styles/debug.md](../styles/debug.md)）、主界面装配（见 [main-page.md](main-page.md)）、宿主 `handleEvent` 的本体（`bangumi/src/web/session.ts`）。

上层：[readme.md](readme.md)；跨层规则：[AGENTS.md](../../../AGENTS.md)。

### 三个文件的分工

| 文件 | 职责 |
|---|---|
| `index.tsx` | 装配：建调试专用 store、解析两个输入框、按字符播放、把结果交给 `<Stage>`；导出 `DebugPage`（内部是 `DebugShell` 与 `DebugHero`） |
| `simulator.ts` | 纯映射：event → frame（宿主 `handleEvent` 的复刻），不碰 React、不碰 DOM、不读 store |
| `DebugInputPanel.tsx` | 左侧输入区：两个 textarea、5 个 mock 用例按钮、预览 / 清空并重置、状态栏；纯 props 驱动 |

### 与主界面的关系

两个页面由 `main.tsx` 的 `Root` 按 hash 互斥挂载（见 [readme.md](readme.md) §规则「新增一个页面时」）。调试页自带一个 store（`createStore(rootReducer, …)`），主 store 完全隔离；调试期间不建立 SSE、不拉目录，全程不需要宿主。

## 使用说明

- **改这三个文件之前先读 §规则**：数据隔离、必须复用 `<Stage>`、simulator 与宿主的复刻关系、`play` 语义、首帧 `instanceId`、`parseInputs` 的优先级都在那里；违反的后果分别是污染真实会话、预览与真实会话不一致、首帧被 reducer 当成增量帧。
- **想把某条宿主事件加进调试页**：先读 §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」里的三步，再查 §索引 的「符号一览」。
- **只想查某个符号在哪、某条 event 映射成什么**：直接查 §索引 的三张表（文件 → 场景、符号一览、章节 → 场景），不必通读 §规则。
- **只改外观或入口**：外观去 [../styles/debug.md](../styles/debug.md)，入口开关去 [../utils/debugMode.md](../utils/debugMode.md)。

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

**违反后果**：调试页给出与真实宿主不同的结论，据此去改宿主会改错地方。

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

### 首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`

调试 store 的初始 `stream` 用 `instanceId: DEBUG_INSTANCE_ID` + `revision: -1`；`simulator.ts` 的 `emit` 与 `resetAll` 提交的帧也一律带 `DEBUG_INSTANCE_ID`（`'debug-instance'`）。

**为什么**：`store/reducers/stream.ts` 用

```ts
const switched = frame.instanceId !== state.instanceId || frame.state.sessionId !== state.sessionId;
const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
```

判定条目是整体替换还是增量合并，而 `INITIAL_STREAM_STATE.instanceId` 是**空串**。首帧若也带空串，它就会被当成「同实例的增量帧」而不是整体替换；`revision` 同时压到 -1，让首帧不被 `frame.revision < state.revision` 的守卫丢弃。

**违反后果**：首帧按增量合并，调试页的合并语义与真实会话不同。

### `parseInputs`：event 非空优先

两个框都填时**以 event 为准**（event 非空即忽略 frame），提交后把 event 生成的帧写回 frame 框（`DebugInputPanel` 的 `frameAuto` 会提示它会被覆盖）。event 必须是 JSON 对象且带非空字符串 `type`；frame 必须是 JSON 对象且 `type === 'state'`、`items` 是数组、`state` 是对象，`instanceId` / `revision` / `full` 缺省时分别补 `DEBUG_INSTANCE_ID` / `0` / `true`。两个框都空时报「请先填入 event 或 frame。」。

**违反后果**：预览依据与用户以为的不一致（改了 frame 却没生效）。

## 索引

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 改调试页任何一处之前；想知道"预览为什么等于真实会话"时 |
| `index.tsx` | 改输入解析、播放节奏、预览装配、重置逻辑时 |
| `simulator.ts` | 加事件支持、核对宿主映射、确认 `play` 语义时 |
| `DebugInputPanel.tsx` | 改左侧输入区、加 mock 用例、改状态栏时 |
| [../utils/debugMode.md](../utils/debugMode.md) | 改调试页入口（hash 开关）时 |
| [../styles/debug.md](../styles/debug.md) | 改调试页皮肤时 |

### 符号一览

| 符号 | 位置 | 作用 | 什么时候读 |
|---|---|---|---|
| `DebugPage` | `index.tsx` | 建独立 store + `Provider`，导出给 `Root` | 改 store 装配、隔离边界时 |
| `DebugShell` | `index.tsx` | 预览区装配：输入状态、播放、`<Stage>` 接线 | 改播放与预览行为时 |
| `DebugHero` | `index.tsx` | 空态提示（无条目且无流式文本时） | 改首屏提示文案时 |
| `createDebugStore` | `index.tsx` | 用 `rootReducer` + 调试初始 `stream` 建 store | 改调试 store 初始值时 |
| `parseInputs` | `index.tsx` | 解析两个输入框，event 优先，返回帧或错误 | 改输入校验、报错文案时 |
| `commit` / `resetAll` | `index.tsx` | 提交帧（并回写输入框）/ 停播 + 重置全部 | 改提交与重置语义时 |
| `playText` / `playToken` / `CHARS_PER_TICK` / `TICK_MS` | `index.tsx` | 逐字播放与取消令牌、播放节奏常量 | 调播放节奏、改取消逻辑时 |
| `applyEvent` | `simulator.ts` | event → `SimStep[]`（13 种事件 + `default` 抛错） | 加事件、核对宿主映射时 |
| `createSimulatorState` / `SimulatorState` | `simulator.ts` | 模拟器的私有状态（`nextItemId`、`items`、`activities`、`echoPending`、标量） | 改状态字段、看 `activities` 索引时 |
| `SimStep` / `KEEP` | `simulator.ts` | 一步的结果与「不改动流式区」哨兵 | 改 `play` 语义时 |
| `DEBUG_INSTANCE_ID` | `simulator.ts` | 首帧与每帧的 `instanceId` | 改帧的实例标识时 |
| `SUPPORTED_EVENTS` | `simulator.ts` | 13 种已知事件名的清单；**当前没有调用方**（`applyEvent` 的 `default` 用的是字面量报错），加事件时按它对齐 | 加事件、核对清单时 |
| `messageText` / `resultDetail` / `redactText` | `simulator.ts` | 对应宿主同名辅助函数；`redactText` 是简化脱敏 | 核对文本提取与脱敏时 |
| `DebugInputPanel` / `DebugInputPanelProps` | `DebugInputPanel.tsx` | 左侧输入区组件与它的 props 契约 | 改 props、加输入控件时 |
| `SAMPLES` | `DebugInputPanel.tsx` | 5 个 mock 用例（用例 2、3 必须按顺序；用例 5 走 frame 通道，会先清空 event） | 加或改用例时 |
| `MODE_LABEL` | `DebugInputPanel.tsx` | 「当前依据」三态文案（`event` / `frame` / `none`） | 改状态栏措辞时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「三个文件的分工」 | 找某个改动该落在哪个文件时 |
| §简介「与主界面的关系」 | 疑惑调试期间会不会连宿主、会不会污染主 store 时 |
| §规则「调试数据不得进入主 store」 | 动 store 装配、想复用主 store 时 |
| §规则「预览必须复用 `<Stage>`，不得另写一套渲染」 | 想给预览写专门渲染时 |
| §规则「`simulator.ts` 是宿主 `handleEvent` 的复刻」 | **改了宿主 `handleEvent`、或要加一条 event 支持时必读** |
| §规则「`play` 的语义：`KEEP` 哨兵与空串」 | 流式区没有按预期变化时 |
| §规则「逐字播放由 `playText` 驱动，`displayLiveText` 是受控 prop」 | 调播放节奏、改取消逻辑时 |
| §规则「首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`」 | 首帧条目被合并而不是替换时 |
| §规则「`parseInputs`：event 非空优先」 | 两个输入框同时有内容、或预览报输入错误时 |
