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

## 3、致谢

- [Pi](https://github.com/earendil-works/pi)：提供模型接入、对话循环、会话管理和终端交互能力。
- [Bangumi](https://bgm.tv/) 与 [Bangumi API](https://github.com/bangumi/api)：提供作品、章节、人物、目录和收藏相关的数据与服务。
- 本项目使用的开源依赖及其维护者。

Pi 使用 MIT 许可证；本项目 Bangumi 应用源码使用 AGPL-3.0-only 许可证，详见 `pi/LICENSE` 与 `bangumi/LICENSE`。
