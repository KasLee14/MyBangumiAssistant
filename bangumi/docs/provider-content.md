# 原生助手混合内容

普通 Bangumi 助手请求默认使用结构化内容，不需要开关。旧 --content-output 参数已移除。标题、压缩等没有应用输出标记的辅助请求保持原生输出。

## 内容与完成状态

message_update.message.content 与 message_end.message.content 直接包含 text 和现有 12 种组件，不再使用 contentOutput 旁路。

文本形状为 { type: "text", nextType: "subjects", text: "..." }。nextType 是紧邻下一内容的类型；末项文本为 null。模型按 type、nextType、text 顺序生成，以便运行时在文字生成前预留下一组件位置。

所有组件使用 { type: "subjects", pending: true, props: {} } 形状。根据本项目明确约定：

- pending:true 表示占位或生成中。
- pending:false 表示完整且通过组件字段校验。
- pending 由运行时产生，模型不生成该字段。
- 已闭合且有效的顶层 props 字段可以增量公开；嵌套对象和数组不能发布半份。
- 占位和完整组件复用同一内容索引，不重复追加。
- infobox.props 直接包含 rows；tags.props 包含 tags 数组。

完整输出须满足 nextType 与实际下一项一致，所有组件完成。取消或截断保留可读草稿和 pending:true 占位，不冒充完整结果。

## Provider 约束

Responses 请求注入 text.format 严格 JSON Schema。通用 Completions 请求注入 response_format.json_schema。DeepSeek Completions 根据其服务能力使用 response_format:json_object，字段由同一套本地 schema 严格检查；该模式不是服务端字段 schema 保证，也不是请求失败后自动降级重试。DeepSeek 能力见 [官方 JSON Output 说明](https://api-docs.deepseek.com/guides/json_mode/)。

严格 schema 的可选属性在线路中使用 null，规范化只移除允许省略的空值。table.props.rows 在线路中为二维字符串数组，按 columns 顺序恢复现有行对象。输出最多 128 KiB、16 项，并遵守已有组件数组限制。

默认组件选择：作品搜索、推荐、收藏列表用 subjects；行列事实用 table；分布和指标用 stats；键值信息用 infobox；进度用 progress。解释和澄清用 text，明确纯文本要求会被尊重。明确必要组件检查只认可 pending:false 的已完成组件，不依据脆弱关键词强制转化 Markdown。

## 原生事件与回放

provider-output 消费 Pi 已规范化的文字流，原始 JSON 不作为正文输出。文本转为原生 text_start/text_delta/text_end；占位、props 和完成变化转为内部 content_update。Agent Loop 将这些事件转为既有 message_update，不新增网络广播周期。

工具、思考、签名和用量仍按原生类型保留。Pi 的开放 AssistantContentExtensions 只提供扩展槽位，Bangumi 注册具体组件。convertToLlm 将组件确定性序列化为文本，后续请求和压缩仍能读取组件事实；会话存储保持原生组件内容。组件 JSON 也纳入上下文大小估算。

## Web 后端边界

输出层的 contentView 将原生组件投影为新版前端的消息块，pending:true 保持生成中，完成后保留 pending:false。此函数不改变模型线路与保存的原生内容类型。

本次不修改 web/ 和 bangumi/src/web/，也不接入宿主事件处理。合并后宿主使用的块序列与原生组件命名仍需在后续 Web 集成时衔接。

## 验证

Bangumi：npm run typecheck、npm run test:mcp。Pi：按 AGENTS.md 执行 check 和定向测试，不运行真实账户写入。验证包含全部组件库样例、任意分片、提前占位、部分 props、pending:true 到 pending:false、文本生命周期、工具索引和签名、下一轮事实回放、压缩、取消与历史恢复。

当前 provider 只读验收运行 node verify-provider-content.mjs。脚本复用本地 Pi 配置，通过 Clash 7890 请求模拟作品列表，不执行 Bangumi 工具、不打印凭据，只报告原生内容类型、占位/完成、增量与请求次数。源码或本地 Pi 依赖更新后，现有 Web 进程须重启才能加载新实现。
