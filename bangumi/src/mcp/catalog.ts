import { AppError, SchemaInputError, type InputIssue } from '../support/errors.js';
import { compileSchema, inputIssue, schemaArguments, selectedSchema, type JsonSchema } from '../support/tool-schema.js';
import { SUBJECT_INCLUDES, subjectOutputSchema } from './subject-output.js';
import { RESOURCE_INPUT_SCHEMAS, resourceOutputSchema } from './resource-schemas.js';

/** 本项目固定登记的 Bangumi MCP 能力。名称兼容所评估的 55 项工具，实现依据官方 API。 */
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
const subjectType = enumeration([1, 2, 3, 4, 6], 'integer', { description: '媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。' }); const collectionType = enumeration([1, 2, 3, 4, 5]);
const episodeType = enumeration([0, 1, 2, 3, 4, 5, 6]); const episodeCollection = enumeration([0, 1, 2, 3], 'integer', { default: 2 });
const page = { limit: int(1, 100, { default: 30 }), offset: int(0, 10000, { default: 0 }) };
const relationPage = { ...page, limit: int(1, 100, { default: 20 }) };
const username = text(100, 1, { description: '本人私有资料必须使用 -；任何显式用户名或用户ID均仅使用匿名公开接口。', pattern: '^(?:-|[A-Za-z0-9_]+)$' });
const image = enumeration(['large', 'medium', 'small', 'grid'], 'string', { default: 'large' });
const own = { ...boolean, description: '需要本人私有目录或收藏现状时设 true，使用本应用账户会话。', default: false };
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
tool('search_subjects', '搜索五类作品。keyword仅作文字检索，题材用filter.tag/meta_tags、评分范围用filter.rating；不同筛选条件为且。sort只改变排序，不保证与基准作品相似或分数接近。', {
  keyword: text(300, 0, { description: '文字关键词，不是标签条件；只按结构化filter筛选时填空字符串，不能用拼接题材词替代filter。空关键词必须提供有效filter。' }), subject_type: subjectType,
  filter: { type: 'object', properties: { tag: tags, meta_tags: { ...tags, description: '网站公共标签，多值为且，可用-标签排除。' }, rating: range('number', 0, 10),
    rating_count: range('integer', 0, Number.MAX_SAFE_INTEGER), rank: range('integer', 1, Number.MAX_SAFE_INTEGER), air_date: dateRange },
    minProperties: 1, additionalProperties: false },
  sort: enumeration(['match', 'heat', 'rank', 'score'], 'string', { default: 'match', description: 'match匹配、heat收藏人数、rank排名、score评分；不按基准分差排序。' }), ...page }, ['keyword']);
export const BROWSE_CATEGORIES: Readonly<Record<number, readonly number[]>> = {
  1: [0, 1001, 1002, 1003], 2: [0, 1, 2, 3, 5], 3: [0], 4: [0, 4001, 4002, 4003, 4005], 6: [0, 1, 2, 3, 6001, 6002, 6003, 6004],
};
const categoryDescriptions: Record<number, string> = { 1: '书籍：0其他、1001漫画、1002小说、1003画集。',
  2: '动画形式：0其他、1TV、2OVA、3Movie、5WEB；恋爱/百合等题材使用search_subjects的filter。',
  3: '音乐仅0其他。', 4: '游戏：0其他、4001游戏、4002软件、4003扩展包、4005桌游。',
  6: '三次元：0其他、1日剧、2欧美剧、3华语剧、6001电视剧、6002电影、6003演出、6004综艺。' };
const browseCommon = { sort: enumeration(['date', 'rank'], 'string'), year: int(1800, 2200), month: int(1, 12), ...page };
tool('browse_subjects', '按媒体、作品形式、日期浏览；cat不是题材标签。series仅书籍可提供（false也一样），platform仅游戏可提供。标签和评分条件使用search_subjects。', {
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
tool('get_current_user', '在线核实本应用当前登录账户。', {}, [], 'read', 'account');
tool('get_user_collections', '分页读取用户作品收藏；本人支持私密记录，其他账户仅公开记录。', { username, subject_type: subjectType, collection_type: collectionType, ...page }, ['username']);
tool('get_user_subject_collection', '查询用户指定作品收藏；本人读取单条p1快照，明确未收藏返回 null，缺个人字段拒绝推断。', { username, subject_id: id }, ['username', 'subject_id']);
tool('update_subject_collection', '修改本账户收藏指定字段，保留其他字段；不会自动把所有章节标为看过。进度仅书籍可使用章数/卷数。', { subject_id: id, collection_type: collectionType, rating: int(0, 10), comment: text(2000), tags: { type: 'array', maxItems: 40, uniqueItems: true, items: text(100, 1, { pattern: '^\\S+$' }) }, private: boolean, ep_status: counter, vol_status: counter }, ['subject_id'], 'write', 'account');
tool('get_user_episode_collection', '分页读取当前账户指定作品章节及个人状态。', { subject_id: id, episode_type: episodeType, ...page, limit: int(1, 100, { default: 100 }) }, ['subject_id'], 'read', 'account');
tool('update_episode_collection', '逐项修改本账户章节状态；先完整验证所属作品，结果提交后宿主独立回读。', { subject_id: id, episode_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id }, collection_type: episodeCollection }, ['subject_id', 'episode_ids'], 'write', 'account');
tool('get_single_episode_collection', '读取当前账户单章节状态；未收藏为 0，保留所属作品ID。', { episode_id: id }, ['episode_id'], 'read', 'account');
tool('update_single_episode_collection', '修改本账户一个章节状态，不自动联动其他章节。', { episode_id: id, collection_type: episodeCollection }, ['episode_id'], 'write', 'account');
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
if (definitions.length !== 55) throw new Error('Bangumi MCP 固定能力目录数量错误。');
for (const definition of definitions) {
  if (RESOURCE_INPUT_SCHEMAS[definition.name]) definition.inputSchema = structuredClone(RESOURCE_INPUT_SCHEMAS[definition.name]!);
  const subjectOutput = subjectOutputSchema(definition.name, definition.inputSchema);
  const output = subjectOutput ?? resourceOutputSchema(definition.name);
  if (output) {
    definition.outputSchema = output;
    compileSchema(output);
    if (subjectOutput && definition.name !== 'get_subject_details') definition.description += '。返回统一作品摘要和真实分页，不附简介/infobox/图片；名称、日期、评分及实际标签名可直接使用，介绍需调用作品详情。';
    if (!subjectOutput && definition.effect === 'read') definition.description += '。返回固定白名单资料，列表不附简介或全部图片；详情通过include固定字段组按需读取。个人现状保持完整，公开不可见不表示未收藏。';
    if (definition.effect === 'write') definition.description += '。返回逐目标/阶段提交回执，verification=pending不表示持久化成功；最终结果仍由宿主独立回读核实，不自动重发。';
  }
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
  if (issues.length) throw new SchemaInputError(issues);
  if (name === 'update_subject_collection' && !['collection_type', 'rating', 'comment', 'tags', 'private', 'ep_status', 'vol_status'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个收藏修改字段。');
  if (name === 'update_index' && !['title', 'description', 'private'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个目录修改字段。');
  if (name === 'update_index_subject' && !['comment', 'order'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定短评或顺序。');
  if (name === 'get_index' && output.own !== true && output.include === undefined) output.include = ['description'];
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
