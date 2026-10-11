# constants：主界面常量

> 覆盖 `web/src/page/mainPage/constants/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/constants/` 是主界面专有的常量层：**只放表，不放判定**——判定与派生属于 [utils.md](utils.md)（与顶层 [../../constants.md](../../constants.md) 规则 2 同一判据）。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `sessionGroups.ts` | `SESSION_GROUP_ORDER`：会话分组的固定顺序（「置顶」永远在最前，其余按时间由近到远）；零依赖纯数据，与 `utils/relativeTime.ts` 的 `sessionDayGroup` 分档一一对应 | `web/src/page/mainPage/constants/sessionGroups.ts` | 改分组顺序或增删分组 |

## 规则

### 单一真相源

**1. 会话分组与顺序以本表为准，不采信宿主下发的顺序。**

- **规则**：宿主下发的 `catalog.sessions` 只管「有哪些会话」，其数组顺序**不作保证**；侧栏按 `SESSION_GROUP_ORDER` 分桶，「这条属于哪一组」由 [utils.md](utils.md) 的 `sessionDayGroup` 算，「置顶」作为与时间无关的一档单独挑出。
- **为什么**：宿主的排序策略（最近活动、服务端顺序、置顶）随时可能变，界面按自己的表分桶才不会跟着跳；顺序单独成表后，调整分组不必碰时间逻辑。
- **后果**：直接按下发顺序渲染，用户会看到分组边界随机漂移、置顶会话不再固定在最前，而这两件事都没有报错提示。
