# 个人条目收藏删除能力与证据

- 核实日期：2026-10-02
- 当前状态：用户最新决定先做 OAuth 主登录，条目取消收藏暂不开放。旧网页认证/删除适配已移除，工具、CLI、宿主计划和实际执行入口阻止删除；后续方式另行讨论。本文保留接口与历史方案证据，不代表当前可执行能力。
- 范围：从本账户收藏移除作品，覆盖动画、书籍、音乐、游戏、三次元；不删除公共作品条目，不修改目录、角色或人物收藏。

## 1. 官方 API 核实

读取 [bangumi/api](https://github.com/bangumi/api) 的 README、两个 OpenAPI 文件及[删除收藏功能请求 #15](https://github.com/bangumi/api/issues/15)。当前 `api` 提交为 `65d29cff2331e08c0110d30d515f7f1b6488f845`，接口定义见[固定版本 v0.yaml](https://github.com/bangumi/api/blob/65d29cff2331e08c0110d30d515f7f1b6488f845/open-api/v0.yaml)。

| 接口 | 当前定义 | 含义 |
| --- | --- | --- |
| `/v0/users/{username}/collections/{subject_id}` | GET | 读取单个条目收藏 |
| `/v0/users/-/collections/{subject_id}` | POST、PATCH | 新增或修改，未定义 DELETE |
| `SubjectCollectionType` | 1～5 | 想看、看过、在看、搁置、抛弃；0不是删除收藏状态 |
| `/v0/indices/{index_id}/subjects/{subject_id}` | PUT、DELETE | 目录内容管理，DELETE只从目录移除作品 |
| `/v0/characters/{character_id}/collect`、`/v0/persons/{person_id}/collect`、`/v0/indices/{index_id}/collect` | POST、DELETE | 角色、人物、目录收藏，不适用于个人条目收藏 |

旧 `api.yml` 当前仅定义 `/calendar`，不提供补充删除入口。`rate: 0` 删除评分、空标签数组删除标签、单集状态0移除单集记录，均不等于删除整个作品收藏。#15仍为 Open，但结论主要依据接口定义，不能仅以 issue 状态判断线上能力。

同时核实 `server-private` 提交 `fb86d54368bffe3dca79054dc24b32a35b1b1eef` 的 [p1 收藏路由](https://github.com/bangumi/server-private/blob/fb86d54368bffe3dca79054dc24b32a35b1b1eef/routes/private/routes/collection.ts) 与 [GraphQL schema](https://github.com/bangumi/server-private/blob/fb86d54368bffe3dca79054dc24b32a35b1b1eef/lib/graphql/schema.graphql)：p1条目收藏提供PUT/PATCH，GraphQL没有个人收藏删除 mutation；本机锁定 bgm-cli 1.1.2 亦无条目收藏删除方法。没有向真实账户试探 DELETE、状态0或猜测路由。

## 2. 第三方 App 的实际实现

核实 [czy0729/Bangumi](https://github.com/czy0729/Bangumi) 提交 `706ae6f82e5dfa14a507c796c3b90ad50ab380ec`：

- [doEraseCollection](https://github.com/czy0729/Bangumi/blob/706ae6f82e5dfa14a507c796c3b90ad50ab380ec/src/stores/user/action.ts#L202) 将作品ID与formhash传给 xhr。
- [HTML_ACTION_ERASE_COLLECTION](https://github.com/czy0729/Bangumi/blob/706ae6f82e5dfa14a507c796c3b90ad50ab380ec/src/constants/html/index.ts) 构造 `https://bgm.tv/subject/{subjectId}/remove?gh={formhash}`。
- [xhr](https://github.com/czy0729/Bangumi/blob/706ae6f82e5dfa14a507c796c3b90ad50ab380ec/src/utils/fetch/xhr.ts) 默认POST，携带保存的用户 Cookie 和 User-Agent。该方式复用网站处理入口，不使用官方 v0 DELETE，也不需要自动点击页面控件。
- 同仓库的 removeCollection/removeStatus 仅清理本地缓存，不能当作网站删除实现。

本轮只读研究公开源码，没有使用真实 Cookie、登录或删除作品。传统网页后端未完整开源，实际部署行为仍需单独验证。

## 3. 现有登录为何不能直接提供网页 Cookie

本机锁定 `@aronnaxlin/bgm-cli@1.1.2`，核实其 src/core/client.js、src/cli.js 与 src/utils/auth.js：

1. 登录向 `https://next.bgm.tv/p1/login` 提交邮箱、密码和 Turnstile 令牌。
2. 从 Set-Cookie 提取 `chiiNextSessionID`，只保存 privateSessionId 与更新时间，未保存完整 Cookie jar 或传统网页 Cookie。
3. 请求头只向 p1 附加该会话；set-session 即使收到完整 Cookie 字符串，也只提取 chiiNextSessionID。

官方 [登录实现](https://github.com/bangumi/server-private/blob/fb86d54368bffe3dca79054dc24b32a35b1b1eef/routes/private/routes/auth.ts) 只创建并设置新会话；[会话模块](https://github.com/bangumi/server-private/blob/fb86d54368bffe3dca79054dc24b32a35b1b1eef/lib/auth/session.ts) 区分 chiiNextSessionID 与传统 chii_auth。没有找到从新会话兑换传统网页 Cookie 的公开入口。不能通过改 Cookie 名称、保留更多响应头或修改登录成功解析来制造传统凭据；也不在客户端生成需要服务端秘密的 chii_auth。

这些是源码结论，没有拿现有真实会话向传统网站试探认证；因此不宣称已在线证明所有可能的兼容路径均不可用。

## 4. 历史方案：网页登录统一认证（已撤回）

本节记录此前实现与讨论；用户随后改为OAuth主登录，并暂停条目取消收藏。以下流程及认证适配不再运行。

官方 [认证中间件](https://github.com/bangumi/server-private/blob/fb86d54368bffe3dca79054dc24b32a35b1b1eef/routes/hooks/pre-handler.ts#L40) 明确支持传统 chii_auth，并把 User-Agent 纳入校验。由此可以考虑从传统网页登录得到 Cookie，再用于网页操作与 p1；反向兑换未找到。当前 bgm-cli 客户端不会自动发送传统 Cookie，所以统一认证需要适配读取与写入两条链路，不能只改保存字段。

| 方案 | 成本与效果 | 建议 |
| --- | --- | --- |
| 保持现有登录，只复用 chiiNextSessionID | 当前登录不会得到网页凭据，无已知兑换入口，不能据此承诺删除可用 | 不作为实现基础 |
| 保留 bgm-cli 登录，增加可选网页登录 | 对现有收藏/进度链路影响最小；首次使用删除需额外登录，之后复用网页 Cookie | 先前建议，用户未选择 |
| 传统网页登录作为主入口，网页与 p1 共用 Cookie/UA | 一次网页登录服务两类请求；新增认证入口、凭据保护与读写桥接，线上兼容仍待验收 | 用户已选择，开发及离线验证完成 |

当前实现：

1. `login` 打开应用专用 Edge/Chrome 上下文，用户在官方网页输入密码和完成验证；固定 playwright-core 1.63.0，不读取日常浏览器凭据，不要求手工粘贴 Cookie，不自动安装浏览器。登录最多等待10分钟，窗口关闭或取消后停止；成功或失败均关闭应用专用窗口。
2. 获取必要网站 Cookie 和匹配 UA，固定 bgm.tv/next.bgm.tv 主机只读核对网页与 p1 数字账户一致；握手成功才用 Windows 当前用户 DPAPI 原子保存到用户数据目录 `auth/web-session.dpapi`。不保存密码、完整浏览器状态或分析 Cookie；保存前取消或失败不替换旧凭据。
3. 新增 read-worker 查询桥接，与原写入 worker 一起复用锁定 bgm-cli 的数据转换，覆盖其请求方法发送统一 Cookie/UA；不修改 node_modules。p1 只附加 chii_auth，网页附加必要网站 Cookie，均使用匹配 UA 和固定 Referer；不发送旧 p1 会话、Access Token 或旧环境变量网页 Cookie。缺登录时公开查询仍可匿名，个人请求停止；已有过期或损坏凭据需重新登录。
4. 删除始终具体预览、宿主确认，使用当次页面动态 gh，提交前再次核对完整收藏与账户，POST 只发一次；随后回读收藏及相关章节，取消/超时不重复提交。网页重定向不跟随，删除提交只允许回到同一条目，不能把请求受理当成功。
5. 动画/三次元章节保留、改变、未知单列报告；章节核查失败保留整体未知，同时报告已核实的收藏移除字段。不额外清空章节、不自动恢复。未收藏时无需删除，不沿用恢复会话的旧授权。
6. `login-status` 仅返回保存元数据，doctor 仅检查密文文件是否存在，auth-check 在线只读核对账户；login --force 重新登录或切换账户。logout 仅清除本机密文，不承诺服务器会话注销；旧 bgm-cli 配置保留但程序内不读取。当前 DPAPI 登录保护只支持 Windows。

## 5. 当前执行状态与未验证项

- 网页删除旧环境变量方案此前撤回；本轮以统一认证重新开发，preview-delete 仅预览，chat 删除须宿主确认后执行。
- 本轮认证和删除新增11项离线测试：3项删除确认/字段及章节回读/取消用例、8项凭据保护与请求集成。实际 DPAPI 处理临时假凭据；实际查询与写入 worker 复用锁定客户端并连接假服务，证明协议与模块链路，不冒充在线验收。88项阶段检查已通过；收尾全量检查包含共享工作区的任务边界等新增用例，最终数量见开发规划。
- 本轮没有读取真实凭据、替换真实账户登录、调用真实模型或发起账户写入。未启动用户的实际登录流程，也未验证浏览器验证码兼容。
- 待验证：真实专用浏览器登录与 Cookie 采集、Cookie/UA 的 p1 兼容、传统网站部署控件、实际删除/回读及关联章节影响；测试对象与写入范围需单独授权。用户已选统一认证，认证方案不再列为待确认。

## 6. 当前暂停边界（2026-10-02）

OAuth Token只用于API收藏字段及原生进度，当前不采集网页Cookie，不开放任何条目取消收藏请求。旧preview-delete明确返回UNSUPPORTED_OPERATION；旧删除工具不注册，解析提案/计划/执行器/worker均拒绝。历史离线删除成功用例已替换为五类阻止删除及不读取账户、不写入用例；真实网站删除从未作为本次验收。
