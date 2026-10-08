# 组件索引、工具加载与正文恢复验收

在 `bangumi` 目录执行下列命令。构建、离线脚本、真实模型和浏览器展示是不同证据层级，分别记录结果。

## 构建与专属回归

```powershell
npm run build:bench
node --test test/tool-discovery.test.mjs test/benchmark-component-tools.test.mjs test/benchmark.test.mjs
```

工具回归检查中文发现、完整目录分页、下一请求实际工具声明、新用户任务加载集合收敛、strict 请求转换以及可选 `null` 还原。参数缺失、必填 `null`、未知字段和错误类型仍必须拒绝。

## 离线故障注入

```powershell
node dist/src/benchmark/cli.js run --offline --cases benchmarks/component-tools-cases.json --suite full --tag offline-script --recovery enabled --repeats 1 --out artifacts/benchmarks/component-tools-offline
```

六个有限枚举脚本通过真实 `createBangumiRuntime` 与 `RecoveryController` 注入：裸组件根后接普通文字、382 个空白、text 字段类型错误、组件枚举错误、合法前缀后组件错误、持续失败耗尽。脚本不能包含任意可执行代码。模型请求由 faux Provider 生成，`providerHttpRequests=0`；它证明宿主机制，不证明真实服务端的格式约束或模型表现。

`script-prefix-then-invalid` 要求最终保留前缀一次，且宿主流的已展示文字前缀保持单调。`script-exhausted` 使用 `expectedTerminal:error`；其 `passed` 表示预期失败和有限停止被验证，不能视为成功回答。结果必须保留非零 `terminalModelErrors`、`recoveryStopped` 和原始错误摘要；成功正文数为零。

## 同模型控制与候选对照

```powershell
node dist/src/benchmark/cli.js run --cases benchmarks/component-tools-cases.json --case facts-basic,resource-card,community-short,filter-form,recovery-once,followup-filter,card-style-followup --model deepseek/deepseek-flash --thinking high --recovery enabled --repeats 2 --control-root CONTROL_RUNTIME_ROOT --out artifacts/benchmarks/component-tools-paired
```

`CONTROL_RUNTIME_ROOT` 替换为包含冻结版 `bangumi/dist/src` 的项目根目录。两侧使用同一当前 harness、固定 fixture、模型配置、思考强度、恢复策略及案例预算。脚本案例不能混入真实模型运行。上游 Bangumi 响应由本地 fixture 服务提供；真实 HTTP 仅用于模型。`card-style-followup` 固定条目 1001，覆盖卡片讨论、换口吻和自然文字追问三轮。

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

strict 是否启用取决于有效模型能力与 Schema 是否可转换。`constrainedSampling:prefer` 不是启用证明；应检查 `strictToolsSent` 和实际请求。已有显式能力值优先；缺省仅官方 `openai` Provider 的 HTTPS `api.openai.com` Chat/Responses 端点启用，其他兼容网关缺省关闭。请求编码和参数准备使用同一政策，不修改用户模型配置。能力缺失或不支持时保留完整宿主校验；含条件组合或对象联合的复杂工具保留明确 fallback，不删除业务条件。真实服务接受请求也不能单凭小样本推断其始终执行了约束。

缺失 usage 保持 `null`，不写成零。控制和候选的通过率、输入 token、工具错误、恢复次数和延迟一起比较；失败或停止导致的低耗时不能算优化。

## 前端展示证据

runtime 验收不等于浏览器验证。需要同时运行正文恢复和 Web/SSE 专属回归，确认失败草稿及错误说明未进入用户正文，已提交的文字前缀只出现一次，恢复诊断保留在可折叠思考或内部 trace 中。最终失败场景也必须检查，不只检查成功恢复场景。

报告 `report.html`、`results.json`、逐例 `result.json` 和 trace 支持追溯。报告明确标注离线脚本、真实模型与固定上游的证据范围。
