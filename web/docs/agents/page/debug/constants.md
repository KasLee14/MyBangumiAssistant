# constants：调试页常量

> 覆盖 `web/src/page/debug/constants/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/constants/` 是调试页专有的常量层：模拟器的哨兵值、调试 store 的实例标识、支持的事件表。只放表与取值，判定与派生属于 [utils.md](utils.md)（与顶层 [../../constants.md](../../constants.md) 规则 2 同一判据）。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `simulator.ts` | `KEEP`（`SimStep.play` 的哨兵）、`DEBUG_INSTANCE_ID`（调试专用 store 的实例标识）、`SUPPORTED_EVENTS`（供调试页给出可读的错误提示） | `web/src/page/debug/constants/simulator.ts` | 改实例标识、哨兵或支持的事件表 |

## 规则

### 改动联动

**1. `DEBUG_INSTANCE_ID` 必须非空。**

- **规则**：调试 store 的首帧使用非空的 `DEBUG_INSTANCE_ID`；改动这个值时要同时看 `web/src/store/reducers/stream.ts` 的 `switched` 判定。
- **为什么**：reducer 用 `instanceId` 是否变化来区分「换了实例 → 整体替换」与「同实例 → 增量累加」；首帧给空值会被判成后者，模拟的第一帧就落不到界面上。
- **后果**：调试页首帧无声无息地不生效——没有报错、没有降级卡，只是预览停在空状态，而模拟器看起来一切正常。
