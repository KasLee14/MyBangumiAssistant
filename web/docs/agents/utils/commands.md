# 斜杠命令（`utils/commands.ts`）

## 使用说明

### 这份文档是什么

斜杠命令的候选表与匹配规则：本地六条命令、与宿主命令的合并去重、补全匹配条件、`/help` 文案，以及未登记命令的拦截。

上层：[readme.md](readme.md)。使用方：`Composer`（补全与执行）、`store/operations.ts`（`/help` 文案与未登记命令拦截）。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §类型与本地命令表 | **加本地命令前必读**（含六条的 `action` 对照） |
| §合并规则 | 改补全表来源、处理与宿主同名冲突时 |
| §匹配 | 改候选触发条件时 |
| §文案：`helpText` | 改 `/help` 输出格式时 |
| §未登记命令的处理 | 改"拦下未登记斜杠输入"的行为时 |
| §规则 | 收尾核对（四条约定） |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **只加"浏览器侧动作"**：宿主能做的命令交给宿主注册 —— 违反后果：命令表与宿主漂移，出现两份真相。
2. **`action` 必填，并在 `operations.localCommand()` 加分支** —— 违反后果：命令出现在补全里但点了没反应。
3. **合并只在 `catalog` reducer 里做一次** —— 违反后果：组件各算一份，引用不稳定导致每帧重渲染（见 [../store/readme.md](../store/readme.md) 的「selector 不得新建引用」）。

## 定位

维护**只有浏览器才能做的那部分命令**，并把宿主注册的命令合并成一张候选表。它不执行任何命令——执行在 `store/operations.ts` 的 `localCommand()`。

## 类型与本地命令表

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

## 合并规则：`mergeCommands(commands)`

```ts
mergeCommands(hostCommands: readonly CommandOptionView[]): CommandHint[]
```

- 以本地表为底，再逐个追加宿主命令（`/bangumi-login`、扩展命令、提示模板、技能等）；
- **同名以本地实现为准**（`local` 集合去重），避免补全里出现两条一样的命令；
- 宿主命令的 `hint` 用宿主的 `description`，缺省退回 `source`。

**为什么本地表不抄宿主命令**：宿主那边是命令的唯一权威（`CatalogView.commands`），浏览器维护副本必然漂移。所以这里只保留"宿主做不到、必须浏览器做"的六条。

合并发生在 `store/reducers/catalog.ts`（收到 `catalog/loaded` 时算一次），组件从 `catalog.commands` 读结果——**不要在组件里再合并一次**。

## 匹配：`matchCommands(text, commands)`

只在 `/^\/[^\s]*$/` 成立时返回候选（即以 `/` 开头且还没有空格的输入）。因此：

- 输入 `/mo` → 候选 `/model`；
- 输入 `/model `（带参数）→ 不再弹候选，直接交给宿主或本地动作。

## 文案：`helpText(commands)`

把当前合并表拼成一行中文提示（`/help` 用）。因为入参是运行时合并结果，所以宿主后注册的命令会自动出现在 `/help` 里，不需要改代码。

## 未登记命令的处理

`operations.send()` 对**以 `/` 开头且不含换行的输入**做一次登记检查：不在合并表里就拦下并提示"没有匹配命令，请继续编辑"，**不发给宿主**。这是唯一一处前端拦截，原因是避免把明显的输入错误变成一轮模型调用。

## 规则

1. **只加"浏览器侧动作"**：新增一条本地命令前先问"宿主能不能做"；能，就交给宿主注册，不要在这里加。
2. `action` 是新命令的必填项（除纯展示用途外），并在 `operations.localCommand()` 的 `switch` 里加分支。
3. 命令的展示文案用中文，命令名保持英文（与宿主一致）。
4. 加完更新本文件与 [readme.md](readme.md) 的表格，并按 [../regression/commands-and-shortcuts.md](../regression/commands-and-shortcuts.md) 回归补全与执行。
