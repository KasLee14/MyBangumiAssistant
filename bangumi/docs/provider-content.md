# 原生助手混合内容

普通 Bangumi 助手请求默认使用结构化内容，不需要开关。旧 --content-output 参数已移除。标题、压缩等没有应用输出标记的辅助请求保持原生输出。

## 内容与完成状态

message_update.message.content 与 message_end.message.content 直接包含 text 和现有 12 种组件，不再使用 contentOutput 旁路。

模型文本仅必填 type、text，nextType 是可选的提前骨架提示。宿主内部文本保留 nextType，由实际展示顺序推导，最终末项为 null。预测占位与真实内容分开保存；预测错误时同索引由实际类型替换，预测未出现时在终态移除，预测不进入完成断点。canonical 模式仍严格检查内部连接关系。

组件名称直接使用 Web 协议的 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList，不接受旧小写别名。对象载荷的占位示例为 { type: "SubjectCards", pending: true, props: {} }，TagCloud 占位的 props 为 []。根据本项目明确约定：

- pending:true 表示占位或生成中。
- pending:false 表示完整且通过组件字段校验。
- 模型组件仅必填 type、props，不需要生成 pending；兼容旧状态字段但不信任其值。运行时在组件闭合并通过校验前向前端发布 pending:true，通过后才发布 pending:false。
- 已闭合且有效的顶层 props 字段可以增量公开；嵌套对象和数组不能发布半份。
- 占位和完整组件复用同一内容索引，不重复追加。
- InfoBox.props 直接包含 rows；TagCloud.props 直接为标签对象数组，不包装 tags 字段。数组完整闭合后再发布，不能公开半份。

完整输出须满足 nextType 与实际下一项一致，所有组件完成。取消或截断保留可读草稿和 pending:true 占位，不冒充完整结果。

## Provider 约束

Responses 请求注入 text.format:json_object，Completions 请求注入 response_format:json_object。DataTable 对象行使用动态 columns.key。provider-content.ts 定义模型输入和生成提示，content-schema.ts 定义严格内部输出；两层共享组件载荷规则，状态字段由宿主生成。MCP展示回执只使用内部严格契约。JSON对象约束负责语法，不保证具体字段结构。

未知可选属性省略，不用 null 填充。DataTable.props.rows 为对象数组，单元格为字符串，使用 columns.key 作为行字段；pending:false 在宿主完整结果和历史回放中保留，模型无需填写。输出最多 128 KiB、16 项，并遵守已有组件数组限制。

会话恢复由宿主按Pi retry设置执行，Provider层maxRetries保持0。模型收到结构化错误反馈，完成块由宿主保留，未完成内容返回独立JSON并合并校验；反馈不能授权工具或写入。预算按用户任务累计，源错误不会再触发叠加的Pi盲目重试。完整JSON在length边界可直接收束。详情见[定向恢复契约](response-recovery.md)。

默认组件选择：作品搜索、推荐、收藏列表用 SubjectCards；行列事实用 DataTable；分布和指标用 StatsCard；键值信息用 InfoBox；进度用 ProgressView。解释和澄清用 text，明确纯文本要求会被尊重。明确必要组件检查只认可 pending:false 的已完成组件，不依据脆弱关键词强制转化 Markdown。

## 模型入口投影与规范化

入口只消费根对象自有content数组，不递归寻找其他包装。额外根字段不进入正文、工具操作或恢复指令，记录有界脱敏的bangumi_output_normalized诊断和content.normalized trace事件；合法正文正常完成，不启动模型恢复。未知块字段、props字段、非法类型/必填项及重复JSON字段仍拒绝。原始线路的全部字段仍受字节、嵌套和语法限制。

nextType和pending的兼容处理只作用于模型入口；内部validateMixedContent及MCP校验保持严格。恢复合并后重算nextType，已交付文本和props不得改写。

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

原prompt真实只读复测：从bangumi目录运行node scripts/verify-weekly-broadcast.mjs，复用原会话的deepseek-flash/high模型设置和原始周历prompt，仅开放读取工具，使用内存会话。报告保存在artifacts/weekly-broadcast-retest；包含原始线路回放、最终内容校验、周一至周日七行、错误/恢复次数和trace。真实模型可能选择不同读取路径；该脚本不修改原会话或执行账户写入。
