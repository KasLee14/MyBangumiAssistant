# 宿主定向恢复契约

新展示使用原生文字及按需固定 `render_<组件名>`，一次原子提交前文、完整组件和后文。延期准备才加载 `prepare_<组件名>` / `present_component` / `present_text`。`ReplyAssembler` 维护已发布完成前缀及完整 `bangumi/presentation` 记录，新生成不执行旧正文 JSON 续写。提供方重试、业务只读重规划和未知写入保护继续运行；展示参数错误消费 `RecoveryController.remainingRecoveryAttempts` 的同一 Pi 重试预算，不追加另一套次数。

组件索引/加载与展示工具的可纠正参数、漏读索引或契约等本地错误，保持原生工具可用，让模型补齐 index→加载→render，不送入旧通用恢复的“停止所有工具”报告路径。定义工具错误同样在真实 tool_execution_end 计入共享预算，准备校验失败与执行失败只计一次，耗尽保留前缀并结束。MCP业务工具错误、缓存权限/业务cause、权限报告计划及未知写入保护继续走原处理。

业务恢复的工具集合由 recovery-loadout.ts 分域管理：执行域快照只包含业务工具，宿主index/spec/展示角色从真实注册表与当前active集合核实，不使用名称前缀或另一份组件状态。限制和恢复都合并最新宿主集合，既有组件不会因业务纠参被撤掉，恢复期新加载的组件也不会被旧快照覆盖。原生report/fatal/unknown停止业务执行，仍可用已有当前缓存和宿主文字报告；引用、账户、NSFW与事实版本继续经过原验证，不能把元数据加载当作新业务授权。旧JSON报告路径仍只允许原文字交付。

策略同时在共用tool_call与顶层beforeToolCall验证，覆盖真实SDK nested executeTool；只读重规划限原许可读集，发现工具不能扩大读写集合，fatal/unknown业务空集。引用恢复许可按同callID、同原工具/参数最多一次重入，双hook不会多消费一次许可。宿主缓存RPC以及批次内部带guard的独立提交/回读仍使用原边界，不经过模型业务执行放行。

普通工具回合不结束展示。最后一个 render 明确 final=true 时，Pi finishTurn 在整批调用均有成功结果、所属回合有效且无取消、待输入或未知写入后提交并结束；任一失败废弃本批完成意图，继续必要纠正。不能在 tool.execute 内提前结束，也不能因为已展示内容看起来完整而省略终态。普通原生最终文字仍只有正常 stop 才作为正文，agent_settled 保存其最终状态。length、deferred、取消及错误不提交草稿；操作失败保留完成前缀，重试幂等。新输入和账户/NSFW/事实版本变化使旧准备不可发布。实时、终态及历史共用唯一完整记录。

以下 JSON 断点和恢复后缀规则仅用于旧输出标记兼容路径。

会话恢复使用Pi已有`turn_end`、`agent_before_settle`边界及原生context_edit/custom_message，不新增前端行为。实现位于`output/recovery.ts`，每个会话独立持有状态；新真实用户输入取消旧等待并建立新的chainId。

## 错误反馈与断点

失败原记录保留在原始历史，模型投影省略该记录并追加`bangumi/recovery-feedback`。反馈含诊断、attempt/maxAttempts、冻结的候选引用和scope、已完成块数、resumeAt、已交付作品ID、待修复对象草稿及恢复目标。宿主系统section明确反馈/草稿仅为数据，仍输出独立合法content JSON，不续写原始JSON字符串。

`bangumi_output_checkpoint`只包含完整且已校验的前缀和待修复对象数据，不复制思考、签名、凭据或原始JSON线路。v2断点补充schemaVersion、resumeAt、failureScope（envelope/part/json/transport/capacity/host）和可定位的failedPartIndex；旧断点信息缺失按未知处理。预测占位不属于prefix。未闭合文本不作为完成事实；草稿保留可读部分供模型重建。

输出截断/JSON未闭合续接未完成后缀；字段错误从待修复块开始返回必要后续内容。确无剩余内容时可返回独立content空数组。根结构无法投影时重新生成输出，不按组件错误盲目追加；原始JSON语法损坏仍失败。入口规范化成功直接完成，不触发恢复。网络/限流原诊断优先使用原退避策略，不能被空JSON断点改成即时续写。展示恢复暂时撤去工具声明，终结输出还检查工具调用，越权工具调用不会执行。恢复结果合并后由宿主重新生成跨边界nextType，再验证内部完整Schema及已交付ID去重；前缀保护和无进展比较基于真实内容指纹，派生连接字段更新不算事实改写；已由prepare_candidate_output提供完整卡片集合时，额外检查成员不增加或遗漏。

单个上游响应即使以length结束，只要原始JSON完整闭合、全部块完成且通过完整内容契约，就直接收束为stop并保留rawStopReason及bangumi_output_finalized，不重新生成合法完整响应。

## 预算与权限

预算来自Pi retry设置并按原始用户任务累计，不因工具回合成功重置。请求网络/限流使用既有有界退避；无法由模型修正的额度配置错误明确停止。错误规则和已完成前缀均不改变时累计无进展，达到2次或maxRetries即停止。

MCP参数/能力/缺口依据本地ReadDiagnosis进入只读重新规划，保留原用户范围。认证、权限和未知写入仅报告已知事实；未知批次回执不会重发或追加写入。恢复反馈不是授权，写入仍受原批次审批和独立核实链路约束。

Pi原生diagnostics中的application_recovery标记autoRetry=host，通用重试分类器不再叠加第二层重试。标题/压缩等独立辅助请求及其他宿主继续使用原策略。取消同时终止宿主等待和Pi运行；任务范围变化使旧恢复停止。

## 持久化与接口

bangumi/recovery记录scheduled/running/recovered/reported/stopped/cancelled及预算、保留块数和错误ID，trace同时记录recovery.state。停止时省略失败投影，追加不含恢复指令的bangumi/recovery-result，保存已完成事实和诊断。新任务不投影旧恢复指令。

宿主SSE使用原回答条目ID/version单调更新，恢复不会追加整份相同回答，也不会重新打开真实用户回合。解码草稿、未闭合文字和未展开引用不进入正文；可恢复错误作为独立source=host的思考过程保留，原始诊断继续保存，不投影正文错误或重试notice。等待期间busy/status保持一致，取消接口可用。停止记录保存完整canonical前缀，耗尽时如实说明回答未完整生成，终态仍为error；历史重建与实时投影一致。前端组件与样式不修改。

组件字段按需读取后，正文修复阶段只开放read_component_index/read_component_spec；原业务读取和写入权限不会随修复扩展。读取后的新组件仍在可见交付前经过字段读取门禁和完整校验，已有稳定前缀不重新判缺契约。空白或只有思考而没有正文的响应识别为CONTENT_OUTPUT_EMPTY并重新生成，不能把空白当作有JSON断点的续写。

## 验收

provider-content定向测试覆盖50+71卡片、只补尾部、坏字段局部修复、禁止工具、重复交付、跨工具预算、取消、MCP反馈、新任务清理、认证、未知写入及额度拒绝；native-web-content覆盖实际SSE同ID更新及停止后历史恢复；Pi retry测试验证宿主接管时不叠加通用重试。真实模型验收仅使用模拟事实，不调用Bangumi账户或写入工具。

反馈不再把expectedNextType作为模型硬约束；提供resumeAt、failureScope、错误路径、草稿、已完成作品ID及原范围。jsonComplete仅说明原始JSON闭合，不证明内容或任务完整。完成块的连接字段可以随后缀重新推导，文本、类型、props及顺序仍必须保留。
