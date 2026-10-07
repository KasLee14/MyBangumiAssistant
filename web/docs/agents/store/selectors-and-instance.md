# 选择器与 store 实例（`store/selectors.ts` + `store/index.ts`）

## 简介

selector 清单与新增规则、store 实例与 `preloadedState`、类型导出，以及"稳定引用"这条硬要求。

**不覆盖**：异步动作与错误约定（见 [actions-and-operations.md](actions-and-operations.md)）；切片的字段与帧合并（见 [reducers.md](reducers.md)）；`useAppSelector` 的绑定与生命周期订阅（见 [hooks-and-stream.md](hooks-and-stream.md)）。

上层：[readme.md](readme.md)。相关：[reducers.md](reducers.md)、[hooks-and-stream.md](hooks-and-stream.md)。

## 使用说明

- **写 selector 之前先读完 §规则**：「selector 不得新建引用（稳定引用要求）」的三条反例、「`selectHeroPhase` 的条件不得只看 `items.length`」、「流式正文读显示投影」与「`preloadedState` 覆盖 `collapsed` 与 `pinned`、落盘只在一处订阅」都在那里；违反会表现为整棵树每帧重渲染、首屏遮住宿主提示、屏幕上一次冒出十几个字或同一段回答出现两份、置顶刷新后丢失，或在 reducer 里读浏览器环境。
- **只想查现成的 selector、或某个类型从哪转出**：直接查 §索引 的「选择器清单（`selectors.ts`）」与「转出的类型与值」，不必通读 §规则。
- **不确定"流式正文该读哪个字段"**：见 §规则「流式正文读显示投影」——权威值（`liveContent`）与显示投影（`displayedContent`）是两回事。
- **加 selector 之前**：先照 §规则「新增一个 selector」的四步做，最后在本文件的表格里登记。
- 本层通用规则见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### selector 不得新建引用（稳定引用要求）

**selector 不得新建对象或数组**。`useSelector` 用 `Object.is` 比较返回值。**违反后果**：每帧判定"变了"，整棵树重渲染。

| 反例 | 后果 | 正确做法 |
|---|---|---|
| `state => state.catalog.commands.map(...)` | 每帧返回新数组 → 每帧重渲染 | 在 reducer 里算好存进 state（`commands` 就是先例） |
| `state => ({ a: state.a, b: state.b })` | 同上（`shallowEqual` 也只缓解一层） | 拆成两个 selector，或改成直接返回已有引用 |
| `state => state.stream.items.filter(...)` | 同上 | 把过滤放进 `useMemo`（依赖 `items`）或投影函数（如 `projectTurns`） |

### `selectHeroPhase` 的条件不得只看 `items.length`

**违反后果**：有通知或流式输出时被首屏遮住。

`selectHeroPhase` 的条件不能只看 `items.length`：只要有通知、命令回显或正在流式输出，就必须进入会话视图，否则首屏会把宿主提示挡住（这是历史 bug 的修复点）。判定式见 §索引「三个派生 selector」。

**判"还在不在输出"必须用权威值**：`selectHeroPhase` 读的是 `stream.liveContent` / `stream.liveThinking`，不是显示投影 `displayedContent`。上游的突发批次与摊平推进之间有一小段延迟（首帧刚到、`stream/paced` 还没跑时投影是空的），拿投影当判据等于把"还没显示出来"当成"没在输出"，首屏与会话视图会跟着显示进度抖动。

### 流式正文读显示投影（`selectDisplayedContent`），不看权威值

`stream.liveContent` 是宿主下发的**权威值**，`stream.displayedContent` 是**屏幕上的那一份**（由 `store/pacing.ts` 按时间逐字推进，见 [hooks-and-stream.md](hooks-and-stream.md)）。分工如下：

- **正文读投影**：`selectDisplayedContent`（原 `selectLiveContent` 已删除）。读权威值会绕过摊平，上游一帧长出十几个字就直接上屏；
- **"是否处于收尾播放"读 `selectPacedTail`**：`liveContent.length === 0 && displayedContent.length > 0`，即"流式已经结束、屏上的字还没播完"。它**只回答这一个问题**——`Stage` 用它给最后一轮 `Turn` 传 `hideAssistant`，让流式区独占显示，播完（`stream/pacedDone` 清空投影）历史条目无缝接管；
- **"这一轮是否还在进行"读权威值**：`selectHeroPhase` 就是这么做的（见上一条）。

**违反后果**：组件读 `liveContent` → 上游的突发批次直接上屏，一次冒出十几个字（改造前实测每帧正文中位数 27 字符、单帧最多 127 字符，同期浏览器每轮 24 个长任务、最大 286ms；改造后 0 个）；不用 `selectPacedTail` → 收尾播放期间历史条目与流式区同时显示同一段回答；把 `selectPacedTail` 当"流式进行中"用 → 它的语义恰好相反（那时 `liveContent` 已空），会把正常流式期判成收尾。

### store 实例（`index.ts`）：`preloadedState` 覆盖 `collapsed` 与 `pinned`，落盘只在一处订阅

**违反后果**：把浏览器环境读取散进 reducer，破坏纯函数；或在多处写 `localStorage`，出现第二个真相。

```ts
export const store = createStore(rootReducer, {
  ...INITIAL_ROOT_STATE,
  // 侧栏形态在首屏定死：先渲染再纠正会看到一次闪动。
  // 置顶同样在首屏一次读入（它是纯前端本地状态），避免先渲染成未置顶再跳一次。
  ui: { ...INITIAL_UI_STATE, collapsed: initialCollapsed(), pinned: loadPinned() },
});

// 置顶落盘：reducer 保持纯净，持久化只在这一处订阅里发生。
let persistedPinned = store.getState().ui.pinned;
store.subscribe(() => {
  const pinned = store.getState().ui.pinned;
  if (pinned === persistedPinned) return;
  persistedPinned = pinned;
  savePinned(pinned);
});

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
```

- **裸 `createStore`**（redux 5）：不引入 RTK，也不挂中间件；
- **`preloadedState` 覆盖两处**：`collapsed` 按窗口宽度算（`innerWidth <= 1024`）、`pinned` 从 `localStorage` 读入（`utils/pinnedStorage.ts` 的 `loadPinned`）。首帧就是正确形态，避免"先展开再收起"与"先渲染成未置顶再跳一次"的闪动。这是仅有的"在创建 store 时读浏览器环境"的两处；
- **落盘用订阅而不是 reducer**：`store.subscribe` 里用**引用比较**过滤掉其它 action 引起的通知——`ui/pinnedToggled` 每次都返回新数组，所以"引用变了"就等于"值变了"（见 [reducers.md](reducers.md) §规则）。写入失败（配额、隐私模式）由 `savePinned` 自己吞掉，不影响界面；
- 类型从实例反推（`typeof store`），保证 `AppDispatch` 与 `AppAction` 精确对应——若手写 `Store<RootState>`，`dispatch` 的参数类型会退化成任意 action。

### 新增一个 selector

1. 先判断是否真的需要：只在一个组件用、且只是字段访问 → 直接 `state.xxx`，不要加；
2. 派生计算要**纯**且**不新建引用**（返回已有引用或原始值）；
3. 命名 `selectXxx`，与既有分组注释的排布保持一致；
4. 在本文件的表格登记。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §选择器清单（`selectors.ts`） | 找现成 selector、判断要不要新增时 |
| §三个派生 selector | 改首屏判定（`selectHeroPhase`）、流式收尾判定（`selectPacedTail`）或设置行提供方回落逻辑时 |
| §selector 不得新建引用（稳定引用要求） | **写 selector 前必读**（三条反例与对应做法） |
| §`selectHeroPhase` 的条件不得只看 `items.length` | 排查"有通知或流式输出时首屏把提示挡住"时 |
| §流式正文读显示投影（`selectDisplayedContent`），不看权威值 | 改流式正文的数据来源、排查"一次冒出十几个字""同一段回答出现两份"时 |
| §store 实例（`index.ts`）：`preloadedState` 覆盖 `collapsed` 与 `pinned`，落盘只在一处订阅 | 改初值、`preloadedState`、置顶落盘或类型导出时 |
| §新增一个 selector | 加 selector 时逐步照做 |

### 选择器清单（`selectors.ts`）

| 分组 | 导出 |
|---|---|
| 会话流 | `selectStream`、`selectItems`、`selectDisplayedContent`、`selectLiveThinking`、`selectBusy`、`selectPending`、`selectPendingEcho` |
| 目录 | `selectModels`、`selectSessions`、`selectProviders`、`selectCommands`、`selectCanPersistCredentials` |
| 界面 | `selectSettingsOpen`、`selectSettingsPane`、`selectSessionsOpen`、`selectCollapsed`、`selectReveal`、`selectNotice`、`selectProblem` |
| 派生 | `selectHeroPhase`、`selectPacedTail`、`selectCredentialProvider` |

直接用 `state.xxx` 的字段访问在组件里也见得多（`useAppSelector(state => state.stream.busy)`），两者都合法：**被多处复用或需要派生计算时，才值得抽一个具名 selector。**

### 三个派生 selector

```ts
// 首屏：完全空且空闲时才显示引导
export const selectHeroPhase = (state) =>
  state.stream.items.length === 0 && !state.stream.busy
  && state.stream.liveContent.length === 0 && !state.stream.liveThinking
  && state.stream.pendingEcho === null;

// 收尾播放：流式已结束（权威正文已清空），但屏幕上的字还没播完
export const selectPacedTail = (state) =>
  state.stream.liveContent.length === 0 && state.stream.displayedContent.length > 0;

// 设置行显示的提供方：没有显式选择时回落到目录里的当前提供方
export const selectCredentialProvider = (state) =>
  state.ui.credentialProvider
  ?? state.catalog.providers.find(p => p.current)?.id
  ?? state.catalog.providers[0]?.id
  ?? '';
```

`selectDisplayedContent` / `selectPacedTail` 在源码里排在 `selectItems` 之后（会话流分组下），这里按"是否派生"归类。`selectHeroPhase` 为什么不能只看 `items.length`、以及两个流式 selector 的分工：见 §规则「`selectHeroPhase` 的条件不得只看 `items.length`」与「流式正文读显示投影」。

### 转出的类型与值

| 导出 | 用途 |
|---|---|
| `RootState` | selector 与 `useAppSelector` 的泛型 |
| `AppStore` / `AppDispatch` | `hooks.ts` 与 `operations.ts` |
| `PendingEcho` | `actions.ts` 的 `pendingEchoSet` 参数 |
| `SettingsPane` | `actions.ts` / `operations.ts` / `SettingsDialog` |

`store/index.ts` 转出的类型**只有三项**：`PendingEcho`（来自 `reducers/stream.ts`）、`SettingsPane`（来自 `reducers/ui.ts`）、`RootState`（来自 `reducers/index.ts`）。`AppStore` / `AppDispatch` 是从实例反推出来的本地类型（`typeof store` / `typeof store.dispatch`），不是转出。

`RootState`、`INITIAL_ROOT_STATE` 定义在 `reducers/index.ts`（`AppAction` 也定义在那里，但由 `actions.ts` 转出），`store/index.ts` 只把上面三项**转出**（保持"组件只从 `store/` 顶层拿类型"的习惯）。
