# Tracelog：独立执行轨迹与 MCP 分析

启动器默认开启本地 tracelog，CLI、print、JSON、RPC 和 Web 共用同一实现。日志只写本机，与 Pi 会话文件分开保存。日志本身不提供写入授权，也不用于恢复或重放修改。

## 启用、关闭和分析

在 `bangumi/` 中执行：

```powershell
npm start -- web
npm start -- web --trace off
npm start -- web --trace-dir "E:\BangumiTrace"
npm start -- trace-analyze "E:\BangumiTrace\2026-10-04\SESSION_ID\TRACE_ID"
```

- 默认目录是应用数据目录下的 `tracelog`。Windows 默认应用数据目录为 `%LOCALAPPDATA%\MyBangumiAssistant-Pi`；`--data-dir` 或 `BANGUMI_PI_HOME` 可以改变它。
- `--trace local|off` 覆盖环境变量 `BANGUMI_TRACE`，默认 `local`。
- `--trace-dir` 覆盖 `BANGUMI_TRACE_DIR`，只改变日志根目录。
- `--no-session` 仅关闭 Pi 会话落盘，tracelog 仍独立保存；关闭日志须显式使用 `--trace off`。
- `trace-analyze` 直接读取已有日志并将 JSON 报告输出至 stdout；不初始化账户、代理或模型，不发送 MCP 请求，不修改原日志。
- 嵌入 SDK 的调用者通过 `createBangumiExtension({ ..., trace: { directory } })` 开启；省略 `trace` 时不保存。

## 执行边界与目录

`session_id` 是 Pi 的稳定会话身份；`trace_id` 是一次 Agent 执行周期的身份；`span_id` 是其中一次模型请求、工具执行或宿主操作的身份。

主 trace 从 `before_agent_start` 开始，到 `agent_settled` 结束。一次 trace 包含多轮模型和工具循环。执行期间追加的输入进入同一 trace 的 `inputs`，不会覆盖首个输入。恢复会话仅加载历史；随后发生的新执行才生成新 trace。分支起止 entry ID 和每轮消息 entry ID 用于关联 Pi 的会话树。

后台标题生成单独保存为 `purpose: "session_title"`，通过 `parent_trace` 关联主 trace，不计入主任务的模型用量，也不阻塞主任务完成。

```text
tracelog/
  YYYY-MM-DD/                   本机时区下的日期
    SESSION_ID/
      TRACE_ID/                 32 位随机十六进制
        events.jsonl
        summary.json
        payloads/
          SHA256.json
```

非标准 session ID 转为哈希目录名；实际 ID 保存在文件中。span ID 为 16 位随机十六进制。事件及正文均为 UTF-8 JSON，事件一行一个对象，正文文件末尾有换行。

## events.jsonl

所有事件使用同一信封：

```json
{
  "schema_version": 1,
  "trace_id": "32位十六进制",
  "span_id": "16位十六进制",
  "parent_span_id": null,
  "seq": 1,
  "ts": "2026-10-04T00:00:00.000Z",
  "elapsed_ms": 0.5,
  "event": "run.start",
  "data": {}
}
```

`seq` 在本次 trace 内递增，`ts` 使用 UTC ISO 时间，`elapsed_ms` 和耗时使用单调时钟。父 span 连接运行、轮次、模型工具、批量步骤、宿主阶段和 MCP 调用。

| 事件 | 保存的事实 |
|---|---|
| `run.start/end/abort` | 会话、父 trace、版本和源码指纹、执行状态、最终输出引用、采集完整性、取消来源 |
| `input`、`input.delivered` | 原始输入、来源、追加方式、实际进入上下文的用户消息 |
| `prompt.expanded` | Pi 展开后的本轮 prompt 和附件 |
| `turn.start/end/boundary` | 模型轮次、起止时间、消息 entry ID、工具结果 entry ID、是否继续 |
| `llm.start` | 模型、thinking 配置和规范化完整 prompt manifest |
| `llm.provider_request` | 发送前供应商 payload 的脱敏投影，包含实际工具和消息声明；不保存 headers、环境及 opaque 签名 |
| `llm.http_response` | 主模型请求的 HTTP 状态码 |
| `llm.partial`、`llm.incomplete` | 每秒至多一次的完整部分消息快照，以及未取得终止消息的状态 |
| `llm.end` | AssistantMessage、可见思考引用、停止原因、返回模型、响应 ID、Pi 规范化 usage、耗时 |
| `tool.proposed` | 模型提出的工具名、toolCallId 和原始参数 |
| `tool.execution_requested` | Pi 尝试执行工具；此时参数仍可能被拒绝 |
| `tool.start`、`tool.result` | 真正进入工具 execute 的参数、结果、是否执行、错误标记、模型可见文本字节数 |
| `mcp.start/end` | 宿主 MCP 客户端调用、参数指纹、所属账户范围和写入代次、阶段、结果、错误、耗时、实际 dispatch 状态 |
| `mcp.initializing/initialized/dispatch` | 客户端初始化及真正调用 SDK `callTool` 的事实；初始化目录查询不计为工具 RPC |
| `host.start/end` | `preflight`、`confirmation`、`submit`、`verify` 的阶段耗时 |
| `operation.start/end` | 批量写入的具体执行步骤及子调用父关系 |
| `account_queue.wait` | 实际取得队列前的等待，或等待期间取消 |
| `confirmation.policy`、`write.fact`、`batch.fact` | 原宿主确认政策、提交和独立回读事实；完整内容在正文引用中 |
| `skill.read`、`session.compact`、`model.select`、`thinking.select` | Skill 读取、上下文压缩和运行中配置变化 |

不同模型轮次可以使用相同 toolCallId，日志以模型请求与调用 ID 的组合去重，并通过唯一 span ID 关联。

## payloads 与 prompt 重建

正文引用格式：

```json
{
  "path": "payloads/64位SHA256.json",
  "sha256": "64位SHA256",
  "bytes": 1234
}
```

哈希和字节数针对规范化、脱敏后正文的 UTF-8 JSON，不包含文件末尾的换行。对象键排序，数组和消息顺序不改变。每次 trace 内相同正文只写一份。

`llm.start.data.effective_prompt_ref` 指向 `{ "schema_version": 1, "messages": [正文引用...] }`。按顺序读取这些消息引用即可得到当时的完整规范化 prompt，包括 system prompt、历史、工具声明、用户输入及之前的工具结果。供应商原生 payload 另存为完整脱敏投影；它与规范化消息分别保留，不依赖 Pi session 文件。

因队列限制无法保存的正文使用 `path: null` 和 `omitted: "queue_limit"`。正文与事件保存失败会令采集状态不完整；不会悄悄用短预览替代完整结果。

思考只保存接口可见文本。`thinking_status` 为 `available`、`off`、`not_returned` 或 `redacted`。供应商隐藏内容和签名被移除；不改变原 thinking 配置，不另发请求补造 CoT。取消时已收到的思考和文本保留在 AssistantMessage 或部分快照中。

## summary.json 与分析指标

摘要包含 `schema_version`、trace/root span ID、`purpose`、父 trace、会话和分支引用、起始时间、耗时、所有输入、最终文本和消息引用、采集完整性、分析指标与发现。

- `execution_status`：`running`、`completed`、`aborted`、`error` 或 `incomplete`。
- `final_output.status`：`final`、`partial` 或 `none`；最终文本经过脱敏。
- `capture.complete/issues/dropped_events`：日志队列和写入层的完整性。它不代表任务正确，也不代表接口暴露了隐藏思考。
- `evaluation: null`：本版不自动给任务正确性评分。写入实际结果以 `write.fact` 和 `batch.fact` 中的原宿主验证为准。
- 环境保存应用/Pi/Node 版本、本机时区、入口、应用源码指纹、MCP 契约指纹和 Skill 文件指纹。

`analysis.metrics` 分开统计模型提出的工具、实际执行的工具、宿主客户端调用及真正尝试的 MCP RPC。注入的客户端无法提供 dispatch 证据时使用 `rpc_attempted: null`，不猜测已发送请求。

模型用量按本次规范化 usage 汇总，缓存读取/写入分别保留；全零或缺失终止消息记为用量不可用，不宣称免费。`usage.cost` 保留 Pi 的原有字段，可能来自模型目录估算。模型可见字节数只统计工具 content 的文本 UTF-8 字节，避免将 details/structuredContent 的重复副本算入上下文。MCP 结果字节数为脱敏后业务值的 JSON 字节数。

分析包括每种工具和阶段的调用数/耗时/结果体积、初始化与队列等待耗时、搜索新增 ID 和重叠率，以及带 span ID 的重复查询、重复失败、失败后改参、无新增候选、写入验证失败等发现。重复查询按工具、参数、阶段、账户范围和写入代次区分；必要的预检和独立回读只列为检查项，不自动删除。候选统计只使用搜索返回的作品 ID，不猜测最终回答利用率。

`trace-analyze` 重新读取事件和正文，检查序号、run 起止、JSON、正文缺失、正文哈希和引用范围。异常退出缺少 `run.end` 时报告 `incomplete`，不会仅凭旧摘要判为成功。

## 保存机制及覆盖范围

每个运行时拥有独立 Recorder 和文件队列。宿主 AsyncLocalStorage 只关联本实例中的操作，Web 多会话共享 ModelRuntime 时仍保持隔离。所有正文在进入磁盘队列前脱敏，包括工具 text 中嵌套的 JSON；部分流式快照额外隐藏跨片段的凭据尾部。凭据、headers、env、guard、prepared、permit 及供应商签名不保存。

队列默认上限 32 MiB，仅限制日志内存。嵌入宿主可配置 `maxQueueBytes`。正文/普通事件超过队列容量时标记丢弃，最终摘要保留缺失标记。事件逐步追加，摘要用临时文件替换；正常结束和关闭时 flush。磁盘/观察异常只发出固定诊断，不回显原始异常、不改变业务结果、不重试 MCP 或写入。没有自动清理日志，分析后可自行归档。

本版覆盖主 Agent 模型循环、模型工具、宿主 MCP 调用和后台标题生成。记录上下文压缩事件及摘要，但压缩模型本身、缓存预热请求、MCP 服务内部的 Bangumi HTTP/分页和外部 OTLP 导出尚未埋点；文件的 capture 字段明确保留覆盖信息。

## 验证

`test/tracing.test.mjs` 使用 Pi faux 供应商、本地 stdio MCP 和内存业务数据，验证多轮循环、参数拒绝、并发、追加输入、取消、恢复、后台标题、脱敏、队列溢出、磁盘错误、正文完整性、重复调用 ID、规则统计及模拟章节写入的前后行为一致。

这些验证不请求真实模型，也不读取或修改真实 Bangumi 账户。
