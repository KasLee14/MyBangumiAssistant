# components：文档页可视组件

> 覆盖 `web/src/page/library/components/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/components/` 是文档页**页面专有**的可视组件：详情与总览三个顶层组件，加 `nav/`（左导航）、`toc/`（页内目录）、`topbar/`（顶栏）三个模块。

骨架是**自绘**的：文档页与主界面、调试页共用同一套表面语言（同一个 `AppTopBar`、同一套 `--app-*` 令牌、同一个导航行基类 `.appNavRow`），「工具页另有一套外观」这个例外已取消。组件一律 props 驱动，派生在 [index.md](index.md) 与 [utils.md](utils.md) 里。

## 索引

按场景找：详情与总览看顶层三个组件，左导航看 `nav/`，页内目录看 `toc/`，顶栏看 `topbar/`（见 [index.md](index.md) 的「按场景分流」）。

### 顶层

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `ComponentPage.tsx` | 单个 kind 的详情页：严格四块——UI 预览（含形态变体与空数据变体）、参数表、调试页 event JSON、调试页 frame JSON；块 id 由 `PAGE_ANCHORS` 定义 | `web/src/page/library/components/ComponentPage.tsx` | 改详情页的某一块或它的顺序 |
| `Overview.tsx` | 总览页：每种内容条目一张卡（中文名 + kind + 一句话 + 一张真实 `ContentBlock` 小预览），整张卡可点 | `web/src/page/library/components/Overview.tsx` | 改总览卡片或网格 |
| `Pill.tsx` | 胶囊：标签、chip、读数共用的一种形态（`MicroLabel` 是文字样式，它是带底与描边的容器） | `web/src/page/library/components/Pill.tsx` | 改胶囊形态 |

### nav/ —— 左导航

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `LibraryNav.tsx` | 左导航：总览入口 + 分组列表；`groups` 由装配层派生，这里不硬编码任何 kind；导航行用 `<button>` + `navigate()` 而不是 `<Link>` | `web/src/page/library/components/nav/LibraryNav.tsx` | 改左导航行或分组渲染 |

### toc/ —— 页内目录

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `PageToc.tsx` | 右侧页内目录：自绘，滚动时同步高亮；锚点清单从 `ComponentPage` 的 `PAGE_ANCHORS` 取，不抄第二份 | `web/src/page/library/components/toc/PageToc.tsx` | 改目录形态或高亮规则 |

### topbar/ —— 顶栏

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `LibraryTopBar.tsx` | 顶栏：品牌 + 栏目 + 动作区（搜索框、两个入口链接、版本胶囊）；回车跳「第一条命中」而不是留在原地过滤 | `web/src/page/library/components/topbar/LibraryTopBar.tsx` | 改顶栏栏目、搜索框位置或入口链接 |

## 规则

### 顺序契约

**1. 详情页严格四块，块 id 是契约。**

- **规则**：详情页只有 UI 预览 / 参数 / event 输入 / frame 输入四块，**不加第五块**；形态变体属于第 1 块内部（`LibraryVariant` 只让那一块多出几张同构预览卡）；`PAGE_ANCHORS` 定义的 id 是页内目录的契约，改 id 必须同时改目录指向。
- **为什么**：页内目录、搜索、调试页 JSON 都按这四块组织；多一块或少一块会让目录指向空位，而这类失配在界面上只表现为「点了没反应」。
- **后果**：块 id 与目录不一致时，点击静默无效；加第五块会让四块契约与 `PAGE_ANCHORS` 同时失真。

### 单一真相源

**2. 参数表复用内容条目的表格皮肤。**

- **规则**：参数表直接用内容条目的 `.contentTable`（`web/src/styles/content.css`），文档页只补「表头没有排序按钮」这一处差异，不另写一套表格样式。
- **为什么**：同一张表的形态在一处定义，改表格皮肤时文档页与真实内容块一起变。
- **后果**：另写一套后，文档页的参数表与它展示的组件本身长得不一样，改一处漏一处。
