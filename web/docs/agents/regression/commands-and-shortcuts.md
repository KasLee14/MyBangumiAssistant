# 命令与快捷键用例（`K`）

> 前提与判定约定见 [readme.md](readme.md)。标注「需模型」的用例要求模型列表非空。

## K1 命令补全的出现与匹配

**步骤**
1. 输入 `/`；
2. 继续输入 `mo`。

**预期**
- 输入 `/` 时弹出候选浮层（`.composerPopup`），列出本地命令与宿主命令，分「命令」分组；
- 输入 `/mo` 时只剩匹配项（`/model`）；
- 输入 `/model `（带空格）后**候选消失**（匹配条件是以 `/` 开头且不含空白）；
- 候选项的右侧显示一句话说明。

**判定**
```js
[...document.querySelectorAll('.popupItem .value')].map(e => e.textContent)
!!document.querySelector('.composerPopup')
```

## K2 补全的键盘导航

**步骤**：输入 `/` 后依次按 `↓`、`↑`、`Tab`、`Enter`。

**预期**
- `↓`/`↑` 移动高亮（`aria-selected` 与 `.active` 同步），到底/到顶不越界；
- `Tab` 把高亮项**填进输入框**（不执行）；
- `Enter` **执行**高亮项（而不是发送字面文本）；
- Esc 关闭候选浮层但保留草稿（且**不**触发会话层的停止/拒绝）。

**判定**
```js
document.querySelector('.popupItem.active .value').textContent   // 当前高亮
document.querySelector('#composer-input').value                  // Tab 后为命令全文
```

## K3 `/help`（命令表由宿主决定）

**步骤**：执行 `/help`。

**预期**
- 出现 toast，内容为 `可用命令：/help（查看可用命令）；/new（…）；…`，**包含宿主注册的命令**（例如 `/bangumi-login`、扩展命令）；
- 输入框清空；
- 不产生会话条目（斜杠命令不进对话）。

**判定**
```js
document.querySelector('.toast')?.textContent.startsWith('可用命令：')
document.querySelectorAll('.flowItem').length     // 不因 /help 增加
```

## K4 `/new` 新建会话

**步骤**：在有内容的会话里执行 `/new`。

**预期**：当前会话被替换为新会话（条目清空、回到首屏）；侧栏「历史会话」列表刷新（此前会话出现为可恢复项）。

**判定**
```js
document.querySelectorAll('.flowItem').length === 0
document.querySelector('.body').dataset.phase === 'hero'
document.querySelectorAll('.sessionRow').length > 0
```

## K5 `/sessions` 打开会话弹窗

**步骤**：执行 `/sessions`。

**预期**：打开「历史会话」弹窗（`.pickerRow` 列表，当前会话标 `当前`）；点一项即切换会话并关闭弹窗；弹窗打开时**设置弹窗被关闭**（互斥）。

**判定**
```js
document.querySelector('.modalHeader h2')?.textContent === '历史会话'
document.querySelectorAll('.pickerRow').length > 0
```

## K6 `/model` 直达模型选择

**步骤**：执行 `/model`。

**预期**：设置弹窗直接打开到「模型选择」子弹窗（不是主面板）；模型不可用时退回主面板（见 `C10`）。

**判定**
```js
document.querySelector('.modalHeader h2')?.textContent === '模型选择'
document.querySelector('#model-pick') !== null
```

## K7 `/details` 展开过程折叠块

**步骤**：任一会话里（至少一轮已结束）执行 `/details`。

**预期**：所有过程块展开；再执行仍为展开（计数递增，不做开关切换）。

**判定**：`[...document.querySelectorAll('.processGroup')].every(g => g.dataset.open === 'true')`

## K8 `/exit` 只给提示

**步骤**：执行 `/exit`。

**预期**：toast 提示"Web 终端不需要 /exit；直接关闭标签页即可，宿主仍在运行。"；**不关页面、不断连接**。

**判定**
```js
document.querySelector('.toast')?.textContent.includes('/exit')
document.querySelector('.conversationHeader .chip')?.textContent.trim() === '已连接'
```

## K9 未登记命令被拦下（不发宿主）

**步骤**：输入 `/nosuchcommand` 回车。

**预期**
- 输入区附近出现红字提示：`没有匹配命令，请继续编辑；输入 / 查看命令列表。`（`.composerProblem`，`role="alert"`）；
- **不发送**给宿主（Network 里没有 `POST /api/submit`）；
- 草稿**保留**（不清空），便于继续编辑。

**判定**
```js
document.querySelector('.composerProblem')?.textContent.includes('没有匹配命令')
document.querySelector('#composer-input').value === '/nosuchcommand'
```

## K10 Esc 停止本轮（需模型）

**前置**：本轮正在生成（`busy` 为真、按钮显示停止）。

**步骤**：按 Esc（焦点不在弹窗/菜单里）。

**预期**：等价于点「停止本轮」；状态行文案先变为"正在停止…"，随后本轮结束、输入区恢复可发送。

**判定**
```js
document.querySelector('.composerHint')?.textContent     // '正在停止…' → 'Esc 停止本轮'
!document.querySelector('.running')
```

## K11 弹窗与菜单的 Esc 不冒泡

**步骤**
1. 打开设置弹窗，按 Esc → 只关弹窗；
2. 打开思考强度菜单（需模型），按 Esc → 只关菜单；
3. 两种情况下本轮都**不受影响**（不被停止、不拒绝确认）。

**预期**：Esc 被弹窗/菜单在**捕获阶段**拦截并 `stopPropagation()`；会话层收不到该事件。

**判定**
```js
// 第 2 步后：
document.querySelector('.thinkingMenu') === null
document.querySelector('.composerHint')?.textContent === 'Esc 停止本轮'   // 本轮未被停止
```

## K12 思考强度菜单（需模型）

**步骤**
1. 点输入卡右侧的思考标签；
2. 选一个与当前不同的级别。

**预期**
- 菜单向上展开，列出宿主下发的可用级别（中文名 + 原始级别名），当前项标 `selected`；
- 未选模型或不支持思考时标签置灰，`title` 说明原因；
- 选定后：toast 提示 `思考强度已切换为 <中文名>（<level>），并已保存为本机默认。`，标签文本更新；
- **该切换会写本机配置**（`pi/settings.json` 的 `defaultThinkingLevel`），重启后新会话沿用。

**判定**
```js
document.querySelector('.thinkingTrigger').textContent                    // '思考 · 高' 之类
document.querySelectorAll('.thinkingMenu .menuItem').length > 1
```

## K13 toast 自动消失

**步骤**：执行 `/help` 触发一条 toast，静置观察。

**预期**：toast 约 **4 秒**后自动消失（超时由 `Toast` 组件 dispatch 清空，不是永久停留）。

**判定**
```js
// 立刻：document.querySelector('.toast') !== null
// 5 秒后：document.querySelector('.toast') === null
```

## K14 参数错误提示自动清空

**步骤**
1. 用 `/nosuchcommand` 触发 `.composerProblem`；
2. 静置观察（不修改输入）。

**预期**：约 **4 秒**后红字提示自动消失，草稿仍在。

**判定**
```js
// 立刻：!!document.querySelector('.composerProblem')
// 5 秒后：document.querySelector('.composerProblem') === null
```
