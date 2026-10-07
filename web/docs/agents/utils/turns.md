# 轮次投影（`utils/turns.ts`）

## 简介

把宿主下发的平铺条目切成「轮次」的规则：`TurnGroup` 结构、边界判定、过程与主体的分流，以及唯一一条回退规则。

宿主**自带轮次边界**（`kind: 'turn'` 的条目，见 `bangumi/src/web/protocol.ts` 的 `TurnItemView`），所以这个文件只做形状转换，不做语义判定。

它是**纯展示分组**：不改变宿主语义、不参与确认判定、不影响任何写回宿主的请求。

**不覆盖**：轮次的渲染与轮次导航本身（在 `components/mainPage/conversation/Stage.tsx` 与 `Turn.tsx`），过程行的汇总与文案（见 [process.md](process.md)），工具行的视觉表（见 [toolViews.md](toolViews.md)），以及宿主侧的条目生成（`bangumi/src/web/session.ts`）。

上层：[readme.md](readme.md)。使用方：`components/mainPage/conversation/Stage.tsx`（`useMemo` 固定引用）与 `Turn.tsx`（消费 `TurnGroup` 的 `user` / `process` / `body` / `meta`）。

## 使用说明

- **改分组规则前先读 §规则**：边界判定、过程与主体的分流、`meta` 可空三条都在那里；违反会让界面与宿主状态不一致（涉及确认判定时尤其危险），或让历史轮次每帧重渲染。
- **只想查 `TurnGroup` 的字段、某条规则的归属**：直接查 §索引，不必通读 §规则。
- **扩展投影前**：照 §规则 末条「加字段或改规则时」逐条自检，再按 [../regression/session-flow.md](../regression/session-flow.md) 的「过程折叠」与「轮次导航」用例回归。
- 本层通用规则（无组件无 hook、不复制协议类型、错误只抛出、文案集中）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 轮次边界来自宿主，前端不推导

`kind === 'turn'` 的条目**开启一个轮次组**：它是边界标记（起止时间、`status`、`messageCount` / `toolCallCount`、每轮 `usage`），本身不承载过程或正文。宿主在两个时刻发它：

- **实时**：Pi 的 `agent_start` 开一轮、`agent_end` 封口（`session.ts` 的 `openTurn` / `closeTurn`）；
- **历史重建**：落盘条目没有轮次字段（`SessionEntryBase` 只有 id/parentId/timestamp），宿主按「一条 user 消息开启一个用户回合」推导，规则与实时路径一致。

**正因为它存在，前端才不需要「按 user 条目猜轮次」**——那是改造前的做法，宿主一换分组规则界面就不会跟。

**违反后果**：前端又长出一套与宿主不一致的轮次语义。

### 条目自带的 `turn` 变化即换组，回退规则只有一条

`assistant` / `reasoning` / `tool` 三类条目都带 `turn`（用户回合号）与 `step`（该回合内第几次模型响应），`turn` 条目也带 `turn`。投影依次判三件事：

1. 遇到 `kind === 'turn'` → 用它开一个新组，`meta` 就是它（边界标记**自带**元数据）；
2. 当前组的 `turn` 与条目的 `turn` **都非 0 且不相等** → 换组，`meta` 为 `null`；
3. **回退**：当前组已经有 `user` 时再遇到 `user` → 换组。

第 3 条只在「条目带轮次号、却没有对应轮次条目」时生效（宿主投影遗漏或协议外的形态漂移），目的是让界面仍然可用，而不是把所有内容挤进一组。

**违反后果**：宿主换了分组规则界面不跟，或前导内容与整段对话被挤进同一组。

### 过程与主体的分流：只认 `kind`，不判「谁算最终回答」

- `reasoning` 与 `tool` → `process`（过程区，交给 `TurnProcessBar` / `ProcessGroup`）；
- `user` → `user` 槽位（一轮只有一个）；
- 其余（`assistant` / `notice` / `error` / `header` / `confirmation`）→ `body`，保持原顺序。

「哪一条是最终回答」「哪一条属于过程」**都不在浏览器判定**：宿主把思考与工具单独投影成 `reasoning` / `tool` 条目，前端只按 `kind` 归位（[AGENTS.md](../../../AGENTS.md) §规则 跨层强制约束第 7 条）。往这里补一条「只有带正文的 assistant 才算回答」之类的判定，就是给宿主的语义造第二份。

**违反后果**：过程区与正文的边界出现第二套判定；宿主调整投影后界面不跟。

### `meta` 可以为 `null`：不是每个条目都属于某个回合

会话开头的通知、扩展注入的内容（`origin: 'extension'`）不属于任何回合，宿主也不会为它们发轮次条目——此时组的 `meta` 为 `null`，轮控制行只显示按族汇总的标题（见 [process.md](process.md) 的 `settledProcessTitle`）。消费 `meta` 的地方必须处理 `null`（`TurnProcessBar` 就是这么写的）。

### 投影结果必须在 `Stage` 里用 `useMemo` 固定引用

在 `Stage` 里用 `useMemo(() => projectTurns(items), [items])`。原因：流式帧只改标量（`liveContent` 等），`items` 引用不变 → `turns` 引用稳定 → 配合 `Turn` 的 `memo` 让历史轮次整体跳过重渲染。

**违反后果**：流式帧每帧重算，历史轮次全部重渲染。

### 轮次导航的输入必须筛掉 `user === null` 的轮次

轮次导航的候选表是 `useMemo(() => turns.filter(turn => turn.user !== null), [turns])`。原因：前导内容（命令回显、通知）不算一轮，否则导轨上会出现点不到内容的空轮；过滤过的数组同样要固定在 `turns` 引用上，才不会被每帧重建。

**违反后果**：导轨上出现点不到内容的空轮，或过滤数组每帧重建。

### 加字段或改规则时

- 需要新增一种「过程类」条目 → 先判它是不是**过程**：是，就在分流里加判定，并确认 `ProcessRow` 能渲染它（见 [../components/main-page.md](../components/main-page.md)）；不是，就进 `body`，由 `Turn` 的 `BodyItem` 渲染；
- 需要新的分组维度（例如按工具批次分组）→ 先想清楚是否真的属于**展示投影**；若涉及宿主语义（例如确认状态），那应该在宿主或 store 里表达，而不是在这里补；
- 改完按 [../regression/session-flow.md](../regression/session-flow.md) 的「过程折叠」与「轮次导航」用例回归。

## 索引

### `TurnGroup` 结构

```ts
export interface TurnGroup {
  id: number;                    // React key：有轮次条目时用它，否则用开启这一组的那条条目
  turn: number;                  // 用户回合号；前导组为 0
  meta: TurnItemView | null;     // 宿主下发的轮次条目（边界与元数据）；没有边界条目时为 null
  user: TextItem | null;         // 该轮的用户消息（前导内容没有 user）
  process: ProcessItem[];        // 过程：思考行与工具行
  body: TranscriptItemView[];    // 主体：回答、通知、错误、确认卡
}
export type ProcessItem = ReasoningItemView | ToolItemView;
```

`TextItem` 是 `user` / `notice` / `error` 三种带纯文本的条目——**助手条目不在其中**（它的正文是内容块数组 `content: MessageBlock[]`），所以只有 `user` 占 `user` 槽位，助手条目落在 `body`。

「条目自带轮次号」只对 `assistant` / `reasoning` / `tool` / `turn` 成立，其余 `kind` 一律返回 0。

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §轮次边界来自宿主，前端不推导 | 想恢复「按 user 猜轮次」、或问「轮次条目是谁发的」时 |
| §条目自带的 `turn` 变化即换组，回退规则只有一条 | **改分组规则（哪些条目开新组）时必读** |
| §过程与主体的分流：只认 `kind`，不判「谁算最终回答」 | 想在这里判定「哪条是过程 / 哪条是回答」时 |
| §`meta` 可以为 `null`：不是每个条目都属于某个回合 | 消费轮次元数据（耗时、计数、用量）时 |
| §投影结果必须在 `Stage` 里用 `useMemo` 固定引用 | 动轮次渲染性能时 |
| §轮次导航的输入必须筛掉 `user === null` 的轮次 | 改轮次导航（`railTurns`）时 |
| §加字段或改规则时 | 扩展投影前的自检清单 |
| §`TurnGroup` 结构 | 改 `TurnGroup` 字段时 |
