# types：跨模块类型层

> 覆盖 `web/src/types/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/types/` 放**跨模块**的类型定义，是叶子层：谁都可以引用，它自己不引业务模块（只引其它 `types/` 或宿主的协议文件）。内容分两类：

- **跨端协议的中转**：`web/src/types/protocol.ts` 只做 `export type *` 转发，真正的定义在 `bangumi/src/web/protocol.ts`；
- **前端内部的跨模块形状**：轮次分组、过程汇总、内容块 kind、命令候选、事件流回调、工具展开体。

判据是「谁消费它」：页面私有的类型在 `web/src/page/<页面>/types/`，模块私有的 Props 就地留在组件文件里。

## 索引

按功能模块分组：**跨端协议**只有一个转发入口，其余文件是前端内部的跨模块形状。

### 跨端协议中转

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `protocol.ts` | 跨端协议的**唯一入口**：`export type * from '../../../bangumi/src/web/protocol'`，转发 `TranscriptItemView`（9 种 kind）、`MessageBlock`、`ChatScalarsView` / `ChatStateView`、`ServerEvent` 与全部客户端命令载荷；本文件不产生第二份定义 | `web/src/types/protocol.ts` | 查跨端协议（帧、条目、内容块载荷、命令载荷） |

### 轮次与内容块形状

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `turns.ts` | `ProcessItem`（思考行 `ReasoningItemView` \| 工具行 `ToolItemView`）、`TurnGroup`（`meta` + `user` + `process` + `body`）；内部的 `TextItem` 只含 `user` / `notice` / `error`，**助手条目不在其中**（它的正文是内容块数组 `content: MessageBlock[]`） | `web/src/types/turns.ts` | 改「平铺条目 → 轮次」的产物形状 |
| `content.ts` | `ContentKind`：12 个成员，取值就是**组件名**（与 `web/src/components/content/` 的文件名一致），因此不需要「语义名 → 组件」的对照表 | `web/src/types/content.ts` | 加 / 改一种内容块（同时要改 `web/src/components/content/registry.tsx` 的渲染表） |
| `process.ts` | `ProcessKind`（`ToolFamily \| 'reasoning'`）、`ProcessSummary`（`total` / `counts` 按数量降序 / `active` 为进行中的项或 `null`） | `web/src/types/process.ts` | 改过程区汇总（计数、活跃项） |
| `tools.ts` | `ToolBodyKind`：工具行展开体渲染什么——`'blocks' \| 'text' \| 'empty'` | `web/src/types/tools.ts` | 改工具行展开体的三种类型 |

### 命令与事件流

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `commands.ts` | `CommandHint`（`value` / `label` / `hint` / `action?`）；`action` 是浏览器侧要处理的动作，后端命令没有它 | `web/src/types/commands.ts` | 改命令候选条目的形状 |
| `api.ts` | `StreamHandlers`（`onFrame` / `onStatus`）：事件流的两个回调，`onStatus` 只在连接开合时触发 | `web/src/types/api.ts` | 改事件流的回调签名 |

## 规则

### 引用方向

**1. 叶子层不引业务。**

- **规则**：本目录只 `import` 其它 `web/src/types/` 或宿主协议，不 `import` `web/src/components/`、`web/src/page/`、`web/src/store/`、`web/src/utils/`。
- **为什么**：叶子层会被所有层引用，一旦反向引用就立刻成环。
- **后果**：`types → components → types` 这样的环会把模块初始化顺序问题变成随机崩溃，且复现困难。

### 单一真相源

**2. 跨端类型只有一份，在宿主侧。**

- **规则**：协议类型不在这里定义，`web/src/types/protocol.ts` 只做 `export type *` 转发；消费点统一 `import type … from 'types/protocol'`，不写指向 `bangumi/src/web/protocol` 的深路径，也不复制定义。
- **为什么**：两端各自「类型正确」但字段对不上，是这类项目最难查的一类事故；转发层同时把「协议文件换位置」的深度变化收敛到一行。
- **后果**：一旦出现第二份定义，协议改动后前端静默不同步——编译不报错，运行时字段落空。

### 归位与命名

**3. 只放跨模块契约。**

- **规则**：页面私有的类型放 `web/src/page/<页面>/types/`；模块私有的 Props 与 `typeof` / `ReturnType` 反推的类型**就地保留**，不上提到这里。
- **为什么**：判据是「谁消费它」而不是「它长得像类型」；就地保留能避免一份清单变成两处维护。
- **后果**：顶层类型目录膨胀成杂物间，同时引用方向开始混乱（组件类型反过来引用组件实现）。

### 产物边界

**4. 一律 `import type`，本目录不产生运行时代码。**

- **规则**：本目录没有任何值导出（枚举、常量、函数都不放这里），导入一律带 `type` 关键字。
- **为什么**：`verbatimModuleSyntax` 开启，类型导入与值导入在产物里区分明确；本目录的定位就是纯类型。
- **后果**：混入值导出会让「类型目录」参与运行时依赖图，可能把宿主侧模块拖进前端包里。
