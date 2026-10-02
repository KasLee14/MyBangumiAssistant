# MyBangumiAssistant

用自然语言查询 Bangumi 作品、管理个人收藏和更新观看或阅读进度的本地 CLI Agent。

支持动画、书籍、音乐、游戏和三次元；可以连续对话、选择同名作品、切换模型，并在复杂修改前查看具体预览。Bangumi 操作复用 [bgm-cli](https://github.com/aronnaxlin/bgm-cli)，对话编排使用自建轻量核心。

> 当前为开发试用版，主要支持 Windows。OAuth 登录、收藏和进度执行链路已接入；真实 OAuth 授权及账户读写仍待联调。首次登录配置引导和通用模型参数兼容仍有待完善。

## 快速开始

### 运行要求

- Node.js `>=24.14.0 <25`，项目锁定版本为 `24.14.0`。
- npm 和 Git。
- Windows 与可用的默认浏览器。当前账户凭据保护使用 Windows DPAPI，其他系统的账户功能尚不支持。
- 对话功能需要支持工具调用和流式响应的模型 API；独立查询命令不需要模型密钥。

### 安装

当前从源码运行：

```powershell
git clone https://github.com/KasLee14/MyBangumiAssistant.git
cd MyBangumiAssistant
npm ci
npm run build
npm start -- --help
npm start -- doctor
```

已经取得源码时，从 `npm ci` 开始即可。`npm start` 使用构建产物，修改源码后需重新运行 `npm run build`。项目暂未发布 npm 包，不提供全局安装或 `npx` 安装方式。

### 开始对话

完成下方模型配置后运行：

```powershell
npm start -- chat
```

也可以只提一个问题：

```powershell
npm start -- ask '搜索葬送的芙莉莲，列出三个候选及链接'
```

个人收藏、统计、个人进度及修改操作需要先登录 Bangumi；公开搜索、作品详情和公开章节查询通常不需要登录。

## 模型配置

可以配置兼容当前请求与响应协议的 API 地址，使用不同提供方和模型，并手动切换。当前接入的是 **Chat Completions 协议**，用于 Agent 的服务还需支持 **SSE 流式响应和工具调用**；DeepSeek 只是一个配置示例。

先查看用户配置文件的位置：

```powershell
npm start -- doctor
npm start -- config
```

Windows 默认配置文件为 `%APPDATA%\BangumiAgent\config.json`。新建或编辑该文件，下面是一个最小示例：

```json
{
  "activeModel": "default",
  "models": {
    "default": {
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-flash",
      "apiKeyEnv": "BANGUMI_MODEL_API_KEY"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `activeModel` | 默认使用的配置名称，对应 `models` 中的键 |
| `baseUrl` | 服务的 API 基础地址，例如 `https://api.deepseek.com`；某些服务需要带 `/v1` |
| `model` | 提供方实际支持的模型 ID |
| `apiKeyEnv` | 保存 API Key 的环境变量名称，配置文件只保存名称 |

程序在 `baseUrl` 后追加 `/chat/completions`，不要填写完整请求地址。当前不支持 `/responses` 或 `/anthropic` 协议；模型名称应使用真实 ID，不附加其他客户端专用的后缀。

在启动应用的 PowerShell 窗口中提供模型密钥：

```powershell
$env:BANGUMI_MODEL_API_KEY = '<你的 API Key>'
npm start -- chat
```

此设置只对当前窗口及其子进程生效，也可以使用本机已有的用户环境变量。不要把真实密钥写进配置文件、源码或对话；程序不会自动加载 `.env` 文件。

添加模型时，在 `models` 中增加一个配置名称，填写对应地址、模型 ID 和密钥环境变量名。启动时选择配置：

```powershell
npm start -- chat --model default
npm start -- ask '查询葬送的芙莉莲的详情' --model default
```

聊天中输入 `/model` 打开模型菜单，或用 `/model 配置名称` 直接切换。配置在启动时读取，编辑文件后请重启应用。

基础配置不需要填写 `thinking`。当前实现仍会自动发送这一扩展参数（省略时为 `disabled`），部分兼容服务可能拒绝或忽略；改为按需发送尚待实现。

## 代理配置

应用启动时自动发现代理，优先级为：

```text
config.json 中显式设置的 proxy
→ BANGUMI_AGENT_PROXY
→ HTTPS_PROXY / HTTP_PROXY
→ Windows 当前用户已启用的固定系统代理
→ 直连
```

通常无需额外配置。需要显式指定本机代理时：

```powershell
$env:BANGUMI_AGENT_PROXY = 'http://127.0.0.1:7890'
npm start -- doctor
```

也可以使用标准环境变量，且不要同时设置更高优先级的应用代理：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY = 'localhost,127.0.0.1'
```

标准变量支持大小写，小写优先，并遵守 `NO_PROXY`；Windows 系统代理使用自己的绕过规则。标准变量按目标协议分流，仅设置 `HTTP_PROXY` 时也用于 HTTPS。

配置文件中省略 `proxy` 表示自动发现；设置 `"proxy": null` 表示明确直连；填写 HTTP/HTTPS 地址表示强制使用该代理。显式应用代理不采用标准变量的绕过规则。

`doctor` 显示代理来源及规则，聊天中的 `/status` 显示当前模型和 Bangumi 请求的实际路由。模型请求、Bangumi API 与 OAuth Token 交换共享应用代理；浏览器授权网页使用浏览器自己的网络设置。Git 和 npm 也有独立的代理设置。

代理配置修改后需要重启应用。所选代理发生故障时不会自动换线路或直连，也不会通过换线路重发写入。

<a id="bangumi-认证与进度限制"></a>

## Bangumi 登录

登录入口统一使用 CLI 的 `login`，或聊天中的 `/login`：

```powershell
npm start -- login
```

应用会打开默认浏览器中的 Bangumi OAuth 授权页面，可使用浏览器已有的登录状态。授权后返回本地回调，程序交换 Token、核实账户，并使用 Windows 当前用户 DPAPI 保护保存。不需要向 Agent 提供账户密码、Cookie 或 Token。

> 首次 OAuth 应用配置的 CLI 引导尚未完成。当前开发快照仍依赖预先提供的应用配置；缺少配置时会返回 `OAUTH_CONFIG_REQUIRED`，无法继续授权。完整的首次登录流程将在发布前补齐。

| 命令 | 用途 |
| --- | --- |
| `npm start -- login` | 核实已有登录，必要时发起浏览器授权 |
| `npm start -- login --force` | 强制重新授权或切换账户 |
| `npm start -- login-status` | 查看本机保存的登录信息，不验证网站 |
| `npm start -- auth-check` | 在线只读验证当前账户，必要时刷新凭据 |
| `npm start -- logout` | 清除本机登录，不注销网站其他会话 |

旧 bgm-cli 登录或旧网页登录不会自动导入本应用。凭据与当前 Windows 用户及本机绑定，换电脑或用户后需要重新授权。Token 刷新失败时停止个人请求，不自动重新登录或重发账户修改。

## 当前支持功能

下表列出当前实现的能力；代码和离线验证不代表真实账户线上验收已完成。

| 功能 | 支持范围 |
| --- | --- |
| 作品搜索与详情 | 动画、书籍、音乐、游戏、三次元，返回条目 ID 和网站链接 |
| 个人收藏查询 | 单条目查询、五类分页列表、媒体和收藏状态筛选 |
| 收藏统计 | 数量、各状态数量、个人评分分布及有效评分平均分 |
| 收藏字段修改 | 状态、评分、标签、最终短评、公开/私密，修改前读取现状并保留其他字段 |
| 动画与三次元进度 | 主线累计、单集、明确指定的特殊章节、回退与清空 |
| 书籍进度 | 章数与卷数分别查询、更新、降低或清零 |
| 音乐与游戏 | 收藏状态和字段管理，当前不支持细粒度进度 |
| 多轮对话 | 候选消歧、编号和作品指代、补全未完成请求 |
| 操作确认与结果核查 | 复杂变更先预览确认；写入后回读，区分成功、失败、未知及未开始 |
| 会话和模型 | 手动切换模型、保存并恢复已完成对话，不重放工具和旧授权 |

条目取消收藏暂未开放。个性化动画推荐、长期偏好和查询缓存尚未实现；首版不包含社区功能或本地自定义进度。

## 使用案例

### 查询作品和章节

无需模型密钥即可使用独立命令：

```powershell
npm start -- search '葬送的芙莉莲' --type anime --limit 3
npm start -- subject 400602
npm start -- episodes 400602 --limit 20 --offset 0
npm start -- episodes 400602 --all
```

搜索及章节查询每页最多20项；章节结果中的 `nextOffset` 用于翻页。`--all` 最多汇总100页/2000项，不能与 `--limit` 或 `--offset` 同用。分页异常或中途失败不会被当作完整清单。

### 查询个人收藏和统计

登录后运行：

```powershell
npm start -- collection 400602
npm start -- collections --type anime --status in_progress --limit 20
npm start -- collection-summary
npm start -- collection-summary --type book --json
npm start -- progress 400602
```

媒体参数：`anime` 动画、`book` 书籍、`music` 音乐、`game` 游戏、`real` 三次元。

收藏状态：`wish` 计划、`completed` 已完成、`in_progress` 进行中、`on_hold` 搁置、`dropped` 抛弃；分别对应想看/想读等网站含义。

统计使用当前账户可读取的现存收藏，包括可读取的私密项，不包含已删除历史。已完成依据收藏状态，不根据章节推断；个人评分0为未评分，平均分只包含1～10分的有效评分，并报告样本数。完整统计最多读取10000项，失败不输出局部全量统计，也不保证网站原子快照。

### 连续对话与消歧

启动 `npm start -- chat`，在同一个会话中输入：

```text
搜索葬送的芙莉莲，列出三个候选
第一项
查看它的详情
查询我的五类收藏统计
列出我正在看的动画
```

有多个候选时，使用方向键和 Enter 选择，或回复编号、完整作品名。选择后继续原任务；选择作品本身不授权修改。

### 修改收藏和进度

以下为会修改账户的输入示例，执行前请确认条目 ID 和目标值：

```text
把#400602评分改为8分
把#400602看到第8集了
把这部第9集看过
把这部退回第5集
```

书籍可以使用“把#条目ID读到第3卷了”，将“条目ID”替换为真实数字。

明确且无额外影响的单项修改可直接执行；批量、降低或清空进度、公开/私密变化及未指定字段的附带影响，必须先展示具体变更再确认。可以回复“确认执行”或“取消”，也可以操作终端确认卡。这里仅展示输入方式，不代表这些条目已完成真实写入验证。

“看到第N集”累计标记现有主线1～N，不清除后续；“第N集看过”只改指定主线。特殊章节需明确章节 ID。到达末集不自动改变收藏状态，未收藏时先选择要创建的收藏状态。

回退只将后续主线已看状态改为未看；清空会移除全部章节状态，包含特殊章节和其他状态。书籍章数、卷数独立。多章节更新可能部分成功，未知结果先核对网站，不自动重试或回滚。

只检查收藏字段的变更、不提交时，可以使用独立预览命令：

```powershell
npm start -- preview 400602 '{"rate":8}' --json
```

预览需要登录并读取现状；单次命令退出后不保留授权，要执行修改需在 `chat` 中重新提出请求。

### 保存和恢复对话

```powershell
npm start -- sessions
npm start -- chat --resume '<会话ID>'
npm start -- ask '第一项的详情' --resume '<会话ID>'
```

将占位符替换为已有会话 ID。恢复只采用已完成轮次及候选，不重放工具、恢复旧预览授权或执行此前未完成的修改；需要修改时重新提出请求。

## 终端操作

终端上方保留可滚动、可复制的对话，底部显示活动、草稿和快捷提示；启动横幅显示版本、当前模型和 Bangumi 用户名。

| 操作 | 按键或命令 |
| --- | --- |
| 发送 / 换行 | Enter / Ctrl+J；终端支持时可用 Shift+Enter |
| 多行粘贴 | 保留为可编辑草稿，不自动发送 |
| 命令候选 | 输入 `/` 自动展开；↑↓选择、Tab补全、Enter执行，Esc收起 |
| 登录 / 状态 | `/login` / `/status` |
| 模型 / 会话菜单 | `/model` / `/sessions` |
| 新会话 / 帮助 | `/new` / `/help` |
| 停止本轮 | 运行时 Esc 或 Ctrl+C |
| 退出 | `/exit`，或空闲时两次 Ctrl+C |

需要普通文本界面时使用 `npm start -- chat --plain`。脚本调用使用 `ask` 和独立命令；支持的命令可加 `--json`，具体参数以 `npm start -- --help` 为准。

已经发送写入时，停止本轮后仍需等待独立回读核查；取消不代表撤销网站修改。

## 致谢与许可证

- [Bangumi](https://bgm.tv/)：作品资料和个人收藏服务。
- [bgm-cli](https://github.com/aronnaxlin/bgm-cli)：CLI 操作基础及数据转换。
- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：对话编排的架构参考。

本项目采用 [AGPL-3.0-only](LICENSE)
