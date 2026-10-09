# bangumi 宿主：开发知识库

## 简介

`bangumi/` 是这个项目的**宿主侧**（Node + TypeScript，`package.json` 里 `"type": "module"`、`engines.node` 为 `>=24.14.0 <25`）。它一个人戴三顶帽子：**本地 MCP 工具层**（71 个底层 Bangumi 工具）、**Pi 会话宿主**（模型、工具循环、会话落盘全归 Pi，宿主只做注册与投影）、**Web 终端服务端**（回环 HTTP + SSE，把同一套会话状态下发给浏览器）。

它是宿主侧**唯一入口**：分层地图、`src/web/` 与前端的分界、大文件检索指引、写入链路与安全边界、运行与验证命令，以及「你要做的事 → 去哪个文件」的索引。

**不覆盖**：前端（`web/**`）的实现细节看 [../web/AGENTS.md](../web/AGENTS.md)；Pi 上游（`pi/**`）看 [../pi/AGENTS.md](../pi/AGENTS.md)。仓库根 `AGENTS.md`（被 `.gitignore` 的 `/AGENTS.md` 忽略，新克隆里没有）讲的是四层产物关系，与本文不冲突但更偏构建。

**宿主自己的三份说明**（已入库，在 [docs/](docs/) 下）：`error-diagnostics.md`（结构化错误诊断）、`provider-content.md`（原生助手混合内容）、`response-recovery.md`（宿主定向恢复契约）；执行轨迹看 [TRACING.md](TRACING.md)。

## 使用说明

- **动手之前先读 §规则 的最前面几条**（「首要规则」）：第 0 条决定你改的代码到底跑没跑起来（宿主有**四层产物**，见下）；第 1、2 条决定这套知识库能不能被信任、以及跨端类型的唯一来源在哪。
- **只想找某件事该去哪**：直接查 §索引 的「要做什么 → 去哪个文件」表，不必通读本文。
- **要动写入、授权、确认或恢复**：先读 §规则 的「写入链路与安全边界」——那里列的都是**不可绕过**的硬约束，写错了会真的改到用户账号上的数据。
- **要读大文件**：先看 §索引 的「大文件与检索指引」——`resource-schemas.ts` 单行可达数万字符，直接 `read` 一个文件就能吃掉整个上下文预算。
- **改完要跑什么**：见 §索引 的「运行与验证命令」，特别注意哪些命令**不**覆盖什么。

## 规则

### 首要规则（先读这几条）

这几条的违反后果最重，**优先级高于本文其它一切内容**。

**0. 改完 `bangumi/src` 必须重建宿主产物，否则跑的还是旧代码——而且不报错。** 宿主存在两条「读产物、不读源码」的路径：

- **Web 终端服务端**：`dev:web` 起的宿主进程读的是 `dist/src/main.js`（见 [dev-web.mjs](dev-web.mjs) 的 `HOST_ENTRY`），`npm run web` / `npm start` 同样只读 `dist/src/main.js`；[start.mjs](../start.mjs) 是唯一会按时间戳增量重建再启动的入口。
- **本地 MCP 子进程**：[mcp/client.ts](src/mcp/client.ts) 的 `LocalMcpClient` 默认以 `process.execPath` + `new URL('./server.js', import.meta.url)` 起子进程（即 `dist/src/mcp/server.js`），所以**改 `src/mcp/**` 也必须 `tsc` 重建**，否则模型手里的工具还是旧实现。

**违反后果**：前端有 HMR 会立刻生效，宿主不会——于是整条链路上只有一半更新了，症状看起来像前端 bug（实测记录：界面里没有任何过程控制行，因为宿主还是旧的投影；见 [../web/AGENTS.md](../web/AGENTS.md) §现状）。**处理**：`cd bangumi && npm run build`（= `build:web` + 宿主 `tsc` + 复制策略 Skills），或回仓库根跑 `node start.mjs`。

**1. 每次开发后都要更新对应的知识库文档。** 新增/删除/改名的源码文件、新增的约束、改动的分层边界，都要在**同一次开发里**落进本文（§规则、§索引的表）；跨到前端或写入边界的，同时更新 [../web/AGENTS.md](../web/AGENTS.md)。四段式（`简介 / 使用说明 / 规则 / 索引`）的格式规范见 [../web/docs/agents/readme.md](../web/docs/agents/readme.md) §规则。

**违反后果**：下一次对话按过期文档改错地方。知识库越用越不可信——这比没有知识库更糟。

**2. 知识库不是事实源，必须与源码交叉验证。** 本文的定位只有两条：**协助快速找到相关代码逻辑**、**保持跨对话的开发风格统一**。它不是代码的事实源（source of truth）——文档会滞后、会写错、会与源码不一致。

因此使用本文时：① **只用来定位**（按它给的路径、符号、关键词去找代码）；② **定位之后必须读源码交叉验证**，结论、参数、行为、边界一律以**当前源码**为准；③ **发现不符时向用户暴露，不要自行裁决**——禁止默默按文档改代码，也禁止默默按代码改文档后当作无事发生。

**违反后果**：把过期描述当事实依据，会直接产出错误改动；更糟的是错误会被「文档就是这么写的」掩盖，事后极难发现。

### 按需能力目录与正文发布

- 组件用途索引与加载入口在 `output/component-catalog.ts`、`output/component-tools.ts`。已明确的合法组件名可直接调用 `read_component_spec` 激活固定 `render_<组件名>`，索引负责未知用途发现和分页，不是元数据读取权限。加载只返回工具名、版本和状态，Schema只出现在下一次真实请求的工具声明。初始以及每个真实用户轮均不声明展示工具，缓存与active loadout分开管理。新生成只选择缓存成员、布局和必要说明，宿主构建严格Web props。协议新增类型而目录漏登记时 `ComponentKindCoverage` 必须编译失败。
- `output/presentation-contract.ts` 定义每个固定展示工具的闭合参数，请求声明与原始参数校验共用同一 Schema。`render_<组件名>` 一次完成缓存准备、全部依赖复核与 `before`／组件／`after` 的原子发布；`resourceRef` 是单来源快捷形式，`sources` 是有序多来源选择，两者互斥。只组合本轮已核实缓存，全部来源仍经过成员、事实版本及账户/NSFW范围校验；重复成员、错误来源和容量超限拒绝整次发布，不自动删成员或补事实。`presentation-store.ts` 每轮至多64个准备组件。
- 延期准备使用 `read_component_spec(mode='prepare')` 按需加载固定 `prepare_<组件名>` 及 `present_component`／`present_text`。`blockIndex` 仍是整个准备快照绝对下标，已有 `candidate_output` 快照可复用；旧通用 `prepare_component` 只供兼容，不常驻模型请求。
- 默认 `render_DataTable` 仅用 `columns` 描述列，避免模型同时提交两种列表示。高级 `prepare_DataTable` 与旧通用准备仍保留 `fields` 快捷形式及 `fields/columns` 互斥守卫；不默默接受默认工具未声明的别名。
- `output/reply-assembler.ts` 为真实用户回合维护稳定 `replyId`、完成前缀和完整 `bangumi/presentation` 记录。原始模型审计保持，source marker 不重复投影正文。open 快照进入既有 Web `liveContent`，终态为唯一助手 `content`，回放共用同一记录。`final` 仅登记明确结束意图：Pi `finishTurn` 在整批工具调用完成且全部成功、所属回合仍有效时才提交并结束，不再要求模型另发收尾确认。失败、取消、length、空正文及未完成写入不能借 `final` 变成成功；普通原生文字仍只有正常 stop 后进入完成前缀。
- 明确提交成功另保存 `bangumi/presentation_commit` 内部凭证，含所属回答、真实批次调用ID/名称和 `all_tools_succeeded`；它不进入模型或Web正文。benchmark结合该凭证、canonical completed与实际call/result配对判断tool finish，不能只凭模型final参数推断。渲染后晚取消由finishTurn的真实signal判定aborted，保留完成前缀，不依赖下一模型错误帧。
- `output/model-context.ts` 与 `output/presentation-history.ts` 仅投影模型请求，不改写原 JSONL、trace 或 canonical 正文。完整可见且已完成的真实用户回合，把无签名绑定的纯展示 toolCall/toolResult 成对归并，在原可见来源处保留一份文字、组件身份、顺序和追问所需可见事实；业务读写及具体错误证据保持。绑定思考签名的调用组保守保留原位，摘要引用已有文字而不再复制。可见表格单元格和 LinkList 地址是展示事实，不按内部字段名删掉；历史引用标明不可重用，不能删原调用必填字段形成畸形成功样本。完整来源指纹不一致或压缩移除来源后，不用宿主记录复活旧回答。
- 文字定位与操作成功是两层证据。已保留、成对可见且结果可解释的失败展示调用，可提供与canonical完全相同的浅层创作字符串位置，并明确原操作error/unknown；它不会变成成功发布、缓存事实或签名依据。失败调用、必填引用及具体诊断不删，只有成功且无签名绑定的展示对可折叠。损坏来源、信封、非字符串及无法在实际codec定位的文字不借该途径复用。
- `output/presentation-arguments.ts` 仅消费 Pi 内部 WeakMap 保存的展示工具完整原始参数；严格扫描后至多一次确定性 EOF 闭合/字符串外尾逗号修复，再通过所选组件 Schema 与业务 gate。重复键、残缺字符串/scalar、歧义、length/取消/中断拒绝；不修业务写工具、不补ID/必填、不删成员、不转换类型。审计保存为 `bangumi/presentation_arguments`，不包含 raw。展示纠参与业务恢复共享 Pi 剩余重试预算，已发布前缀不能重写，重试及重准备同内容不重复追加。
- 新用户轮须通过轻量入口激活所需工具，明确名字可直接重新加载；压缩和版本变化后不能靠历史回执隐式激活。索引仅缓存发现信息；新渲染能力由固定注册表及本次真实声明确定。事实引用及引用观测仍按用户轮、账户和NSFW范围隔离，恢复前缀不重新判缺契约。旧JSON兼容路径仍按可见同版本完整字段契约管理。
- 业务工具在本地完整登记，模型初始只声明小范围 active 工具。`mcp/tool-discovery.ts` 用中文用途、分类及可遍历索引发现后，通过 Pi active tool set 加载下一次请求的真实 Schema。`createAgentSessionFromServices.tools` 是允许能力集合，不能用初始可见集合替代，否则工具被永久排除。
- `output/recovery-loadout.ts` 把恢复能力分为业务执行与宿主展示：恢复仅保存/限制/恢复执行域，宿主目录及展示集合按精确注册角色从Pi当前active集合取得，恢复旧快照不能覆盖后来加载的组件。原生只读重规划限原许可读集，fatal/unknown禁止业务执行；宿主展示仍逐项检查已有当前缓存，不能引入新查询授权。共用 `tool_call` 与顶层guard阻断嵌套SDK旁路，引用重读按同callID/同参数最多一次；批次内部独立MCPguard与回读保持。旧JSON报告路径继续全工具限制和纯文字。
- `support/provider-tool-arguments.ts` 只按明确提供方能力处理严格采样；兼容 Schema 可启用，复杂条件契约保留明确 fallback 和完整业务校验。可选 `null` 只在已约定严格线路映回省略，未知、必填及非法字段继续拒绝。
- 解码草稿、未闭合文字及未验证引用保留在内部；正文只发布稳定完成块。恢复续接保留已完成前缀和同一真实用户回合，可恢复错误投影成 `source:host` 的独立思考过程，原诊断仍留会话与 trace。耗尽时保留前缀并如实说明未完整生成。
- 恢复前缀插在原生 leading thinking 之后，思考事件索引按真实插入位置映射，原生思考和签名不得改写。`output/deepseek-responses-replay.ts` 只在同一旧恢复消息的签名与既有 reasoning item 完全一致时纠正顺序，不能生成思考或跨普通消息移动；DeepSeek 官方 Responses 请求保留系统权限及完整输入，Chat 旧历史跨协议回放属于单独验证范围。
- Benchmark 使用 `--recovery enabled|disabled` 显式控制恢复；新套件为 `benchmarks/component-tools-cases.json`。离线故障脚本、真实模型加固定本地上游、真实 Bangumi 网络及浏览器显示属于不同证据层，不能互相替代。新指标和报告保留中间错误、终态错误、恢复次数及实际请求约束。

### 缓存引用与候选展示

- 缓存读取的内部 RPC 使用互斥的 `{ resource }` / `{ error }` 信封；业务错误码、诊断和来源工具经过校验后透传，不能统一包装成权限问题。访问继续绑定当前轮次、账户及 NSFW 范围。
- 显式选择的候选成员逐项验证原窗口、当前结果成员、实际筛选条件及事实版本；其他成员未处理不阻断已核实的小范围展示。完整集合和准备快照仍须满足对应阶段、完成范围及覆盖守卫。
- 首次输入产生真实资格结果；字段纯投影只绑定真实 `resultRef`。完成的工作句柄仅在资格完成、没有待核或剩余成员、与结果逐项同序且没有新筛选或 producer 选项时作为该结果的别名，不能让未完成工作集借投影伪装为完成。
- 卡片携带同一候选行中已核实的缓存封面；未知封面不造地址。准备快照优先只传引用，完全相同的标题和布局可作为冗余剔除，成员和实际内容覆盖仍拒绝。
- 引用恢复保留原成员、顺序和已完成前缀，使用既有预算；无法验证成员身份的组件不自动重读。失败报告仅允许文字后缀，不能借失败恢复追加或替换组件。

### 分层地图与依赖方向

```
main.ts                进程入口：先把 Pi 依赖隔离到 PI_CODING_AGENT_DIR，之后才动态 import 启动器
  ▼
launcher.ts            启动器：解析「本应用参数 + Pi 参数」，装配代理/会话/传输/通道/额度/账本，再选一个入口
  ├─ 交互 / print / json / rpc / list-models → Pi 原生入口（InteractiveMode / runPrintMode / runRpcMode）
  ├─ trace-analyze <trace 目录>              → tracing/analyze.ts
  └─ web [--port] [--no-open]                → web/session-manager.ts + web/server.ts
  ▼
extension.ts           Pi 扩展：注册只读工具 + execute_write_batch + 三个 /bangumi-* 命令；下发系统提示词与输出契约
  ▼
mcp/client.ts          LocalMcpClient：以 stdio 起下面这个子进程（所以它跑的是 dist 产物）
  ▼
mcp/server.ts          本地 MCP 服务（stdio 子进程）：71 个底层工具；写工具必须带宿主 guard，否则拒
  ▼
mcp/service.ts         业务实现：只读分派、候选漏斗、收藏窗口、写入
  ▼
mcp/transport.ts       Bangumi 上游 HTTP（v0 / p1 / web / community 四个来源）
```

依赖方向**不得反向**：`extension.ts` 依赖 `mcp/`、`login/`、`tracing/`、`support/`、`strategies/`、`interaction.ts` 与 `session-title.ts`；`web/` 依赖 `mcp/`（只取 `WriteConfirmOptions` 类型）、`login/`、`support/`、`session-title.ts` 与 `web/` 内部；`mcp/` 依赖 `support/`、`login/`（`transport.ts` 复用 `AccountTransport` 与凭据存储）与根 `interaction.ts`（默认通道），只从 `tracing/` 取类型（`TraceHost`）。**`mcp/service.ts`、`mcp/server.ts` 与 `mcp/catalog.ts` 都不引用 `web/`**；全仓唯一一处「非 web → web」的引用是 [output/content-types.ts](src/output/content-types.ts) 第 1 行的 `import type { ContentBlockView } from '../web/protocol.js'`——那是刻意的：12 种组件名与载荷形状只有一份定义。

| 层 | 职责（读自文件头注释与代码） |
|---|---|
| 根 `main.ts` | 唯一 bin 入口（`package.json` 的 `bin` 指向 `dist/src/main.js`）；用 `import.meta.url === pathToFileURL(argv[1])` 判断是否直接被跑；先 `preparePiEnvironment` 把 Pi 的模块级缓存路径定到隔离目录，再做动态 `import('./launcher.js')`（注释：不能提前静态 import）；异常经 `safeError` 输出 `code：message` |
| 根 `launcher.ts` | 参数解析（自有 `--data-dir/--timeout/--proxy/--direct/--trace/--trace-dir` 与 `web` 子命令的 `--port/--no-open`，其余交给 Pi、白名单外直接报错）；建目录、选 `SessionManager`、建 `ProxyController` + `createPiTransport`、建 `WebInteractionChannel` 或终端通道、建共享的 `TaskQueue` / `WriteRateLimiter` / `WriteJournal` 并用 `restoreWriteRateLimits` 恢复额度；`web` 分支再建 `WebSessionManager` 并 `startWebTerminal`；`finally` 里统一 dispose |
| 根 `extension.ts` | `createBangumiExtension`：把登录/MCP/工具/命令挂到 Pi；注册**只读工具**（`createReadTools`）与**唯一写入工具** `execute_write_batch`（经 `createBatchWriteTool`）以及受限的 Skill 读取工具；`before_agent_start` 里写 `sections.bangumi` 与 `sections.bangumi_content_output`；`input` 事件维护 `{ text, generation, requestId }` 供写入边界判定「同一轮」 |
| 根 `pi-host.ts` | `createBangumiRuntime`：包 `ModelRuntime` / `SettingsManager`（`projectTrusted: false`，只读隔离目录）/ `createAgentSessionServices` / `createAgentSessionFromServices`；`withProviderFetch` 只注入 HTTP 传输（`maxRetries: 0`，重试交给 Pi 会话层）；把 `RecoveryController` 与扩展一起注册；`toolExecution = 'sequential'` |
| 根 `pi-transport.ts` | 用 undici `fetch` + `ProxyDispatchers` 造一个 `FetchFunction`，`update` 可在运行中换线路（Pi 侧闭包持有同一 dispatcher，不必重建运行时） |
| 根 `session-title.ts` | 会话标题：首条真实输入先落临时标题，`agent_settled` 后用当前模型生成（20 字上限、10s 超时、不阻塞主对话、不进主对话）；注册 `/session-name`；`sessionTitleText` / `sessionDisplayName` 供 `web/session.ts` 复用 |
| 根 `interaction.ts` | `InteractionChannel` 接口（`canConfirm` / `confirm` / `canLogin` / `login` / `notify`）与终端实现 `createTerminalChannel`（`ctx.mode === 'tui' && ctx.hasUI`）；文件头注释写明「Web 端在没有浏览器连接时必须为假」 |
| 根 `isolation.ts` | `preparePiEnvironment`：解析 `--data-dir`（`BANGUMI_PI_HOME` 可覆盖），写 `PI_CODING_AGENT_DIR` 与 `PI_OFFLINE`；必须在加载 Pi 之前调用 |
| `src/web/` | 见下一节（跨端协议、投影、SSE 服务、会话视图） |
| `src/mcp/` | 本地 MCP 工具层：`catalog.ts` 是工具目录（`McpToolDefinition`：`name/description/inputSchema/outputSchema?/access/effect`），`server.ts` 是 stdio 服务，`service.ts` 是业务实现，`pi-tools.ts` 把它桥接成 Pi 工具，`write-boundary.ts` 是写入边界 |
| `src/output/` | 原生文字与按需组件发布：`component-tools.ts` 激活固定 render/prepare工具；`presentation-contract.ts` / `presentation-tools.ts` 的声明与参数校验同源；`presentation-store.ts` 校验有序缓存来源并冻结快照；`reply-assembler.ts` 原子追加并在工具整批结束后明确提交唯一正文；`model-context.ts` 归并已完成展示历史；`presentation-output.ts` 接原生模型流。12种类型仍来自 `web/protocol.ts`，严格128 KiB/16块上限及旧JSON标记兼容路径保持。 |
| `src/login/` | 账户登录与凭据：`login.ts`（仅 Windows，邮箱→密码→人机验证→`/p1/me` 核实→保存）、`account-session.ts`（`account-session.dpapi`，DPAPI 加密 + 文件锁 + 临时文件 rename；**只留会话白名单，邮箱/密码/验证码不入库**）、`transport.ts`（`AccountTransport` 与统一的超时/取消边界）、`verification.ts`（回环随机端口 + 一次性路径的 Turnstile 回调）、`prompt.ts`（独立的 `LoginInputComponent`）、`browser.ts`、`protected-credentials.ts`（`windowsProtector`）、`index.ts`（唯一导出面） |
| `src/support/` | 无业务的基础设施：`errors.ts`（`AppError` 家族 + `safeError` + `redact` / `credentialValues` / `sanitizeErrorDiagnostic`）、`error-diagnostic.ts`、`tool-schema.ts`（Ajv：`compileSchema` / `schemaArguments` / `outputIssues`）、`bangumi.ts`、`proxy.ts`（`ProxyPolicy` / `policyFor` / `environmentProxy` / `windowsProxy`）、`proxy-controller.ts`（`discoverProxy` / `ProxyController` / `ProxyMode`）、`proxy-dispatcher.ts`、`task-queue.ts`（账户变更串行） |
| `src/tracing/` | 独立于 Pi 会话与本应用写入授权的执行轨迹：`recorder.ts`（`TraceRecorder` / `TraceRun`）、`writer.ts`（每 trace 一个串行文件队列，正文按哈希去重）、`redact.ts`、`analyze.ts`（`analyzeEvents`，供 `trace-analyze` 子命令）、`pi-hooks.ts`、`schema.ts`。**轨迹不提供写入授权，也不用于恢复或重放修改**（[TRACING.md](TRACING.md)） |
| `src/strategies/` | 应用自带策略：`native-skills.ts` 的 `loadApplicationSkills` 用 Pi 原生 `loadSkills` 且 `includeDefaults: false`，只加载 `src/strategies/skills/`；`createSkillReadTool` 把 Pi 原生 read 工具的 `operations` 收紧到该目录下的 `.md`。当前 5 个 Skill：`bangumi-query` / `bangumi-recommend` / `bangumi-index` / `bangumi-anime-progress` / `bangumi-community-read` |

### `src/web/` 与前端的分界（最重要的一节）

前端 [../web/AGENTS.md](../web/AGENTS.md) 反复引用这一节。`src/web/` 只有 8 个 `.ts` 文件，分工是死的：

| 文件 | 它是什么 | 前端能不能绕过 |
|---|---|---|
| [protocol.ts](src/web/protocol.ts) | **跨端类型的唯一来源**：`TranscriptItemView`（`header` / `user` / `notice` / `error` / `assistant` / `reasoning` / `tool` / `turn` / `confirmation` 九种 `kind`）、`MessageBlock`、`ChatScalarsView` / `ChatStateView`、`ServerEvent`、以及全部客户端命令载荷。文件头注释写明它是**纯类型与纯数据**，不依赖 node 内置模块，所以宿主 `tsconfig.json` 与 `web/tsconfig.json` 都能编 | 不能。前端**不许复制一份**（`web/tsconfig.json` 的 `include` 直接列了 `../bangumi/src/web/protocol.ts`）。违反后果：协议改动后类型静默不同步 |
| [message-blocks.ts](src/web/message-blocks.ts) | **「载荷 → 内容块」投影**：`blocksFromContent`（带结构共享的流式投影）/ `blocksFromMessage`（终态投影）/ `reasoningTextFrom` / `toolCallsFrom` / `customContentBlocks` / `hasRenderableBlock`。它是**纯函数 + 只 `import type`**，所以宿主与前端调试页的 `web/src/page/debug/simulator.ts` 共用同一份源码（后者是前者的复刻，两边各写一份必然漂移） | 不能。宿主**不持有 kind 清单**：只排除 Pi 原生块（`NATIVE_BLOCK_TYPES` = `thinking` / `toolCall` / `image` / `redacted_thinking` / `fallback`），其余带 `type` 的对象块原样透传，形状合法性由前端 `components/content/validate.ts` 判定。协议加第 13 种块时宿主一个字节都不用改 |
| [tool-view.ts](src/web/tool-view.ts) | **工具调用 → 视图**：`EXACT` 表（覆盖 `mcp/catalog.ts` 全部具名工具）+ `RULES` 表（兜住 `get_${entity}_*` 这类动态名），据此给出中文标题 / 工具族 / 读或写 / 参数摘要；`toolOutcome` 把结果投影成 `ToolResultView`。结果里的 `presentation` 直接复用 `blocksFromContent`，所以**过程区与正文区共用一个渲染入口**。阈值：摘要 160、参数原文 4096、结果文本 8192 字符 / 200 行 | 不能。分工是「**宿主负责文案与载荷，浏览器负责视觉**」：新增工具只改这两张表；浏览器不维护工具名表 |
| [write-activity.ts](src/web/write-activity.ts) | **批量写入回执 → 文本 + 状态**：`projectWriteActivity(result, final)` 把 `execute_write_batch` 的 `value` 投影成 `{ state, detail, showDetail }`（状态计数、逐项缺口、依赖步骤、额度等待的香港时间）。注释明确：这条通道刻意保持「文本 + 状态」而非结构化内容块，因为结构化只会丢细节 | 不能。它由 `tool-view.ts` 包装成 `ToolResultView` 的文本兜底 |
| [error-view.ts](src/web/error-view.ts) | **错误 → 脱敏文本 + 结构化诊断**：`assistantErrorView`（助手消息）/ `exceptionErrorView`（异常）。只返回脱敏后的 `ErrorDiagnostic`，不生成前端详情布局或动作 | 不能。前端只渲染 |
| [session.ts](src/web/session.ts) | **一个会话的视图状态机**（1708 行，见 §索引 大文件表）：`WebInteractionChannel`（实现 `InteractionChannel`，把写入确认与登录输入送到浏览器再取回）、`WebSession`（Pi 事件 → 条目，浏览器命令 → Pi 会话 API）。`rebuild()` 在会话切换/启动时按 `buildContextEntries()` 重建全部历史（含 `custom_message` 条目、工具调用头与 `toolResult` 的配对、轮次与步序号）；`handleEvent` 是 Pi `AgentSessionEvent` 的 `switch`（`AgentSessionEventType` 枚举把每个事件的含义写在注释里） | 不能。浏览器从不参与授权判定，也不接触会话文件与密钥 |
| [session-manager.ts](src/web/session-manager.ts) | **多会话登记与切换**：`WebSessionManager` 按会话 ID 持有 `{ runtime, channel, web }`，同一会话始终复用一个运行时；`select(clientId, 'new' \| 'resume', …)` 做去重与「连续点击只让最后一次生效」；打开历史会话时用 `realpath` + `inside()` 双重校验路径只能落在 `sessionDir` 与本工作目录内 | 不能 |
| [server.ts](src/web/server.ts) | **回环 HTTP + SSE 服务**：`startWebTerminal` 只监听 `127.0.0.1`，启动时生成 32 字节一次性令牌，`GET /?token=…` 换 `HttpOnly; SameSite=Strict` Cookie（或直接用 `x-bgm-token` 头）；校验 `Host` 必须是回环；请求体上限 64 KiB；端口被占用时最多向后顺延 20 个。`SECURITY_HEADERS` 里 **`img-src` 放行 `'self' data: https://lain.bgm.tv`——只白名单 Bangumi 图床，不是整个 `https:`**：内容组件的封面（`SubjectCards` / `Gallery`）按协议就是外域 http(s) 绝对地址，收成 `'self' data:` 会让浏览器在发请求前拦掉全部封面，界面只剩「无封面」占位、宿主侧毫无报错（只有浏览器控制台有 CSP violation），实测确认。但敞开 `https:` 等于让任意第三方域名拿到出口 IP/UA，还能被间接提示注入当成数据出口——图片请求**无需脚本、无需点击**，`image` 又由模型输出决定（`connect-src 'self'` 只能挡 `fetch`，挡不住 `<img>`）；因此只放行 Bangumi 图床，代价是其它图床的封面静默回落成「无封面」。静态响应的 `cache-control` 对**所有 `.html`** 都是 `no-store`：只豁免 `index.html` 会让 `library.html` 落进 `public, max-age=3600`，改完前端后刷新拿到的还是旧 HTML + 旧 assets（实测踩过：文档页长时间显示旧示例数据），带内容哈希的 assets 才走长缓存 | 不能 |

**SSE 帧的下发**（`server.ts`，两个导出纯函数是这套机制的可核对形式）：

- `takeFreshItems(items, bookkeeping)` 决定本帧要发哪些条目：整体替换（首帧、换会话、条目变少）、新条目（编号更大）、**条目原地更新**（编号不变但 `version` 变了——工具从进行中变完成、确认卡从待确认变有结论都靠这条，只按编号过滤会让界面永久停在「进行中」）。
- `takeLiveDelta(previous, liveContent, liveThinking)` 算流式增量；**任何不确定都返回 `null`，调用方改发全量 `state` 帧**（自愈设计：会话切换、打断恢复改正文、块数变化、文本被改写都退回全量）。它能安全算增量，前提是 `message-blocks.ts` 对未变的块做了**结构共享**（`takeLiveDelta` 用引用比较判断「除最后一块外都没变」）。
- 帧只有四种（`ServerEvent`）：`state`（自愈通道，带完整标量与要更新的 `items`）、`stream`（高频通道，只带正文/思考追加部分，避免每帧重发全文的 O(n²)）、`sessions`（会话列表变化时）、`fatal`。
- 合并窗口 `FLUSH_MS = 16`（约一帧 60Hz）；心跳 15s，同时承担探活——**连接已断的客户端必须立刻摘掉**，否则「还有浏览器在等确认」会一直成立，写入就挂在无人应答的等待上。
- 每个客户端带 `clientId`（头 `x-bgm-client`）与查看中的 `sessionId`（头 `x-bgm-session`）；写命令的归属以**发出请求时的会话 ID** 为准，不在 `await` 后改用当前查看的会话。

**浏览器能做与不能做**：浏览器只做两件事——提交命令（`POST ./api/...`）、展示宿主下发的文本（`GET ./api/events`）。授权判定、工具执行、会话与模型都在宿主。`server.ts` 的 `dispatch` 是全部命令的唯一入口（`/api/session`、`/api/submit`、`/api/cancel`、`/api/confirm`、`/api/login-input`、`/api/login`、`/api/login-cancel`、`/api/logout`、`/api/model`、`/api/thinking`、`/api/credentials`、`/api/credentials/clear`、`/api/proxy`），每个字段都做类型与长度校验。

### 写入链路与安全边界（不可绕过）

**唯一入口**：所有写入都必须经 `execute_write_batch` 提交**完整计划**——单项也提交一条 `operation`。链路是：

```
模型 → execute_write_batch（mcp/batch-write.ts）
  → createWriteBoundary（mcp/write-boundary.ts）
      prepare/bind  冻结每个对象：before（原值）+ after（目标）+ guard（账户/对象基线）
      reconcile     先核实「同一范围是否还有未结案的旧写入」，有则阻塞相关步骤
      assertReady   ① 输入未变 ② channel.canConfirm ③ 有 Pi 事实记录 ④ 当前账户一致
      authorize     按 confirmation-policy.ts 决定是否弹确认；确认期间用深拷贝冻结授权范围
                    通过后发一个 permit（token → 冻结计划），模型拿不到 permit
      executeApproved  逐项执行，每项步骤提交前**再次** canConfirm + 重新核对输入
  → mcp/server.ts（stdio 子进程）writeGuard 校验 _meta 里的宿主 guard
  → mcp/service.ts → mcp/transport.ts（真实 HTTP）
  → 独立回读（write-verification.ts）→ status/actual/verification
```

**不可绕过的约束**（每条都有来源）：

1. **没有已连接的浏览器就拒绝写入，而不是挂起等待。** `WebInteractionChannel.canConfirm()` 是 `clients > 0 && session !== undefined`（`setClients` 由 `server.ts` 按在线流客户端数维护）；`WebSession.requestConfirmation` 没有可用确认方时抛 `AUTHORIZATION_REQUIRED`「没有已连接的 Web 终端，未提交修改。」；`write-boundary.ts` 的 `assertReady`（第 700 行）与 `executeApproved`（第 808、874 行）在多处复查同一条件，断线则**停止后续提交**。终端通道同理由 `ctx.mode === 'tui' && ctx.hasUI` 把 print/json/rpc 挡在外面。**违反后果**：把待确认的写入变成无人应答的挂起，或让非交互模式取得写授权。
2. **模型拿不到逐项写工具。** `extension.ts` 只注册 `createReadTools(facade)`（只含 `effect === 'read'`）——底层 14 个固定写工具**不出现在模型的工具列表里**；写入只能走 `execute_write_batch`。底层 MCP 服务里那些写工具要求请求 `_meta` 带 `bangumi/guard`，缺失即 `AUTHORIZATION_REQUIRED`（`server.ts` 的 `writeGuard`、`client.ts` 第 176 行、`service.ts` 第 418 行）。**违反后果**：模型可以拆成多个单项写调用绕过「一次完整计划一次授权」。
3. **一轮只能提交一个计划，确认后不能追加。** `authorize` 用 `submittedGeneration` 拦住同一轮第二次提交（`WRITE_PLAN_ALREADY_SUBMITTED`）；`input.generation` 在每次真实用户输入时递增（`extension.ts` 的 `input` 事件）。**违反后果**：把一个大范围拆成多个计划，逐个绕过确认政策。
4. **确认政策只看固定能力，不解析自然语言风险**（`confirmation-policy.ts`）：`writes` 集合必须与 `catalog.ts` 里 `effect === 'write'` 的工具**逐项相等**（不等就 `throw`，这是启动期自检）；`confirmationForPlan` 只在「多个非章节操作」或「发布/修改作品短评」时要求确认——**章节状态修改不计入批量审批数量**（`isEpisodeWrite`）。**违反后果**：政策与工具目录漂移，或凭模型自述决定要不要授权。
5. **确认期间冻结授权范围**：`authorize` 对 `target/args/guard/before/after/effects/baseline` 全部 `structuredClone`，之后一切以冻结副本为准；浏览器提交的确认回执按 `id` 匹配（`resolveConfirmation`，不匹配的 id 抛错），旧的确认卡不能确认新预览。**违反后果**：确认之后参数被改动，实际执行超出用户看到并授权的范围。
6. **提交回执不是最终结果。** `submission.ts` 的 `SubmissionTracker` 记录每个网络阶段的真实投递事实（`acknowledged` / `rejected` / `unknown` / `not_attempted`），`verification.ts`（`write-verification.ts`）另做宿主独立回读；`value.verification` 才是结论，`submission.verification === 'pending'` **只是底层投递回执**。`web/AGENTS.md` 与系统提示词都反复强调这一点。**违反后果**：把「已提交」当「已生效」，要么误报成功，要么对已完成的写入重复提交。
7. **未知结果不重发、冲突域要隔离。** `write-recovery.ts` 用 `pendingWriteFact` / `writeConflictKeys` / `allowedWriteSnapshot` 判断旧事实能否结案：实际值必须等于 `before` 或 `after`（混合/多阶段中断时按字段递归组合）才算安全；`write-stages.ts` 的 `mergeStageSubmission` 逐项校验阶段回执与原计划一致，越界即 `MCP_INVALID_RESULT`；`batch-policy.ts` 的 `isBatchFatal` 决定「整批停」还是「只跳过这一项」（`fatalCodes` 含授权、账户、登录、额度事实、账本类错误；预检阶段的 404/403 只跳过本项）。**违反后果**：在结果未知时重发，产生用户没要的第二次修改。
8. **额度等待发生在宿主，且真实计费按网络阶段算**（`write-rate-limit.ts`）：`WRITE_RATE_RULES` 抄的是上游固定规则（Subject/Character/Person 15 次/5 分钟，Index/Episode 10 次/5 分钟，IndexEdit 15 次/5 分钟）；`update_subject_collection` 的书籍进度与收藏字段在上游**共用 Subject 额度**，所以 `writeRateRequests` 按网络阶段计数（`Number(fields) + Number(progress)`），`splitWriteStages` 先把复合操作拆开。额度已在启动时由 `restoreWriteRateLimits` 从 `WriteJournal` 事实重建。**违反后果**：把两次网络写入当成一次额度，被上游 429 拒绝。
9. **写入事实账本是追加式且不含凭据**（`write-journal.ts`）：`WriteJournal` 走 `fsync` + `0o600`，`append` 明确拒绝含 `guard` / `permit` / `token` / `input` / `cookie` / `sessionId` 的字段，序列化前统一 `redact`；读取时任何一行损坏都抛 `WRITE_JOURNAL_INVALID` 并**不忽略未决修改**。`recordWrite` 同时通过 `pi.appendEntry('bangumi/write' | 'bangumi/batch', …)` 落进 Pi 会话条目。**违反后果**：把 Cookie、guard 或用户原文写进磁盘，或让损坏的账本被当成「没有未决写入」。
10. **确认卡在终端里默认拒绝**（`confirm.ts`）：`WritePreviewComponent` 必须**翻完全部预览并停在末页**才能选中确认项，`Enter` 在未选中时等于取消；注释明确「不回退到可能裁切长文本且默认 Yes 的原生 confirm」。**违反后果**：长预览被裁切后用户实际没看到就授权了。

**相关文件一览**：`confirm.ts`（终端确认组件）、`confirmation-policy.ts`（要不要确认）、`write-preview.ts`（中文业务文案与完整范围，`formatWritePreview` / `formatWriteItem`）、`write-boundary.ts`（边界本体）、`write-stages.ts`（复合操作拆分与阶段回执合并）、`write-recovery.ts`（旧事实与冲突域）、`write-verification.ts`（独立回读）、`write-rate-limit.ts`（上游额度）、`write-journal.ts`（事实账本）、`submission.ts`（`SubmissionTracker` / `checkSubmission`）、`batch-write.ts`（`execute_write_batch` 与 `BATCH_INPUT_SCHEMA`）、`batch-policy.ts`、`batch-plan.ts`、`batch-context.ts`（`bangumi/batch` 快照）、`batch-display.ts`。

### 不要动的东西

1. **`dist/` 与 `node_modules/`**：`.gitignore` 用 `**/dist/`、`**/node_modules/` 忽略，它们是产物。改源码不改产物（见首要规则 0）。
2. **`node_modules` 里残留的 `antd` 系列包**：`bangumi/node_modules/antd` 仍然在，但 `package.json` 的 `dependencies` / `devDependencies` 里**没有任何 antd**——UI 重构已把 antd 全量移除，这只是没清干净的残留。**不要**因为看到它就以为项目还在用 antd，也不要把它写回 `package.json`；更不要 `npm ci` 之外的清理动作去动 `node_modules`。
3. **[mcp.md](mcp.md)（392,092 字节 / 5504 行）不要手改。** 它是**生成物**：[scripts/sync-mcp-doc.mjs](scripts/sync-mcp-doc.mjs) 从编译产物 `dist/src/mcp/catalog.js` 的 `TOOL_DEFINITIONS` 与 `dist/src/mcp/batch-write.js` 的 `BATCH_INPUT_SCHEMA` 渲染出全部字段表（当前首行写明「70 个底层工具及宿主工具 execute_write_batch」），并带 `--check` 模式。它**不**由 `npm run build` 或 `npm run test:mcp` 自动运行；[test/mcp-document.test.mjs](test/mcp-document.test.mjs) 会用同一渲染函数比对 mcp.md 的 SHA-256，不一致就失败（提示「文档须在最终统一构建后重新同步」）。**所以**：改了工具 schema 之后要 `npm run build` 再 `node scripts/sync-mcp-doc.mjs`，**不要**手工编辑 mcp.md；手改会在下一次同步被覆盖，并把测试搞成失败。
4. **`pi/`**：vendored 上游，只读（见 [../pi/AGENTS.md](../pi/AGENTS.md)）。`bangumi/package.json` 里的 `@earendil-works/pi-*` 是指向 `pi/packages/*` 的 file: 依赖。
5. **`web/`**：前端源码，改动规矩在 [../web/AGENTS.md](../web/AGENTS.md)；宿主只通过 `protocol.ts` / `message-blocks.ts` 与它交界。

## 索引

### 要做什么 → 去哪个文件

| 你要做的事 | 去哪 |
|---|---|
| 加/改一个底层 MCP 工具（名称、schema、读写属性） | [mcp/catalog.ts](src/mcp/catalog.ts)（`tool(...)` 登记）+ [mcp/resource-schemas.ts](src/mcp/resource-schemas.ts)（输入/输出 schema）；改完跑 `sync-mcp-doc.mjs` |
| 实现或改一个工具的读取逻辑 | [mcp/service.ts](src/mcp/service.ts) 的 `dispatch` / `callScoped` |
| 改 Bangumi 上游请求（路径、分页、超时、取消） | [mcp/transport.ts](src/mcp/transport.ts)、[login/transport.ts](src/login/transport.ts) |
| 加写入能力、改写入顺序与依赖 | [mcp/batch-write.ts](src/mcp/batch-write.ts) + [mcp/write-boundary.ts](src/mcp/write-boundary.ts) + [mcp/batch-plan.ts](src/mcp/batch-plan.ts) |
| 改「要不要弹确认」的政策 | [mcp/confirmation-policy.ts](src/mcp/confirmation-policy.ts) |
| 改确认卡里给用户看的文案/范围 | [mcp/write-preview.ts](src/mcp/write-preview.ts)（业务文案）+ [web/session.ts](src/web/session.ts) 的 `requestConfirmation` |
| 改终端确认交互 | [mcp/confirm.ts](src/mcp/confirm.ts) |
| 改额度（限流）规则或等待行为 | [mcp/write-rate-limit.ts](src/mcp/write-rate-limit.ts) |
| 改写入事实账本 / 恢复判定 | [mcp/write-journal.ts](src/mcp/write-journal.ts)、[mcp/write-recovery.ts](src/mcp/write-recovery.ts) |
| 改独立回读的核对口径 | [mcp/write-verification.ts](src/mcp/write-verification.ts) |
| 加/改一条 Pi 工具（只读桥接） | [mcp/pi-tools.ts](src/mcp/pi-tools.ts)（+ [mcp/model-projection.ts](src/mcp/model-projection.ts) 决定模型能看到哪些字段） |
| 注册扩展、命令、系统提示词 | [extension.ts](src/extension.ts) |
| 改模型/会话/重试/压缩行为 | [pi-host.ts](src/pi-host.ts)、[output/recovery.ts](src/output/recovery.ts) |
| 改新展示定义/参数错误的有限原生纠参 | [output/recovery.ts](src/output/recovery.ts)、[extension.ts](src/extension.ts)；索引/加载与展示错误共享Pi剩余预算，保持index→加载→render，业务/权限/未知写入保护不放宽；验证 [test/presentation-definition-recovery.test.mjs](test/presentation-definition-recovery.test.mjs) |
| 改业务恢复与宿主展示的能力分域、顶层/嵌套执行政策 | [output/recovery-loadout.ts](src/output/recovery-loadout.ts)、[output/recovery.ts](src/output/recovery.ts)；使用实际注册角色与最新active集合，恢复不能回写旧组件集合，metadata加载不扩大业务授权；验证 [test/recovery-loadout.test.mjs](test/recovery-loadout.test.mjs) |
| 改展示内容错误的参数/Schema/容量分类 | [output/presentation-tools.ts](src/output/presentation-tools.ts)、[output/resource-content.ts](src/output/resource-content.ts)、[output/presentation-store.ts](src/output/presentation-store.ts)；成员守卫及fields/columns互斥仍拒绝，精确参数路径不回显值，已有权限/业务diagnostic/cause优先；验证 [test/presentation-error-projection.test.mjs](test/presentation-error-projection.test.mjs) |
| 改缓存 RPC、成员选择和业务错误透传 | [mcp/resource-contract.ts](src/mcp/resource-contract.ts)、[mcp/client.ts](src/mcp/client.ts)、[mcp/server.ts](src/mcp/server.ts)、[mcp/service.ts](src/mcp/service.ts) |
| 改候选资格、稳定字段投影、封面快照和引用展开 | [mcp/candidate-query.ts](src/mcp/candidate-query.ts)、[mcp/candidate-presentation.ts](src/mcp/candidate-presentation.ts)、[mcp/candidate-output.ts](src/mcp/candidate-output.ts)、[output/resource-content.ts](src/output/resource-content.ts) |
| 改把网页内容变成 12 种内容块 | [output/content-schema.ts](src/output/content-schema.ts)、[output/content-decoder.ts](src/output/content-decoder.ts)、[output/provider-content.ts](src/output/provider-content.ts)、[output/component-selection.ts](src/output/component-selection.ts) |
| 改组件准备、发布、完整正文、流式及历史回放 | [output/presentation-contract.ts](src/output/presentation-contract.ts)、[output/presentation-tools.ts](src/output/presentation-tools.ts)、[output/presentation-store.ts](src/output/presentation-store.ts)、[output/reply-assembler.ts](src/output/reply-assembler.ts)、[output/presentation-output.ts](src/output/presentation-output.ts)、[web/session.ts](src/web/session.ts)；定向验证 [test/presentation-flow.test.mjs](test/presentation-flow.test.mjs) |
| 改模型历史展示归并、签名保留与压缩来源校验 | [output/model-context.ts](src/output/model-context.ts)、[output/presentation-history.ts](src/output/presentation-history.ts)；精确注册工具角色与原分支来源按请求绑定，成对归并不改变业务工具证据；验证 [test/presentation-history.test.mjs](test/presentation-history.test.mjs) |
| 改展示工具原始参数及确定性本地修复 | [output/presentation-arguments.ts](src/output/presentation-arguments.ts)、Pi [tool-call-arguments.ts](../pi/packages/ai/src/utils/tool-call-arguments.ts)；定向验证 [test/presentation-arguments.test.mjs](test/presentation-arguments.test.mjs) |
| 改展示参数故障的脱敏本地原文诊断 | [tracing/recorder.ts](src/tracing/recorder.ts)、[extension.ts](src/extension.ts)；仅repaired/rejected保存原字面JSON至本地debug_ref，保留重复键/空白并屏蔽完整及尾部凭据，原偏移不因脱敏重算，不能进入公开审计/模型；验证 [test/presentation-arguments-debug.test.mjs](test/presentation-arguments-debug.test.mjs) |
| 改展示工具的提供方请求 Schema与按需加载 | [output/presentation-contract.ts](src/output/presentation-contract.ts)、[output/component-tools.ts](src/output/component-tools.ts)、[extension.ts](src/extension.ts)；每组件固定type=object声明，请求和校验同源，新用户输入退役展示集合；本机实际HTTP载荷及门禁验证 [test/presentation-provider-schema.test.mjs](test/presentation-provider-schema.test.mjs)，外部服务仍须真实benchmark |
| 改跨端协议（帧、条目、载荷） | [web/protocol.ts](src/web/protocol.ts)——**前端同一份，改完要一起看** |
| 改「载荷 → 内容块」投影 | [web/message-blocks.ts](src/web/message-blocks.ts)（宿主与前端调试页共用） |
| 改工具在界面上的标题/摘要/结果 | [web/tool-view.ts](src/web/tool-view.ts) |
| 改批量写入进度怎么显示 | [web/write-activity.ts](src/web/write-activity.ts) |
| 改错误怎么呈现 | [web/error-view.ts](src/web/error-view.ts)、[support/error-diagnostic.ts](src/support/error-diagnostic.ts) |
| 改会话视图、历史重建、轮次/步序号 | [web/session.ts](src/web/session.ts)（`rebuild` / `handleEvent`） |
| 改多会话切换、历史会话打开 | [web/session-manager.ts](src/web/session-manager.ts) |
| 加/改 HTTP 命令、SSE 帧、鉴权 | [web/server.ts](src/web/server.ts) |
| 改登录流程或凭据存储 | [login/](src/login/)（入口 [login/index.ts](src/login/index.ts)）、[web/session.ts](src/web/session.ts) 的 `startLogin` / `resolveLogin` |
| 改启动参数、子命令、tracelog | [launcher.ts](src/launcher.ts)、[tracing/](src/tracing/)（说明见 [TRACING.md](TRACING.md)） |
| 加/改应用 Skill | [strategies/skills/](src/strategies/skills/)（目录与读取限制见 [strategies/native-skills.ts](src/strategies/native-skills.ts)） |
| 改隔离目录 / 环境变量 | [isolation.ts](src/isolation.ts) |
| 加/改测试 | [test/](test/)（见下「运行与验证命令」） |
| 查构建、产物、启动方式 | 本文 §规则「首要规则 0」；仓库根 [../start.mjs](../start.mjs) 的头部注释 |

### 大文件与检索指引

**这些文件不要通读**——按「它是什么 + 该 grep 什么」定位。

| 文件 | 规模 | 它是什么 | 想找 X 该 grep 什么 |
|---|---|---|---|
| [mcp/resource-schemas.ts](src/mcp/resource-schemas.ts) | 139,813 字节 / 216 行 | **单一文件里最危险的一个**：固定 MCP 输出 JSON Schema 的声明表。`definitions` 里一个 `$defs` 条目一行，单行可达数万字符，`read` 一次就可能爆上下文 | `RESOURCE_INPUT_SCHEMAS`（第 58 行，各工具输入）、`resourceOutputSchema`（第 201 行，按工具名取输出）、`"Receipt_create_index"` / `"Receipt_update_subject_collection"`（写回执）、`withAccessContext`、`submissionRejectionSchema` |
| [mcp/service.ts](src/mcp/service.ts) | 119,808 字节 / 1423 行 | 本地 MCP 服务的**唯一业务实现**：`call`(390) → `callScoped`(414) → `dispatch`(608) 三层分派；候选漏斗、收藏窗口、写入各占一段 | `private async dispatch`、`callScoped`、`executeCandidates`、`refineCandidates`、`recallCandidates`、`queryCollectionCandidates`、`private async write(`、`writePrepared`、`gateNsfw`、`candidateBinding` |
| [mcp/write-boundary.ts](src/mcp/write-boundary.ts) | 93,983 字节 / 1159 行 | 写入的**授权与执行边界**（§规则 第「写入链路」节） | `createWriteBoundary`(128)、`async function bind`(271)、`prepare`(427)、`reconcile`(560)、`assertReady`(698)、`authorize`(705)、`executeApproved`(786)、`beginBatch`(1002)、`finishApproved`(1034)；日常检索用 `canConfirm` / `permit` / `advanceWriteView` / `PREVIOUS_WRITE_UNKNOWN` |
| [web/session.ts](src/web/session.ts) | 68,863 字节 / 1708 行 | 一个会话的视图状态机 + 交互通道 | 分区定位：`enum AgentSessionEventType`(76)、`class WebInteractionChannel`(218)、`class WebSession`(285)、`snapshot`(438)、`scalars`(480)、`rebuild`(703)、`handleEvent`(905)、`requestConfirmation`(1169)、`requestLogin`(1249)、`submit`(1382)、`cancel`(1411)、`catalog`(1495)。`handleEvent` 内部按 `case AgentSessionEventType.X` 跳转 |
| [mcp/candidate-store.ts](src/mcp/candidate-store.ts) | 49,318 字节 / 573 行 | 候选集合的**有界存储**：`CandidateSet` 的 ref 化、来源合并与去重、coverage 依赖、`CandidateBinding` | `class CandidateStore`、`mergeCandidateSources`、`mergeCandidateFacts`、`candidateRow`、`coverageRef`、`refRole` |
| [mcp/relation-query.ts](src/mcp/relation-query.ts) | 42,522 字节 / 476 行 | 关系展开（`expand_subject_relations`、`get_candidate_lineage`）的**分页状态机** | `class RelationQuery`、`interface RelationSnapshot`、`ParentProgress`、`edges`、`eligibleIds`、`loadFacts` |
| [mcp/candidate-contract.ts](src/mcp/candidate-contract.ts) | 39,813 字节 / 401 行 | 候选的**字段与筛选契约**：23 个 `CANDIDATE_FIELDS`、`CANDIDATE_INCLUDES`、各类 JSON Schema 与 `validateCandidateFilter` | `CANDIDATE_FIELDS`、`PERSONAL_CANDIDATE_FIELDS`、`candidateSourceRef`、`validateCandidateFilter`、`candidateCoverage` |
| [mcp/resource-output.ts](src/mcp/resource-output.ts) | 42,758 字节 / 420 行 | 只读结果的通用校验与取值工具（`record` / `positive` / `checkResourceResponse` / `resourceResult` 等，被大量模块 import） | `export function record`、`checkResourceResponse`、`resourceResult` |
| [mcp/catalog.ts](src/mcp/catalog.ts) | 36,015 字节 / 290 行 | **工具目录的唯一事实源**：`tool(...)` 逐个登记 70 个底层工具；`McpToolDefinition`、`validateToolArguments`、`findToolDefinition`、`BROWSE_CATEGORIES` | `tool('`（数工具）、`validateToolArguments`、`effect: 'write'`、`BROWSE_CATEGORIES` |
| [mcp/subject-output.ts](src/mcp/subject-output.ts) | 34,003 字节 / 390 行 | 作品/章节输出的规范化与校验（`subjectSummary` / `subjectDetails` / `subjectPage` / `browseSubjectPage` / `collectionPage` / `indexSubjectPage` / `checkOutput` / `checkSubjectResponse` / `checkPageMetadata` / `SUBJECT_INCLUDES`） | `checkOutput`、`checkSubjectResponse`、`subjectSummarySchema`、`SUBJECT_INCLUDES`、`subjectOutputSchema` |

其余 20 KB 以上的文件（同样建议 grep，不必通读）：[mcp/transport.ts](src/mcp/transport.ts)（456 行）、[mcp/pi-tools.ts](src/mcp/pi-tools.ts)（80 行，短但重要）、[mcp/person-characters.ts](src/mcp/person-characters.ts)、[mcp/candidate-query.ts](src/mcp/candidate-query.ts)、[mcp/batch-write.ts](src/mcp/batch-write.ts)（273 行）、[mcp/client.ts](src/mcp/client.ts)（278 行）、[tracing/recorder.ts](src/tracing/recorder.ts)（436 行）、[output/recovery.ts](src/output/recovery.ts)（254 行）、[output/content-decoder.ts](src/output/content-decoder.ts)（401 行）、[mcp/community-service.ts](src/mcp/community-service.ts)、[login/transport.ts](src/login/transport.ts)（168 行）、[support/errors.ts](src/support/errors.ts)（184 行）。

### 运行与验证命令

在 `bangumi/` 下执行（= [package.json](package.json) 的 `scripts`）：

| 命令 | 它做什么 | **覆盖什么 / 不覆盖什么** |
|---|---|---|
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit && tsc -p ../web/tsconfig.json --noEmit` | 覆盖：宿主 `src/**/*.ts`（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）**与**前端全部 `web/src`。不覆盖：`test/*.mjs`、`scripts/*.mjs`、`dev-web.mjs` 这些 `.mjs`（它们不在任何 tsconfig 的 `include` 里） |
| `npm run build` | `build:web` + 宿主 `tsc -p tsconfig.json` + `node scripts/copy-strategy-skills.mjs` | 一次覆盖**前端产物 + 宿主产物 + 策略 Skills 副本**。`copy-strategy-skills.mjs` 会先删掉 `dist/src/strategies/skills` 再整目录拷贝（避免已删除的 skill 仍被发现） |
| `npm run build:web` | `vite build` | 只重建前端产物到 `bangumi/dist/web`（两个入口：`index.html` + `library.html`）。**不**碰宿主 `dist/src` |
| `npm run dev:web` | `node dev-web.mjs`：一条命令起宿主 + Vite dev server | 覆盖：前端 HMR（改 `web/src` 立即生效）。**不覆盖宿主源码热更**——宿主进程读 `dist/src/main.js`（[dev-web.mjs](dev-web.mjs) 的 `HOST_ENTRY`），改 `src/**` 必须先 `tsc -p tsconfig.json` 再重启。默认让宿主走 `--direct`（避免受限环境里 `spawn` 读注册表失败），要代理用 `--proxy` |
| `npm run test:mcp` | `tsc -p tsconfig.json && node scripts/copy-strategy-skills.mjs && node --test test/*.test.mjs` | 覆盖：**宿主侧的 `node:test` 契约测试**（64 个 `*.test.mjs`）。注意它会先编译，所以跑测试不会因为产物过期而误过。**不覆盖前端渲染与交互**（没有前端测试运行器） |
| `npm run web` / `npm start` | `node dist/src/main.js web` / `node dist/src/main.js` | 只读产物、**自己不构建**，产物过期也不会报错——所以日常用仓库根的 `node start.mjs`（按时间戳增量重建） |

**`test/` 是什么规模、测什么**：64 个 `*.test.mjs`、加 2 个**辅助 fixture**（`web-fixture.mjs`、`frontend-content-fixture.mjs`，不以 `.test.mjs` 结尾所以不会被 `node --test test/*.test.mjs` 直接跑）、加 `fixtures/infobox-source-shapes.json`。测试全部是宿主侧契约测试（MCP 协议审计、候选漏斗、写入回执与恢复、额度、预览、轨迹等）。

**它其实碰到了一点点前端**，这点值得写清：`frontend-content-fixture.mjs` 会用 `typescript` 的 `transpileModule` **读取并转译前端的** `web/src/components/content/registry.tsx`、`web/src/components/content/validate.ts` 与 `web/src/page/library/samples.ts`，再用它们校验载荷；`web-fixture.mjs` 则直接起一个真实的 `startWebTerminal`（离线 `fauxProvider`）来测 SSE 帧与会话生命周期。**但这仍然不是前端测试**：没有 React 渲染、没有 DOM、没有交互。前端回归靠 [../web/AGENTS.md](../web/AGENTS.md) 指向的文档化用例 + `npm run typecheck`。

**为什么前端产物落在 `bangumi/dist/web`**（两条互相独立的证据）：

- [vite.config.ts](vite.config.ts)：`root = resolve(here, '..', 'web')`（即 `web/` 是前端根），`build.outDir = resolve(here, 'dist', 'web')`，`emptyOutDir: true`；`base: './'`。
- [web/server.ts](src/web/server.ts) 的静态托管目录默认是 `fileURLToPath(new URL('../../web/', import.meta.url))`——文件编译后在 `dist/src/web/server.js`，`../../web/` 正好解析到 `dist/web/`；404 时的提示文案就是「请先运行 npm run build:web」。
- 补充：[tsconfig.json](tsconfig.json) 是 `rootDir: "."` + `outDir: "dist"` + `include: ["src/**/*.ts"]`，所以宿主产物是 `dist/src/**`，两者在 `dist/` 下并列而不互相覆盖。

### 现状：已知 / 存疑

- **`web/tsconfig.json` 的 `include` 里还留着 `../bangumi/src/web/custom-content.ts`，而该文件已不在 `src/web/` 下**（`src/web/` 只有本文列出的 8 个 `.ts`）。`message-blocks.ts` 的注释也把 `custom-content.ts` 称作「那个时代」。`include` 里的不存在文件不会让 `tsc` 报错，所以这条一直没被发现——**这是遗留，不是设计**（本条只做记录，未做任何改动）。
- **根 `AGENTS.md` 说 `test/` 有 66 个 `*.test.mjs`，实测 64 个**（`Get-ChildItem -Filter *.test.mjs` 与 `glob **/*.test.mjs` 都是 64）。以源码为准。
- **`src/web/session.ts` 里仍有 `console.log("event", event.type)`**（流式诊断时删掉了每 delta 的全量 JSON 日志，保留了非流式事件类型的一行日志）。不是 bug，但改日志行为时要知道它在。

## 规则补充：代码风格与本地约定（读源码得出）

- **中文注释解释「为什么」，不解释「是什么」。** 几乎所有关键决策都有注释写明取舍与实测数据（例：`server.ts` 的 `FLUSH_MS = 16` 注释带实测每帧字符数；`session.ts` 的 `rebuild` 注释写了「不能用 `Date.now()`，否则 3 天前的会话会显示用时 86 小时」）。新增代码要跟上这个密度。
- **错误一律走 `AppError(code, message)` + `safeError`**，不要抛裸 `Error` 到边界外（`main.ts` / `launcher.ts` / `server.ts` 都靠 `safeError` 输出 `code：message`）。稳定错误码是**契约**：`batch-policy.ts` 的 `fatalCodes`、`client.ts` 的 `TOOL_ERROR_MESSAGES`、`read-recovery.ts` 的分类表都按错误码分支，新增错误码要同时看这三处。
- **表驱动优于分支**：新增工具改 `catalog.ts` + `tool-view.ts` 的表 + `resource-schemas.ts` 的 schema；新增写工具还要同时登记 `confirmation-policy.ts`、`write-recovery.ts`、`write-rate-limit.ts`——这三处都有**启动期自检**（`foreach ... throw new Error('固定写工具必须全部登记确认政策。')` 之类），漏登记会在启动或测试时炸，而不会静默放过。
- **不要给宿主加「第二个真相」**：文书文案在宿主生成（`tool-view.ts` / `write-preview.ts` / `write-activity.ts` / `session.ts` 的 `THINKING_LABELS`），前端只渲染；能算的都不在前端算。
