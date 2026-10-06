# 动作层（`store/actions.ts` + `store/operations.ts`）

## 简介

动作层的两层分工与全部动作：action creator 与异步编排的边界、`Actions` 接口全表、两种错误处理约定、新增动作的模板。

**不覆盖**：切片的字段与 reducer 如何落库（见 [reducers.md](reducers.md)）；端点本身与 `openStream` 的实现（见 [../utils/api.md](../utils/api.md)）；`useActions()` 的绑定方式（见 [hooks-and-stream.md](hooks-and-stream.md)）。

上层：[readme.md](readme.md)。相关：[../utils/api.md](../utils/api.md)、[reducers.md](reducers.md)。

## 使用说明

- **加或改动作之前先读完 §规则**：`action creator` 的纯度、两种错误处理约定与提示文案风格都在那里；违反会留下带副作用的同步动作、无人接管的 rejection 或与既有文案不一致的提示。
- **只想查某个 creator 叫什么、某个动作在哪里**：直接查 §索引 的「`actions.ts` 的导出（同步 creator 全表）」与「`Actions` 接口全表」，不必通读 §规则。
- **改会话切换或请求序号**：先读 §索引「并行会话与请求序号」，它说明 `switchSession` 的编排与迟到请求的取舍。
- 本层通用规则见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### action creator 保持纯数据

任何判断都不要塞进去。**违反后果**：同步动作带副作用，难测试。

### 两种错误处理约定（新增动作时必须选一个）

**不吞错误**：要么 `notifyFailure`（提示并抛出）、要么 `notifyOnly`（只提示）、要么把异常交给调用方。**违反后果**：无人接管的 rejection 或静默失败。

| 约定 | 行为 | 用在哪 |
|---|---|---|
| `notifyFailure(error)` | 发全局提示 + **重新抛出** | 调用方需要知道自己失败了：`send`、`optimisticSend`、`newSession`、`resumeSession`。例如 `Composer` 靠它回滚草稿 |
| `notifyOnly(error)` | 只发全局提示，不抛 | "发出即可"的动作：`confirm`、`reject`、`stopRound`、`cancelBangumiLogin`——避免无人接管的 rejection |

其余动作（`applyCredential`、`pickModel`、`applyProxy`、`startBangumiLogin`、`bangumiLogout`）**不吞错误**：请求失败时异常抛给弹窗，由弹窗写进自己的 `error` 显示。成功时才 `dispatch(noticeSet(...))`，所以弹窗不需要再拼提示文案。

`pickThinkingLevel` 是例外：成功与失败都只发全局提示（它是常驻菜单，没有弹窗承载错误）。

### 组件不得绕过 `useActions()` 直接 `import utils/api`

**违反后果**：提示与状态更新不一致（见 [readme.md](readme.md) §规则「改全局状态只能经 `store/` 的动作」）。

### 提示文案用中文、以句号结尾

**违反后果**：与既有文案风格不一致。

### 新增一个异步动作的模板

```ts
// operations.ts
const doSomething = async (arg: string): Promise<void> => {
  await someRequest(arg);                         // utils/api 里的薄函数
  dispatch(noticeSet('已……'));                     // 成功：给全局提示
  dispatch(someStateSet(arg));                     // 需要的话写状态
};
```

放在 `return { ... }` 的对象里，并在 `Actions` 接口加上签名。要点：

1. **不要在这里读组件状态**：需要的数据从 `state()` 取（`store.getState()`），或作为参数传入；
2. **不要 `try/catch` 后静默**：要么 `notifyFailure`/`notifyOnly`，要么让异常抛给调用方；
3. **提示文案用中文、以句号结尾**，与既有文案风格一致（`已为 deepseek 保存密钥到本机，重启后仍然生效。`）；
4. 组件里只写 `actions.doSomething(...)`，**不要**在组件里 `import utils/api`。

### 规则小结（收尾核对清单）

- 组件 → `useActions()` → `operations` → `utils/api`，单向；
- action creator 保持纯数据，任何判断都别塞进去；
- 状态写入只经 `dispatch(action)`，不直接改对象；
- 改完更新本文件与 [../utils/api.md](../utils/api.md) 的表格（端点 → 动作是一一对应的）。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §两层分工 | 不确定某段逻辑该放 `actions.ts` 还是 `operations.ts` 时 |
| §`actions.ts` 的导出（同步 creator 全表） | 查现成的同步 creator（帧转发、草稿、目录同步、布局开关） |
| §`Actions` 接口全表 | 查现有能力（目录、弹窗、模型、登录、提示） |
| §并行会话与请求序号 | 改会话切换、请求序号或并发行为时 |
| §两种错误处理约定（新增动作时必须选一个） | **新增动作前必读**：先决定用 `notifyFailure` 还是 `notifyOnly` |
| §新增一个异步动作的模板 | 加动作时照抄结构 |
| §规则小结（收尾核对清单） | 收尾核对（四条） |

### 两层分工

| 文件 | 是什么 | 特征 |
|---|---|---|
| `actions.ts` | **同步 action creator** | 纯数据：`(payload) => ({ type, ...payload })`，一行一个，无副作用、无请求 |
| `operations.ts` | **异步动作编排** | 闭包 `dispatch` / `getState` 的普通函数：发请求 → 提示 → 写状态 |

没有中间件，所以 `operations.ts` 里的函数**自己拿到 store**：`createActions(store)` 返回一个实现了 `Actions` 接口的对象；`hooks.ts` 的 `useActions()` 用 `useStore()` 把当前 store 绑上去并用 `useMemo` 固定引用。

### `actions.ts` 的导出（同步 creator 全表）

按文件内的分组注释排布，全是转给 `dispatch` 的纯数据：

| 分组 | creator |
|---|---|
| 会话流 | `frameReceived`、`streamFatal`、`connectionChanged`、`pendingEchoSet`、`pendingEchoCleared`、`answerStarted`、`answerSettled` |
| 目录 | `catalogLoaded`、`sessionsUpdated` |
| 界面 | `switchingSet`、`draftSet`、`draftRestored`、`noticeSet`、`problemSet`、`settingsOpened`、`settingsClosed`、`sessionsOpened`、`sessionsClosed`、`collapsedSet`、`collapsedToggled`、`pinnedToggled`、`revealIncremented`、`credentialProviderSet` |

`switchingSet` / `draftSet` / `draftRestored` / `sessionsUpdated` 在 `operations.ts` 之外也有读者（会话切换的在途标记、输入草稿），因此它们是**公开 creator**，不只是 `Actions` 方法的内部细节。异步能力仍然只经 `Actions` 暴露。

### `Actions` 接口全表

| 分组 | 方法 |
|---|---|
| 目录与会话 | `loadCatalog()`、`send(input)`、`optimisticSend(input)`、`newSession()`、`resumeSession(session)`、`pickSession(session)`、`togglePinned(sessionId)` |
| 弹窗与布局 | `openSettings(pane)`、`openSessions()`、`openCredentialPane(provider)`、`switchPane(pane)`、`closePane()`、`closeSettings()`、`closeSessions()`、`toggleSidebar()` |
| 会话内交互 | `localCommand(command)`、`confirm(id)`、`reject(id)`、`stopRound()` |
| 模型/线路/登录 | `applyCredential(provider, key, persist)`、`clearCredential(provider)`、`pickModel(provider, model)`、`pickThinkingLevel(level, label)`、`applyProxy(mode, url?)`、`answerLoginInput(payload, done)`、`startBangumiLogin(email, password)`、`cancelBangumiLogin()`、`bangumiLogout()` |
| 瞬时提示 | `notice(text)`、`dismissNotice()`、`dismissProblem()` |

几个容易忽略的行为：

- `send(input)` 会在发出前拦截**未登记的斜杠命令**（不在 `catalog.commands` 里就只提示，不发宿主）；
- `optimisticSend(input)` = `send` + 写入 `pendingEcho`；斜杠命令不写回显（它不产生对话轮次，气泡会挡在结果前面）；
- `openSettings(pane)` / `openSessions()` 会**先重取目录再打开**（失败则用已缓存的一份，让行内值可能略旧但不阻塞打开）；
- `pickSession(session)` 先关弹窗再切会话；
- `togglePinned(sessionId)` 是**纯本地**动作：只 `dispatch(pinnedToggled(sessionId))`，不发请求、不发提示，落盘由 `store/index.ts` 的订阅完成（见 [reducers.md](reducers.md) §规则「`ui/pinnedToggled` 只改数组，落盘交给订阅」）；
- `openSettings(pane)` 与 `openSessions()` 的互斥由 reducer 保证，动作层不重复判断；
- `confirm(id)` / `reject(id)` 共用一个内部 `answer(id, accepted)`：先 `dispatch(answerStarted(id))` 再发请求，`.finally` 里 `answerSettled(id)` 解禁。**这个在途标记不能用宿主的 `busy` 代替**（确认期间 `busy` 恒为真，会让按钮永远点不动），语义见 [reducers.md](reducers.md) §规则「应答在途的撤下条件（`answering`）」。

### 并行会话与请求序号

并行会话的选择由 `switchSession` 统一编排：设置 `ui.switching`，接收 HTTP 状态帧后经 reducer 合并，再记住实际会话并重取目录。切换不取消旧任务。请求序号按 store 共享，迟到目录请求不会覆盖新目录；只有最后一次选择请求能清理切换标记。确认请求仍使用 `answerStarted/answerSettled`，旧请求完成只清理自己的确认 ID。
