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
| `page/mainPage/Shell.tsx` | 改外壳装配、槽位接线时（见 §外壳装配） |

### 必须遵守的规则

1. **页面不写分支逻辑** —— 违反后果：每加一种形态都要回来改页面。详见 §规则。
2. **每个副作用一个 hook** —— 违反后果：订阅时机错乱、清理遗漏导致重复订阅。详见 §规则。
3. **页面不持有 React 状态** —— 违反后果：状态出现第二个住处，流式帧与界面不同步。详见 §规则。
4. **不改 DOM 骨架** —— `appFrame` / `appConversation` / `appStageBody` / `appStageScroll` / `appStageColumn` 被样式大量依赖。违反后果：容器查询、屏外优化、贴底滚动同时失效。详见 §规则与 [../styles/frame.md](../styles/frame.md)。

## 这一层的职责

页面层只做两件事，**不含业务逻辑**：

1. **装配**：按设计好的 DOM 骨架把组件摆好（`.appFrame` → 侧栏 + 会话区 → 顶栏 + 会话容器 + 浮层）。
2. **生命周期**：在正确时机建立/清理副作用（事件流订阅、目录同步、窗口尺寸、全局快捷键）。

数据来自 `store`，通过 selector 读出后以 **props** 传给组件；动作通过 `useActions()` 取。页面自己不实现请求、缓存或判定。

## 目录

| 路径 | 说明 |
|---|---|
| `web/src/main.tsx` | 应用入口：`createRoot` + `StrictMode` + `<Provider store={store}>`，并引入全部样式 |
| `web/src/page/mainPage/index.tsx` | 唯一页面 `MainPage`：四个生命周期订阅 + 直接渲染 `<Shell />`（**薄壳**，不读业务数据） |
| `web/src/page/mainPage/Shell.tsx` | 唯一外壳 `Shell`：从 store 取数据 → 按槽位交给 `components/mainPage/**`（见 §外壳装配） |

`main.tsx` 在 `src/` 根而不是 `page/` 下：它是**构建入口**（`web/index.html` 直接引用 `/src/main.tsx`），与"页面"这一层是两件事，放在根上更准确地表达这一点。

## 规则

1. **页面不写分支逻辑**：像「输入区此刻放输入卡还是确认卡」这类判定属于组件（见 [../components/main-page.md](../components/main-page.md) 的 `ComposerSeat`）。页面只把组件挂到槽位上。历史上这段判定曾写在页面里，结果是每加一种接管形态都要回来改页面。
2. **每个副作用一个 hook**：订阅类逻辑放在 `store/hooks.ts` 与 `store/stream.ts`，页面只按名调用（`useStreamSubscription()` 等），一行一个，顺序稳定。这些订阅**必须留在 `index.tsx` 这一层**，不能下移进外壳：它们驱动的是 store 里的共享状态（会话流、目录、侧栏、Esc），放进外壳会让外壳的任何一次重挂载都重建事件流——那是真的重连宿主，不是一次重新渲染。
3. **页面不持有 React 状态**：`MainPage` 里没有 `useState`。需要跨组件共享的状态一律进 store；组件私有的状态留在该组件内。
4. **DOM 骨架是契约**：`appFrame` / `appConversation` / `appStageBody` / `appStageScroll` / `appStageColumn` 这些类名与层级被样式文件大量依赖（容器查询、屏外优化、贴底滚动），改结构前先读 [../styles/frame.md](../styles/frame.md)。

## 外壳装配（`Shell.tsx`）

页面层只有一个外壳，组件全部来自 `components/mainPage/**`：

| 事项 | 做法 |
|---|---|
| 数据 | `useAppSelector` 在 `Shell` 里取，以 props 交给 `Stage`；`actions.confirm` / `actions.reject` 由 `useActions()` 取 |
| 槽位 | `composer={<ComposerSeat />}`、`hero`（首屏阶段才传）、`pendingEcho`（乐观回显气泡）由 `Shell` 一次性接好 |
| 浮层 | `DialogStage` / `Toast` 与外壳同级，挂在 `.appFrame` 内 |
| 动效降级 | 外层包 `MotionConfig reducedMotion="user"`：系统开了「减少动态效果」时 motion 跳过位移/缩放类动画，只保留透明度过渡 |

`Shell` 只是装配点：它不做判定、不持有状态，新增接管形态不需要回来改它（判据在 `ComposerSeat` 的座位表里）。外壳的重新挂载**不重建任何订阅、不重取会话**——这是把订阅留在 `index.tsx` 薄壳的唯一理由，回归时要按这条验。外观层的分层与硬约定见 [../../AGENTS.md](../../../AGENTS.md) §3。

## 新增一个页面时

当前只有一个页面（`mainPage`）。若要新增（例如一个独立页面）：

1. 建 `web/src/page/<name>/index.tsx`，导出该页面组件；
2. 数据从 `store` 取，副作用用 `store/hooks.ts` 里已有的 hook，缺少时先在那里加；
3. 在 `main.tsx` 里挂载（当前无路由，直接替换渲染）；
4. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。
