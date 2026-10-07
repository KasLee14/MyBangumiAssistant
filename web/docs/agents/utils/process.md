# 过程组的汇总与文案（`utils/process.ts`）

## 简介

过程区（一轮里的思考行与工具行）的**汇总**与**中文活动文案**：族与计数怎么算、状态行标题怎么拼、耗时怎么写、展开状态的键长什么样。

它是纯函数模块：只吃 `ProcessItem[]`（`reasoning` / `tool` 条目，见 [turns.md](turns.md)），不碰 React、不读 store。

**不覆盖**：工具行的状态记号与展开体判定（见 [toolViews.md](toolViews.md)）、过程区的渲染与折叠（见 [../components/main-page.md](../components/main-page.md)）、工具标题与参数摘要（那些在宿主 `bangumi/src/web/tool-view.ts`）。

上层：[readme.md](readme.md)。使用方：`components/mainPage/conversation/ProcessGroup.tsx`（`TurnProcessBar` 的标题与计数）、`ProcessRows.tsx`（`ReasoningRow` 的摘要）、`Turn.tsx`（两个键 helper）。

## 使用说明

- **想改状态行的措辞**（「正在搜索」、耗时文案）：先读 §规则「活动词留在前端是一处有意例外」——改这里之前要确认改的确实是「这一刻在发生什么」，而不是宿主已经给出的文案。
- **只想查某个导出做什么**：直接查 §索引的导出表。
- **想问「展开状态存哪、键是什么」**：查 §规则「展开状态的键由两个 helper 定义」，再对 [../store/reducers.md](../store/reducers.md) 的 `ui.processOpen`。

## 规则

### 活动词留在前端是一处有意例外

[readme.md](readme.md) §规则 第 4 条要求「同一句话出现在两处界面就抽到工具层」，而协议开头的约定是「排版文案、状态名、脱敏与控制字符清理全部在宿主侧生成」。这个文件里的 `RUNNING` / `DONE` 两张活动词表**违反后一条**，是有意的：

- 过程组的标题表达的是「这一刻正在发生什么」（正在搜索、正在思考），它**随流式期的每一帧变化**——让宿主每帧下发一句文案，等于给协议加一个高频字段；
- 这条文案不涉及脱敏，也不承载业务语义（工具名、参数、结果才是）。

**边界因此是**：活动词（`RUNNING` / `DONE`）与耗时的**格式**留在前端；**工具中文标题、参数摘要、结果文本、状态名**仍由宿主导出（`bangumi/src/web/tool-view.ts` 与 `protocol.ts` 的 `ToolItemView`）。把工具标题这类文案也搬到这里的表里，就是同一个事实的第二个来源。

### 汇总：计数按数量降序，`active` 取平铺顺序里第一个进行中的项

`summarizeProcess(items)` 返回三样东西：

| 字段 | 含义 |
|---|---|
| `total` | 过程项总数（状态行的「N 步」读它） |
| `counts` | 按**族**（`ProcessKind` = 工具族 或 `'reasoning'`）计数，**按数量降序**；数量并列时保持首次出现的顺序（`Array.prototype.sort` 稳定） |
| `active` | 第一个 `state === 'running' \|\| 'waiting'` 的项；没有就是 `null` |

`active` 取的是**平铺顺序里第一个**进行中的项（不是最后一个）：同一帧里通常只有一个在跑，真有两个时标题稳定停在先出现的那一个，不会每帧跳。

`isProcessRunning(item)` 是同一判据的单元版本，`processKind(item)` 只做 `reasoning` 与工具族的归一——两者都不看具体工具名。

### 标题：活跃态写「正在做什么 · 细节」，结束态按族汇总

- `liveProcessTitle(summary)`：有进行中的项时，取 `RUNNING[族]` 并在有细节时补 ` · {细节}`（例如「正在搜索 · 攻壳机动队」）；**没有进行中的项时退回 `settledProcessTitle`**——模型正在生成本步正文、过程已经跑完就是这种情形，标题不该继续写「正在…」。
- `settledProcessTitle(summary)`：只取**前两族**，数量大于 1 时写「{词} {N} 项」，还有别的族就补一个「等」；一项都没有时返回「处理过程」。只取两族是因为过程组默认折叠，标题太长会挤掉右侧的耗时与计数。
- `processDetail(item)`：工具用宿主给的 `summary`，思考用自己文本的首行（`firstLine(item.text, 60)`）。
- `firstLine(text, limit)`：取第一段非空文本、去掉 Markdown 的 `**` 记号并压平空白，超长截断加省略号。它是**单行摘要**的统一实现，`ReasoningRow` 的折叠态摘要也用它（limit 80）。

### `formatDuration` 只显示整单位，口径与流式区的秒表一致

`formatDuration(ms)`：`Math.round(ms / 1000)` 后按「N 秒」→「N 分」/「N 分 N 秒」→「N 小时」/「N 小时 N 分」递进，**不补前导零**，负值夹到 0。它与 `Streaming` 里 `Clock` 的「已运行 N 秒」是同一口径（都只显示整单位），两处读数因此不会互相对不上。

### 展开状态的键由两个 helper 定义，不写在组件里

| helper | 返回 | 用途 |
|---|---|---|
| `turnProcessKey(turn)` | `` `${turn}` ``（`String(turn)`） | 整轮过程的展开状态 |
| `processRowKey(turn, id)` | `` `${turn}:${id}` `` | 单个过程行（思考行 / 工具行）的展开状态 |

两者的消费点都是 [`store`](../store/reducers.md) 的 `ui.processOpen`（`Record<string, boolean>`）：键的定义只此一处，组件不自己拼字符串。

**行键用的是条目的 `id` 而不是 `step`**：同一步里可以既有思考行又有工具行，用 `step` 会撞键。（`store/reducers/ui.ts` 里 `processOpen` 的字段注释仍写着 `${turn}:${step}`——那是过期措辞，以这两个 helper 为准。）

**为什么进 store 而不是组件的 `useState`**：这些行会随流式帧反复重渲染，而轮次在会话切换时整体重建，组件私有状态会在重建时丢掉；另外 `undefined`（没记录过）与 `false`（用户显式折叠过）必须区分开——前者走「进行中的轮展开、历史轮折叠」的默认值（见 [../components/main-page.md](../components/main-page.md) §规则「`Turn` 的结构固定四段，过程开合状态由 `openMap` 从 store 传入」的默认值一段）。

**例外**：工具行**子调用**的开合留在 `ToolRow` 内部的 `useState`——那是同一条工具行里的细节，粒度太细，不值得进全局状态。

## 索引

### 导出

| 导出 | 作用 |
|---|---|
| `ProcessKind` | `ToolFamily \| 'reasoning'`：过程项的族 |
| `ProcessSummary` | `{ total, counts, active }` |
| `processKind(item)` | 取过程项的族 |
| `isProcessRunning(item)` | `running` / `waiting` 判据 |
| `summarizeProcess(items)` | 汇总（见 §规则「汇总」） |
| `firstLine(text, limit = 80)` | 单行摘要：首段非空文本、去 `**`、压平空白 |
| `processDetail(item)` | 工具的 `summary` 或思考的首行（limit 60） |
| `liveProcessTitle(summary)` | 活跃态标题（或退回结束态） |
| `settledProcessTitle(summary)` | 结束态标题，前两族 + 「等」 |
| `formatDuration(ms)` | 「N 秒 / N 分 N 秒 / N 小时 N 分」 |
| `turnProcessKey(turn)` / `processRowKey(turn, id)` | `ui.processOpen` 的两个键 helper |
| `RUNNING` / `DONE`（模块私有） | 活跃词与结束词两张表，键是 `ProcessKind` |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §活动词留在前端是一处有意例外 | **改状态行文案、或想把宿主文案再挪到前端时必读** |
| §汇总：计数按数量降序，`active` 取平铺顺序里第一个进行中的项 | 改「N 步」的读数、或状态行每帧跳动时 |
| §标题：活跃态写「正在做什么 · 细节」，结束态按族汇总 | 改轮首控制行的措辞时 |
| §`formatDuration` 只显示整单位，口径与流式区的秒表一致 | 改耗时文案、或两处读数对不上时 |
| §展开状态的键由两个 helper 定义，不写在组件里 | 改展开状态、排查「折叠状态串行」时 |
| §导出 | 找某个函数的职责时 |
