# Bangumi MCP 字段声明

6 个底层工具及宿主工具 read_component_index、read_component_spec、render_SubjectCards、render_StatsCard、render_ProgressView、render_InfoBox、render_DataTable、render_Timeline、render_TagCloud、render_Gallery、render_CompareTable、render_QuoteBlock、render_Callout、render_LinkList、prepare_SubjectCards、prepare_StatsCard、prepare_ProgressView、prepare_InfoBox、prepare_DataTable、prepare_Timeline、prepare_TagCloud、prepare_Gallery、prepare_CompareTable、prepare_QuoteBlock、prepare_Callout、prepare_LinkList、prepare_component、present_component、present_text。输入字段递归声明；输出嵌套对象引用末尾的公共结构，scope 对应本工具输入。底层结果封装为 value 或 error，错误字段见公共安全错误结构。

## `query_entities`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 允许 subject、person、character、episode |  |
| keyword | string | 否 | — | 最长字符数 300 | 原文关键词。name检索名称与别名；fulltext检索名称、别名和简介，不解释为语义推荐。 |
| nsfw | string | 否 | — | 允许 exclude、include | 仅为本地资料显示范围，不涉及账户权限。本轮首次省略为exclude，后续省略继承本轮范围；本轮内不能显式改变，换轮次重新查询。 |
| data_scope | string | 否 | public | 允许 public、self | public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。 |
| match | string | 否 | name | 允许 name、fulltext |  |
| filter | object | 否 | — | 拒绝额外字段 |  |
| filter.collection | object | 否 | — | 拒绝额外字段 |  |
| filter.collection.membership | string | 否 | any | 允许 any、collected、not_collected | 本地收藏快照中的成员关系；missing及可见范围之外为未知，不视作未收藏。 |
| filter.collection.types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 已收藏条目状态：1想看/读/玩/听、2看/读/玩/听过、3在看/读/玩/听、4搁置、5抛弃。 |
| filter.collection.types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.exclude_types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 限定已收藏且状态不在所列集合；不包含未收藏及状态未知条目。 |
| filter.collection.exclude_types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.rating | object | 否 | — | 拒绝额外字段 | 个人评分闭区间；0表示未评分。 |
| filter.collection.rating.min | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rating.max | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rated | boolean | 否 | — | — | true仅个人评分1至10，false仅未评分0；与rating范围不得矛盾。 |
| filter.collection.tags_all | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_all[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.private | boolean | 否 | — | — |  |
| filter.collection.updated_at | object | 否 | — | 拒绝额外字段 | 上游收藏更新时间，Unix秒；不代表观看完成日期。 |
| filter.collection.updated_at.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.collection.updated_at.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 作品媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| filter.year | object | 否 | — | 拒绝额外字段 | 作品发行/开播或章节放送年份；不代表人物生日。 |
| filter.year.min | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.year.max | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.date | object | 否 | — | 拒绝额外字段 | 作品或章节完整日期，含边界；日期不完整记录列入未知。 |
| filter.date.min | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.date.max | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.score | object | 否 | — | 拒绝额外字段 |  |
| filter.score.min | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.score.max | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.rating_count | object | 否 | — | 拒绝额外字段 |  |
| filter.rating_count.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rating_count.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rank | object | 否 | — | 拒绝额外字段 |  |
| filter.rank.min | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.rank.max | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.platform | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.tags | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.tags[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.subject_id | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.episode_type | integer | 否 | — | ≥ 0；≤ 6 |  |
| filter.career | array<string> | 否 | — | 最少项 1；最多项 7；元素不重复；元素：允许 writer、producer、mangaka、artist、seiyu、illustrator、actor | 仅人物；职业符合所列任一项。 |
| filter.career[] | string | 是 | — | 允许 writer、producer、mangaka、artist、seiyu、illustrator、actor |  |
| sort | string | 否 | match | 允许 id、name、date_asc、date_desc、score、rank、rating_count、match、personal_rating_desc、personal_rating_asc、collection_updated_desc、collection_updated_asc |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| cursor | string | 否 | — | 最长字符数 2000 | 上一页nextCursor；绑定条件、数据版本和显示范围，不手工构造。 |
| fields | array<string> | 否 | 空数组 | 最多项 51；元素不重复；元素：允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt | 省略只返回身份与引用；正文等长字段按需读取，宿主展示直接补全。 |
| fields[] | string | 是 | — | 允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| value.entity | string | 否 | — | 允许 subject、person、character、episode |  |
| value.resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.snapshotId | string | 是 | — | — |  |
| value.data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.availableFields | array<string> | 否 | — | — |  |
| value.page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| value.coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.dataset | object | 否 | — | — |  |
| value.readAt | string | 否 | — | — |  |

## `get_entities`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 允许 subject、person、character、episode |  |
| nsfw | string | 否 | — | 允许 exclude、include | 仅为本地资料显示范围，不涉及账户权限。本轮首次省略为exclude，后续省略继承本轮范围；本轮内不能显式改变，换轮次重新查询。 |
| data_scope | string | 否 | public | 允许 public、self | public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。 |
| ids | array<integer> | 是 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| ids[] | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| fields | array<string> | 否 | 空数组 | 最多项 51；元素不重复；元素：允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt | 省略只返回身份与引用；正文等长字段按需读取，宿主展示直接补全。 |
| fields[] | string | 是 | — | 允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| value.entity | string | 否 | — | 允许 subject、person、character、episode |  |
| value.resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.snapshotId | string | 是 | — | — |  |
| value.data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.availableFields | array<string> | 否 | — | — |  |
| value.page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| value.coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.dataset | object | 否 | — | — |  |
| value.readAt | string | 否 | — | — |  |

## `query_relations`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| source | object | 是 | — | 拒绝额外字段 |  |
| source.entity | string | 是 | — | 允许 subject、person、character、episode |  |
| source.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target_entity | string | 否 | — | 允许 subject、person、character、episode |  |
| nsfw | string | 否 | — | 允许 exclude、include | 仅为本地资料显示范围，不涉及账户权限。本轮首次省略为exclude，后续省略继承本轮范围；本轮内不能显式改变，换轮次重新查询。 |
| data_scope | string | 否 | public | 允许 public、self | public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。 |
| direction | string | 否 | both | 允许 outgoing、incoming、both |  |
| relation_types | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 0；≤ 9007199254740991 |  |
| relation_types[] | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| appearance_role | integer | 否 | — | ≥ 1；≤ 3 |  |
| filter | object | 否 | — | 拒绝额外字段 |  |
| filter.collection | object | 否 | — | 拒绝额外字段 |  |
| filter.collection.membership | string | 否 | any | 允许 any、collected、not_collected | 本地收藏快照中的成员关系；missing及可见范围之外为未知，不视作未收藏。 |
| filter.collection.types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 已收藏条目状态：1想看/读/玩/听、2看/读/玩/听过、3在看/读/玩/听、4搁置、5抛弃。 |
| filter.collection.types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.exclude_types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 限定已收藏且状态不在所列集合；不包含未收藏及状态未知条目。 |
| filter.collection.exclude_types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.rating | object | 否 | — | 拒绝额外字段 | 个人评分闭区间；0表示未评分。 |
| filter.collection.rating.min | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rating.max | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rated | boolean | 否 | — | — | true仅个人评分1至10，false仅未评分0；与rating范围不得矛盾。 |
| filter.collection.tags_all | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_all[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.private | boolean | 否 | — | — |  |
| filter.collection.updated_at | object | 否 | — | 拒绝额外字段 | 上游收藏更新时间，Unix秒；不代表观看完成日期。 |
| filter.collection.updated_at.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.collection.updated_at.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 作品媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| filter.year | object | 否 | — | 拒绝额外字段 | 作品发行/开播或章节放送年份；不代表人物生日。 |
| filter.year.min | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.year.max | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.date | object | 否 | — | 拒绝额外字段 | 作品或章节完整日期，含边界；日期不完整记录列入未知。 |
| filter.date.min | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.date.max | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.score | object | 否 | — | 拒绝额外字段 |  |
| filter.score.min | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.score.max | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.rating_count | object | 否 | — | 拒绝额外字段 |  |
| filter.rating_count.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rating_count.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rank | object | 否 | — | 拒绝额外字段 |  |
| filter.rank.min | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.rank.max | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.platform | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.tags | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.tags[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.subject_id | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.episode_type | integer | 否 | — | ≥ 0；≤ 6 |  |
| filter.career | array<string> | 否 | — | 最少项 1；最多项 7；元素不重复；元素：允许 writer、producer、mangaka、artist、seiyu、illustrator、actor | 仅人物；职业符合所列任一项。 |
| filter.career[] | string | 是 | — | 允许 writer、producer、mangaka、artist、seiyu、illustrator、actor |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| cursor | string | 否 | — | 最长字符数 2000 | 上一页nextCursor；绑定条件、数据版本和显示范围，不手工构造。 |
| fields | array<string> | 否 | 空数组 | 最多项 51；元素不重复；元素：允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt | 省略只返回身份与引用；正文等长字段按需读取，宿主展示直接补全。 |
| fields[] | string | 是 | — | 允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| value.entity | string | 否 | — | 允许 subject、person、character、episode |  |
| value.resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.snapshotId | string | 是 | — | — |  |
| value.data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.availableFields | array<string> | 否 | — | — |  |
| value.page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| value.coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.dataset | object | 否 | — | — |  |
| value.readAt | string | 否 | — | — |  |

## `aggregate_entities`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 允许 subject、person、character、episode |  |
| keyword | string | 否 | — | 最长字符数 300 | 原文关键词。name检索名称与别名；fulltext检索名称、别名和简介，不解释为语义推荐。 |
| nsfw | string | 否 | — | 允许 exclude、include | 仅为本地资料显示范围，不涉及账户权限。本轮首次省略为exclude，后续省略继承本轮范围；本轮内不能显式改变，换轮次重新查询。 |
| data_scope | string | 否 | public | 允许 public、self | public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。 |
| match | string | 否 | name | 允许 name、fulltext |  |
| filter | object | 否 | — | 拒绝额外字段 |  |
| filter.collection | object | 否 | — | 拒绝额外字段 |  |
| filter.collection.membership | string | 否 | any | 允许 any、collected、not_collected | 本地收藏快照中的成员关系；missing及可见范围之外为未知，不视作未收藏。 |
| filter.collection.types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 已收藏条目状态：1想看/读/玩/听、2看/读/玩/听过、3在看/读/玩/听、4搁置、5抛弃。 |
| filter.collection.types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.exclude_types | array<integer> | 否 | — | 最少项 1；最多项 5；元素不重复；元素：≥ 1；≤ 5 | 限定已收藏且状态不在所列集合；不包含未收藏及状态未知条目。 |
| filter.collection.exclude_types[] | integer | 是 | — | ≥ 1；≤ 5 |  |
| filter.collection.rating | object | 否 | — | 拒绝额外字段 | 个人评分闭区间；0表示未评分。 |
| filter.collection.rating.min | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rating.max | integer | 否 | — | ≥ 0；≤ 10 |  |
| filter.collection.rated | boolean | 否 | — | — | true仅个人评分1至10，false仅未评分0；与rating范围不得矛盾。 |
| filter.collection.tags_all | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_all[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.collection.tags_any[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.collection.private | boolean | 否 | — | — |  |
| filter.collection.updated_at | object | 否 | — | 拒绝额外字段 | 上游收藏更新时间，Unix秒；不代表观看完成日期。 |
| filter.collection.updated_at.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.collection.updated_at.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 作品媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| filter.year | object | 否 | — | 拒绝额外字段 | 作品发行/开播或章节放送年份；不代表人物生日。 |
| filter.year.min | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.year.max | integer | 否 | — | ≥ 1；≤ 9999 |  |
| filter.date | object | 否 | — | 拒绝额外字段 | 作品或章节完整日期，含边界；日期不完整记录列入未知。 |
| filter.date.min | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.date.max | string | 否 | — | 正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.score | object | 否 | — | 拒绝额外字段 |  |
| filter.score.min | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.score.max | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.rating_count | object | 否 | — | 拒绝额外字段 |  |
| filter.rating_count.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rating_count.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rank | object | 否 | — | 拒绝额外字段 |  |
| filter.rank.min | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.rank.max | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.platform | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.tags | array<string> | 否 | — | 最少项 1；最多项 20；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| filter.tags[] | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| filter.subject_id | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.episode_type | integer | 否 | — | ≥ 0；≤ 6 |  |
| filter.career | array<string> | 否 | — | 最少项 1；最多项 7；元素不重复；元素：允许 writer、producer、mangaka、artist、seiyu、illustrator、actor | 仅人物；职业符合所列任一项。 |
| filter.career[] | string | 是 | — | 允许 writer、producer、mangaka、artist、seiyu、illustrator、actor |  |
| group_by | string | 否 | — | 允许 subjectType、year、platform、tag、score、nsfw、collectionType、personalRating、personalTag |  |
| metrics | array<string> | 否 | count | 最少项 1；最多项 5；元素不重复；元素：允许 count、averageScore、ratingCount、averagePersonalRating、ratedCount |  |
| metrics[] | string | 是 | — | 允许 count、averageScore、ratingCount、averagePersonalRating、ratedCount |  |
| limit | integer | 否 | 100 | ≥ 1；≤ 100 |  |
| cursor | string | 否 | — | 最长字符数 2000 | 上一页nextCursor；绑定条件、数据版本和显示范围，不手工构造。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| value.entity | string | 否 | — | 允许 subject、person、character、episode |  |
| value.resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.snapshotId | string | 是 | — | — |  |
| value.data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.availableFields | array<string> | 否 | — | — |  |
| value.page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| value.coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.dataset | object | 否 | — | — |  |
| value.readAt | string | 否 | — | — |  |

## `read_cached_resource`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resource_ref | string | 是 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| fields | array<string> | 否 | — | 最多项 80；元素不重复；元素：允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt、group、count、averageScore、averagePersonalRating、ratedCount |  |
| fields[] | string | 是 | — | 允许 name、nameCn、summary、date、year、platform、score、rank、ratingCount、nsfw、url、tags、metaTags、tagStats、infobox、infoboxRaw、aliases、ratingDistribution、totalEpisodes、totalVolumes、subjectType、personType、characterType、episodeType、subjectId、sort、disc、duration、airDate、career、comments、collects、collectionCounts、series、relation、relationType、relationTypes、relations、relationId、staff、appearanceRole、fieldStates、collectionState、collectionType、personalRating、personalTags、personalComment、collectionPrivate、epStatus、volStatus、collectionUpdatedAt、group、count、averageScore、averagePersonalRating、ratedCount |  |
| keys | array<integer / object> | 否 | — | 最多项 100；元素不重复；元素：oneOf 2 个分支；integer：≥ 1 |  |
| keys[] | integer | 是 | — | ≥ 1 | oneOf 1 |
| keys[] | object | 是 | — | 最少字段 1；最多字段 3；拒绝额外字段 | oneOf 2 |
| keys[].id | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].subjectId | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].personId | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].characterId | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].episodeId | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].relationId | integer | 否 | — | ≥ 1 | oneOf 2 |
| keys[].entity | string | 否 | — | 允许 subject、person、character、episode、aggregate | oneOf 2 |
| range | object | 否 | — | 拒绝额外字段 |  |
| range.offset | integer | 否 | 0 | ≥ 0 |  |
| range.limit | integer | 否 | 500 | ≥ 1；≤ 5000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 cached_resource |  |
| value.resourceRef | string | 是 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.sourceTool | string | 是 | — | — |  |
| value.value | read_cached_resource_value | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.range | object | 否 | — | — |  |
| value.fieldStates | object | 否 | — | — |  |

## `get_dataset_status`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| data_scope | string | 否 | public | 允许 public、self | public只读Archive；self读取已同步的本人条目收藏快照，不触发联网同步。账号由宿主绑定。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| value.entity | string | 否 | — | 允许 subject、person、character、episode |  |
| value.resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| value.snapshotId | string | 是 | — | — |  |
| value.data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| value.fields | array<string> | 否 | — | — |  |
| value.availableFields | array<string> | 否 | — | — |  |
| value.page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| value.coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 是 | — | 见公共结构 |  |
| value.requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| value.dataset | object | 否 | — | — |  |
| value.readAt | string | 否 | — | — |  |

## `read_component_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| query | string | 否 | — | 最长字符数 100 |  |
| category | string | 否 | — | 最长字符数 30 |  |
| offset | integer | 否 | 0 | ≥ 0 |  |
| limit | integer | 否 | 6 | ≥ 1；≤ 12 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| version | string | 是 | — | — | anyOf 1 |
| entries | array<read_component_index_entriesItem> | 是 | — | — | anyOf 1 |
| total | integer | 是 | — | — | anyOf 1 |
| offset | integer | 是 | — | — | anyOf 1 |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支 | anyOf 1 |
| categories | array<string> | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `read_component_spec`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| names | array<string> | 是 | — | 最少项 1；最多项 12；元素不重复；元素：允许 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList |  |
| mode | string | 否 | render | 允许 render、prepare |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| version | string | 是 | — | — | anyOf 1 |
| status | string | 是 | — | 允许 activated | anyOf 1 |
| tools | array<string> | 是 | — | — | anyOf 1 |
| capabilities | array<read_component_spec_capabilitiesItem> | 是 | — | 最少项 1；最多项 12 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_SubjectCards`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| layout | string | 否 | — | 允许 grid、list |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_SubjectCards_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_SubjectCards_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_StatsCard`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| mode | string | 否 | — | 允许 list、bars、histogram |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 1 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_StatsCard_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_StatsCard_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_ProgressView`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_ProgressView_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_ProgressView_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_InfoBox`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| fields | array<string> | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 1；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_InfoBox_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_InfoBox_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_DataTable`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| columns | array<Input_render_DataTable_columnsItem> | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 200；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_DataTable_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_DataTable_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_Timeline`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_ProgressView_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_ProgressView_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_TagCloud`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 200 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_TagCloud_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_TagCloud_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_Gallery`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_Gallery_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_Gallery_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_CompareTable`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| fields | array<string> | 否 | — | — |  |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_CompareTable_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_CompareTable_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_QuoteBlock`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| title | string | 否 | — | — |  |
| text | string | 是 | — | — |  |
| mono | boolean | 是 | — | — |  |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_Callout`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| tone | string | 是 | — | 允许 progress、success、warning、error |  |
| text | string | 是 | — | — |  |
| detail | string | 否 | — | — |  |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `render_LinkList`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_Gallery_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| before | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件前必要的引导或关键限制，不重复组件内容，不添加通用范围声明。 |
| after | string | 否 | — | 最长字符数 65536 | 可省略；仅填写组件未承载的请求事实、额外结论或关键限制，不重复组件内容，不添加通用范围声明。 |
| final | boolean | 否 | — | — | 明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_Gallery_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_SubjectCards`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| layout | string | 否 | — | 允许 grid、list |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_SubjectCards_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_SubjectCards_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_StatsCard`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| mode | string | 否 | — | 允许 list、bars、histogram |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 1 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_StatsCard_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_StatsCard_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_ProgressView`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_ProgressView_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_ProgressView_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_InfoBox`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| fields | array<string> | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 1；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_InfoBox_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_InfoBox_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_DataTable`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| fields | array<string> | 否 | — | — |  |
| columns | array<Input_render_DataTable_columnsItem> | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 200；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_DataTable_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_DataTable_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_Timeline`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_ProgressView_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_ProgressView_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_TagCloud`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 200 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_TagCloud_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_TagCloud_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_Gallery`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_Gallery_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_Gallery_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_CompareTable`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| fields | array<string> | 否 | — | — |  |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_CompareTable_sourcesItem> | 否 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_CompareTable_sourcesItem> | 是 | — | 最少项 1；最多项 1 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_QuoteBlock`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| title | string | 否 | — | — |  |
| text | string | 是 | — | — |  |
| mono | boolean | 是 | — | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_Callout`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| tone | string | 是 | — | 允许 progress、success、warning、error |  |
| text | string | 是 | — | — |  |
| detail | string | 否 | — | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_LinkList`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 否 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。 |
| title | string | 否 | — | — |  |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| sources | array<Input_render_Gallery_sourcesItem> | 否 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 单来源快捷形式；与sources二选一，成员必须属于本引用。；oneOf 1 |
| sources | array<Input_render_Gallery_sourcesItem> | 是 | — | 最少项 1；最多项 50 | 有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `prepare_component`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| component | string | 是 | — | 允许 SubjectCards | anyOf 1 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| title | string | 否 | — | — | anyOf 1 |
| layout | string | 否 | — | 允许 grid、list | anyOf 1 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 | anyOf 1 |
| component | string | 是 | — | 允许 StatsCard | anyOf 2 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 2 |
| title | string | 否 | — | — | anyOf 2 |
| mode | string | 否 | — | 允许 list、bars、histogram | anyOf 2 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 | anyOf 2 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 1 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 2 |
| component | string | 是 | — | 允许 ProgressView | anyOf 3 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 3 |
| title | string | 否 | — | — | anyOf 3 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 | anyOf 3 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 3 |
| component | string | 是 | — | 允许 InfoBox | anyOf 4 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 4 |
| title | string | 否 | — | — | anyOf 4 |
| fields | array<string> | 否 | — | — | anyOf 4 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 | anyOf 4 |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 1；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。；anyOf 4 |
| component | string | 是 | — | 允许 DataTable | anyOf 5 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 5 |
| title | string | 否 | — | — | anyOf 5 |
| fields | array<string> | 否 | — | — | anyOf 5 |
| columns | array<Input_render_DataTable_columnsItem> | 否 | — | — | anyOf 5 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 | anyOf 5 |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 200；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。；anyOf 5 |
| component | string | 是 | — | 允许 Timeline | anyOf 6 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 6 |
| title | string | 否 | — | — | anyOf 6 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 | anyOf 6 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 6 |
| component | string | 是 | — | 允许 TagCloud | anyOf 7 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 7 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 | anyOf 7 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 200 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 7 |
| component | string | 是 | — | 允许 Gallery | anyOf 8 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 8 |
| title | string | 否 | — | — | anyOf 8 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 | anyOf 8 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 8 |
| component | string | 是 | — | 允许 CompareTable | anyOf 9 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 9 |
| title | string | 否 | — | — | anyOf 9 |
| fields | array<string> | 否 | — | — | anyOf 9 |
| component | string | 是 | — | 允许 QuoteBlock | anyOf 10 |
| title | string | 否 | — | — | anyOf 10 |
| text | string | 是 | — | — | anyOf 10 |
| mono | boolean | 是 | — | — | anyOf 10 |
| component | string | 是 | — | 允许 Callout | anyOf 11 |
| tone | string | 是 | — | 允许 progress、success、warning、error | anyOf 11 |
| text | string | 是 | — | — | anyOf 11 |
| detail | string | 否 | — | — | anyOf 11 |
| component | string | 是 | — | 允许 LinkList | anyOf 12 |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 12 |
| title | string | 否 | — | — | anyOf 12 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 | anyOf 12 |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。；anyOf 12 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | anyOf 1 |
| blocks | array<prepare_SubjectCards_blocksItem> | 是 | — | 最少项 1 | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `present_component`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ |  |
| blockIndex | integer | 是 | — | ≥ 0 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## `present_text`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| text | string | 是 | — | 最短字符数 1；最长字符数 65536 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| replyId | string | 是 | — | — | anyOf 1 |
| blockIndex | integer | 是 | — | ≥ 0 | anyOf 1 |
| reused | boolean | 是 | — | — | anyOf 1 |
| error | SafeError_2 | 是 | — | 拒绝额外字段 | anyOf 2 |

## 公共输入结构

### `Input_render_SubjectCards_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |

### `Input_render_StatsCard_membersItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | number | 否 | — | — |  |
| subjectId | number | 否 | — | — |  |
| episodeId | number | 否 | — | — |  |
| characterId | number | 否 | — | — |  |
| personId | number | 否 | — | — |  |
| revisionId | number | 否 | — | — |  |
| targetId | number | 否 | — | — |  |
| relationId | number | 否 | — | — |  |
| ownerId | number | 否 | — | — |  |
| entity | string | 否 | — | 允许 subject、character、person、episode、revision、user、index |  |
| targetKind | string | 否 | — | 允许 subject、character、person、episode、revision、user、index |  |
| username | string | 否 | — | — |  |

### `Input_render_StatsCard_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 1 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |

### `Input_render_ProgressView_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 100 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |

### `Input_render_InfoBox_membersItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 允许 aggregate |  |
| id | number | 是 | — | — |  |

### `Input_render_InfoBox_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 1；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 1；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |

### `Input_render_DataTable_columnsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| key | string | 是 | — | — |  |
| label | string | 是 | — | — |  |
| align | string | 否 | — | 允许 left、right |  |

### `Input_render_DataTable_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem / Input_render_InfoBox_membersItem> | 否 | — | 最多项 200；元素：anyOf 2 个分支 | 明确选择当前resourceRef成员。统计行使用entity=aggregate和该引用内的id；不同统计引用的行ID互不通用，不能提供或覆盖事实。 |

### `Input_render_TagCloud_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 200；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 200 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |

### `Input_render_Gallery_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |
| subjectIds | array<integer> | 否 | — | 最少项 1；最多项 50；元素不重复；元素：≥ 1 |  |
| members | array<Input_render_StatsCard_membersItem> | 否 | — | 最多项 50 | 只选择当前resourceRef中已核实的实体身份，不提供或覆盖事实。 |

### `Input_render_CompareTable_sourcesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| resourceRef | string | 是 | — | 正则 ^rr_[A-Za-z0-9_-]+$ | 本来源的当前缓存引用。 |
| blockIndex | integer | 否 | — | ≥ 0 | 已准备快照的绝对组件下标；不能同时覆盖成员或布局。 |

## 公共输出结构

### `query_entities_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 否 | — | 固定 1 |  |
| entity | string | 是 | — | 允许 subject、person、character、episode |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| name | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| nameCn | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| summary | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| date | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| platform | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| url | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| duration | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| airDate | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| relation | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| staff | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| infoboxRaw | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| year | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| rank | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| ratingCount | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalEpisodes | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalVolumes | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| subjectType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| personType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| characterType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| episodeType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| subjectId | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| relationId | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| relationType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| appearanceRole | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| disc | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | 仅章节：Archive 原始盘号；0 原样保留，不推断其含义，缺失为 null。 |
| sort | number / null | 否 | — | anyOf 2 个分支 |  |
| score | number / null | 否 | — | anyOf 2 个分支；number：≥ 0；≤ 10 |  |
| nsfw | boolean / null | 否 | — | anyOf 2 个分支 |  |
| tags | array<string> / null | 否 | — | anyOf 2 个分支；array：最多项 1000；元素：最长字符数 1000 |  |
| metaTags | array<string> / null | 否 | — | anyOf 2 个分支；array：最多项 1000；元素：最长字符数 1000 |  |
| aliases | array<string> / null | 否 | — | anyOf 2 个分支；array：最多项 1000；元素：最长字符数 1000 |  |
| career | array<string> / null | 否 | — | anyOf 2 个分支；array：最多项 1000；元素：最长字符数 1000 |  |
| comments | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| collects | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| series | boolean / null | 否 | — | anyOf 2 个分支 |  |
| collectionCounts | query_entities_dataItem_collectionCounts / null | 否 | — | anyOf 2 个分支 |  |
| tagStats | array<query_entities_dataItem_tagStatsItem> / null | 否 | — | anyOf 2 个分支；array：最多项 1000 |  |
| infobox | array<query_entities_dataItem_infoboxItem> / null | 否 | — | anyOf 2 个分支；array：最多项 1000 |  |
| ratingDistribution | query_entities_dataItem_ratingDistribution / null | 否 | — | anyOf 2 个分支 |  |
| relationTypes | array<integer> / null | 否 | — | anyOf 2 个分支；array：元素不重复；元素：≥ 0；≤ 9007199254740991 |  |
| relations | array<query_entities_dataItem_relationsItem> / null | 否 | — | anyOf 2 个分支 |  |
| collectionState | string | 否 | — | 允许 collected、not_collected、unknown |  |
| collectionType | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 1；≤ 5 |  |
| personalRating | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 10 |  |
| personalTags | array<string> / null | 否 | — | anyOf 2 个分支；array：最多项 1000；元素：最长字符数 1000 |  |
| personalComment | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| collectionPrivate | boolean / null | 否 | — | anyOf 2 个分支 |  |
| epStatus | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| volStatus | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| collectionUpdatedAt | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| fieldStates | object | 否 | — | — |  |
| fieldRanges | query_entities_dataItem_fieldRanges | 否 | — | 拒绝额外字段 |  |
| included | array<string> | 否 | — | — |  |
| resourceFieldStates | object | 否 | — | — |  |

### `query_entities_dataItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 固定 aggregate |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| group | string / number / boolean / null | 是 | — | anyOf 4 个分支 |  |
| count | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| averageScore | number / null | 否 | — | anyOf 2 个分支 |  |
| ratingCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| averagePersonalRating | number / null | 否 | — | anyOf 2 个分支 |  |
| ratedCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |

### `query_entities_page`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| total | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 100 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 100 |  |
| nextCursor | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 2000 |  |
| complete | boolean | 是 | — | — |  |

### `query_entities_coverage`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| scope | object（本工具输入字段） | 是 | — | 允许 archive_snapshot、account_snapshot |  |
| complete | boolean | 是 | — | — |  |
| totalKind | string | 是 | — | 固定 exact |  |
| unknownCount | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| limitations | array<string> | 是 | — | — |  |

### `AccessContext`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| mode | string | 是 | — | 允许 account、anonymous、unverified、local |  |
| account | null / AccessContext_account | 是 | — | anyOf 2 个分支 |  |
| nsfw | AccessContext_nsfw | 是 | — | 拒绝额外字段 |  |
| source | string | 是 | — | 允许 p1、v0、web、archive、account_snapshot |  |
| nsfwApplied | boolean | 是 | — | — |  |
| checkedAt | string | 是 | — | 最长字符数 50 |  |
| collectionSnapshotId | string | 否 | — | 最短字符数 1；最长字符数 160；正则 ^[-A-Za-z0-9_.]+$ |  |
| accountFreshness | AccessContext_accountFreshness | 否 | — | 拒绝额外字段 |  |
| snapshotId | string | 否 | — | 最短字符数 1；最长字符数 120；正则 ^[A-Za-z0-9][A-Za-z0-9._-]*$ |  |
| queryCoverage | AccessContext_queryCoverage | 否 | — | 拒绝额外字段 |  |
| mode | string | 否 | — | 固定 account | then: 提供 source；source=account_snapshot |
| snapshotId | string | 是 | — | — | then: 提供 source；source=account_snapshot |
| collectionSnapshotId | string | 是 | — | — | then: 提供 source；source=account_snapshot |
| source | string | 否 | — | 固定 archive | then: 提供 mode；mode=local |
| account | null | 否 | — | — | then: 提供 mode；mode=local |
| snapshotId | string | 是 | — | 最短字符数 1 | then: 提供 mode；mode=local |
| mode | string | 否 | — | 固定 local | then: 提供 source；source=archive |
| snapshotId | string | 是 | — | 最短字符数 1 | then: 提供 source；source=archive |
| mode | string | 否 | — | 固定 account | then: 提供 queryCoverage；queryCoverage |
| source | string | 否 | — | 固定 p1 | then: 提供 queryCoverage；queryCoverage |
| nsfwApplied | boolean | 否 | — | 固定 true | then: 提供 queryCoverage；queryCoverage |
| nsfw | AccessContext_nsfw_2 | 否 | — | — | then: 提供 queryCoverage；queryCoverage |
| queryCoverage | AccessContext_queryCoverage_2 | 否 | — | — | then: 提供 queryCoverage；queryCoverage |
| queryCoverage | AccessContext_queryCoverage_3 | 否 | — | — | then: 提供 queryCoverage；queryCoverage |
| queryCoverage | AccessContext_queryCoverage_4 | 否 | — | — | then: 提供 queryCoverage；queryCoverage |
| account | object | 否 | — | — | then: mode=account |
| account | null | 否 | — | — | else: mode=account |
| nsfw | AccessContext_nsfw_2 | 否 | — | — | then: nsfw |
| nsfw | AccessContext_nsfw_3 | 否 | — | — | then: nsfw |
| nsfw | AccessContext_nsfw_4 | 否 | — | — | then: nsfw |
| nsfw | AccessContext_nsfw_5 | 否 | — | — | then: nsfw |
| nsfwApplied | boolean | 否 | — | 固定 false | then: nsfw |

### `SafeError`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | — |  |
| message | string | 是 | — | — |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<object> | 否 | — | — |  |
| sourceTool | string | 否 | — | — |  |
| diagnosis | object | 否 | — | — |  |
| diagnostic | object | 否 | — | — |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `read_cached_resource_value`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 允许 local_query、local_entities、local_relations、local_aggregate、dataset_status |  |
| entity | string | 否 | — | 允许 subject、person、character、episode |  |
| resourceRef | string | 否 | — | 正则 ^rr_[a-f0-9]{32}$ |  |
| snapshotId | string | 是 | — | — |  |
| data | array<query_entities_dataItem / query_entities_dataItem_2> | 否 | — | 最多项 200；元素：anyOf 2 个分支 |  |
| fields | array<string> | 否 | — | — |  |
| availableFields | array<string> | 否 | — | — |  |
| page | query_entities_page | 否 | — | 拒绝额外字段 |  |
| coverage | query_entities_coverage | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 是 | — | 见公共结构 |  |
| requestedIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| missingIds | array<integer> | 否 | — | 元素：≥ 1；≤ 9007199254740991 |  |
| dataset | object | 否 | — | — |  |
| readAt | string | 否 | — | — |  |

### `SafeError_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | — |  |
| message | string | 是 | — | — |  |
| sourceTool | string | 否 | — | — |  |
| networkAttempted | boolean | 否 | — | 允许 false |  |
| issues | array<SafeError_2_issuesItem> | 否 | — | — |  |
| diagnostic | object | 否 | — | — |  |
| rejection | object | 否 | — | — |  |
| submission | object | 否 | — | — |  |
| accessContext | object | 否 | — | 见公共结构 |  |
| recovery | object | 否 | — | — |  |
| diagnosis | object | 否 | — | — |  |
| contractIssue | object | 否 | — | — |  |

### `read_component_index_entriesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string | 是 | — | — |  |
| category | string | 是 | — | — |  |
| purpose | string | 是 | — | — |  |
| data | string | 是 | — | — |  |
| sourceCapability | string | 是 | — | 允许 available、limited、unavailable、text |  |
| limitations | array<string> | 是 | — | — |  |
| unavailableReason | string | 否 | — | — |  |

### `read_component_spec_capabilitiesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string | 是 | — | 允许 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList |  |
| sourceCapability | string | 是 | — | 允许 available、limited、unavailable、text |  |
| limitations | array<string> | 是 | — | — |  |
| unavailableReason | string | 否 | — | — |  |

### `prepare_SubjectCards_blocksItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| blockIndex | integer | 是 | — | ≥ 0 |  |
| type | string | 是 | — | 允许 SubjectCards、StatsCard、ProgressView、InfoBox、DataTable、Timeline、TagCloud、Gallery、CompareTable、QuoteBlock、Callout、LinkList |  |
| itemCount | integer | 是 | — | ≥ 0 |  |

### `query_entities_dataItem_collectionCounts`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| wish | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| done | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| doing | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| on_hold | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| dropped | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `query_entities_dataItem_tagStatsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string | 是 | — | 最长字符数 1000 |  |
| count | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `query_entities_dataItem_infoboxItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| key | string | 是 | — | 最长字符数 1000 |  |
| value | string / array<query_entities_dataItem_infoboxItem_valueItem> | 是 | — | anyOf 2 个分支；string：最长字符数 50000 |  |

### `query_entities_dataItem_ratingDistribution`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 2 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 3 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 4 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 5 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 6 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 7 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 8 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 9 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 10 | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `query_entities_dataItem_relationsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| relationId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| relationType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| sourceEntity | string | 是 | — | 允许 subject、person、character、episode |  |
| sourceId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| targetEntity | string | 是 | — | 允许 subject、person、character、episode |  |
| targetId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| viaCharacterId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| appearanceRole | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| appearanceRelationId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |

### `query_entities_dataItem_fieldRanges`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| summary | query_entities_dataItem_fieldRanges_summary | 否 | — | 拒绝额外字段 |  |
| infoboxRaw | query_entities_dataItem_fieldRanges_summary | 否 | — | 拒绝额外字段 |  |
| personalComment | query_entities_dataItem_fieldRanges_summary | 否 | — | 拒绝额外字段 |  |

### `AccessContext_account`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1 |  |
| username | string | 是 | — | 最短字符数 1；最长字符数 200 |  |

### `AccessContext_nsfw`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| preference | boolean / null | 是 | — | — |  |
| allowed | boolean / null | 是 | — | — |  |
| state | string | 是 | — | 允许 enabled、disabled、unknown、not_checked |  |

### `AccessContext_accountFreshness`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| lastFullSyncAt | string | 是 | — | — |  |
| lastDeltaSyncAt | string / null | 是 | — | — |  |
| incrementalOnly | boolean | 是 | — | — |  |

### `AccessContext_queryCoverage`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| requested | string | 是 | — | 允许 account、exclude |  |
| actual | string | 是 | — | 允许 account_visible、sfw_only、public_visible |  |
| nsfw | string | 是 | — | 允许 included、excluded、unknown |  |
| totalKind | string | 是 | — | 允许 estimated、exact、unknown |  |
| limitations | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 p1_date_type_mismatch、p1_decimal_rating、p1_rating_count_missing、p1_tag_literal_unsafe、p1_browse_nsfw_omitted、v0_anonymous_source、estimated_search_total、public_revision_source、nsfw_permission_unknown、authorized_sfw_fallback |  |

### `AccessContext_nsfw_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| allowed | boolean | 否 | — | 固定 true |  |

### `AccessContext_queryCoverage_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| actual | string | 否 | — | 固定 account_visible |  |

### `AccessContext_queryCoverage_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| nsfw | string | 否 | — | 固定 excluded |  |

### `AccessContext_queryCoverage_4`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| actual | string | 否 | — | 固定 sfw_only |  |
| nsfw | string | 否 | — | 固定 excluded |  |

### `AccessContext_nsfw_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| allowed | boolean | 否 | — | 固定 false |  |

### `AccessContext_nsfw_4`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| allowed | object | 否 | — | 固定 null |  |

### `AccessContext_nsfw_5`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| allowed | object | 否 | — | 固定 null |  |
| preference | object | 否 | — | 固定 null |  |

### `SafeError_2_issuesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| path | string | 是 | — | — |  |
| rule | string | 是 | — | — |  |
| hint | string | 是 | — | — |  |
| allowed | array<组合字段> | 否 | — | — |  |

### `query_entities_dataItem_infoboxItem_valueItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| k | string | 否 | — | 最长字符数 1000 |  |
| v | string | 是 | — | 最长字符数 50000 |  |

### `query_entities_dataItem_fieldRanges_summary`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 5000 |  |
| total | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |
