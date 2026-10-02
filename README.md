# MyBangumiAssistant · Pi

独立迁移工程。`pi/` 为官方 Pi 的固定源码，`bangumi/` 为登录、MCP 和契约扩展。
对话循环、会话、压缩、模型选择和终端界面均使用 Pi 原生能力。旧项目保持独立。

## 安装与运行

需要 Node.js `>=24.14.0 <25`、npm、Git 与 curl。Pi 子模块固定为 `9fba660cf1caca0ade5bea72269352416e595a19`，保留官方源码和许可证。

从 `pi` 分支克隆并执行固定源码初始化：

```powershell
git clone --branch pi --recurse-submodules https://github.com/KasLee14/MyBangumiAssistant.git
cd MyBangumiAssistant
node bootstrap-pi.mjs --proxy http://127.0.0.1:7890
cd bangumi
npm start
```

初始化脚本安装锁定依赖、验证固定模型目录 SHA-256、运行官方 hydrate 与 Pi 原生离线构建，再构建 Bangumi 应用。已有缓存仍会核对哈希。未递归克隆时，脚本会初始化固定子模块；不使用 GitHub ZIP 代替 Git 克隆。

初始化的 `--proxy` 可省略。应用运行时自动发现标准环境和 Windows 代理，`--proxy` 显式指定，`--direct` 显式直连，不自动换线路。

默认运行数据目录为 `%LOCALAPPDATA%/MyBangumiAssistant-Pi`；用 `--data-dir` 或 `BANGUMI_PI_HOME` 单独指定。不会自动读取旧项目的配置、会话或登录文件。

## 配置模型

模型采用 Pi 配置：运行数据目录内的 `pi/models.json`、`pi/settings.json` 和模型凭据。密钥优先用环境变量引用，不放进聊天或项目源码。可用 `--provider`、`--model`，以及 Pi 的 `/model` 切换。

兼容端点配置可从 `bangumi/config/models.example.json` 开始，替换占位地址和模型名；`apiKey` 使用 `${BANGUMI_MODEL_API_KEY}` 形式引用环境变量（必须带 `$`），真实值只设置在本机环境。示例地址不能直接发起请求。

### 1. 创建或打开配置

先进入 `bangumi/`，在 PowerShell 中执行。已有配置不会被示例覆盖：

```powershell
$piConfigDir = Join-Path $env:LOCALAPPDATA 'MyBangumiAssistant-Pi\pi'
if ($env:BANGUMI_PI_HOME) { $piConfigDir = Join-Path $env:BANGUMI_PI_HOME 'pi' }
New-Item -ItemType Directory -Force -Path $piConfigDir | Out-Null
$piModelFile = Join-Path $piConfigDir 'models.json'
if (!(Test-Path -LiteralPath $piModelFile)) {
    Copy-Item -LiteralPath .\config\models.example.json -Destination $piModelFile
}
notepad $piModelFile
```

在 `models.json` 中替换兼容接口根地址与真实模型 ID：

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

`baseUrl` 不带末尾的 `/chat/completions`，也不能把 Anthropic 端点配给 `openai-completions`。`id` 必须是提供方实际支持的模型名。`example.invalid` 和 `your-model` 只是占位符，必须替换。环境变量名必须使用 `$NAME` 或 `${NAME}`，裸变量名会被当成实际密钥字符串。

### 2. 在本机隐藏输入密钥

若尚未设置对应环境变量，在启动程序的同一个 PowerShell 窗口执行：

```powershell
$piSecret = Read-Host '模型 API Key' -AsSecureString
$env:BANGUMI_MODEL_API_KEY = [System.Net.NetworkCredential]::new('', $piSecret).Password
Remove-Variable piSecret
```

输入不会显示，密钥不写进命令历史或配置文件。此设置只对当前窗口及其子进程生效；新开窗口需要重新输入。若已有长期环境变量，直接在 `apiKey` 中引用其名称即可，不必复制或重复输入。不要把真实密钥填进项目示例或发送到聊天。

### 3. 启动、选择与保存默认模型

把 `your-model` 换成配置中的模型 ID：

```powershell
npm start -- --model bangumi-model/your-model --proxy http://127.0.0.1:7890
```

可以在 Pi 中用 `/model` 切换；选中模型后按 Ctrl+S 保存默认选择。也可以编辑同目录的 `settings.json`，合并以下字段并保留原有设置：

```json
{
  "defaultProvider": "bangumi-model",
  "defaultModel": "your-model",
  "defaultThinkingLevel": "off"
}
```

设置默认后执行 `npm start` 即可。代理自动发现仍生效；`--proxy` 显式指定，`--direct` 显式直连。`--thinking high` 或 Pi `/thinking` 可调整模型支持的思考级别。

### DeepSeek 本机接入示例

Pi固定模型目录已包含 `deepseek/deepseek-flash`。若本机已有 DeepSeek 密钥环境变量 `ANTHROPIC_AUTH_TOKEN`，可只覆盖认证和端点，保留 Pi 原生模型目录：

```json
{
  "providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com",
      "api": "openai-completions",
      "apiKey": "${ANTHROPIC_AUTH_TOKEN}"
    }
  }
}
```

对应默认选择为 `defaultProvider=deepseek`、`defaultModel=deepseek-flash`；`defaultThinkingLevel=off` 使用非思考模式。环境变量的名称不决定请求协议：Chat Completions 使用上述根地址，Claude Code 的 `/anthropic` 地址及 `[1m]` 模型后缀不能原样复制到这里。该配置不改动 Claude Code 或其密钥。模型名、协议地址及思考开关见 [DeepSeek 官方文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

只有 `/model` 能识别模型、凭据引用能解析并不能证明网站请求成功；首次真实请求的兼容性和认证结果需单独核实。

## Bangumi 登录

Bangumi 使用专用命令：

- `/bangumi-login`：独立邮箱、隐藏密码和浏览器验证码。
- `/bangumi-login manual`：使用本地验证码辅助。
- `/bangumi-login-status`：本地登录状态，不代表在线认证成功。
- `/bangumi-logout`：仅清除本应用保存的 Bangumi 会话。

邮箱和密码在独立组件中输入，不经过模型、共享编辑器或普通会话。登录后的会话使用 Windows DPAPI 保存。

## 工具与修改

保留固定55项 MCP 工具与同源输入/输出契约。普通请求直接由 Pi 主模型理解并组合工具，没有前置分类器或自写对话状态机。

**每次写入均使用 Pi 进行具体确认。** 提交绑定账户、对象和参数；确认后若原文、账户或现状改变则失效。结果以独立回读为准，超时/取消仍核查，未知不重发。非交互入口不自动同意写入。

长预览按窗口分页；查看完整内容后，在末页按 → 选择确认，再 Enter 提交。默认取消，Esc 可随时取消。

原生终端的缓存、日志和会话在首次加载Pi之前就固定到隔离目录。默认关闭启动工具下载和更新检查，模型与Bangumi网络请求仍按配置工作。

条目取消收藏、社区写入和本地补充进度仍未开放。旧终端布局、宿主统计/便利进度封装和历史格式不强制兼容。

## 生产检查与验证边界

在 `bangumi/` 执行：

```powershell
npm run typecheck
npm run build
```

公开分支仅包含安装、构建和运行所需文件。本地开发测试、规划文档和机器来源清单不发布，不提供缺失测试材料的 `npm test`。迁移实现已有128项本地离线验证及Windows终端冒烟证据；真实模型、登录和网站持久化仍待验收。

Pi 上游为 MIT；迁入的 Bangumi 应用源码保留 AGPL-3.0-only。两者许可证分别保留。
