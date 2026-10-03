# 页面层（`web/src/page/`）

> 上层入口：[../../AGENTS.md](../../../AGENTS.md)。本文件是页面层的索引与规则；具体实现见 [main-page.md](main-page.md)。

## 这一层的职责

页面层只做两件事，**不含业务逻辑**：

1. **装配**：按设计好的 DOM 骨架把组件摆好（`frame` → 侧栏 + 会话区 → 头部 + 会话视图 + 浮层）。
2. **生命周期**：在正确时机建立/清理副作用（事件流订阅、目录同步、窗口尺寸、全局快捷键）。

数据来自 `store`，通过 selector 读出后以 **props** 传给组件；动作通过 `useActions()` 取。页面自己不实现请求、缓存或判定。

## 目录

| 路径 | 说明 |
|---|---|
| `web/src/main.tsx` | 应用入口：`createRoot` + `StrictMode` + `<Provider store={store}>`，并引入全部样式 |
| `web/src/page/mainPage/index.tsx` | 唯一页面 `MainPage`：订阅 + 装配 |

`main.tsx` 在 `src/` 根而不是 `page/` 下：它是**构建入口**（`web/index.html` 直接引用 `/src/main.tsx`），与"页面"这一层是两件事，放在根上更准确地表达这一点。

## 规则

1. **页面不写分支逻辑**：像「输入区此刻放输入卡还是确认卡」这类判定属于组件（见 [../components/main-page.md](../components/main-page.md) 的 `ComposerSlot`）。页面只把组件挂到槽位上。历史上这段判定曾写在页面里，结果是每加一种接管形态都要回来改页面。
2. **每个副作用一个 hook**：订阅类逻辑放在 `store/hooks.ts` 与 `store/stream.ts`，页面只按名调用（`useStreamSubscription()` 等），一行一个，顺序稳定。
3. **页面不持有 React 状态**：`MainPage` 里没有 `useState`。需要跨组件共享的状态一律进 store；组件私有的状态留在该组件内。
4. **DOM 骨架是契约**：`frame` / `conversation` / `body` / `scrollBody` / `column` 这些类名与层级被样式文件大量依赖（容器查询、屏外优化、贴底滚动），改结构前先读 [../styles/frame.md](../styles/frame.md)。

## 新增一个页面时

当前只有一个页面（`mainPage`）。若要新增（例如另一套外壳）：

1. 建 `web/src/page/<name>/index.tsx`，导出该页面组件；
2. 数据从 `store` 取，副作用用 `store/hooks.ts` 里已有的 hook，缺少时先在那里加；
3. 在 `main.tsx` 里挂载（当前无路由，直接替换或按条件渲染）；
4. 在本文件与 [../../AGENTS.md](../../../AGENTS.md) 的索引里登记。

## 子文档

- [main-page.md](main-page.md)：`main.tsx` 与 `MainPage` 的装配细节、四个订阅、props 接线契约。
