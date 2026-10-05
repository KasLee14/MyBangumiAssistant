# 外壳、会话区与共享渲染器（`styles/frame.css`）

## 简介

外壳与会话区的样式：覆盖范围、四个必须理解的技术点（网格、容器查询、屏外优化、贴底跟随）、DOM 契约表与常见改动场景。**共享渲染器**（消息行、提示与错误、过程折叠、Markdown、流式区）的规则也在本文件。

**不覆盖**：确认卡、按钮基元、输入区座位与浮层、弹窗的类名与规则（见 [components.md](components.md)）；品牌令牌与内容条目皮肤（见 [content-and-brand.md](content-and-brand.md)）。

上层：[readme.md](readme.md)。这份样式与 `page/mainPage` + `components/mainPage/conversation/` 的 DOM 结构是**契约关系**。

## 使用说明

- **改外壳或会话区布局前必读 §规则「四个必须理解的技术点」**：改错会同时破坏列宽、屏外优化与贴底。
- **改类名或层级前必读 §索引「DOM 契约表」**：它逐项列出谁依赖某个类名。
- **只想查某段规则对齐上游哪个组件、或某个场景该改哪里**：直接查 §索引（覆盖范围、共享渲染器类名表、DOM 契约表、常见改动场景），不必通读 §规则。
- 本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」；本篇专属的 4 条在 §规则「本篇专属规则」。

## 规则

### 本篇专属规则

本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」。本篇专属：

1. **不得移动 `.appStageScroll` / `.appStageFlow` / `.appStageColumn` / `.appTurn` 的层级** —— 违反后果：容器查询与 `content-visibility` 屏外优化同时失效。
2. **列宽只有一个来源**（`.appStageColumn` 的 `max-width` 公式，配 `.appStageFlow` 与 `.appSeat` 的 24px 左右内缩）—— 违反后果：正文与输入卡错位。
3. **不改 `.appFrame[data-sidebar]` 的语义** —— 它是样式钩子，由 `ui.collapsed` 映射而来。
4. **hero 阶段的两条输入区规则留在本文件**（`.appStage[data-phase='hero'] .appSeat` / `.appComposerInput`），不要在 `composer.css` 里再写一份同样的声明 —— 违反后果：属性出现两个来源，改一处不生效（见本层 [readme.md](readme.md) §规则「同一元素同一属性只有一个来源」）。

### 四个必须理解的技术点

**1. 外壳网格由 `data-sidebar` 驱动**

`.appFrame` 是两列 grid，第一列宽 `var(--app-sidebar-width)`（展开 264px、折叠 60px，`@media (max-width: 1024px)` 也落到 60px）；`data-sidebar="collapsed|expanded"` 切换列宽与侧栏内容的可见性，列宽变化走 `transition: grid-template-columns var(--app-dur-slow) var(--app-ease-out)`。因此：

- **改侧栏宽度 → 改 `--app-sidebar-width` 的定义处或这里的规则**，不要在组件里写内联宽度；
- `data-sidebar` 是**样式钩子**，不是语义属性；它由 `Shell` 从 `ui.collapsed` 映射而来。

区域底色也在这一层定：`.appFrame` 与 `.appSidebar` 都用站点页面底色（`--app-surface-sunken` = `--bgm-bg` `#f5f5f5`），白面（`--app-surface`）留给 `.appConversation` 与 `.appHeader`。所以侧栏里的"卡片"要反过来用白底浮起——`.appNewSession` 与 `.appSessionRow:hover` 都是白面，灰底上那档只在白面上成立的 `#fafafa` 读不出来。

**2. 列宽走容器查询（`.appStage` 上的 `container-type`）**

`.appStage` 带 `container-type: inline-size`，`.appStageColumn` 的宽度由它配合 `100cqw` 算出：

```css
.appStageColumn {
  width: 100%;
  max-width: min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px));
  margin: 0 auto;
}
```

因此：

- **`Stage` 必须包含 `.appStage`**：少了这个祖先，`cqw` 就没有参照，列宽与换行都会不同；
- `.appStageFlow`（`padding: 20px 24px 8px`）与 `.appSeat`（`padding: 6px 24px 18px`，在 `composer.css`）各自给同一个 24px 左右内缩，和公式里的 `- 48px` 同源，改动其中之一要同步；
- 输入卡与确认卡**没有**与 `.appStageColumn` 相同的宽度上限（见 §规则「已知不一致」），宽屏下它们比正文列更宽。

**3. 屏外优化依赖完整祖先链**

```css
.appStageScroll[data-phase='active'] > .appStageFlow > .appStageColumn > .appTurn {
  content-visibility: auto;
}
```

这条规则让屏外轮次跳过渲染，是长会话流畅的关键。**它要求链路一层不缺**，所以 `Stage` 的结构（`.appStageScroll` → `.appStageFlow` → `.appStageColumn` → `.appTurn`）不可随意调整。

**4. 贴底跟随是"读一次、写一次"的**

滚动跟随由 `Stage` 的 effect 完成（读 `scrollHeight` → 写 `scrollTop`），且在极短窗口内补贴三次（立即 + 一帧 `requestAnimationFrame` + 120ms 定时）——因为 `content-visibility: auto` 让浏览器分批算出真实高度。滚动时用"距底部 80px 以内"判定是否仍处于跟随状态，并在滚动停止 150ms 后强制重算一次轮次高亮。改这段样式（例如给 `.appStageScroll` 加 padding/负边距）会影响贴底精度，回归时请覆盖 [../regression/session-flow.md](../regression/session-flow.md) 的 `S2`（流式渲染）与 `S7`（会话切换）。

### `prefers-reduced-motion` 降级写在本文件

`prefers-reduced-motion: reduce` 的降级也写在本文件（`*` 上禁用 `transition` / `animation`），它由 `Shell` 的 `<MotionConfig reducedMotion="user">` 一起承担（见 §索引「常见改动场景」）。两处都要保留——只改一处会让降级只降一半（CSS 过渡停了、motion 动画照旧）。

### 已知不一致（待确认，本次只记录未改源码）

1. 输入卡与确认卡曾经与 `.appStageColumn` 共用同一条宽度轴（由 `--dsh-chat-content-width` / `--dsh-composer-card-max-width` 驱动）。合并后这两个变量**已不存在**：`.appSeat` 只给左右 24px 内边距，`.planCard` 的 `max-width: var(--dsh-composer-card-max-width)` 指向一个无人定义的变量，声明因此不生效。宽屏下列宽被钳制在 900px，而输入卡/确认卡会铺满可用宽度。
2. `.appComposerHero` 这个类仍由 `Composer` 挂在卡片上，但 `composer.css` 里没有对应规则（首屏的差别现在只有上面那两条 `.appStage[data-phase='hero']` 规则）。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §索引 → 覆盖范围 | 想知道某段规则对齐的是上游哪个组件 |
| §规则 → 四个必须理解的技术点 | **改外壳或会话区布局前必读**（改错会同时破坏列宽、屏外优化与贴底） |
| §索引 → 共享渲染器 | 改消息行、提示与错误行、过程折叠块、Markdown 或流式区时 |
| §索引 → DOM 契约表 | **改类名或层级前必读**（逐项列出谁依赖它） |
| §索引 → 常见改动场景 | 改列宽、侧栏折叠、首屏、轮次导轨时 |
| §规则 → 已知不一致（待确认） | 动输入卡 / 确认卡宽度，或看到 `.appComposerHero` 时 |

### 覆盖范围

数值逐项对齐 deepseek-harness（MIT）的对应样式表：

| 上游 | 本文件覆盖 |
|---|---|
| `ui-layout/AppFrame` | 外层 grid 轨道、区域背景与分隔 |
| `ui-sidebar/SidebarRoot` | 侧栏内边距、品牌行、新建会话、会话行（32px 高） |
| `ui-workspace/rows/Rows` | 会话行标题与时间字号 |
| `ui-conversation/skeleton/ConversationRoot` | 顶栏 68px、滚动体、输入区座位 |
| `ui-chat/chat/ChatView` + `MessageItem` | 列宽轴、行距、气泡、正文 |
| `ui-chat/chat/ChatGroupSeat` + `TurnProcessNodeView` | 过程折叠块 |
| `ui-chat/chat/TurnNavigator` | 右侧轮次导轨 |
| `ui-conversation/skeleton/HeroShell` | 空会话首屏 |

此外还包含两类**不在上游对应表里**的规则：品牌形态（圆角、描边、hover 填充、点线分隔）与外观层的过渡/阴影，它们原先分散在品牌形态层与外观覆写层里，现已就地并入下面的规则；`.appToast`（右下角提示条）也属于这一类，没有上游对应组件。

### 共享渲染器

会话流里的原子行共用一批既有类名，组件与样式两边改一处即可（组件侧见 [../components/main-page.md](../components/main-page.md)）：

| 类名 | 规则要点 |
|---|---|
| `.userRow` / `.userStack` / `.bubble` | 用户气泡：`.bubble` 右下角收一档，作为"这是我说的话"的方向暗示，不靠箭头装饰 |
| `.assistantRow` / `.assistantBody` | 助手回答：`.assistantBody` 用 2px 左描边 + 10px 内缩与用户消息分开 |
| `.noticeRow` / `.errorRow` / `.stateDot` / `.errorText` | 提示是淡底无描边的一行说明；错误是状态点 + 文本，都不是整条彩色横幅 |
| `.sessionBanner` | 会话头条目 |
| `.running` | 运行中状态行（文案 + `N秒` + Esc 提示），配色用比白面略沉的一档 |
| `.processGroup` / `.processTitle` / `.chevron` / `.count` / `.processBody` | 过程折叠块：展开态由 `data-open` 驱动，`.chevron` 旋转 180° |
| `.activityRow` / `.mark` | 工具活动行：`mark` 是 `·` / `✓` / `×`；状态色在 `cards.css` |
| `.markdown*`（含 `.markdownTableWrap` / `.markdownTableWide`） | Markdown 渲染：标题阶梯、行内代码、代码块、表格横向滚动兜底 |
| `.appStreaming` / `.appStreamingBody` | 流式正文容器（光标由 `TextType` 在 `.appStreamingCursorRow` 里渲染） |

按钮基元（`.button`）、流式思考块（`.thinkingBlock` / `.thinkingTitle` / `.thinkingBody`）与工具活动的状态色在 `cards.css`；`.plan*` 确认卡与输入区原子在 `composer.css` 与 `cards.css`——见 [components.md](components.md)。

### DOM 契约表

改动下列类名或层级前，先确认没有样式依赖它：

| 类名 | 谁依赖它 |
|---|---|
| `.appFrame[data-sidebar]` | 外壳网格与侧栏形态 |
| `.appConversation`、`.appHeader` | 会话列与顶栏高度 |
| `.appStage[data-phase]` | **容器查询参照**；hero/active 两种阶段的间距与输入区高度 |
| `.appStageScroll[data-phase]` | 滚动容器 + 屏外优化 + 贴底 |
| `.appStageFlow` / `.appStageColumn` | 内容宽轴（`.appStageColumn` 是 `100cqw` 的落点） |
| `.appTurn` | 屏外优化的最后一级；`Turn` 的根节点 |
| `.appRail` / `.appRailButton` | 轮次导轨（≥2 轮才渲染） |
| `.appHero` / `.appHeroHeadline` / `.appHeroBadge` / `.appHeroHint` | 首屏引导块 |
| `.appSeat` / `.appCardSeat` | 输入区座位与接管卡座位（规则在 `composer.css`，hero 阶段的两条例外在本文件） |
| `.appToast` | 右下角提示条（`position: fixed`，`z-index: 40`） |

### 常见改动场景

| 想做的事 | 改哪里 |
|---|---|
| 调整会话列最大宽度 | `.appStageColumn` 的 `max-width` 公式（列宽只有这一个来源）；`.appStageFlow` 与 `.appSeat` 的 24px 内缩要一起改 |
| 侧栏折叠时保留图标条 | `.appFrame[data-sidebar='collapsed']` 相关规则 |
| 首屏文案块的位置 | `.appHero*`（`data-phase='hero'` 还控制 `.appStageScroll` 的居中与输入区最小高度） |
| 轮次导轨样式 | `.appRail` / `.appRailButton`；可见性由 `Stage` 控制（`railTurns.length >= 2`） |
| 提示条的位置与层级 | `.appToast` |
| 减少动态效果的降级 | 本文件的 `prefers-reduced-motion` 段 + `Shell` 的 `<MotionConfig reducedMotion="user">`，两处都要保留 |
