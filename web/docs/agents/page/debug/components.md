# components：调试页可视组件

> 覆盖 `web/src/page/debug/components/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/components/` 是调试页**页面专有**的可视组件，按位置分三个子目录：`shell/`（三行装配与播放状态）、`input/`（左侧输入）、`preview/`（右侧预览）。

三个组件都是纯 props 驱动：状态由 [index.md](index.md) 的装配层与壳组件持有，往下只传值与本层回调。

## 索引

按场景找：三行布局与播放状态看 `shell/`，左侧输入看 `input/`，右侧预览看 `preview/`（见 [index.md](index.md) 的「按场景分流」）。

### shell/ —— 三行装配与播放状态

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `DebugShell.tsx` | 调试页的壳：顶栏 / 输入列 / 预览区三行装配，以及全部播放状态（`eventText` / `frameText` / `displayBlocks` / `playing`）；播放动作（定时器、在途令牌、`setState`）也留在这里 | `web/src/page/debug/components/shell/DebugShell.tsx` | 改三行布局或播放状态机 |

### input/ —— 左侧输入

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `DebugInputPanel.tsx` | 左侧输入区：两个输入框与状态都由装配层持有，这里只负责「填什么、点了什么」，映射与播放不在这里 | `web/src/page/debug/components/input/DebugInputPanel.tsx` | 改输入区形态或两个输入框的交互 |

### preview/ —— 右侧预览

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `DebugPreview.tsx` | 右侧预览区：给 `<Stage>` 提供受控的流式文本与标量，外加一条「当前依据」提示条；标量从调试专用 store 读（外层已套 `<Provider store={debugStore}>`） | `web/src/page/debug/components/preview/DebugPreview.tsx` | 改预览区的数据来源或提示条 |

## 规则

### 状态归属

**1. 播放中的块不进 store。**

- **规则**：`displayBlocks` 是**受控**的流式块数组，由壳组件持有并直接交给 `Stage`，逐字播放发生在 reducer 之外；store 里只保留「已提交帧」的状态。
- **为什么**：播放是**界面节奏**，不是会话状态。每演一个字就派发一次 action，会把 reducer 变成高频写入点，也让「哪一帧是权威」无从判断（帧语义只在 `web/src/store/reducers/stream.ts`，见 [../../store.md](../../store.md) 规则 2）。
- **后果**：逐字播放写进 store 后，真实增量帧与调试播放共用同一条通路，调试页再也做不到「演一遍而不留痕」。
