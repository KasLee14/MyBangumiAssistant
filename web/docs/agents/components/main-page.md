# 外壳组件（`components/mainPage/`）

> 上层：[readme.md](readme.md)。这些组件**直接消费 store**（规则 B），因为它们是外壳的一部分。

## 一览

| 子目录 | 文件 | 职责 | 读 store | 写 store |
|---|---|---|---|---|
| `sidebar/` | `Sidebar.tsx` | 品牌行、折叠按钮、新建会话、历史会话列表 | `ui.collapsed`、`catalog.sessions` | `toggleSidebar`、`newSession`、`resumeSession` |
| `header/` | `Header.tsx` | 标题行、连接状态 chip、设置入口 | `stream.connected` | `openSettings(null)` |
| `conversation/` | `ConversationView.tsx` | 滚动容器、轮次列表、流式区、轮次导轨、贴底跟随 | —（props） | —（props） |
| | `TurnView.tsx` | 一个轮次：用户气泡 + 过程折叠块 + 主体条目 | — | — |
| | `MessageParts.tsx` | 原子行（用户气泡/提示/错误/会话头）+ 流式区 | — | — |
| | `ConfirmationCard.tsx` | 写入预览卡；历史条目只显示结果 | — | — |
| | `Hero.tsx` | 首屏引导块（无 props 的纯展示） | — | — |
| `composer/` | `ComposerSlot.tsx` | 输入区**座位**：决定此刻放输入卡还是接管卡 | `stream.pending`、`stream.busy` | `confirm`、`reject` |
| | `Composer.tsx` | 输入卡 + 命令弹窗；持有草稿 | 流字段、`catalog.commands`、`ui.problem` | `optimisticSend`、`localCommand`、`stopRound`、`notice` |
| | `ThinkingPicker.tsx` | 思考强度菜单 | `stream.thinking` | `pickThinkingLevel` |
| | `StatsDock.tsx` | token 胶囊与上下文占用环 | —（props） | — |
| `overlays/` | `DialogHost.tsx` | 按 store 开合状态挂载弹窗 | `stream.loginPrompt`、`ui.settingsOpen`、`ui.sessionsOpen` | — |
| | `Toast.tsx` | 一次性提示，4 秒后自动清空 | `ui.notice` | `dismissNotice` |

## 座位模式：`ComposerSlot`（重点）

`ComposerSlot` 是"用表代替分支"的范例之一：

```tsx
interface SeatBranch {
  name: string;                        // 只用于辨认是哪条接管了输入区
  match(view: SeatView): boolean;      // 是否接管
  render(view: SeatView): ReactNode;   // 接管后渲染什么
}
const SEAT_BRANCHES: SeatBranch[] = [ /* confirmation, … */ ];
```

- 判定只读 `SeatView` 这一份快照（`pending` / `busy` / `onConfirm` / `onReject`）。**新增分支时只要能在这份输入上判定，就不必回主界面接线。**
- **顺序即优先级**：`SEAT_BRANCHES.find(...)` 取第一个命中项，更"强"的接管形态要排在前面。
- 全部未命中 → 渲染默认输入卡（`<Composer />`）。

两个必须保留的约束：

1. **接管卡片替换 `.composerSeat` 内部的内容，容器本身不换**。容器一旦被卸载重建，textarea 会丢失焦点与 IME 组合态；历史上首屏与活动态各渲染一次输入卡就踩过这个坑。
2. **`busy` 不参与接管判定**。写入确认只可能出现在工具执行期间（此时 `busy` 为真），拿 `busy` 当条件会让确认按钮永远不出现；它只用来禁用卡片上的动作按钮。

新增一种输入区接管形态（例如另一种待决定卡片）的步骤：

1. 在 `SeatView` 上加判定所需的字段（来自 store 的哪个切片要写清楚）；
2. 在 `SEAT_BRANCHES` 里加一项，`match` + `render` 成对写；
3. 完成。页面与 `ConversationView` 都不用动。

## 会话视图的边界（`ConversationView`）

它的边界是刻意的，改动前必须理解：

- **包含** `.body`：`.column` 的宽度由 `.body` 上的 `container-type: inline-size` 用 `100cqw` 算出（`styles/frame.css`），少了这个祖先，列宽与换行都会不同。
- **包含** `.scrollBody[data-phase]`：屏外优化选择器依赖完整祖先链 `.scrollBody[data-phase='active'] > .scroll > .column > .flowItem`。
- **不含** `.frame` 与 `.conversation`：它们还要容纳侧栏与会话头，由页面提供。
- **不含**输入区、弹窗、toast：那些是外壳职责，通过 `composer` 槽位注入。

三个槽位：`composer`（输入区）、`hero`（首屏引导，不传即始终 active）、`pendingEcho`（乐观回显气泡）。

## 性能约定（流式期间）

流式帧约每 40ms 一次，重渲染范围靠三点收窄：

1. `projectTurns(items)` 在 `ConversationView` 里用 `useMemo` 固定在 `items` 引用上——标量变化不会重算轮次；
2. `TurnView` 与 `MessageParts` 的各行都 `memo`，历史轮次的 props 引用不变即整体跳过；
3. 计时器（`.Clock`）与流式文本各自独立成组件，只有真正变化的那一块重渲染。

新增流式相关的显示块时，请沿用同样做法：**拆成独立组件 + `memo`，不要塞进已有的大组件**。
