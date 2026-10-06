# 调试页开关（`utils/debugMode.ts`）

## 简介

调试页的入口开关：三个函数读写 `window.location.hash === '#debug'`。它决定 `main.tsx` 的 `Root` 挂主界面还是调试页，也是「双击侧栏品牌（主界面）/ 双击顶栏品牌（调试页）」与「调试页返回按钮」唯一共用的落点。

**不覆盖**：调试页本体（见 [../page/debug.md](../page/debug.md)）、调试页皮肤（见 [../styles/debug.md](../styles/debug.md)）。

上层：[readme.md](readme.md)。

## 使用说明

- **想把它改成 store 字段、或把触发点搬进页面层之前，先读 §规则**：「组件层不得依赖页面层」与「用 hash 而不是 store 字段」两条在那里，违反会分别导致分层失效与刷新掉回主界面。
- **只想查函数签名与调用方**：直接查 §索引 的两张表（导出、调用方 → 场景）。
- 本层通用规则（无组件无 hook、不写"顺手"的通用工具）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 放在工具层：组件层要触发「进入调试页」，但组件层不得依赖页面层

依赖方向是单向的（页面 → 组件 → 工具）。触发「进入调试页」的落点在**侧栏品牌行**（`components/mainPage/shell/Sidebar.tsx`，组件层），而挂载决策在 `main.tsx`/`page/**`（页面层）——组件不能 import 页面。把开关放进工具层后，三处都只 import 它：`Root` 用 `isDebugHash`、`Sidebar` 用 `enterDebug`、调试页（`page/debug/index.tsx`）用 `exitDebug`。

**落点在两个品牌的共享组合类上**：[C01](../../design/decisions/C01-app-top-bar.md) 删掉主界面顶栏之后，主界面的品牌回到**侧栏顶部的品牌行**（`.appSidebarBrand`）；调试页的品牌仍在共享顶栏组件 `AppTopBar` 的 `brand` 槽里。两处都带组合类 **`.appBrandAction`**（从 `debug.css` 移到 `common.css`，因为它现在被两个入口共用）与 `data-debug-toggle="true"`，行为一致：双击或回车 / 空格触发。提供旧落点的 `components/mainPage/shell/SidebarBrand.tsx` 与主界面顶栏 `Header.tsx` **都已删除**。

**违反后果**：组件反向依赖页面层，分层失效（换个外壳就带不走这个入口）。

### 用 hash 而不是 store 字段

三个理由：

1. **刷新后保持**：hash 在 URL 上，刷新仍是调试页；store 字段会随重新装载回到初值。
2. **可分享**：把带 `#debug` 的链接发给别人就能复现同一屏。
3. **不给 `ui` 切片加开发期字段**：`ui` 承载的是"界面此刻的状态"，而调试开关是**入口**，不是状态。

**违反后果**：`ui` 切片被开发期字段污染，或刷新后掉回主界面。

### 只读写 `location.hash`，不做其它副作用

三个导出都是"读一次 / 写一次 hash"：无状态、无请求、不读 store、不碰 DOM 结构。`enterDebug` 与 `exitDebug` 都先判定当前值再写，避免写同值触发多余的 `hashchange`。

页面的挂载与卸载由 `main.tsx` 的 `hashchange` 监听完成——**这里不负责切换页面**。

**违反后果**：同一处切换出现两个触发者，出现重复渲染或竞态。

### 只认全等的 `'#debug'`

判定是 `window.location.hash === '#debug'`，不是包含或前缀匹配；`exitDebug` 把 hash 置为空串。

**违反后果**：`#debug-xxx` 之类的锚点被误判成调试页。

## 索引

### 导出

| 导出 | 签名 | 作用 | 什么时候读 |
|---|---|---|---|
| `isDebugHash` | `() => boolean` | 判定当前是否 `#debug` | 改分流判定、想加第二个调试入口时 |
| `enterDebug` | `() => void` | hash 置为 `#debug` | 改"怎么进调试页"（现在是双击侧栏品牌）时 |
| `exitDebug` | `() => void` | hash 清空 | 改调试页的退出落点时 |

### 调用方 → 场景

| 调用方 | 用了哪个导出 | 什么时候读 |
|---|---|---|
| `web/src/main.tsx`（`Root`） | `isDebugHash` | 改 `hashchange` 监听与两个页面的互斥挂载时 |
| `components/mainPage/shell/Sidebar.tsx` | `enterDebug` | 改主界面侧栏品牌行的双击 / 回车 / 空格行为时 |
| `page/debug/index.tsx` | `exitDebug` | 改调试页顶栏品牌的双击返回或「返回主界面」按钮时 |

主界面的入口**只有**侧栏品牌行这一处（`Sidebar.tsx`，品牌文案「Bangumi 助手」）；它不再是「只有会话列表」的那个侧栏——品牌、连接状态点、折叠钮、「开启新对话」、分组列表与底部用户行都在这里。调试页的入口仍只在顶栏品牌。

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §规则「放在工具层：组件层要触发「进入调试页」，但组件层不得依赖页面层」 | 想把开关搬回组件层或页面层时 |
| §规则「用 hash 而不是 store 字段」 | 想改用 store 字段、或讨论刷新后行为时 |
| §规则「只读写 `location.hash`，不做其它副作用」 | 想在这里顺带挂载/卸载页面时 |
| §规则「只认全等的 `'#debug'`」 | 改判定方式、加第二个 hash 入口时 |
