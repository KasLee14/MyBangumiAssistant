# 斜杠命令（`utils/commands.ts`）

## 简介

斜杠命令的候选表与匹配规则：本地六条命令、与宿主命令的合并去重、补全匹配条件、`/help` 文案，以及未登记命令的拦截。

维护**只有浏览器才能做的那部分命令**，并把宿主注册的命令合并成一张候选表。它不执行任何命令——执行在 `store/operations.ts` 的 `localCommand()`。

**不覆盖**：命令的执行与提示（`store/operations.ts`），以及宿主的命令注册。

上层：[readme.md](readme.md)。使用方：`Composer`（补全与执行）、`store/operations.ts`（`/help` 文案与未登记命令拦截）。

## 使用说明

- **加本地命令前先读 §规则**：六条的 `action` 对照与四条约定都在那里；`action` 漏填或没在 `localCommand()` 加分支，命令会出现在补全里但点了没反应。
- **只想查某条本地命令、某个函数或类型**：直接查 §索引 的本地命令表与函数清单，不必通读本文。
- **改补全表来源、`/help` 文案或拦截行为**：按 §索引 的「章节 → 场景」跳到 §规则 对应小节。
- 本层通用规则（无状态、错误只抛出、文案集中）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 只加"浏览器侧动作"

新增一条本地命令前先问"宿主能不能做"；能，就交给宿主注册，不要在这里加。

**为什么本地表不抄宿主命令**：宿主那边是命令的唯一权威（`CatalogView.commands`），浏览器维护副本必然漂移。所以这里只保留"宿主做不到、必须浏览器做"的六条。

**违反后果**：命令表与宿主漂移，出现两份真相。

### `action` 必填，并在 `operations.localCommand()` 里加分支

`action` 是新命令的必填项（除纯展示用途外），并在 `operations.localCommand()` 的 `switch` 里加分支。

**违反后果**：命令出现在补全里但点了没反应。

### 合并只在 `catalog` reducer 里做一次

```ts
mergeCommands(hostCommands: readonly CommandOptionView[]): CommandHint[]
```

- 以本地表为底，再逐个追加宿主命令（`/bangumi-login`、扩展命令、提示模板、技能等）；
- **同名以本地实现为准**（`local` 集合去重），避免补全里出现两条一样的命令；
- 宿主命令的 `hint` 用宿主的 `description`，缺省退回 `source`。

合并发生在 `store/reducers/catalog.ts`（收到 `catalog/loaded` 时算一次），组件从 `catalog.commands` 读结果——**不要在组件里再合并一次**。

**违反后果**：组件各算一份，引用不稳定导致每帧重渲染（见 [../store/readme.md](../store/readme.md) 的「selector 不得新建引用」）。

### 候选只在 `/` 开头且还没有空格时出现

`matchCommands(text, commands)` 只在 `/^\/[^\s]*$/` 成立时返回候选（即以 `/` 开头且还没有空格的输入）。因此：

- 输入 `/mo` → 候选 `/model`；
- 输入 `/model `（带参数）→ 不再弹候选，直接交给宿主或本地动作。

### `/help` 文案从运行时合并表拼出

`helpText(commands)` 把当前合并表拼成一行中文提示（`/help` 用）。因为入参是运行时合并结果，所以宿主后注册的命令会自动出现在 `/help` 里，不需要改代码。

### 未登记命令不发给宿主

`operations.send()` 对**以 `/` 开头且不含换行的输入**做一次登记检查：不在合并表里就拦下并提示"没有匹配命令，请继续编辑；输入 / 查看命令列表。"，**不发给宿主**。这是唯一一处前端拦截，原因是避免把明显的输入错误变成一轮模型调用。

### 命令名保持英文、展示文案用中文

命令的展示文案用中文，命令名保持英文（与宿主一致）。

### 加完更新表格并跑回归

加完更新本文件与 [readme.md](readme.md) 的表格，并按 [../regression/commands-and-shortcuts.md](../regression/commands-and-shortcuts.md) 回归补全与执行。

## 索引

### 类型与本地命令表

```ts
export interface CommandHint {
  value: string;    // 形如 '/help'
  label: string;    // 展示用，通常与 value 相同
  hint: string;     // 一句话说明
  action?: 'help' | 'details' | 'exit' | 'model' | 'sessions' | 'new';
}
```

`LOCAL_COMMANDS` 六条，带 `action` 的就是需要浏览器侧处理的：

| 命令 | action | 浏览器做什么 |
|---|---|---|
| `/help` | `help` | 用当前合并表拼一段提示文本，发全局提示 |
| `/new` | `new` | 调 `/api/session`（new） |
| `/model` | `model` | 打开设置并直达「模型选择」行 |
| `/sessions` | `sessions` | 打开历史会话弹窗 |
| `/details` | `details` | `ui.reveal` 递增（展开过程折叠块） |
| `/exit` | `exit` | 只提示"直接关标签页即可，宿主仍在运行" |

### 函数清单

| 函数 | 什么时候看 |
|---|---|
| `mergeCommands(commands)` | 改补全表来源、处理与宿主同名冲突时（见 §规则「合并只在 `catalog` reducer 里做一次」） |
| `matchCommands(text, commands)` | 改候选触发条件时（见 §规则「候选只在 `/` 开头且还没有空格时出现」） |
| `helpText(commands)` | 改 `/help` 输出格式时（见 §规则「`/help` 文案从运行时合并表拼出」） |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §只加"浏览器侧动作" | **加本地命令前必读**（含六条的 `action` 对照见 §索引「类型与本地命令表」） |
| §`action` 必填，并在 `operations.localCommand()` 里加分支 | 加一条新命令时 |
| §合并只在 `catalog` reducer 里做一次 | 改补全表来源、处理与宿主同名冲突时 |
| §候选只在 `/` 开头且还没有空格时出现 | 改候选触发条件时 |
| §`/help` 文案从运行时合并表拼出 | 改 `/help` 输出格式时 |
| §未登记命令不发给宿主 | 改"拦下未登记斜杠输入"的行为时 |
| §命令名保持英文、展示文案用中文 | 写命令的 `hint` 与提示文案时 |
| §加完更新表格并跑回归 | 收尾核对（四条约定） |
