# hooks 与事件流（`store/hooks.ts` + `store/stream.ts` + `store/pacing.ts`）

## 简介

类型化 hooks、`useActions` 的绑定方式、三个生命周期 hook（目录同步 / 响应式折叠 / Esc）、SSE 订阅与帧路由、逐字摊平的推进器（`usePacing`），以及新增订阅的步骤与常见错误。

**不覆盖**：状态合并与帧语义（见 [reducers.md](reducers.md)）；异步动作与错误约定（见 [actions-and-operations.md](actions-and-operations.md)）；`openStream` 的实现与端点（见 [../utils/api.md](../utils/api.md)）；正文该读哪一份、收尾何时结束的**字段语义**（见 [reducers.md](reducers.md) 与 [selectors-and-instance.md](selectors-and-instance.md)）。

上层：[readme.md](readme.md)。相关：[selectors-and-instance.md](selectors-and-instance.md)、[reducers.md](reducers.md)。使用方：`page/mainPage/index.tsx`（生命周期订阅）与各外壳组件（读状态、取动作）。

## 使用说明

- **改这三个文件之前先读完 §规则**：`useActions` 的引用稳定性、订阅必须返回清理函数、effect 依赖只放稳定引用、SSE hook 只做转发、摊平按时间折算都在那里；违反会表现为每帧重绑监听器、卸载后仍收帧、逐字速度跟着刷新率漂移，或状态逻辑出现第二个实现。
- **只想查某个 hook 的签名或行为**：直接查 §索引 的「`useActions()`」「三个生命周期 hook」「SSE 订阅」与「逐字摊平（`pacing.ts`）」，不必通读 §规则。
- **改摊平速度或收尾时机**：先读 §规则「逐字摊平按时间折算，推进结果写回 store」——它决定多快；"什么时候停"的判定在 [reducers.md](reducers.md) 的「流式正文的显示投影与收尾播放」。
- **加订阅之前**：先照 §规则「新增一个生命周期 hook 的步骤」逐步做，再在 [../page/main-page.md](../page/main-page.md) 的订阅表里登记。
- 本层通用规则见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 不用原生 `useSelector` / `useDispatch`

一律用 `hooks.ts` 里绑好泛型的 `useAppSelector` / `useAppDispatch`（用法见 §索引「类型化 hooks（`hooks.ts`）」）。**违反后果**：丢掉类型检查。

### 订阅 hook 必须返回清理函数

**违反后果**：卸载后仍收帧、重复订阅。

### effect 依赖只放稳定引用

`dispatch`、`actions`、原始值。**违反后果**：每帧重绑监听器。

### SSE hook 只做转发

状态合并（标量覆盖、条目按 `id` 合并、会话切换整表替换）全在 reducer 里（见 [reducers.md](reducers.md)），**这个 hook 只负责转发**，不要在这里写业务判断。**违反后果**：状态逻辑出现第二个实现。

增量帧同样只转发：`frame.type === 'stream'` 时 dispatch `deltaReceived(frame)`，累加与守卫都在 reducer 里（见 [reducers.md](reducers.md) 的「正文与思考走增量帧」）。hook 里**不得**判断"这个增量接不接得上"——那是宿主与 reducer 的职责。**违反后果**：出现第二个增量判定，与宿主的自愈约定（算不出增量就改发全量帧）分叉，文本出错时无法判断以哪一套为准。

### 逐字摊平按时间折算，推进结果写回 store

`pacing.ts` 的 `usePacing()` 在主界面挂载期间跑一个 `requestAnimationFrame` 循环：每帧按**经过的毫秒数**折算该吐几个字（`MS_PER_CHAR = 1000 / 60`，约 60 字/秒），算好后 dispatch `pacedUpdated(content)`。

- **必须按时间，不能按帧数**：`requestAnimationFrame` 的频率随显示器刷新率与其他环境因素变化（实测离屏/无头环境能到 170 帧以上），按"每帧一个字"推进会跟着帧率变快（120Hz 屏上是两倍、170 fps 时接近三倍）；不足一个字的余量必须用 `carry` 跨帧累积——余数一丢，高刷新率下每帧都凑不满一个字，字就吐不出来；
- **推进结果必须写回 store**（只有 `stream/paced` 这一个写入口），不能留在组件的 ref / state 里——`Stage` 的收尾播放判定读的是 store 里的投影（`selectPacedTail`），组件私有的进度驱动不了它，屏幕上会出现两份进度。（调试页预览是另一套：`liveBlocks` 由调用方受控传入、`pacedTail` 固定为 `false`，不经过 `pacing.ts`。）
- **"追上目标"不等于"该结束"**：`advanceFrame` 在时间还没到（`budget` 为 0）时也返回 `null`，所以收尾要用 `hasCaughtUp(target, displayed)` 单独判定，并且**只在权威正文已清空**（`liveContent.length === 0`）时才 dispatch `pacedDone()`；
- **后台标签页不用额外处理**：`requestAnimationFrame` 在后台自动停摆，切回前台时经过的时间会一次折算成较大的 `budget`，被单帧上限截断后分几帧追上。

**违反后果**：按帧数折算 → 高刷新率屏幕上逐字速度翻倍、低帧率环境下变慢；用 `advanceFrame` 返回 `null` 当结束条件 → 还没播完的内容被提前清掉（最后一段"没播完就消失"）；把推进结果留在组件里 → 同一份正文出现两个进度。

### 新增一个生命周期 hook 的步骤

1. 想清楚"它属于哪个时机"：与 store 数据同步 → `hooks.ts`；与事件流相关 → `stream.ts`；与流式**显示节奏**相关（要自己驱动帧循环）→ `pacing.ts`；
2. 用 `useAppSelector` 读它需要的状态、`useActions()` 取动作（**不要**在 hook 里直接 `import utils/api`）；
3. 依赖数组里放稳定的引用（`dispatch`、`actions` 对象、原始值），避免每帧重建监听；
4. 在 `page/mainPage/index.tsx` 里加一行调用，并在 [../page/main-page.md](../page/main-page.md) 的订阅表里登记。

### 常见错误

| 症状 | 原因 |
|---|---|
| 监听器每帧重绑 | 依赖数组里放了每次渲染都新建的对象/数组（例如在 selector 里 `map` 出的新数组） |
| Esc 同时关弹窗并停止本轮 | 在冒泡阶段监听，或在弹窗里忘了 `stopPropagation()` |
| 侧栏形态在窗口缩放时"跳回去" | 这是 `useResponsiveCollapse` 的强制语义，不是 bug；要改语义需先确认产品预期 |
| 卸载后仍在收帧 | 订阅 hook 没返回清理函数，或 effect 依赖不稳定导致反复订阅 |
| 高刷屏上逐字速度翻倍（或低帧率下变慢） | 摊平按帧数而不是按**经过的毫秒数**折算预算 |
| 最后一段还没播完就消失 | 收尾用 `advanceFrame` 返回 `null` 当结束条件（时间没到时它也返回 `null`），或忘了先判 `liveContent` 已清空 |
| 屏幕上一次冒出十几个字 | 组件读了权威值 `liveContent` 而不是显示投影（见 [selectors-and-instance.md](selectors-and-instance.md)） |

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §类型化 hooks（`hooks.ts`） | 组件里读状态、不确定泛型怎么标时 |
| §`useActions()`：把异步动作绑到当前 store | 组件里发起动作、想确认引用稳定性时 |
| §三个生命周期 hook | 改侧栏响应式、Esc 行为、目录重取时机时 |
| §SSE 订阅（`stream.ts`） | 动事件流、连接状态、帧转发与**增量帧路由**时 |
| §逐字摊平（`pacing.ts`） | 改逐字速度、积压加速、收尾播放的推进与结束条件时 |
| §新增一个生命周期 hook 的步骤 | 加订阅前照做 |
| §常见错误 | 出现"每帧重绑""卸载后仍收帧"等症状时 |

### 类型化 hooks（`hooks.ts`）

```ts
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

用法与原生一致，但泛型已经绑好：组件里写 `useAppSelector(state => state.stream.busy)`，不需要再标 `<RootState>`。**不要绕过它们直接用 `useSelector`** —— 那会丢掉类型检查。

### `useActions()`：把异步动作绑到当前 store

```ts
export function useActions(): Actions {
  const store = useStore<RootState, AppAction>() as AppStore;
  return useMemo(() => createActions(store), [store]);
}
```

- store 实例在 Provider 生命周期内稳定，因此 `useMemo` 只会创建一次；
- 返回的 `Actions` 对象引用稳定，可以安全地放进 effect 依赖数组；
- 组件拿到的是一组"能力"，不需要知道 `dispatch` 的存在。

### 三个生命周期 hook

都只在**主界面挂载期间**生效，页面按名调用、一行一个：

| hook | 做什么 | 细节 |
|---|---|---|
| `useCatalogSync()` | 首屏、`sessionId` 或 `sessionName` 变化后重取目录 | 失败静默：打开设置/会话弹窗时会再取一次；标题变化也需同步 |
| `useResponsiveCollapse()` | 监听 `resize`，每次按当前宽度写入 `collapsedSet(window.innerWidth <= 1024)` | 是**强制**语义：手动展开后下一次 resize 仍会重置。首屏初值由 `preloadedState` 决定（见 [selectors-and-instance.md](selectors-and-instance.md)），避免先展开再收起的一次闪动 |
| `useEscapeShortcut()` | `keydown` 且 `key === 'Escape'`：`ui.switching` 为真时**直接返回**；有 `pending` → `reject(id)`；否则 `busy` → `stopRound()` | **顺序不能反**：待确认时 `busy` 也为真（确认发生在工具执行期间），先判 `busy` 会把 Esc 变成"中止整轮"。会话切换在途时不应答也不停止任务，所以 `switching` 排在最前。弹窗（`Modal`）与思考菜单各自在**捕获阶段**（`addEventListener(..., true)`）拦截并 `stopPropagation`，所以弹窗打开时 Esc 只作用于弹窗；输入区的候选下拉与统计浮层只关自己、不拦事件，Esc 会继续走这条全局判定 |

### SSE 订阅（`stream.ts`）

SSE 的 `sessions` 帧走 `sessionsUpdated`，全量状态帧走 `frameReceived`，**增量帧（`stream`）走 `deltaReceived`**，接收后用 store 中实际接受的 `sessionId` 调用 `rememberSession`；`fatal` 帧走 `streamFatal`。下列片段仅展示订阅结构，完整分支见源码。

```ts
export function useStreamSubscription(): void {
  const dispatch = useAppDispatch();
  const store = useStore<RootState, AppAction>() as AppStore;
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') { dispatch(streamFatal(frame.message)); return; }
      if (frame.type === 'sessions') { dispatch(sessionsUpdated(frame.sessions)); return; }
      // 增量帧与全量帧走不同的 action：全量帧整体覆盖（自愈），增量帧只累加。
      if (frame.type === 'stream') {
        dispatch(deltaReceived(frame));
        rememberSession(store.getState().stream.sessionId);
        return;
      }
      dispatch(frameReceived(frame));
      rememberSession(store.getState().stream.sessionId);
    },
    onStatus: connected => { dispatch(connectionChanged(connected)); },
  }), [dispatch, store]);
}
```

- `openStream` 返回清理函数（`EventSource.close()`），`useEffect` 直接把它当返回值 → 卸载即断开；
- 依赖数组是 `[dispatch, store]`：两个都是稳定引用，effect 只跑一次（`store` 也要放进去，因为回调里要用它读实际接受的会话 id）；
- **四类帧各有落点**：`fatal` → `streamFatal`（写 `status` 并断开标记），`sessions` → `sessionsUpdated`（后台会话状态），`stream`（增量）→ `deltaReceived`（只累加），其余状态帧（全量）→ `frameReceived`（整体覆盖，自愈通道）；
- **两个 action 不能互换**：`stream` 帧只带 `delta`，没有 `state` / `items` 字段，塞给 `frameReceived` 会让 reducer 读不到 `frame.state`；反过来把 `state` 帧当增量累加则会丢掉"条目整体替换"的语义；
- **增量帧是"相对上一帧的差分"**，所以宿主保证任何接不上的情况都改发全量 `state` 帧（会话切换、历史重建、结构变化……）；前端因此**不做增量回退**——丢弃一帧，等随后的全量帧纠正；
- **帧的节奏由宿主决定**：`FLUSH_MS = 16`（约一帧 60Hz；改造前是 40ms）。窗口越长每帧吐出的字越多（40ms 时实测每帧 10~127 字符），同时不给浏览器制造超过刷新率的帧；
- `rememberSession` 只记录 store 里**实际接受**的 `sessionId`（reducer 可能因迟到帧丢弃本帧），所以它读的是 `store.getState()` 而不是帧里的字段；
- 状态合并全在 reducer 里，**这个 hook 只负责转发**，不要在这里写业务判断（见 §规则「SSE hook 只做转发」）；
- 只在主界面挂载时建立：页面不挂载就不连宿主（这一性质曾被调试面板依赖）；
- `EventSource` 自带重连，宿主重启会自动接回，因此不写重试逻辑；连接状态由 `onStatus` 反映到侧栏品牌行里那颗 8px 连接状态点（`.appSidebarStatus` 的 `data-state`，主界面已无顶栏）。

### 逐字摊平（`pacing.ts`）

`store/pacing.ts` 只有一个职责：把**权威正文**（`stream.liveContent`）按时间摊平成**显示投影**（`stream.displayedContent`）。它是"上游以突发批次下发"这个事实的补偿层，不是渲染优化——改造后浏览器长任务已经为 0，摊平解决的是观感。

```ts
export function advanceFrame(target: MessageBlock[], displayed: MessageBlock[], budget: number): MessageBlock[] | null;
export function hasCaughtUp(target: MessageBlock[], displayed: MessageBlock[]): boolean;
export function usePacing(): void;
```

| 导出 | 做什么 |
|---|---|
| `advanceFrame` | 给出下一帧的显示用块数组；无可推进内容时返回 `null`。`budget` 是本帧允许吐出的字数（由经过的时间折算，0 表示时间还没到） |
| `hasCaughtUp` | 显示是否已经追上目标。比较**文本内容**而不是引用（推进过程每次都构造新块），这是收尾播放的结束条件 |
| `usePacing()` | 挂载 `requestAnimationFrame` 循环：算 `budget` → `advanceFrame` → 有变化就 dispatch `pacedUpdated`；追上且权威正文已清空时 dispatch `pacedDone()` |

五个常量决定手感（都在 `pacing.ts` 里，改之前先读 [reducers.md](reducers.md) 的「流式正文的显示投影与收尾播放」）：

| 常量 | 值 | 作用 |
|---|---|---|
| `MS_PER_CHAR` | `1000 / 60` | 每字间隔，约 60 字/秒（实测 59.5 字/秒） |
| `CATCHUP_THRESHOLD` | 1200 | 积压超过它才开始加速；正常回答不会触发，是给超长回答兜底的（5000 字若始终一字一帧要播一分半钟，用户会以为界面卡死） |
| `CATCHUP_FRAMES` | 120 | 加速时按这个帧数收敛：每帧多吐 `ceil((积压 - 阈值) / CATCHUP_FRAMES)` 个字 |
| `MAX_CHARS_PER_FRAME` | 8 | 单帧上限：卡顿或从后台切回后不要一次性刷出一大段 |
| `MAX_BACKLOG` | 3000 | 积压超过它直接补齐（极端情况的保险） |

**结构变化不按 `budget` 走**——那不是"吐字"而是"换内容"，分两种处理：

- 目标比显示**多出一个文本块**（正文开始/新段落）：前面的块引用相同就补一个空块继续逐字，避免一次跳出整段开头；
- **其它结构变化**（新的内容块、整体替换、块数变化）：直接对齐目标——那些情况要么是"上一段已定稿"，要么是"屏幕要被别的内容接管"，继续摊平只会落后于已定稿的内容。

**思考文本不摊平**：`liveThinking` 由组件直接读协议标量 `stream.liveThinking`。理由：思考动辄上千字，逐字播要几十秒，用户会以为界面卡死。
