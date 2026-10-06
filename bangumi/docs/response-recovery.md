# 宿主定向恢复契约

会话恢复使用Pi已有`turn_end`、`agent_before_settle`边界及原生context_edit/custom_message，不新增前端行为。实现位于`output/recovery.ts`，每个会话独立持有状态；新真实用户输入取消旧等待并建立新的chainId。

## 错误反馈与断点

失败原记录保留在原始历史，模型投影省略该记录并追加`bangumi/recovery-feedback`。反馈含诊断、attempt/maxAttempts、冻结的候选引用和scope、已完成块数、resumeAt、已交付作品ID、待修复对象草稿及恢复目标。宿主系统section明确反馈/草稿仅为数据，仍输出独立合法content JSON，不续写原始JSON字符串。

`bangumi_output_checkpoint`只包含完整且已校验的前缀和待修复对象数据，不复制思考、签名、凭据或原始JSON线路。错误落在已闭合text的nextType时回退至该text块。未闭合文本不作为完成事实；草稿保留可读部分供模型重建。

输出截断/JSON未闭合续接未完成后缀；字段错误仅修复该后缀。展示恢复暂时撤去工具声明，终结输出还检查工具调用，越权工具调用不会执行。恢复结果验证完整Schema、跨边界nextType及已交付ID去重；已由prepare_candidate_output提供完整卡片集合时，额外检查成员不增加或遗漏。

单个上游响应即使以length结束，只要原始JSON完整闭合、全部块完成且通过完整内容契约，就直接收束为stop并保留rawStopReason及bangumi_output_finalized，不重新生成合法完整响应。

## 预算与权限

预算来自Pi retry设置并按原始用户任务累计，不因工具回合成功重置。请求网络/限流使用既有有界退避；无法由模型修正的额度配置错误明确停止。错误规则和已完成前缀均不改变时累计无进展，达到2次或maxRetries即停止。

MCP参数/能力/缺口依据本地ReadDiagnosis进入只读重新规划，保留原用户范围。认证、权限和未知写入仅报告已知事实；未知批次回执不会重发或追加写入。恢复反馈不是授权，写入仍受原批次审批和独立核实链路约束。

Pi原生diagnostics中的application_recovery标记autoRetry=host，通用重试分类器不再叠加第二层重试。标题/压缩等独立辅助请求及其他宿主继续使用原策略。取消同时终止宿主等待和Pi运行；任务范围变化使旧恢复停止。

## 持久化与接口

bangumi/recovery记录scheduled/running/recovered/reported/stopped/cancelled及预算、保留块数和错误ID，trace同时记录recovery.state。停止时省略失败投影，追加不含恢复指令的bangumi/recovery-result，保存已完成事实和诊断。新任务不投影旧恢复指令。

宿主SSE使用原回答条目ID/version更新，恢复不会追加整份相同回答；错误行更新为当前诊断，恢复完成后转为既有notice。等待期间busy/status保持一致，取消接口可用。历史重建从原生最终回答或停止记录还原完成部分。前端源码、样式和交互不修改。

## 验收

provider-content定向测试覆盖50+71卡片、只补尾部、坏字段局部修复、禁止工具、重复交付、跨工具预算、取消、MCP反馈、新任务清理、认证、未知写入及额度拒绝；native-web-content覆盖实际SSE同ID更新及停止后历史恢复；Pi retry测试验证宿主接管时不叠加通用重试。真实模型验收仅使用模拟事实，不调用Bangumi账户或写入工具。
