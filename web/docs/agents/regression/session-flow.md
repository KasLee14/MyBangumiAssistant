# 会话主链路用例（`S`）

## 使用说明

### 这份文档是什么

会话主链路（`S1`–`S10`）的用例：提交与乐观回显、流式渲染、工具活动、写入确认、会话切换、轮次导轨、失败回滚、内容条目。

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
- 完成后流式区清空，同一条内容变为历史条目（`Turn` 的 `assistantRow`）；
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
- 失败的行显示详情（`：<detail>`）。

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

**步骤**：发送一句会触发写入工具的问题（例如"把某作品的收藏状态改成在看"），等确认卡出现。

**预期**
- 输入区被**接管**：`.appSeat` 内出现 `.appCardSeat > .planCard`，输入框消失；
- 卡片显示状态「待确认」、标题、完整预览文本（等宽、保留换行）与提示；
- **两个按钮可点**（`disabled` 为 `false`）。待确认必然发生在本轮进行中（`busy` 为真），所以这里**不能**用 `busy` 当禁用条件——历史 bug 就是由此导致按钮恒灰；
- 点下后到宿主返回结论之前，两个按钮**短暂禁用**（防重复提交），卡片被替换或结论下发后即解除；
- 点「确认修改」→ 提交后卡片状态变为已确认/已过期，输入区恢复输入卡；
- 另起一轮点「取消」→ 状态为「已拒绝」；
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

**判定**
```js
document.querySelectorAll('.appTurn').length       // 新建后为 0；恢复后 > 0
document.querySelector('.appHeaderMeta .appChip')?.textContent.trim()   // '已连接'
document.querySelector('.appStage').dataset.phase   // 新建且空闲时为 'hero'
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
rail ? rail.querySelectorAll('.appRailButton').length : 0      // 与含 user 的轮次数一致
[...document.querySelectorAll('.appRailButton')].filter(b => b.dataset.active === 'true').length  // 恰好 1
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

## S10 内容条目渲染与降级（需模型或含内容条目的历史会话）

**步骤**
1. 让模型产出一条富内容（例如"列出这部作品的标签"→ `tags`，或"对比 xx 与 yy"→ `compare`）；
2. 或恢复一条历史会话，直接观察其中的内容条目。

**预期**
- 内容条目按 `kind` 渲染成对应组件（标签云、对比表、进度网格…），样式正常（品牌配色、无溢出）；
- 数组超限时被**截断**而不是撑爆布局；
- 若某条目的载荷不合法，渲染**降级块**（问题清单 + 可折叠原始 JSON），而不是白屏或抛错。

**判定**
```js
document.querySelectorAll('[class^="content"], [class*=" content"]').length > 0
!document.querySelector('.contentFallback')      // 数据合法时不应出现降级块
// 降级块的原始数据可折叠展开：
document.querySelector('.contentFallback details')?.open
```
