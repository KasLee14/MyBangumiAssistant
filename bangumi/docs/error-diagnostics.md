# 结构化错误诊断

错误码、具体原因、定位证据和恢复建议使用 `support/error-diagnostic.ts` 的固定契约。`recovery` 仅为诊断建议，不授权执行，不改变当前 Pi 重试请求、账户权限或写入核实链路。

## 字段与来源

| 字段 | 含义 |
|---|---|
| schemaVersion / errorId | 版本1及宿主生成的稳定错误ID |
| code / reason | 错误类型及具体规则；MCP既有错误码的不同原因由reason细分 |
| origin / stage | 模型、组件、HTTP、MCP、业务或宿主，以及失败阶段 |
| certainty | confirmed为直接观测；inferred为证据推断；unknown为未确认 |
| operation / issues | 工具来源及最多8条JSON Pointer、规则、期望或实际类型，不返回参数原值 |
| evidence | 固定字段的额度、用量、结束原因、容量、组件完成状态、状态码和派发证据 |
| causes | 最多4层底层名称和错误码，不包含任意正文或堆栈 |
| recovery | 重试请求、续接输出、修正组件、修正参数、登录/权限检查、重新规划读取、核实写入或停止 |
| links | trace、span和会话关联；接口始终保留errorId用于检索本地轨迹 |

Pi助手错误使用原生`diagnostics`中的`bangumi_error`条目，MCP安全错误使用`diagnostic`字段。`ReadDiagnosis`仍独立决定固定工具的重试和重新规划权限，诊断建议不能提高权限。MCP客户端验证诊断Schema、错误码与工具来源，不透传服务端任意恢复指令。

## 模型与内容错误

未完整交付的`length`终态归为`LLM_OUTPUT_TRUNCATED`；完整独立JSON通过内容契约时直接收束，保留上游结束原因及bangumi_output_finalized标记。本次实际payload的max_tokens/max_completion_tokens/max_output_tokens与模型配置额度分开保存；未捕获实际payload额度时为null，不使用模型配置冒充实际请求。输出达到已知请求额度时，`output_budget_exhausted`明确标为推断；无法确认时保留`provider_length_stop`。

其他类型包括`LLM_CONTEXT_LIMIT`、`LLM_REQUEST_LIMIT_INVALID`、`LLM_STREAM_INTERRUPTED`、`CONTENT_JSON_SYNTAX`、`CONTENT_JSON_INCOMPLETE`、`CONTENT_SCHEMA_INVALID`及`CONTENT_LIMIT_EXCEEDED`。本地容量原因区分字节、内容块、嵌套及组件数组数量。JSON是否闭合与上游是否正常stop分开记录，已有组件不会因为长度结束而被重新标为未完成。

组件校验按type选分支，具体错误只引用实际组件规则，避免anyOf其他类型的噪音。流式解析记录字符偏移、行列及完整内容块数量。pending:true仍表示未完成，pending:false仍表示组件闭合且字段通过校验。

宿主按结构化诊断注入恢复反馈并续接完整块断点，Pi不叠加盲目重试；预算、权限、持久化及SSE边界见[定向恢复契约](response-recovery.md)。

## MCP、网络与日志

候选校验区分请求投影、页计数、处理阶段、游标完成、覆盖计数与集合计数。HTTP连接、响应流、UTF-8、JSON及响应容量拥有独立stage/reason。MCP初始化、协议拒绝、连接失败与总期限耗尽保留底层原因；未知写入的恢复建议只能核实结果，不建议重发。

`error.diagnostic`事件关联同一errorId与trace/span/session，脱敏的原始失败输出或堆栈单独保存为debug_ref。debug缓冲最多32条、1MiB，单份响应文本最多128Ki字符并标明裁剪。队列关闭或日志失败不能改变业务结果。

原始输出、任意服务正文和堆栈不进入诊断DTO、模型工具错误反馈或Web SSE。宿主错误接口及SSE条目返回脱敏的结构化diagnostic和简短中文原因。本次不修改前端组件、样式或交互；旧会话没有诊断时继续返回原有错误文字。

## 验证

`error-diagnostic.test.mjs`覆盖完整121张卡片遇length、未知请求额度、字段路径、语法和容量、原因链、候选契约、HTTP阶段与写入未知；`native-web-content.test.mjs`覆盖宿主实际SSE及历史恢复；`tracing.test.mjs`覆盖trace关联、原文保存及脱敏。验收通过typecheck、完整MCP回归及字段文档同步检查。

模型入口与内部组件校验分离：根结构错误使用content_envelope_invalid及/content路径；组件字段错误定位到实际字段，required和additionalProperties补全JSON Pointer并转义斜线/波浪号。可确定的外层投影和状态字段派生记为bangumi_output_normalized，trace事件为content.normalized，不作为失败或模型恢复触发条件。规范化记录只含有界脱敏路径/规则，不保存额外字段值。
