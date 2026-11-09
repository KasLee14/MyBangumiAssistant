# 按需展示、原子交付与历史投影验收

在 `bangumi` 目录执行下列命令。构建、离线脚本、真实模型和浏览器展示是不同证据层级，分别记录结果。

## 构建与专属回归

```powershell
npm run build:bench
node --test test/tool-discovery.test.mjs test/benchmark-component-tools.test.mjs test/benchmark-presentation.test.mjs test/benchmark.test.mjs
```

工具回归检查中文发现、完整目录分页与下一请求实际声明：初始和每个真实用户新轮没有展示Schema，明确合法名字可直接轻量加载，索引只负责用途发现；read_component_spec回执不重复Schema，只激活所选固定集合。同批不能调用尚未声明的工具，压缩不能隐式激活。默认DataTable唯一columns表示，advanced保留原fields能力，未知参数不当别名接受。请求与参数校验同源，strict可选null仅在已约定线路还原，缺必填、非法字段及类型继续拒绝。

原子交付须覆盖 before/组件/after 任一步失败均不发布本次内容、有序多来源事实和成员守卫、全部依赖版本复核、容量及幂等。final 成功必须经过整批实际 call/result 配对，失败、取消、后续操作或未完成业务不能提前提交。用真实 Pi/Web/SSE 验证唯一正文、终态与回放；成功 final 至 settled 不再发模型收尾请求。历史投影同时验证成功展示成对归并、业务证据与签名保留、部分来源不可复活、表格单元格及链接地址可追问。

completionProof 中 tool_finish_turn 只认宿主 bangumi/presentation_commit 凭证，与同replyId的canonical completed及实际整批callID/name/成功结果逐项匹配；不能从args.final反推成功。非法或缺配对凭证记capture问题；普通原生stop另记native_stop。渲染后晚取消即使模型未再发error帧也必须保留aborted，不虚增成功正文数。

业务恢复分域回归使用真实MCP参数错误和真实SDK nested闭包：加载后业务纠参仍保留已选渲染，恢复中加载新组件后restore保留最新宿主集合；fatal/unknown业务顶层与嵌套都被阻断且无新增上游请求，已有缓存/文字报告和前缀仍可用。策略、共享预算、缓存scope/version及批次内部独立guard/回读不能放宽。正式模型记录若出现业务恢复撤掉已加载渲染等架构失败，完整保留该批再另版全量复测，不给loadout mismatch增加忽略例外。

## 当前原生参数链路离线验收

```powershell
node dist/src/benchmark/cli.js run --offline --cases benchmarks/presentation-cases.json --case script-native-trailing-comma,script-native-duplicate-key,script-native-truncated-value --recovery enabled --repeats 1 --out artifacts/benchmarks/presentation-arguments-offline
node dist/src/benchmark/cli.js run --offline --cases benchmarks/presentation-cases.json --case script-native-terminal-error,script-native-terminal-abort --recovery disabled --repeats 1 --out artifacts/benchmarks/presentation-terminal-offline
```

五个有限枚举脚本通过真实 Pi 工具准备、宿主参数扫描、审计和正文组装链路注入：尾逗号只能本地修复，重复键与未闭合字符串必须拒绝，然后在 `recovery:enabled` 的有限预算内由下一次模型工具调用完整纠参；provider 错误与取消在 `recovery:disabled` 下必须保留一次已发布前缀并落成 canonical `error` / `aborted`，成功正文数为零。faux 仅替代模型响应，`providerHttpRequests=0`。失败草稿不得进入 canonical 正文；计数分别验证本地修复、拒绝和后续成功纠参，不能用泛化的“恢复成功”混算。禁用恢复的负向测试要求首次参数拒绝后直接 `error`、模型纠参数为零，不能借普通工具循环绕过零预算；模型请求预算耗尽仍是 `budget_exceeded`，不能改判为成功。终止脚本关闭 Pi 自动重试，使故障终态固定；真实模型对照显式开启恢复。

`benchmarks/presentation-cases.json` 的 10 个真实模型场景包含事实、完整事实卡片、推荐成员选择、DataTable、InfoBox、文字→组件→文字顺序以及多轮原生自然文字。保留原 prompt、事实字段、ID、顺序及预算；卡片 delivered_fields 仅检查最终正文，prepare/render 回执和普通候选不算交付，evidence 仍要求模型实际读过必要资料。不能为了新工具行为降低旧断言或把已展示前缀当作完整终态。

DataTable 和 InfoBox 的 `component_text` 只在完整目标组件内部核对事实，框外正确解释不能使空表格或空信息框通过。

## 冻结旧 mixed 输出链路离线验收

```powershell
node dist/src/benchmark/cli.js run --offline --cases benchmarks/component-tools-cases.json --suite full --tag offline-script --recovery enabled --repeats 1 --root CONTROL_RUNTIME_ROOT --out artifacts/benchmarks/legacy-output-offline
```

六个有限枚举脚本通过真实 `createBangumiRuntime` 与 `RecoveryController` 注入：裸组件根后接普通文字、382 个空白、text 字段类型错误、组件枚举错误、合法前缀后组件错误、持续失败耗尽。脚本不能包含任意可执行代码。模型请求由 faux Provider 生成，`providerHttpRequests=0`；它证明宿主机制，不证明真实服务端的格式约束或模型表现。

这些脚本只适用于冻结旧运行时。当前原生文字允许保留 JSON 字串，因此不能把原始文字重新判作 mixed JSON Schema 故障。旧脚本与评分保留用于控制运行时独立验收；当前运行时专属测试显式跳过旧脚本，并由上面的三条原生参数脚本替代。

`script-prefix-then-invalid` 要求最终保留前缀一次，且宿主流的已展示文字前缀保持单调。`script-exhausted` 使用 `expectedTerminal:error`；其 `passed` 表示预期失败和有限停止被验证，不能视为成功回答。结果必须保留非零 `terminalModelErrors`、`recoveryStopped` 和原始错误摘要；成功正文数为零。

## 同模型控制与候选对照

```powershell
node dist/src/benchmark/cli.js run --cases benchmarks/presentation-cases.json --suite core --model deepseek/deepseek-flash --thinking high --recovery enabled --repeats 2 --control-root CONTROL_RUNTIME_ROOT --out artifacts/benchmarks/presentation-paired
```

`CONTROL_RUNTIME_ROOT` 替换为包含冻结版 `bangumi/dist/src` 的项目根目录。两侧使用同一当前 harness、固定 fixture、模型配置、思考强度、恢复策略及案例预算。脚本案例不能混入真实模型运行。上游 Bangumi 响应由本地 fixture 服务提供；真实 HTTP 仅用于模型。`card-style-followup` 固定条目 1001，覆盖卡片讨论、换口吻和自然文字追问三轮。

冻结保留宿主源码与 dist、Pi源码与 dist、包清单/锁文件及实际依赖。Windows本地包junction指向快照内部，共享活跃依赖不能作独立控制。当前未提交实现是比较基线时，必须在编辑前同时冻结当前源码和实际产物，并逐文件校验，不能用 git HEAD 替代。模型密钥与账户Cookie不复制进artifacts，只登记模型白名单信息和脱敏配置哈希。

构建冻结完成后直接调用编译好的 CLI，不使用 `npm run bench:run`（该脚本会先 build）。运行期间冻结范围不再修改。manifest 在首个 worker 启动前保存 `plannedRuns`、完整协议与两个运行时指纹；收尾复查运行时及脱敏模型配置。未完成计划、版本不匹配、`incomplete_capture`、fixtureMiss 和配置漂移均不能进入 eligible 性能配对。

`--recovery enabled|disabled` 默认 `disabled`，写入 `protocolHash`。开启后，已恢复的中间模型失败不使整例判为 `errored`，但错误计数和恢复记录完整保留；未生成合法终态正文仍算失败。不得为了通过验收自动忽略服务拒绝 strict 的错误。

`--timeout-ms`、`--max-model-requests`、`--max-tools`、`--max-total-requests` 可覆盖预算。新真实模型案例默认最多 18 次模型请求、300 秒；所有预算和实际消费写入报告。输出目录必须是新的目录。

## 指标定义

| 字段 | 含义 |
| --- | --- |
| `outputErrors` | 含正文格式或结构诊断的中间失败数 |
| `blankOutputErrors` | 空白或空正文诊断数 |
| `schemaOutputErrors` / `jsonOutputErrors` | 诊断中出现 Schema/字段错误或 JSON 语法/未闭合错误的次数；分类可重叠 |
| `modelErrors` | 所有观察到的中间模型 error/aborted 数，不因恢复成功归零 |
| `terminalModelErrors` | 未取得合法最终正文的用户轮次数 |
| `recoveryScheduled` / `recoveryRunning` / `recoveryRecovered` / `recoveryStopped` | 会话 `bangumi/recovery` 记录对应阶段的实际次数 |
| `strictToolsSent` | 实际请求中声明 `strict:true` 的工具数之和；重复声明重复计数 |
| `toolDeclarationsSent` | 实际请求中的工具声明数之和 |
| `initialToolCount` | 首次模型请求携带的工具声明数量 |
| `initialToolSchemaBytes` | 首次请求工具参数 Schema 数组的 JSON UTF-8 字节数，不含描述 |
| `initialProviderPayloadBytes` | 首次模型请求整体 JSON 的 UTF-8 字节数，不等于 token |
| `validatedFinals` | 通过当前宿主混合正文契约校验的最终回答数 |
| `prefixMonotonic` | 宿主可见文字在同轮恢复期间未回撤或替换前缀 |
| `prefixDuplications` | 固定前缀故障案例最终正文中额外重复前缀的次数 |
| `firstRoundFailed` | 第一次模型请求失败，或该请求提出的展示工具调用失败；本地修复成功不计失败 |
| `firstOutputAttemptFailed` | 首次真正正文 / 展示操作是否失败：读取和发现工具不计；原生按首个 prepare/present 调用 ID 对应结果，旧 mixed 按首次正文诊断或合法 stop。尚未观察到正文尝试为 `null`，本地修复后成功为 `false` |
| `localArgumentRepairs` | `bangumi/presentation_arguments` 审计中实际 `repaired` 次数，按参数对象计一次 |
| `argumentRejections` | 原始语法扫描实际 `rejected` 次数；业务 Schema 拒绝仍保留在工具错误中 |
| `schemaArgumentRejections` | 语法扫描通过后，完整工具 Schema 的拒绝次数，避免与本地修复重复计数 |
| `modelArgumentCorrections` | 同名展示工具失败后，后续模型提出调用成功的次数；不是本地语法修复次数 |
| `preparedComponents` / `publishedComponents` | `prepare_component` / `present_component` 实际成功工具调用次数，发布调用可去重，不能当最终块数量 |
| `providerFirstTextMs` / `requests[].firstTextMs` | provider 第一次 text delta 相对用例 / 单请求开始的时间；可能是尚未发布研究草稿 |
| `firstTextMs` | 第一段用户可见 canonical 文字的时间；原生 toolUse 草稿不计 |
| `firstPublishedBlockMs` | canonical snapshot 首次含已发布完整块的时间；prepare 回执不计 |
| `firstCompleteResultMs` | canonical `completed` 回答的时间，旧控制运行时使用合法最终 assistant stop |

strict 是否启用取决于有效模型能力与 Schema 是否可转换。`constrainedSampling:prefer` 不是启用证明；应检查 `strictToolsSent` 和实际请求。已有显式能力值优先；缺省仅官方 `openai` Provider 的 HTTPS `api.openai.com` Chat/Responses 端点启用，其他兼容网关缺省关闭。请求编码和参数准备使用同一政策，不修改用户模型配置。能力缺失或不支持时保留完整宿主校验；含条件组合或对象联合的复杂工具保留明确 fallback，不删除业务条件。真实服务接受请求也不能单凭小样本推断其始终执行了约束。

另记录每个真实用户轮首请求的展示声明、逐请求展示 Schema 字节、加载后的实际工具集合与正文文字载体。stateless 接口跨请求重发历史是正常前缀成本，单次请求内 native/text参数/canonical 摘要多份相同正文才属于本次历史重复问题；两者分开报告。签名绑定组保守回退单列，没有后续模型请求的回合标为未观察，不假称历史归并通过。字节不换算为 token，累计与峰值输入以实际 usage 中 input/cacheRead/cacheWrite 为准。

正式结论保留全部计划和失败：candidate通过率不低于冻结control，事实与范围不退化，成功同版eligible配对的模型请求和输入成本确实降低。发现失败或成本未降时追溯真实 payload、操作顺序、引用与终态职责，必要时改架构后在新目录完整复测，不提高预算、不混版拼接成功记录。

缺失 usage 保持 `null`，不写成零。控制和候选的通过率、输入 token、工具错误、恢复次数和延迟一起比较；失败或停止导致的低耗时不能算优化。

首请求与首正文尝试是两个独立指标，不互相替代。报告同时保留全部 `toolErrors`、`modelRequests`、`toolExecutions`、参数修复、拒绝和后续纠参数；拆分展示操作不能隐藏总失败与总消费。统计率仅以实际观察到对应布尔值的运行作分母。

## 前端展示证据

runtime 验收不等于浏览器验证。需要同时运行正文恢复和 Web/SSE 专属回归，确认失败草稿及错误说明未进入用户正文，已提交的文字前缀只出现一次，恢复诊断保留在可折叠思考或内部 trace 中。最终失败场景也必须检查，不只检查成功恢复场景。

报告 `report.html`、`results.json`、逐例 `result.json` 和 trace 支持追溯。报告明确标注离线脚本、真实模型与固定上游的证据范围。
