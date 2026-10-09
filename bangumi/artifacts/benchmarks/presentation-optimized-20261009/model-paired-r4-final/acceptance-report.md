# r4 最终验收

40 planned / 40 records完整闭环，候选20/20自动硬规则通过，对照19/20（facts-data-table #1 errored完整保留）。源码、dist、依赖与模型配置hash稳定，capture/fixtureMiss/timeout/budget/not_run均无异常，benchmark进程残留0。

19个双方成功的eligible配对（不把失败低耗时当节省）：

| 指标 | control | candidate | 变化 |
| --- | ---: | ---: | ---: |
| 模型请求总数 | 135 | 50 | -62.96% |
| 累计context tokens（含cache） | 1,939,946 | 434,300 | -77.61% |
| peak context中位数 | 13,195 | 9,211 | 逐配对比例中位数-30.74% |
| 总耗时之和(ms) | 365,436 | 305,659 | -16.36% |
| 模型耗时之和(ms) | 160,227 | 126,710 | -20.92% |

全部运行operation仍保留：control139请求/22toolErrors/1presentation模型纠参，candidate52请求/0toolErrors/0presentation纠参。实时API响应191/191为200，trace实际response_model均deepseek-flash，usage191/191完整；配置价格为0，不把estimatedCost0当实际账单证明。

结构证据：每真实user初始display Schema0；loader ack无完整Schema；实际52个candidate payload仅声明同user累计已加载组件；19次presentation_commit具有成功batch凭证，commit→settled无额外HTTP；普通native stop保持正常。DataTable实际root object/no component/no fields/有columns；多源6次都使用同轮已读cache，各source仅一次事实读取。10个后续payload保留原业务read call/result与scope事实。24条候选已完成正文观察全为单份，实际签名fallback未出现（signed机制依离线测试，不声称外部签名服务证明）。

观察器误计透明保留：raw displayLoadoutMismatches=1发生于facts-basic #1，先选SubjectCards+DataTable，再增InfoBox；ack是delta而harness按最后ack替换expectedSet，误报先前已选工具。逐actualpayload累计成功选择审计为0真正mismatch，没有改原metrics/results/grade/hash，亦非gate豁免。

原r3四条失败诊断/成功canonical同文重复，在r4离线精确来源重放中均2→1；失败args/error/IDs配对与canonical facts/status不变，文字引用operationOutcome=error，不将失败操作当成功证据。该replay无新model/HTTP，不混入上述成本；trace签名脱敏与有限plain codec标签重建限制另有记录。

**自然语言语义边界仍存在**：最新人工resource-card4条复核为semantic_caution，均显式读过summary且组件facts一致，但例如候选#2把失踪档案扩写成失踪案留下档案，属于无来源剧情细节。原自动semanticPending4与硬grade/eligible不变；不称自由文字语义全面可信或总体可靠性已得到统计保证。

验证层级：本版offline3raw+2terminal+2negative全部符合预期，负向errored/budget_exceeded仍为失败结果；r4历史与相关集成39/39、root type/doc15/diff检查通过。此前全host1053的knowncoverage在dirty r4 control独立复现；另一旧classification fixture生命周期已保留守卫断言并30/30通过。真实模型只替代上游为固定Bangumi fixture，生产Pi/MCP/cache/组件宿主真实；不声称真实Bangumi网络、账号写入或浏览器DOM验收。

- [交互报告](report.html)
- [正式成本与资格](acceptance-summary.json)
- [关闭与版本配置证明](closure.json)
- [actualpayload/route/usage](actual-payload-evidence.json)
- [schema/commit/来源/正文结构](structural-audits.json)
- [累计selection精确审计（raw1/audited0）](selected-schema-activation-audits.json)
- [业务事实保真](business-evidence-audits.json)
- [对照错误原证据](failure-control-facts-data-table-1.json)
- [最新人工语义复核](semantic-review.json)
- [原r3到r4零HTTP重放](../r4-projection-replay.json)
- [本版离线门槛](../offline-r4-final-summary.json)

当前candidate fingerprint：bfbd14e93345a88a70e7657b9b63d818bfd6afc984a8798b00379ee765fd01a9；control：e283b58868250ccb231df245222facdefc81c607cb4a026eb1367ed81481b168。原10core prompts/hard rules、DeepSeekFlash/high、每例18req/300sec、global500、repeats2与harness1df95d均保持。未混合r1/r2/r3模型结果或replay成本。
