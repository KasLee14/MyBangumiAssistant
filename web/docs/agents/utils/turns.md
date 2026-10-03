# 轮次投影（`utils/turns.ts`）

## 使用说明

### 这份文档是什么

把宿主下发的平铺条目投影成"轮次"的规则：`TurnGroup` 结构、四条投影规则、以及使用与扩展约定。

上层：[readme.md](readme.md)。使用方：`components/mainPage/conversation/ConversationView.tsx`（`useMemo` 固定引用）与 `TurnView.tsx`（消费 `TurnGroup`）。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §结构 | 改 `TurnGroup` 字段时 |
| §投影规则 | **改分组规则（哪些算过程、前导内容归属）时必读** |
| §使用约定 | 动轮次渲染性能或轮次导航时 |
| §加字段或改规则时 | 扩展投影前的自检清单 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **只做形状转换**：不过滤、不排序、不回写宿主语义 —— 违反后果：界面与宿主状态不一致（涉及确认判定时尤其危险）。
2. **必须在 `ConversationView` 里用 `useMemo` 固定引用** —— 违反后果：流式帧每帧重算，历史轮次全部重渲染。
3. **轮次导航只统计 `user !== null` 的轮次** —— 违反后果：导轨上出现点不到内容的空轮。

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
