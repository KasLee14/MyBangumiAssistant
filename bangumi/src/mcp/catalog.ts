import { AppError, SchemaInputError, type InputIssue } from '../support/errors.js';
import { compileSchema, inputIssue, schemaArguments, selectedSchema, type JsonSchema } from '../support/tool-schema.js';
import { SUBJECT_INCLUDES, subjectOutputSchema } from './subject-output.js';
import { RESOURCE_INPUT_SCHEMAS, resourceOutputSchema } from './resource-schemas.js';
import { collectionQuerySchema } from './collection-query.js';
import { withAccessContext } from './access-context.js';
import { COMMUNITY_TOOL_DEFINITIONS, communityOutputSchema } from './community-schemas.js';
import { candidateFieldsSchema, candidateFilterSchema, candidateValueSchema,
  candidateOutputSchema, refineCandidateInputSchema, validateCandidateFilter, PERSONAL_CANDIDATE_FIELDS, type CandidateFilter,
  candidateCoverageInputSchema, candidateCoverageOutputSchema, candidateResponseViewSchema } from './candidate-contract.js';
import { relationInputSchema, relationOutputSchema, validateRelationArguments, type RelationQueryArgs,
  candidateLineageInputSchema, candidateLineageOutputSchema } from './relation-contract.js';
import { continueSubjectQueryInputSchema, continueSubjectQueryOutputSchema } from './continuation-contract.js';
import { candidateOutputInputSchema, candidateOutputOutputSchema } from './candidate-output-contract.js';
import { personCandidateValueSchema } from './person-candidates.js';

/** 保留原55项固定工具，另登记收藏范围查询及社区只读能力；输入输出由双端锁定。 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  access: 'public' | 'account';
  effect: 'read' | 'write';
}
type Schema = Record<string, unknown>;
const int = (minimum: number, maximum = Number.MAX_SAFE_INTEGER, extra: Schema = {}): Schema => ({ type: 'integer', minimum, maximum, ...extra });
const text = (maxLength: number, minLength = 0, extra: Schema = {}): Schema => ({ type: 'string', minLength, maxLength, ...extra });
const enumeration = (values: readonly unknown[], type = 'integer', extra: Schema = {}): Schema => ({ type, enum: values, ...extra });
const id = int(1); const counter = int(0); const boolean: Schema = { type: 'boolean' };
const subjectType = enumeration([1, 2, 3, 4, 6], 'integer', { description: '媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。' }); const collectionType = enumeration([1, 2, 3, 4, 5], 'integer', { description: '1想看、2看过/已完成、3在看、4搁置、5抛弃；明确看过必须用2，不以章节进度替代整部状态。' });
const episodeType = enumeration([0, 1, 2, 3, 4, 5, 6]); const episodeCollection = enumeration([0, 1, 2, 3], 'integer', { default: 2 });
const page = { limit: int(1, 100, { default: 30 }), offset: int(0, 10000, { default: 0 }) };
const relationPage = { ...page, limit: int(1, 100, { default: 20 }) };
const username = text(100, 1, { description: '本人完整收藏用 -；显式用户名仅查询该用户公开范围，登录后按当前账户权限读取。', pattern: '^(?:-|[A-Za-z0-9_]+)$' });
const image = enumeration(['large', 'medium', 'small', 'grid'], 'string', { default: 'large' });
const own = { ...boolean, description: '需要本人私有目录或收藏现状时设 true，使用本应用账户会话。', default: false };
const nsfwScope = enumeration(['account', 'exclude'], 'string', { description: '省略或exclude优先公共v0/SFW；account明确补充账户可见NSFW。缺少权限时可继续公共SFW并说明覆盖缺口，不能将有限结果称为全站完整。' });
const definitions: McpToolDefinition[] = [];
function tool(name: string, description: string, properties: Record<string, Schema> = {}, required: string[] = [], effect: 'read' | 'write' = 'read', access: 'public' | 'account' = 'public'): void {
  definitions.push({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, effect, access });
}
tool('get_daily_broadcast', '获取按星期组织的公开放送日历，每天分别分页并标明完整性；它是周计划，不能据此声称今天某集已播出。', relationPage);
const range = (type: 'number' | 'integer', minimum: number, maximum: number): Schema => ({ type: 'object',
  properties: { min: { type, minimum, maximum }, max: { type, minimum, maximum } }, minProperties: 1, additionalProperties: false,
  description: '包含上下界；min不能大于max。省略的一侧不限制。' });
const tags: Schema = { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: text(100, 1, { pattern: '^\\S(?:[\\s\\S]*\\S)?$' }),
  description: '显式标签筛选，多标签为且；不等于标题关键词命中或题材主线证明。' };
const dateRange: Schema = { type: 'object', properties: { min: text(10, 10, { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), max: text(10, 10, { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) },
  minProperties: 1, additionalProperties: false, description: '实际YYYY-MM-DD日期，含上下界；min不能晚于max。' };
tool('search_subjects', '搜索五类作品。keyword仅作文字检索，题材用filter.tag/meta_tags、评分范围用filter.rating；不同条件为且。默认公共v0/SFW，明确需要NSFW时filter.nsfw=account补充账户源，日期、小数评分、评分人数等不可靠组合报能力不足。可保留硬条件继续SFW并说明缺口。总数为估计，page.complete只表示源内分页耗尽，完整覆盖须结合accessContext.queryCoverage。sort只改变排序。', {
  keyword: text(300, 0, { description: '文字关键词，不是标签条件；只按结构化filter筛选时填空字符串，不能用拼接题材词替代filter。空关键词必须提供有效filter。' }), subject_type: subjectType,
  filter: { type: 'object', properties: { tag: tags, meta_tags: { ...tags, description: '网站公共标签，多值为且，可用-标签排除。' }, rating: range('number', 0, 10),
    rating_count: range('integer', 0, Number.MAX_SAFE_INTEGER), rank: range('integer', 1, Number.MAX_SAFE_INTEGER), air_date: dateRange, nsfw: nsfwScope },
    minProperties: 1, additionalProperties: false },
  sort: enumeration(['match', 'heat', 'rank', 'score'], 'string', { default: 'match', description: 'match匹配、heat收藏人数、rank排名、score评分；不按基准分差排序。' }), ...page }, ['keyword']);
export const BROWSE_CATEGORIES: Readonly<Record<number, readonly number[]>> = {
  1: [0, 1001, 1002, 1003], 2: [0, 1, 2, 3, 5], 3: [0], 4: [0, 4001, 4002, 4003, 4005], 6: [0, 1, 2, 3, 6001, 6002, 6003, 6004],
};
const categoryDescriptions: Record<number, string> = { 1: '书籍：0其他、1001漫画、1002小说、1003画集。',
  2: '动画形式：0其他、1TV、2OVA、3Movie、5WEB；恋爱/百合等题材使用search_subjects的filter。',
  3: '音乐仅0其他。', 4: '游戏：0其他、4001游戏、4002软件、4003扩展包、4005桌游。',
  6: '三次元：0其他、1日剧、2欧美剧、3华语剧、6001电视剧、6002电影、6003演出、6004综艺。' };
const browseCommon = { sort: enumeration(['date', 'rank'], 'string'), year: int(1800, 2200), month: int(1, 12), nsfw: nsfwScope, ...page };
tool('browse_subjects', '按媒体、作品形式、日期浏览；cat不是题材标签。年月按dateEvidence精度核实，date缺失时可用固定infobox日期字段，不补造具体日。日期筛选证据不足的条目列入filterCoverage.unknownDateSubjectIds；complete仅表示当前来源窗口日期核实无缺口，不代表全站完整。按page.nextOffset续页，不能按过滤后条数推进。默认公共SFW，浏览源不覆盖R18；显式nsfw=account也保留SFW结果并报告缺口，补充NSFW须选支持账户范围的来源。sort=date日期、rank排名，与搜索排序枚举不同。未指定TV时不自动添加cat=1。返回覆盖限制见accessContext.queryCoverage。series仅书籍可提供（false也一样），platform仅游戏可提供。标签和评分条件使用search_subjects。', {
  subject_type: subjectType, cat: enumeration([...new Set(Object.values(BROWSE_CATEGORIES).flat())]),
  series: { ...boolean, description: '仅书籍；其他媒体必须省略，包括false。' }, platform: text(100, 1, { description: '仅游戏平台；动画TV/OVA用cat，不能传platform。' }), ...browseCommon }, ['subject_type']);
const browse = definitions.at(-1)!;
browse.inputSchema.oneOf = Object.entries(BROWSE_CATEGORIES).map(([type, categories]) => ({ type: 'object', properties: {
  subject_type: { type: 'integer', const: Number(type) }, cat: enumeration(categories, 'integer', { description: categoryDescriptions[Number(type)] }), ...browseCommon,
  ...(type === '1' ? { series: boolean } : {}), ...(type === '4' ? { platform: text(100, 1) } : {}),
}, required: ['subject_type'], additionalProperties: false }));
tool('get_subject_details', '读取作品基本资料；默认include=[summary]取得简介，include=[]只取基本字段。infobox/tagStats/ratingDistribution按需显式请求；列表不带简介，标签只代表接口实际提供的线索。', { subject_id: id,
  include: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...SUBJECT_INCLUDES] }, default: ['summary'] },
}, ['subject_id']);
tool('get_subject_image', '取得作品图片地址。', { subject_id: id, image_type: enumeration(['large', 'common', 'medium', 'small', 'grid'], 'string', { default: 'large' }) }, ['subject_id']);
for (const [suffix, desc] of [['persons', '制作人员'], ['characters', '角色'], ['relations', '关联作品及关系']] as const) tool(`get_subject_${suffix}`, `分页查询作品的${desc}，返回本页和真实总数。`, { subject_id: id, ...relationPage }, ['subject_id']);
tool('get_episodes', '分页读取公开章节；放送日期不表示个人观看状态。', { subject_id: id, episode_type: episodeType, ...page, limit: int(1, 100, { default: 100 }) }, ['subject_id']);
tool('get_episode_details', '获取公开章节详情和所属作品。', { episode_id: id }, ['episode_id']);
tool('search_characters', '搜索角色，返回结构化分页结果。', { keyword: text(300, 1), ...page, nsfw_filter: boolean }, ['keyword']);
tool('search_persons', '搜索人物或组织，支持职业筛选。', { keyword: text(300, 1), ...page, career_filter: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: enumeration(['producer', 'mangaka', 'artist', 'seiyu', 'writer', 'illustrator', 'actor'], 'string') } }, ['keyword']);
for (const [entity, plural, relationships] of [['character', 'characters', ['subjects', 'persons']], ['person', 'persons', ['subjects', 'characters']]] as const) {
  tool(`get_${entity}_details`, `获取${entity === 'character' ? '角色' : '人物'}详情。`, { [`${entity}_id`]: id }, [`${entity}_id`]);
  tool(`get_${entity}_image`, '获取图片地址。', { [`${entity}_id`]: id, image_type: image }, [`${entity}_id`]);
  for (const relation of relationships) tool(`get_${entity}_${relation}`, '分页查询结构化关联资料，返回本页和真实总数。', { [`${entity}_id`]: id, ...relationPage }, [`${entity}_id`]);
  for (const verb of ['collect', 'uncollect']) tool(`${verb}_${entity}`, `${verb === 'collect' ? '新增' : '删除'}当前账户的${entity === 'character' ? '角色' : '人物'}收藏；宿主授权和独立回读必需。`, { [`${entity}_id`]: id }, [`${entity}_id`], 'write', 'account');
  tool(`get_user_${entity}_collections`, `读取用户${entity === 'character' ? '角色' : '人物'}收藏；本人按完整分页读取并核实账户。`, { username, ...page }, ['username']);
  tool(`get_user_${entity}_collection`, '查询指定收藏，未收藏返回 null。', { username, [`${entity}_id`]: id }, ['username', `${entity}_id`]);
  void plural;
}
tool('get_user_info', '获取用户公开资料，- 为本应用当前账户。', { username }, ['username']);
tool('get_user_avatar', '取得用户头像地址。', { username, avatar_type: enumeration(['large', 'medium', 'small'], 'string', { default: 'large' }) }, ['username']);
tool('get_current_user', '在线核实当前账户；check_nsfw默认false，仅用户明确要求检查NSFW状态时设true核实显示偏好和实际权限。accessContext.nsfw.state为enabled/disabled/unknown/not_checked，preference与allowed分别报告，不能由条目标签或404猜测开关。', { check_nsfw: { ...boolean, default: false } }, [], 'read', 'account');
tool('get_user_collections', '分页读取用户作品收藏；本人支持私密记录，其他账户仅公开记录。明确看过传collection_type=2；开播日期范围或完整整理优先query_user_collections，不能把收藏更新时间当开播日期。', { username, subject_type: subjectType, collection_type: collectionType, ...page }, ['username']);
tool('query_user_collections', '按账户和媒体采集连续收藏快照。后续需要多状态核对或排除时，省略collection_type取得全状态来源，再用filter.collection_types筛选当前层；仅需单状态最终列表时可用collection_type。候选模式用reference和必要fields，collectionRef复用完整收藏证据，resultRef为本层匹配集合。collection_ref冻结原来源状态范围，不能扩为其他状态，窄范围缺席不证明未收藏。日期筛选用开播日期，extra_subject_ids只保留用户明确补入的作品。本人覆盖私密记录，第三方仅公开；coverage.complete针对实际可见范围。', {
  username, subject_type: subjectType, collection_type: collectionType, air_date: dateRange,
  sort: enumeration(['date_desc', 'date_asc'], 'string', { default: 'date_desc' }),
  extra_subject_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: id, default: [] },
}, ['username', 'subject_type', 'air_date']);
tool('get_user_subject_collection', '查询用户指定作品收藏；本人读取单条p1快照，明确未收藏返回 null，缺个人字段拒绝推断。', { username, subject_id: id }, ['username', 'subject_id']);
tool('update_subject_collection', '修改本账户收藏指定字段，保留其他字段；不会自动把所有章节标为看过。ep_status/vol_status仅支持已收藏书籍；动画和三次元通过章节工具修改并回读派生已看集数，不能额外写ep_status。', { subject_id: id, collection_type: collectionType, rating: int(0, 10), comment: text(2000), tags: { type: 'array', maxItems: 40, uniqueItems: true, items: text(100, 1, { pattern: '^\\S+$' }) }, private: boolean,
  ep_status: { ...counter, description: '仅已收藏书籍的已读章数；禁止用于动画/三次元已看集数。' }, vol_status: { ...counter, description: '仅已收藏书籍的已读卷数。' } }, ['subject_id'], 'write', 'account');
tool('get_user_episode_collection', '分页读取当前账户指定作品章节及个人状态。', { subject_id: id, episode_type: episodeType, ...page, limit: int(1, 100, { default: 100 }) }, ['subject_id'], 'read', 'account');
tool('update_episode_collection', '逐项修改本账户章节状态；先完整验证所属作品，结果提交后宿主独立回读。', { subject_id: id, episode_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id }, collection_type: episodeCollection }, ['subject_id', 'episode_ids'], 'write', 'account');
tool('get_single_episode_collection', '读取当前账户单章节状态；未收藏为 0，保留所属作品ID。', { episode_id: id }, ['episode_id'], 'read', 'account');
tool('update_single_episode_collection', 'batch省略或false只修改目标集状态；batch=true为官方“看到此集”，一次请求补齐同作品sort不大于目标的所有正篇为看过，禁止同时传collection_type。不回退后续已看状态；宿主核实完整范围、预览及独立回读。', { episode_id: id, collection_type: episodeCollection, batch: boolean }, ['episode_id'], 'write', 'account');
definitions.at(-1)!.inputSchema = { type: 'object', oneOf: [
  { type: 'object', properties: { episode_id: id, collection_type: episodeCollection, batch: { type: 'boolean', const: false } }, required: ['episode_id'], additionalProperties: false },
  { type: 'object', properties: { episode_id: id, batch: { type: 'boolean', const: true, description: '官方看到此集；自动补齐前序正篇。' } }, required: ['episode_id', 'batch'], additionalProperties: false },
] };
for (const entity of ['person', 'character', 'subject', 'episode']) {
  tool(`get_${entity}_revisions`, '分页查询公开编辑历史。', { [`${entity}_id`]: id, ...page }, [`${entity}_id`]);
  tool(`get_${entity}_revision`, '获取一条公开编辑历史详情。', { revision_id: id }, ['revision_id']);
}
tool('create_index', '创建本账户目录，返回新目录ID；超时不会重发。', { title: text(80, 1), description: text(10000), private: boolean }, ['title', 'description'], 'write', 'account');
tool('get_index', '读取目录详情；own=true 包含本人可见完整字段及是否收藏。', { index_id: id, own }, ['index_id']);
tool('update_index', '修改本账户拥有的目录指定字段，保留未请求字段。', { index_id: id, title: text(80, 1), description: text(10000), private: boolean }, ['index_id'], 'write', 'account');
tool('get_index_subjects', '分页读取目录作品；own=true 使用本人会话并返回关系ID、顺序及短评。', { index_id: id, subject_type: subjectType, ...page, own }, ['index_id']);
tool('add_subject_to_index', '向本账户目录加入作品。', { index_id: id, subject_id: id, comment: text(2000), order: int(0, 1000000) }, ['index_id', 'subject_id'], 'write', 'account');
tool('update_index_subject', '修改本账户目录中作品的短评或顺序，保留另一字段。', { index_id: id, subject_id: id, comment: text(2000), order: int(0, 1000000) }, ['index_id', 'subject_id'], 'write', 'account');
tool('remove_subject_from_index', '从本账户拥有的目录移除指定作品。', { index_id: id, subject_id: id }, ['index_id', 'subject_id'], 'write', 'account');
tool('collect_index', '收藏目录。', { index_id: id }, ['index_id'], 'write', 'account');
tool('uncollect_index', '取消目录收藏。', { index_id: id }, ['index_id'], 'write', 'account');
if (definitions.length !== 56) throw new Error('Bangumi MCP 基础能力目录数量错误。');
const candidateMode: Schema = { type: 'string', enum: ['legacy', 'candidates'], description: 'candidates启用召回与筛选漏斗，返回精简字段及候选集合引用；省略保持旧契约。' };
for (const definition of definitions.filter(item => ['search_subjects', 'browse_subjects', 'get_user_collections', 'query_user_collections'].includes(item.name))) {
  if (RESOURCE_INPUT_SCHEMAS[definition.name]) definition.inputSchema = structuredClone(RESOURCE_INPUT_SCHEMAS[definition.name]!);
  const properties = definition.inputSchema.properties as Record<string, Schema>;
  properties.result_mode = candidateMode;
  const { default: _fieldsDefault, ...projectionFields } = candidateFieldsSchema;
  const { default: _responseDefault, ...responseView } = candidateResponseViewSchema;
  properties.response_view = responseView;
    properties.fields = projectionFields;
    properties.fields.description = '仅候选模式可提供；省略为id/name/nameCn/subjectType，只投影已取得字段；缺失字段后续refine补取。';
    if (['search_subjects', 'browse_subjects'].includes(definition.name)) {
      properties.fields.items = { ...(properties.fields.items as Schema), enum: ((properties.fields.items as Schema).enum as string[]).filter(field => !PERSONAL_CANDIDATE_FIELDS.includes(field as never)) };
    }
    if (definition.name === 'get_user_collections') properties.offset = int(0, Number.MAX_SAFE_INTEGER, { default: 0 });
  if (['search_subjects', 'browse_subjects', 'get_user_collections'].includes(definition.name)) properties.merge_ref = text(100, 1, { description: '同读取任务中已有候选集合；分支合并按作品ID去重并复用事实。' });
  if (definition.name === 'query_user_collections') {
    properties.filter = candidateFilterSchema;
    properties.source_limit = int(1, 10000, { description: '候选模式省略100；本次宿主扫描的来源条数预算，按100条整页读取，可续读累计超过一万条；不是匹配数或候选总量限制。' });
    properties.collection_ref = text(100, 1, { description: '续读已取得的同账户同范围收藏快照。' });
    properties.sort = enumeration(['source', 'date_desc', 'date_asc'], 'string', { description: '候选模式省略保持来源顺序；日期排序仅针对当前已读来源范围。旧日期模式默认date_desc。' });
    properties.limit = int(1, 100, { default: 30 });
    definition.inputSchema.required = ['username', 'subject_type'];
    definition.inputSchema.allOf = [{ if: { properties: { result_mode: { const: 'candidates' } }, required: ['result_mode'] },
      then: {}, else: { properties: { air_date: dateRange }, required: ['air_date'] } }];
  }
  // 浏览按媒体采用闭合oneOf分支；投影能力须加到每个分支，媒体本身约束仍由原分支执行。
  if (definition.name === 'browse_subjects') for (const branch of definition.inputSchema.oneOf as Schema[] ?? []) {
    branch.properties = { ...(branch.properties as Record<string, Schema>),
      ...Object.fromEntries(['result_mode', 'response_view', 'fields', 'merge_ref'].map(key => [key, properties[key]])) };
  }
  definition.description += '。推荐与组合检索使用result_mode=candidates，fields只返回必要字段，后续用refine_subject_candidates按已有ID筛选并补缺，不把原始列表搬入模型。';
}
definitions.push({ name: 'refine_subject_candidates', description: '筛选已有作品候选或读取更多字段。filter执行事实条件，fields从缓存或固定资源补取并只返回所需资料；未知条件保留pending。collection_ref可复用收藏证据，filter.subject_ids可选择本集合成员。分页用continue_subject_query。', inputSchema: refineCandidateInputSchema, access: 'public', effect: 'read' });
definitions.push({ name: 'expand_subject_relations', description: '从父候选批量展开关联作品；parent_filter筛父，filter筛目标，按作品ID去重并保留父边。fields读取目标的必要资料，分页用continue_subject_query。', inputSchema: relationInputSchema, access: 'public', effect: 'read' });
definitions.push({ name: 'get_candidate_coverage', description: '按coverage_ref分页读取候选来源覆盖明细；常规续查使用工具默认紧凑摘要，只有追查具体缺口时取明细。引用仅当前读取任务有效。', inputSchema: candidateCoverageInputSchema, access: 'public', effect: 'read' });
definitions.push({ name: 'get_candidate_lineage', description: '按候选引用分页读取关联作品的已核实直接父边及缓存名称；subject_ids可限定需要回溯的本集合成员。多跳每次只回溯当前一跳，原始关系图留在宿主。', inputSchema: candidateLineageInputSchema, access: 'public', effect: 'read' });
definitions.push({ name: 'continue_subject_query', description: '以候选引用和page.nextCursor继续原查询；宿主恢复条件与字段，可调整视图和窗口大小。实际候选结果在result内。', inputSchema: continueSubjectQueryInputSchema, access: 'public', effect: 'read' });
definitions.push({ name: 'prepare_candidate_output', description: '可选的缓存结果展示工具，生成合法表格或作品卡片presentation；不取网络资料。超过单次容量时返回分页位置，可继续交付同一结果集合。', inputSchema: candidateOutputInputSchema, access: 'public', effect: 'read' });
definitions.push(...COMMUNITY_TOOL_DEFINITIONS);
for (const definition of definitions) {
  if (RESOURCE_INPUT_SCHEMAS[definition.name] && definition.name !== 'browse_subjects') definition.inputSchema = structuredClone(RESOURCE_INPUT_SCHEMAS[definition.name]!);
  if (definition.name === 'get_person_characters') {
    const properties = definition.inputSchema.properties as Record<string, Schema>;
    properties.result_mode = candidateMode;
    const { default: _personFieldDefault, ...personFields } = candidateFieldsSchema;
    const { default: _personViewDefault, ...personView } = candidateResponseViewSchema;
    properties.fields = personFields; properties.response_view = personView;
    properties.merge_ref = text(100, 1, { description: '候选模式同轮上一阶段引用，配合snapshot_ref和准确offset续读；按作品ID合并，不重取来源。' });
    definition.inputSchema.allOf = [...(definition.inputSchema.allOf as Schema[] ?? []), {
      if: { properties: { result_mode: { const: 'candidates' } }, required: ['result_mode'] },
      then: { not: { type: 'object', properties: { include: {} }, required: ['include'] } },
    }];
  }
  if (definition.name === 'get_person_characters') definition.description = '分页查询人物的角色及出演作品。可按subject_type、appearance_role及动画subject_form筛选，宿主完成关联读取和筛选；include按需附带subjectFacts或本人ownCollection。subject_form须subject_type=2，并自动附带subjectFacts作为形式证据。增强查询续页保持相同参数并传page.snapshotRef，coverage.complete报告全源覆盖和资料缺口，page.complete仅指本页覆盖所有匹配关系；同一作品可能对应多个角色，按subject.id汇总。sourceTypeCode因源而异，主角/配角只看appearanceRole.meaning；制作职务查询使用get_person_subjects。';
  if (definition.name === 'get_person_characters') definition.description += '。候选模式只用fields选择资料，不提供include；宿主按作品去重，sourcePage.nextOffset与appearanceStage.snapshotRef用于续来源，resultRef可继续筛选或读取字段。';
  if (definition.name === 'get_character_persons') definition.description = '分页查询角色的声优及作品关系。角色/人物实体type与出演关系独立；主角/配角只看appearanceRole.meaning，不能使用sourceTypeCode判断。';
  if ((definition.inputSchema.properties as Record<string, Schema> | undefined)?.username) (definition.inputSchema.properties as Record<string, Schema>).username!.description = username.description;
  const subjectOutput = subjectOutputSchema(definition.name, definition.inputSchema);
  let output = definition.name === 'refine_subject_candidates' ? candidateOutputSchema(definition.inputSchema)
    : definition.name === 'expand_subject_relations' ? relationOutputSchema()
    : definition.name === 'get_candidate_coverage' ? candidateCoverageOutputSchema
    : definition.name === 'get_candidate_lineage' ? candidateLineageOutputSchema
    : definition.name === 'continue_subject_query' ? continueSubjectQueryOutputSchema
    : definition.name === 'prepare_candidate_output' ? candidateOutputOutputSchema
    : definition.name === 'query_user_collections' ? withAccessContext(collectionQuerySchema(definition.inputSchema)) : communityOutputSchema(definition.name) ?? subjectOutput ?? resourceOutputSchema(definition.name);
  if (output && ['search_subjects', 'browse_subjects', 'get_user_collections', 'query_user_collections', 'get_person_characters'].includes(definition.name)) {
    output = structuredClone(output);
    (output.oneOf as Schema[]).splice(1, 0, { type: 'object', properties: { value: definition.name === 'get_person_characters'
      ? personCandidateValueSchema(definition.inputSchema) : candidateValueSchema(definition.inputSchema) }, required: ['value'], additionalProperties: false });
  }
  if (output) {
    definition.outputSchema = output;
    compileSchema(output);
    if (subjectOutput && definition.name !== 'get_subject_details') definition.description += '。返回统一作品摘要和真实分页，不附简介/infobox/图片；名称、日期、评分及实际标签名可直接使用，介绍需调用作品详情。';
    if (!subjectOutput && definition.effect === 'read' && !communityOutputSchema(definition.name)
      && !['refine_subject_candidates', 'expand_subject_relations', 'get_candidate_coverage', 'get_candidate_lineage', 'continue_subject_query', 'prepare_candidate_output'].includes(definition.name))
      definition.description += '。返回固定白名单资料，列表不附简介或全部图片；详情通过include固定字段组按需读取。个人现状保持完整，公开不可见不表示未收藏。';
    if (definition.effect === 'write') definition.description += '。返回逐目标/阶段提交回执，verification=pending不表示持久化成功；最终结果仍由宿主独立回读核实，不自动重发。';
  }
  if (definition.effect === 'read' && !communityOutputSchema(definition.name)) definition.description += '。按本次来源需求核实账户或NSFW，公共SFW读取不要求登录；accessContext报告实际权限核实范围与数据来源。';
}
export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = definitions;
export function findToolDefinition(name: string): McpToolDefinition {
  const definition = TOOL_DEFINITIONS.find(item => item.name === name);
  if (!definition) throw new AppError('UNKNOWN_TOOL', '未登记的 Bangumi MCP 工具。');
  return definition;
}

// 在启动时编译固定目录，schema写错立即失败；不依赖模型或SDK自动验证。
for (const definition of definitions) {
  compileSchema(definition.inputSchema);
  for (const branch of definition.inputSchema.oneOf as JsonSchema[] ?? []) compileSchema(branch);
}
export function validateToolArguments(name: string, value: unknown): Record<string, unknown> {
  const definition = findToolDefinition(name);
  const output = schemaArguments(definition.inputSchema, value);
  const active = selectedSchema(definition.inputSchema, output);
  const issues: InputIssue[] = [];
  for (const key of ['keyword', 'title', 'platform']) if (typeof output[key] === 'string' && !(output[key] as string).trim()
    && !(name === 'search_subjects' && key === 'keyword' && output.keyword === '' && output.filter !== undefined)) issues.push(inputIssue(active, `/${key}`, 'blank')!);
  if (name === 'search_subjects' && output.filter) {
    const filter = output.filter as Record<string, Record<string, unknown>>;
    for (const key of ['rating', 'rating_count', 'rank', 'air_date']) {
      const bounds = filter[key]; if (!bounds) continue;
      if (key === 'air_date') for (const side of ['min', 'max']) {
        const date = bounds[side]; if (typeof date !== 'string') continue;
        const parsed = new Date(`${date}T00:00:00.000Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) issues.push(inputIssue(active, `/filter/air_date/${side}`, 'date')!);
      }
      if ((typeof bounds.min === 'number' && typeof bounds.max === 'number' && bounds.min > bounds.max)
        || (typeof bounds.min === 'string' && typeof bounds.max === 'string' && bounds.min > bounds.max)) issues.push(inputIssue(active, `/filter/${key}`, 'rangeOrder')!);
    }
  }
  if (name === 'refine_subject_candidates' || name === 'query_user_collections' && output.result_mode === 'candidates') validateCandidateFilter((output.filter ?? {}) as CandidateFilter);
  if (name === 'expand_subject_relations') {
    validateRelationArguments(output as RelationQueryArgs);
    validateCandidateFilter((output.parent_filter ?? {}) as CandidateFilter);
    validateCandidateFilter((output.filter ?? {}) as CandidateFilter);
  }
  if (name === 'query_user_collections') {
    if (output.result_mode === 'candidates' && Array.isArray(output.extra_subject_ids) && output.extra_subject_ids.length) throw new AppError('INVALID_INPUT', 'extra_subject_ids仅旧日期查询可用，候选模式请以subject_ids建立明确集合。');
    if (output.result_mode !== 'candidates' && output.sort === 'source') throw new AppError('INVALID_INPUT', '来源排序仅候选模式可用。');
    if (output.result_mode !== 'candidates') output.sort ??= 'date_desc';
    else if (output.air_date) {
      if ((output.filter as CandidateFilter | undefined)?.air_date) throw new AppError('INVALID_INPUT', '日期条件只能提供一处。');
      output.filter = { ...(output.filter as CandidateFilter ?? {}), air_date: output.air_date };
      delete output.air_date;
      validateCandidateFilter(output.filter as CandidateFilter);
    }
  }
  if (['search_subjects', 'browse_subjects', 'get_user_collections', 'query_user_collections'].includes(name) && output.result_mode !== 'candidates'
    && ['fields', 'include', 'merge_ref', 'collection_ref', 'source_limit', 'cursor', 'filter', 'coverage_mode', 'response_view'].some(field => Object.hasOwn(value as object, field) && (name !== 'search_subjects' || field !== 'filter'))) throw new AppError('INVALID_INPUT', '字段投影、集合引用与分阶段筛选须使用result_mode=candidates。');
  if (name === 'query_user_collections' && output.air_date) {
    const bounds = output.air_date as Record<string, string>;
    for (const side of ['min', 'max']) if (bounds[side] !== undefined) {
      const parsed = new Date(`${bounds[side]}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== bounds[side]) issues.push(inputIssue(active, `/air_date/${side}`, 'date')!);
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) issues.push(inputIssue(active, '/air_date', 'rangeOrder')!);
  }
  if (issues.length) throw new SchemaInputError(issues);
  if (name === 'update_subject_collection' && !['collection_type', 'rating', 'comment', 'tags', 'private', 'ep_status', 'vol_status'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个收藏修改字段。');
  if (name === 'update_index' && !['title', 'description', 'private'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个目录修改字段。');
  if (name === 'update_index_subject' && !['comment', 'order'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定短评或顺序。');
  if (name === 'get_index' && output.own !== true && output.include === undefined) output.include = ['description'];
  if (name === 'get_person_characters' && Number(output.offset) > 0 && output.snapshot_ref === undefined
    && (output.result_mode === 'candidates' || ['subject_type', 'appearance_role', 'subject_form', 'include'].some(key => Object.hasOwn(output, key)))) throw new SchemaInputError([inputIssue(active, '/snapshot_ref', 'required')!]);
  if (name === 'get_person_characters' && output.result_mode !== 'candidates'
    && ['fields','response_view','coverage_mode','merge_ref'].some(key => Object.hasOwn(value as object, key)))
    throw new AppError('INVALID_INPUT', '出演字段投影与作品候选引用须使用result_mode=candidates。');
  return output;
}
/** 远端只可提供已登记的字段路径和规则；消息、hint及allowed均重新从本地schema生成。 */
export function remoteInputError(name: string, args: Record<string, unknown>, value: unknown): SchemaInputError | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const schema = selectedSchema(findToolDefinition(name).inputSchema, args);
  const issues: InputIssue[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { path, rule } = raw as Record<string, unknown>;
    if (typeof path !== 'string' || path.length > 200 || typeof rule !== 'string') return null;
    const issue = inputIssue(schema, path, rule); if (!issue) return null;
    issues.push(issue);
  }
  return issues.length ? new SchemaInputError(issues) : null;
}
