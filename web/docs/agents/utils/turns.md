# 轮次投影（`utils/turns.ts`）

> 上层：[readme.md](readme.md)。使用方：`components/mainPage/conversation/ConversationView.tsx`（`useMemo` 固定引用）与 `TurnView.tsx`（消费 `TurnGroup`）。

## 定位

宿主下发的是**平铺的条目数组**（`TranscriptItemView[]`），不提供轮次边界。这个文件把平铺条目投影成"轮次"，供界面分组渲染。

它是**纯展示分组**：不改变宿主语义、不参与确认判定、不影响任何写回宿主的请求。

## 结构

```ts
export interface TurnGroup {
  id: number;                    // 该轮次的 id：有 user 条目时用它，否则取开启这一轮的第一条
  user: TextItem | null;         // 该轮的用户消息（前导内容没有 user）
  body: TranscriptItemView[];    // 主体：回答、结果、确认卡、内容条目
  process: TranscriptItemView[]; // 过程：工具活动（activity），进折叠块
}
```

## 投影规则（`projectTurns`）

1. 遇到 `kind === 'user'` 的条目 → **开启新轮次**，并把它放进 `user`；
2. `kind === 'activity'` → 进当前轮次的 `process`（工具活动默认折叠，运行中展开）；
3. 其余（`assistant` / `notice` / `error` / `header` / `confirmation` / 12 种内容条目）→ 进当前轮次的 `body`，保持原顺序；
4. 还没有任何轮次时遇到非 user 条目 → 自动开启一个 `user: null` 的轮次（会话头、命令回显等前导内容就落在这里）。

## 使用约定

| 约定 | 原因 |
|---|---|
| 在 `ConversationView` 里用 `useMemo(() => projectTurns(items), [items])` | 流式帧只改标量（`liveText` 等），`items` 引用不变 → `turns` 引用稳定 → 配合 `TurnView` 的 `memo` 让历史轮次整体跳过重渲染 |
| 轮次导航只统计 `user !== null` 的轮次 | 前导内容（会话头、通知）不算一轮，否则导轨上会出现点不到内容的空轮 |
| 不要在 `projectTurns` 里做过滤/排序/回写 | 它只做形状转换；宿主给什么顺序就是什么顺序 |

## 加字段或改规则时

- 需要新增"过程类"条目（例如新的活动类型）→ 在规则 2 里加判定，并确认 `TurnView` 的 `ProcessGroup` 能渲染它；
- 需要新的分组维度（例如按工具批次分组）→ 先想清楚是否真的属于**展示投影**；若涉及宿主语义（例如确认状态），那应该在宿主或 store 里表达，而不是在这里补。
- 改完按 [../regression/session-flow.md](../regression/session-flow.md) 的"过程折叠"与"轮次导航"用例回归。
