# utils：通用工具函数层

> 覆盖 `web/src/utils/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/utils/` 是**跨页面通用**的工具层，以纯函数为主。它是唯一与宿主通信的地方（`web/src/utils/api.ts`），也承担「宿主下发的条目 → 界面结构」的派生（`web/src/utils/turns.ts` / `web/src/utils/process.ts` / `web/src/utils/toolViews.ts`）与少量本地持久化（`web/src/utils/pinnedStorage.ts`）。

本层可以被任何层引用（页面、组件、store），但**自己不引用** `web/src/page/` 与 `web/src/components/`——那样会形成逆向引用。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `api.ts` | 宿主命令接口：`clientId` / `selectedSessionId` 两个请求头、`post` 帮助函数、`fetchCatalog`、`openStream`（`EventSource`，自带重连） | `web/src/utils/api.ts` | 加 / 改宿主命令接口（提交、取消、确认、登录、模型、思考、凭据、代理、目录）；改事件流（SSE）订阅 |
| `commands.ts` | 命令候选：`LOCAL_COMMANDS`（只有前端能做的几条）+ `mergeCommands`（把 `CatalogView.commands` 合进来，同名以本地为准）+ `helpText` | `web/src/utils/commands.ts` | 改命令候选表、本地命令，或与宿主命令的合并规则 |
| `paths.ts` | 路径**拼装**函数：`componentPath(kind)`；与 `web/src/constants/paths.ts` 的分工见该文件注释 | `web/src/utils/paths.ts` | 拼文档页详情地址或其它路径 |
| `pinnedStorage.ts` | 置顶会话的 `localStorage` 读写（`STORAGE_KEY = 'bgm-assistant.pinned-sessions'`），每层容错、失败按「没有置顶」处理 | `web/src/utils/pinnedStorage.ts` | 改置顶会话的本地读写 |
| `process.ts` | 过程组汇总与文案：`processKind` / `isProcessRunning` / `summarizeProcess` / `liveProcessTitle` / `settledProcessTitle` / `formatDuration` / `processRowKey` / `firstLine` / `turnProcessKey` | `web/src/utils/process.ts` | 改过程区的汇总、活动词、耗时文案 |
| `toolViews.ts` | 工具行视觉判定：`toolBodyKind`（`blocks` > `text` > `empty` 的信息量优先级）、`toolExpandable` | `web/src/utils/toolViews.ts` | 改工具行是否可展开、展开体算什么类型 |
| `turns.ts` | `projectTurns`：把宿主下发的平铺条目投影成轮次；轮次边界来自宿主的 `kind === 'turn'` 条目，`user` 开新轮只是回退规则 | `web/src/utils/turns.ts` | 改「平铺条目 → 轮次」的投影 |

## 规则

### 引用方向

**1. 纯函数优先，不引业务组件。**

- **规则**：本层函数尽量无状态、无 React 依赖；不 `import` `web/src/page/` 或 `web/src/components/`。
- **为什么**：这一层是单向链上被所有层引用的位置，一旦反向引用立刻成环。
- **后果**：`utils → components` 的引用会与 `components → utils` 组成环，构建与推理都会变脆。

### 单一真相源

**2. 不维护宿主命令的副本。**

- **规则**：`LOCAL_COMMANDS` 只放**只有前端能做**的命令（本地菜单、展开过程、关标签页等）；其余命令一律来自 `CatalogView.commands`，由 `mergeCommands` 合并，同名以本地为准。
- **为什么**：命令的名字、说明与可用性由宿主决定，前端复制一份必然滞后。
- **后果**：补全列表出现宿主已经不认的命令，用户点下去没有反应。

### 模块边界

**3. 文案分工：宿主给文案与载荷，前端只决定怎么画。**

- **规则**：工具标题、参数摘要、结果文本、错误文本都由宿主下发；前端只做形态判定与状态记号。唯一例外是 `web/src/utils/process.ts` 里的**进行中活动词**（「正在搜索」这类随每帧变化的高频文案，见该文件注释）。
- **为什么**：只有前端才知道这一刻怎么画；也只有宿主才知道业务语义与脱敏边界。
- **后果**：把业务文案搬进前端会造出第二份口径，宿主改了用户看不到变化。

### 副作用位置

**4. 浏览器出网只走 `api.ts`。**

- **规则**：所有 `fetch` 与 `EventSource` 都写在 `web/src/utils/api.ts` 里，组件、store、页面不各自发请求。
- **为什么**：身份头（`x-bgm-client` / `x-bgm-session`）与错误信封（非 2xx 时取 `ApiErrorView.message`）只在这一处维护。
- **后果**：绕过它会丢掉身份头，宿主按空 `clientId` / 旧 `sessionId` 处理，症状是「命令发给了别的会话」或确认卡收不到回执。

**5. 本地持久化只走 `pinnedStorage.ts`。**

- **规则**：组件与 reducer 都不碰 `localStorage`；读写集中在此文件，落盘由 `web/src/store/index.ts` 的一处订阅触发。
- **为什么**：`localStorage` 在隐私模式下会直接抛异常，容错逻辑只写一遍。
- **后果**：分散读写会让首屏在隐私模式下崩溃，或让 reducer 变成有副作用的函数。
