# MyBangumiAssistant

MyBangumiAssistant 是一个在本地运行的 Bangumi AI 助手。通过自然语言，你可以查询作品、获取推荐，以及管理自己的收藏、评分、标签、观看进度和目录。它提供浏览器 Web 界面和命令行 CLI，两种入口使用同一套模型配置、工具和会话管理能力。

例如，你可以直接说：

- “推荐几部我没看过的高分搞笑动画。”
- “把《某部动画》第 3 集标记为看过。”
- “创建一个目录，把这些作品加入进去。”

## 1、部署与启动

### 准备环境与安装

当前以 Windows 为使用环境，需要 **Node.js `>=24.14.0 <25`、npm、Git 和 curl**。下文命令均在 PowerShell 中执行。

在项目根目录执行一次初始化：

```powershell
node bootstrap-pi.mjs
```

脚本会安装依赖、下载并校验模型目录，然后构建 Pi、Bangumi 应用和 Web 界面。需要本机 Clash 代理时，使用：

```powershell
node bootstrap-pi.mjs --proxy http://127.0.0.1:7890
```

### 启动 Web端

在项目根目录执行：

```powershell
cd bangumi
npm start -- web
```

程序会自动打开默认浏览器，默认端口为 **8787**。如果浏览器未打开，复制终端打印的完整访问地址。首次使用按下一节配置模型，再从“设置 → 登录状态”登录 Bangumi；人机验证在浏览器中完成。

需要指定端口或关闭自动打开浏览器时，在 `bangumi/` 目录执行：

```powershell
npm start -- web --port 8788 --no-open
```

## 2、配置 API Key

### 方式一：在 Web 中填写

启动 Web 后，点击右上角设置图标：

1. 在“模型配置”中点击“编辑”，选择提供方并填写 API Key。默认勾选“保存到本机”，密钥保存至本机 Pi 的 `auth.json`；取消勾选则仅本次运行有效。已保存的密钥可在该弹窗清除，环境变量与 `models.json` 配置不受影响。
2. 在“模型选择”中选择要使用的模型，同时保存为本机启动默认模型。
3. 返回聊天页面，发送请求。

### 方式二：使用本地配置文件

默认目录为 `%LOCALAPPDATA%\MyBangumiAssistant-Pi\pi`：

| 配置 | 用途 |
| --- | --- |
| `models.json` | 定义模型提供方、接口地址、模型 ID 和 API Key 的环境变量引用。 |
| `settings.json` | 保存默认提供方、默认模型和默认思考强度等偏好。 |
| `auth.json` | 保存通过 Web 或 Pi 登录流程写入本机的模型凭据。 |
| 本机环境变量 | 提供实际 API Key，供 `models.json` 引用。 |

**第一步：创建或打开配置目录。** 在 PowerShell 中执行：

```powershell
$piConfigDir = Join-Path $env:LOCALAPPDATA 'MyBangumiAssistant-Pi\pi'
if ($env:BANGUMI_PI_HOME) { $piConfigDir = Join-Path $env:BANGUMI_PI_HOME 'pi' }
New-Item -ItemType Directory -Force -Path $piConfigDir | Out-Null
notepad (Join-Path $piConfigDir 'models.json')
```

使用自定义 `--data-dir` 时，将 `$piConfigDir` 改为该目录下的 `pi` 子目录。文件不存在时，在记事本中创建并保存；已有配置请合并字段，保留其他提供方和设置。

**第二步：配置 `models.json`。** 以下是一个兼容 OpenAI Chat Completions 的最小示例：

```json
{
  "providers": {
    "bangumi-model": {
      "baseUrl": "https://example.invalid/v1",
      "api": "openai-completions",
      "apiKey": "${BANGUMI_MODEL_API_KEY}",
      "models": [{ "id": "your-model" }]
    }
  }
}
```

- `bangumi-model`：自定义的提供方名称，后面的 `settings.json` 使用相同名称。
- `baseUrl`：替换为提供方实际接口根地址，不带末尾的 `/chat/completions`。
- `api`：此示例使用 `openai-completions`，接口必须支持对应协议。
- `apiKey`：引用环境变量；保留 `${BANGUMI_MODEL_API_KEY}` 中的 `$`，不要写成裸变量名。
- `id`：替换为提供方实际支持的模型 ID。

`example.invalid` 和 `your-model` 都是占位符，必须替换。API Key 只在本机输入，不提交到仓库或发送到聊天。

**第三步：在本机隐藏输入 API Key。** 在之后用于启动程序的同一个 PowerShell 窗口执行：

```powershell
$piSecret = Read-Host '模型 API Key' -AsSecureString
$env:BANGUMI_MODEL_API_KEY = [System.Net.NetworkCredential]::new('', $piSecret).Password
Remove-Variable piSecret
```

输入不会显示，密钥不写入命令历史。此环境变量只对当前窗口及其子进程有效，新开窗口需要重新输入。如果已经有长期配置的本机环境变量，可直接在 `models.json` 中引用它的名称。

**第四步：配置 `settings.json`。** 在同一个 PowerShell 窗口打开：

```powershell
notepad (Join-Path $piConfigDir 'settings.json')
```

新文件可使用以下内容；已有文件只合并这些字段，保留其他设置：

```json
{
  "defaultProvider": "bangumi-model",
  "defaultModel": "your-model",
  "defaultThinkingLevel": "off"
}
```

| 字段 | 含义 |
| --- | --- |
| `defaultProvider` | 默认提供方，与 `models.json` 中的提供方名称一致。 |
| `defaultModel` | 默认模型，填写模型 ID，与上例的 `id` 一致。 |
| `defaultThinkingLevel` | 默认思考强度，`off` 表示关闭；其他级别以模型支持范围为准。 |

`settings.json` 保存启动偏好，API Key 仍由环境变量提供。修改文件后重启程序，新会话会使用这些默认值；恢复历史会话时，会话自身记录的模型和思考设置可能优先。已有的 `modelThinkingLevels` 还可以为指定模型设置思考强度，并优先于全局默认。

配置完成后，在 `bangumi/` 目录执行 `npm start -- web` 或 `npm start` 即可。也可以临时指定启动模型：

```powershell
npm start -- --model bangumi-model/your-model
```

CLI 中可通过 `/model` 打开模型选择器，在选择器内按 `Ctrl+S` 将选中项保存为默认模型。Web 中选择模型会更新当前会话，并保存到 `settings.json` 作为启动默认模型。Web 的思考强度选择会保存到本机配置的 `defaultThinkingLevel`，作为全局默认值。

## 3、致谢

- [Pi](https://github.com/earendil-works/pi)：提供模型接入、对话循环、会话管理和终端交互能力。
- [Bangumi](https://bgm.tv/) 与 [Bangumi API](https://github.com/bangumi/api)：提供作品、章节、人物、目录和收藏相关的数据与服务。
- 本项目使用的开源依赖及其维护者。

Pi 使用 MIT 许可证；本项目 Bangumi 应用源码使用 AGPL-3.0-only 许可证，详见 `pi/LICENSE` 与 `bangumi/LICENSE`。
