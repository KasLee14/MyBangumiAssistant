# 页面层（`web/src/page/`）

## 使用说明

### 这份文档是什么

页面层的规则与索引：这一层负责什么、目录怎么分、有哪些强制约束。

**不覆盖**：具体页面的实现细节（见 [main-page.md](main-page.md)）、组件与状态层的内容。

上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 决定"某段逻辑该不该放页面层"、新增页面时 |
| [main-page.md](main-page.md) | 改 `main.tsx` 或 `MainPage` 的装配、订阅、props 接线时 |
| `ShellV1.tsx` / `ShellV2.tsx` | 改两版外壳各自的装配（见 §两版外壳） |

### 必须遵守的规则

1. **页面不写分支逻辑** —— 违反后果：每加一种形态都要回来改页面。详见 §规则。
2. **每个副作用一个 hook** —— 违反后果：订阅时机错乱、清理遗漏导致重复订阅。详见 §规则。
3. **页面不持有 React 状态** —— 违反后果：状态出现第二个住处，流式帧与界面不同步。详见 §规则。
4. **不改 DOM 骨架** —— `frame` / `conversation` / `body` / `scrollBody` / `column` 被样式大量依赖。违反后果：容器查询、屏外优化、贴底滚动同时失效。详见 §规则与 [../styles/frame.md](../styles/frame.md)。

## 这一层的职责

页面层只做两件事，**不含业务逻辑**：

1. **装配**：按设计好的 DOM 骨架把组件摆好（`frame` → 侧栏 + 会话区 → 头部 + 会话视图 + 浮层）。
2. **生命周期**：在正确时机建立/清理副作用（事件流订阅、目录同步、窗口尺寸、全局快捷键）。

数据来自 `store`，通过 selector 读出后以 **props** 传给组件；动作通过 `useActions()` 取。页面自己不实现请求、缓存或判定。

## 目录

| 路径 | 说明 |
|---|---|
| `web/src/main.tsx` | 应用入口：`createRoot` + `StrictMode` + `<Provider store={store}>`，并引入全部样式；首帧前按 store 里的初始外观版本预置 `document.documentElement.dataset.ui`（晚一帧会让 v2 闪一次无样式骨架） |
| `web/src/page/mainPage/index.tsx` | 唯一页面 `MainPage`：四个生命周期订阅 + 按 `ui.variant` 选树（**薄壳**，不读业务数据） |
| `web/src/page/mainPage/ShellV1.tsx` | v1 外壳装配（既有外观；JSX 与数据读取保持原样） |
| `web/src/page/mainPage/ShellV2.tsx` | v2 外壳装配（新版；挂载时维护 `<html>` 上的 `data-ui` 作用域属性） |

`main.tsx` 在 `src/` 根而不是 `page/` 下：它是**构建入口**（`web/index.html` 直接引用 `/src/main.tsx`），与"页面"这一层是两件事，放在根上更准确地表达这一点。

## 规则

1. **页面不写分支逻辑**：像「输入区此刻放输入卡还是确认卡」这类判定属于组件（见 [../components/main-page.md](../components/main-page.md) 的 `ComposerSlot`）。页面只把组件挂到槽位上。历史上这段判定曾写在页面里，结果是每加一种接管形态都要回来改页面。
2. **每个副作用一个 hook**：订阅类逻辑放在 `store/hooks.ts` 与 `store/stream.ts`，页面只按名调用（`useStreamSubscription()` 等），一行一个，顺序稳定。这些订阅**必须留在 `index.tsx` 这一层**，不能下移进某一版外壳：它们驱动的是 store 里的共享状态，放进外壳会让切换外观时重建事件流——那是真的重连宿主，不是一次外观切换。
3. **页面不持有 React 状态**：`MainPage` 里没有 `useState`。需要跨组件共享的状态一律进 store；组件私有的状态留在该组件内。
4. **DOM 骨架是契约**：`frame` / `conversation` / `body` / `scrollBody` / `column` 这些类名与层级被样式文件大量依赖（容器查询、屏外优化、贴底滚动），改结构前先读 [../styles/frame.md](../styles/frame.md)。

## 两版外壳（v1 / v2）

同一套数据与同一套订阅，两套装配：

| 文件 | 外观 | 说明 |
|---|---|---|
| `ShellV1.tsx` | 旧版 | 装配与数据读取逐字保持原样；唯一外来变化是顶栏多了一个 `UiVariantToggle`（「能切回旧版」这个需求本身要求的入口） |
| `ShellV2.tsx` | 新版（默认） | 组件全部来自 `components/v2/**`；挂载时把 `data-ui="v2"` 写到 `<html>`，卸载时删除——写在 `<html>` 而不是子树根节点上，是因为统计浮层与弹窗是 portal 到 `body` 的，挂在子树里它们会落在作用域外 |

分流点只有一处：`index.tsx` 里 `variant === 'v2' ? <ShellV2 /> : <ShellV1 />`。**默认是 v2（新版）**——只有用户显式选过旧版才回落，判据在 `reducers/ui.ts` 的 `readStoredVariant()`。两版共用同一份 store 与同一批 props 驱动的渲染器，因此「功能一致」由数据来源保证，而不是靠两份代码手工对齐。

外壳切换**不重建任何订阅、不重取会话**：这是把订阅留在薄壳的唯一理由，回归时要按这条验。v2 的分层与硬约定见 [../../AGENTS.md](../../../AGENTS.md) §3。

## 新增一个页面时

当前只有一个页面（`mainPage`）。若要新增（例如另一套外壳）：

1. 建 `web/src/page/<name>/index.tsx`，导出该页面组件；
2. 数据从 `store` 取，副作用用 `store/hooks.ts` 里已有的 hook，缺少时先在那里加；
3. 在 `main.tsx` 里挂载（当前无路由，直接替换或按条件渲染）；
4. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。

