# utils：调试页逻辑

> 覆盖 `web/src/page/debug/utils/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/utils/` 是调试页专有的逻辑：宿主模拟器、输入解析与播放参数、调试专用 store 工厂。三个文件都不含**界面状态**——播放中的状态留在 [components.md](components.md) 的壳组件里。

## 索引

按场景找：模拟语义看 `simulator.ts`，逐字节奏与输入解析看 `playback.ts`，调试 store 看 `store.ts`（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `simulator.ts` | 宿主模拟器：把一条 `AgentSessionEvent` 映射成一帧 `StateFrame`；是 `bangumi/src/web/session.ts` 的 `handleEvent` 在浏览器侧的复刻，只保留条目生成、标量改写、工具条目原地更新、轮次边界与用量累计。**不含**宿主的派生计算（token 用量、上下文占用、登录与代理探测），那些字段按固定模拟值处理并在界面上标注 | `web/src/page/debug/utils/simulator.ts` | 改模拟语义；宿主映射逻辑变更后同步 |
| `playback.ts` | 输入解析（两个输入框 → 一条 event 批次或一帧）与播放节奏常量；播放动作本身不在这里 | `web/src/page/debug/utils/playback.ts` | 改输入解析规则或逐字节奏 |
| `store.ts` | 调试专用 redux store 工厂：复用同一份 `rootReducer` 与初始状态，导出 `debugStore` | `web/src/page/debug/utils/store.ts` | 改调试 store 的创建方式 |

## 规则

### 单一真相源

**1. 工具条目的投影直接调用宿主的纯函数。**

- **规则**：模拟器生成工具条目的文案与结果时，直接调用 `bangumi/src/web/tool-view.ts` 的纯函数（与 `message-blocks.ts` 的共用方式一致），不在浏览器侧重写一遍映射；宿主真实做的派生计算不模拟，改用固定值并在界面标注。
- **为什么**：调试页要演练的正是宿主真实走的逻辑。抄一份「简化版映射」后，调试页通过而宿主失败（或反之）时无从判断是谁的问题。
- **后果**：两边映射逐渐分叉，调试页给出的结论失去意义，而分叉点不会有任何报错。
