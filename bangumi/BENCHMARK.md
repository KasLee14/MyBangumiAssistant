# Bangumi benchmark

## 范围与入口

离线回归验证确定性业务逻辑；benchmark 使用真实模型和真实 Pi/MCP 工具循环，评估调度、结果、上下文与耗时。默认 `fixture` 模式：只把 Bangumi 上游换为请求驱动的固定数据，生产 MCP 校验、分页、筛选、缓存、引用和组件展开照常执行。模型请求仍会联网并消耗模型额度。

固定套件有26个案例、12个核心案例，覆盖12个场景组。数据全部为合成资料，不代表真实网站条目事实。预期集合和规则只供评分程序使用，不会发给模型。每次运行保存实际数据快照和协议哈希。

在 `bangumi` 目录执行：

```powershell
npm run bench:list
npm run bench:run -- --offline
npm run bench:run -- --model PROVIDER/MODEL --thinking off --suite core --repeats 3
npm run bench:run -- --model PROVIDER/MODEL --suite full --repeats 5 --max-total-requests 1000
npm run bench:run -- --model PROVIDER/MODEL --case facts-basic,resource-card --repeats 3
npm run bench:run -- --model PROVIDER/MODEL --tag collection --suite full --repeats 3
```

`PROVIDER/MODEL` 替换为本机已配置模型。默认从应用数据目录的 `pi/auth.json`、`pi/models.json` 只读载入模型配置；`--agent-dir` 可指定其他配置目录。session、设置和模拟账户使用各案例独立目录，禁止登录交互。默认代理为 `http://127.0.0.1:7890`；直连使用 `--proxy direct`。

`--offline` 只执行 `facts-basic` 的脚本模型 smoke：真实宿主、stdio MCP、固定上游、评分和产物链路均执行，但不是模型能力证据。它无需凭据，不发送模型或 Bangumi 网络请求。

`--timeout-ms`、`--max-model-requests`、`--max-tools` 可调整单案例预算。默认全局最多500次模型请求；预算耗尽的未启动案例保存为 `not_run`。单案例预算耗尽为 `budget_exceeded`，未完成不能算低成本优化。会话自动重试固定关闭；宿主自身有界只读恢复按生产逻辑执行。

## 版本对照

先为两个待测 checkout 分别构建 Bangumi 及必要的 Pi 依赖。benchmark 只需存在于运行器所在 checkout；动态载入两个 checkout 各自的宿主、扩展、客户端、MCP 服务、传输与组件校验器。无需切换或重置工作区。

```powershell
npm run bench:run -- --model PROVIDER/MODEL --thinking off --suite core --repeats 3 --control-root E:\Project\BangumiAgent-baseline
```

当前 checkout 为 candidate；`--root` 可指定其他 candidate。每个案例交替采用 control→candidate、candidate→control，并发固定为1。记录源码、构建产物、Skill、依赖清单和 Git 信息，包含未提交内容指纹。结束后复核指纹，版本漂移标记 `incomplete_capture`。

保存的结果可离线比较：

```powershell
npm run bench:compare -- --baseline E:\Reports\before\results.json --candidate E:\Reports\after\results.json --out E:\Reports\comparison
```

协议、模型、thinking、模式不同，缺少配对或证据不完整的记录进入 blockedPairs。实际响应模型不一致也不能作为同模型性能对照。失败参与硬判通过率；性能差值只来自双方硬判通过且指标可用的配对。报告逐例中位数、配对差值、可用样本数和按场景组计算的宏平均通过率，少于3个成功配对标记 small-sample。

同版本自对照可校准波动。上下文累计增长15%、耗时增长20%仅触发复核，不是统计显著性判断。新增硬判失败单列。基线为0不计算百分比，缺失指标保留null。

同套件不同筛选范围或重复次数可以按交集配对。比较包含两个variant的已存报告时，默认取candidate，可用 `--baseline-variant` 和 `--candidate-variant` 指定。worker调用ESM父路径解析时自动添加Node24的 `--experimental-import-meta-resolve`，以载入待测checkout自己的Pi依赖。

## 在线只读验收

```powershell
npm run bench:run -- --model PROVIDER/MODEL --mode live-read --suite full --repeats 1
```

默认载入 `benchmarks/live-cases.json` 的3个在线场景，实际访问 Bangumi，账户读取沿用本机登录的只读载入。宿主客户端和上游传输双层阻止写入；仅允许 GET 及固定搜索 POST，不能执行写入案例。

在线数据会变化，默认仅检查调用和输出契约等不变量；事实与适配质量需要根据本次trace人工核对。与固定套件分开比较。登录无效是验收结果，不索取密码或更换账户。

## 案例与评分

`benchmarks/cases.json` 包含 ID、版本、场景、标签、对话轮次、fixture、规则、授权回复和预算。`--cases` 可载入同格式自定义套件。未知规则或不完整定义在联网前拒绝。

固定上游支持不同合法请求参数的搜索、浏览、收藏分页、详情、出演关系、作品关系和社区读取。132部合成作品包含尾页合格结果、年月和未知日期、同作品多角色关系，以及长评尾段必要观点。未登记路径记录fixtureMiss，结果为invalid_fixture，不会回退真实网络。

- subjects：检查最终交付作品的精确集合、允许集合、必含成员和数量。工具结果出现作品不等于已经交付。
- evidence：检查模型实际可见工具资料中的非空字段，可针对最终选中作品。展示补全不能替代判断证据。
- coverage：检查指定来源工具的覆盖事实；来源穷尽和未知筛选项分别核实。
- text / visible_text / component：断言回答、模型可见资料或完整组件。
- called：允许多个工具入口，不固定完整调用顺序。
- confirmations / writes / no_write_retry：核对宿主授权、模拟上游写入对象与最终状态，禁止重复提交。

推荐理由、观点归属和关系解释的 `semanticRubric` 在报告中显示为pending，供人工抽查。自动硬判passed不代表语义评审已通过，也不证明真实浏览器布局正常。

## 指标口径

- modelRequests：Pi assistant请求次数；providerHttpRequests：实际模型HTTP请求数。辅助或失败请求造成不完整usage时，汇总保留null。
- proposedToolCalls / toolExecutions / mcpCalls：模型提出、宿主开始执行、客户端调用三层计数。read Skill与MCP工具可分别追查。
- rpcDispatches：MCP CallTool实际派发；cacheRpcCalls：宿主缓存读取入口次数。握手、目录读取和清理通知不计业务调用。
- mcpMs：MCP调用累计时间；mcpInitializationMs：首个stdio连接初始化时间，是mcpMs的一部分，不重复相加。
- upstreamRequests / upstreamWriteRequests：固定或在线上游请求数。缓存读取可能增加MCP而不增加上游。
- inputTokens：Pi归一化后的非缓存输入；contextInputTokens：input+cacheRead+cacheWrite。上下文峰值和累计使用后者。output已经包含reasoning子集，不重复相加。
- providerPayloadBytes：实际模型HTTP正文长度，包含工具与输出约束；smoke记录模拟payload。它不是token估算。
- modelToolResultBytes：模型可见工具结果UTF-8字节数，不计完整宿主缓存或历史展示正文。
- estimatedCost：Pi按模型目录与usage计算的估计费用，非账单。
- totalMs：准备完成后直到案例结束与资源关闭的墙钟时间；startupMs单列。
- modelMs：可观察的assistant消息流时间，包含传输、生成及解码，不是纯思考时间。firstTextMs是首段文字；firstCompleteResultMs是第一条正常结束的完整回答，最终仍须判分。
- thinkingChars / visibleThinkingMs / reasoningTokens：仅记录API可见思考；不可见计算不估算，未提供时为null。
- upstreamMs：派发到取得响应头的累计时间；完整MCP阶段耗时查看trace。嵌套阶段不得相加当作总耗时。
- duplicateReads：同对话轮次、批次阶段、工具参数的重复读取提示；必要一致性检查需人工区分。

实际请求和响应沿用脱敏trace，不存请求头、Cookie、密码、密钥或签名。报告外部文字均转义，没有外部脚本依赖。

## 产物与检查

默认输出到 `artifacts/benchmarks/<时间与随机ID>/`，也可指定新 `--out` 目录；拒绝覆盖已有manifest/results。

- manifest.json：协议、数据快照、配置和版本指纹。
- manifest.plannedRuns：启动前持久化的完整计划；初始报告显示待完成数量，中断后的部分结果不能冒充完整套件。
- results.json：全部计划运行结果，含失败和未启动项。
- comparison.json / report.html：机器可读汇总及可筛选本地报告。
- runs/<variant>/<case>/<repeat>/：worker配置、结果、上游事实流、模拟账户状态及独立tracelog。

每完成一例就更新结果和报告。worker有独立截止时间，Windows超时只结束该worker及其子进程树。退出码0表示所有自动硬判通过；失败、超时、基础设施错误或未启动项为1。

```powershell
npm run build:bench
node --test test/benchmark.test.mjs
npm run typecheck
```

自动测试不调用真实模型或真实账户。真实模型和在线验收使用独立评测命令，报告明确区分证据层级。
