# bangumi 宿主：开发知识库

## 简介

当前 `feature/local` 使用官方 `bangumi/Archive` 的公共 SQLite 快照，并按账户保存独立个人收藏 SQLite。生产 MCP 目录恰好六个只读工具，使用 `data_scope=self` 查询本人条目收藏；没有向量检索、查询时 API 回退或账户内容写入能力。个人数据仅在 Web 启动时检查同步，或由显式宿主同步入口更新；用户查询不会触发同步。宿主保留原有独立登录、登出、登录元数据和界面设置，公共查询不依赖登录。Web 与终端 Pi 共用运行时、扩展、登录存储及六工具能力。现有 `bangumi/`、`web/`、`pi/` 目录与 Web 内容协议保留。

## 使用说明

- 文档用于定位，参数、行为和范围必须与当前源码交叉核实。
- README/readme 正文由用户维护，禁止修改；源码变化同步本文件及生成的 `mcp.md`。
- 改 `src/` 后必须重建：Web 和 MCP 子进程均读取 `dist`，前端 HMR 不代表宿主已经更新。
- 独立数据管理不需要模型：使用 `npm run data:init / data:import / data:update / data:status / data:verify / data:rollback`，参数写在 `--` 后。
- `--data-dir` 对数据命令表示 knowledge 根目录；应用启动参数中的 `--data-dir` 仍是原来的整个应用数据根目录。

## 规则

### 数据与执行边界

1. 公共资料来自官方 Archive；个人条目收藏由 `account-data/` 同步官方 p1 列表到独立数据库。公共资料查询不回退在线 API。`knowledge/dictionaries.ts` 是固定上游版本和摘要的官方 common 常量。
2. SQLite 完整事实留在本地；默认模型结果只有实体身份、资源引用和必要状态，其他字段必须通过 `fields` 或 `read_cached_resource` 请求。不能把完整 DTO、Wiki、向量或数据库内容自动放进模型上下文。
3. 查询值使用绑定参数；SQL 标识符与运算来自固定表。名称/别名和全文是文字检索，不声称向量语义召回。未知日期、零票评分、无排名、部分标签、坏边和解析失败必须如实表达。
4. 查询、缓存与展示绑定当前真实用户轮次、快照和本地内容显示范围；NSFW 是本地显示范围，不伪报在线账户权限。引用不能跨任务、跨版本或扩展成员。
5. 生产读取位于独立 MCP 进程，只读打开数据库；Archive 更新在独立更新进程执行，个人同步在独立 worker 线程执行，不能阻塞 Web/SSE。账户凭据不传入模型或本地 MCP，只传宿主绑定的账户、会话指纹和个人版本。
6. 更新只构建新快照，校验后原子切换 `current.json`。失败不改变当前指针；保留最近两代和具有活动 lease 的快照。回退前核对实际数据库摘要、数量与完整性。
7. 默认周三 08:00 Asia/Hong_Kong 检查；应用关闭时由下次启动补检，首次建库由显式数据命令完成。更新管理命令不登记成模型工具。
8. `pi/` 上游源码不在本次改造范围。Pi 模型网络与代理继续工作，不能把移除 Bangumi 数据 API 误做成禁用模型传输。
9. 不修改 `web/` 前端及 `src/web/` 现有接口和设置行为。Web 仅作为 Pi 的交互入口；后端能力通过共享宿主接入。原有登录与设置不因 MCP 只读而禁用，不把账户凭据注入本地 MCP 或模型上下文。

### 工具职责

| 工具 | 唯一职责 |
| --- | --- |
| query_entities | 名称、别名、全文、事实筛选、排序、分页 |
| get_entities | 按明确实体身份批量读取 |
| query_relations | 制作、出演、配音、作品关联、人物与角色关系 |
| aggregate_entities | 完整匹配范围内的分组与统计 |
| read_cached_resource | 已有资源的成员字段、长文本窗口与按需补读 |
| get_dataset_status | 当前/活动版本、导入质量与索引状态 |

六个业务工具直接声明；展示组件仍按需加载。两类工具分别计数，不把“六个数据工具”描述为模型全部工具只有六个。旧在线查询和账户业务适配源码可能为历史类型和既有 fixture 保留，但不得被生产 MCP 目录或恢复路径重新激活；宿主独立登录接口和三个登录命令继续保留。

### 个人数据同步与查询

- `createAccountDataCoordinator(...).sync({mode:'auto'|'full',signal?})` 是统一手动函数入口，后续 Web 按钮复用 launcher 的共享实例；`/bangumi-sync` 自动选择全量/增量，`/bangumi-sync full` 显式全量校准。它们不是 MCP 工具。
- 只有 Web 启动自动调用一次：未登录跳过，无库全量，有库增量。运行中查询、分页、展示、登录后和定时器都不自动发起同步；查询最多等待已经存在的启动/手动同步任务。
- 每个真实请求首次本人读取绑定本地账号/会话/个人版本，同轮固定，public 与 self 引用分开；缓存补读前后检查本地登录，换号/重新登录/登出使私人引用失效。
- 增量使用已成功游标减120秒重叠，完整分页后原子发布，失败不推进游标。`since`不能覆盖所有评分、标签、短评修改和取消收藏；空增量不代表线上全账户未变。全量缺席标记missing，不能作为确定未收藏。
- 默认仍只返回entity/id/resourceRef；个人字段通过fields和read_cached_resource按需读取。self仅关联本人数据，查询已收藏需filter.collection.membership=collected；个人平均分排除0分。关系过滤和去重在分页前完成。
- 个人字段只适用于subject。条目级epStatus/volStatus不证明逐集状态，ProgressView仍不可生成；可用DataTable显示条目进度、个人评分、标签与短评。Archive未收录的收藏保留最小hint，公共筛选资料缺失保持未知。

### 宿主展示与上下文

- `PresentationStore` 接收资源引用、成员、列和布局；经内部缓存 RPC 按组件所需字段批量补齐、复核并构建完整 Web props。模型回执只含发布状态，完整载荷不经模型复制。
- `output/component-data-profile.ts` 统一维护12组件的事实依赖、派生字段与当前来源能力；字段补读、组件构建和组件目录共同消费，不能另建互相漂移的字段清单。
- `ReplyAssembler` 是 canonical 回答来源。`final` 只是结束意图；真实整批调用成功且回合仍有效时，才保存 `bangumi/presentation_commit` 并结束。
- 缓存内部 RPC 使用互斥 `{resource}` / `{error}` 信封，业务错误、来源和版本错误不能包装成账户权限问题。
- `resourceRef` 只选择该引用窗口已核实成员；全量范围与当前页分开，超出容量需要分页，不静默删成员。
- `StatsCard` 只承接单作品评分分布，分组统计使用 `DataTable`。`ProgressView` 保留历史回放，当前公共查询不生成个人观看状态。缺图正常降级，不构造图床地址。
- 新评分卡保留Archive原评分；完整分布按10→1生成，各档比例为人数除以分布总票数。零票比例为0，缺失或部分分布不补零并降级列表。主评分、票数与统计口径由宿主生成。
- 卡片正常分页保留查询总数；明确选中成员时总数为选中数并说明原查询范围；多来源只统计实际展示成员，禁止相加各来源page.total。派生total/hint须随准备、组合、发布及历史完整保存。
- `output/response-style.ts` 统一管理用户可见回复规则；来源、快照、默认NSFW与缺图不作通用尾注。before/after可省略，影响结论的缺失、时效和分页范围仍须说明；格式追问不重复已有理由。卡片范围与评分提示由宿主精简生成，查询coverage/accessContext保留完整。
- 新local_*资源的ProgressView/CompareTable缺少所需来源时返回稳定业务不可用，不能反复换参补造个人状态或before/after；历史完整presentation优先按既有协议回放。
- 流式和历史都使用现有 Web 内容协议；前端不直接连接 SQLite，也不复制一套宿主协议。
- Web 提交按会话串行消费，等待当前 Pi 会话（含恢复、重试、压缩）静默后再触发下一条 input。轮次边界必须先于用户回显，且同一帧发布；agent_start 复用当前提交的回合，失败和无模型命令也需封口。排队阶段不写入当前回合，避免提前重置展示资源。
- 模型历史投影不改写 JSONL、trace 或 canonical 正文。签名绑定的调用/结果保持完整，不为缩短上下文生成畸形历史；纯展示回执及完整资料避免重复回灌。模型侧DataTable/InfoBox/Timeline历史摘要最多30行、单元240字符、单块文本预算12000字符，省略号计入预算并标明截断；原Web与会话保持完整。

### 验证与文档

- 按需 benchmark 入口为 `bench:smoke/query/relations/aggregate/components/resources/conversation/full/affected`；默认 6 例冒烟、每例 1 次。用 `--dry-run` 预览，支持作品类型、实体、组件交叉筛选；`--include-smoke` 仅补入的冒烟固定执行一次。全量和等义表达必须显式选择，未知影响路径不得静默忽略，token 预算缺失 usage 时停止后续调度；细则见 `BENCHMARK.md`。
- 用户要求避免大量新增回归测试文件，优先复用既有检查与 benchmark；仅为有意义的边界做集中验证。
- 离线固定样本、真实全量 Archive 无模型基准、真实模型加本地库、浏览器显示是不同证据层。
- 组件验收须逐项覆盖12种组件的字段或明确降级；页面提示词集中在benchmarks/local-component-page-cases.json，实际页面结果与SQL oracle核对。当前10种组件可生成（部分缺图降级），ProgressView/CompareTable验收诚实不可用与替代，不能把替代组件记作原组件已渲染。
- 冻结源码、产物、目录 Schema 和实际 SQLite SHA-256；源码/产物/数据漂移的结果不能作正式对照。
- 冷连接、初始化加首次有效查询、暖连接新轮次分别统计；磁盘缓存未受控时明确记录。模型耗时与数据库耗时不能混加或互相替代。
- MCP 文档通过 `scripts/sync-mcp-doc.mjs` 同步，仅声明字段、类型、必填、默认与约束，不写完整 Schema、示例 JSON 或执行流程。

## 索引

| 场景 | 文件 |
| --- | --- |
| 应用启动、数据目录、后台更新生命周期 | `src/launcher.ts`、`src/knowledge/scheduler.ts` |
| Pi 原生运行、模型历史投影、回答完成 | `src/pi-host.ts`、`src/output/model-context.ts`、`src/output/reply-assembler.ts` |
| 六工具与受限 Skill/展示注册 | `src/extension.ts` |
| Archive ZIP/JSONL 流式导入与质量隔离 | `src/knowledge/archive.ts` |
| SQLite 表和中日文全文预分词 | `src/knowledge/schema.ts` |
| 快照、lease、原子指针、互斥锁 | `src/knowledge/store.ts` |
| 下载、校验、周更时间、完整验证、回退 | `src/knowledge/update.ts`、`src/knowledge/cli.ts` |
| Wiki 与固定官方常量 | `src/knowledge/wiki.ts`、`src/knowledge/dictionaries.ts` |
| 查询、关联、聚合、字段补齐 | `src/knowledge/query.ts` |
| 输入输出与字段白名单 | `src/mcp/catalog.ts`、`src/mcp/local-contract.ts` |
| 本地服务、stdio、缓存与任务上下文 | `src/mcp/service.ts`、`src/mcp/server.ts`、`src/mcp/client.ts`、`src/mcp/resource-contract.ts`、`src/mcp/read-context.ts` |
| 模型投影与字段策略 | `src/mcp/model-projection.ts`、`src/mcp/resource-policy.ts` |
| 组件加载、批量补齐、原子发布 | `src/output/component-catalog.ts`、`src/output/presentation-store.ts`、`src/output/presentation-tools.ts`、`src/output/resource-content.ts` |
| 12组件统一数据依赖、派生与能力 | `src/output/component-data-profile.ts` |
| 用户可见回复风格与按需范围说明 | `src/output/response-style.ts` |
| Web 现有登录、设置和交互协议（保持原样） | `src/web/session.ts`、`src/web/tool-view.ts`、`src/web/server.ts` |
| 个人数据全量/增量、版本与共享手动入口 | `src/account-data/sync.ts`、`store.ts`、`coordinator.ts`、`index.ts` |
| 真实库无模型性能基准 | `src/benchmark/local.ts`，CLI `local` 子命令 |
| 真实模型 + 本地数据基准 | `src/benchmark/cli.ts`、`worker.ts`、`fixture-server.ts`；`benchmarks/local-archive-cases.json` |
| 基准口径和报告 | `BENCHMARK.md`、`src/benchmark/report.ts` |

| 检查 | 命令 |
| --- | --- |
| 宿主和前端类型 | `npm run typecheck` |
| 宿主和 Skills 产物 | `npm run build:bench` |
| 完整宿主与前端 | `npm run build` |
| 同步字段文档 | `node scripts/sync-mcp-doc.mjs`，然后 `--check` |
| 真实本地库性能 | `node dist/src/benchmark/cli.js local --knowledge-dir <knowledge根> --repeats 10 --out <新目录>` |
| 真实模型 | `node dist/src/benchmark/cli.js run --mode local-archive --knowledge-dir <knowledge根> --model <provider/model> --suite core --repeats 2 --out <新目录>` |
