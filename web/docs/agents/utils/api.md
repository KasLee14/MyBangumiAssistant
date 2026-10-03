# 宿主接口封装（`utils/api.ts`）

## 使用说明

### 这份文档是什么

宿主接口的唯一封装：`post` 的错误语义、全部端点清单、SSE 订阅的生命周期，以及向这里加端点的步骤。

上层：[readme.md](readme.md)。调用方是 [../store/actions-and-operations.md](../store/actions-and-operations.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §`post` 封装与错误语义 | 想知道失败时抛出什么、由谁处理 |
| §端点清单 | 找某个功能对应的端点与载荷 |
| §`openStream`（SSE） | 动订阅生命周期、改帧处理入口时 |
| §规则 | **加端点前必读**（四步清单 + 四条约束） |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **只做请求，不做提示** —— 违反后果：错误在多处重复提示，或调用方无法感知失败（见本层「错误只抛出、不提示」）。
2. **不加缓存**：`fetchCatalog` 每次真取 —— 违反后果：缓存与"何时重取"出现第二个来源。
3. **不在前端写鉴权代码** —— 违反后果：泄漏面扩大（令牌由宿主地址换 Cookie，或由 dev server 注入）。
4. **新增端点四步齐全**（协议类型 → 本篇薄函数 → `operations` 动作 → 两处表格）—— 违反后果：类型或提示缺失。

## 定位

**浏览器与宿主之间的唯一通道。** 所有请求都是同源相对路径 `./api/...`——开发模式下由 Vite 的 `/api` 反代转给宿主（见 [dev-web 说明](../../../AGENTS.md)），生产模式由宿主自己静态托管，两种形态下都不需要 CORS 配置。

## `post` 封装与错误语义

```ts
async function post<T>(path: string, body: T): Promise<void>
```

- 成功（2xx）：返回 `void`，不解析响应体；
- 失败：尝试读 `ApiErrorView`，把 `message` 包成 `Error` 抛出；读不出体时退化成 `请求失败（HTTP <status>）。`。

**授权判定全在宿主**：浏览器不做任何权限判断，只负责发起与呈现。因此这里的错误一律是"宿主拒绝或出错"，前端不据此推断状态。

## 端点清单

| 函数 | 端点 | 载荷 | 说明 |
|---|---|---|---|
| `submitInput(input)` | `POST /api/submit` | `SubmitPayload` | 提交一轮输入 |
| `cancelRound()` | `POST /api/cancel` | `{}` | 停止本轮 |
| `answerConfirmation(id, accepted)` | `POST /api/confirm` | `ConfirmPayload` | 写入确认：`accepted: false` 即拒绝 |
| `submitLoginInput(payload)` | `POST /api/login-input` | `LoginInputPayload` | 凭据弹窗的一次性输入；取消时带 `cancelled: true` |
| `startLogin(email, password)` | `POST /api/login` | — | 设置弹窗里的显式登录；请求会一直挂到登录结束 |
| `cancelLogin()` | `POST /api/login-cancel` | `{}` | 中止进行中的显式登录（关弹窗时调用） |
| `logout()` | `POST /api/logout` | `{}` | 只清本应用保存的 Bangumi 会话 |
| `selectModel(provider, model)` | `POST /api/model` | `ModelPayload` | 切模型；宿主同时写成本机默认模型 |
| `selectThinkingLevel(level)` | `POST /api/thinking` | `ThinkingPayload` | 切思考强度；宿主写成本机默认级别 |
| `selectSession(path?)` | `POST /api/session` | `SessionPayload` | 不传 `path` = 新建；传 = 恢复 |
| `submitCredential(provider, key, persist)` | `POST /api/credentials` | `CredentialPayload` | `persist: true` 写入本机 `auth.json`，否则只注本次运行 |
| `clearCredential(provider)` | `POST /api/credentials/clear` | `ClearCredentialPayload` | 只删 `auth.json` 里的条目，环境变量与 `models.json` 不受影响 |
| `submitProxy(mode, url?)` | `POST /api/proxy` | `ProxyPayload` | `auto` / `direct` / `manual`（manual 才需要 `url`） |
| `fetchCatalog()` | `GET /api/catalog` | — | 取模型、会话、命令、提供方与能力开关；非 2xx 抛 `Error` |
| `openStream(handlers)` | `GET /api/events` | — | SSE 订阅，见下 |

载荷类型全部来自 `bangumi/src/web/protocol.ts`，前端不复制。

## `openStream`（SSE）

```ts
export interface StreamHandlers {
  onFrame(frame: ServerEvent): void;   // 每一帧
  onStatus(connected: boolean): void;  // open / error
}
export function openStream(handlers: StreamHandlers): () => void;  // 返回清理函数
```

- `EventSource` 自带重连，宿主重启后会自己接回，因此**不需要前端做重试逻辑**；
- 单帧 JSON 解析失败被静默跳过，不影响后续帧；
- 返回的清理函数就是 `source.close()`——由 [../store/hooks-and-stream.md](../store/hooks-and-stream.md) 在订阅 hook 卸载时调用；
- 订阅只在主界面挂载期间存在：页面不挂载就不会建立连接。

## 规则

1. **只做请求，不做提示**：不要在这里 `dispatch` 或 `console` 用户可见文案；错误一律抛出，由 `operations.ts` 决定提示还是让调用方显示在表单里。
2. **不缓存**：`fetchCatalog` 每次真取；缓存与"何时重取"是 store 的职责。
3. **不加鉴权代码**：令牌通过宿主打印的地址换取 HttpOnly Cookie（生产）或由 dev server 注入 `x-bgm-token`（开发），前端代码里不出现令牌。
4. **新增端点**：① 在 `protocol.ts` 加载荷类型；② 在这里加一个薄函数；③ 在 `store/operations.ts` 的 `Actions` 里加动作（并决定 `notifyFailure` 还是 `notifyOnly`）；④ 更新本文件与 [../store/actions-and-operations.md](../store/actions-and-operations.md) 的表格。
