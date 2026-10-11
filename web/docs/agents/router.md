# router：路由层

> 覆盖 `web/src/router/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/router/` 只管一件事：**哪个地址渲染哪个页面**。路由装配、路由表与全局未命中页都在这里；会话切换、弹窗开合、过程区展开等状态**不进 URL**，它们在 `web/src/store/`。

地址字面量的唯一来源是 `web/src/constants/paths.ts`（本层引用它，不在路由表里写裸字符串）。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 唯一装配点：模块作用域建 `createBrowserRouter(routes)`，导出 `AppRouter`（`web/src/main.tsx` 只引用它） | `web/src/router/index.tsx` | 改路由实例的创建位置 |
| `routes.tsx` | 路由表：`RootLayout` + `/`、`/debug`、`/library`（索引路由 + `components/:kind`）、`*`；含文档页两个子路由组件与标题口径 | `web/src/router/routes.tsx` | 加一个页面路由；改路由结构或页面标题口径 |
| `NotFound.tsx` | 全局未命中页（`*` 分支）：显示出错路径 + 一条明确出口，形态复用 `.appFallbackPage` / `.appEmpty*` / `.button` | `web/src/router/NotFound.tsx` | 改全局未命中页 |
| `paths.ts`（在 `constants/`） | `PATH` 与 `LIBRARY_COMPONENT_PATTERN`：地址字面量与匹配模式的唯一来源 | `web/src/constants/paths.ts` | 改地址（如 `/debug` 换成别的）或文档页详情模式 |
| `server.ts`（在宿主） | SPA 回落：为无扩展名的未知路径返回 `index.html` | `bangumi/src/web/server.ts` | 深链或刷新 404 时排查（不属于本层） |

## 规则

### 单一真相源

**1. 路径字面量只从 `constants/paths.ts` 取。**

- **规则**：`web/src/router/routes.tsx` 里不写 `'/library'` 这类裸字符串，一律引用 `PATH`。
- **为什么**：路径常量同时被页面与组件消费（侧栏、导航），写两处就会有两份地址。
- **后果**：改地址时漏改一处，页面之间链接指向 404 而路由本身正常。

### 状态归属

**2. 只有页面级分流进 URL。**

- **规则**：会话、弹窗、过程区开合、设置子屏等一律留在 `web/src/store/`；`PATH` 里没有 `:sessionId` 一类的动态段（唯一的动态段是文档页的组件 `kind`）。
- **为什么**：这些状态是「正在做的事」，不是「在哪一页」；进了 URL 就要处理前进后退与刷新恢复。
- **后果**：URL 语义膨胀，刷新后会出现半截状态，返回键行为变得不可预测。

### 失败与降级

**3. 非法 `:kind` 不静默回落。**

- **规则**：文档页详情路由拿 `:kind` 去 `LIBRARY_SECTIONS`（`web/src/page/library/constants/sections.ts`）里找，找不到就在**页内**显示「没有这个组件」提示（顶栏、左导航、搜索都还在），不跳到全局未命中页。
- **为什么**：它仍然是文档页的一屏，「明明在应用里却被踢到全局错误页」会让人以为整个应用坏了。
- **后果**：把页内缺失升级成全局错误，用户丢失上下文与返回路径。

### 技术边界

**4. 用 History 模式，不用 hash。**

- **规则**：地址形如 `/debug`、`/library/components/DataTable`；代价由宿主承担——`bangumi/src/web/server.ts` 必须为无扩展名的未知路径回落 `index.html`。
- **为什么**：地址可读、可分享、可深链。
- **后果**：宿主侧漏掉 SPA 回落时，深链与刷新都是 404，而应用内跳转一切正常（极易误判为前端 bug）。
