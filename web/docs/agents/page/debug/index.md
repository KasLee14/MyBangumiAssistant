# debug：调试页

> 覆盖 `web/src/page/debug/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/` 是**调试页**（`/debug`）：左侧输入一条 event 或一帧，右侧用**真实渲染链路**预览结果。侧栏品牌双击也进这一页。

三条设计约束决定了这一页的全部结构：

1. **与真实会话完全隔离**：本页自建一个 redux store（复用同一份 `rootReducer`），调试数据只进这个 store，主 store 一个字节都不动；
2. **预览就是真实渲染**：直接复用 `<Stage>`，不新增任何渲染逻辑，所以「预览所见 = 真实会话所见」；
3. **流式由播放驱动**：模拟器给出目标帧与目标块数组，页面把最后一个文本块按字符演一遍再提交，对应宿主每 40ms 一帧的下发节奏。

本页只做装配：store 在 [utils.md](utils.md) 的 `store.ts` 创建，输入解析与播放参数在 `playback.ts`，宿主模拟在 `simulator.ts`，三行渲染与播放状态机在 [components.md](components.md) 的 `DebugShell.tsx`。

## 索引

### 页面入口

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 装配层：把输入、播放与预览接起来；三条设计约束的落点 | `web/src/page/debug/index.tsx` | 改整页装配或预览数据流 |

### 功能模块

| 模块 | 含义 | 路径 | 场景 |
|---|---|---|---|
| 外壳 | 顶栏 / 输入列 / 预览区三行装配 + 全部播放状态 | `web/src/page/debug/components/shell/` | 见 [components.md](components.md) |
| 输入区 | 左侧 event 与 frame 两个输入框 | `web/src/page/debug/components/input/` | 见 [components.md](components.md) |
| 预览区 | 右侧：复用 `<Stage>` 的受控预览 | `web/src/page/debug/components/preview/` | 见 [components.md](components.md) |

### 分层文档

| 文档 | 含义 | 路径 | 场景 |
|---|---|---|---|
| [components.md](components.md) | 本页 3 个可视组件 | `web/docs/agents/page/debug/components.md` | 改调试页界面或播放状态机 |
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
