# 页面层（`web/src/page/`）

## 简介

页面层的规则与索引：这一层负责什么、目录怎么分、有哪些强制约束。

**不覆盖**：具体页面的实现细节（见 [main-page.md](main-page.md)、[debug.md](debug.md) 与 [library.md](library.md)）、组件与状态层的内容。

上层入口：[AGENTS.md](../../../AGENTS.md)。

### 这一层的职责

页面层只做两件事，**不含业务逻辑**：

1. **装配**：按设计好的 DOM 骨架把组件摆好（`.appFrame` → 侧栏 + `.appConversation` → 顶栏 + 会话容器 + 浮层）。
2. **生命周期**：在正确时机建立/清理副作用（事件流订阅、目录同步、窗口尺寸、全局快捷键）。

数据来自 `store`，通过 selector 读出后以 **props** 传给组件；动作通过 `useActions()` 取。页面自己不实现请求、缓存或判定。

### 外壳（`Shell.tsx`）

外壳只有一个装配点：`Shell` 从 store 读出会话流与布局字段，按槽位交给组件（`Sidebar`、`Header`、`Stage`、`ComposerSeat`、`DialogStage`、`Toast`），并用 `MotionConfig reducedMotion="user"` 把系统的「减少动态效果」偏好传给 motion。

- 组件全部来自 `components/mainPage/**`，样式类名统一用 `app*` 前缀（`.appFrame`、`.appStage`、`.appComposerCard`…）；会话流里的原子行与卡片沿用**共享渲染器**的类名（`.userRow`、`.processTitle`、`.planCard`…），组件与样式两边各自只有一处定义。
- 外壳重挂载**不重建任何订阅、不重取会话**：订阅留在 `index.tsx` 的薄壳里，这是它们不下移进外壳的唯一理由，回归时要按这条验。
- 外壳的分层与硬约定见 [AGENTS.md](../../../AGENTS.md) §规则 的「外观层硬约定」。

## 使用说明

- **改这一层之前先读完 §规则**：页面不写分支逻辑、每个副作用一个 hook、页面不持有 React 状态、DOM 骨架是契约都在那里；违反会直接表现为订阅时机错乱、状态出现第二个住处，或容器查询与屏外优化同时失效。
- **只想查「某个文件什么时候读」「某个类名由谁给出」**：直接查 §索引 的三张表（文件 → 场景、目录、章节 → 场景），不必通读 §规则。
- **新增页面**：先读 §规则 末条「新增一个页面时」的四步，再照 [main-page.md](main-page.md) 的装配细节接线。
- 本层的装配细节（`main.tsx`、四个订阅、`Shell` 的 props 接线）见 [main-page.md](main-page.md)。

## 规则

### 页面不写分支逻辑

像「输入区此刻放输入卡还是确认卡」这类判定属于组件（见 [../components/main-page.md](../components/main-page.md) 的 `ComposerSeat`）。页面只把组件挂到槽位上。历史上这段判定曾写在页面里，结果是每加一种接管形态都要回来改页面。

**违反后果**：每加一种形态都要回来改页面。

### 每个副作用一个 hook

订阅类逻辑放在 `store/hooks.ts` 与 `store/stream.ts`，页面只按名调用（`useStreamSubscription()` 等），一行一个，顺序稳定。这些订阅**必须留在 `index.tsx` 这一层**，不能下移进外壳：它们驱动的是 store 里的共享状态，放进外壳会让外壳的任何一次重挂载都重建事件流——那是真的重连宿主。

**违反后果**：订阅时机错乱、清理遗漏导致重复订阅。

### 页面不持有 React 状态

`MainPage` 里没有 `useState`。需要跨组件共享的状态一律进 store；组件私有的状态留在该组件内。

**例外只有一处**：`main.tsx` 的 `Root` 持有 `useState`（调试分流标志，初值来自 `isDebugHash()`，由 `hashchange` 同步）。它是**构建入口的分流器**，不在 `page/` 下，也不属于任何页面——两个页面互斥挂载这件事本身就是它的职责，没有第二个住处可言。

**违反后果**：状态出现第二个住处，流式帧与界面不同步。

### DOM 骨架是契约

`.appFrame` / `.appConversation` 由本层给出，`.appStage` / `.appStageBody` / `.appStageScroll` / `.appStageFlow` / `.appStageColumn` 由会话容器给出；这些类名与层级被样式文件大量依赖（容器查询、屏外优化、贴底滚动），改结构前先读 [../styles/frame.md](../styles/frame.md)。

**违反后果**：容器查询、屏外优化、贴底滚动同时失效。

### 新增一个页面时

当前有**两个页面**：`mainPage`（会话界面，见 [main-page.md](main-page.md)）与 `debug`（调试页，见 [debug.md](debug.md)）。两者由 `main.tsx` 的 `Root` **按 hash 互斥挂载**，同一个时刻只有一个在页面上：

```tsx
return debug ? <DebugPage /> : <MainPage />;
```

互斥的原因不只是"显示哪一屏"：主界面挂载时会建立 SSE 连接、拉取目录，而调试页全程不需要宿主。分开挂载后，调试期间不会有任何到宿主的请求；主 store 不受影响——切回主界面时重新建连，首帧本来就是全量快照（这一性质见 [../store/hooks-and-stream.md](../store/hooks-and-stream.md)）。分流标志来自 hash 开关 `utils/debugMode.ts`，`Root` 监听 `hashchange` 同步它。

若要新增第三个页面（例如一个不含会话流的设置页）：

1. 建 `web/src/page/<name>/index.tsx`，导出该页面组件；
2. 数据从 `store` 取，副作用用 `store/hooks.ts` 里已有的 hook，缺少时先在那里加；
3. 在 `main.tsx` 的 `Root` 里挂载（无路由库：替换、按条件渲染，或照调试页那样加一个 hash 开关）；
4. 在本文件与 [AGENTS.md](../../../AGENTS.md) 的索引里登记。

**另一条路：独立 HTML 入口**。不参与 `Root` 的 hash 分流、且不需要宿主与 store 的页面，可以照组件库文档页那样做——一个 `web/<name>.html` + 一个 `web/src/<name>.tsx`（见 [library.md](library.md)），并把它登记进 `bangumi/vite.config.ts` 的 `build.rollupOptions.input`。这条路的代价是多一个构建入口，收益是主界面完全不感知它。

## 索引

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 决定"某段逻辑该不该放页面层"、新增页面时 |
| [main-page.md](main-page.md) | 改 `main.tsx`、`MainPage` 或 `Shell` 的装配、订阅、props 接线时 |
| [debug.md](debug.md) | 改调试页（`page/debug/**`）、核对 event → frame 映射时 |
| [library.md](library.md) | 改组件库文档页（`page/library/**`、`library.html`、`src/library.tsx`）、核对内容条目的参数表与调试页示例时 |
| `Shell.tsx` | 改外壳装配（见 §简介「外壳（`Shell.tsx`）」） |

### 目录

| 路径 | 说明 |
|---|---|
| `web/src/main.tsx` | 应用入口：`createRoot` + `StrictMode` + `<Provider store={store}>`，`Root` 按 hash 在 `MainPage` 与 `DebugPage` 之间互斥挂载，并引入全部样式（顺序是契约，见 [main-page.md](main-page.md)） |
| `web/src/page/mainPage/index.tsx` | 主界面 `MainPage`：四个生命周期订阅，然后直接渲染 `<Shell />`（**薄壳**，不读业务数据） |
| `web/src/page/mainPage/Shell.tsx` | 外壳装配：从 store 取出的数据按槽位交给组件（业务逻辑一律不在这里） |
| `web/src/page/debug/index.tsx` | 调试页 `DebugPage`：自建调试专用 store，解析输入并逐字播放，预览复用 `<Stage>`（见 [debug.md](debug.md)） |
| `web/src/page/debug/simulator.ts` | event → frame 映射器：宿主 `handleEvent` 的复刻，纯函数无状态 |
| `web/src/page/debug/DebugInputPanel.tsx` | 调试页左侧输入区：两个 textarea、6 个 mock 用例、预览 / 清空并重置、状态栏（纯 props 驱动） |
| `web/library.html` | 组件库文档页的 HTML 入口（脚本指向 `/src/library.tsx`），与 `index.html` 一起作为 Vite 的第二个构建入口（见 [library.md](library.md)） |
| `web/src/library.tsx` | 组件库文档页的入口：先引 `antd/dist/reset.css`，再按与 `main.tsx` 相同的样式顺序 + `styles/library.css`，只渲染 `LibraryPage`，**不连宿主、不发请求**（antd 只服务这一个入口） |
| `web/src/page/library/index.tsx` | 文档页的导出面：`export { LibraryPage } from './App'` |
| `web/src/page/library/App.tsx` | 文档页骨架：antd `Layout` / `Menu` / `Input.Search` + 左侧两层分组导航 + 右侧自绘目录（`PageToc`）；按 hash 路由渲染总览页 / 详情页 / 「没有这个组件」 |
| `web/src/page/library/router.ts` | 文档页的极简 hash 路由：`parseRoute` / `useRoute` / `navigate` 与 `OVERVIEW_HREF` / `componentHref` |
| `web/src/page/library/search.ts` | 顶部搜索的过滤口径 `filterSections`（kind 名 / 标题 / summary / 载荷 JSON / 参数表） |
| `web/src/page/library/Overview.tsx` | 总览页：12 张卡（真实 `ContentBlock` 小预览），点卡进详情页 |
| `web/src/page/library/ComponentPage.tsx` | 详情页：严格四块（UI 预览 / 参数 / event / frame）+ 参数表五列 + 一行参考附注；`PAGE_ANCHORS` 是这四块的 id 契约（`ui-preview` / `params` / `event` / `frame`） |
| `web/src/page/library/items.ts` | 载荷 → 块 / event / frame 文本（`blockOf` / `eventText` / `frameText` / `FRAME_STATE`） |
| `web/src/page/library/samples.ts` | 文档页的示例数据与参数表（`LIBRARY_SECTIONS`）：12 个 `kind` 的主载荷、空载荷、参数与参考 |
| `web/src/page/library/theme.ts` | antd 主题（`LIBRARY_THEME`）：token 色值抄自 `bgm.css` 的 `--bgm-*`，**改令牌要同步改它** |

`main.tsx` 在 `src/` 根而不是 `page/` 下：它是**构建入口**（`web/index.html` 直接引用 `/src/main.tsx`），与"页面"这一层是两件事，放在根上更准确地表达这一点。`library.tsx` 同理——它由 `web/library.html` 直接引用，是独立于 `Root` 的第二个入口（**不参与 `Root` 的 hash 分流**，它有自己的总览 / 详情页 hash 路由，见 [library.md](library.md) §简介「路由与搜索」）。

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「这一层的职责」 | 判断"某段逻辑该不该放页面层"时 |
| §简介「外壳（`Shell.tsx`）」 | 改外壳装配（外壳重挂载不重建订阅这条在这里）时 |
| §规则「页面不写分支逻辑」 | 纠结某段判定该放页面还是组件时 |
| §规则「每个副作用一个 hook」 | 加或改订阅、快捷键、resize 时 |
| §规则「页面不持有 React 状态」 | 纠结某个状态放 store 还是组件时 |
| §规则「DOM 骨架是契约」 | 改外壳或会话容器的结构、类名前 |
| §规则「新增一个页面时」 | 新增页面时逐步照做 |
