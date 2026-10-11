# library：文档页

> 覆盖 `web/src/page/library/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/` 是**内容组件库文档页**（`/library`）：顶栏横跨全宽（复用共享组件 `AppTopBar`），下面是「左导航 | 内容 | 页内目录」。它展示 12 种内容块的真实渲染、参数契约，以及可直接粘进调试页的 event / frame JSON。

内容区是 `<Outlet />`：「总览」与「某个 kind 的详情」是两条子路由（见 [../../router.md](../../router.md)），骨架只负责搜索过滤、左导航与页内目录；过滤结果 `sections` 经 `<Outlet context>` 下发，两个子页面自己仍是 props 驱动。

三处刻意的形态决定：页内目录自绘（见规则 1）、左导航从数据表派生（见规则 2）、搜索框放在顶栏**动作区**而不是居中（不为让它居中而给本页开一个顶栏特例，顶栏形态由 `AppTopBar` 一处定义）。

## 索引

### 页面入口

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 骨架装配：顶栏 + 左导航 + 内容出口 + 页内目录；过滤与派生（`sections` / `groups` / `selectedKey` / `outletContext`）都在这里 | `web/src/page/library/index.tsx` | 改文档页骨架或过滤下发 |

### 功能模块

| 模块 | 含义 | 路径 | 场景 |
|---|---|---|---|
| 详情与总览 | 单个 kind 的四块详情、总览卡片网格、胶囊 | `web/src/page/library/components/` | 见 [components.md](components.md) |
| 左导航 | 总览入口 + 分组列表 | `web/src/page/library/components/nav/` | 见 [components.md](components.md) |
| 页内目录 | 右侧自绘目录，滚动同步高亮 | `web/src/page/library/components/toc/` | 见 [components.md](components.md) |
| 顶栏 | 品牌 + 栏目 + 动作区（搜索框、入口链接、版本胶囊） | `web/src/page/library/components/topbar/` | 见 [components.md](components.md) |

### 分层文档

| 文档 | 含义 | 路径 | 场景 |
|---|---|---|---|
| [components.md](components.md) | 本页 6 个可视组件 | `web/docs/agents/page/library/components.md` | 改文档页界面 |
| [utils.md](utils.md) | 示例数据转换、搜索过滤、入场观察、显示名 | `web/docs/agents/page/library/utils.md` | 改搜索口径或示例生成 |
| [types.md](types.md) | 本页形状类型（页面模块的公开契约） | `web/docs/agents/page/library/types.md` | 改 section 或 variant 形状 |
| [constants.md](constants.md) | 12 种 kind 的示例数据 | `web/docs/agents/page/library/constants.md` | 加 / 改示例数据或参数表 |
| [styles.md](styles.md) | 文档页皮肤 | `web/docs/agents/page/library/styles.md` | 改文档页样式 |

## 规则

### 技术边界

**1. 页内目录不走 `location.hash`。**

- **规则**：右侧目录由 [components.md](components.md) 的 `PageToc` 自己滚动（`scrollIntoView` + `data-active`），锚点**不写进** `location.hash`——详情页的地址本身就是路径（`/library/components/<kind>`）。
- **为什么**：哈希会与路由地址互相覆盖：写锚点等于改地址，路由一跳转又把锚点清掉，两边都留不住。
- **后果**：点目录后地址被改写、前进后退行为错乱；或路由跳转把滚动位置重置，目录高亮与实际位置脱节。

### 单一真相源

**2. 左导航从数据表派生，不硬编码 kind。**

- **规则**：`groups` 由装配层从 `LIBRARY_GROUPS` 与 `LIBRARY_SECTIONS`（[constants.md](constants.md)）派生，分组内没有命中的 kind 时该分组整体消失也在那边做完；`LibraryNav` 与骨架里都不出现具体 kind 名。
- **为什么**：新增一种内容条目只改数据。界面里散落 kind 名后，每次加 kind 都要在导航、骨架、样式里各改一处。
- **后果**：新增 kind 后导航缺项或留下空分组，而详情页本身正常，问题表现为「少了一个入口」，最难归因。
