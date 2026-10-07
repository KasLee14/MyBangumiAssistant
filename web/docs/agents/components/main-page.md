# 外壳组件（`components/mainPage/`）

## 简介

四组外壳组件的职责与数据来源，重点是 `ComposerSeat` 的座位分支表与会话容器的边界。

**不覆盖**：内容条目渲染（见 [content.md](content.md)）、弹窗自身的表单与关闭语义（见 [dialog.md](dialog.md)）。

上层：[readme.md](readme.md)。主界面**没有顶栏**（[C01](../../design/decisions/C01-app-top-bar.md) 删除，功能全部迁入侧栏）：外壳只有两列「**侧栏 \| 对话区**」，侧栏是唯一外壳，自上而下是品牌行（品牌 + 8px 连接状态点 + 折叠钮）→ 实心主色整行「开启新对话」→ 分组列表 → 底部用户行（头像 + 用户名 + 齿轮设置入口），收起态的两个胶囊（`CollapseBubbles`）绝对定位在 `.appFrame` 上、不参与 grid。`components/common/AppTopBar` 仍保留，但**只服务调试页与组件库文档页**。侧栏、座位与浮层**直接消费 store**（规则 B）；会话正文（`Stage` / `Turn` / `Streaming` / `MessageParts` / `ConfirmationCard`，以及过程区的 `ProcessGroup` / `ProcessRows` / `ProcessIcons` 与轮尾的 `TurnActions`）是 props 驱动的展示组件（规则 A）；其中有两处容易踩的契约——流式显示的 `pacedTail` / `hideAssistant` / `cursor` 三个 prop（收尾播放）与贴底跟随走 `ResizeObserver` 的性能约定，以及过程区的展开状态由 `openMap` 从 store 一路传进来（组件不读 store），见 §规则。

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

### 过程区与轮尾操作行的分工

一轮的呈现自上而下是**用户气泡 → 过程区（轮首控制行 + 过程行列表）→ 主体 → 轮尾操作行**，四个部分的职责与数据来源刻意分开（条目怎么分组见 [../utils/turns.md](../utils/turns.md)，文案与视觉表见 [../utils/process.md](../utils/process.md) 与 [../utils/toolViews.md](../utils/toolViews.md)）：

| 组件 | 渲染什么 | 数据来源 | 展开状态 |
|---|---|---|---|
| `ProcessGroup.tsx` 的 `TurnProcessBar` | 轮首控制行：状态 / 耗时 / 「N 步」计数 | `turn.meta`（宿主下发的轮次条目，可为 `null`）+ 由 `summarizeProcess` 汇总的 `turn.process` | 整轮过程的开合（`turnProcessKey`） |
| `ProcessGroup.tsx` 的 `ProcessGroup` | 过程行列表（折叠容器） | `turn.process` | 同上（与控制行是同一个开关） |
| `ProcessRows.tsx` 的 `ReasoningRow` / `ToolRow` / `ProcessRow` | 单个思考行 / 工具行（`ProcessRow` 按 `kind` 分发） | `ReasoningItemView` / `ToolItemView` | 单行开合（`processRowKey`） |
| `ProcessIcons.tsx` | 按工具族的 14px SVG、思考图标、chevron | 只吃 `family` / `className` | —（无状态） |
| `TurnActions.tsx` | 轮尾：复制本轮回答 + 每轮用量面板 | `turn`（自己从 `body` 里取最后一个助手条目的文本块） | 面板开合留在组件内 `useState` |

流式期的思考**不是**这套组件之外的另一套：`Streaming` 的 `ThinkingLive` 用一个合成条目（`id: -1`）喂同一个 `ReasoningRow`，所以思考行在流式期与历史期的形态一致（见 §规则「思考行在流式期与历史期共用同一个组件」）。

## 使用说明

- **加或改输入区接管形态之前先读 §规则**：`SEAT_BRANCHES` 是唯一改动点，顺序即优先级，`busy` 不参与判定；违反会让判定散落、优先级失控，或让确认按钮永远点不动。
- **只想查「某个外壳组件读写哪些 store 字段」「`Stage` 有哪些槽位与会话级 props」**：直接查 §索引 的「一览」与「`Stage` 的三个槽位与会话级 props」，不必通读 §规则。
- **改过程区（轮首控制行、思考行、工具行、折叠）或轮尾操作行之前先读 §规则** 的五条专属规则（一级折叠、`hidden="until-found"` 与 `beforematch`、`Turn` 的结构与 `openMap`（含默认开合）、思考行两阶段共用组件、轮尾只复制正文）；违反后果分别是不必要的两级折叠、Ctrl+F 搜不到内容、展开状态在流式帧里丢失或进行中的轮被误折起、思考行两阶段跳变、把内容块载荷与过程文本粘进剪贴板。
- **改工具行的呈现**：先读 [../utils/toolViews.md](../utils/toolViews.md)（六态记号与展开体判定）与 [../utils/process.md](../utils/process.md)（活动文案），再看 `ProcessRows.tsx`；**不要**在组件里另写工具名到标题的映射——那是宿主的表（`bangumi/src/web/tool-view.ts`）。
- **改 `Stage` 的结构或槽位之前**：先读 §规则「会话容器必须含 `.appStageBody` 与 `.appStageScroll`…」——边界与样式强耦合，改错会同时破坏容器查询与屏外优化。
- **怀疑流式卡顿（一顿一顿、一次冒几十字）**：先读 §规则「流式显示块独立成组件并 `memo`」与「贴底跟随由 `ResizeObserver` 观察 `.appStageFlow` 驱动，不每帧读 `scrollHeight`」，再动 `Turn` / `Streaming` / 贴底 effect——**不要**把 `items` / `liveContent` / `busy` 放回贴底 effect 的依赖数组。
- **想改流式区的显示条件（末尾光标、收尾播放期间显示哪一份正文）**：先读 §规则「收尾播放期间最后一轮必须让位，光标只在 `busy` 时渲染」。

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
- **包含** `.appStageBody` / `.appStageScroll[data-phase]` / `.appStageFlow` / `.appStageColumn`：屏外优化选择器依赖完整祖先链 `.appStageScroll[data-phase='active'] > .appStageFlow > .appStageColumn > .appTurn`。会话头已在 C34 决策中删除（组件、槽位与样式一并删除），对话区顶部留白由 `.appStageFlow` 的 20px 上内边距承担。
- **不含** `.appFrame` 与 `.appConversation`：`.appFrame` 是两列网格（`grid-template-areas: 'side main'`，只有 `side` / `main` 两格），`.appConversation` 只是 `main` 那一格，两者都由 `Shell` 提供。
- **不含**弹窗与 toast：那些是外壳职责，挂在 `Shell` 的同级；输入区通过 `composer` 槽位注入，谁放进槽位由 `Shell` 决定。

**违反后果**：容器查询与屏外优化同时失效。

### 贴底跟随由 `ResizeObserver` 观察 `.appStageFlow` 驱动，不每帧读 `scrollHeight`

贴底 effect 的依赖是 `[heroPhase, sessionId]`，观察对象是**内容容器** `.appStageFlow`（`flow` ref）。**不要**把 `items` / `liveContent` / `liveThinking` / `busy` 放回依赖数组——那等于每个流式帧读一次 `scrollHeight`。

理由：读 `scrollHeight` 是一次**强制同步布局**；`.appTurn` 带 `content-visibility: auto`，屏外轮次本应被跳过，但一读总高度就要求把它们全部真实布局，实测单次 52~286ms——正是它把均匀到达的流式帧在浏览器里攒成「一顿一顿、一次冒几十字」的爆发（诊断见 `artifacts/web-streaming-diagnosis-and-plan.md`）。`ResizeObserver` 的回调发生在布局之后，此时 `scrollHeight` 已是现成结果，不会再触发第二次布局；它同时天然表达了「屏外轮次的高度是分批算出来的」——高度每稳定一次就贴一次，取代原来「立即 + rAF + 120ms」的三连贴。观察的必须是内容容器而不是滚动容器：滚动容器自身尺寸不变，内容增高不会让它收到 resize 通知。切会话时重建观察并贴一次，避免新会话停在旧位置。

**违反后果**：长任务回到流式每一帧（改造前实测：每个 SSE 帧正文中位数 27 字符、每轮 24 个浏览器长任务、最长 286ms、同毫秒帧簇 104 个；改造后生产构建为 10 字符、0 个、3 个），观感直接退回「一顿一顿」。

### 流式显示块独立成组件并 `memo`

流式帧约每 16ms 一次（宿主 `server.ts` 的 `FLUSH_MS`；改造前该窗口是 40ms），重渲染范围靠三点收窄：

1. `projectTurns(items)` 在 `Stage` 里用 `useMemo` 固定在 `items` 引用上——标量变化不会重算轮次；
2. `Turn` 与 `MessageParts` 的各行都 `memo`，历史轮次的 props 引用不变即整体跳过；
3. 计时器（`Clock`）与流式正文（`LiveBlocks`）、思考块（`ThinkingBlock`）、状态行（`RunningRow`）都各自独立成 `memo` 组件，只有真正变化的那一块重渲染。

新增流式相关的显示块时，请沿用同样做法：**拆成独立组件 + `memo`，不要塞进已有的大组件**。

**违反后果**：每帧重渲染整棵会话树。

### 收尾播放期间最后一轮必须让位，光标只在 `busy` 时渲染

三个 prop 是同一件事的三个必要条件，缺一个就在屏幕上露馅：

- **`Stage` 的 `pacedTail`（必填）**：流式已经结束、但屏幕上的字还没播完（显示投影还在追赶 `pacedTarget`，见 [`store/pacing.ts`](../../../src/store/pacing.ts)）。`Stage` 只把它交给**最后一个** `Turn`：`hideAssistant={pacedTail && index === turns.length - 1}`——更早的轮次与流式区无关。
- **`Turn` 的 `hideAssistant?: boolean`（默认 `false`）**：为真时先从 `turn.body` 过滤掉 `kind === 'assistant'` 的条目再渲染。收尾期间宿主已经把这一轮的回答落成条目，而流式区还在逐字显示同一段正文，不隐藏就是屏幕上两份同样的回答。
- **`Streaming` 的 `cursor`（= `busy`）**：为假时**不渲染**末尾的流式光标行（`LiveBlocks` 的 `cursor: boolean`）。光标表达的是「这一轮还在写」，而收尾播放期间宿主那一轮已经结束。

**为什么能无缝交接**：位置不变、文本相同——流式区与历史条目走同一个 `MessageBlocks`（[AGENTS.md](../../../AGENTS.md) §规则 跨层强制约束第 5 条）。实测：流式结束时显示停在 36/200 字，随后按约 60 字/秒继续播完；期间最后一轮的助手正文被隐藏（`.assistantBody` 计数为 0），播完后条目接管（计数变 1）。

`Stage` 的另一个消费者 `page/debug/DebugPreview.tsx` 恒传 `pacedTail={false}`：调试页的逐字由它自己的受控播放驱动，不存在「历史条目与流式区同时显示同一段」的收尾阶段。

**违反后果**：删掉 `hideAssistant` 或把 `pacedTail` 恒传 `false` → 收尾期间屏幕上两份同样的回答；把光标条件改回只看「流式区还有内容」→ 已经结束的那一轮继续闪「还在写」。

### 过程区只有一级折叠：轮首控制行就是整轮过程的开关

`TurnProcessBar` 既是状态行（活跃时「正在搜索 · 关键词」）也是这一轮全部过程行的唯一开关，展开后就是 `ProcessGroup` 渲染的过程行列表——**不照搬 DSH 的两级折叠**（那里还有一层「折叠的折叠」）。理由是本项目的粒度不同：宿主按**用户回合**切分轮次（见 [../utils/turns.md](../utils/turns.md)），一轮只对应一个过程组，两级折叠在这里只是同一个开关的两种写法，多出来的一级只会让用户点两次才看到同一批内容。

控制行的标题按四种情况取（判据都在组件里，顺序即优先级）：

| 情况 | 标题 |
|---|---|
| `meta.status === 'aborted'` | 「已停止」（覆盖下面全部） |
| `meta.status === 'error'` | 「处理失败」（覆盖下面全部） |
| `running` | `liveProcessTitle(summary)`——「正在…」+ 细节，另在标题后补一句按族汇总 |
| 已结束且 `meta.endedAt > meta.startedAt` | 「已完成，用时 {formatDuration}」 |
| 其余（`meta` 为 `null`、或时间戳缺失） | `settledProcessTitle(summary)`——按族汇总 |

`running`（是不是最后一轮且 `busy`）由 `Stage` 传入，**不用 `meta.status === 'open'`**：轮次条目在流式期一直是 `open`，但界面上「还在写」的判据是宿主标量 `busy`，两处以同一处为准才不会出现「状态行停了、光标还在闪」。

**违反后果**：加出第二级折叠 → 用户点两次才看到同一批内容，且两个开关的状态会互相打架。

### 折叠统一用 `hidden="until-found"` + `beforematch`，Ctrl+F 能命中折叠内容

三个折叠容器（整轮过程的 `ProcessGroup`、思考行的 `reasoningBody`、工具行的 `processBody`）共用 `ProcessRows.tsx` 导出的 `useUntilFound(open, onReveal)`，它做两件事：

1. **维护 `hidden` 属性**：首帧给布尔 `hidden`（先藏住，避免折叠内容闪一下），挂载后换成 `hidden="until-found"`；`open` 为真时 `removeAttribute('hidden')`。**不能**直接写 JSX 的 `hidden="until-found"`：React 把 `hidden` 当布尔属性，传字符串只会写成 `hidden=""`，`until-found` 这个值会丢掉（正是它让浏览器愿意为「查找」而渲染折叠内容）。
2. **监听 `beforematch`**：浏览器 Ctrl+F 命中折叠内容时触发，此时调 `onReveal` 把容器**真的展开**（整轮命中就展开整轮）——于是「折叠」不等于「搜不到」，而用户看到的是「搜索跳到了这里，内容同时露出来」。

**违反后果**：改回条件渲染（`open && <div>…`）→ 折叠内容根本不进 DOM，Ctrl+F 静默搜不到；用 JSX 的 `hidden` 传字符串 → `until-found` 丢失，命中不了。

### `Turn` 的结构固定四段，过程开合状态由 `openMap` 从 store 传入

`Turn` 只做装配，顺序是固定的：**用户气泡 → 过程区（`process.length > 0` 才渲染）→ 主体（`body` 逐条交 `BodyItem`）→ 轮尾操作行**。两边各有一条容易改错的约束：

- `hideAssistant` 为真时**先从 `body` 里过滤掉 `assistant` 条目**再渲染（收尾播放的让位，见上一条），并且**不渲染 `TurnActions`**——否则操作行会随流式结束出现又消失；
- 过程区的开合由两个 prop 决定：`openMap: Record<string, boolean>`（键见 [../utils/process.md](../utils/process.md)）与 `onToggleProcess(key, open)`；`Turn` 自己不 `useState`。理由：内容组件不读 store（[AGENTS.md](../../../AGENTS.md) §规则 跨层强制约束第 1 条），而且这些状态要跨流式帧存活、并在会话切换轮次重建后仍能恢复（见 [../store/readme.md](../store/readme.md) §状态边界）。`Shell` 与 `DebugPreview` 都用 `useCallback` 固定回调引用——`Turn` 与 `ProcessGroup` 都是 `memo`，每次新建回调会让它们在流式帧里全部重渲染。

**默认开合**：`openMap[key]` 为 `undefined` 时走默认值「**进行中的轮展开、历史轮折叠**」（`running` 就是默认值）；一旦有记录值，**一律以用户的显式选择为准**——`false` 表示「用户主动折过」，不能被默认值覆盖，否则进行中的轮会被重新拉开。

**违反后果**：把开合状态放进组件 `useState` → 轮次在会话切换时整体重建，展开状态丢失；漏掉「`false` 是显式选择」这条 → 用户折起的进行中轮次每帧被重新展开。

### 思考行在流式期与历史期共用同一个组件

`Streaming` 的 `ThinkingLive` 用一个**合成条目**（`id: -1`、`state: 'running'`）喂同一个 `ReasoningRow`，而不是另写一套流式思考块。理由有两条：

- 流式期的思考还在标量 `liveThinking` 里（每帧都在长；提前落成条目会让同一事实有两个来源），合成条目只是「让它能进同一个组件」的适配层；
- 形态一致因此是结构保证的：思考行在流式期与历史期不会出现两种高度、两种折叠行为，这一轮结束后历史条目接管时也不跳变。

展开状态留在 `ThinkingLive` 自己的 `useState`（合成条目没有真实的条目 `id`，进不了 `ui.processOpen` 的键空间）。

**违反后果**：流式期与历史期各写一套思考块 → 落定那一刻的跳变（高度、缩进、折叠态）无从对齐。

### 轮尾操作行只复制回答正文，收尾播放期间让位

`TurnActions` 只做两件事：**复制本轮回答**与**每轮用量面板**。三条边界是刻意的：

1. **复制对象只是助手条目的文本块**（`assistantPlainText` 从后往前找最后一个有文本的 `assistant` 条目，只拼 `type === 'text'` 的块）：内容块载荷与过程文本不进剪贴板——粘出去的东西要能读；
2. **没有文本也没有用量时返回 `null`**：不给空轮渲染一排点不动的操作；有文本时 `data-actions-reveal="always"`，只有用量时是 `hover`（操作行平时不显形，指针进入这一轮才出现）；
3. **用量来自 `turn.meta.usage`（宿主下发的每轮合计），面板材质引共享类 `.appGlass`**：玻璃只有 `styles/common.css` 一处定义，`.usagePanel` 只补定位与几何；`hideAssistant` 期间整行不渲染（见上一条）。

分支（fork）与点赞/点踩**不做**：本项目没有分支能力，反馈也没有宿主端点——不要为了对齐 DSH 的界面而造一个没有后端的按钮。

**违反后果**：把过程文本或内容块载荷也复制进去，或给没有回答的轮次留下操作行（点了没反应）。

### 会话行的相对时间、四档分组与置顶走 [`../utils/relativeTime.ts`](../utils/relativeTime.md)

两处消费同一份实现：侧栏行右侧的时间（`relativeTimeLabel`）与 `/sessions` 弹窗的同一句话。分组标签（`sessionDayGroup`，现在是**今天 / 昨天 / 7 天内 / 更早**四档，只在侧栏用）也在这里，分组标题的固定顺序取自导出的 `SESSION_GROUP_ORDER`（`['置顶', '今天', '昨天', '7 天内', '更早']`）。「置顶」不是时间档：侧栏先按 `ui.pinned` 把置顶会话挑出去、放在最前，其余再按日历日归档；置顶组的行不显示时间（排序由用户决定）。

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
| §简介「过程区与轮尾操作行的分工」 | 找某个过程组件 / 轮尾操作组件的位置与数据来源时 |
| §规则「过程区只有一级折叠：轮首控制行就是整轮过程的开关」 | 改轮首控制行的标题、或想加第二级折叠时 |
| §规则「折叠统一用 `hidden="until-found"` + `beforematch`，Ctrl+F 能命中折叠内容」 | **改折叠机制、或遇到「Ctrl+F 搜不到折叠里的内容」时必读** |
| §规则「`Turn` 的结构固定四段，过程开合状态由 `openMap` 从 store 传入」 | **改 `Turn` 的结构、加过程行类型、或动展开状态存储时必读** |
| §规则「思考行在流式期与历史期共用同一个组件」 | 改流式思考块、或看到思考行两阶段形态不一致时 |
| §规则「轮尾操作行只复制回答正文，收尾播放期间让位」 | 改复制范围、用量面板或轮尾显隐时 |
| §规则「新增接管形态只改 `SEAT_BRANCHES`」 | **加或改输入区接管形态时必读**（唯一的改动点） |
| §规则「接管卡片替换 `.appSeat` 内部的内容，容器本身不换」 | 想重构座位容器、遇到 textarea 丢焦点时 |
| §规则「`busy` 既不参与接管判定，也不当确认按钮的禁用条件」 | 确认按钮点不动时 |
| §规则「会话容器必须含 `.appStageBody` 与 `.appStageScroll`，不含 `.appFrame` / `.appConversation`」 | **改 `Stage` 的结构或槽位前必读**（边界与样式强耦合） |
| §规则「贴底跟随由 `ResizeObserver` 观察 `.appStageFlow` 驱动，不每帧读 `scrollHeight`」 | **改贴底跟随、或遇到「一顿一顿、一次冒几十字」与长任务时必读** |
| §规则「流式显示块独立成组件并 `memo`」 | 加流式显示块、怀疑流式卡顿时 |
| §规则「收尾播放期间最后一轮必须让位，光标只在 `busy` 时渲染」 | 改流式区显示条件、收尾期间出现两份回答或光标不该闪时 |
| §规则「会话行的相对时间、四档分组与置顶走 `../utils/relativeTime.ts`」 | 改会话列表时间显示、分组或置顶时 |
| §规则「待授权卡只在输入区呈现一次」 | 正文和输入区重复显示同一个请求时 |
| §规则「新增一种输入区接管形态的步骤」 | 新增接管形态时逐步照做 |
| §索引「一览」 | 找某个外壳组件的位置，以及它读写哪些 store 字段 |
| §索引「`Stage` 的三个槽位与会话级 props」 | 给 `Stage` 增删槽位或改会话级 props（`sessionId` / `pacedTail` / `openMap` / 两个回调）、或想确认对话区顶部留白由谁给时 |

### 一览

| 子目录 | 文件 | 职责 | 读 store | 写 store |
|---|---|---|---|---|
| `shell/` | `Sidebar.tsx` | **唯一外壳**，自上而下：品牌行（品牌 `data-debug-toggle`，双击或回车/空格进调试页 + 8px 连接状态点 `.appSidebarStatus` + 折叠钮）+ 实心主色整行「开启新对话」（`.appSidebarNew`，侧栏唯一的主色实心操作）+ 分组列表（置顶 / 今天 / 昨天 / 7 天内 / 更早）+ 底部用户行（头像 + 用户名 + 齿轮设置入口 `.appIconButton`，**单击直达设置**——原「···」浮层菜单已按 [C45](../../design/decisions/C45-settings-entry.md) 定稿 B 删除）。行用共享基类 `.appNavRow`、逐项入场交给 `<Stagger>`；行 hover 时行尾的时间**换成**「···」按钮（`.appNavAction`）→ 置顶 / 取消置顶 | `catalog.sessions`、`stream.sessionId`、`stream.connected`、`stream.loginUsername`、`ui.collapsed`、`ui.switching`、`ui.pinned` | `toggleSidebar`、`newSession`、`resumeSession`、`togglePinned`、`openSettings(null)` |
| | `CollapseBubbles.tsx` | 收起态左上角的两个带文字胶囊（展开 / 新对话），绝对定位在 `.appFrame` 上（不参与 grid），只在收起态可见 | —（只取动作） | `toggleSidebar`、`newSession` |
| | `icons.tsx` | 外壳图标（`PanelIcon` / `EditIcon` / `GearIcon`），统一 16×16 显示 / 视觉线宽 1.4px / `currentColor`（`GearIcon` 画在 24 网格上，线宽写 2.1 折算） | — | — |
| `conversation/` | `Stage.tsx` | 滚动容器、轮次列表、流式区、轮次导轨、贴底跟随（`ResizeObserver` 观察 `.appStageFlow`，见 §规则）；`pacedTail` 期间把最后一个 `Turn` 的助手正文藏起来；过程区的开合状态（`openMap`）与两个回调由它透传给 `Turn` | —（props） | —（props） |
| | `Turn.tsx` | 一个轮次，固定四段：用户气泡 → 过程区（`TurnProcessBar` + `ProcessGroup`）→ 主体（`body` 逐条走 `BodyItem`）→ 轮尾 `TurnActions`；`hideAssistant`（可选，默认 `false`）为真时先过滤掉 `kind === 'assistant'` 的条目**并藏起操作行**；过程开合只读 `openMap` 并回调 `onToggleProcess` / `onToggleRow` | — | — |
| | `ProcessGroup.tsx` | `TurnProcessBar`（轮首控制行：状态 / 耗时 / 「N 步」，`reveal` 递增时强制展开）与 `ProcessGroup`（过程行列表，`hidden="until-found"` 折叠容器）；一轮只有一级折叠 | — | — |
| | `ProcessRows.tsx` | 过程区的两种原子行：`ReasoningRow`（思考）、`ToolRow`（工具，含子调用递归与结果体）、按 `kind` 分发的 `ProcessRow`；导出折叠容器 hook `useUntilFound` | — | — |
| | `ProcessIcons.tsx` | 过程区图标（14px / 线宽 1.4 / `currentColor`）：按工具族的 `ProcessIcon`、`ReasoningIcon`、`ChevronIcon` | — | — |
| | `TurnActions.tsx` | 轮尾操作行：复制本轮回答（只取助手条目的文本块）+ 每轮用量面板（`turn.meta.usage`）；没有文本也没有用量时不渲染 | — | — |
| | `Streaming.tsx` | 流式正文、思考行与运行状态行；`cursor`（= `busy`）为假时不渲染末尾的流式光标行；思考行用合成条目喂 **同一个** `ReasoningRow` | — | — |
| | `MessageParts.tsx` | 原子行（用户气泡/提示/错误/会话横幅 `SessionBanner`） | — | — |
| | `ConfirmationCard.tsx` | 写入预览卡；历史条目只显示结果、`answering` 恒为 `false` | — | — |
| | `Hero.tsx` | 首屏引导块（标题 + 说明 + 1 枚设置入口 `.appHeroSettings` + 3 枚玻璃示例 chip `.appGlass.appHeroSample`；**2026-10-10 起设置入口在说明与示例之间**、实心主色深档、与侧栏「开启新对话」同色）；点示例经 `onPick` 把文案交给 `Shell` 写进草稿，点设置经 `onOpenSettings` 开设置弹窗 | —（props） | —（props） |
| `composer/` | `ComposerSeat.tsx` | 输入区**座位**：决定此刻放输入卡还是接管卡 | `stream.pending`、`stream.answering`、`stream.sessionId` | `confirm`、`reject` |
| | `Composer.tsx` | 输入卡（卡内只留输入框与发送/停止）+ 命令弹窗；思考强度与读数在**卡外同一行** `.appComposerDock`；草稿按会话保存在 store | 流字段、`catalog.commands`、`ui.problem`、`ui.switching`、`ui.drafts`、`selectHeroPhase` | `optimisticSend`、`localCommand`、`stopRound`、`notice`、`dismissProblem`、草稿动作 |
| | `ThinkingPicker.tsx` | 思考强度菜单；由 `Composer` 渲染在 `.appComposerDock` 行里 | `stream.thinking` | `pickThinkingLevel` |
| | `StatsDock.tsx` | token 胶囊与上下文占用环；同样在 `.appComposerDock` 行里 | —（props） | — |
| `overlays/` | `DialogStage.tsx` | 按 store 开合状态挂载弹窗，并**自己管 presence**（关闭后先留场播退场动画，`Modal` 报 `onExited` 才卸载；不用 `AnimatePresence`） | `stream.loginPrompt`、`selectSettingsOpen`、`selectSessionsOpen` | — |
| | `Toast.tsx` | 一次性提示，4 秒后自动清空；进出过渡对称（`y 16` + `scale .98`，240ms，C42） | `selectNotice` | `dismissNotice` |
| `../common/`（跨三个入口共享的原语，样式在 `styles/common.css`） | `AppTopBar.tsx` | 顶栏骨架（`leading` / `brand` / `tabs` / `actions` 四个槽）；**只服务调试页与组件库文档页**（主界面没有顶栏） | —（props） | —（props） |
| | `Stagger.tsx` | 逐项错峰入场容器（55ms + spring，只给短列表） | —（props） | —（props） |
| | `Pill.tsx` | 胶囊表面原语；玻璃（`.appGlass`）与微标签（`.appMicroLabel`）只是 `styles/common.css` 里的共享类，不再各占一个组件文件 | —（props） | —（props） |

列表入场另有两条共享路径：滚动容器内的行走 `content.css` 的 `contentRowIn` keyframes；「滚进视口才浮现」走 `utils/revealOnScroll.ts` 的共享 `IntersectionObserver`（按滚动容器缓存、进入即 `unobserve`，全站只有这一个模块建观察器）。三条路径的时长 / 曲线 / 位移 / 错峰都取自同一批令牌，不要在每个列表里各写一份。

### `Stage` 的三个槽位与会话级 props

三个槽位：`composer`（输入区）、`hero`（首屏引导，不传即始终 active）、`pendingEcho`（乐观回显气泡）。`Stage` 只把 `hero` 折成一个稳定布尔 `heroPhase`（`pendingEcho` 与 `composer` 直接渲染），元素对象本身不进依赖数组。

会话级 props 另有两个，都由 `Shell` 从 store 取来：`sessionId`（变化时复位滚动位置与当前轮次高亮）与**必填**的 `pacedTail`（收尾播放，语义见 §规则「收尾播放期间最后一轮必须让位，光标只在 `busy` 时渲染」）。贴底 effect 的依赖只有 `[heroPhase, sessionId]`；原先进依赖数组的 `hasPendingEcho` 已随 `ResizeObserver` 改造删除。

过程区另有一组三个会话级 props，同样由 `Shell` 注入（调试页的 `DebugPreview` 用同一套）：`openMap`（`ui.processOpen` 的引用）与 `onToggleProcess` / `onToggleRow`（都是 `useCallback` 包过的同一个 dispatch 包装，只差键的形态）。它们**不参与**贴底 effect 的依赖——展开折叠改的是高度，由 `ResizeObserver` 那一层接住。
