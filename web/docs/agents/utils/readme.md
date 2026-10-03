# 工具层（`web/src/utils/`）

> 上层入口：[../../AGENTS.md](../../../AGENTS.md)。本文件是工具层的索引与划分规则。

## 这一层的职责

放**与界面无关**的东西：纯函数，以及宿主接口的唯一封装。

| 允许 | 不允许 |
|---|---|
| 依赖 `bangumi/src/web/protocol.ts` 的类型 | import React（这里没有任何 JSX 与 hook） |
| 纯计算、数据投影、文案拼装 | import `store/`（工具层不认识全局状态） |
| 发起 HTTP / 建立 SSE（仅 `api.ts`） | 直接改界面状态或弹提示（那是 `store/operations.ts` 的事） |

判断一个函数该不该放这里：**把它单独 `import` 到一个空白脚本里，还能跑吗？** 能，就属于工具层。

## 划分依据：一个功能类别一个文件

| 文件 | 功能类别 | 关键导出 |
|---|---|---|
| [api.ts](api.md) | 宿主接口（HTTP + SSE） | `submitInput`、`fetchCatalog`、`openStream` … 共 15 个 |
| [commands.ts](commands.md) | 斜杠命令候选表与匹配 | `LOCAL_COMMANDS`、`mergeCommands`、`matchCommands`、`helpText` |
| [turns.ts](turns.md) | 条目 → 轮次的展示投影 | `projectTurns`、`TurnGroup` |
| [credentialLabel.ts](credentialLabel.md) | 凭据来源的共用措辞 | `AUTH_LABEL` |

规模悬殊是有意的：`credentialLabel.ts` 只有 9 行也单独成文件，因为它是**被两个组件共用的措辞表**；而 `api.ts` 承载全部端点。**判据是"功能类别"，不是行数。**

## 规则

1. **无组件、无 hook、无状态**：所有导出都是函数、常量或类型。唯一带副作用的是 `api.ts` 里的网络请求。
2. **错误语义统一**：`api.ts` 只把宿主的 `ApiErrorView.message` 包成 `Error` 抛出，不做提示、不重试、不改写文案。谁调用、谁决定怎么提示（见 [../store/actions-and-operations.md](../store/actions-and-operations.md)）。
3. **不复制协议类型**：跨端类型从 `protocol.ts` 取；这里的类型要么是协议类型的别名，要么是纯前端的投影结构（如 `TurnGroup`）。
4. **文案集中在能共用的地方**：同一句话若出现在两处界面，就抽成这里的常量（`AUTH_LABEL` 是范例），避免两处漂移。
5. **不写"顺手"的通用工具**：没有第二个调用方的工具函数不要提前抽出来。

## 新增一个工具文件时

1. 确认它是**新的功能类别**（同类别追加进已有文件即可，例如再加一条本地命令写进 `commands.ts`）；
2. 文件顶部写清"这一层为什么存在、边界是什么"（中文注释，与既有文件风格一致）；
3. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。

## 子文档

- [api.md](api.md)：宿主端点的完整清单、`post` 封装、`openStream` 的生命周期。
- [commands.md](commands.md)：本地命令与宿主命令的合并规则、补全匹配条件。
- [turns.md](turns.md)：轮次投影规则与它为什么属于展示层。
- [credentialLabel.md](credentialLabel.md)：凭据四态的措辞表与使用位置。
