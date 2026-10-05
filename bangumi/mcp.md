# Bangumi MCP 字段声明

64 个底层工具及宿主工具 execute_write_batch。输入字段递归声明；输出嵌套对象引用末尾的公共结构，scope 对应本工具输入。底层结果封装为 value 或 error，错误字段见公共安全错误结构。

## `get_daily_broadcast`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 weekly_schedule |  |
| value.data | array<get_daily_broadcast_dataItem> | 是 | — | 最多项 7 |  |
| value.complete | boolean | 是 | — | — |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `search_subjects`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| keyword | string | 是 | — | 最短字符数 0；最长字符数 300 | 文字关键词，不是标签条件；只按结构化filter筛选时填空字符串，不能用拼接题材词替代filter。空关键词必须提供有效filter。 |
| subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| filter | object | 否 | — | 最少字段 1；拒绝额外字段 |  |
| filter.tag | array<string> | 否 | — | 最少项 1；最多项 10；元素不重复；元素：最短字符数 1；最长字符数 100；正则 ^\S(?:[\s\S]*\S)?$ | 显式标签筛选，多标签为且；不等于标题关键词命中或题材主线证明。 |
| filter.tag[] | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^\S(?:[\s\S]*\S)?$ |  |
| filter.meta_tags | array<string> | 否 | — | 最少项 1；最多项 10；元素不重复；元素：最短字符数 1；最长字符数 100；正则 ^\S(?:[\s\S]*\S)?$ | 网站公共标签，多值为且，可用-标签排除。 |
| filter.meta_tags[] | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^\S(?:[\s\S]*\S)?$ |  |
| filter.rating | object | 否 | — | 最少字段 1；拒绝额外字段 | 包含上下界；min不能大于max。省略的一侧不限制。 |
| filter.rating.min | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.rating.max | number | 否 | — | ≥ 0；≤ 10 |  |
| filter.rating_count | object | 否 | — | 最少字段 1；拒绝额外字段 | 包含上下界；min不能大于max。省略的一侧不限制。 |
| filter.rating_count.min | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rating_count.max | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| filter.rank | object | 否 | — | 最少字段 1；拒绝额外字段 | 包含上下界；min不能大于max。省略的一侧不限制。 |
| filter.rank.min | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.rank.max | integer | 否 | — | ≥ 1；≤ 9007199254740991 |  |
| filter.air_date | object | 否 | — | 最少字段 1；拒绝额外字段 | 实际YYYY-MM-DD日期，含上下界；min不能晚于max。 |
| filter.air_date.min | string | 否 | — | 最短字符数 10；最长字符数 10；正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.air_date.max | string | 否 | — | 最短字符数 10；最长字符数 10；正则 ^\d{4}-\d{2}-\d{2}$ |  |
| filter.nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。 |
| sort | string | 否 | match | 允许 match、heat、rank、score | match匹配、heat收藏人数、rank排名、score评分；不按基准分差排序。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `browse_subjects`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_type | integer | 是 | — | 允许 1、2、3、4、6 | 媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| cat | integer | 否 | — | 允许 0、1001、1002、1003、1、2、3、5、4001、4002、4003、4005、6001、6002、6003、6004 |  |
| series | boolean | 否 | — | — | 仅书籍；其他媒体必须省略，包括false。 |
| platform | string | 否 | — | 最短字符数 1；最长字符数 100 | 仅游戏平台；动画TV/OVA用cat，不能传platform。 |
| sort | string | 否 | — | 允许 date、rank |  |
| year | integer | 否 | — | ≥ 1800；≤ 2200 |  |
| month | integer | 否 | — | ≥ 1；≤ 12 |  |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |
| subject_type | integer | 是 | — | 固定 1 | oneOf 1 |
| cat | integer | 否 | — | 允许 0、1001、1002、1003 | 书籍：0其他、1001漫画、1002小说、1003画集。；oneOf 1 |
| sort | string | 否 | — | 允许 date、rank | oneOf 1 |
| year | integer | 否 | — | ≥ 1800；≤ 2200 | oneOf 1 |
| month | integer | 否 | — | ≥ 1；≤ 12 | oneOf 1 |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。；oneOf 1 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 | oneOf 1 |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 | oneOf 1 |
| series | boolean | 否 | — | — | oneOf 1 |
| subject_type | integer | 是 | — | 固定 2 | oneOf 2 |
| cat | integer | 否 | — | 允许 0、1、2、3、5 | 动画形式：0其他、1TV、2OVA、3Movie、5WEB；恋爱/百合等题材使用search_subjects的filter。；oneOf 2 |
| sort | string | 否 | — | 允许 date、rank | oneOf 2 |
| year | integer | 否 | — | ≥ 1800；≤ 2200 | oneOf 2 |
| month | integer | 否 | — | ≥ 1；≤ 12 | oneOf 2 |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。；oneOf 2 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 | oneOf 2 |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 | oneOf 2 |
| subject_type | integer | 是 | — | 固定 3 | oneOf 3 |
| cat | integer | 否 | — | 允许 0 | 音乐仅0其他。；oneOf 3 |
| sort | string | 否 | — | 允许 date、rank | oneOf 3 |
| year | integer | 否 | — | ≥ 1800；≤ 2200 | oneOf 3 |
| month | integer | 否 | — | ≥ 1；≤ 12 | oneOf 3 |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。；oneOf 3 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 | oneOf 3 |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 | oneOf 3 |
| subject_type | integer | 是 | — | 固定 4 | oneOf 4 |
| cat | integer | 否 | — | 允许 0、4001、4002、4003、4005 | 游戏：0其他、4001游戏、4002软件、4003扩展包、4005桌游。；oneOf 4 |
| sort | string | 否 | — | 允许 date、rank | oneOf 4 |
| year | integer | 否 | — | ≥ 1800；≤ 2200 | oneOf 4 |
| month | integer | 否 | — | ≥ 1；≤ 12 | oneOf 4 |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。；oneOf 4 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 | oneOf 4 |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 | oneOf 4 |
| platform | string | 否 | — | 最短字符数 1；最长字符数 100 | oneOf 4 |
| subject_type | integer | 是 | — | 固定 6 | oneOf 5 |
| cat | integer | 否 | — | 允许 0、1、2、3、6001、6002、6003、6004 | 三次元：0其他、1日剧、2欧美剧、3华语剧、6001电视剧、6002电影、6003演出、6004综艺。；oneOf 5 |
| sort | string | 否 | — | 允许 date、rank | oneOf 5 |
| year | integer | 否 | — | ≥ 1800；≤ 2200 | oneOf 5 |
| month | integer | 否 | — | ≥ 1；≤ 12 | oneOf 5 |
| nsfw | string | 否 | — | 允许 account、exclude | 省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。；oneOf 5 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 | oneOf 5 |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 | oneOf 5 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | summary | 最多项 4；元素不重复；元素：允许 summary、infobox、tagStats、ratingDistribution |  |
| include[] | string | 是 | — | 允许 summary、infobox、tagStats、ratingDistribution |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.subjectType | integer / null | 是 | — | anyOf 2 个分支；integer：允许 1、2、3、4、6 |  |
| value.name | string | 是 | — | 最长字符数 300 |  |
| value.nameCn | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| value.date | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 50 |  |
| value.platform | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |
| value.score | number / null | 是 | — | anyOf 2 个分支；number：≥ 0；≤ 10 |  |
| value.nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |
| value.rank | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.ratingCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.totalEpisodes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.totalVolumes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.tags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| value.metaTags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| value.url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/[1-9]\d*$ |  |
| value.relation | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| value.staff | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| value.series | boolean / null | 否 | — | anyOf 2 个分支 |  |
| value.characters | array<get_subject_details_charactersItem> | 否 | — | 最多项 100 |  |
| value.included | array<string> | 是 | — | 最多项 4；元素不重复；元素：允许 summary、infobox、tagStats、ratingDistribution |  |
| value.summary | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 50000 |  |
| value.infobox | array<get_subject_details_infoboxItem> / null | 否 | — | anyOf 2 个分支；array：最多项 300 |  |
| value.tagStats | array<get_subject_details_tagStatsItem> / null | 否 | — | anyOf 2 个分支；array：最多项 100 |  |
| value.ratingDistribution | get_subject_details_ratingDistribution / null | 否 | — | anyOf 2 个分支 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_image`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| image_type | string | 否 | large | 允许 large、common、medium、small、grid |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 image |  |
| value.target | get_subject_image_target | 是 | — | 拒绝额外字段 |  |
| value.imageType | string | 是 | large | 允许 large、common、medium、small、grid |  |
| value.url | string | 是 | — | 最短字符数 1；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_persons`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subjectPerson |  |
| value.data | array<SubjectPersonRow> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_characters`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subjectCharacter |  |
| value.data | array<SubjectCharacterRow> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_relations`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_episodes`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| episode_type | integer | 否 | — | 允许 0、1、2、3、4、5、6 |  |
| limit | integer | 否 | 100 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 episode |  |
| value.data | array<EpisodeSummary> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_episode_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | description | 最多项 2；元素不重复；元素：允许 description、stats |  |
| include[] | string | 是 | — | 允许 description、stats |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 episode |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.episodeType | number | 是 | — | 允许 0、1、2、3、4、5、6 |  |
| value.name | string | 是 | — | 最短字符数 0；最长字符数 300 |  |
| value.nameCn | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| value.sort | number / null | 是 | — | anyOf 2 个分支 |  |
| value.mainSequence | number / null | 是 | — | anyOf 2 个分支 |  |
| value.airDate | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 50 |  |
| value.disc | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.duration | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| value.durationSeconds | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.included | array<string> | 是 | — | 最多项 2；元素不重复；元素：允许 description、stats |  |
| value.description | string / null | 否 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| value.stats | get_episode_details_stats / null | 否 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `search_characters`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| keyword | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |
| nsfw_filter | boolean | 否 | — | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 character |  |
| value.data | array<CharacterSummary> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `search_persons`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| keyword | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |
| career_filter | array<string> | 否 | — | 最少项 1；最多项 7；元素不重复；元素：允许 producer、mangaka、artist、seiyu、writer、illustrator、actor |  |
| career_filter[] | string | 是 | — | 允许 producer、mangaka、artist、seiyu、writer、illustrator、actor |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 person |  |
| value.data | array<PersonSummary> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_character_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | summary | 最多项 4；元素不重复；元素：允许 summary、infobox、bio、stats |  |
| include[] | string | 是 | — | 允许 summary、infobox、bio、stats |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 character |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.name | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| value.characterType | number / null | 是 | — | anyOf 2 个分支；number：允许 1、2、3、4 |  |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.included | array<string> | 是 | — | 最多项 4；元素不重复；元素：允许 summary、infobox、bio、stats |  |
| value.summary | string / null | 否 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| value.infobox | array<get_character_details_infoboxItem> / null | 否 | — | anyOf 2 个分支 |  |
| value.bio | Bio / null | 否 | — | anyOf 2 个分支 |  |
| value.stats | Stats / null | 否 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_character_image`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| image_type | string | 否 | large | 允许 large、medium、small、grid |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 image |  |
| value.target | get_character_image_target | 是 | — | 拒绝额外字段 |  |
| value.imageType | string | 是 | large | 允许 large、medium、small、grid |  |
| value.url | string | 是 | — | 最短字符数 1；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_character_subjects`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_character_persons`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 characterPerson |  |
| value.data | array<CharacterPersonRow> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `collect_character`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 collect_character | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_character_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_character_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 true | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_character_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_character_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `uncollect_character`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 uncollect_character | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_character_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_character_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 false | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_character_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_character_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_user_character_collections`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 characterCollection |  |
| value.data | array<characterCollectionItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public、self |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.account | Account | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.account | Account | 是 | — | 拒绝额外字段 | then: 提供 visibility；visibility=self |
| value.account | 禁止 | 否 | — | 禁止 | else: 提供 visibility；visibility=self |

## `get_user_character_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 1 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 1 |
| value.target | get_character_image_target | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.state | string | 是 | — | 允许 collected、not_collected | oneOf 1 |
| value.collection | characterCollectionItem / null | 是 | — | anyOf 2 个分支 | oneOf 1 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.visibility | string | 是 | — | 固定 self | oneOf 1 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 1 |
| value.account | Account | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 1 |
| value.collection | characterCollectionItem | 否 | — | 拒绝额外字段 | then: 提供 state；state=collected |
| value.collection | null | 否 | — | — | else: 提供 state；state=collected |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 2 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 2 |
| value.target | get_character_image_target | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.state | string | 是 | — | 允许 collected、unavailable | oneOf 2 |
| value.collection | characterCollectionItem / null | 是 | — | anyOf 2 个分支 | oneOf 2 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.visibility | string | 是 | — | 固定 public | oneOf 2 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 2 |

## `get_person_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | summary | 最多项 4；元素不重复；元素：允许 summary、infobox、bio、stats |  |
| include[] | string | 是 | — | 允许 summary、infobox、bio、stats |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 person |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.name | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| value.personType | number / null | 是 | — | anyOf 2 个分支；number：允许 1、2、3 |  |
| value.career | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素：最短字符数 1；最长字符数 100 |  |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.included | array<string> | 是 | — | 最多项 4；元素不重复；元素：允许 summary、infobox、bio、stats |  |
| value.summary | string / null | 否 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| value.infobox | array<get_character_details_infoboxItem> / null | 否 | — | anyOf 2 个分支 |  |
| value.bio | Bio / null | 否 | — | anyOf 2 个分支 |  |
| value.stats | Stats / null | 否 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_person_image`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| image_type | string | 否 | large | 允许 large、medium、small、grid |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 image |  |
| value.target | get_person_image_target | 是 | — | 拒绝额外字段 |  |
| value.imageType | string | 是 | large | 允许 large、medium、small、grid |  |
| value.url | string | 是 | — | 最短字符数 1；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_person_subjects`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subject |  |
| value.data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_person_characters`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 20 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |
| subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 作品媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| appearance_role | string | 否 | — | 允许 main、supporting、guest、unknown | 主角、配角、客串或未知出演关系；与角色实体type独立。 |
| subject_form | string | 否 | — | 允许 tv、ova、movie、web、other | 动画作品形式；提供时必须同时指定subject_type=2，返回subjectFacts以核对形式。 |
| include | array<string> | 否 | — | 最多项 2；元素不重复；元素：允许 subject_facts、own_collection | 按需附带紧凑作品事实或本人收藏状态；own_collection必须登录，subject_form筛选也会返回subjectFacts作为核对证据。 |
| include[] | string | 是 | — | 允许 subject_facts、own_collection |  |
| snapshot_ref | string | 否 | — | 最短字符数 32；最长字符数 32；正则 ^[a-f0-9]{32}$ | 增强查询续页使用首个响应page.snapshotRef，并保持所有筛选和include相同；不重新读取完整关联源。 |
| subject_type | integer | 是 | — | 固定 2 | then: 提供 subject_form；subject_form∈tv、ova、movie、web、other |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 personCharacter |  |
| value.data | array<PersonCharacterRow> | 是 | — | 最多项 100 |  |
| value.page | AppearancePageMeta | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public、self |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.coverage | AppearanceCoverage | 否 | — | 拒绝额外字段 |  |
| value.account | Account | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.account | Account | 是 | — | 拒绝额外字段 | then: 提供 visibility；visibility=self |
| value.account | 禁止 | 否 | — | 禁止 | else: 提供 visibility；visibility=self |

## `collect_person`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 collect_person | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_person_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_person_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 true | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_person_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_person_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `uncollect_person`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 uncollect_person | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_person_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_person_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 false | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_person_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_person_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_user_person_collections`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 personCollection |  |
| value.data | array<personCollectionItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public、self |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.account | Account | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.account | Account | 是 | — | 拒绝额外字段 | then: 提供 visibility；visibility=self |
| value.account | 禁止 | 否 | — | 禁止 | else: 提供 visibility；visibility=self |

## `get_user_person_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 1 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 1 |
| value.target | get_person_image_target | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.state | string | 是 | — | 允许 collected、not_collected | oneOf 1 |
| value.collection | personCollectionItem / null | 是 | — | anyOf 2 个分支 | oneOf 1 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.visibility | string | 是 | — | 固定 self | oneOf 1 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 1 |
| value.account | Account | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 1 |
| value.collection | personCollectionItem | 否 | — | 拒绝额外字段 | then: 提供 state；state=collected |
| value.collection | null | 否 | — | — | else: 提供 state；state=collected |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 2 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 2 |
| value.target | get_person_image_target | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.state | string | 是 | — | 允许 collected、unavailable | oneOf 2 |
| value.collection | personCollectionItem / null | 是 | — | anyOf 2 个分支 | oneOf 2 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.visibility | string | 是 | — | 固定 public | oneOf 2 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 2 |

## `get_user_info`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| include | array<string> | 否 | sign | 最多项 1；元素不重复；元素：允许 sign |  |
| include[] | string | 是 | — | 允许 sign |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 user |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.username | string | 是 | — | 最短字符数 1；最长字符数 200 |  |
| value.nickname | string | 是 | — | 最短字符数 0；最长字符数 300 |  |
| value.userGroup | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 sign |  |
| value.sign | string / null | 否 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_user_avatar`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| avatar_type | string | 否 | large | 允许 large、medium、small |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 avatar |  |
| value.userIdentifier | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| value.userId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.username | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 200 |  |
| value.imageType | string | 是 | large | 允许 large、medium、small |  |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_current_user`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| check_nsfw | boolean | 否 | false | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 account |  |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.username | string | 是 | — | 最短字符数 1；最长字符数 200 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_user_collections`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| collection_type | integer | 否 | — | 允许 1、2、3、4、5 | 1想看、2看过/已完成、3在看、4搁置、5抛弃；明确看过必须用2，不以章节进度替代整部状态。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 collection |  |
| value.data | array<get_user_collections_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public、self |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.account | Account | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.account | Account | 是 | — | 拒绝额外字段 | then: 提供 visibility；visibility=self |
| value.account | 禁止 | 否 | — | 禁止 | else: 提供 visibility；visibility=self |

## `query_user_collections`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| subject_type | integer | 是 | — | 允许 1、2、3、4、6 | 媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| collection_type | integer | 否 | — | 允许 1、2、3、4、5 | 1想看、2看过/已完成、3在看、4搁置、5抛弃；明确看过必须用2，不以章节进度替代整部状态。 |
| air_date | object | 是 | — | 最少字段 1；拒绝额外字段 | 实际YYYY-MM-DD日期，含上下界；min不能晚于max。 |
| air_date.min | string | 否 | — | 最短字符数 10；最长字符数 10；正则 ^\d{4}-\d{2}-\d{2}$ |  |
| air_date.max | string | 否 | — | 最短字符数 10；最长字符数 10；正则 ^\d{4}-\d{2}-\d{2}$ |  |
| sort | string | 否 | date_desc | 允许 date_desc、date_asc |  |
| extra_subject_ids | array<integer> | 否 | 空数组 | 最多项 100；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| extra_subject_ids[] | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 collectionQuery |  |
| value.data | array<query_user_collections_dataItem> | 是 | — | 最多项 10000 |  |
| value.matchedCount | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.coverage | query_user_collections_coverage | 是 | — | 拒绝额外字段 |  |
| value.missingExtraSubjectIds | array<integer> | 是 | — | 最多项 100；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| value.visibility | string | 是 | — | 允许 self、public |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_user_subject_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| username | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^(?:-&#124;[A-Za-z0-9_]+)$ | 本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。 |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 1 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 1 |
| value.target | get_subject_image_target | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.state | string | 是 | — | 允许 collected、not_collected | oneOf 1 |
| value.collection | SelfSubjectSnapshot / null | 是 | — | anyOf 2 个分支 | oneOf 1 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.visibility | string | 是 | — | 固定 self | oneOf 1 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 1 |
| value.account | Account | 是 | — | 拒绝额外字段 | oneOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 1 |
| value.collection | SelfSubjectSnapshot | 否 | — | 拒绝额外字段 | then: 提供 state；state=collected |
| value.collection | null | 否 | — | — | else: 提供 state；state=collected |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 2 |
| value.kind | string | 是 | — | 固定 collectionState | oneOf 2 |
| value.target | get_subject_image_target | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.state | string | 是 | — | 允许 collected、unavailable | oneOf 2 |
| value.collection | PublicSubjectCollection / null | 是 | — | anyOf 2 个分支 | oneOf 2 |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.visibility | string | 是 | — | 固定 public | oneOf 2 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 2 |
| value.collection | PublicSubjectCollection | 否 | — | 拒绝额外字段 | then: 提供 state；state=collected |

## `update_subject_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| collection_type | integer | 否 | — | 允许 1、2、3、4、5 | 1想看、2看过/已完成、3在看、4搁置、5抛弃；明确看过必须用2，不以章节进度替代整部状态。 |
| rating | integer | 否 | — | ≥ 0；≤ 10 |  |
| comment | string | 否 | — | 最短字符数 0；最长字符数 2000 |  |
| tags | array<string> | 否 | — | 最多项 40；元素不重复；元素：最短字符数 1；最长字符数 100；正则 ^\S+$ |  |
| tags[] | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^\S+$ |  |
| private | boolean | 否 | — | — |  |
| ep_status | integer | 否 | — | ≥ 0；≤ 9007199254740991 | 仅已收藏书籍的已读章数；禁止用于动画/三次元已看集数。 |
| vol_status | integer | 否 | — | ≥ 0；≤ 9007199254740991 | 仅已收藏书籍的已读卷数。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 update_subject_collection | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_subject_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<update_subject_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type、rating、comment、tags、private、ep_status、vol_status | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_subject_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<update_subject_collection_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_user_episode_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| episode_type | integer | 否 | — | 允许 0、1、2、3、4、5、6 |  |
| limit | integer | 否 | 100 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 episodeCollection |  |
| value.data | array<EpisodeState> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 self |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.account | Account | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `update_episode_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| episode_ids | array<integer> | 是 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| episode_ids[] | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| collection_type | integer | 否 | 2 | 允许 0、1、2、3 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 update_episode_collection | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | get_subject_image_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<update_episode_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number | 是 | — | 允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | get_subject_image_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<update_episode_collection_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_single_episode_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 episodeState |  |
| value.data | EpisodeState | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.complete | boolean | 是 | — | 固定 true |  |
| value.visibility | string | 是 | — | 固定 self |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.account | Account | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `update_single_episode_collection`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 1 |
| collection_type | integer | 否 | 2 | 允许 0、1、2、3 | oneOf 1 |
| batch | boolean | 否 | — | 固定 false | oneOf 1 |
| episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 2 |
| batch | boolean | 是 | — | 固定 true | 官方看到此集；自动补齐前序正篇。；oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 update_single_episode_collection | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | update_single_episode_collection_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<update_episode_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type、batch | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number | 是 | — | 允许 0、1、2、3 | allOf 1 |
| value.affectedEpisodeIds | array<integer> | 否 | — | 最多项 2000；元素不重复；元素：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | update_single_episode_collection_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<update_episode_collection_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_person_revisions`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.data | array<get_person_revisions_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_person_revision`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| revision_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | content | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |
| version_limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| version_offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.targetKind | string | 是 | — | 固定 person |  |
| value.targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| value.changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.contentState | string | 是 | — | 允许 available、not_requested、unavailable、unsupported_shape |  |
| value.versions | array<get_person_revision_versionsItem> | 是 | — | 最多项 20 |  |
| value.versionsPage | VersionsPageMeta / null | 是 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.included | array<组合字段> | 否 | — | 最多项 0 | then: 提供 contentState；contentState=not_requested |
| value.included | array<组合字段> | 否 | — | — | else: 提供 contentState；contentState=not_requested |
| value.versionsPage | VersionsPageMeta | 否 | — | 拒绝额外字段 | then: 提供 contentState；contentState=available |
| value.included | array<组合字段> | 否 | — | — | then: 提供 contentState；contentState=available |
| value.versions | array<组合字段> | 否 | — | 最多项 0 | else: 提供 contentState；contentState=available |
| value.versionsPage | null | 否 | — | — | else: 提供 contentState；contentState=available |

## `get_character_revisions`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.data | array<get_character_revisions_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_character_revision`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| revision_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | content | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |
| version_limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| version_offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.targetKind | string | 是 | — | 固定 character |  |
| value.targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| value.changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.contentState | string | 是 | — | 允许 available、not_requested、unavailable、unsupported_shape |  |
| value.versions | array<get_character_revision_versionsItem> | 是 | — | 最多项 20 |  |
| value.versionsPage | VersionsPageMeta / null | 是 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.included | array<组合字段> | 否 | — | 最多项 0 | then: 提供 contentState；contentState=not_requested |
| value.included | array<组合字段> | 否 | — | — | else: 提供 contentState；contentState=not_requested |
| value.versionsPage | VersionsPageMeta | 否 | — | 拒绝额外字段 | then: 提供 contentState；contentState=available |
| value.included | array<组合字段> | 否 | — | — | then: 提供 contentState；contentState=available |
| value.versions | array<组合字段> | 否 | — | 最多项 0 | else: 提供 contentState；contentState=available |
| value.versionsPage | null | 否 | — | — | else: 提供 contentState；contentState=available |

## `get_subject_revisions`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.data | array<get_subject_revisions_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_revision`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| revision_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | content | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |
| version_limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| version_offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.targetKind | string | 是 | — | 固定 subject |  |
| value.targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| value.changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.contentState | string | 是 | — | 允许 available、not_requested、unavailable、unsupported_shape |  |
| value.versions | array<get_subject_revision_versionsItem> | 是 | — | 最多项 20 |  |
| value.versionsPage | VersionsPageMeta / null | 是 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.included | array<组合字段> | 否 | — | 最多项 0 | then: 提供 contentState；contentState=not_requested |
| value.included | array<组合字段> | 否 | — | — | else: 提供 contentState；contentState=not_requested |
| value.versionsPage | VersionsPageMeta | 否 | — | 拒绝额外字段 | then: 提供 contentState；contentState=available |
| value.included | array<组合字段> | 否 | — | — | then: 提供 contentState；contentState=available |
| value.versions | array<组合字段> | 否 | — | 最多项 0 | else: 提供 contentState；contentState=available |
| value.versionsPage | null | 否 | — | — | else: 提供 contentState；contentState=available |

## `get_episode_revisions`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.data | array<get_episode_revisions_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_episode_revision`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| revision_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | content | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |
| version_limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| version_offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 |  |
| value.entity | string | 是 | — | 固定 revision |  |
| value.revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| value.targetKind | string | 是 | — | 固定 episode |  |
| value.targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| value.creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| value.changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.contentState | string | 是 | — | 允许 available、not_requested、unavailable、unsupported_shape |  |
| value.versions | array<get_episode_revision_versionsItem> | 是 | — | 最多项 20 |  |
| value.versionsPage | VersionsPageMeta / null | 是 | — | anyOf 2 个分支 |  |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.included | array<组合字段> | 否 | — | 最多项 0 | then: 提供 contentState；contentState=not_requested |
| value.included | array<组合字段> | 否 | — | — | else: 提供 contentState；contentState=not_requested |
| value.versionsPage | VersionsPageMeta | 否 | — | 拒绝额外字段 | then: 提供 contentState；contentState=available |
| value.included | array<组合字段> | 否 | — | — | then: 提供 contentState；contentState=available |
| value.versions | array<组合字段> | 否 | — | 最多项 0 | else: 提供 contentState；contentState=available |
| value.versionsPage | null | 否 | — | — | else: 提供 contentState；contentState=available |

## `create_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| title | string | 是 | — | 最短字符数 1；最长字符数 80 |  |
| description | string | 是 | — | 最短字符数 0；最长字符数 10000 |  |
| private | boolean | 否 | — | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 create_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | create_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<create_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 title、description、private | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.createdId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| value.target | create_index_target | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | create_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<create_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| own | boolean | 否 | false | — | 需要本人私有目录或收藏现状时设 true，使用本应用账户会话。 |
| include | array<string> | 否 | — | 最多项 2；元素不重复；元素：允许 description、stats |  |
| include[] | string | 是 | — | 允许 description、stats |  |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 1 |
| own | boolean | 否 | false | 固定 false | oneOf 1 |
| include | array<string> | 否 | description | 最多项 2；元素不重复；元素：允许 description、stats | oneOf 1 |
| include[] | string | 是 | — | 允许 description、stats | oneOf 1 |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 2 |
| own | boolean | 是 | — | 固定 true | oneOf 2 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 1 |
| value.entity | string | 是 | — | 固定 index | oneOf 1 |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 1 |
| value.title | string | 是 | — | 最短字符数 0；最长字符数 80 | oneOf 1 |
| value.creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 | oneOf 1 |
| value.ownerId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | oneOf 1 |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 | oneOf 1 |
| value.updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 | oneOf 1 |
| value.totalSubjects | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | oneOf 1 |
| value.url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ | oneOf 1 |
| value.visibility | string | 是 | — | 固定 public | oneOf 1 |
| value.included | array<string> | 是 | — | 最多项 2；元素不重复；元素：允许 description、stats | oneOf 1 |
| value.description | string / null | 否 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 | oneOf 1 |
| value.stats | Stats / null | 否 | — | anyOf 2 个分支 | oneOf 1 |
| value.private | boolean / null | 是 | — | anyOf 2 个分支；boolean：固定 false | oneOf 1 |
| value.collected | null | 是 | — | — | oneOf 1 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 1 |
| value.schemaVersion | number | 是 | — | 固定 1 | oneOf 2 |
| value.kind | string | 是 | — | 固定 indexState | oneOf 2 |
| value.id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 2 |
| value.ownerId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf 2 |
| value.title | string | 是 | — | 最短字符数 0；最长字符数 80 | oneOf 2 |
| value.description | string | 是 | — | 最短字符数 0；最长字符数 10000 | oneOf 2 |
| value.private | boolean | 是 | — | — | oneOf 2 |
| value.collected | boolean | 是 | — | — | oneOf 2 |
| value.complete | boolean | 是 | — | 固定 true | oneOf 2 |
| value.visibility | string | 是 | — | 固定 self | oneOf 2 |
| value.readAt | string | 是 | — | 最短字符数 0；最长字符数 100 | oneOf 2 |
| value.account | Account | 是 | — | 拒绝额外字段 | oneOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | oneOf 2 |

## `update_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| title | string | 否 | — | 最短字符数 1；最长字符数 80 |  |
| description | string | 否 | — | 最短字符数 0；最长字符数 10000 |  |
| private | boolean | 否 | — | — |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 update_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | create_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<update_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 title、description、private | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | create_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<update_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_index_subjects`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subject_type | integer | 否 | — | 允许 1、2、3、4、6 | 媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。 |
| limit | integer | 否 | 30 | ≥ 1；≤ 100 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 10000 |  |
| own | boolean | 否 | false | — | 需要本人私有目录或收藏现状时设 true，使用本应用账户会话。 |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 indexSubject |  |
| value.data | array<get_index_subjects_dataItem> | 是 | — | 最多项 100 |  |
| value.page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 允许 public、self |  |
| value.readAt | string | 是 | — | 最长字符数 50 |  |
| value.account | Account | 否 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.account | Account | 是 | — | 拒绝额外字段 | then: 提供 visibility；visibility=self |
| value.account | 禁止 | 否 | — | 禁止 | else: 提供 visibility；visibility=self |

## `add_subject_to_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| comment | string | 否 | — | 最短字符数 0；最长字符数 2000 |  |
| order | integer | 否 | — | ≥ 0；≤ 1000000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 add_subject_to_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<add_subject_to_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership、comment、order | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| value.target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | add_subject_to_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<add_subject_to_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `update_index_subject`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| comment | string | 否 | — | 最短字符数 0；最长字符数 2000 |  |
| order | integer | 否 | — | ≥ 0；≤ 1000000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 update_index_subject | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<update_index_subject_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership、comment、order | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| value.target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | add_subject_to_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<update_index_subject_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `remove_subject_from_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 remove_subject_from_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<remove_subject_from_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| value.target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | add_subject_to_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<remove_subject_from_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `collect_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 collect_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | create_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 true | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | create_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `uncollect_index`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | number | 是 | — | 固定 1 | allOf 1 |
| value.kind | string | 是 | — | 固定 submission | allOf 1 |
| value.tool | string | 是 | — | 固定 uncollect_index | allOf 1 |
| value.expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 | allOf 1 |
| value.target | create_index_target / null | 是 | — | anyOf 2 个分支 | allOf 1 |
| value.submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted | allOf 1 |
| value.verification | string | 是 | — | 固定 pending | allOf 1 |
| value.items | array<collect_index_itemsItem> | 是 | — | 最少项 1；最多项 201 | allOf 1 |
| value.requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected | allOf 1 |
| value.createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 | allOf 1 |
| value.requestedCollected | boolean | 是 | — | 固定 false | allOf 1 |
| value.requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 | allOf 1 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 1 |
| value.submissionState | string | 否 | — | 固定 acknowledged | allOf 2 |
| value.target | create_index_target | 否 | — | 拒绝额外字段 | allOf 2 |
| value.items | array<collect_index_itemsItem_2> | 否 | — | 最少项 1；最多项 201 | allOf 2 |
| value.accessContext | AccessContext | 否 | — | 见公共结构 | allOf 2 |

## `get_subject_comments`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| include[] | string | 是 | — | 允许 excerpt、content |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subjectComment |  |
| value.data | array<get_subject_comments_dataItem> | 是 | — | 最多项 20 |  |
| value.page | get_subject_comments_page | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.data | array<get_subject_comments_dataItem_2> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_3> | 否 | — | — | else: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_4> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_5> | 否 | — | — | else: 提供 included；included |

## `get_subject_reviews`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 5 | ≥ 1；≤ 20 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 excerpt |  |
| include[] | string | 是 | — | 允许 excerpt |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 excerpt |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subjectReview |  |
| value.data | array<get_subject_reviews_dataItem> | 是 | — | 最多项 20 |  |
| value.page | get_subject_comments_page | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.data | array<get_subject_comments_dataItem_2> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_3> | 否 | — | — | else: 提供 included；included |

## `get_blog_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| blog_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.kind | string | 是 | — | 固定 details |  |
| value.entity | string | 是 | — | 固定 blog |  |
| value.blogId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.title | string | 是 | — | 最长字符数 300 |  |
| value.author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.replyCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/blog/[1-9]\d*$ |  |
| value.content | get_blog_details_content / get_blog_details_content_2 / get_blog_details_content_3 | 否 | — | oneOf 3 个分支 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.content | get_blog_details_content / get_blog_details_content_2 / get_blog_details_content_3 | 是 | — | oneOf 3 个分支 | then: 提供 included；included |
| value.content | 禁止 | 否 | — | 禁止 | else: 提供 included；included |

## `get_blog_comments`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| blog_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |
| snapshot_ref | string | 否 | — | 最短字符数 35；最长字符数 35；正则 ^pg_[A-Za-z0-9_-]{32}$ |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| include[] | string | 是 | — | 允许 excerpt、content |  |
| snapshot_ref | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^pg_[A-Za-z0-9_-]{32}$ | then: 提供 offset；offset |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段；条件：提供 offset；offset |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 blogComment |  |
| value.data | array<get_blog_comments_dataItem> | 是 | — | 最多项 20 |  |
| value.page | get_blog_comments_page | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.data | array<get_subject_comments_dataItem_2> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_3> | 否 | — | — | else: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_4> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_5> | 否 | — | — | else: 提供 included；included |

## `get_subject_topics`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<禁止> | 是 | — | 最多项 0 |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 subjectTopic |  |
| value.data | array<get_subject_topics_dataItem> | 是 | — | 最多项 20 |  |
| value.page | get_subject_comments_page | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `get_subject_topic_details`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| topic_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 content |  |
| include[] | string | 是 | — | 允许 content |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 content |  |
| value.kind | string | 是 | — | 固定 details |  |
| value.entity | string | 是 | — | 固定 subjectTopic |  |
| value.subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.topicId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| value.title | string | 是 | — | 最长字符数 300 |  |
| value.author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| value.createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.replyCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| value.url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/topic/[1-9]\d*$ |  |
| value.content | get_blog_details_content / get_blog_details_content_2 / get_blog_details_content_3 | 否 | — | oneOf 3 个分支 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.content | get_blog_details_content / get_blog_details_content_2 / get_blog_details_content_3 | 是 | — | oneOf 3 个分支 | then: 提供 included；included |
| value.content | 禁止 | 否 | — | 禁止 | else: 提供 included；included |

## `get_subject_topic_replies`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| topic_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| limit | integer | 否 | 10 | ≥ 1；≤ 20 |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |
| snapshot_ref | string | 否 | — | 最短字符数 35；最长字符数 35；正则 ^pg_[A-Za-z0-9_-]{32}$ |  |
| include | array<string> | 否 | 空数组 | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| include[] | string | 是 | — | 允许 excerpt、content |  |
| snapshot_ref | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^pg_[A-Za-z0-9_-]{32}$ | then: 提供 offset；offset |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段；条件：提供 offset；offset |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.included | array<string> | 是 | — | 最多项 1；元素不重复；元素：允许 excerpt、content |  |
| value.kind | string | 是 | — | 固定 page |  |
| value.entity | string | 是 | — | 固定 topicPost |  |
| value.data | array<get_subject_topic_replies_dataItem> | 是 | — | 最多项 20 |  |
| value.page | get_blog_comments_page | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |
| value.data | array<get_subject_comments_dataItem_2> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_3> | 否 | — | — | else: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_4> | 否 | — | — | then: 提供 included；included |
| value.data | array<get_subject_comments_dataItem_5> | 否 | — | — | else: 提供 included；included |

## `read_community_content`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| content_ref | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^ct_[A-Za-z0-9_-]{32}$ |  |
| offset | integer | 否 | 0 | ≥ 0；≤ 9007199254740991 |  |
| limit | integer | 否 | 5000 | ≥ 1；≤ 5000 |  |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.schemaVersion | integer | 是 | — | 固定 1 |  |
| value.scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| value.visibility | string | 是 | — | 固定 public |  |
| value.readAt | string | 是 | — | 最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| value.kind | string | 是 | — | 固定 content_chunk |  |
| value.source | read_community_content_source / read_community_content_source_2 / read_community_content_source_3 / read_community_content_source_4 | 是 | — | oneOf 4 个分支 |  |
| value.content | get_blog_details_content | 是 | — | 拒绝额外字段 |  |
| value.accessContext | AccessContext | 否 | — | 见公共结构 |  |

## `execute_write_batch`

输入字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| operations | array<object> | 是 | — | 最少项 1；最多项 200；元素：oneOf 20 个分支 |  |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: collect_character |
| operations[].tool | string | 是 | — | 固定 collect_character | oneOf: collect_character |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: collect_character |
| operations[].args.character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: collect_character |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_character |
| operations[].tool | string | 是 | — | 固定 uncollect_character | oneOf: uncollect_character |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_character |
| operations[].args.character_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: uncollect_character |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: collect_person |
| operations[].tool | string | 是 | — | 固定 collect_person | oneOf: collect_person |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: collect_person |
| operations[].args.person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: collect_person |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_person |
| operations[].tool | string | 是 | — | 固定 uncollect_person | oneOf: uncollect_person |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_person |
| operations[].args.person_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: uncollect_person |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_subject_collection |
| operations[].tool | string | 是 | — | 固定 update_subject_collection | oneOf: update_subject_collection |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_subject_collection |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_subject_collection |
| operations[].args.collection_type | integer | 否 | — | 允许 1、2、3、4、5 | 1想看、2看过/已完成、3在看、4搁置、5抛弃；明确看过必须用2，不以章节进度替代整部状态。；oneOf: update_subject_collection |
| operations[].args.rating | integer | 否 | — | ≥ 0；≤ 10 | oneOf: update_subject_collection |
| operations[].args.comment | string | 否 | — | 最短字符数 0；最长字符数 2000 | oneOf: update_subject_collection |
| operations[].args.tags | array<string> | 否 | — | 最多项 40；元素不重复；元素：最短字符数 1；最长字符数 100；正则 ^\S+$ | oneOf: update_subject_collection |
| operations[].args.tags[] | string | 是 | — | 最短字符数 1；最长字符数 100；正则 ^\S+$ | oneOf: update_subject_collection |
| operations[].args.private | boolean | 否 | — | — | oneOf: update_subject_collection |
| operations[].args.ep_status | integer | 否 | — | ≥ 0；≤ 9007199254740991 | 仅已收藏书籍的已读章数；禁止用于动画/三次元已看集数。；oneOf: update_subject_collection |
| operations[].args.vol_status | integer | 否 | — | ≥ 0；≤ 9007199254740991 | 仅已收藏书籍的已读卷数。；oneOf: update_subject_collection |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_episode_collection |
| operations[].tool | string | 是 | — | 固定 update_episode_collection | oneOf: update_episode_collection |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_episode_collection |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_episode_collection |
| operations[].args.episode_ids | array<integer> | 是 | — | 最少项 1；最多项 100；元素不重复；元素：≥ 1；≤ 9007199254740991 | oneOf: update_episode_collection |
| operations[].args.episode_ids[] | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_episode_collection |
| operations[].args.collection_type | integer | 否 | 2 | 允许 0、1、2、3 | oneOf: update_episode_collection |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_single_episode_collection |
| operations[].tool | string | 是 | — | 固定 update_single_episode_collection | oneOf: update_single_episode_collection |
| operations[].args | object | 是 | — | oneOf 2 个分支 | oneOf: update_single_episode_collection |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_single_episode_collection；oneOf 1 |
| operations[].args.episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_single_episode_collection；oneOf 1 |
| operations[].args.collection_type | integer | 否 | 2 | 允许 0、1、2、3 | oneOf: update_single_episode_collection；oneOf 1 |
| operations[].args.batch | boolean | 否 | — | 固定 false | oneOf: update_single_episode_collection；oneOf 1 |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_single_episode_collection；oneOf 2 |
| operations[].args.episode_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_single_episode_collection；oneOf 2 |
| operations[].args.batch | boolean | 是 | — | 固定 true | 官方看到此集；自动补齐前序正篇。；oneOf: update_single_episode_collection；oneOf 2 |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: create_index |
| operations[].tool | string | 是 | — | 固定 create_index | oneOf: create_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: create_index |
| operations[].args.title | string | 是 | — | 最短字符数 1；最长字符数 80 | oneOf: create_index |
| operations[].args.description | string | 是 | — | 最短字符数 0；最长字符数 10000 | oneOf: create_index |
| operations[].args.private | boolean | 否 | — | — | oneOf: create_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_index |
| operations[].tool | string | 是 | — | 固定 update_index | oneOf: update_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_index |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_index |
| operations[].args.title | string | 否 | — | 最短字符数 1；最长字符数 80 | oneOf: update_index |
| operations[].args.description | string | 否 | — | 最短字符数 0；最长字符数 10000 | oneOf: update_index |
| operations[].args.private | boolean | 否 | — | — | oneOf: update_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_index（index_from分支） |
| operations[].tool | string | 是 | — | 固定 update_index | oneOf: update_index（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_index（index_from分支） |
| operations[].args.title | string | 否 | — | 最短字符数 1；最长字符数 80 | oneOf: update_index（index_from分支） |
| operations[].args.description | string | 否 | — | 最短字符数 0；最长字符数 10000 | oneOf: update_index（index_from分支） |
| operations[].args.private | boolean | 否 | — | — | oneOf: update_index（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: update_index（index_from分支） |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: add_subject_to_index |
| operations[].tool | string | 是 | — | 固定 add_subject_to_index | oneOf: add_subject_to_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: add_subject_to_index |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: add_subject_to_index |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: add_subject_to_index |
| operations[].args.comment | string | 否 | — | 最短字符数 0；最长字符数 2000 | oneOf: add_subject_to_index |
| operations[].args.order | integer | 否 | — | ≥ 0；≤ 1000000 | oneOf: add_subject_to_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: add_subject_to_index（index_from分支） |
| operations[].tool | string | 是 | — | 固定 add_subject_to_index | oneOf: add_subject_to_index（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: add_subject_to_index（index_from分支） |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: add_subject_to_index（index_from分支） |
| operations[].args.comment | string | 否 | — | 最短字符数 0；最长字符数 2000 | oneOf: add_subject_to_index（index_from分支） |
| operations[].args.order | integer | 否 | — | ≥ 0；≤ 1000000 | oneOf: add_subject_to_index（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: add_subject_to_index（index_from分支） |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_index_subject |
| operations[].tool | string | 是 | — | 固定 update_index_subject | oneOf: update_index_subject |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_index_subject |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_index_subject |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_index_subject |
| operations[].args.comment | string | 否 | — | 最短字符数 0；最长字符数 2000 | oneOf: update_index_subject |
| operations[].args.order | integer | 否 | — | ≥ 0；≤ 1000000 | oneOf: update_index_subject |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: update_index_subject（index_from分支） |
| operations[].tool | string | 是 | — | 固定 update_index_subject | oneOf: update_index_subject（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: update_index_subject（index_from分支） |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: update_index_subject（index_from分支） |
| operations[].args.comment | string | 否 | — | 最短字符数 0；最长字符数 2000 | oneOf: update_index_subject（index_from分支） |
| operations[].args.order | integer | 否 | — | ≥ 0；≤ 1000000 | oneOf: update_index_subject（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: update_index_subject（index_from分支） |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: remove_subject_from_index |
| operations[].tool | string | 是 | — | 固定 remove_subject_from_index | oneOf: remove_subject_from_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: remove_subject_from_index |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: remove_subject_from_index |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: remove_subject_from_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: remove_subject_from_index（index_from分支） |
| operations[].tool | string | 是 | — | 固定 remove_subject_from_index | oneOf: remove_subject_from_index（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: remove_subject_from_index（index_from分支） |
| operations[].args.subject_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: remove_subject_from_index（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: remove_subject_from_index（index_from分支） |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: collect_index |
| operations[].tool | string | 是 | — | 固定 collect_index | oneOf: collect_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: collect_index |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: collect_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: collect_index（index_from分支） |
| operations[].tool | string | 是 | — | 固定 collect_index | oneOf: collect_index（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: collect_index（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: collect_index（index_from分支） |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_index |
| operations[].tool | string | 是 | — | 固定 uncollect_index | oneOf: uncollect_index |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_index |
| operations[].args.index_id | integer | 是 | — | ≥ 1；≤ 9007199254740991 | oneOf: uncollect_index |
| operations[] | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_index（index_from分支） |
| operations[].tool | string | 是 | — | 固定 uncollect_index | oneOf: uncollect_index（index_from分支） |
| operations[].args | object | 是 | — | 拒绝额外字段 | oneOf: uncollect_index（index_from分支） |
| operations[].index_from | integer | 是 | — | ≥ 1；≤ 200 | oneOf: uncollect_index（index_from分支） |

成功输出字段

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| value.state | string | 是 | — | success / unchanged / partial / failed / unknown；进度更新 running | 整批状态 |
| value.items[] | object | 是 | — | 保留原 step | 每个计划项的结果 |
| value.items[].step | integer | 是 | — | ≥ 1 | 原输入序号 |
| value.items[].tool | string | 是 | — | 固定写工具名称 | 对应 operations[].tool |
| value.items[].state | string | 是 | — | success / submitted / unchanged / skipped / failed / unknown / blocked / not_executed | 条目状态 |
| value.items[].networkAttempted | boolean | 是 | — | — | 写入尝试事实 |
| value.items[].writeNetworkAttempted | boolean | 否 | — | — | 排除明确未投递的写入尝试 |
| value.items[].target | object | 否 | — | 按工具目标字段 | 原对象范围 |
| value.items[].reason | string | 否 | — | — | 跳过或阻塞原因 |
| value.items[].blockedBy[] | integer | 否 | — | ≥ 1 | 依赖的原步骤编号 |
| value.items[].stageResults[] | object | 否 | — | stage / state / target；可含提交、回读与错误 | 复合操作子阶段结果 |
| value.items[].preflightSkipped[] | object | 否 | — | episodeId / reason / error | 预检未通过的章节 |
| value.items[].submission | object | 否 | — | 对应底层写工具输出 | 提交回执 |
| value.items[].submissionError | object | 否 | — | 公共安全错误字段 | 提交阶段错误 |
| value.items[].verificationError | object | 否 | — | 公共安全错误字段 | 回读阶段错误 |
| value.items[].verification | object | 否 | — | 对应宿主回读结果 | 独立验证事实 |
| value.items[].actual | object | 否 | — | 对应目标的状态字段 | 回读实际状态 |
| value.items[].error | object | 否 | — | 公共安全错误字段 | 条目失败 |
| value.items[].accountId | integer | 否 | — | ≥ 1 | 提交账户 |
| value.items[].before | object | 否 | — | 对应目标字段 | 修改前基线 |
| value.items[].after | object | 否 | — | 对应目标字段 | 预期修改目标 |
| value.items[].requestId | string | 否 | — | 宿主生成 | 执行身份 |
| value.items[].batchId | string | 否 | — | 宿主生成 | 执行身份 |
| value.items[].logicalOperationId | string | 否 | — | 宿主生成 | 执行身份 |
| value.items[].createdId | integer | 否 | — | ≥ 1 | 创建目录的实际ID |
| value.items[].partial | boolean | 否 | — | — | 子阶段部分完成 |
| value.items[].resolution | string | 否 | — | observed_partial等宿主事实 | 结果依据 |
| value.items[].verification.readbackCompleted | boolean | 否 | — | — | 回读及目标、保护范围核对 |
| value.items[].verification.requestedStateMatched | boolean | 否 | — | — | 回读及目标、保护范围核对 |
| value.items[].verification.protectedFieldsMatched | boolean | 否 | — | — | 回读及目标、保护范围核对 |
| value.items[].verification.superseded | boolean | 否 | — | — | 回读及目标、保护范围核对 |
| value.items[].verification.mismatchedFields[] | string | 否 | — | 目标字段名称 | 未匹配字段 |
| value.items[].verification.state | string | 否 | — | pending / success / unchanged / failed / unknown | 验证状态 |
| value.items[].verification.scope | string | 否 | — | batch_final_state / recovery | 验证范围 |
| value.items[].verification.parentProgress | object | 否 | — | subjectId / before / actual | 作品父进度核对 |
| value.summary | object | 是 | — | 各状态计数为非负整数 | success / submitted / unchanged / skipped / failed / unknown / blocked / not_executed |
| value.summary.success | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.submitted | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.unchanged | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.skipped | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.failed | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.unknown | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.blocked | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.summary.not_executed | integer | 是 | — | ≥ 0 | 原计划项状态计数 |
| value.partial | boolean | 是 | — | — | 是否存在已核实部分与未完成范围 |
| value.networkAttempted | boolean | 是 | — | — | 汇总写入尝试 |
| value.writeNetworkAttempted | boolean | 否 | — | — | 汇总实际写入尝试 |
| value.confirmation | object | 否 | — | required: boolean；reasons: array<string> | 完整计划确认政策 |
| value.confirmation.required | boolean | 是 | — | — | 是否要求确认 |
| value.confirmation.reasons[] | string | 是 | — | 宿主政策原因 | 确认原因 |
| value.accessContext | AccessContext | 否 | — | 公共结构 | 账户与权限事实 |
| value.failures[] | object | 否 | — | phase / step / tool / target / sourceTool / error | 全部已定位错误 |
| value.failure | object | 否 | — | 同 failures[] | 首项兼容字段 |
| value.error | object | 否 | — | 公共安全错误字段 | 整批异常 |
| value.prior | object | 否 | — | 已记录执行事实 | 已执行计划的历史事实 |
| value.recovery | object | 否 | — | blockers / createdTargets / action | 未完成范围的恢复事实 |
| value.recovery.blockers[] | object | 是 | — | 宿主恢复事实 | 未核实冲突范围 |
| value.recovery.createdTargets[] | object | 否 | — | tool / indexId / args / actual | 已核实新目录 |
| value.recovery.action | string | 是 | — | replan_remaining / independent_readback | 当前剩余工作 |
| value.completedSteps | integer | 否 | — | ≥ 0 | 进度更新的已完成步骤数 |
| value.totalSteps | integer | 否 | — | ≥ 0 | 进度更新的计划项数 |

## 公共输出结构

### `get_daily_broadcast_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| weekday | get_daily_broadcast_dataItem_weekday | 是 | — | 拒绝额外字段 |  |
| subjects | get_daily_broadcast_dataItem_subjects | 是 | — | 拒绝额外字段 |  |

### `AccessContext`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| mode | string | 是 | — | 允许 account、anonymous、unverified |  |
| account | null / AccessContext_account | 是 | — | anyOf 2 个分支 |  |
| nsfw | AccessContext_nsfw | 是 | — | 拒绝额外字段 |  |
| source | string | 是 | — | 允许 p1、v0、web |  |
| nsfwApplied | boolean | 是 | — | — |  |
| checkedAt | string | 是 | — | 最长字符数 50 |  |
| queryCoverage | AccessContext_queryCoverage | 否 | — | 拒绝额外字段 |  |
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
| code | string | 是 | — | 最长字符数 100 |  |
| message | string | 是 | — | 最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<SafeError_issuesItem> | 否 | — | 最多项 200 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `search_subjects_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | integer | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 subject |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectType | integer / null | 是 | — | anyOf 2 个分支；integer：允许 1、2、3、4、6 |  |
| name | string | 是 | — | 最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| date | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 50 |  |
| platform | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |
| score | number / null | 是 | — | anyOf 2 个分支；number：≥ 0；≤ 10 |  |
| nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |
| rank | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| ratingCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalEpisodes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalVolumes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| tags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| metaTags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/[1-9]\d*$ |  |
| relation | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| staff | string / null | 否 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| series | boolean / null | 否 | — | anyOf 2 个分支 |  |
| characters | array<get_subject_details_charactersItem> | 否 | — | 最多项 100 |  |

### `search_subjects_page`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| total | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 100 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 100 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |
| totalKind | string | 否 | — | 允许 estimated、exact、unknown |  |
| sourceNextOffset | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| sourceHasMore | boolean | 否 | — | — |  |
| excludedNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| unknownNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |

### `get_subject_details_charactersItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| name | string | 是 | — | 最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/character/[1-9]\d*$ |  |

### `get_subject_details_infoboxItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| key | string | 是 | — | 最长字符数 300 |  |
| value | string / array<get_subject_details_infoboxItem_valueItem> | 是 | — | anyOf 2 个分支；string：最长字符数 20000；array：最多项 300 |  |

### `get_subject_details_tagStatsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string | 是 | — | 最长字符数 100 |  |
| count | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| totalCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `get_subject_details_ratingDistribution`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 2 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 3 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 4 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 5 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 6 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 7 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 8 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 9 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| 10 | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `get_subject_image_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 subject |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `ReadError`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `SubjectPersonRow`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person | PersonSummary | 是 | — | 拒绝额外字段 |  |
| relation | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| participationText | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2000 |  |

### `SubjectCharacterRow`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character | CharacterSummary | 是 | — | 拒绝额外字段 |  |
| relation | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| actors | array<PersonSummary> / null | 是 | — | anyOf 2 个分支；array：最多项 100 |  |
| actorsCoverage | string | 是 | — | 允许 as_returned、unavailable |  |

### `EpisodeSummary`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 episode |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| episodeType | number | 是 | — | 允许 0、1、2、3、4、5、6 |  |
| name | string | 是 | — | 最短字符数 0；最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| sort | number / null | 是 | — | anyOf 2 个分支 |  |
| mainSequence | number / null | 是 | — | anyOf 2 个分支 |  |
| airDate | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 50 |  |
| disc | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| duration | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| durationSeconds | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |

### `get_episode_details_stats`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| comments | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `CharacterSummary`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 character |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| name | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| characterType | number / null | 是 | — | anyOf 2 个分支；number：允许 1、2、3、4 |  |
| url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |

### `PersonSummary`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 person |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| name | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| personType | number / null | 是 | — | anyOf 2 个分支；number：允许 1、2、3 |  |
| career | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素：最短字符数 1；最长字符数 100 |  |
| url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |

### `get_character_details_infoboxItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| key | string | 是 | — | 最短字符数 0；最长字符数 300 |  |
| value | string / array<get_character_details_infoboxItem_valueItem> | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 20000；array：最多项 300 |  |

### `Bio`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| gender | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| bloodType | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 4 |  |
| birthYear | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9999 |  |
| birthMonth | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 12 |  |
| birthDay | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 31 |  |

### `Stats`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| comments | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| collects | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `get_character_image_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 character |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `CharacterPersonRow`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| person | PersonSummary | 是 | — | 拒绝额外字段 |  |
| subject | SubjectRef | 是 | — | 拒绝额外字段 |  |
| staff | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| sourceTypeCode | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | 原始接口的type码；不同源语义不同，不能据此判断主角。出演关系只看appearanceRole。 |
| appearanceRole | AppearanceRole | 是 | — | 拒绝额外字段 |  |

### `collect_character_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_character_image_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 entity_collection |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `collect_character_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_character_image_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 entity_collection |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_collect_character | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `SafeError_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_uncollect_character | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `characterCollectionItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | CharacterSummary | 是 | — | 拒绝额外字段 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| collected | boolean | 是 | — | 固定 true |  |

### `Account`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| username | string | 是 | — | 最短字符数 1；最长字符数 200 |  |

### `get_person_image_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 person |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `PersonCharacterRow`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| character | CharacterSummary | 是 | — | 拒绝额外字段 |  |
| subject | SubjectRef | 是 | — | 拒绝额外字段 |  |
| staff | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| sourceTypeCode | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | 原始接口的type码；不同源语义不同，不能据此判断主角。出演关系只看appearanceRole。 |
| appearanceRole | AppearanceRole | 是 | — | 拒绝额外字段 |  |
| subjectFacts | AppearanceSubjectFacts | 否 | — | 拒绝额外字段 |  |
| ownCollection | AppearanceOwnCollection | 否 | — | 拒绝额外字段 |  |

### `AppearancePageMeta`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| total | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 100 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 100 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |
| totalKind | string | 否 | — | 允许 estimated、exact、unknown |  |
| sourceNextOffset | integer / null | 否 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| sourceHasMore | boolean | 否 | — | — |  |
| excludedNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| unknownNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| snapshotRef | string | 否 | — | 最短字符数 32；最长字符数 32；正则 ^[a-f0-9]{32}$ |  |

### `AppearanceCoverage`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| complete | boolean | 是 | — | — |  |
| sourceComplete | boolean | 是 | — | — |  |
| sourceUnit | string | 是 | — | 允许 character、appearance |  |
| sourceTotal | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| sourceReturnedCount | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| relationTotal | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| matchedRelationTotal | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| matchedSubjectTotal | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| unknownSubjectFormIds | array<integer> | 是 | — | 最多项 10000；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| unavailableSubjectIds | array<integer> | 是 | — | 最多项 10000；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| unavailableCollectionSubjectIds | array<integer> | 是 | — | 最多项 10000；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |

### `collect_person_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_person_image_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 entity_collection |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `collect_person_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_person_image_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 entity_collection |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_4`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_collect_person | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `SafeError_5`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_uncollect_person | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `personCollectionItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | PersonSummary | 是 | — | 拒绝额外字段 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| collected | boolean | 是 | — | 固定 true |  |

### `get_user_collections_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject | search_subjects_dataItem | 是 | — | 拒绝额外字段 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| collectionStatus | integer | 是 | — | 允许 1、2、3、4、5 |  |
| statusMeaning | string | 是 | — | 最长字符数 30 |  |
| personalRating | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 10 |  |
| personalTags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| private | boolean / null | 是 | — | anyOf 2 个分支 |  |
| chapters | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | 书籍已读章数；动画/三次元为派生已看集数，不能直接写ep_status。 |
| volumes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |

### `query_user_collections_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectType | number | 是 | — | 允许 1、2、3、4、6 |  |
| name | string | 是 | — | 最短字符数 1；最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |
| date | string / null | 是 | — | anyOf 2 个分支；string：正则 ^\d{4}-\d{2}-\d{2}$ |  |
| nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |
| platform | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |
| metaTags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 100；元素不重复；元素：最短字符数 1；最长字符数 100 |  |
| collectionStatus | number | 是 | — | 允许 1、2、3、4、5 |  |
| personalRating | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 10 |  |
| url | string | 是 | — | 正则 ^https://bgm\.tv/subject/[1-9]\d*$ |  |
| matchBasis | string | 是 | — | 允许 air_date、explicit_subject |  |

### `query_user_collections_coverage`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| complete | boolean | 是 | — | — |  |
| source | string | 是 | — | 允许 p1、v0、web |  |
| scannedCount | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| pagesRead | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| collectionTotal | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| unknownDateCount | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| stopReason | string | 是 | — | 允许 exhausted、date_boundary |  |
| privateRecords | string | 是 | — | 允许 included、public_only |  |
| excludedNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |
| unknownNsfwCount | integer | 否 | — | ≥ 0；≤ 9007199254740991 |  |

### `SafeError_6`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最长字符数 80 |  |
| message | string | 是 | — | 最长字符数 3000 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `SelfSubjectSnapshot`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| collectionStatus | number | 是 | — | 允许 1、2、3、4、5 |  |
| personalRating | integer | 是 | — | ≥ 0；≤ 10 |  |
| personalTags | array<string> | 是 | — | 最多项 40；元素：最短字符数 0；最长字符数 100 |  |
| comment | string | 是 | — | 最短字符数 0；最长字符数 2000 |  |
| private | boolean | 是 | — | — |  |
| chapters | integer | 是 | — | ≥ 0；≤ 9007199254740991 | 书籍为已读章数；动画/三次元为章节工具派生的已看集数，不能通过ep_status直接写入。 |
| volumes | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | 固定 true |  |
| progressMeaning | string | 否 | — | 允许 已读章数、已看集数、原生进度计数 |  |

### `PublicSubjectCollection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| collectionStatus | number | 是 | — | 允许 1、2、3、4、5 |  |
| personalRating | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 10 |  |
| personalTags | array<string> / null | 是 | — | anyOf 2 个分支；array：最多项 40；元素：最短字符数 0；最长字符数 100 |  |
| comment | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2000 |  |
| private | boolean | 是 | — | 固定 false |  |
| chapters | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 | 书籍为已读章数；动画/三次元为章节工具派生的已看集数，不能通过ep_status直接写入。 |
| volumes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| progressMeaning | string | 否 | — | 允许 已读章数、已看集数、原生进度计数 |  |

### `update_subject_collection_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_subject_image_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 subject_collection、book_progress |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `update_subject_collection_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | get_subject_image_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 subject_collection、book_progress |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_7`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_update_subject_collection | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `EpisodeState`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| episode | EpisodeSummary | 是 | — | 拒绝额外字段 |  |
| episodeStatus | number | 是 | — | 允许 0、1、2、3 |  |
| statusMeaning | string | 是 | — | 最短字符数 0；最长字符数 30 |  |
| updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |

### `update_episode_collection_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | update_single_episode_collection_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 episode_collection |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `update_episode_collection_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | update_single_episode_collection_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 episode_collection |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_8`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_update_episode_collection | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `update_single_episode_collection_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 episode |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `SafeError_9`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_update_single_episode_collection | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `get_person_revisions_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 revision |  |
| revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| targetKind | string | 是 | — | 固定 person |  |
| targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |

### `CreatorRef`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| username | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 200 |  |
| nickname | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |

### `get_person_revision_versionsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| sourceKey | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| content | get_person_revision_versionsItem_content | 是 | — | 拒绝额外字段 |  |

### `VersionsPageMeta`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| total | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 20 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 20 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |

### `get_character_revisions_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 revision |  |
| revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| targetKind | string | 是 | — | 固定 character |  |
| targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |

### `get_character_revision_versionsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| sourceKey | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| content | get_character_revision_versionsItem_content | 是 | — | 拒绝额外字段 |  |

### `get_subject_revisions_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 revision |  |
| revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| targetKind | string | 是 | — | 固定 subject |  |
| targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |

### `get_subject_revision_versionsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| sourceKey | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| content | get_subject_revision_versionsItem_content | 是 | — | 拒绝额外字段 |  |

### `get_episode_revisions_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| entity | string | 是 | — | 固定 revision |  |
| revisionId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| revisionType | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| targetKind | string | 是 | — | 固定 episode |  |
| targetId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| creatorRef | CreatorRef / null | 是 | — | anyOf 2 个分支 |  |
| changeNote | string | 是 | — | 最短字符数 0；最长字符数 4000 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |

### `get_episode_revision_versionsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| sourceKey | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| content | get_episode_revision_versionsItem_content | 是 | — | 拒绝额外字段 |  |

### `create_index_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 index |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `create_index_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_create |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `create_index_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_create |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_10`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_create_index | 否 | — | 拒绝额外字段；条件：提供 submissionState；submissionState=acknowledged |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `update_index_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_update |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `update_index_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_update |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_11`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_update_index | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `get_index_subjects_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| subject | search_subjects_dataItem | 是 | — | 拒绝额外字段 |  |
| relationId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| order | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| comment | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 2000 |  |

### `add_subject_to_index_target`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 indexSubject |  |
| indexId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| relationId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |

### `add_subject_to_index_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_subject_add |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `add_subject_to_index_target_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 indexSubject |  |
| indexId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| relationId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `add_subject_to_index_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_subject_add |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_12`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_add_subject_to_index | 否 | — | 拒绝额外字段；条件：提供 submissionState；submissionState=acknowledged |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `update_index_subject_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_subject_update |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `update_index_subject_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_subject_update |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_13`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_update_index_subject | 否 | — | 拒绝额外字段；条件：提供 submissionState；submissionState=acknowledged |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `remove_subject_from_index_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_subject_remove |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `remove_subject_from_index_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | add_subject_to_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_subject_remove |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_14`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_remove_subject_from_index | 否 | — | 拒绝额外字段；条件：提供 submissionState；submissionState=acknowledged |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `collect_index_itemsItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| stage | string | 是 | — | 允许 index_collection |  |
| submissionState | string | 是 | — | 允许 acknowledged、rejected、unknown、not_attempted |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| rejection | SafeError_rejection | 是 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=rejected |
| rejection | 禁止 | 否 | — | 禁止 | else: 提供 submissionState；submissionState=rejected |

### `collect_index_itemsItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| target | create_index_target | 是 | — | 拒绝额外字段 |  |
| stage | string | 是 | — | 允许 index_collection |  |
| submissionState | string | 是 | — | 固定 acknowledged |  |

### `SafeError_15`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_collect_index | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `SafeError_16`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<ReadError_issuesItem> | 否 | — | 最多项 200 |  |
| submission | Receipt_uncollect_index | 否 | — | 拒绝额外字段 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `get_subject_comments_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| rating | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 10 |  |
| collectionStatus | integer / null | 是 | — | anyOf 2 个分支；integer：允许 1、2、3、4、5 |  |
| updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/[1-9]\d*/comments$ |  |
| content | get_subject_comments_dataItem_content / get_blog_details_content_2 / get_blog_details_content_3 | 否 | — | oneOf 3 个分支 |  |
| excerpt | get_subject_comments_dataItem_excerpt / null | 否 | — | anyOf 2 个分支 |  |

### `get_subject_comments_page`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| paginationSource | string | 是 | — | 固定 upstream |  |
| total | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 20 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 20 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |

### `get_subject_comments_dataItem_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| excerpt | get_subject_comments_dataItem_excerpt / null | 是 | — | anyOf 2 个分支 |  |

### `get_subject_comments_dataItem_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| excerpt | 禁止 | 否 | — | 禁止 |  |

### `get_subject_comments_dataItem_4`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| content | get_subject_comments_dataItem_content / get_blog_details_content_2 / get_blog_details_content_3 | 是 | — | oneOf 3 个分支 |  |

### `get_subject_comments_dataItem_5`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| content | 禁止 | 否 | — | 禁止 |  |

### `SafeError_17`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | string | 是 | — | 最短字符数 1；最长字符数 100 |  |
| message | string | 是 | — | 最长字符数 20000 |  |
| networkAttempted | boolean | 否 | — | 固定 false |  |
| issues | array<SafeError_issuesItem> | 否 | — | 最多项 200 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| rejection | SafeError_rejection | 否 | — | 拒绝额外字段 |  |
| sourceTool | string | 否 | — | 最短字符数 1；最长字符数 100 |  |
| diagnosis | SafeError_diagnosis | 否 | — | 拒绝额外字段 |  |
| recovery | SafeError_recovery | 否 | — | 拒绝额外字段 |  |

### `get_subject_reviews_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| relationId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| blogId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| title | string | 是 | — | 最长字符数 300 |  |
| author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| replyCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/blog/[1-9]\d*$ |  |
| excerpt | get_subject_comments_dataItem_excerpt / null | 否 | — | anyOf 2 个分支 |  |

### `get_blog_details_author`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| username | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |
| nickname | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |

### `get_blog_details_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| state | string | 是 | — | 固定 available |  |
| format | string | 是 | — | 固定 plain_text |  |
| contentRef | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^ct_[A-Za-z0-9_-]{32}$ |  |
| text | string | 是 | — | 最长字符数 5000 |  |
| range | get_blog_details_content_range | 是 | — | 拒绝额外字段 |  |
| isFullText | boolean | 是 | — | — |  |

### `get_blog_details_content_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| state | string | 是 | — | 固定 unavailable |  |
| reason | string | 是 | — | 允许 deleted、hidden、not_exposed、unknown |  |

### `get_blog_details_content_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| state | string | 是 | — | 固定 unsupported_shape |  |

### `get_blog_comments_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| blogId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| parentId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| rootId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/blog/[1-9]\d*$ |  |
| content | get_subject_comments_dataItem_content / get_blog_details_content_2 / get_blog_details_content_3 | 否 | — | oneOf 3 个分支 |  |
| excerpt | get_subject_comments_dataItem_excerpt / null | 否 | — | anyOf 2 个分支 |  |

### `get_blog_comments_page`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| paginationSource | string | 是 | — | 固定 host |  |
| total | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| limit | integer | 是 | — | ≥ 1；≤ 20 |  |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedCount | integer | 是 | — | ≥ 0；≤ 20 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| complete | boolean | 是 | — | — |  |
| snapshotRef | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^pg_[A-Za-z0-9_-]{32}$ |  |

### `get_subject_topics_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| topicId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| title | string | 是 | — | 最长字符数 300 |  |
| author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| updatedAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| replyCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/topic/[1-9]\d*$ |  |

### `get_subject_topic_replies_dataItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| topicId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| parentId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| rootId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| author | get_blog_details_author / null | 是 | — | anyOf 2 个分支 |  |
| createdAt | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 24；最长字符数 24；正则 ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ |  |
| url | string | 是 | — | 最长字符数 100；正则 ^https://bgm\.tv/subject/topic/[1-9]\d*$ |  |
| content | get_subject_comments_dataItem_content / get_blog_details_content_2 / get_blog_details_content_3 | 否 | — | oneOf 3 个分支 |  |
| excerpt | get_subject_comments_dataItem_excerpt / null | 否 | — | anyOf 2 个分支 |  |

### `read_community_content_source`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 subjectComment |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| commentId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `read_community_content_source_2`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 blog |  |
| blogId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `read_community_content_source_3`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 blogComment |  |
| blogId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| commentId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `read_community_content_source_4`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 topicPost |  |
| subjectId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| topicId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| postId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |

### `get_daily_broadcast_dataItem_weekday`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | integer | 是 | — | ≥ 1；≤ 7 |  |
| en | string | 否 | — | 最长字符数 100 |  |
| cn | string | 否 | — | 最长字符数 100 |  |
| ja | string | 否 | — | 最长字符数 100 |  |

### `get_daily_broadcast_dataItem_subjects`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | integer | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 page |  |
| entity | string | 是 | — | 固定 subject |  |
| data | array<search_subjects_dataItem> | 是 | — | 最多项 100 |  |
| page | search_subjects_page | 是 | — | 拒绝额外字段 |  |
| scope | object（本工具输入字段） | 是 | — | 拒绝额外字段 |  |
| visibility | string | 是 | — | 允许 public |  |
| readAt | string | 是 | — | 最长字符数 50 |  |

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

### `SafeError_issuesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| path | string | 是 | — | 最长字符数 300 |  |
| rule | string | 是 | — | 最长字符数 100 |  |
| hint | string | 是 | — | 最长字符数 3000 |  |
| allowed | array<string / number / boolean / null> | 否 | — | 最多项 100；元素：anyOf 4 个分支 |  |

### `SafeError_rejection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| kind | string | 是 | — | 固定 rate_limit |  |
| httpStatus | integer | 是 | — | 固定 429 |  |
| upstreamCode | string | 是 | — | 固定 RATE_LIMIT_EXCEEDED |  |
| retryAfterMs | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 86400000 |  |

### `SafeError_diagnosis`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| category | string | 是 | — | 允许 input、authentication、capability、transient、not_found、incomplete、cancelled、contract、other |  |
| stage | string | 是 | — | 允许 input、access、fetch、response_contract、execution |  |
| effect | string | 是 | — | 允许 read、write、unknown |  |
| blockedFields | array<string> | 是 | — | 最多项 8；元素不重复；元素：最长字符数 200 |  |
| allowedValues | array<SafeError_diagnosis_allowedValuesItem> | 是 | — | 最多项 8 |  |
| capabilitySuggestions | array<string> | 是 | — | 最多项 9；元素不重复；元素：允许 correct_parameters、use_public_sfw、use_account_source、relogin、inspect_permissions、narrow_scope、read_alternate_source、report_gap、stop |  |
| replanAllowed | boolean | 是 | — | — |  |
| retryable | boolean | 是 | — | — |  |

### `SafeError_recovery`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| stage | string | 是 | — | 固定 response_contract |  |
| retryable | boolean | 是 | — | 固定 false |  |

### `get_subject_details_infoboxItem_valueItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| k | string | 否 | — | 最长字符数 1000 |  |
| v | string | 是 | — | 最长字符数 20000 |  |

### `ReadError_issuesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| path | string | 是 | — | 最短字符数 0；最长字符数 300 |  |
| rule | string | 是 | — | 最短字符数 0；最长字符数 100 |  |
| hint | string | 是 | — | 最短字符数 0；最长字符数 3000 |  |
| allowed | array<string / number / boolean / null> | 否 | — | 最多项 100；元素：anyOf 4 个分支 |  |

### `get_character_details_infoboxItem_valueItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| k | string | 否 | — | 最短字符数 0；最长字符数 1000 |  |
| v | string | 是 | — | 最短字符数 0；最长字符数 20000 |  |

### `SubjectRef`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| entity | string | 是 | — | 固定 subject |  |
| id | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| name | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| subjectType | number / null | 是 | — | anyOf 2 个分支；number：允许 1、2、3、4、6 |  |
| url | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 2048；正则 ^https://[^\s]+$ |  |
| nsfw | boolean / null | 是 | — | anyOf 2 个分支 |  |

### `AppearanceRole`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| code | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| meaning | string | 是 | — | 允许 main、supporting、guest、unknown |  |
| label | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 300 |  |

### `Receipt_collect_character`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 collect_character |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_character_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_character_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 true |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_uncollect_character`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 uncollect_character |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_character_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_character_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 false |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `AppearanceSubjectFacts`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| airDate | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 50 |  |
| platform | string / null | 是 | — | anyOf 2 个分支；string：最长字符数 100 |  |
| form | string / null | 是 | — | anyOf 2 个分支；string：允许 tv、ova、movie、web、other |  |
| score | number / null | 是 | — | anyOf 2 个分支；number：≥ 0；≤ 10 |  |
| ratingCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `AppearanceOwnCollection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| state | string | 是 | — | 允许 collected、not_collected、unavailable |  |
| collectionStatus | integer / null | 是 | — | anyOf 2 个分支；integer：允许 1、2、3、4、5 |  |
| chapters | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| volumes | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `Receipt_collect_person`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 collect_person |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_person_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_person_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 true |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_uncollect_person`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 uncollect_person |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_person_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_person_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 false |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_update_subject_collection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 update_subject_collection |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_subject_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<update_subject_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type、rating、comment、tags、private、ep_status、vol_status |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_update_episode_collection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 update_episode_collection |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | get_subject_image_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<update_episode_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number | 是 | — | 允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_update_single_episode_collection`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 update_single_episode_collection |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | update_single_episode_collection_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<update_episode_collection_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collection_type、batch |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number | 是 | — | 允许 0、1、2、3 |  |
| affectedEpisodeIds | array<integer> | 否 | — | 最多项 2000；元素不重复；元素：≥ 1；≤ 9007199254740991 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `get_person_revision_versionsItem_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| summary | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| infoboxText | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| profession | array<get_person_revision_versionsItem_content_professionItem> / null | 是 | — | anyOf 2 个分支；array：最多项 7 |  |
| imageKey | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 1000 |  |

### `get_character_revision_versionsItem_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| summary | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| infoboxText | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| imageKey | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 1000 |  |

### `get_subject_revision_versionsItem_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| summary | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| infoboxText | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| episodeCount | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| sourceType | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| sourceTypeId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| platformCode | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| voteField | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 4000 |  |
| subjectId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |

### `get_episode_revision_versionsItem_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| name | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| nameCn | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 300 |  |
| description | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 10000 |  |
| episodeType | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3、4、5、6 |  |
| sort | number / null | 是 | — | anyOf 2 个分支 |  |
| mainSequence | number / null | 是 | — | anyOf 2 个分支 |  |
| airDate | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 50 |  |
| duration | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 100 |  |
| disc | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |
| subjectId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |

### `Receipt_create_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 create_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<create_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 title、description、private |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| createdId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| target | create_index_target | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |

### `Receipt_update_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 update_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<update_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 title、description、private |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_add_subject_to_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 add_subject_to_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<add_subject_to_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership、comment、order |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |

### `Receipt_update_index_subject`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 update_index_subject |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<update_index_subject_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership、comment、order |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |

### `Receipt_remove_subject_from_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 remove_subject_from_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | add_subject_to_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<remove_subject_from_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 membership |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean / null | 是 | — | anyOf 2 个分支 |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |
| relatedId | integer | 否 | — | ≥ 1；≤ 9007199254740991 | then: 提供 submissionState；submissionState=acknowledged |
| target | add_subject_to_index_target_2 | 否 | — | 拒绝额外字段 | then: 提供 submissionState；submissionState=acknowledged |

### `Receipt_collect_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 collect_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 true |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `Receipt_uncollect_index`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | — | 固定 1 |  |
| kind | string | 是 | — | 固定 submission |  |
| tool | string | 是 | — | 固定 uncollect_index |  |
| expectedAccountId | integer | 是 | — | ≥ 1；≤ 9007199254740991 |  |
| target | create_index_target / null | 是 | — | anyOf 2 个分支 |  |
| submissionState | string | 是 | — | 允许 acknowledged、partial、rejected、unknown、not_attempted |  |
| verification | string | 是 | — | 固定 pending |  |
| items | array<collect_index_itemsItem> | 是 | — | 最少项 1；最多项 201 |  |
| requestedFields | array<string> | 是 | — | 最多项 20；元素不重复；元素：允许 collected |  |
| createdId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| relatedId | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 1；≤ 9007199254740991 |  |
| requestedCollected | boolean | 是 | — | 固定 false |  |
| requestedEpisodeStatus | number / null | 是 | — | anyOf 2 个分支；number：允许 0、1、2、3 |  |
| accessContext | AccessContext | 否 | — | 见公共结构 |  |

### `get_subject_comments_dataItem_content`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| state | string | 是 | — | 固定 available |  |
| format | string | 是 | — | 固定 plain_text |  |
| contentRef | string | 是 | — | 最短字符数 35；最长字符数 35；正则 ^ct_[A-Za-z0-9_-]{32}$ |  |
| text | string | 是 | — | 最长字符数 500 |  |
| range | get_blog_details_content_range | 是 | — | 拒绝额外字段 |  |
| isFullText | boolean | 是 | — | — |  |

### `get_subject_comments_dataItem_excerpt`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| text | string | 是 | — | 最长字符数 300 |  |
| origin | string | 是 | — | 允许 upstream_summary、content_prefix |  |
| truncated | boolean | 是 | — | — |  |

### `get_blog_details_content_range`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| offset | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| returnedChars | integer | 是 | — | ≥ 0；≤ 5000 |  |
| totalChars | integer | 是 | — | ≥ 0；≤ 9007199254740991 |  |
| nextOffset | integer / null | 是 | — | anyOf 2 个分支；integer：≥ 0；≤ 9007199254740991 |  |

### `SafeError_diagnosis_allowedValuesItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| field | string | 是 | — | 最长字符数 200 |  |
| values | array<string / number / boolean / null> | 是 | — | 最多项 100；元素：anyOf 4 个分支 |  |

### `get_person_revision_versionsItem_content_professionItem`

| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| career | string | 是 | — | 允许 producer、mangaka、artist、seiyu、writer、illustrator、actor |  |
| value | string / null | 是 | — | anyOf 2 个分支；string：最短字符数 0；最长字符数 1000 |  |
