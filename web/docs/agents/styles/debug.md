# 调试页与文档页皮肤（`debug.css` / `library.css`）

## 使用说明

### 这份文档是什么

两个「次要入口」的皮肤规则：调试页（`debug.css`）与组件库文档页（`library.css`）。两者的共同点是**刻意复用主界面那一套类与令牌**，只是装配不同。

**不覆盖**：两个页面的装配与生命周期（见 [../page/debug.md](../page/debug.md)、[../page/library.md](../page/library.md)）、共享表面原语（见 [components.md](components.md)）、外壳与会话区（见 [frame.md](frame.md)）。上层入口：[../readme.md](../readme.md)。

### 怎么读

| 你要改的地方 | 读哪一节 |
|---|---|
| 调试页的输入列宽度、三段式网格、顶栏 | §索引「`debug.css`」 |
| 调试页的输入区 / 预览条 / 空态 | §索引「`debug.css`」 |
| 文档页的三栏布局、左导航、右目录 | §索引「`library.css`」 |
| 文档页的卡片、代码块、参数表 | §索引「`library.css`」 |
| 「为什么这两个页面可以有自己的皮肤」 | §规则 |

### 必须遵守的规则

1. **两个文件都只声明自己前缀的类，不覆写共享类与内容组件的既有类**：`debug*` / `.debugLink` 与 `lib*`。要改 `.content*` 的外观，去 [content-and-brand.md](content-and-brand.md) 改那一条唯一来源，或用**组合类**。违反后果：三处入口的外观各自漂移（重构前顶栏分头实现就是这么来的）。
2. **调试页的三段式网格只作用于 `[data-mode='debug']`**：主界面没有顶栏，`.appFrame` 只剩 `'side main'` 两列一行；调试页需要「品牌 + 栏目 + 动作」横条，所以在自己的作用域里**把三段式恢复回来**。违反后果：`AppTopBar` 被自动放置到隐式的第二行，宽度只等于侧栏列宽。
3. **调试页的输入列宽度在页面自己声明**（`.appFrame[data-mode='debug'] { --app-sidebar-width: 400px }`），不靠 `html[data-debug]` 提特异性。主界面那套「抽屉锁宽 + 整体左移」用 `:not([data-mode='debug'])` 限定在主界面外壳上，所以调试页的输入列不会被锁宽、也不会左移。违反后果：调试页输入列跟着折叠动画跑，或 `data-debug` 属性变成样式作用域（它现在只是状态标记）。
4. **`.debugLink` 是组合类**：只补 `text-decoration: none`（给「组件库」链接复用既有的 `.debugButton` 形态）。不要在第二个文件里改 `.debugButton` 本身。
5. **文档页的链接不出现蓝色**：`.libInlineLink` 与 `.libReferenceLine a` 都是**主色深字 + 下划线**。违反后果：页面上冒出浏览器默认蓝 `rgb(0,0,238)`，粉白体系破功。
6. **`library.css` 只由 `library.tsx` 引入，且排在 `content.css` 之后**：文档页要展示真实的内容条目，所以内容条目皮肤必须先就位。违反后果：条目在文档页里显示成裸 DOM。

## 索引

### `debug.css`

| 段 | 类 | 要点 |
|---|---|---|
| 外壳作用域 | `.appFrame[data-mode='debug']`、`> .appTopBar` | 恢复 `'top top' / 'side main'` 三段式网格（`grid-template-rows: auto minmax(0, 1fr)`）、输入列 `--app-sidebar-width: 400px` |
| 输入区 | `.debugPane` / `.debugSection` / `.debugSectionHead` / `-Title` / `-Hint` | 分区标题 + 说明的固定三件套 |
| 输入控件 | `.debugTextarea`（`:focus-visible`、`[data-auto='true']`）、`.debugActions` | `[data-auto='true']` 是「自动播放」态自己的形状 |
| 按钮 | `.debugButton`（`:hover` / `:disabled` / `[data-primary='true']` / `[data-compact='true']`） | `data-compact` 压尺寸给「示例」按钮；`data-primary` 给主操作 |
| 状态与提示 | `.debugStatus` / `-Error` / `-Note` / `.debugSamples` | 状态行、错误行、说明行、示例按钮组 |
| 预览区 | `.debugPreviewBar` / `-Badge` / `.debugHero` / `-Title` | 预览区复用真实 `<Stage>`，落在 `.appConversation`；预览条显示当前帧的概要 |
| 组合类 | `.debugLink` / `.debugLink:hover` | 见 §规则第 4 条 |

### `library.css`

| 段 | 类 | 要点 |
|---|---|---|
| 骨架 | `.libFrame` | `min-height: 100vh` + 白面 |
| 顶栏内元素 | `.libBrand` / `.libBrandMark` 等 | 顶栏骨架来自共享组件 `AppTopBar`（`components.md`），这里只声明放进去的东西 |
| 三栏骨架 | `.libBody` / `.libNav` / `.libNavGroup` / `-GroupLabel` / `.libContent` / `.libContentInner` | 左导航 `position: sticky; top: 46px`（对齐顶栏高）、宽 252px、粉底 + 右 hairline；内容区白面——与主界面的「侧栏 \| 对话区」是同一套分区语言 |
| 右侧页内目录 | `PageToc` 相关类 | 自绘目录 + `IntersectionObserver`；**不用 hash 锚点**（「一组件一页」的路由占着 hash）——代价是平滑滚动与目标高亮自己实现 |
| 内容区 | 卡片、网格、代码块、参数表组合类、一行参考附注 | 参数表五列；`PAGE_ANCHORS` 是「UI 预览 / 参数 / event / frame」四块的 id 契约 |
| 总览页 | 每 `kind` 一张自绘卡 | 数量与文案取自 `LIBRARY_SECTIONS`，**不写死数字** |
| 窄屏 | `@media` | 三栏在窄屏下的退化 |

## 规则

### 为什么这两个页面可以有自己的皮肤

判据是**它们在服务谁**：调试页服务「输入 event / frame 看渲染结果」，文档页服务「查载荷契约与预览」，两者的装配都是单页专用的，所以有各自的 CSS 文件。但**表面语言必须与主界面同构**——同一套 `--app-*` 令牌、同一批共享原语（`.appNavRow` / `.appGlass` / `.appEmpty` / 胶囊 / 圆角四档 / 间距刻度）、同一个 `AppTopBar`。

因此「工具页另有一套外观」这个例外是**取消了的**：UI 框架（曾有过的 antd 例外）已全量移除，文档页骨架改为自绘。新增第三个入口时按同一判据处理：装配自己写，表面语言复用。

### 要加一条样式时怎么选文件

| 情况 | 落点 |
|---|---|
| 只有调试页需要 | `debug.css` |
| 只有文档页需要 | `library.css` |
| 两个入口都需要 | `common.css`（收件标准见 [components.md](components.md) §规则） |
| 主界面也需要 | `frame.css` 或对应区域的 `composer.css` / `cards.css` / `modal.css` |

### 与页面文档的分工

- **页面文档**（`page/debug.md` / `page/library.md`）负责：装配、生命周期、路由、符号索引、交互契约。
- **本文档**负责：皮肤分段、类清单、样式侧的硬约束。

两边不要互相抄；改动落到哪一侧就更新哪一侧（见 [AGENTS.md](../../../AGENTS.md) §规则首要规则第 1 条）。

## 现状

1. **`html[data-debug]` 已不是样式作用域**：`main.tsx` 的 `Root` 仍在维护这个属性，但 `debug.css` 不再用它圈定样式（调试页自己在 `.appFrame` 上声明 `data-mode="debug"`）。它在代码里保留为状态标记，不要写 `html[data-debug] ...` 的选择器。
2. **文档页的右目录是自绘的**（`PageToc` + `IntersectionObserver`）：取舍是**保路由**（前进后退、可直连 URL 已实机确认），代价是平滑滚动与目标高亮要自己写。改目录时不要退回 `location.hash`，那会与 `#/components/<kind>` 的路由互相覆盖。
3. **调试页自带独立 store**（与主 store 隔离），所以它的 `useState` 承载的是纯页面私有状态——这一点在 `page/debug.md` 里有说明，样式侧不需要额外处理。
