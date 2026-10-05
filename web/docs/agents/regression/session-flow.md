# 会话主链路用例（`S`）

## 使用说明

### 这份文档是什么

会话主链路（`S1`–`S11`）的用例：提交与乐观回显、流式渲染、工具活动、写入确认、会话切换、轮次导轨、失败回滚、内容条目与批次反馈。

前提与判定约定见 [readme.md](readme.md)。标注「需模型」的用例要求模型列表非空。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `S1`（提交与乐观回显）、`S9`（失败回滚） | 动输入区提交、乐观回显或错误回滚时（**不需模型**） |
| `S2`（流式渲染与落条目） | 动流式显示块、Markdown 渲染、条目落盘时（需模型） |
| `S3`–`S4`（工具活动与 `/details`） | 动过程折叠块或轮次投影时（需模型） |
| `S5`–`S6`（写入确认与 Esc 拒绝） | **动接管逻辑、确认卡或 Esc 行为时必读**（需模型） |
| `S7`（会话切换）、`S8`（轮次导轨） | 动会话切换、条目整表替换或导轨时（不需模型） |
| `S10`（内容条目与降级） | 动内容组件库或校验降级时（需模型或含内容条目的历史会话） |
| `S11`（批次容错反馈） | 动批次投影、活动协议、额度等待或 ToolActivity 时（离线可验证展示） |

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

## S3 工具活动折叠块（需模型）

**步骤**：发送一句需要调用 Bangumi 工具的问题（例如"搜索进击的巨人"）。

**预期**
- 该轮出现「处理过程」块，显示 `N 步`；
- **运行中默认展开**，结束后自动收起（可手动再展开）；
- 每条活动行有状态标记：运行中 `·`、完成 `✓`、失败 `×`，并显示中文状态（进行中/完成/失败）；
- 普通失败行显示详情（`：<detail>`）；批次成功也显示中文计数，部分完成、未知与等待状态见 `S11`。

**判定**
```js
const group = document.querySelector('.processGroup');
group?.dataset.open            // 运行中为 'true'，结束后为 'false'
document.querySelectorAll('.activityRow').length > 0
[...document.querySelectorAll('.activityRow')].map(r => r.dataset.state)   // 'running' | 'ok' | 'error'
```

## S4 `/details` 展开过程块（需模型）

**步骤**：等上一轮结束（过程块已收起），输入 `/details` 回车。

**预期**：当前会话内所有过程块被强制展开；再次执行仍展开（`reveal` 递增，不切换回收起）。

**判定**
```js
[...document.querySelectorAll('.processGroup')].every(g => g.dataset.open === 'true')
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
1. 在侧栏点「新建会话」；
2. 再点侧栏里另一条历史会话。

**预期**
- 新建后：会话区清空、回到首屏 hero 阶段（若空闲）、条目列表整体替换；
- 恢复后：历史条目出现，滚动位置在底部；轮次高亮复位；
- 顶栏连接状态保持「已连接」（切换不重建 SSE）。
- 切换不取消旧会话任务；后台会话状态仍在历史列表更新。切回后恢复该会话的草稿、工具活动与待确认卡；旧会话迟到帧不能把当前视图切回去。

**判定**
```js
document.querySelectorAll('.appTurn').length       // 新建后为 0；恢复后 > 0
document.querySelector('.appHeader .appChip')?.textContent.trim()   // '已连接'
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
1. 打开调试页（主界面顶栏的「组件库」链接旁入口，或 URL 带 `#debug`）；
2. event 输入框粘一条 `message_end`：`message.role` 为 `assistant`、`message.content` 里含一个内容块（例如 `{ "type":"stats", "props":{…} }`），点「预览」；
3. 把该块的载荷改成非法形态（例如 `stats.entries` 给成字符串）再粘一次；
4. 粘一个未登记的块 `type`（例如 `{ "type":"nope" }`）；
5. 另粘一条 custom 消息（`{ "type":"message_end", "message":{ "role":"custom", "customType":"infobox", "display":true, "details":{ …裸载荷… } } }`）。

**预期**
- 第 2 步：内容块按 `type` 渲染成对应组件（统计卡、表格、标签云…），样式正常（品牌配色、无溢出）；数组超限时被**截断**而不是撑爆布局；
- 第 3 步：渲染**降级块**（问题清单 + 可折叠原始 JSON），而不是白屏或抛错；
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

运行 `node --test test/web-write-activity.test.mjs test/web-ui-variants.test.mjs`（先统一构建）。
前者以离线工具通过真实 Pi 事件/Web SSE 验证进度和历史投影，后者以本地 HTTP/SSE 数据验证两版 DOM。

预期：原步骤编号与跳过对象保留，`blockedBy` 显示前序依赖；成功、跳过、依赖阻塞分别计数；
`partial` 行为“未全部完成”，`unknown` 行为“结果待核实”，不把全部行画成失败或完成；
成功批次也显示已核实数量，缺口换行可读。额度等待展示类别、恢复时间与 Esc 停止提示，
`submitted` 始终是已提交待核实。切换两版不重连 SSE，恢复历史保留最终批次反馈。

真实账户验收仍须另外执行已授权的混合批次，并核对网站最终状态；离线用例不能替代该证据。

2026-10-04 离线记录：统一构建后运行上述两个文件及 `web-sessions.test.mjs`，共 17 项通过、0 项跳过。
Chromium 实测两版部分完成/未知/成功计数、换行与等待文案，并核对外观切换不重连 SSE；
Pi 回调→Web/SSE 与历史重建通过本地 fixture 验证。未运行真实模型或 Bangumi 账户写入。

## S12 内容块的骨架与落定（离线可跑，走调试页）

这是「内容块」重构的核心行为：文本块流式增长 → 内容块以 `pending` 出现并渲染**骨架** → `pending` 消失后渲染真实数据 → 后续文本块继续流式 → `message_end` 后整批原样落成历史条目。

**步骤**
1. 打开调试页，**依次**点左侧样例的「7 内容块（骨架）」与「8 组件块（落定与续写）」，每次点完按「预览」；
2. 先看 7 的结果（文本 + 骨架），再点 8（骨架被真实数据替换、续写文本、落成历史条目）。

**为什么分两次**：调试页把 event **数组按 flush 语义合并成一帧**（那是宿主 40ms 窗口的真实行为），一次喂完整条链路就看不到「骨架 → 真实数据」那一跳。分两次喂时模拟器状态是累积的，合起来仍是完整链路。想逐帧看，也可以把单条 event 逐条粘进去。

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
