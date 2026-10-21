---
name: bangumi-query
description: 查询本地Archive与本人收藏快照，组合事实、个人收藏筛选、全文、关系和统计，按主键与资源引用读取必要字段；不含社区写入或向量检索。
---

# Bangumi 本地查询

先确定实体与用户实际条件。query_entities负责名称、别名、简介全文及事实筛选，get_entities按明确身份批量读取，query_relations负责制作、出演、配音和作品关系，aggregate_entities负责统计。需要版本和覆盖信息时用get_dataset_status。参数、字段、关系枚举以实际工具契约为准。

公共查询省略data_scope；需要本人收藏时使用data_scope=self，filter.collection指定membership、状态、个人评分和标签。self只是关联本人数据，不自动限定已收藏；查询本人收藏列表需membership=collected。当前只支持subject条目个人数据，关系工具的目标须为subject。个人评分personalRating与公共score、个人标签personalTags与公共tags不可混用。统计用完整条件下的aggregate_entities；个人平均分排除未评分0分。

个人库仅在Web启动或用户执行/bangumi-sync时同步，查询不会触发联网；未初始化时提示同步，未登录时提示登录。增量不保证捕捉所有评分、标签修改和取消收藏，not_collected仅表示适用本地快照缺席；不得声称网站实时未收藏。需要完整校准时提示/bangumi-sync full。get_dataset_status的data_scope=self可查看个人库版本和同步时间，不触发同步。

默认结果只含主键、resourceRef和进度；需要判断的名称、评分、标签、简介等通过fields显式选择。已有引用使用read_cached_resource读取本地字段，keys只能选择本引用成员，长文本按range分段，不能混用其他轮次引用。仅为展示需要的字段由宿主在绑定快照中补齐，无需先把全量资料搬入模型。

筛选、排序、去重、关联和统计交给宿主。当前页不等于完整结果，按返回分页游标继续。数字统计必须基于完整查询条件，不把当前页或手工汇总冒充全库统计。多个关系成立时注意作品与角色的复合身份，不把参加制作当作主役配音。

公共查询范围是Archive公开快照；日期未知、解析失败、悬空关系和字段未收录不能当成已知事实，影响请求事实或结论时简短说明具体缺口。公共标签只导出部分，缺少某标签不证明不存在某题材。全文匹配是词语证据，不是语义相似召回或作品适配证明。公共NSFW是本地显示范围，本人数据另受同步时可见范围约束。这些是查询约束，用户未询问且不影响结论时不作为通用尾注；来源、时效与范围按统一回复规则说明。

## 关系批量查询与码表

query_relations的source是数组（1至800个元素），元素为{"entity":"subject","id":数字}或{"entity":"subject","filter":{...}}；多个元素时entity必须全部为subject，单元素才保留person、character等单源能力。源filter只支持collection、subject_type、platform、year、tags，不复用完整目标filter，平台只有单个platform。目标filter用platforms（或platform）时必须同时给subject_type：平台码按媒体类型分域复用，同一数字在动画、书籍、游戏下含义不同。data_scope=self时关系目标只能是subject（target_entity可省略，校验会默认取subject）。一次批量源即可覆盖全部已看作品，不要逐部循环调用。续页把nextCursor原样带回；改动条件（含limit）会得到CURSOR_PLAN_CHANGED，需原样重发首次查询的完整条件。

例：我看过的TV动画里，哪些OVA、剧场版、WEB我没看过。源是本地收藏快照中已收藏（collection.membership=collected）的动画TV（subject_type=2、platform=1）；目标是动画里平台为OVA、剧场版、WEB（platforms:[2,3,5]）且本地快照未收藏（collection.membership=not_collected）的作品，关系取前传、续集、总集篇、番外篇、衍生：

```json
{
  "source": [{"entity": "subject", "filter": {"collection": {"membership": "collected"}, "subject_type": 2, "platform": 1}}],
  "target_entity": "subject",
  "data_scope": "self",
  "direction": "both",
  "relation_types": [2, 3, 4, 6, 11],
  "filter": {"subject_type": 2, "platforms": [2, 3, 5], "collection": {"membership": "not_collected"}},
  "fields": ["name", "nameCn", "date", "platform", "score", "collectionState"],
  "limit": 100
}
```

结果按目标作品去重：page.total是去重后的目标数，不是关系边数；单页最多100行（data.maxItems=200），这种查询通常要按nextCursor多次翻页。coverage是覆盖账本：sourcesRequested是解析后去重前的源数（id元素各计1，filter按命中行数累加），sourcesResolved是去重后实际参与遍历的源数，edgesScanned是目标筛选后参与聚合的边数，三者都不能当作结果数。展示时用组件sources组合多页、多来源结果，总数只统计实际展示成员，不相加各页page.total，也不把当前页当完整结果。

码表来自固定字典（Archive官方common常量，宿主内部常量，不对外export）。动画平台码（subject_type=2）：1 TV、2 OVA、3 剧场版、5 WEB、0 其他。动漫作品关系码（作品对作品，常用子集）：2 前传、3 续集、4 总集篇、6 番外篇、8 相同世界观、10 不同演绎、11 衍生。只写已知子集，未列出的码不要猜。

mini/短篇（如泡面番、短片）没有对应字段可精确表达；只能用tag近似，例如tags:["泡面番"]，未命中时如实说明本地标签未覆盖此类作品，不能自造平台码或把近似当精确。

需要展示时读取组件工具契约，传resourceRef与明确成员或列，让宿主构建完整Web参数。作品列表默认SubjectCards，用户要求制表时用DataTable；个人评分、短评和条目级epStatus/volStatus按需用DataTable等现有组件展示。没有逐集观看状态，不能构造ProgressView；没有社区正文或图片补采。本人引用补读保持原账户和快照；公共引用不能直接补个人字段，应以原主键调用get_entities(data_scope=self)建立新引用。引用过期时按原条件重新查询，不猜ID或伪造旧引用。
