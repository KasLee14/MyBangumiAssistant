# 设置与凭据用例（`C`）

## 使用说明

### 这份文档是什么

设置与凭据（`C1`–`C10`）的用例：打开路径、四格显示、密钥持久化三态、模型选择落盘、代理、登录、关闭层级与空态置灰。

前提与判定约定见 [readme.md](readme.md)。`C3`–`C6` 会写本机配置，**执行前后都要核对** `%LOCALAPPDATA%\MyBangumiAssistant-Pi\pi\` 下的 `auth.json` 与 `settings.json`。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `C1`（打开路径）、`C2`（四格显示） | 动设置弹窗结构或某格取值时 |
| `C3`–`C5`（保存到本机 / 仅本次 / 清除） | **动凭据持久化或「模型配置」弹窗时必读**（三条路径各有用例） |
| `C6`（模型选择落盘） | 动模型切换或 `settings.json` 写入时 |
| `C7`（代理线路）、`C8`（登录与退出） | 动代理或登录流程时 |
| `C9`（两级关闭与 Esc）、`C10`（无模型置灰） | 动弹窗开合层级或空态处理时 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`C3`–`C6` 执行前后必须核对并还原本机配置** —— 违反后果：污染真实环境（见本组「涉及写本机配置的用例执行前后都要核对并还原」）。
2. **测试密钥必须显式标注为测试值**，不得使用真实密钥 —— 违反后果：凭据进入记录与对话。

## C1 打开设置的三条路径

**步骤**
1. 点**侧栏底部用户行**的齿轮按钮（`.appSidebarUser .appIconButton[aria-label="设置"]`）；
2. 关闭后，在**空会话首屏**点说明下方那枚实心深档按钮（`.appHeroSettings`）；
3. 关闭后，在输入框执行 `/model`。

**预期**
- 路径 1 / 2：打开「设置」主面板——**`BentoGrid` 四格**（模型配置 / 模型选择 / 代理端口 / 登录状态），**整格可点、没有底部动作条**，关闭走右上角实心 `×`（`.dlgCloseTop`）或 Esc；
- 路径 3：打开设置并**直达「模型选择」子弹窗**（模型不可用时退回主面板）；
- 同一时刻只有一个弹窗（设置与会话弹窗互斥）。
- 路径 2 只在 hero 阶段存在：一旦有条目或流式输出，`.appHeroSettings` 随 `.appHero` 一起消失（首屏引导归 `selectHeroPhase` 管）。

**判定**
```js
document.querySelector('.dlgTitle')?.textContent          // '设置' 或 '模型选择'
document.querySelectorAll('.bentoCard').length            // 主面板为 4（子弹窗为 0）
```

## C2 四格的值与文案

**预期**（对照当前运行状态逐格核对）

| 格 | 值应显示 |
|---|---|
| 模型配置 | `<提供方> · <凭据来源措辞>`（`尚未配置` / `本次运行已填入` / `来自环境变量` / `已保存在本机`）；CTA「配置 →」 |
| 模型选择 | `provider/model`；未选择模型时显示「未选择模型」；无可用模型时整格**置灰**（`disabled`）并显示「请先完成模型配置」；CTA「切换 →」 |
| 代理端口 | `自动发现`/`直连`/`手动指定` · `<地址或直连>`；CTA「修改 →」 |
| 登录状态 | 已登录显示用户名（CTA「退出登录 →」）；未登录显示「未登录」（CTA「登录 →」） |

说明文案不再是底栏那一行，而是弹窗**副标题** `.dlgSub`：`模型选择会保存为本机默认，密钥可保存到本机；线路只影响本次运行。`

**判定**
```js
[...document.querySelectorAll('.bentoCard')].map(c => [c.querySelector('.bentoName').textContent, c.querySelector('.bentoDesc').textContent])
document.querySelector('.dlgSub').textContent
```

## C3 保存密钥到本机（勾选，默认行为）

**前置**：记录 `pi/auth.json` 当前内容（可能为 `{}`）。

**步骤**
1. 设置主面板点**「模型配置」格**（`.bentoCard` 的第一个，整格可点）→ 在「提供方」的自绘下拉 `.dlgCombo`（`.dlgTrigger` → `.dlgMenu > .dlgOption`）里选一个提供方；
2. 在 `#model-key` 里填一个**假密钥**（例如 `sk-regression-test`）；
3. 保持「保存到本机（重启后仍生效）」（`.dlgCheck`）**勾选**；
4. 点底部主按钮「应用」（`.dlgBtnPrimary`）。

**预期**
- 出现提示：`已为 <提供方> 保存密钥到本机，重启后仍然生效。`（若当前模型不可用，还可能追加"已切换到 …"）；
- `pi/auth.json` 出现该提供方的 `api_key` 条目；
- 设置主面板「模型配置」格的来源变为 **已保存在本机**；
- 重新打开「模型配置」弹窗，底部**左侧**出现「清除已保存的密钥」按钮（`.dlgActions > .dlgBtnGhost`），并有一句 `.dlgHint` 说明环境变量与内联密钥不受影响。

**判定**
```js
// 界面：回主面板后读第一格的描述
document.querySelectorAll('.bentoCard')[0].querySelector('.bentoDesc').textContent.includes('已保存在本机')
// 文件（在终端执行）
Get-Content "$env:LOCALAPPDATA\MyBangumiAssistant-Pi\pi\auth.json"
```

## C4 仅本次运行（取消勾选）

**前置**：记录 `pi/auth.json` 的**字节数与最后写入时间**。

**步骤**
1. 设置主面板 →「模型配置」格 → 换一个未配置的提供方；
2. 填假密钥；
3. **取消勾选**「保存到本机」（`.dlgCheck` 里的 checkbox，`name="persist-credential"`）；
4. 点「应用」。

**预期**
- 提示为 `已为 <提供方> 填入密钥；密钥只用于本次运行。`；
- `pi/auth.json` **字节数与时间都不变**（没有新条目）；
- 设置主面板该格来源显示 `本次运行已填入`；
- 不出现「清除已保存的密钥」按钮（该提供方没有本机凭据）。

**判定**
```js
[...document.querySelectorAll('.dlgActions .dlgBtn')].every(b => !b.textContent.includes('清除'))   // 弹窗内无清除按钮
// 终端：比较执行前后的 Get-Item auth.json 的 Length 与 LastWriteTime
```

## C5 清除已保存的密钥

**前置**：某提供方的来源为「已保存在本机」。

**步骤**
1. 设置主面板 →「模型配置」格 → 选中该提供方；
2. 点底部左侧的「清除已保存的密钥」。

**预期**
- 提示：`已清除 <提供方> 保存在本机的密钥。`；
- `pi/auth.json` 中该条目消失；
- 该格来源回落（`尚未配置` 或 `来自环境变量`）；
- 若该提供方只有本机凭据，模型列表相应减少，「模型选择」格可能变为未选择模型（或在无可用模型时置灰）。

**判定**
```js
document.querySelectorAll('.bentoCard')[0].querySelector('.bentoDesc').textContent        // 不含 '已保存在本机'
// 终端：auth.json 中该提供方键不存在
```

## C6 模型选择落盘

**前置**：已有一个可用模型。

**步骤**
1. 设置主面板点「模型选择」格（或 `/model` 直达）→ 在 `.dlgList` 里选一个**与当前不同**的模型 → 点底部主按钮「**使用**」（`.dlgBtnPrimary`）；
2. 在终端查看 `pi/settings.json`。

**预期**
- 提示：`已切换到 <provider>/<model>。`；
- `settings.json` 出现 `defaultProvider` 与 `defaultModel`，且**原有的 `defaultThinkingLevel` 等字段不被清掉**；
- **重启宿主后**再打开页面，「模型选择」格显示的就是刚选的那一个（无需重选）。

**判定**
```js
document.querySelectorAll('.bentoCard')[1].querySelector('.bentoDesc').textContent   // 'provider/model'
```

## C7 代理线路

**步骤**
1. 设置主面板点「代理端口」格 → 弹窗标题是「**网络线路**」（`.dlgTitle`）→ 在 `.dlgChoices > .dlgChoice` 三个单选项里依次试 `自动发现`、`直连`、`手动指定`（后者需填地址 `#proxy-url`）；
2. 每个模式点一次「应用」，观察提示与回显。

**预期**
- `手动指定` 且地址为空时「应用」置灰；
- 应用后提示 `网络线路已切换，仅本次运行生效。`，设置主面板「代理端口」格的描述随模式变化（`<模式> · <地址或直连>`）；
- 地址框在非 `manual` 模式禁用。

**判定**
```js
document.querySelector('#proxy-url').disabled        // 非 manual 时为 true
```

## C8 Bangumi 登录与退出（需登录环境）

**步骤**
1. 设置主面板点「登录状态」格（未登录时整格可点，CTA「登录 →」）→ 填邮箱（`#bangumi-email`）与密码（`#bangumi-password`）提交；
2. 观察进度条（`.dlgStatus` + `.dlgDot`）；
3. 登录成功后回到主面板，再点「登录状态」格（此时它打开的是**退出确认**弹窗，`BangumiLogoutDialog`）并确认。

**预期**
- 登录中：弹窗内容换成状态条（`.dlgStatus`，`data-configured` 时 `.dlgDot` 变色）显示宿主下发的进度；此期间关闭弹窗会中止登录（发 `/api/login-cancel`）；
- 登录成功：提示 + 「登录状态」格显示用户名（CTA 变「退出登录 →」）；
- 退出登录：先确认弹窗，确认后提示并回到「未登录」。

**判定**
```js
document.querySelector('.dlgStatus')                  // 登录中
document.querySelectorAll('.bentoCard')[3].querySelector('.bentoDesc').textContent   // 用户名 / '未登录'
```

## C9 关闭层级与 Esc（两级语义）

**步骤**
1. 打开设置 → 进入「模型配置」子弹窗 → 按 Esc；
2. 再按 Esc。
3. 第三次走「侧栏用户行「···」→ 设置」：能重新打开（状态正确复位）。

**预期**
- 第一次 Esc：关闭**子弹窗**，回到设置主面板（设置弹窗仍打开）；
- 第二次 Esc：关闭**整个设置弹窗**；
- 重新打开时回到主面板（`settingsPane` 已复位）。

**判定**
```js
document.querySelector('.dlgTitle')?.textContent          // 第 1 次后为 '设置'
document.querySelector('[role="dialog"]') === null         // 第 2 次后为 true
```

## C10 无模型时的置灰与退回

**前置**：没有任何已配置凭据的提供方（模型列表为空）。

**预期**
- 「模型选择」格**置灰**（`BentoCard` 渲染成带 `disabled` 的 `<button>`，键盘也点不动），描述为「请先完成模型配置」；
- 用 `/model` 打开设置时**退回主面板**，不停在空的模型选择弹窗。

**判定**
```js
document.querySelectorAll('.bentoCard')[1].disabled === true
document.querySelectorAll('.bentoCard')[1].querySelector('.bentoDesc').textContent.includes('请先完成模型配置')
```
