# 工具行的视觉表（`utils/toolViews.ts`）

## 简介

工具行**怎么画**的那张表：六种状态的记号与文案，以及展开体该渲染什么（内容块 / 纯文本 / 什么都没有）。

分工是刻意的：**宿主导出文案与载荷**（工具中文标题、参数摘要、参数原文、结果内容块、状态名），**这里只决定视觉**——状态记号与展开体的类型。新增一种状态或一种展开体，只改这张表。

**不覆盖**：工具族的**图标几何**（在 `components/mainPage/conversation/ProcessIcons.tsx` 的 `PATHS` 表）、宿主侧的投影（`bangumi/src/web/tool-view.ts` 的 `ToolViewSpec` / `toolOutcome`）、工具条目的字段定义（`protocol.ts` 的 `ToolItemView`）。

上层：[readme.md](readme.md)。使用方：`components/mainPage/conversation/ProcessRows.tsx` 的 `ToolRow` / `ToolResultBody`。

## 使用说明

- **想加一种状态**：改 §规则「六态是一张表」的 `TOOL_STATE`，并同步 `protocol.ts` 的 `ToolState` 与宿主 `tool-view.ts` 的产出——协议、宿主、视觉三处不同步时，界面会显示 `undefined` 的记号。
- **想知道「为什么这行没有展开钮」**：查 §规则「没有可展开的内容就不渲染展开钮」。
- **想给某个工具换图标**：那不是这个文件的事，去 `ProcessIcons.tsx` 的 `PATHS`（按 `ToolFamily`）。

## 规则

### 六态是一张表，记号沿用改造前的活动条目

```ts
export const TOOL_STATE: Record<ToolState, { mark: string; label: string }> = { … };
```

| 状态 | 记号 | 文案 |
|---|---|---|
| `running` | `·` | 进行中 |
| `waiting` | `…` | 额度等待 |
| `ok` | `✓` | 完成 |
| `partial` | `!` | 未全部完成 |
| `unknown` | `?` | 结果待核实 |
| `error` | `×` | 失败 |

**记号沿用改造前活动条目的那六个**（只把承载从「一行字符串」换成了结构），因此用户看到的状态语言没有变。`label` 不是装饰：`ToolRow` 把记号标成 `aria-hidden`，把 `label` 放进 `.visuallyHidden`（`styles/common.css` 里的共享类）——屏幕阅读器读到的是「完成」，而不是「✓」。改表时两列都要留。

状态的**语义**由宿主决定（`tool-view.ts` 的 `toolOutcome` 与 `write-activity.ts` 的批次投影：`failed` / `unknown` 都映射到对应状态），这里不重判。`ToolRow` 把状态写进 `data-state`，样式的颜色与强调由 `frame.css` 收在 `.processState` 上。

### 展开体只从「结果」判类型，优先级是内容块 > 纯文本 > 空

```ts
export type ToolBodyKind = 'blocks' | 'text' | 'empty';
export function toolBodyKind(item: ToolItemView): ToolBodyKind
```

- `result.blocks.length > 0` → `blocks`：交给 `MessageBlocks`（与助手正文**同一个渲染入口**，因此 Bangumi 工具结果里的 `presentation` 载荷与正文用的是同一套 12 种内容块）；
- 否则 `result.text` 非空 → `text`：等宽 `pre` 兜底（原始 JSON、超长纯文本）；
- 都没有 → `empty`（渲染「暂无结果。」）。

**两者可能同时存在**：宿主只在「没有内容块」或「失败」时才保留结果文本（见 `tool-view.ts` 的 `keepText`），所以失败时是「内容块 + 失败原因文本」并存——`ToolResultBody` 因此把 `errorText` 单独渲染在块序列之前，而不是二选一。

`result === undefined`（还没结束）也算 `empty`，但那时通常也没有展开钮。

### 没有可展开的内容就不渲染展开钮

```ts
export function toolExpandable(item: ToolItemView): boolean
```

三选一命中即可展开：**子调用**（`subCalls` 非空）、**参数原文**（`argsText` 非空）、**结果体不是空**（`toolBodyKind(item) !== 'empty'`）。

判据在渲染前先算一次（`ToolRow` 里 `const expandable = toolExpandable(item)`），因为展开钮与展开体是同一个条件：没有可展开内容时 `ToolRow` 的标题按钮 `disabled` 且不渲染 chevron——**不渲染一个点了没反应的控件**。

注意 `argsText` 与 `summary` 不是一回事：`summary` 是宿主压平、截断后的**参数摘要**（一行，永远有位置显示）；`argsText` 是 pretty JSON **原文**，超过阈值时宿主干脆不下发（见 `tool-view.ts` 的 `ARGS_LIMIT`），此时参数就只有摘要。

## 索引

### 导出

| 导出 | 作用 |
|---|---|
| `TOOL_STATE` | 六态的记号与文案表（`Record<ToolState, { mark, label }>`） |
| `ToolBodyKind` | `'blocks' \| 'text' \| 'empty'` |
| `toolBodyKind(item)` | 按结果判展开体的类型（优先级见 §规则） |
| `toolExpandable(item)` | 这一行有没有可展开的内容 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §六态是一张表，记号沿用改造前的活动条目 | **加状态、改状态记号或无障碍文案时必读** |
| §展开体只从「结果」判类型，优先级是内容块 > 纯文本 > 空 | 工具结果不显示、失败原因被内容块挤掉时 |
| §没有可展开的内容就不渲染展开钮 | 展开钮点了没反应、或想问「为什么这行没有箭头」时 |
| §导出 | 找某个函数的职责时 |
