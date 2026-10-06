# 页面层（`web/src/page/`）

## 使用说明

### 这份文档是什么

页面层的规则与索引：这一层负责什么、目录怎么分、有哪些强制约束。

**不覆盖**：具体页面的实现细节（见 [main-page.md](main-page.md)、[debug.md](debug.md)、[library.md](library.md)）、组件与状态层的内容。

上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 决定"某段逻辑该不该放页面层"、新增页面时 |
| [main-page.md](main-page.md) | 改 `main.tsx` 或 `MainPage` / `Shell` 的装配、订阅、props 接线时 |
| [debug.md](debug.md) / [library.md](library.md) | 改调试页或组件库文档页的装配时（两者都复用共享 `AppTopBar`，调试页另复用主界面的外壳类 `.appFrame[data-mode='debug']`，见 §三个入口） |

### 必须遵守的规则

1. **页面不写分支逻辑** —— 违反后果：每加一种形态都要回来改页面。详见 §规则。
2. **每个副作用一个 hook** —— 违反后果：订阅时机错乱、清理遗漏导致重复订阅。详见 §规则。
3. **页面不持有 React 状态** —— 违反后果：状态出现第二个住处，流式帧与界面不同步。详见 §规则。
4. **不改 DOM 骨架** —— `.appFrame` 的两列网格（`grid-template-areas: 'side main'`）与两个槽位（`.appSidebar` / `.appConversation`）、`.appStage*` 内部链、`.appComposerDock` 被样式大量依赖。**主界面外壳的网格里没有 `top` 行**：顶栏已随 C01 删除、功能全在侧栏，`components/common/AppTopBar` 只留给调试页与文档页。违反后果：容器查询、屏外优化、贴底滚动同时失效。详见 §规则与 [../styles/frame.md](../styles/frame.md)。

## 这一层的职责

页面层服务**三个入口**（主界面 `mainPage`、调试页 `debug`、组件库文档页 `library`），只做两件事，**不含业务逻辑**：

1. **装配**：按设计好的 DOM 骨架把组件摆好。主界面是 `.appFrame` 的**两列**网格（`grid-template-areas: 'side main'`）+ 侧栏（唯一外壳：品牌行 / 连接状态点 / 折叠钮 / 开启新对话 / 分组列表 / 用户行）+ `CollapseBubbles`（收起态的两个气泡，绝对定位在 `.appFrame` 上、不参与 grid）+ 对话区 + 浮层，**没有顶栏**；调试页复用同一套 `.appFrame`（`data-mode='debug'`，输入列 400px）并另装配 `common/AppTopBar`；文档页是自绘的三栏骨架，顶栏同样用 `AppTopBar`。
2. **生命周期**：在正确时机建立/清理副作用（事件流订阅、目录同步、窗口尺寸、全局快捷键）。

数据来自 `store`，通过 selector 读出后以 **props** 传给组件；动作通过 `useActions()` 取。页面自己不实现请求、缓存或判定。调试页另建一份**独立 store**（同一份 `rootReducer`），主 store 一个字节都不动。

## 目录

| 路径 | 说明 |
|---|---|
| `web/src/main.tsx` | 主界面与调试页的构建入口：`createRoot` + `StrictMode` + `<Provider store={store}>`，并引入这一侧的全部样式；`Root` 按 URL hash 在 `MainPage` 与 `DebugPage` 之间**互斥挂载**，并把 `data-debug="on|off"` 写在 `<html>` 上（`debug.css` 已不再用它做样式作用域，见 §规则 4） |
| `web/src/page/mainPage/index.tsx` | 主界面薄壳 `MainPage`：四个生命周期订阅 + 装配 `Shell`（**不读业务数据、没有 `useState`**） |
| `web/src/page/mainPage/Shell.tsx` | **唯一**的外壳装配：从 store 取数据 → 按槽位交给组件（`Sidebar` / `CollapseBubbles` / `Stage` / `DialogStage` / `Toast`）；`Hero` 的两个回调在这里注入（示例点击 `onPick`、设置入口 `onOpenSettings`），好让它保持 props 驱动 |
| `web/src/page/debug/index.tsx` | 调试页 `DebugPage`：自建独立 store（与主 store 隔离），装配 `.appFrame[data-mode='debug']` + `AppTopBar` + `DebugInputPanel` + `DebugPreview` |
| `web/src/page/debug/simulator.ts` | event → frame 映射器（宿主 `handleEvent` 的浏览器侧复刻） |
| `web/src/page/debug/DebugInputPanel.tsx` / `DebugPreview.tsx` | 两侧面板，props 驱动；输入区只剩输入，「组件库」链接与「返回主界面」在顶栏动作区 |
| `web/src/library.tsx` | 组件库文档页的构建入口（`library.html` 引用）：挂 `LibraryPage`，样式顺序与 `main.tsx` 相同、末位换成 `library.css` |
| `web/src/page/library/index.tsx` | 只做导出：`export { LibraryPage } from './App'` |
| `web/src/page/library/App.tsx` | 文档页骨架（**自绘**）：顶栏用共享组件 `AppTopBar`（品牌 + 栏目 + 搜索 + 三个入口互链）/ 左导航（行用共享基类 `.appNavRow`）/ 内容区 / 右侧自绘目录；细节见 [library.md](library.md) |
| `web/src/page/library/router.ts` / `search.ts` | 极简 hash 路由（总览页 / `#/components/<kind>`）与顶部搜索的过滤口径 |
| `web/src/page/library/Overview.tsx` / `ComponentPage.tsx` / `items.ts` / `samples.ts` | 总览页 / 详情页 / 载荷→条目与 event、frame 文本 / 两张数据表（`LIBRARY_SECTIONS` / `LIBRARY_GROUPS`） |

`main.tsx` 与 `library.tsx` 在 `src/` 根而不是 `page/` 下：它们是**构建入口**（`web/index.html` 与 `web/library.html` 直接引用），与"页面"这一层是两件事，放在根上更准确地表达这一点。

## 规则

1. **页面不写分支逻辑**：像「输入区此刻放输入卡还是确认卡」这类判定属于组件（见 [../components/main-page.md](../components/main-page.md) 的 `ComposerSeat`）。页面只把组件挂到槽位上。历史上这段判定曾写在页面里，结果是每加一种接管形态都要回来改页面。
2. **每个副作用一个 hook**：订阅类逻辑放在 `store/hooks.ts` 与 `store/stream.ts`，页面只按名调用（`useStreamSubscription()` 等），一行一个，顺序稳定。这些订阅**必须留在 `index.tsx` 这一层**，不能下移进 `Shell.tsx`：它们驱动的是 store 里的共享状态，与外壳内部结构无关；放进外壳，外壳的任何一次重挂载都会重建事件流——那是真的重连宿主，不是一次界面重绘。
3. **页面不持有 React 状态**：`MainPage` 里没有 `useState`。需要跨组件共享的状态一律进 store；组件私有的状态留在该组件内。（调试页的 `useState` 承载的是「输入框文本 / 在途播放」这类纯页面私有状态，不跨组件共享。）
4. **DOM 骨架是契约**：`.appFrame` 的两列网格（`grid-template-areas: 'side main'`）、`.appSidebar` / `.appConversation` 两个槽位的落位、`.appStage*` 内部链与 `.appComposerDock` 都被样式文件大量依赖（容器查询、屏外优化、贴底滚动），改结构前先读 [../styles/frame.md](../styles/frame.md)。主界面外壳**没有 `top` 行**：顶栏已按 C01 删除，`AppTopBar` 只服务调试页与文档页。

## 三个入口（主界面 / 调试页 / 文档页）

组件层只有一批共享表面原语（`components/common/**`），三个入口各自只管装配：

| 入口 | 装配文件 | 说明 |
|---|---|---|
| 主界面（`/`） | `mainPage/index.tsx` + `Shell.tsx` | 四个订阅留在薄壳；`Shell` 是**唯一**的外壳装配。`.appFrame` 是**两列**网格（`'side main'`，**没有顶栏**）：`Sidebar`（唯一外壳：品牌行 + 8px 连接状态点 + 折叠钮 + 「开启新对话」+ 分组列表 + 底部用户行与齿轮设置入口）+ `CollapseBubbles`（收起态气泡）+ `Stage`（props 驱动的会话容器，首屏槽位是 `Hero`）+ `DialogStage` / `Toast` |
| 调试页（`#debug`） | `page/debug/index.tsx` | 复用同一套外壳类：`.appFrame[data-mode='debug']` + `AppTopBar`（品牌 / 栏目「调试页」/ 动作区）+ `aside.appSidebar`（`DebugInputPanel`）+ 预览区 `DebugPreview`（复用 `<Stage>`，落在 `.appConversation`）。输入列宽度走 `.appFrame[data-mode='debug'] { --app-sidebar-width: 400px }`；自带独立 store；「组件库」链接与「返回主界面」按钮在顶栏动作区 |
| 组件库文档页（`library.html`） | `library.tsx` + `page/library/App.tsx` | 自绘三栏骨架，顶栏同样是 `common/AppTopBar`；不连宿主，只渲染静态示例 |

三条现状（重构后**不再有**第二套外壳）：

1. `ShellV1.tsx` / `ShellV2.tsx` / `components/v2/**` / `styles/v2/**` / `[data-ui]` 作用域 / `ui.variant` 与外观切换控件**已全部删除**——看到相关描述一律以源码为准。品牌落点也随 C01 变了位置：**主界面在侧栏顶部的品牌行**（`Sidebar.tsx` 的 `.appBrandAction.appSidebarBrand`，双击进调试页）、调试页在 `page/debug/index.tsx` 的 `AppTopBar` 品牌槽里；`components/mainPage/shell/SidebarBrand.tsx` 与主界面顶栏 `components/mainPage/shell/Header.tsx` 都已删除。
2. `html[data-debug]` 属性仍由 `main.tsx` 的 `Root` 维护，但 `debug.css` 已不再用它做样式作用域（改用 `.appFrame[data-mode='debug']`）。
3. 顶栏只有 `components/common/AppTopBar` 一份定义，**需要顶栏的入口**（调试页 / 文档页）都从它出发；不为某一个入口另写一份，也不给主界面加回顶栏。

**外壳重挂载不重建订阅**：这是把订阅留在薄壳的唯一理由，回归时要按这条验（现在只剩「不能下移进 `Shell.tsx`」这一条）。

## 新增一个页面时

当前有三个入口（`mainPage` 主界面 / `debug` 调试页 / `library` 组件库文档页），其中两个走 `main.tsx`、一个走独立的 `library.tsx`。若要新增：

1. 建 `web/src/page/<name>/index.tsx`，导出该页面组件；
2. 数据从 `store` 取，副作用用 `store/hooks.ts` 里已有的 hook，缺少时先在那里加；
3. 在 `main.tsx` 的 `Root` 里挂载（无路由库，按 hash 或条件渲染互斥挂载）；需要独立 HTML 入口时仿 `library.tsx` + `library.html`，并把样式文件加进对应的引入链（顺序见 [../styles/readme.md](../styles/readme.md)）；
4. 需要顶栏的入口一律复用 `components/common/AppTopBar`，不另写一份；**主界面没有顶栏**（C01），不要给它加回来；
5. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。
