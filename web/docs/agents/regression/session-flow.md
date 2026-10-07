# 会话主链路用例（`S`）

## 使用说明

### 这份文档是什么

会话主链路（`S1`–`S19`）的用例：提交与乐观回显、流式渲染与逐字摊平、过程区（轮首控制行 / 思考行 / 工具行）、写入确认、会话切换、轮次导轨、失败回滚、内容条目与批次反馈、轮尾操作行。

前提与判定约定见 [readme.md](readme.md)。标注「需模型」的用例要求模型列表非空。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `S1`（提交与乐观回显）、`S9`（失败回滚） | 动输入区提交、乐观回显或错误回滚时（**不需模型**） |
| `S2`（流式渲染与落条目） | 动流式显示块、Markdown 渲染、条目落盘时（需模型） |
| `S3`–`S4`（过程区与 `/details`） | 动轮首控制行、思考行、工具行、过程折叠或轮次投影时（需模型） |
| `S5`–`S6`（写入确认与 Esc 拒绝） | **动接管逻辑、确认卡或 Esc 行为时必读**（需模型） |
| `S7`（会话切换）、`S8`（轮次导轨） | 动会话切换、条目整表替换或导轨时（不需模型） |
| `S10`（内容条目与降级） | 动内容组件库或校验降级时（需模型或含内容条目的历史会话） |
| `S11`（批次容错反馈） | 动批次投影、工具行状态、额度等待时（离线可验证展示） |
| `S13`（流式逐字与收尾播放） | 动流式正文的摊平与显示条件（`pacedTarget` / `pacedTail` / `hideAssistant` / 末尾光标）或贴底跟随时（需模型） |
| `S14`（思考历史化）、`S15`（工具结构化） | 动思考条目、工具条目的投影或结构化结果时（`S15` 离线走调试页） |
| `S16`（轮控制行的耗时与计数）、`S17`（轮尾复制与用量） | 动轮次元数据、轮尾操作行或每轮用量时（`S16` 可离线，`S17` 的复制建议需模型） |
| `S18`（折叠内容的 Ctrl+F 可发现性） | **改折叠机制（`hidden="until-found"`）时必读**（离线可跑） |
| `S19`（历史会话回溯） | 改宿主 `rebuild()` 的投影、或验证改造前产生的旧会话能否还原过程区时（不需模型，需一段旧会话） |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **「需模型」用例不得用构造数据替代** —— 违反后果：流式与工具链路实际未被验证（见本组「标注需模型的用例不得用假数据替代判定」）。
2. **判定表达式要在同一状态下读取**（"流式中"与"完成后"是两个状态）—— 违反后果：结论自相矛盾。

## S1 首屏提交与乐观回显（不需模型）

**前置**：刚打开页面，会话为空且空闲。

**步骤**
1. 在输入框输入 `测试文本`；
2. 按 Enter。

**预期**
- 输入框立刻清空（不等宿主返回）；
- 会话区出现一条用户气泡，气泡文本为 `测试文本`（这是乐观回显）；
- 会话由首屏 hero 阶段切到活动阶段（`.appStage[data-phase]` 由 `hero` 变 `active`）；
- 按钮变为「停止本轮」（`busy` 为真）。

**判定**
```js
document.querySelector('#composer-input').value === ''                       // 草稿已清空
document.querySelector('.appStage').dataset.phase === 'active'                // 已离开首屏
!!document.querySelector('.userRow .bubble')                                  // 出现气泡
```

## S2 流式渲染与落条目（需模型）

**前置**：模型可用。

**步骤**：发送一句会得到较长回答的问题（例如"介绍一下攻壳机动队"）。

**预期**
- 正文逐段出现（流式），伴随 `.running` 状态行与"已运行 N 秒"计时；
- 生成中出现思考折叠块（若该模型返回思考内容）；
- 若回答里含内容块（`StatsCard` / `DataTable` 这类），流式期与落成历史条目后**块的数量与顺序一致**；已渲染的内容块不因后续文本继续增长而重播入场动画（结构共享生效）；
- 完成后流式区清空，同一条内容变为历史条目（`Turn` 里的 `.assistantRow`）；
- 状态行消失，发送按钮恢复可用。

**判定**
```js
// 流式中
document.querySelectorAll('.appTurn').length > 0 && !!document.querySelector('.running')
// 完成后
!document.querySelector('.running')
```

## S3 过程区：轮首控制行与工具行（需模型）

**步骤**：发送一句需要调用 Bangumi 工具的问题（例如"搜索进击的巨人"）。

**预期**
- 该轮出现轮首控制行 `.processBar`，右侧固定显示「N 步」（`N` = 该轮过程项数）；
- **进行中的轮默认展开**（`data-open="true"`），结束后自动收起（可手动再展开）；
- 展开后是过程行列表 `.processGroupBody`：思考行 `.reasoningRow`、工具行 `.toolRow`（标题是宿主给的中文名，例如「搜索作品」，其后跟参数摘要）；
- 工具行右侧是状态记号（记号 `aria-hidden`，中文状态在 `.visuallyHidden` 里）：进行中 `·`、额度等待 `…`、完成 `✓`、未全部完成 `!`、结果待核实 `?`、失败 `×`（状态表见 [../utils/toolViews.md](../utils/toolViews.md)）；
- 轮次封口后，控制行标题从「正在…」变成「已完成，用时 N 秒」（`/details` 之外不需要手动操作）。

**判定**
```js
const bar = document.querySelector('.processBar');
bar?.dataset.open                                  // 进行中为 'true'，结束后为 'false'
bar?.dataset.state                                 // 'running' | 'ok' | 'aborted' | 'error'
document.querySelector('.processBarCount')?.textContent              // 'N 步'
document.querySelectorAll('.processRowTitle').length > 0
[...document.querySelectorAll('.toolRow')].map(r => r.dataset.state) // 六态之一
```

## S4 `/details` 展开过程（需模型）

**步骤**：等上一轮结束（过程已收起），输入 `/details` 回车。

**预期**：当前会话内**所有**轮的轮首控制行被强制展开；再次执行仍展开（`ui.reveal` 递增，`TurnProcessBar` 的 `reveal` 是「递增即展开」，不做开关切换）。

**判定**
```js
[...document.querySelectorAll('.processBar')].every(b => b.dataset.open === 'true')
```

## S5 写入确认卡与两种决定（需模型）

**步骤**：发送一句按现有规则需要确认的请求（例如"把作品甲和作品乙的评分都改为 8 分"，或发布/修改作品短评），等授权卡出现。普通单项修改与所有章节状态操作免确认；它们不能用于触发本用例的授权卡。

**预期**
- 输入区被**接管**：`.appSeat` 内出现 `.appCardSeat > .planCard`，输入框消失；
- 待授权时全页只有一张 `data-state="pending"` 的授权卡，位于输入区；会话正文暂不显示同一条待授权记录。确认或取消后，该记录才在正文出现，输入区撤下操作卡；
- 卡片显示状态「待授权」、标题「操作授权」、普通正文格式的操作说明与完整对象范围（保留换行）；正文包含「请确认是否授权本次操作」；
- `.planPreview` 是普通文本容器，字号与正文一致；批量评分只列评分变化，不重复显示未改变的收藏、短评、标签、进度等字段；短评和简介显示完整最终正文，同名对象可区分；
- **两个按钮可点**（`disabled` 为 `false`）。待确认必然发生在本轮进行中（`busy` 为真），所以这里**不能**用 `busy` 当禁用条件——历史 bug 就是由此导致按钮恒灰；
- 点下后到宿主返回结论之前，两个按钮**短暂禁用**（防重复提交），卡片被替换或结论下发后即解除；
- 点「确认授权」→ 提交后卡片状态变为已授权/已过期，输入区恢复输入卡；
- 另起一轮点「取消」→ 状态为「已取消」；
- **历史条目里的确认卡不再有动作按钮**（只显示结果）。

**判定**
```js
document.querySelector('.appCardSeat .planCard')?.dataset.state      // 'pending' → 'accepted' | 'rejected'
// 待确认时按钮可点：
[...document.querySelectorAll('.appCardSeat .planActions button')].every(b => !b.disabled)   // true
// 点下后、结论到达前（窗口很短，需要立即求值）：
[...document.querySelectorAll('.appCardSeat .planActions button')].every(b => b.disabled)    // true
// 接管时输入框不在：
!document.querySelector('#composer-input')
// 恢复后：
!!document.querySelector('#composer-input')
```

## S6 Esc 拒绝待确认的写入（需模型）

**前置**：确认卡处于 `pending`（输入区被接管）。

**步骤**：按 Esc（焦点不在弹窗或思考菜单里）。

**预期**：等价于点「取消」——只拒绝这次写入，**不中止整轮**（Esc 的优先级是「有待确认 → 拒绝」，`busy` 判定排在它后面）；本轮随后继续/结束，输入区恢复。

**判定**：卡片 `data-state` 变为 `rejected` 或 `expired`，`#composer-input` 重新出现；本轮不被中断（过程块与后续输出照常收尾，不出现「本轮已停止」提示）。

## S7 会话切换（新建与恢复，不需模型）

**步骤**
1. 在**侧栏**点「开启新对话」（`.appSidebarNew`，实心主色整行、侧栏唯一的主色实心操作）；
2. 再点侧栏里另一条历史会话行（`.appNavRow`）。

**预期**
- 新建后：会话区清空、回到首屏 hero 阶段（若空闲）、条目列表整体替换；
- 恢复后：历史条目出现，滚动位置在底部；轮次高亮复位；
- 侧栏品牌行的连接状态点保持 `data-state="on"`（切换不重建 SSE；主界面已无顶栏）。
- 切换不取消旧会话任务；后台会话状态仍在历史列表更新。切回后恢复该会话的草稿、工具活动与待确认卡；旧会话迟到帧不能把当前视图切回去。

**判定**
```js
document.querySelectorAll('.appTurn').length       // 新建后为 0；恢复后 > 0
document.querySelector('.appSidebarStatus')?.dataset.state   // 'on'
document.querySelector('.appStage').dataset.phase  // 新建且空闲时为 'hero'
```

## S8 轮次导轨（需 2 轮以上历史）

**前置**：当前会话至少 2 个含用户消息的轮次。

**步骤**
1. 观察会话区右侧导轨；
2. 点第 1 个轨道点。

**预期**：导轨出现（`railTurns.length >= 2` 才渲染）；点击后滚到对应轮次并把该点标记为 active；只有 1 轮时导轨不存在。

**判定**
```js
const rail = document.querySelector('.appRail');
rail ? rail.querySelectorAll('button').length : 0      // 与含 user 的轮次数一致
[...document.querySelectorAll('.appRail button')].filter(b => b.dataset.active === 'true').length  // 恰好 1
```

## S9 提交失败时草稿回滚（不需模型）

**前置**：构造一个会失败的提交。最省事的办法：把宿主的 `/api/submit` 置为失败（或停掉宿主后提交），也可以在无可用模型时提交普通文本（宿主会回错误）。

**步骤**
1. 输入 `回滚测试`；
2. 回车；
3. 等错误提示出现。

**预期**
- 出现全局提示（toast）说明失败原因；
- **草稿回到输入框**（且仅在草稿仍为空时回滚，不会覆盖期间的新输入）；
- 乐观回显气泡被撤下（若已出现）。

**判定**
```js
document.querySelector('#composer-input').value === '回滚测试'
!!document.querySelector('.appToast')
```

## S10 内容块渲染与降级（离线可跑，走调试页）

内容块是助手消息 `content` 数组里的一项（见 [../components/content.md](../components/content.md)）。它不由模型产生，来源只有两条：**调试页手粘的 event / frame**，与**扩展注入的 custom 消息**（落盘为 `custom_message`，重建时投影成只含一个块的条目）。

**步骤**
1. 打开调试页（**双击主界面侧栏顶部的品牌行** `.appBrandAction.appSidebarBrand`，或 URL 带 `#debug`；调试页顶栏的「组件库」链接通向文档页 `library.html`，不是进调试页的入口）；
2. event 输入框粘一条 `message_end`：`message.role` 为 `assistant`、`message.content` 里含一个内容块（例如 `{ "type":"stats", "props":{…} }`），点「预览」；
3. 把该块的载荷改成非法形态（例如 `stats.entries` 给成字符串）再粘一次；
4. 粘一个未登记的块 `type`（例如 `{ "type":"nope" }`）；
5. 另粘一条 custom 消息（`{ "type":"message_end", "message":{ "role":"custom", "customType":"infobox", "display":true, "details":{ …裸载荷… } } }`）。

**预期**
- 第 2 步：内容块按 `type` 渲染成对应组件（统计卡、表格、标签云…），样式正常（品牌配色、无溢出）；数组超限时被**截断**而不是撑爆布局；
- 第 3 步：渲染**降级块**（素面 + 左侧 2px 短条；问题清单 + 可折叠原始 JSON），而不是白屏或抛错；
- 第 4 步：该块被丢弃，Console 出现一次 `[content] 未登记的内容块 type「nope」`，同一条里的其它块仍正常渲染；
- 第 5 步：渲染成一个内容块（`origin: 'extension'` 的单块条目），与重构前的外观一致。

**判定**
```js
document.querySelectorAll('[class^="content"], [class*=" content"]').length > 0
!document.querySelector('.contentFallback')      // 数据合法时不应出现降级块
// 降级块的原始数据可折叠展开：
document.querySelector('.contentFallback details')?.open
```

## S11 批次部分完成与额度等待（离线展示，不证明真实账户）

运行 `node --test test/web-write-activity.test.mjs`（先统一构建）：它以离线工具通过真实 Pi 事件 /
Web SSE 验证进度与历史投影。
（**曾经的第二个文件 `test/web-ui-variants.test.mjs` 已随 v2 外观版本一起删除**——现在只有一套外壳，
没有「两版 DOM」可验。）

预期：原步骤编号与跳过对象保留，`blockedBy` 显示前序依赖；成功、跳过、依赖阻塞分别计数；
`partial` 行为“未全部完成”，`unknown` 行为“结果待核实”，不把全部行画成失败或完成；
成功批次也显示已核实数量，缺口换行可读。额度等待展示类别、恢复时间与 Esc 停止提示，
`submitted` 始终是已提交待核实。恢复历史保留最终批次反馈。

**界面落点（改造后）**：这些文案现在挂在 `execute_write_batch` 的**工具行**上——`.toolRow[data-family="batch"]`，标题「执行修改计划」，批次报文的 `showDetail` 为真时行下方直接显示 `.toolInlineText`（最多 6 行，超出标注「还有 N 行」），状态进六态（`waiting` 的记号是 `…`）。原 `.activityRow` 那套一行文字已删除（见 [../components/readme.md](../components/readme.md) §规则 第 7 条）。

**判定**
```js
const row = document.querySelector('.toolRow[data-family="batch"]');
row?.dataset.state                                  // 'running' | 'waiting' | 'ok' | 'partial' | 'unknown' | 'error'
row?.querySelector('.toolInlineText')?.textContent  // 批次计数 + 缺口（成功时也有）
```

真实账户验收仍须另外执行已授权的混合批次，并核对网站最终状态；离线用例不能替代该证据。

2026-10-04 离线记录：统一构建后运行当时的那两个文件及 `web-sessions.test.mjs`，共 17 项通过、0 项跳过。
Chromium 实测部分完成/未知/成功计数、换行与等待文案；Pi 回调→Web/SSE 与历史重建通过本地 fixture 验证。
未运行真实模型或 Bangumi 账户写入。**（当轮记录的「两版 DOM」与「外观切换不重连 SSE」两项随 v2 作废。）**

## S12 内容块的骨架与落定（离线可跑，走调试页）

这是「内容块」重构的核心行为：文本块流式增长 → 内容块以 `pending` 出现并渲染**骨架** → `pending` 消失后渲染真实数据 → 后续文本块继续流式 → `message_end` 后整批原样落成历史条目。

**步骤**
1. 打开调试页，**依次**点左侧样例的「7 内容块（骨架）」与「8 组件块（落定与续写）」，每次点完按「预览」；
2. 先看 7 的结果（文本 + 骨架），再点 8（骨架被真实数据替换、续写文本、落成历史条目）。

**为什么分两次**：调试页把 event **数组按 flush 语义合并成一帧**（那是宿主 16ms 窗口的真实行为），一次喂完整条链路就看不到「骨架 → 真实数据」那一跳。分两次喂时模拟器状态是累积的，合起来仍是完整链路。想逐帧看，也可以把单条 event 逐条粘进去。

**预期**
- 文本块逐字出现，末尾有流式光标；
- 第二项出现时渲染**骨架**：不是降级块、不是空白、Console 无 error / warn（此时载荷故意不完整，**不得**走校验降级）；
- `pending` 消失的那一帧，骨架被真实的统计卡替换；文本与光标保持不动；
- 第三个文本块继续逐字出现；
- `message_end` 后流式区清空，上述三块**原样**落成一个历史 assistant 条目：顺序、内容与流式期一致，无跳变。

**判定**
```js
// 播放过程中（骨架阶段）
!!document.querySelector('.contentSkeleton')
// 落定后：历史条目里仍有内容块，且流式区已清空
!!document.querySelector('.assistantRow [class*="content"]') && !document.querySelector('.appStreaming')
```

## S13 流式逐字与收尾播放（需模型）

这条验的是「看着像逐字」那套显示链路：上游以**突发批次**下发正文（一批 10~90 字符、间隔 20~190ms），屏幕上的那一份由 [store/pacing.ts](../../../src/store/pacing.ts) 按**时间**摊平（每 16.7ms 一个字，约 60 字/秒）；流式结束那一帧权威正文被清空，但屏幕上的字还没播完——这段**收尾播放**里由历史条目让位给流式区，播完再交回。

**前置**：模型可用；**判定必须用生产构建**（`npm run build:web` 的产物 + `npm run web`），不要用 `dev:web`——逐字速率与长任务这类读数只在生产构建下可比（dev 下是未压缩、带开发期检查的代码），且 Windows 上编辑工具的保存方式会让 Vite watcher 漏检、dev server 继续提供旧模块（见 [readme.md](readme.md) 规则 5）。页面要保持可见且在前台：摊平推进用 `requestAnimationFrame`，后台标签页会停摆。

**步骤**
1. 在 `bangumi/` 下执行 `npm run build:web`，再用 `npm run web` 起宿主（用构建产物、无 HMR；`--no-open` 只打印带一次性令牌的地址）；
2. 打开该地址，发一句会得到**较长回答**的问题（例如"介绍一下攻壳机动队"，目标 500 字以上）；
3. 流式期间在 Console 连读两次 `.appStreamingBody` 的文本长度，间隔 1 秒；
4. 盯住回答写完那一刻（`.running` 消失），核对屏幕上只剩流式区那一份正文、末尾光标已撤；
5. 等剩下的字播完，核对交接。

**预期**
- **每约 1 秒约 60 字**：两次读数之差落在 40~80 之间；正文是逐字长出来的，不是"停一下、一次冒十几个字"。正文字符数会略微偏大，因为末尾光标行占 1 个字符；
- **流式结束后继续播完**：`.running` 已消失（宿主那一轮结束）而流式区仍在，剩下的字继续按同样速度播完。实测一次收尾是从 36/200 字接着播（尾巴 164 字，约 2.7 秒）；而 500 字的回答因为上游快、屏幕慢，写完那一刻积压最大，还要再播**约 6~7 秒**（上游正文实测约 330 字符/秒，是逐字速度的五倍多，所以显示必然滞后于真实内容；这是"看着像逐字"的必然代价，不是可以优化掉的开销）；
- **期间历史条目不重复显示助手正文**：这一轮已经落成条目，但最后一轮 `.appTurn` 里的助手正文被隐藏（`hideAssistant`），屏幕上只有流式区那一份；
- **播完无缝交接**：流式区清空、历史条目的助手正文接管，位置与文本都不变、无跳变，光标不再出现。

**为什么需要它**：这条链路上两个行为都"看起来可以顺手优化"，而优化掉任何一个都只会让界面更糟——

- **摊平（显示投影）**：把权威值 `stream.liveContent` 直接交给 `Stage` 是最自然的"简化"，但上游是突发批次，屏上立刻退回"一顿一顿、一次冒几十字"（改造前实测：每个 SSE 帧正文中位数 27 字符、每轮 24 个浏览器长任务、最长 286ms、同毫秒帧簇 104 个；改造后生产构建为 10 字符、0 个、3 个）；反过来，把贴底跟随改回由数据驱动、每帧读一次 `scrollHeight` 也会把长任务带回来——`.appTurn` 带 `content-visibility: auto`，读总高度会强制把屏外轮次全部真实布局，实测单次 52~286ms。
- **收尾让位（`pacedTail` / `hideAssistant` / `cursor`）**：删掉 `hideAssistant`、把 `pacedTail` 写死成 `false`，或让光标只看"流式区还有内容"——前两者会让收尾期间屏幕上同时出现两份同样的回答（同一段正文经同一个 `MessageBlocks` 渲染两次），后者会让已经结束的那一轮继续闪"还在写"。三处单看都像冗余，实际是同一件事的三个必要条件。

**判定**
```js
// 逐字速度（流式期间连读两次，间隔 1 秒）
const len = () => document.querySelector('.appStreamingBody')?.textContent?.length ?? 0;
const t0 = len(); await new Promise(r => setTimeout(r, 1000));
const delta = len() - t0;            // 预期 40~80（约 60 字/秒）
// Console 不允许顶层 await 时改用回调版，看打印出来的「每秒增字」：
// (() => { const l = () => document.querySelector('.appStreamingBody')?.textContent?.length ?? 0;
//   const a = l(); setTimeout(() => console.log('每秒增字', l() - a), 1000); })()

// 收尾播放中（本轮已结束、流式区还在）：
!!document.querySelector('.appStreamingBody')
&& !document.querySelector('.running')                                                  // 本轮已结束
&& document.querySelectorAll('.appStreamingCursorRow').length === 0                     // 光标已撤
&& document.querySelectorAll('.appStageColumn > .appTurn:last-of-type .assistantBody').length === 0   // 条目让位

// 播完后（流式区清空、条目接管）：
!document.querySelector('.appStreamingBody')
&& document.querySelectorAll('.appStageColumn > .appTurn:last-of-type .assistantBody').length === 1
```

**备注**：`.assistantBody` 的计数要按**最后一轮**取（上面的选择器就是这么写的）——多轮会话里更早的轮次会让全局计数不为 0。另外，`2026-10-07` 那轮改造的实测数据（59.5 字/秒、收尾播完 164 字、收尾期 `.assistantBody` 计数为 0）是在注入模拟帧下取得的，当时几次真实提交恰好都落在"模型只输出思考、正文为空"的情形，因此本用例同时也是**真实 SSE 帧下端到端一轮**的首次验证；跑通过后按 §记录模板 补一条记录。有意为之、不要当 bug 的两点：思考文本不摊平（思考动辄上千字，逐字播要几十秒），摊平按经过的毫秒数折算、与显示器刷新率解耦。

## S14 思考的历史化（需模型）

这条验的是「思考不再只活在流式期」：流式期它在标量 `liveThinking` 里，`message_end` 时由宿主落成 `kind: 'reasoning'` 条目（`session.ts` 的 `flushReasoning`），会话重建时再由 `reasoningTextFrom` 从落盘消息里投影出来——**同一轮里看到的那段思考，事后还在**（改造前它在流式区消失后就没了）。

**前置**：模型支持思考，且思考强度不是 `off`（输入区的思考菜单或 `/thinking`）。

**步骤**
1. 发送一句会触发思考的问题，等这一轮结束；
2. 记下这一轮思考行的数量与首行文本；
3. 切到另一条会话，再切回来（或刷新页面后重新打开这条会话）。

**预期**
- 流式期思考是一行 `.reasoningRow`（`data-state="running"`），点标题展开后是等宽原文 `.reasoningText`；
- 这一轮结束后它仍在过程区里，`data-state` 变 `"ok"`，文本与流式期一致（不是被截断的摘要）；
- 来回切会话（走宿主 `rebuild()`）后，思考行的数量与顺序不变；
- 思考文本**不逐字摊平**（整段直接显示）——有意为之，见 `S13` 的备注。

**判定**
```js
document.querySelector('.reasoningRow')?.dataset.state                        // 历史轮里应为 'ok'
document.querySelector('.reasoningRow .reasoningBody')?.getAttribute('hidden') // 折叠态为 'until-found'
document.querySelectorAll('.reasoningRow').length                              // 切会话前后各取一次，应相等
```

## S15 工具条目的结构化与结果内容块（离线可跑，走调试页）

工具条目的标题 / 工具族 / 参数摘要 / 结果都由宿主投影（`bangumi/src/web/tool-view.ts`），结果里的 `presentation` 直接投影成 `MessageBlock[]`——与助手正文**同一个渲染入口**，所以过程区不需要另造一套卡片族。

**步骤**
1. 打开调试页，**依次**点「2 工具开始」→「预览」→「3 工具结束」→「预览」（两条都用 `search_subjects`）；
2. 展开那条工具行（点它的标题）；
3. 把「3 工具结束」的 `result.presentation` 改成非法载荷（例如 `props.items` 给成字符串）再贴一次。

**预期**
- 第 1 步：出现工具行，标题是中文「搜索作品」，其后是参数摘要「攻壳机动队」（规格里 `keyword` 在 `filter.tag` 之前）；开始时状态 `running`（记号 `·`），结束后**原地更新**为 `ok`（记号 `✓`），行的位置与 React key 都不变；
- 第 2 步：展开体里先是「参数」块（`.toolArgsText` 的 pretty JSON），再是结果——`presentation` 渲染成 `SubjectCards` 内容块（`.toolResult .contentSubjects`），且**不挂滚动入场动画**（元素已在视口内，见 [../components/content.md](../components/content.md) §规则「滚动入场由 `animate` 开关，工具结果的展开体必须关掉」）；
- 第 3 步：那一块降级成 `ContentFallback`（问题清单 + 折叠的原始 JSON），工具行本身与状态不受影响。

**判定**
```js
const row = document.querySelector('.toolRow');
row?.dataset.family                                 // 'search'（图标按族选）
row?.dataset.state                                  // 开始 'running' → 结束 'ok'
row?.querySelector('.processSummary')?.textContent  // '攻壳机动队'
row?.querySelector('.toolResult .contentSubjects') !== null
row?.querySelector('.toolArgsText')?.textContent.includes('keyword')
```

## S16 轮控制行的耗时与计数（可离线，也可用真实会话）

轮控制行的三样读数全部来自**宿主下发的轮次条目**（`kind: 'turn'` 的 `TurnItemView`）：起止时间（→「已完成，用时 N 秒」）、`messageCount` / `toolCallCount`（宿主维护），以及前端 `summarizeProcess().total` 数出来的「N 步」。历史会话里这些值由宿主在 `rebuild()` 时推导（落盘条目没有轮次字段）。

**步骤（离线）**
1. 打开调试页，event 框粘一个数组：`agent_start` → `turn_start` → `tool_execution_start`（`search_subjects`）→ `tool_execution_end` → `message_end`（带一段文本）→ `agent_end`；
2. 点「预览」，观察这一轮的轮首控制行；
3. 再按顺序点「1 文本流式」与「4 回答落盘」造第二轮，比较两轮的控制行。

**预期**
- 结束后标题是「已完成，用时 N 秒」（不再是「正在…」），右侧仍是「N 步」；
- 结束的轮**默认收起**（`data-open="false"`），点控制行可展开（进行中的轮默认展开，见 [../components/main-page.md](../components/main-page.md) §规则）；
- `meta` 缺失（协议外的形态）时标题退回按族汇总（例如「执行修改计划」）且**不显示耗时**——不猜时间；
- `status` 为 `aborted` / `error` 时标题被覆盖成「已停止」/「处理失败」。

**判定**
```js
const bar = document.querySelector('.processBar');
bar?.dataset.open === 'false'                        // 结束的轮默认收起
bar?.querySelector('.processBarText')?.textContent   // 形如 '已完成，用时 3 秒'
bar?.querySelector('.processBarCount')?.textContent  // 'N 步'
bar?.closest('.appTurn') !== null                    // 控制行在轮次内部
```

## S17 轮尾复制与每轮用量（建议在有回答的轮次上跑）

`TurnActions` 在轮次末尾：有回答文本时给「复制」，`turn.meta.usage` 存在时给「用量 N」。复制对象**只是助手条目的文本块**（不含内容块载荷、不含思考与工具文本）——粘出去的东西要能读。

**步骤**
1. 发一句会得到回答的问题，等这一轮结束；
2. 点轮尾的「复制」；
3. 点「用量」按钮，观察面板；
4. 展开这一轮的过程区，确认操作行不受折叠影响。

**预期**
- 点击后按钮文案变「已复制」，约 1 秒后复原；
- 剪贴板内容 = 这一轮最后一个助手条目的**纯文本块**拼接（不含 `SubjectCards` 之类的载荷 JSON，也不含思考文本）；
- 用量面板（`.usagePanel.appGlass`，玻璃材质来自共享类）列出未缓存输入 / 缓存读取 / 缓存写入 / 输出（提供方报了推理 token 时补「（其中推理 N）」）/ 合计，有费用时补一行「费用 x.xxxx」；值为 0 的行不渲染；
- 既没有文本也没有用量的轮次**不渲染** `.turnActions`（不留一排点不动的按钮）；收尾播放期间整行也不渲染（见 `S13`）。

**判定**
```js
const actions = document.querySelector('.turnActions');
actions?.dataset.actionsReveal                      // 有文本 'always'；只有用量 'hover'
document.querySelector('.turnUsage .turnAction')?.textContent   // 形如 '用量 12.3k'
document.querySelector('.usagePanel .usageList')?.children.length > 0
// 剪贴板：需要页面在前台且剪贴板权限可用；不满足时改为人工粘贴核对
await navigator.clipboard.readText()                // 只应含回答正文
```

## S18 折叠内容的 Ctrl+F 可发现性（离线可跑）

三个折叠容器（`.processGroupBody` / `.reasoningBody` / `.processBody`）都不做条件渲染，而是用 `hidden="until-found"` 藏起来：内容仍在 DOM 里，浏览器 Ctrl+F 命中时先触发 `beforematch`，由 `useUntilFound` 把容器**真的展开**——"折叠"不等于"搜不到"（见 [../components/main-page.md](../components/main-page.md) §规则「折叠统一用 `hidden="until-found"` + `beforematch`，Ctrl+F 能命中折叠内容」）。

**步骤**
1. 让某一轮结束（过程默认收起，`data-open="false"`），确认 `.processGroupBody` 带 `hidden` 属性；
2. 记住折叠体里出现过的某个词（例如工具行的参数摘要「攻壳机动队」、或思考原文里的一个词）；
3. 用浏览器 Ctrl+F 搜这个词；
4. 再搜一个折叠体里**不存在**的词，确认不会误展开。

**预期**
- 第 1 步：折叠体的 `hidden` 属性值是 **`until-found`**（不是空串）——这正是"可被查找命中"的关键；写成 JSX 的 `hidden="until-found"` 会退化成 `hidden=""`，属性值一丢，Ctrl+F 就命中不了；
- 第 3 步：浏览器跳过去并**自动展开**整条折叠链（整轮命中展开整轮，单行命中展开那一行）；
- 第 4 步：什么都不发生（没有误展开）。

**判定**
```js
// 折叠态：属性值必须是 until-found
document.querySelector('.processGroupBody')?.getAttribute('hidden') === 'until-found'
document.querySelector('.reasoningBody')?.hidden === true            // 布尔属性照常为真
// Ctrl+F 命中之后（查找那一步必须手动做，脚本派发不了 beforematch）：
document.querySelector('.processBar')?.dataset.open === 'true'
```

**备注**：这条只有前后两个 DOM 判据可脚本化；第 3 步的"查找"必须手动在浏览器里执行——`beforematch` 由浏览器的查找 UI 触发。

## S19 历史会话回溯（不需模型，需一段旧会话）

宿主 `rebuild()` 在会话切换 / 重启时把落盘消息重新投影成条目：assistant 消息里的 `thinking` 块 → `reasoning` 条目（`reasoningTextFrom`）、`toolCall` 块 → `tool` 条目（`toolCallsFrom`），随后的 `toolResult` 消息按 `toolCallId` 配对补齐结果与耗时；轮次边界按「一条 user 消息开一个回合」推导。

**前置**：本机有一段已落盘的旧会话（**改造前**产生的更有价值——它没有任何实时事件，全靠这条路径还原）。

**步骤**
1. 在侧栏点开那段旧会话；
2. 依次展开几轮的过程区，核对思考行与工具行；
3. 展开一个工具行看结果，再看轮尾有没有用量。

**预期**
- 思考行与工具行都还原出来（旧会话里没有 `turn` 条目也走同一条路径推导）；
- 工具行的结果来自历史里的 `toolResult`，其中的 `presentation` 载荷渲染成内容块（与正文同一套）；
- **一直没有配上结果的调用**标成「结果待核实」（`data-state="unknown"`），而不是永远停在「进行中」——历史里结果可能落在上下文窗口之外；
- 轮次耗时用「下一条消息的时间」封口；**最后一轮**用已知的最后一条消息时间（不能用 `Date.now()`：几天前的会话会算出"用时 86 小时"）；
- 每轮 `usage` 由宿主累加自 assistant 消息的用量，轮尾据此显示「用量」；
- Console 无 error / warn。

**判定**
```js
document.querySelectorAll('.reasoningRow').length > 0
document.querySelectorAll('.toolRow').length > 0
[...document.querySelectorAll('.toolRow')].every(r => r.dataset.state !== 'running')   // 不应停在 running
[...document.querySelectorAll('.processBar .processBarText')]
  .every(el => /^(已完成，用时|已停止|处理失败)/.test(el.textContent))                 // 历史轮都封了口
document.querySelector('.processBar') !== null
document.querySelector('.turnUsage') !== null
```

**备注**：`.processBar` 只在轮次有过程项时渲染（`process.length > 0`），所以自动判定用「至少一条 + 全部已封口」而不是与 `.appTurn` 计数相等。

