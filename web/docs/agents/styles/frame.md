# 页面框架与会话区（`styles/frame.css`）

> 上层：[readme.md](readme.md)。这份样式与 `page/mainPage` + `components/mainPage/conversation/` 的 DOM 结构是**契约关系**。

## 覆盖范围

数值逐项对齐 deepseek-harness（MIT）的对应样式表：

| 上游 | 本文件覆盖 |
|---|---|
| `ui-layout/AppFrame` | 外层 grid 轨道、区域背景与分隔 |
| `ui-sidebar/SidebarRoot` | 侧栏内边距、logo 行、新建会话、会话行（32px 高） |
| `ui-conversation/skeleton/ConversationRoot` | 会话头 76px、滚动体、composer 座位 |
| `ui-chat/chat/ChatView` + `MessageItem` | 列宽轴、行距、气泡、正文 |
| `ui-chat/chat/ChatGroupSeat` + `TurnProcessNodeView` | 过程折叠块 |
| `ui-chat/chat/TurnNavigator` | 右侧轮次导轨 |
| `ui-conversation/skeleton/HeroShell` | 空会话首屏 |

## 四个必须理解的技术点

### 1. 外壳网格由 `data-sidebar` 驱动

`.frame` 是两列 grid，第一列宽 `var(--dsh-sidebar-width)`；`data-sidebar="collapsed|expanded"` 切换列宽与侧栏内容的可见性。因此：

- **改侧栏宽度 → 改令牌或这里的规则**，不要在组件里写内联宽度；
- `data-sidebar` 是**样式钩子**，不是语义属性；它由 `MainPage` 从 `ui.collapsed` 映射而来。

### 2. 列宽走容器查询（`.body` 上的 `container-type`）

`.column` 的宽度由 `.body` 上的 `container-type: inline-size` 配合 `100cqw` 算出（`--dsh-chat-content-width` 也在这里被重定义）。因此：

- **`ConversationView` 必须包含 `.body`**：少了这个祖先，`cqw` 就没有参照，列宽与换行都会不同；
- `.composerSeat` 与 `.cardSeat` 各自重算了同一个"内容宽 + 32px"的轴——它们与 `.column` 同源，改动其中之一要同步。

### 3. 屏外优化依赖完整祖先链

```css
.scrollBody[data-phase='active'] > .scroll > .column > .flowItem { content-visibility: auto; }
```

这条规则让屏外轮次跳过渲染，是长会话流畅的关键。**它要求链路一层不缺**，所以 `ConversationView` 的结构（`.scrollBody` → `.scroll` → `.column` → `.flowItem`）不可随意调整。

### 4. 贴底跟随是"读一次、写一次"的

滚动跟随由 `ConversationView` 的 effect 完成（读 `scrollHeight` → 写 `scrollTop`），且在极短窗口内补贴三次——因为 `content-visibility: auto` 让浏览器分批算出真实高度。改这段样式（例如给 `.scroll` 加 padding/负边距）会影响贴底精度，回归时请覆盖 [../regression/session-flow.md](../regression/session-flow.md) 的"流式跟随"用例。

## DOM 契约表

改动下列类名或层级前，先确认没有样式依赖它：

| 类名 | 谁依赖它 |
|---|---|
| `.frame[data-sidebar]` | 外壳网格与侧栏形态 |
| `.conversation`、`.conversationHeader` | 会话列与会话头高度 |
| `.body[data-phase]` | 容器查询参照；hero/active 两种阶段的间距与高度 |
| `.scrollBody[data-phase]` | 滚动容器 + 屏外优化 + 贴底 |
| `.scroll` / `.column` | 内容宽轴与行距（`.column` 是 `100cqw` 的落点） |
| `.flowItem` | 屏外优化的最后一级；`TurnView` 的根节点 |
| `.turnRail` | 轮次导轨（≥2 轮才渲染） |
| `.hero` / `.heroStack` | 首屏引导块 |

## 常见改动场景

| 想做的事 | 改哪里 |
|---|---|
| 调整会话列最大宽度 | `--dsh-chat-content-width` 的定义处（本文件与 `composer.css`/`cards.css` 三处同源，需一起改） |
| 侧栏折叠时保留图标条 | `.frame[data-sidebar='collapsed']` 相关规则 |
| 首屏文案块的位置 | `.hero` / `.heroStack`（注意 `data-phase='hero'` 还控制输入卡的最小高度） |
| 轮次导轨样式 | `.railSlot` / `.turnRail`；可见性由 `ConversationView` 控制（`railTurns.length >= 2`） |
