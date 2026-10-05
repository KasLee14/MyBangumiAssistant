# 外壳组件（`components/mainPage/`）

## 简介

四组外壳组件的职责与数据来源，重点是 `ComposerSeat` 的座位分支表与会话容器的边界。

**不覆盖**：内容条目渲染（见 [content.md](content.md)）、弹窗自身的表单与关闭语义（见 [dialog.md](dialog.md)）。

上层：[readme.md](readme.md)。侧栏、顶栏、座位与浮层**直接消费 store**（规则 B）；会话正文（`Stage` / `Turn` / `Streaming` / `MessageParts` / `ConfirmationCard`）是 props 驱动的展示组件（规则 A）。

### `ComposerSeat` 是「用表代替分支」的范例

```tsx
interface SeatBranch {
  name: string;                        // 只用于辨认是哪条接管了输入区
  match(view: SeatView): boolean;      // 是否接管
  render(view: SeatView): ReactNode;   // 接管后渲染什么
}
const SEAT_BRANCHES: SeatBranch[] = [ /* confirmation, … */ ];
```

- 判定只读 `SeatView` 这一份快照（`pending` / `answering` / `onConfirm` / `onReject`）。**新增分支时只要能在这份输入上判定，就不必回主界面接线。**
- 接管卡是一段从下方推入的过渡（`motion.div.appCardSeat`），让"输入卡被替换成确认卡"看起来是一次接管，而不是一次跳变。
- 全部未命中 → 渲染默认输入卡（`<Composer key={sessionId} />`）；切换会话时重建输入卡，清理单次提交与补全状态，草稿仍由 `ui.drafts` 按会话保存。

### 历史列表与授权卡的呈现约定

历史列表使用 `session.id` 作为 key，并与 `stream.sessionId` 比较判断选中项；右侧优先显示「待确认 / 待登录 / 运行中 / 当前」，其余显示相对时间。`ConfirmationCard` 保留宿主的 `confirmLabel`，未提供时使用「确认授权」。

授权卡的可见标题来自宿主的 `confirmation.title`，无障碍标签固定为「操作授权」（`aria-label`），状态文案为「待授权 / 已授权 / 已取消 / 已过期」。宿主的 `preview` 仍是纯文本字符串，包含「需要进行的操作、使用账户、完整对象范围、是否授权」；组件用 `.planPreview` 普通正文呈现，保留换行，不解析字段或生成授权摘要。评分等只展示实际变化；长短评和简介保留最终正文，同名对象由宿主补充 ID，新目录依赖直接显示目录名称。相邻同目录添加按操作与目录 ID 合并摘要，逐作品仍保留不同的排序和评语；其他操作按已有规则分组，执行顺序与授权范围由宿主冻结。批次中间的 submitted/pending 仅表示已提交待核实，成功与实际状态由整批结束时的一次完整回读结算。

### 输入区自身的会话约定

草稿存 `ui.drafts[sessionId]`（提交失败时由 `draftRestored(sessionId, …)` 写回，且只在草稿仍为空时生效）；切换中（`ui.switching`）、宿主未就绪或断线时输入与发送一并禁用。

## 使用说明

- **加或改输入区接管形态之前先读 §规则**：`SEAT_BRANCHES` 是唯一改动点，顺序即优先级，`busy` 不参与判定；违反会让判定散落、优先级失控，或让确认按钮永远点不动。
- **只想查「某个外壳组件读写哪些 store 字段」「`Stage` 有哪些槽位」**：直接查 §索引 的「一览」与「`Stage` 的三个槽位」，不必通读 §规则。
- **改 `Stage` 的结构或槽位之前**：先读 §规则「会话容器必须含 `.appStageBody` 与 `.appStageScroll`…」——边界与样式强耦合，改错会同时破坏容器查询与屏外优化。
- **怀疑流式卡顿**：先读 §规则「流式显示块独立成组件并 `memo`」，再动 `Turn` / `Streaming`。

## 规则

### 新增接管形态只改 `SEAT_BRANCHES`

- **顺序即优先级**：`SEAT_BRANCHES.find(...)` 取第一个命中项，更"强"的接管形态要排在前面。

**违反后果**：判定散落、优先级失控。

### 接管卡片替换 `.appSeat` 内部的内容，容器本身不换

容器一旦被卸载重建，textarea 会丢失焦点与 IME 组合态；历史上首屏与活动态各渲染一次输入卡就踩过这个坑。

**违反后果**：textarea 丢失焦点与 IME 组合态。

### `busy` 既不参与接管判定，也不当确认按钮的禁用条件

写入确认只可能出现在工具执行期间（此时 `busy` 为真），拿 `busy` 当禁用条件会让按钮永远点不动；卡片按钮禁用只看 `answering === pending.id`（本条确认的应答在途，防重复提交）。

**违反后果**：确认按钮永远点不动。

### 会话容器必须含 `.appStageBody` 与 `.appStageScroll`，不含 `.appFrame` / `.appConversation`

它的边界是刻意的，改动前必须理解：

- **根节点是 `.appStage`**：`container-type: inline-size` 写在这里，`.appStageColumn` 的宽度由 `100cqw` 算出（`styles/frame.css`），少了这个祖先，列宽与换行都会不同。
- **包含** `.appStageBody` / `.appStageScroll[data-phase]` / `.appStageFlow` / `.appStageColumn`：屏外优化选择器依赖完整祖先链 `.appStageScroll[data-phase='active'] > .appStageFlow > .appStageColumn > .appTurn`。
- **不含** `.appFrame` 与 `.appConversation`：它们还要容纳侧栏与会话头，由 `Shell` 提供。
- **不含**弹窗与 toast：那些是外壳职责，挂在 `Shell` 的同级；输入区通过 `composer` 槽位注入，谁放进槽位由 `Shell` 决定。

**违反后果**：容器查询与屏外优化同时失效。

### 流式显示块独立成组件并 `memo`

流式帧约每 40ms 一次，重渲染范围靠三点收窄：

1. `projectTurns(items)` 在 `Stage` 里用 `useMemo` 固定在 `items` 引用上——标量变化不会重算轮次；
2. `Turn` 与 `MessageParts` 的各行都 `memo`，历史轮次的 props 引用不变即整体跳过；
3. 计时器（`Clock`）与流式正文（`LiveText`）、思考块（`ThinkingBlock`）、状态行（`RunningRow`）都各自独立成 `memo` 组件，只有真正变化的那一块重渲染。

新增流式相关的显示块时，请沿用同样做法：**拆成独立组件 + `memo`，不要塞进已有的大组件**。

**违反后果**：每帧重渲染整棵会话树。

### 会话行右侧的时间文案走 [`../utils/relativeTime.ts`](../utils/relativeTime.md)

**违反后果**：侧栏与 `/sessions` 弹窗各算一份，两处措辞漂移（`now` 由组件注入一次，不让每行自己取时钟）。

### 待授权卡只在输入区呈现一次

`ConfirmationCard` 的历史模式（`showActions=false`）在 `state=pending` 时返回 `null`，处理完成后才展示结果。宿主仍保留同一条授权记录，避免正文和输入区重复显示同一个请求。

### 新增一种输入区接管形态的步骤

新增一种输入区接管形态（例如另一种待决定卡片）的步骤：

1. 在 `SeatView` 上加判定所需的字段（来自 store 的哪个切片要写清楚）；
2. 在 `SEAT_BRANCHES` 里加一项，`match` + `render` 成对写；
3. 完成。页面与 `Stage` 都不用动。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「`ComposerSeat` 是「用表代替分支」的范例」 | 找座位分支表的结构、改默认输入卡时 |
| §简介「历史列表与授权卡的呈现约定」 | 改会话列表右侧状态、授权卡文案与预览呈现时 |
| §简介「输入区自身的会话约定」 | 改草稿保存、输入禁用条件时 |
| §规则「新增接管形态只改 `SEAT_BRANCHES`」 | **加或改输入区接管形态时必读**（唯一的改动点） |
| §规则「接管卡片替换 `.appSeat` 内部的内容，容器本身不换」 | 想重构座位容器、遇到 textarea 丢焦点时 |
| §规则「`busy` 既不参与接管判定，也不当确认按钮的禁用条件」 | 确认按钮点不动时 |
| §规则「会话容器必须含 `.appStageBody` 与 `.appStageScroll`，不含 `.appFrame` / `.appConversation`」 | **改 `Stage` 的结构或槽位前必读**（边界与样式强耦合） |
| §规则「流式显示块独立成组件并 `memo`」 | 加流式显示块、怀疑流式卡顿时 |
| §规则「会话行右侧的时间文案走 `../utils/relativeTime.ts`」 | 改会话列表时间显示时 |
| §规则「待授权卡只在输入区呈现一次」 | 正文和输入区重复显示同一个请求时 |
| §规则「新增一种输入区接管形态的步骤」 | 新增接管形态时逐步照做 |
| §索引「一览」 | 找某个外壳组件的位置，以及它读写哪些 store 字段 |

### 一览

| 子目录 | 文件 | 职责 | 读 store | 写 store |
|---|---|---|---|---|
| `shell/` | `Sidebar.tsx` | 折叠按钮、新建会话、历史会话列表（右侧为后台状态或最后对话时间）；品牌行交给 `SidebarBrand` | `ui.collapsed`、`catalog.sessions`、`stream.sessionId` | `toggleSidebar`、`newSession`、`resumeSession` |
| | `SidebarBrand.tsx` | 品牌行（`.appLogoRow` 里的 `.appBrand` + 右侧控件）；双击品牌区切换页面——主界面传 `enterDebug`、调试页传 `exitDebug` | —（props） | —（props） |
| | `Header.tsx` | 标题行、当前栏、连接状态 chip、设置入口 | `stream.connected` | `openSettings(null)` |
| `conversation/` | `Stage.tsx` | 滚动容器、轮次列表、流式区、轮次导轨、贴底跟随 | —（props） | —（props） |
| | `Turn.tsx` | 一个轮次：用户气泡 + 过程折叠块 + 主体条目 | — | — |
| | `Streaming.tsx` | 流式正文、思考块与运行状态行 | — | — |
| | `MessageParts.tsx` | 原子行（用户气泡/提示/错误/会话头） | — | — |
| | `ConfirmationCard.tsx` | 写入预览卡；历史条目只显示结果、`answering` 恒为 `false` | — | — |
| | `Hero.tsx` | 首屏引导块（无 props 的纯展示） | — | — |
| `composer/` | `ComposerSeat.tsx` | 输入区**座位**：决定此刻放输入卡还是接管卡 | `stream.pending`、`stream.answering`、`stream.sessionId` | `confirm`、`reject` |
| | `Composer.tsx` | 输入卡 + 命令弹窗；草稿按会话保存在 store | 流字段、`catalog.commands`、`ui.problem`、`ui.switching`、`ui.drafts`、`selectHeroPhase` | `optimisticSend`、`localCommand`、`stopRound`、`notice`、`dismissProblem`、草稿动作 |
| | `ThinkingPicker.tsx` | 思考强度菜单 | `stream.thinking` | `pickThinkingLevel` |
| | `StatsDock.tsx` | token 胶囊与上下文占用环 | —（props） | — |
| `overlays/` | `DialogStage.tsx` | 用 `AnimatePresence` 按 store 开合状态挂载弹窗（进出都有过渡） | `stream.loginPrompt`、`selectSettingsOpen`、`selectSessionsOpen` | — |
| | `Toast.tsx` | 一次性提示，4 秒后自动清空 | `selectNotice` | `dismissNotice` |

### `Stage` 的三个槽位

三个槽位：`composer`（输入区）、`hero`（首屏引导，不传即始终 active）、`pendingEcho`（乐观回显气泡）。`Stage` 只把它们当作"有没有"来用（`heroPhase` / `hasPendingEcho` 两个稳定布尔），元素对象本身不进贴底副作用的依赖数组。
