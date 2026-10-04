# 页面框架、会话区与共享渲染器（`styles/frame.css`）

## 使用说明

### 这份文档是什么

`frame.css`（1053 行）的覆盖范围、五个必须理解的技术点（网格、容器查询、屏外优化、贴底跟随、首屏的另一套结构）、DOM 契约表与常见改动场景。

上层：[readme.md](readme.md)。这份样式与 `page/mainPage` + `components/mainPage/**` 的 DOM 结构是**契约关系**。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §覆盖范围 | 想知道某段规则对齐的是上游哪个组件 |
| §五个必须理解的技术点 | **改外壳或会话区布局前必读**（改错会同时破坏列宽、屏外优化与贴底） |
| §共享渲染器 | 要改消息行、过程折叠、思考块、Markdown 观感时（这些类名的形态只在这里定义一次） |
| §DOM 契约表 | **改类名或层级前必读**（逐项列出谁依赖它） |
| §常见改动场景 | 改列宽、侧栏折叠、首屏、轮次导轨时 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **不得移动 `.appStageScroll` / `.appStageFlow` / `.appStageColumn` / `.appTurn` 的层级** —— 违反后果：容器查询与 `content-visibility` 屏外优化同时失效。
2. **共享渲染器的类名只在这里定义形态**（`.userRow`、`.bubble`、`.assistantRow`、`.processTitle`、`.thinkingBlock`、`.markdown`…）—— 违反后果：同一属性出现第二个来源，改一处不生效。卡片类（`.planCard` 等）在 `cards.css`，同理只有一处。
3. **不改 `.appFrame[data-sidebar]` 的语义** —— 它是样式钩子，由 `ui.collapsed` 映射而来（`page/mainPage/Shell.tsx`）。

## 覆盖范围

数值逐项对齐 deepseek-harness（MIT）的对应样式表：

| 上游 | 本文件覆盖 |
|---|---|
| `ui-layout/AppFrame` | 外层 grid 轨道、区域背景与分隔 |
| `ui-sidebar/SidebarRoot` | 侧栏内边距、logo 行、新建会话、面板行 |
| `ui-workspace/rows/Rows` | 会话行（32px）、标题与时间字号 |
| `ui-conversation/skeleton/ConversationRoot` | 会话头（`min-height: 68px`）、滚动体、composer 座位 |
| `ui-chat/chat/ChatView` + `AssistumMarkdown` + `MessageItem` | 列宽轴、行距、气泡、正文、Markdown |
| `ui-chat/chat/ChatGroupSeat` + `TurnProcessNodeView` | 过程折叠块 |
| `ui-chat/chat/TurnNavigator` | 右侧轮次导轨 |
| `ui-conversation/skeleton/HeroShell` | 空会话首屏 |

## 五个必须理解的技术点

### 1. 外壳网格由 `.appFrame[data-sidebar]` 驱动

`.appFrame` 是两列 grid：`grid-template-columns: var(--app-sidebar-width) minmax(400px, 1fr)`，`height: 100%`、`overflow: hidden`、底色 `var(--bgm-bg)`。

- `--app-sidebar-width` 默认 `264px`；`[data-sidebar='collapsed']` 时是 `60px`，并且**列宽变化带过渡**（`grid-template-columns var(--app-dur-slow) var(--app-ease-out)`）；
- `@media (max-width: 1024px)` 下也把 `--app-sidebar-width` 压到 `60px`（与 `useResponsiveCollapse` 配合，见 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 的 `L3`）；
- `data-sidebar` 是**样式钩子**，不是语义属性；它由 `Shell.tsx` 从 `ui.collapsed` 映射而来。折叠态下的隐藏一律用"透明度 + 宽度归零"（`.appBrand`、`.appNewSessionLabel`、`.appRegionLabel`、`.appSessionTitle`、`.appSessionTime`），不做 `display: none`，这样它们与列宽过渡同步淡出；
- **改侧栏宽度 → 改这里的 `--app-sidebar-width`**，不要在组件里写内联宽度。

### 2. 列宽走容器查询（`.appStage` 上的 `container-type`）

```css
.appStage { container-type: inline-size; }
.appStageColumn { max-width: min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px)); }
```

- `100cqw` / `64cqw` 的参照是 `.appStage`（它包住滚动体与输入区座位），因此**会话列与输入区座位必须在同一个尺寸容器内**；
- 列宽上限先取容器内容宽（`100cqw - 48px`，正是 `.appStageFlow` 左右各 24px 之后），再用 `clamp(680px, 64cqw, 900px)` 收进 680–900px 区间，最后 `margin: 0 auto` 居中；
- `@media (max-width: 720px)` 时 `.appStageColumn` 放开到 `max-width: 100%`。

### 3. 屏外优化依赖完整祖先链

```css
.appStageScroll[data-phase='active'] > .appStageFlow > .appStageColumn > .appTurn { content-visibility: auto; }
```

这条规则让屏外轮次跳过渲染与布局，是长会话流畅的关键。**它要求链路一层不缺**，所以 `.appStageScroll` → `.appStageFlow` → `.appStageColumn` → `.appTurn` 的结构不可随意调整。

这里**刻意不配 `contain-intrinsic-size`**：给了估算高度虽然首帧更快，但会话切换后"滚到最新一条"会按估算落位，真实高度算出来后视图会停在历史中段。

### 4. 贴底跟随是"读一次、写一次"的

滚动跟随由 `components/mainPage/conversation/Stage.tsx` 的 effect 完成（读 `scrollHeight` → 写 `scrollTop`），且在极短窗口内补贴三次——因为 `content-visibility: auto` 让浏览器分批算出真实高度。改这段样式（例如给 `.appStageScroll` 加 padding/负边距）会影响贴底精度，回归时请覆盖 [../regression/session-flow.md](../regression/session-flow.md) 的"流式跟随"用例。

### 5. 首屏阶段的 DOM 是另一套

`Stage.tsx` 在 `heroPhase` 为真时把 `.appHero` 直接渲染进 `.appStageScroll`，**没有 `.appStageFlow` / `.appStageColumn`**：

- 居中靠 `.appStageScroll[data-phase='hero'] { justify-content: center; }`；
- 首屏的输入卡更高，靠 `.appStage[data-phase='hero'] .appSeat`（`padding-bottom: 26px`）与 `.appStage[data-phase='hero'] .appComposerInput`（`min-height: 32px`）两处，规则写在 `composer.css`；
- 屏外优化与内容宽轴都只按 `active` 生效（`.appTurn` 只在活动阶段拿 `content-visibility`），首屏用不上这两条链路。

`.appStageFlow` / `.appStageColumn` 的规则都挂在类上（不依赖 `data-phase`），回归首屏时不要按"少了两个节点"判定失败。

## 共享渲染器

会话流里的行与块都用本文件里的类名：共享渲染器那批（`.userRow` / `.userStack` / `.bubble`、`.assistantRow` / `.assistantBody`、`.noticeRow` / `.errorRow` / `.stateDot` / `.errorText` / `.sessionBanner`、`.processGroup` / `.processTitle` / `.processBody` / `.activityRow` / `.mark` / `.chevron` / `.count`、`.thinkingBlock` / `.thinkingTitle` / `.thinkingBody`、`.markdown*`），加上流式区自己的容器（`.appStreaming` / `.appStreamingBody` / `.appStreamingCursor` / `.running`）。

`components/mainPage/conversation/` 与 `components/content/markdown.tsx` 只负责渲染出这些类名；**它们的形态只有本文件一处来源**。

这里也是全项目唯一允许的常驻循环动画所在：`.appStreamingCursor` 的 `app-cursor-breathe`（1.1s，透明度 1↔.25）只在流式期间存在，表达"还在写"；其余动效都必须是"进入/离开"一次性的（见 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 的 `A3`）。

`Turn.tsx` 给每一行包了一层 `.appRow`（纯结构钩子，本身没有规则），轮次之间的行距由 `.appTurnStack { gap: 10px }` 给出。

## DOM 契约表

改动下列类名或层级前，先确认没有样式依赖它：

| 类名 | 谁依赖它 |
|---|---|
| `.appFrame[data-sidebar]` | 外壳网格与侧栏形态 |
| `.appSidebar` / `.appRegionArea` | 侧栏滚动与内边距 |
| `.appConversation` / `.appHeader` | 会话列与顶栏（`min-height: 68px`、底部 1px hairline） |
| `.appStage` | **容器查询参照**（`container-type: inline-size`）+ `data-phase` 的落点 |
| `.appStageBody` | 滚动体与轮次导航的共同定位上下文 |
| `.appStageScroll[data-phase]` | 滚动容器 + 屏外优化 + 贴底 + 首屏居中 |
| `.appStageFlow` / `.appStageColumn` | 外层边距与内容宽轴（`100cqw` 的落点） |
| `.appTurn` | 屏外优化的最后一级；`components/mainPage/conversation/Turn.tsx` 的根节点（带 `id="turn-<id>"`） |
| `.appRail` / `.appRailButton[data-active]` | 轮次导轨（`railTurns.length >= 2` 才渲染） |
| `.appHero` / `.appHeroHeadline` / `.appHeroBadge` / `.appHeroHint` | 首屏引导块（`BlurText` 渲染标题，`gap: 0` 是刻意的） |
| `.appChip[data-state]` / `.appChipDot` | 顶栏连接状态（`on` 绿 + 光晕 / `off` 红 + 光晕） |
| `.appToast` | 提示条（`position: fixed`，`z-index: 40`） |

## 常见改动场景

| 想做的事 | 改哪里 |
|---|---|
| 调整会话列最大宽度 | `.appStageColumn` 的 `max-width`（本文件唯一的内容宽轴） |
| 侧栏折叠时保留图标条 | `.appFrame[data-sidebar='collapsed']` 相关规则 |
| 首屏文案块的位置与间距 | `.appHero*`；注意 `data-phase='hero'` 还控制输入卡的最小高度（在 `composer.css`） |
| 轮次导轨样式 | `.appRail` / `.appRailButton`；可见性由 `Stage.tsx` 控制（`railTurns.length >= 2`） |
| 改 Markdown 排版 | 本文件末尾的 `.markdown*` 段（字号来自 `tokens.css` 的 `--dsw-font-markdown-*`） |
