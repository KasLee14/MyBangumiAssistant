# mainPage：主界面

> 覆盖 `web/src/page/mainPage/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/` 是**主界面**：侧栏 + 对话区两列（C01 删掉顶栏之后的形态），承载会话流、输入区、设置与登录弹窗，以及空会话的首屏引导。

它是唯一的**全局状态消费入口**：五个生命周期订阅与全部 store 读取都发生在本页；`web/src/components/` 下的共享组件反过来一律 props 驱动（见 [../../components.md](../../components.md) 规则 1）。

本页分四块：`components/`（21 个可视组件，五个功能模块，见 [components.md](components.md)）、`styles/`（四件皮肤，见 [styles.md](styles.md)）、`utils/`（见 [utils.md](utils.md)）、`constants/`（见 [constants.md](constants.md)），加上页面入口。

## 索引

### 页面入口

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 薄壳：五个生命周期订阅（事件流、逐字摊平、目录同步、侧栏响应式、Esc）+ 外壳装配 | `web/src/page/mainPage/index.tsx` | 改订阅挂载点或整页装配 |

五个订阅**必须留在这一层**：它们驱动的是 store 里的共享状态，与外壳内部结构无关；放进外壳会让外壳的任何一次重挂载都重建事件流（见 [../../store.md](../../store.md) 规则 3）。

### 功能模块

| 模块 | 含义 | 路径 | 场景 |
|---|---|---|---|
| 外壳 | 侧栏、外壳装配、收起态入口、图标、错峰入场 | `web/src/page/mainPage/components/shell/` | 改侧栏、两列骨架或收起态 |
| 输入区 | 输入卡、命令候选、思考强度、token 与上下文读数 | `web/src/page/mainPage/components/composer/` | 改输入、发送、命令补全或读数 |
| 弹窗 | 设置、模型配置与选择、网络线路、登录、历史会话 | `web/src/page/mainPage/components/dialog/` | 改任一弹窗 |
| 浮层挂载 | 三个弹窗的挂载与留场、一次性提示 | `web/src/page/mainPage/components/overlays/` | 加弹窗或改提示 |
| 首屏 | 空会话引导：标题、能力说明、示例、设置入口 | `web/src/page/mainPage/components/hero/` | 改首屏引导 |

### 分层文档

| 文档 | 含义 | 路径 | 场景 |
|---|---|---|---|
| [components.md](components.md) | 本页 21 个可视组件 | `web/docs/agents/page/mainPage/components.md` | 改界面：外壳、输入区、弹窗、首屏 |
| [utils.md](utils.md) | 本页逻辑（相对时间、凭据措辞） | `web/docs/agents/page/mainPage/utils.md` | 改时间文案或凭据来源说法 |
| [styles.md](styles.md) | 本页四件皮肤 | `web/docs/agents/page/mainPage/styles.md` | 改本页样式 |
| [constants.md](constants.md) | 本页常量（会话分组顺序） | `web/docs/agents/page/mainPage/constants.md` | 改会话分组顺序 |

## 规则

### 模块边界

**1. 容器组件读 store，展示组件 props 驱动。**

- **规则**：`Shell` / `Sidebar` / `Composer` / `DialogStage` 这些容器从 store 取数，按槽位把数据与回调交给子组件；`Hero` 与会话流、过程区组件一律 props 驱动，需要写全局状态时由容器注入回调（如 `Hero` 的 `onPick` / `onOpenSettings`）。
- **为什么**：本页是 store 的唯一消费入口，而 `web/src/components/` 的共享组件不读 store（见 [../../components.md](../../components.md) 规则 1）——两层分工后，共享组件才能在调试页与流式区复用，流式期的重渲染范围也才收得住。
- **后果**：展示组件一旦自己读 store，它就回不到「同一批组件渲染模拟数据」的状态，调试页与首屏引导都要另写一套，流式期还会出现整树重渲染。

### 单一真相源

**2. 同一件事的多个入口共用一份判定与措辞。**

- **规则**：会话列表（侧栏常驻 ↔ `/sessions` 弹窗）、Bangumi 登录（`/bangumi-login` 命令 ↔ 设置里的登录）、凭据来源措辞（模型弹窗 ↔ 设置弹窗）都是同一件事的两个入口；判定与文案只写在一处（[utils.md](utils.md) 的 `relativeTimeLabel` / `AUTH_LABEL`），两个入口只是不同的壳。
- **为什么**：两个入口显示的是同一句话、同一份状态；抄成两份后，任何一次措辞调整或分档边界调整都会只落在其中一处。
- **后果**：用户会在两个入口看到不同说法，据此以为状态不同，或以为其中一个入口已经过时。
