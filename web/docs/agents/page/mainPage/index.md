# mainPage：主界面

> 覆盖 `web/src/page/mainPage/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/` 是**主界面**：侧栏 + 对话区两列（C01 删掉顶栏之后的形态），承载会话流、输入区、设置与登录弹窗，以及空会话的首屏引导。

它是唯一的**全局状态消费入口**：五个生命周期订阅与全部 store 读取都发生在本页；`web/src/components/` 下的共享组件反过来一律 props 驱动（见 [../../components.md](../../components.md) 规则 1）。

**读法**：先按「要改什么」定位到下面的功能模块与对应分层文档，只打开那一篇；页面入口 `index.tsx` 只在改订阅挂载点或整页装配时才需要读。

## 索引

### 按场景分流

| 要改什么 | 在哪 | 先读哪篇 |
|---|---|---|
| 整页装配、五个生命周期订阅 | `web/src/page/mainPage/index.tsx` | 本页「规则」第 1 条 |
| 侧栏（品牌 / 连接状态 / 会话列表 / 用户行）、两列骨架、收起态气泡、外壳图标 | `web/src/page/mainPage/components/shell/` | [components.md](components.md) |
| 输入卡、命令候选、发送与停止、思考强度 | `web/src/page/mainPage/components/composer/` | [components.md](components.md) |
| 设置 / 模型 / 模型选择 / 代理 / 登录 / 历史会话弹窗 | `web/src/page/mainPage/components/dialog/` | [components.md](components.md) |
| 弹窗挂载与退场、一次性提示 | `web/src/page/mainPage/components/overlays/` | [components.md](components.md) |
| 空会话首屏引导 | `web/src/page/mainPage/components/hero/` | [components.md](components.md) |
| 会话相对时间文案、凭据来源措辞 | `web/src/page/mainPage/utils/` | [utils.md](utils.md) |
| 页面皮肤（框架 / 输入区 / 确认卡 / 弹窗四件） | `web/src/page/mainPage/styles/` | [styles.md](styles.md) |
| 会话分组顺序 | `web/src/page/mainPage/constants/` | [constants.md](constants.md) |

### 分层文档

| 文档 | 含义 | 路径 | 场景 |
|---|---|---|---|
| [components.md](components.md) | 本页可视组件：外壳、输入区、弹窗、浮层挂载、首屏 | `web/docs/agents/page/mainPage/components.md` | 改界面（含组件目录下的规则） |
| [utils.md](utils.md) | 本页逻辑（相对时间、凭据措辞） | `web/docs/agents/page/mainPage/utils.md` | 改时间文案或凭据来源说法 |
| [styles.md](styles.md) | 本页四件皮肤 | `web/docs/agents/page/mainPage/styles.md` | 改本页样式 |
| [constants.md](constants.md) | 本页常量（会话分组顺序） | `web/docs/agents/page/mainPage/constants.md` | 改会话分组顺序 |

## 规则

### 模块边界

**1. 容器组件读 store，展示组件 props 驱动；五个订阅只挂在本页入口。**

- **规则**：`Shell` / `Sidebar` / `Composer` / `DialogStage` 这些容器从 store 取数，按槽位把数据与回调交给子组件；`Hero` 与会话流、过程区组件一律 props 驱动，需要写全局状态时由容器注入回调（如 `Hero` 的 `onPick` / `onOpenSettings`）。五个生命周期订阅（事件流、逐字摊平、目录同步、侧栏响应式、Esc）都调用在 `web/src/page/mainPage/index.tsx`，不下沉进外壳。
- **为什么**：本页是 store 的唯一消费入口，而 `web/src/components/` 的共享组件不读 store（见 [../../components.md](../../components.md) 规则 1）——两层分工后，共享组件才能在调试页与流式区复用，流式期的重渲染范围也才收得住；订阅驱动的是 store 里的共享状态，与外壳内部结构无关，放进外壳会让外壳的任何一次重挂载都重建事件流（见 [../../store.md](../../store.md) 规则 3）。
- **后果**：展示组件一旦自己读 store，它就回不到「同一批组件渲染模拟数据」的状态，调试页与首屏引导都要另写一套，流式期还会出现整树重渲染；订阅下沉则表现为事件流反复重连、流式一半停住。

### 单一真相源

**2. 同一件事的多个入口共用一份判定与措辞。**

- **规则**：会话列表（侧栏常驻 ↔ `/sessions` 弹窗）、Bangumi 登录（`/bangumi-login` 命令 ↔ 设置里的登录）、凭据来源措辞（模型弹窗 ↔ 设置弹窗）都是同一件事的两个入口；判定与文案只写在一处（[utils.md](utils.md) 的 `relativeTimeLabel` / `AUTH_LABEL`），两个入口只是不同的壳。
- **为什么**：两个入口显示的是同一句话、同一份状态；抄成两份后，任何一次措辞调整或分档边界调整都会只落在其中一处。
- **后果**：用户会在两个入口看到不同说法，据此以为状态不同，或以为其中一个入口已经过时。
