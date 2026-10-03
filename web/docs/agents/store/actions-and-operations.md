# 动作层（`store/actions.ts` + `store/operations.ts`）

> 上层：[readme.md](readme.md)。相关：[../utils/api.md](../utils/api.md)、[reducers.md](reducers.md)。

## 两层分工

| 文件 | 是什么 | 特征 |
|---|---|---|
| `actions.ts` | **同步 action creator** | 纯数据：`(payload) => ({ type, ...payload })`，一行一个，无副作用、无请求 |
| `operations.ts` | **异步动作编排** | 闭包 `dispatch` / `getState` 的普通函数：发请求 → 提示 → 写状态 |

没有中间件，所以 `operations.ts` 里的函数**自己拿到 store**：`createActions(store)` 返回一个实现了 `Actions` 接口的对象；`hooks.ts` 的 `useActions()` 用 `useStore()` 把当前 store 绑上去并用 `useMemo` 固定引用。

## `Actions` 接口全表

| 分组 | 方法 |
|---|---|
| 目录与会话 | `loadCatalog()`、`send(input)`、`optimisticSend(input)`、`newSession()`、`resumeSession(session)`、`pickSession(session)` |
| 弹窗与布局 | `openSettings(pane)`、`openSessions()`、`openCredentialPane(provider)`、`switchPane(pane)`、`closePane()`、`closeSettings()`、`closeSessions()`、`toggleSidebar()` |
| 会话内交互 | `localCommand(command)`、`confirm(id)`、`reject(id)`、`stopRound()` |
| 模型/线路/登录 | `applyCredential(provider, key, persist)`、`clearCredential(provider)`、`pickModel(provider, model)`、`pickThinkingLevel(level, label)`、`applyProxy(mode, url?)`、`answerLoginInput(payload, done)`、`startBangumiLogin(email, password)`、`cancelBangumiLogin()`、`bangumiLogout()` |
| 瞬时提示 | `notice(text)`、`dismissNotice()`、`dismissProblem()` |

几个容易忽略的行为：

- `send(input)` 会在发出前拦截**未登记的斜杠命令**（不在 `catalog.commands` 里就只提示，不发宿主）；
- `optimisticSend(input)` = `send` + 写入 `pendingEcho`；斜杠命令不写回显（它不产生对话轮次，气泡会挡在结果前面）；
- `openSettings(pane)` / `openSessions()` 会**先重取目录再打开**（失败则用已缓存的一份，让行内值可能略旧但不阻塞打开）；
- `pickSession(session)` 先关弹窗再切会话；
- `openSettings(pane)` 与 `openSessions()` 的互斥由 reducer 保证，动作层不重复判断。

## 两种错误处理约定（新增动作时必须选一个）

| 约定 | 行为 | 用在哪 |
|---|---|---|
| `notifyFailure(error)` | 发全局提示 + **重新抛出** | 调用方需要知道自己失败了：`send`、`optimisticSend`、`newSession`、`resumeSession`。例如 `Composer` 靠它回滚草稿 |
| `notifyOnly(error)` | 只发全局提示，不抛 | "发出即可"的动作：`confirm`、`reject`、`stopRound`、`cancelBangumiLogin`——避免无人接管的 rejection |

其余动作（`applyCredential`、`pickModel`、`applyProxy`、`startBangumiLogin`、`bangumiLogout`）**不吞错误**：请求失败时异常抛给弹窗，由弹窗写进自己的 `error` 显示。成功时才 `dispatch(noticeSet(...))`，所以弹窗不需要再拼提示文案。

`pickThinkingLevel` 是例外：成功与失败都只发全局提示（它是常驻菜单，没有弹窗承载错误）。

## 新增一个异步动作的模板

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

## 规则小结

- 组件 → `useActions()` → `operations` → `utils/api`，单向；
- action creator 保持纯数据，任何判断都别塞进去；
- 状态写入只经 `dispatch(action)`，不直接改对象；
- 改完更新本文件与 [../utils/api.md](../utils/api.md) 的表格（端点 → 动作是一一对应的）。
