# 设置与凭据用例（`C`）

> 前提与判定约定见 [readme.md](readme.md)。`C3`–`C6` 会写本机配置，**执行前后都要核对** `%LOCALAPPDATA%\MyBangumiAssistant-Pi\pi\` 下的 `auth.json` 与 `settings.json`。

## C1 打开设置的两条路径

**步骤**
1. 点顶栏右侧设置图标；
2. 关闭后，在输入框执行 `/model`。

**预期**
- 路径 1：打开「设置」主面板（四行）；
- 路径 2：打开设置并**直达「模型选择」子弹窗**（模型不可用时退回主面板）；
- 同一时刻只有一个弹窗（设置与会话弹窗互斥）。

**判定**
```js
document.querySelector('.modalHeader h2')?.textContent          // '设置' 或 '模型选择'
document.querySelectorAll('.settingsRow').length                // 主面板为 4（子弹窗为 0）
```

## C2 四行的值与文案

**预期**（对照当前运行状态逐行核对）

| 行 | 值应显示 |
|---|---|
| 模型配置 | `<提供方> · <凭据来源措辞>`（`尚未配置` / `本次运行已填入` / `来自环境变量` / `已保存在本机`） |
| 模型选择 | `provider/model`；未选择模型时显示「未选择模型」；无可用模型时整行置灰并提示「请先完成模型配置」 |
| 代理端口 | `自动发现`/`直连`/`手动指定` · `<地址或直连>` |
| 登录状态 | 已登录显示用户名 + 「退出登录」；未登录显示「未登录」+「登录」 |

底部一行说明文案应为：`模型选择会保存为本机默认，密钥可保存到本机；线路只影响本次运行。`

**判定**
```js
[...document.querySelectorAll('.settingsRow')].map(r => [r.querySelector('.label').textContent, r.querySelector('.value').textContent])
document.querySelector('.modalFooter .note').textContent
```

## C3 保存密钥到本机（勾选，默认行为）

**前置**：记录 `pi/auth.json` 当前内容（可能为 `{}`）。

**步骤**
1. 设置 → 模型配置 → 选一个提供方；
2. 填一个**假密钥**（例如 `sk-regression-test`）；
3. 保持「保存到本机（重启后仍生效）」**勾选**；
4. 点「应用」。

**预期**
- 出现提示：`已为 <提供方> 保存密钥到本机，重启后仍然生效。`（若当前模型不可用，还可能追加"已切换到 …"）；
- `pi/auth.json` 出现该提供方的 `api_key` 条目；
- 设置行「模型配置」的来源变为 **已保存在本机**；
- 重新打开「模型配置」弹窗，底部出现「清除已保存的密钥」按钮与覆盖提示。

**判定**
```js
// 界面
document.querySelector('.settingsRow .value').textContent.includes('已保存在本机')
// 文件（在终端执行）
Get-Content "$env:LOCALAPPDATA\MyBangumiAssistant-Pi\pi\auth.json"
```

## C4 仅本次运行（取消勾选）

**前置**：记录 `pi/auth.json` 的**字节数与最后写入时间**。

**步骤**
1. 设置 → 模型配置 → 换一个未配置的提供方；
2. 填假密钥；
3. **取消勾选**「保存到本机」；
4. 点「应用」。

**预期**
- 提示为 `已为 <提供方> 填入密钥；密钥只用于本次运行。`；
- `pi/auth.json` **字节数与时间都不变**（没有新条目）；
- 设置行来源显示 `本次运行已填入`；
- 不出现「清除已保存的密钥」按钮（该提供方没有本机凭据）。

**判定**
```js
!document.querySelector('.modalFooter button')?.textContent.includes('清除')   // 弹窗内无清除按钮
// 终端：比较执行前后的 Get-Item auth.json 的 Length 与 LastWriteTime
```

## C5 清除已保存的密钥

**前置**：某提供方的来源为「已保存在本机」。

**步骤**
1. 设置 → 模型配置 → 选中该提供方；
2. 点「清除已保存的密钥」。

**预期**
- 提示：`已清除 <提供方> 保存在本机的密钥。`；
- `pi/auth.json` 中该条目消失；
- 设置行来源回落（`尚未配置` 或 `来自环境变量`）；
- 若该提供方只有本机凭据，模型列表相应减少，顶栏模型可能变为未选择。

**判定**
```js
document.querySelector('.settingsRow .value').textContent        // 不含 '已保存在本机'
// 终端：auth.json 中该提供方键不存在
```

## C6 模型选择落盘

**前置**：已有一个可用模型。

**步骤**
1. 设置 → 模型选择 → 选一个**与当前不同**的模型 → 应用；
2. 在终端查看 `pi/settings.json`。

**预期**
- 提示：`已切换到 <provider>/<model>。`；
- `settings.json` 出现 `defaultProvider` 与 `defaultModel`，且**原有的 `defaultThinkingLevel` 等字段不被清掉**；
- **重启宿主后**再打开页面，设置行「模型选择」显示的就是刚选的那一个（无需重选）。

**判定**
```js
document.querySelectorAll('.settingsRow')[1].querySelector('.value').textContent   // 'provider/model'
```

## C7 代理线路

**步骤**
1. 设置 → 代理端口 → 依次试 `自动发现`、`直连`、`手动指定`（后者需填地址）；
2. 每个模式预期不同的提示与回显。

**预期**
- `手动指定` 且地址为空时「应用」置灰；
- 应用后提示 `网络线路已切换，仅本次运行生效。`，设置行的值随模式变化；
- 地址框在非 `manual` 模式禁用。

**判定**
```js
document.querySelector('#proxy-url').disabled        // 非 manual 时为 true
```

## C8 Bangumi 登录与退出（需登录环境）

**步骤**
1. 设置 → 登录状态「登录」→ 填邮箱密码提交；
2. 观察进度条；
3. 登录成功后点「退出登录」并确认。

**预期**
- 登录中：弹窗内容换成状态条（`modalStatus`）显示宿主下发的进度；此期间关闭弹窗会中止登录（发 `/api/login-cancel`）；
- 登录成功：提示 + 设置行显示用户名；
- 退出登录：先确认弹窗，确认后提示并回到「未登录」。

**判定**
```js
document.querySelector('.modalStatus')                  // 登录中
document.querySelectorAll('.settingsRow')[3].querySelector('.value').textContent   // 用户名 / '未登录'
```

## C9 关闭层级与 Esc（两级语义）

**步骤**
1. 打开设置 → 进入「模型配置」子弹窗 → 按 Esc；
2. 再按 Esc。

**预期**
- 第一次 Esc：关闭**子弹窗**，回到设置主面板（设置弹窗仍打开）；
- 第二次 Esc：关闭**整个设置弹窗**；
- 第三次按设置图标：能重新打开（状态正确复位）。

**判定**
```js
document.querySelector('.modalHeader h2')?.textContent    // 第 1 次后为 '设置'
document.querySelector('[role="dialog"]') === null         // 第 2 次后为 true
```

## C10 无模型时的置灰与退回

**前置**：没有任何已配置凭据的提供方（模型列表为空）。

**预期**
- 设置行「模型选择」的编辑按钮置灰，值显示「请先完成模型配置」；
- 用 `/model` 打开设置时**退回主面板**，不停在空的模型选择弹窗。

**判定**
```js
document.querySelectorAll('.settingsRow')[1].querySelector('button').disabled === true
```
