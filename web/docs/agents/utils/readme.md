# 工具层（`web/src/utils/`）

## 使用说明

### 这份文档是什么

工具层的职责与划分规则：哪些代码属于这一层、按什么切分文件、有哪些硬约束。

**不覆盖**：宿主端实现（`bangumi/src`）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断"某段逻辑该不该放工具层"、要新增工具文件时 |
| [api.md](api.md) | 加或改宿主端点、改错误语义、动 SSE 订阅时 |
| [commands.md](commands.md) | 加本地斜杠命令、改补全匹配或 `/help` 文案时 |
| [turns.md](turns.md) | 改轮次分组规则（哪些条目算过程、前导内容归属）时 |
| [credentialLabel.md](credentialLabel.md) | 改凭据来源的展示措辞时 |
| [relativeTime.md](relativeTime.md) | 改历史会话右侧的时间文案、侧栏分组（四档）或分组顺序时 |
| [debugMode.md](debugMode.md) | 改调试页的入口开关（`#debug`）与它的落点时 |
| `pinnedStorage.ts` | 改置顶会话的本地持久化（存储键、容错降级）时（无独立文档，见 §划分依据） |

### 必须遵守的规则

1. **无组件、无 hook、无状态**：副作用只允许三处——`api.ts` 的网络请求、`revealOnScroll.ts` 的 DOM 观察、`pinnedStorage.ts` 的 `localStorage` 读写。违反后果：工具层与界面耦合，无法独立复用与测试。见 §这一层的职责。
2. **错误只抛出、不提示**：提示与状态更新归 `store/operations.ts`。违反后果：同一错误多处重复提示，或调用方无法感知失败。见 §规则。
3. **不复制协议类型**：跨端类型一律从 `protocol.ts` 取。违反后果：协议改动后类型静默不同步。见 §规则。
4. **共用文案集中放置**：同一句话出现在两处界面就抽到这里（`AUTH_LABEL` 是范例）。违反后果：两处措辞漂移。见 §规则。
5. **不提前抽通用工具**：没有第二个调用方就不抽。违反后果：无谓的间接层与死代码。见 §规则。

## 这一层的职责

放**与界面无关**的东西：纯函数，以及宿主接口的唯一封装。

| 允许 | 不允许 |
|---|---|
| 依赖 `bangumi/src/web/protocol.ts` 的类型 | import React（这里没有任何 JSX 与 hook） |
| 纯计算、数据投影、文案拼装 | import `store/`（工具层不认识全局状态） |
| 发起 HTTP / 建立 SSE（仅 `api.ts`） | 直接改界面状态或弹提示（那是 `store/operations.ts` 的事） |
| 观察 DOM 可见性并加类名（仅 `revealOnScroll.ts`） | 读 `store/`、订阅全局状态，或在别处另建观察器 |
| 读写浏览器 `localStorage`（仅 `pinnedStorage.ts`） | 把持久化散进组件或 reducer（落盘只在 `store/index.ts` 的一处订阅里发生） |

判断一个函数该不该放这里：**把它单独 `import` 到一个空白脚本里，还能跑吗？** 能，就属于工具层。

## 划分依据：一个功能类别一个文件

| 文件 | 功能类别 | 关键导出 |
|---|---|---|
| [api.ts](api.md) | 宿主接口（HTTP + SSE） | `submitInput`、`fetchCatalog`、`openStream` … 共 15 个 |
| [commands.ts](commands.md) | 斜杠命令候选表与匹配 | `LOCAL_COMMANDS`、`mergeCommands`、`matchCommands`、`helpText` |
| [turns.ts](turns.md) | 条目 → 轮次的展示投影 | `projectTurns`、`TurnGroup` |
| [credentialLabel.ts](credentialLabel.md) | 凭据来源的共用措辞 | `AUTH_LABEL` |
| [relativeTime.ts](relativeTime.md) | 会话「最后对话时间」的相对文案、侧栏四档分组与分组顺序 | `relativeTimeLabel`、`sessionDayGroup`、`SESSION_GROUP_ORDER` |
| [debugMode.ts](debugMode.md) | 调试页的入口开关（`window.location.hash === '#debug'`） | `isDebugHash`、`enterDebug`、`exitDebug` |
| `pinnedStorage.ts` | 置顶会话的本地持久化（**纯前端状态**，协议里没有这一项） | `loadPinned`、`savePinned` |
| `revealOnScroll.ts` | 视口驱动入场的**共享观察器**（工具层唯一碰 DOM 的文件） | `observeReveal` |

规模悬殊是有意的：`credentialLabel.ts` 只有 9 行也单独成文件，因为它是**被两个组件共用的措辞表**；而 `api.ts` 承载全部端点。**判据是"功能类别"，不是行数。**

## 规则

1. **无组件、无 hook、无状态**：所有导出都是函数、常量或类型。副作用只有三处：`api.ts` 里的网络请求、`revealOnScroll.ts` 里的 DOM 观察（它按滚动容器缓存 `IntersectionObserver`，进入视口给元素加类）、`pinnedStorage.ts` 里的 `localStorage` 读写（每一层都容错，坏数据降级成「没有置顶」）。三者都不得读 store。
2. **错误语义统一**：`api.ts` 只把宿主的 `ApiErrorView.message` 包成 `Error` 抛出，不做提示、不重试、不改写文案。谁调用、谁决定怎么提示（见 [../store/actions-and-operations.md](../store/actions-and-operations.md)）。
3. **不复制协议类型**：跨端类型从 `protocol.ts` 取；这里的类型要么是协议类型的别名，要么是纯前端的投影结构（如 `TurnGroup`）。
4. **文案集中在能共用的地方**：同一句话若出现在两处界面，就抽成这里的常量或函数（`AUTH_LABEL`、`relativeTimeLabel` 是范例），避免两处漂移。
5. **不写"顺手"的通用工具**：没有第二个调用方的工具函数不要提前抽出来。
6. **持久化只住 `pinnedStorage.ts`**：`localStorage` 的键、JSON 解析与失败降级都收在这一处，组件与 reducer 都不直接碰 `localStorage`（见 [../store/selectors-and-instance.md](../store/selectors-and-instance.md)）。

## 新增一个工具文件时

1. 确认它是**新的功能类别**（同类别追加进已有文件即可，例如再加一条本地命令写进 `commands.ts`）；
2. 文件顶部写清"这一层为什么存在、边界是什么"（中文注释，与既有文件风格一致）；
3. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。
