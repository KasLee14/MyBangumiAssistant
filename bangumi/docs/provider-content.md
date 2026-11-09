# 宿主按需展示与回答提交

普通 Bangumi 助手请求使用原生文字及展示工具，不生成整段混合正文 JSON。标题与压缩没有展示标记，继续使用原生输出。Web 外部协议、12种组件名与严格载荷保持原样。

## 发现、加载与原子发布

已明确合法组件名时，直接通过 read_component_spec(names) 激活固定 render_<组件名>；用途不明确时用 read_component_index 发现和分页。索引读取不承担加载权限，新能力始终由固定注册表及下一次真实请求声明确定。回执仅含工具名、版本及状态，Schema不在工具结果中重复。初始与每次真实用户输入均撤去展示声明；压缩、分支和版本变化后重新激活，不能靠旧回执隐式加载。实体引用始终绑定本轮、账户、NSFW及缓存版本。

每个固定 render 工具只携带该组件的参数契约，工具名确定组件，无须再传 component。参数包括当前 resourceRef、明确 subjectIds 或其他实体 members、该组件允许的 title/layout/fields/columns/mode，以及 before/after/final。sources 按顺序组合多个已读缓存引用及其明确成员，与 resourceRef 快捷形式互斥；单对象组件不借多来源扩大范围。宿主逐源校验成员与事实，只合并固定 canonical 数组字段，并冻结全部依赖；错误来源、重复成员、事实变化或超限拒绝整次 render，不删ID、不补字段、不发新网络读取。SubjectCards 省略成员时仍要求已核实完整或冻结结果，明确小范围成员不受其他候选未处理阻断。QuoteBlock/Callout允许必要的文字语义参数，没有任意 props/options 通道。

默认 render_DataTable 用 columns 统一列说明，key对应缓存字段名、label对应标题，未声明的fields仍拒绝。高级 prepare_DataTable及旧generic保留fields快捷形式与fields/columns互斥，输入gate在读取缓存前拒绝冲突；多来源表格的列必须一致。成员不存在/不唯一等错误返回INVALID_INPUT与安全路径，单详情不能选择别的对象，组合来源明确sources。其他内容Schema/容量错误分别为CONTENT_SCHEMA_INVALID/CONTENT_LIMIT_EXCEEDED，权限及业务diagnostic/cause优先原分类。

默认 render 内部完成准备、依赖复核和整段验证，一次原子追加 before→组件→after；任一阶段失败不发布本次操作的任何部分。每轮最多准备64个组件，正文继续遵守128 KiB/16块上限。render 的 final=true 只记录明确完成意图，宿主在 Pi finishTurn 检查整批工具已全部成功、该调用是最后调用、仍属当前回合且无取消或未完成写入后提交并结束，无须模型再发收尾确认。仍有查询或其他内容时继续调用，不能用 final 把部分任务当成完成。

延期准备或复用已有 candidate_output 快照使用 read_component_spec(names,mode='prepare')，仅按需加载所选 prepare_<组件名> 及 present_component/present_text。准备返回 resourceRef 和 blocks，每项只有 blockIndex/type/itemCount；下标属于整个快照，发布只传引用与下标，不覆盖成员或事实。旧通用 prepare_component 保留兼容但不常驻。普通原生文字只有正常 stop 后成为正文，工具回合的原生文字保留过程审计。相同操作、相同块及重准备同内容不重复追加，失败不改写已发布前缀。

## 唯一回答、流式及落盘

reply-assembler.ts 按真实用户回合维护稳定 replyId。原始助手文字、思考、工具调用和用量保持原生记录；内部 bangumi_presentation_source diagnostic 表示其文字不再次作为用户正文。

唯一正文事实是 bangumi/presentation 宿主 custom entry，保存 version/replyId/turnId/status/content 的完整 canonical 快照。open 快照经既有 Web liveContent 展示；普通工具 message_end 不清空它。明确提交成功或 agent_settled 保存终态，转成单个稳定助手 content 条目并清空 liveContent。历史按同一 replyId 重建完整记录；不重解原工具结果，不依靠另一份增量正文，不在终态追加未落盘文字。现有 content/type/pending/nextType 和外部 SSE 协议由宿主继续生成，前端接口不改。

模型请求投影由 model-context.ts 与 presentation-history.ts 按完整可见且已完成的真实用户回合归并纯展示操作：无签名绑定的展示 toolCall 与对应 toolResult 成对移除，在原可见来源处提供一份 canonical 文字、组件身份、顺序与后续追问所需可见事实。评分、日期、表格可见列和单元格、LinkList实际链接保持；实体卡片的图片、非必要URL和长简介省略。业务读取、写入及具体错误证据不按展示操作删除，也不删历史工具参数中的必填引用形成畸形成功样本；历史引用明确不可重用。

原 JSONL、trace、完整 canonical 与思考签名不变。带工具 thoughtSignature 或不透明／Responses reasoning 绑定的调用组保守保持原位，摘要只补未表达的组件事实并引用已有文字位置，避免再复制文字。当前未完成、错误和取消回合保持具体反馈；仅剩部分来源或来源已被压缩移除时，不能借宿主快照复活整轮回答。

文字位置不要求其原操作成功：失败展示调用若保持成对可见、结果可解释、创作字段为与canonical完全一致的字符串，摘要可引用其现有参数位置并标明原操作error/unknown。实际交付及组件事实仍由成功canonical确认，失败调用/结果/必填引用/诊断不折叠；坏信封、非字符串、缺失来源或不支持定位的codec不复用。由此避免一次失败后用相同说明重试成功，历史中又复制同一段说明。

成功工具提交保存 bangumi/presentation_commit 内部凭证，记录实际批次ID/工具名与 all_tools_succeeded；它不是模型参数回显，不进入模型或Web正文。渲染后晚取消检查真实 signal 并保存 aborted，完整合法前缀继续保留，不能因上一帧模型 toolUse 就猜成 completed。

length、deferred、错误、取消、空正文及预算耗尽不记 completed，未完成原生文字不发布。新输入终止旧回答并使准备失效；账户、NSFW或事实版本变化时必须重新读取和准备。业务写入仍经过原权限及授权边界。

## 原始工具参数及提供方约束

展示工具声明 constrainedSampling=json_schema/strict:prefer，并复用实际模型能力政策。复杂根分支不能转换为可靠 strict 子集时明确回退到完整本地校验，不删除分支约束。新路径不注入 response_format:json_object 或全正文 text.format。DeepSeek官方 Responses 仍保留 system 角色与完整输入。已约定 strict 工具线路的可选 null 仅映回省略，其他非法字段继续拒绝。

每个 render/prepare 工具根显式声明 type=object，保留自身 required/additionalProperties 和来源选择约束；12个组件联合只保留在旧 generic 兼容工具，不随默认请求发送。请求声明与原始参数校验复用相同固定 Schema。非strict Pi转换保留完整约束，本机HTTP模拟证明编码与执行门禁；外部服务接收仍须真实模型 benchmark。

presentation-arguments.ts 只读取 Pi 内部保真的原始参数 WeakMap；strict parse后至多一次确定性 EOF容器闭合或字符串外尾逗号修复，再执行所选组件 Schema、完整工具 Schema和业务 gate。重复键、残缺字符串/scalar、中间歧义及length/取消/中断拒绝；不补必填或ID、不删成员、不转换类型，也不修写工具。bangumi/presentation_arguments 审计记录 syntax/schema阶段、accepted/repaired/rejected、规则、路径及toolCallId，不保存raw或字段值。

仅 repaired/rejected 额外产生本地 trace 的 presentation.arguments_debug 事件与 debug_ref。专用载荷在写入前用 credentialValues/redact 和不完整凭据尾部保护脱敏，保留 JSON 字面形状、重复键及空白，不经 JSON.parse 重序列化；offsetBasis 明确偏移属于脱敏前原始文本，脱敏可能改变长度。rawArguments/debug_ref 不加入公开 custom entry 或模型上下文，成功原参数不另存。生产回归见 test/presentation-arguments-debug.test.mjs。

展示纠参消费同一 RecoveryController 剩余 Pi 重试预算；重复无进展发布也受限。旧全正文JSON修复仅保留在旧标记兼容路径。供应商原生重试、业务只读恢复和未知写入保护继续有效。

## 验证

定向测试为 test/presentation-flow.test.mjs：12组件各自准备/缓存展开/原生发布、成员顺序、绝对下标、幂等、失败、范围及版本、容量、预算、真实Pi→Web SSE open/终态、取消/length/空正文和历史回放。test/presentation-arguments.test.mjs验证原始参数扫描及本地修复。完整宿主检查为 npm run test:mcp，字段文档通过 scripts/sync-mcp-doc.mjs同步。

离线模拟链路、真实模型加固定上游、真实Bangumi网络和浏览器显示属于不同证据层，不互相替代。正式benchmark冻结宿主/依赖/案例/模型/思考配置并评分最后canonical记录；failed/aborted/incomplete_capture与源码漂移结果不能成为完成基线。

## 旧正文JSON兼容路径

以下仅描述旧 bangumi-provider-content-v2 标记的兼容解码和历史记录；新生成使用上文展示工具架构。

### 内容与完成状态

message_update.message.content 与 message_end.message.content 直接包含 text 和现有 12 种组件，不再使用 contentOutput 旁路。

模型输出根对象必须包含 content 数组，不能以裸组件对象作根对象，不能在 JSON 后追加 Markdown 或生成全空白正文。文本仅必填 type、text；模型无需生成 nextType。宿主内部文本保留 nextType，由实际展示顺序推导，最终末项为 null。入口兼容旧 nextType，但预测占位不作为用户正文或完成断点。canonical 模式仍严格检查内部连接关系。

组件名称直接使用 Web 协议的 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList，不接受旧小写别名。对象载荷的占位示例为 { type: "SubjectCards", pending: true, props: {} }，TagCloud 占位的 props 为 []。根据本项目明确约定：

- pending:true 表示占位或生成中。
- pending:false 表示完整且通过组件字段校验。
- 模型组件仅必填 type、props，不需要生成 pending；兼容旧状态字段但不信任其值。模型生成的组件仅在闭合、字段校验、读取契约门禁及必要缓存展开通过后发布 pending:false。
- 未闭合文本、预测占位和部分 props 保留在宿主解码状态，不作为用户正文公开。已完成且通过校验的块可以逐块发布；后续块失败时保留合法完成前缀，恢复仅补未完成后缀。
- 修复后缀还须经过宿主合并校验，不能重复此前的内容或改变已锁定的成员范围。
- InfoBox.props 直接包含 rows；TagCloud.props 直接为标签对象数组，不包装 tags 字段。数组完整闭合后再发布，不能公开半份。

完整输出须满足 nextType 与实际下一项一致，所有组件完成。取消或截断仅在用户正文保留已经发布的合法完成部分；未完成草稿仍供宿主诊断和恢复使用，不冒充完整结果。

### 组件索引与字段按需读取

系统提示只包含根对象格式、通用边界和简短展示规则，不携带全量组件字段。普通解释、澄清及改写允许仅使用 text。需要组件时按以下顺序读取：

1. 调用 read_component_index，按中文用途、组件名或 category 查询。offset、limit 与 nextOffset 支持完整遍历，索引只返回用途、适用数据及分类，不包含字段 Schema。
2. 调用 read_component_spec(names, representation?)，一次读取一个或多个已发现组件。默认 auto：本轮上下文出现实体或准备格式明确适用的缓存引用时使用 reference，否则使用 inline；Callout、QuoteBlock 等创作文字默认 inline。返回每组件本次唯一 props 契约、必填项、选择依据及表示形式，不同时展示两份可混抄的字段 Schema。可通过显式 reference 或 inline 重读切换。契约从 COMPONENT_PAYLOAD_SCHEMAS、resourceReferenceSchema 派生，不维护第二份字段定义。
3. 生成 content 数组中的已读组件。返回的示例仅说明信封和嵌套格式，rr_example 为占位引用，不能用于真实展示；实际引用必须来自本轮工具结果。

组件用途及字段是纯定义，按目录版本和上下文可见性管理，完整同版本最新说明可跨用户轮复用。每个真实用户任务重置事实引用观测及本轮读取计数；纯契约成功凭证和最新表示形式保持，绑定请求时再核对真实可见的完整工具结果。审计 contracts 记录原始 sourceTurn、单调 selectionId 及 reused 标记，不把复用伪装成本轮新读取。首次新会话必须索引再字段；已有可见目录的组件不必再次读索引。

旧版本、摘要、被精简的 Schema 或被新选择替代的旧表示形式不视为字段已加载。压缩遗失最新说明后重新读取，旧选择不能恢复为最新契约。正文发布前检查已加载契约及实际模型 props 符合唯一表示形式，JSON 对象模式也不能绕过此门禁；已验证的恢复前缀不重新判为未读取。定义复用不会续期 resourceRef、账户/NSFW 范围或成员事实，旧事实引用仍由当前读取轮次 validator 及宿主缓存校验拒绝。

引用 props 不允许混入 inline 的 total、hint 或完整实体成员；内部 canonical 展开字段与本次模型 props 是两层契约。用户要求的事实没有所选组件的合法字段时，通过 text 或另外读取 InfoBox 等组件交付，不增造字段，不因格式修复而删除尚未交付的事实要求。组件合法并不证明任务完整。

本地组件契约工具结果不进入过期缓存引用清理，因为 referenceProps 中的 resourceRef 是字段定义。模型历史展示仍只保留精简身份和说明；实际展示事实使用本轮适用的缓存引用由宿主展开。

### Provider 约束

模型协议与正文能力分别判断。已知支持结构化输出的 OpenAI 模型、openai 提供方及 https://api.openai.com 端点，按本轮实际已读组件生成正文 Schema：Responses 使用 text.format 的 json_schema，Completions 使用 response_format 的 json_schema。未读取组件时仅允许 text。其他兼容端点及未验证模型保留对应 API 的 json_object；切换 Responses 本身不等于启用严格正文。

DeepSeek 官方 https://api.deepseek.com 的 Responses 已声明支持 deepseek-flash、deepseek-v4-pro 及 text.format.json_schema，因此这两个已核实模型在 openai-responses 协议下启用按需正文 Schema。DeepSeek Chat Completions 仍保留 json_object，不推断第三方兼容端点具有同等能力。官方 Responses 参考仅列出 format 的 type、name、schema，本项目按此结构发送；不额外宣称未列明的 strict 开关或函数参数 strict 保证。函数参数仍按本机实际模型 compat 声明启用约束，配置未声明时宿主严格校验不可省略。[DeepSeek Responses 指南](https://api-docs.deepseek.com/guides/responses_api/)、[Responses API 参考](https://api-docs.deepseek.com/api/create-response/)

DeepSeek Responses 是无状态接口，不支持 previous_response_id 或服务端会话存储。每次请求须回传完整 input 历史及 function_call/function_call_output 配对，不把 OpenAI 的 response ID 续接能力套用到此提供方；当前 Pi Responses 转换保留完整 input。

DeepSeek 将 developer 角色按 user 处理，而 Pi 默认可能将推理模型的系统规则编码成 developer。官方 Responses 适配在请求边界将这一角色映射回 system，保持原内容及用户、工具配对；模型示例同时明确 supportsDeveloperRole:false，防止本地完整模型定义覆盖内置 metadata 后降低系统规则权限。

DeepSeek 高思考请求带工具时须回传历史原生思考。恢复的宿主完成前缀应插入原生 thinking 之后，避免编码成缺 reasoning_text 的独立 assistant 项。请求边界对旧恢复消息只做有签名依据的顺序修复：现有 reasoning item 必须与该原生 thinkingSignature 逐字段一致，随后移动到同消息的宿主前缀之前；不新增思考、不改签名、summary 或工具配对。宿主诊断不能当作模型思考回传。无 Responses 签名的旧 Chat 历史不由此机制补造，切换协议还须单独核验旧历史回放。[DeepSeek 思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/)

官方 Responses 配置示例位于 bangumi/config/models.example.json，使用 DEEPSEEK_API_KEY 环境变量占位，明确函数 supportsStrictMode:false。此声明不影响正文 json_schema：两者能力独立。示例不修改本机 models.json 或默认模型，切换前用隔离 agent-dir 和相同 high 思考强度对照。真实 Responses 两案例接入已观察到模型读取索引和字段、返回缓存引用、宿主展开并生成合法组件；原生 textSignature 是 Pi 元数据，benchmark 对内部展示契约的校验须先投影正文，不把签名算为组件字段或正文文字。最终验收以修正后的 benchmark 报告为准。

严格 Schema 要求对象关闭额外字段、所有属性列为 required，可选属性通过允许 null 表达。宿主只在 provider 入口将原 Schema 声明的可选 null 投影为省略；必填 null、未知属性和非法类型仍拒绝，MCP 及内部完成契约不接受这一生成层替代形式。工具参数 strict 和正文 strict 为两条独立约束链。[OpenAI Structured Outputs 文档](https://developers.openai.com/api/docs/guides/structured-outputs)

DataTable 的 inline 对象行使用动态 columns.key，不能直接转换为关闭额外字段的严格 Schema。当轮选择 inline DataTable 时整个正文请求回退 json_object，不改为矩阵，也不放宽宿主的对象行及唯一列键校验；reference DataTable 由宿主展开对象行，本次模型 props 为关闭字段的引用契约，因此可继续使用正文 json_schema。不强制使用引用。provider-content.ts 定义模型入口，component-catalog.ts 派生按需生成契约，content-schema.ts 保留严格内部输出；状态字段由宿主生成。JSON 对象约束不保证具体字段结构，生成后仍须完整校验。

JSON 对象模式中未知可选属性省略；严格正文模式允许用 null 表达未知可选属性，宿主投影后省略。DataTable.props.rows 为对象数组，单元格为字符串，使用 columns.key 作为行字段；pending:false 在宿主完整结果和历史回放中保留，模型无需填写。输出最多 128 KiB、16 项，并遵守已有组件数组限制。

会话恢复由宿主按Pi retry设置执行，Provider层maxRetries保持0。模型收到结构化错误反馈，完成块由宿主保留，未完成内容返回独立JSON并合并校验；反馈不能授权工具或写入。预算按用户任务累计，源错误不会再触发叠加的Pi盲目重试。完整JSON在length边界可直接收束。详情见[定向恢复契约](response-recovery.md)。

默认组件选择：作品搜索、推荐、收藏列表用 SubjectCards；行列事实用 DataTable；分布和指标用 StatsCard；键值信息用 InfoBox；进度用 ProgressView。解释和澄清用 text，明确纯文本要求会被尊重。明确必要组件检查只认可 pending:false 的已完成组件，不依据脆弱关键词强制转化 Markdown。

### 模型入口投影与规范化

入口只消费根对象自有content数组，不递归寻找其他包装。额外根字段不进入正文、工具操作或恢复指令，记录有界脱敏的bangumi_output_normalized诊断和content.normalized trace事件；合法正文正常完成，不启动模型恢复。未知块字段、props字段、非法类型/必填项及重复JSON字段仍拒绝。原始线路的全部字段仍受字节、嵌套和语法限制。

nextType和pending的兼容处理只作用于模型入口；内部validateMixedContent及MCP校验保持严格。恢复合并后重算nextType，已交付文本和props不得改写。

### 原生事件与回放

provider-output 消费 Pi 已规范化的文字流，原始 JSON 不作为正文输出。闭合的合法文本转为原生 text_start/text_delta/text_end，完整且获准展示的组件转为 content_update。未闭合文字、占位和部分 props 不发用户正文增量。Agent Loop 将这些事件转为既有 message_update，不新增网络广播周期。

工具、思考、签名和用量仍按原生类型保留。Pi 的开放 AssistantContentExtensions 只提供扩展槽位，Bangumi 注册具体组件。convertToLlm 将组件确定性序列化为文本，后续请求和压缩仍能读取组件事实；会话存储保持原生组件内容。组件 JSON 也纳入上下文大小估算。

### Web 后端边界

组件名称与 props 类型直接从 bangumi/src/web/protocol.ts 的 ContentBlockView 派生。原生组件与前端消息块使用相同名称和载荷，不再需要语义名转换表或 TagCloud 解包。contentView 保留同名投影能力，pending:true 保持生成中，完成后保留 pending:false。

Web 宿主现有 blocksFromContent / blocksFromMessage 透传已完成组件，覆盖流式、消息完成和历史重建；前端按注册表识别。格式失败及自动恢复诊断放在过程区的“宿主校验过程”，明确来源是宿主而非模型思考，不生成正文错误卡。修复更新同一回答，保留合法前缀，避免重复输出。恢复耗尽时仅说明回答未完整生成，不能把失败伪装成成功。

### 旧路径验证

错误终态附带Pi原生diagnostics，长度截断、JSON问题、字段契约和内容容量分别定位；原始输出只保存到脱敏本地trace。接口返回字段、诊断日志与恢复建议的边界见[错误诊断](error-diagnostics.md)。

Bangumi：npm run typecheck、npm run test:mcp。Pi：按 AGENTS.md 执行 check 和定向测试，不运行真实账户写入。验证包含全部组件库样例、任意分片、未闭合草稿不发布、组件读取门禁、严格正文可选 null 投影、工具索引和签名、下一轮事实回放、压缩说明失效、取消与历史恢复。组件专属测试为 test/component-catalog.test.mjs、test/provider-options.test.mjs、test/content-schema.test.mjs。

benchmark 验收须区分证据层级：离线脚本和模拟故障可以验证宿主读取、校验、恢复及正文可见边界；真实模型在固定上游数据上运行可以验证模型实际调用和生成行为；真实 Bangumi 网络读取是另一层证据。模拟裸组件、全空白正文等失败不能证明模型本身已减少格式错误，也不能证明外部服务支持严格 Schema。比较首次成功率、恢复次数、输入 token 与延迟时保持模型、思考强度及案例一致，并单独报告未完成任务。

当前 provider 只读验收运行 node verify-provider-content.mjs。脚本复用本地 Pi 配置，通过 Clash 7890 请求模拟作品列表，不执行 Bangumi 工具、不打印凭据，只报告原生内容类型、占位/完成、增量与请求次数。源码或本地 Pi 依赖更新后，现有 Web 进程须重启才能加载新实现。

原prompt真实只读复测：从bangumi目录运行node scripts/verify-weekly-broadcast.mjs，复用原会话的deepseek-flash/high模型设置和原始周历prompt，仅开放读取工具，使用内存会话。报告保存在artifacts/weekly-broadcast-retest；包含原始线路回放、最终内容校验、周一至周日七行、错误/恢复次数和trace。真实模型可能选择不同读取路径；该脚本不修改原会话或执行账户写入。
