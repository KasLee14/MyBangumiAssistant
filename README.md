# MyBangumiAssistant

MyBangumiAssistant 是一个在本地运行的 Bangumi AI 助手。通过自然语言，你可以查询作品、获取推荐，以及管理自己的收藏、评分、标签、观看进度和目录。它提供浏览器 Web 界面和命令行 CLI，两种入口使用同一套模型配置、工具和会话管理能力。

例如，你可以直接说：

- “推荐几部我没看过的高分搞笑动画。”
- “把《某部动画》第 3 集标记为看过。”
- “创建一个目录，把这些作品加入进去。”

## 1、部署与启动

### 准备环境与安装

当前以 Windows 为使用环境，需要 **Node.js `>=24.14.0 <25` 和 npm**。下文命令均在 PowerShell 中执行。

在项目根目录执行一次初始化：

```powershell
node bootstrap-pi.mjs
```

Pi 源码和固定版本的模型目录已包含在本仓库中。脚本会校验内置模型目录、安装 npm 依赖，然后构建本地 Pi、Bangumi 应用和 Web 界面；不会克隆 Pi 仓库或下载模型目录。npm 依赖安装仍需联网。

`pi/` 是由本项目自主维护的源码目录，可以直接修改并随本仓库提交，不会自动跟随上游升级。源码来源及维护方式见 [本地 Pi 维护说明](pi/LOCAL-MAINTENANCE.md)。

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

在 `%LOCALAPPDATA%\MyBangumiAssistant-Pi\pi` 中手动创建以下两个文件（目录不存在时先创建）。

**1. 创建 `models.json`，填写接口地址、API Key 和模型 ID。** 以下示例适用于兼容 OpenAI Chat Completions 的接口：

```json
{
  "providers": {
    "bangumi-model": {
      "baseUrl": "https://example.invalid/v1",
      "api": "openai-completions",
      "apiKey": "your-api-key",
      "models": [{ "id": "your-model" }]
    }
  }
}
```

将 `baseUrl` 替换为实际接口根地址（不带末尾的 `/chat/completions`），`your-api-key` 替换为你的密钥，`your-model` 替换为实际模型 ID。`bangumi-model` 是可自定义的提供方名称。

**2. 创建 `settings.json`，指定默认模型。**

```json
{
  "defaultProvider": "bangumi-model",
  "defaultModel": "your-model",
  "defaultThinkingLevel": "off"
}
```

`defaultProvider` 与上面的提供方名称一致，`defaultModel` 与模型 `id` 一致；`defaultThinkingLevel` 可选，`off` 表示关闭思考。

## 3、执行轨迹与 MCP 分析

每次 Agent 执行默认在应用数据目录的 `tracelog` 中保存独立轨迹，与 Pi 的完整会话文件分开。轨迹包括实际 prompt、API 可见思考、模型工具及宿主内部 MCP 调用、写入回读和最终输出；多会话各自保存，后台标题另行记录。

每份轨迹包含 `events.jsonl`、`summary.json` 和 `payloads/`，摘要直接提供调用次数、耗时、结果体积、搜索增量和重复查询等分析。凭据和宿主授权对象会在落盘前脱敏。

在 `bangumi/` 目录运行：

```powershell
npm start -- web --trace off
npm start -- web --trace-dir "E:\BangumiTrace"
npm start -- trace-analyze "E:\BangumiTrace\2026-10-04\SESSION_ID\TRACE_ID"
```

日志开关独立于 `--no-session`。目录配置、完整字段、格式和覆盖范围见 [Tracelog 说明](bangumi/TRACING.md)。

## 4、收藏范围查询与账户权限

“整理我看过的 2026 年 4 月开播动画”使用 `query_user_collections`：宿主按动画、看过状态和开播日期范围完整分页，只向模型返回匹配项、排序及覆盖情况。明确补入的跨月作品单独核实，未知日期会使完整性标记为 false。收藏更新时间不能代替开播日期。

登录后，Bangumi 操作统一先核实当前账户及 NSFW 权限。本人收藏使用账户接口保留私密记录；第三方资料仍限于该用户公开范围。认证失效、网络失败或预检失败不会自动降级匿名查询。未登录的公开收藏范围查询可使用网页开播日期倒序，在严格越过日期下界后停止，同日跨页仍完整读取。

工具结果的 `accessContext.nsfw` 分别报告显示偏好 `preference`、实际权限 `allowed`，以及 `enabled`、`disabled`、`unknown` 状态；偏好开启不等于具有权限。全站搜索和浏览默认保留账户范围：NSFW开启时，日期、小数评分、评分人数等上游不可靠筛选，以及遗漏R18摘要的浏览明确返回 `SEARCH_CAPABILITY_UNSUPPORTED`，不忽略条件或自动换成匿名结果。仅用户明确排除R18时提供 `nsfw=exclude`；NSFW本已关闭或未登录时，也可查询非R18范围。`accessContext.queryCoverage` 报告实际范围、NSFW覆盖、估计总数及来源限制，搜索 `page.complete` 只表示源内分页耗尽。修订资料仍使用公开来源并标记限制。这些操作均先完成账户预检，应用不会自动修改NSFW开关。完整契约见 [MCP工具文档](bangumi/mcp.md)。

写入批次的 `failures` 列出各失败的阶段、原步骤编号、操作、对象和来源读取工具，`failure` 兼容首项。`summary` 分别计数已核实、无需修改、跳过、失败、未知、依赖阻塞和未执行；`stageResults` 保留复合操作的子项结果。`networkAttempted` 与 `writeNetworkAttempted` 均仅指写入尝试；`skipped`、`blocked` 或所有步骤 `not_executed` 不表示创建步骤失败，也不表示预检没有发送读取请求。社区正文与分页引用绑定读取时的账户及 NSFW 权限，权限改变后需要重新读取来源。

## 5、致谢

- [Pi](https://github.com/earendil-works/pi)：提供模型接入、对话循环、会话管理和终端交互能力。
- [Bangumi](https://bgm.tv/) 与 [Bangumi API](https://github.com/bangumi/api)：提供作品、章节、人物、目录和收藏相关的数据与服务。
- 本项目使用的开源依赖及其维护者。

Pi 使用 MIT 许可证；本项目 Bangumi 应用源码使用 AGPL-3.0-only 许可证，详见 `pi/LICENSE` 与 `bangumi/LICENSE`。
