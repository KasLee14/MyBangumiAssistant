# 原生助手混合内容

普通 Bangumi 助手请求默认使用结构化内容，不需要开关。旧 --content-output 参数已移除。标题、压缩等没有应用输出标记的辅助请求保持原生输出。

## 内容与完成状态

message_update.message.content 与 message_end.message.content 直接包含 text 和现有 12 种组件，不再使用 contentOutput 旁路。

文本形状为 { type: "text", nextType: "SubjectCards", text: "..." }。nextType 是紧邻下一内容的类型；末项文本为 null。模型按 type、nextType、text 顺序生成，以便运行时在文字生成前预留下一组件位置。

组件名称直接使用 Web 协议的 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList，不接受旧小写别名。对象载荷的占位示例为 { type: "SubjectCards", pending: true, props: {} }，TagCloud 占位的 props 为 []。根据本项目明确约定：

- pending:true 表示占位或生成中。
- pending:false 表示完整且通过组件字段校验。
- 模型生成的完整组件必须提供 pending:false；运行时在组件闭合并通过校验前向前端发布 pending:true，通过后才发布 pending:false。
- 已闭合且有效的顶层 props 字段可以增量公开；嵌套对象和数组不能发布半份。
- 占位和完整组件复用同一内容索引，不重复追加。
- InfoBox.props 直接包含 rows；TagCloud.props 直接为标签对象数组，不包装 tags 字段。数组完整闭合后再发布，不能公开半份。

完整输出须满足 nextType 与实际下一项一致，所有组件完成。取消或截断保留可读草稿和 pending:true 占位，不冒充完整结果。

## Provider 约束

Responses 请求注入 text.format:json_object，Completions 请求注入 response_format:json_object。DataTable 对象行使用动态 columns.key，生成协议与 convertToLlm、会话存储及前端保持一致；JSON 对象约束负责语法，组件字段由同一套本地 schema 严格检查。

未知可选属性省略，不用 null 填充。DataTable.props.rows 为对象数组，单元格为字符串，使用 columns.key 作为行字段；pending:false 在生成、回放及完整结果中均保留。输出最多 128 KiB、16 项，并遵守已有组件数组限制。

会话恢复由宿主按Pi retry设置执行，Provider层maxRetries保持0。模型收到结构化错误反馈，完成块由宿主保留，未完成内容返回独立JSON并合并校验；反馈不能授权工具或写入。预算按用户任务累计，源错误不会再触发叠加的Pi盲目重试。完整JSON在length边界可直接收束。详情见[定向恢复契约](response-recovery.md)。

默认组件选择：作品搜索、推荐、收藏列表用 SubjectCards；行列事实用 DataTable；分布和指标用 StatsCard；键值信息用 InfoBox；进度用 ProgressView。解释和澄清用 text，明确纯文本要求会被尊重。明确必要组件检查只认可 pending:false 的已完成组件，不依据脆弱关键词强制转化 Markdown。

## 原生事件与回放

provider-output 消费 Pi 已规范化的文字流，原始 JSON 不作为正文输出。文本转为原生 text_start/text_delta/text_end；占位、props 和完成变化转为内部 content_update。Agent Loop 将这些事件转为既有 message_update，不新增网络广播周期。

工具、思考、签名和用量仍按原生类型保留。Pi 的开放 AssistantContentExtensions 只提供扩展槽位，Bangumi 注册具体组件。convertToLlm 将组件确定性序列化为文本，后续请求和压缩仍能读取组件事实；会话存储保持原生组件内容。组件 JSON 也纳入上下文大小估算。

## Web 后端边界

组件名称与 props 类型直接从 bangumi/src/web/protocol.ts 的 ContentBlockView 派生。原生组件与前端消息块使用相同名称和载荷，不再需要语义名转换表或 TagCloud 解包。contentView 保留同名投影能力，pending:true 保持生成中，完成后保留 pending:false。

Web 宿主现有 blocksFromContent / blocksFromMessage 原样透传组件，覆盖流式、消息完成和历史重建；前端按注册表直接识别。无需改变 Web 协议或前端渲染器。

## 验证

错误终态附带Pi原生diagnostics，长度截断、JSON问题、字段契约和内容容量分别定位；原始输出只保存到脱敏本地trace。接口返回字段、诊断日志与恢复建议的边界见[错误诊断](error-diagnostics.md)。

Bangumi：npm run typecheck、npm run test:mcp。Pi：按 AGENTS.md 执行 check 和定向测试，不运行真实账户写入。验证包含全部组件库样例、任意分片、提前占位、部分 props、pending:true 到 pending:false、文本生命周期、工具索引和签名、下一轮事实回放、压缩、取消与历史恢复。

当前 provider 只读验收运行 node verify-provider-content.mjs。脚本复用本地 Pi 配置，通过 Clash 7890 请求模拟作品列表，不执行 Bangumi 工具、不打印凭据，只报告原生内容类型、占位/完成、增量与请求次数。源码或本地 Pi 依赖更新后，现有 Web 进程须重启才能加载新实现。
