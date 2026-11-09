# debug：调试页

> 覆盖 `web/src/page/debug/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/` 是**调试页**（`/debug`）：左侧输入一条 event 或一帧，右侧用**真实渲染链路**预览结果。侧栏品牌双击也进这一页。

三条设计约束决定了这一页的全部结构：

1. **与真实会话完全隔离**：本页自建一个 redux store（复用同一份 `rootReducer`），调试数据只进这个 store，主 store 一个字节都不动；
2. **预览就是真实渲染**：直接复用 `<Stage>`，不新增任何渲染逻辑，所以「预览所见 = 真实会话所见」；
3. **流式由播放驱动**：模拟器给出目标帧与目标块数组，页面把最后一个文本块按字符演一遍再提交，对应宿主每 40ms 一帧的下发节奏。

本页只做装配：store 在 [utils.md](utils.md) 的 `store.ts` 创建，输入解析与播放参数在 `playback.ts`，宿主模拟在 `simulator.ts`，三行渲染与播放状态机在 [components.md](components.md) 的 `DebugShell.tsx`。

**读法**：先按「要改什么」定位到下面的功能模块与对应分层文档，只打开那一篇。

## 索引

### 按场景分流

| 要改什么 | 在哪 | 先读哪篇 |
|---|---|---|
| 整页装配、预览数据流 | `web/src/page/debug/index.tsx` | 本页「规则」 |
| 三行布局、播放状态机 | `web/src/page/debug/components/shell/` | [components.md](components.md) |
| 左侧两个输入框的形态与交互 | `web/src/page/debug/components/input/` | [components.md](components.md) |
| 右侧预览区、当前依据提示条 | `web/src/page/debug/components/preview/` | [components.md](components.md) |
| 模拟语义（event → 帧）、逐字播放节奏 | `web/src/page/debug/utils/` | [utils.md](utils.md) |
| 模拟帧与 event 载荷的形状 | `web/src/page/debug/types/` | [types.md](types.md) |
| 实例标识、哨兵、支持的事件表 | `web/src/page/debug/constants/` | [constants.md](constants.md) |
| 调试页皮肤与布局 | `web/src/page/debug/styles/` | [styles.md](styles.md) |

### 分层文档

| 文档 | 含义 | 路径 | 场景 |
|---|---|---|---|
| [components.md](components.md) | 本页可视组件：三行装配、输入区、预览区 | `web/docs/agents/page/debug/components.md` | 改调试页界面或播放状态机 |
| [utils.md](utils.md) | 宿主模拟器、输入解析、调试 store | `web/docs/agents/page/debug/utils.md` | 改模拟语义或播放节奏 |
| [types.md](types.md) | 本页模拟帧与 event 载荷类型 | `web/docs/agents/page/debug/types.md` | 改模拟帧形状 |
| [constants.md](constants.md) | 模拟器常量表 | `web/docs/agents/page/debug/constants.md` | 改实例标识或支持的事件表 |
| [styles.md](styles.md) | 调试页皮肤 | `web/docs/agents/page/debug/styles.md` | 改调试页布局 |

## 规则

### 模块边界

**1. 调试 store 与主 store 完全隔离。**

- **规则**：本页用 [utils.md](utils.md) 的 `store.ts` 自建 store（复用同一份 `rootReducer` 与初始状态），并在预览区外层套 `<Provider store={debugStore}>`；**不给 `web/src/store/index.ts` 加「调试模式」开关**。
- **为什么**：隔离要发生在**实例**层面——调试数据只进这个 store，主 store 一个字节都不动；开关式写法会让两边的状态在同一个对象里纠缠。
- **后果**：一旦共用实例，调一次预览就会污染真实会话的条目与标量，而且因为写入的状态完全合法，不会有任何报错。

### 单一真相源

**2. 预览必须复用真实渲染链路。**

- **规则**：右侧预览直接渲染 `<Stage>`（它连同 `Turn` / `Streaming` / `MessageBlocks` / `Markdown` 都是 props 驱动），本页不新增任何渲染逻辑，也不为预览另写一套简化组件。
- **为什么**：预览的全部价值就是「所见 = 真实会话所见」；另写一套后，它验证的不再是真实链路，调试结论随之失效。
- **后果**：预览正常而真实会话异常（或反之），调试页从排查工具变成误导来源。
