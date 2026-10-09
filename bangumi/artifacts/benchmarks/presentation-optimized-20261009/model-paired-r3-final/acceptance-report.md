# r3 完整实测（非最终架构验收）

40 planned / 40 records；候选硬规则 20/20 pass，对照 19/20 pass（followup-filter #1 errored保留），无版本/config漂移或缺失捕获。

19个双方成功配对：请求总数135→47（-65.19%），累计context tokens含cache 1,901,528→391,330（-79.42%）；peak context中位数13,073→9,017，逐配对比例变化中位数-31.99%。耗时总和下降27.43%，model耗时总和下降45.00%。失败运行的成本保留在operation统计中，不当作eligible节省证据；不声称实际账单省钱。

结构：203次真实HTTP均200、真实响应模型deepseek-flash；初始展示Schema0、loader仅所选集合/ack无完整Schema、loadout mismatch0、18次实际commit无额外HTTP。多源复用当轮已读缓存；其中一次筛选额外读过被排除1002，该成本保留。

**历史文字单份门槛未全通过**：20个候选正文观察中4条各出现2份，来自同一user失败render的before/after保真诊断与后续成功canonical摘要同文。失败配对不能删除；此版本未引用其已有文字位置，不能豁免或声称全部结构验收通过。

资源卡4条人工结论为semantic_caution：显式读过简介且组件缓存事实正确，但存在无源排他性剧情推断；自动硬grade与eligible保持原样。

- [交互报告](report.html)
- [冻结与关闭证明](closure.json)
- [成本/资格汇总](acceptance-summary.json)
- [实际payload元数据](actual-payload-evidence.json)
- [结构与多来源证明](structural-audits.json)
- [业务事实保真](business-evidence-audits.json)
- [4条历史重复例外（不豁免）](history-duplication-exceptions.json)
- [对照真实失败](failure-control-followup-filter-1.json)
- [人工语义复核](semantic-review.json)

候选版本92d041b491d5c4bf19f89be061cacdd65f45e6f77c1ad9d214fde1583a62be72；control e283b58868250ccb231df245222facdefc81c607cb4a026eb1367ed81481b168。仅真实DeepSeek+固定Bangumi上游fixture，不声称真实Bangumi网络/账号/UI浏览器验收；未混合r2或其它版本数据。
