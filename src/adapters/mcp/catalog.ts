import { AppError } from '../../domain/errors.js';

/** 本项目固定登记的 Bangumi MCP 能力。名称兼容所评估的 55 项工具，实现依据官方 API。 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  access: 'public' | 'account';
  effect: 'read' | 'write';
}
type Schema = Record<string, unknown>;
const int = (minimum: number, maximum = Number.MAX_SAFE_INTEGER, extra: Schema = {}): Schema => ({ type: 'integer', minimum, maximum, ...extra });
const text = (maxLength: number, minLength = 0, extra: Schema = {}): Schema => ({ type: 'string', minLength, maxLength, ...extra });
const enumeration = (values: readonly unknown[], type = 'integer', extra: Schema = {}): Schema => ({ type, enum: values, ...extra });
const id = int(1); const counter = int(0); const boolean: Schema = { type: 'boolean' };
const subjectType = enumeration([1, 2, 3, 4, 6]); const collectionType = enumeration([1, 2, 3, 4, 5]);
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
tool('search_subjects', '搜索五类作品，支持匹配、热度、排名及评分排序。', { keyword: text(300, 1), subject_type: subjectType, sort: enumeration(['match', 'heat', 'rank', 'score'], 'string', { default: 'match' }), ...page }, ['keyword']);
tool('browse_subjects', '按媒体、分类、日期和平台浏览作品。', { subject_type: subjectType, cat: int(0, 10000), series: boolean, platform: text(100, 1), sort: enumeration(['date', 'rank'], 'string'), year: int(1800, 2200), month: int(1, 12), ...page }, ['subject_type']);
tool('get_subject_details', '获取作品的结构化详情、标签、评分、简介和原生进度总量。', { subject_id: id }, ['subject_id']);
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
tool('get_user_subject_collection', '查询用户指定作品收藏；本人遍历完整收藏，未收藏明确返回 null。', { username, subject_id: id }, ['username', 'subject_id']);
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
export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = definitions;
export function findToolDefinition(name: string): McpToolDefinition {
  const definition = TOOL_DEFINITIONS.find(item => item.name === name);
  if (!definition) throw new AppError('UNKNOWN_TOOL', '未登记的 Bangumi MCP 工具。');
  return definition;
}

function validate(schema: Schema, value: unknown, label: string): void {
  const fail = (): never => { throw new AppError('INVALID_INPUT', `${label}参数无效。`); };
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < Number(schema.minimum) || value > Number(schema.maximum))) fail();
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail();
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < Number(schema.minLength ?? 0) || value.length > Number(schema.maxLength ?? 10000) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) fail();
    if (schema.pattern && !new RegExp(String(schema.pattern), 'u').test(String(value))) fail();
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail();
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < Number(schema.minItems ?? 0) || value.length > Number(schema.maxItems ?? 100)) fail();
    const values = value as unknown[];
    if (schema.uniqueItems && new Set(values.map(item => JSON.stringify(item))).size !== values.length) fail();
    for (const item of values) validate(schema.items as Schema, item, label);
  }
}
export function validateToolArguments(name: string, value: unknown): Record<string, unknown> {
  const definition = findToolDefinition(name);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', '工具参数必须是对象。');
  const input = value as Record<string, unknown>;
  const properties = definition.inputSchema.properties as Record<string, Schema>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) throw new AppError('INVALID_INPUT', '工具含未知参数。');
  for (const key of definition.inputSchema.required as string[]) if (!Object.hasOwn(input, key)) throw new AppError('INVALID_INPUT', '缺少工具必填参数。');
  for (const [key, schema] of Object.entries(properties)) {
    if (Object.hasOwn(input, key)) { validate(schema, input[key], key); output[key] = input[key]; }
    else if (Object.hasOwn(schema, 'default')) output[key] = schema.default;
  }
  for (const key of ['keyword', 'title']) if (typeof output[key] === 'string' && !(output[key] as string).trim()) throw new AppError('INVALID_INPUT', '关键词或标题不能为空白。');
  if (name === 'browse_subjects') {
    const categories: Record<number, number[]> = { 1: [0, 1001, 1002, 1003], 2: [0, 1, 2, 3, 5], 3: [0], 4: [0, 4001, 4002, 4003, 4005], 6: [0, 1, 2, 3, 6001, 6002, 6003, 6004] };
    if (output.cat !== undefined && !categories[Number(output.subject_type)]!.includes(Number(output.cat)) || output.series !== undefined && output.subject_type !== 1 || output.platform !== undefined && output.subject_type !== 4) throw new AppError('INVALID_INPUT', '浏览筛选与媒体类型不匹配。');
  }
  if (name === 'update_subject_collection' && !['collection_type', 'rating', 'comment', 'tags', 'private', 'ep_status', 'vol_status'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个收藏修改字段。');
  if (name === 'update_index' && !['title', 'description', 'private'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定一个目录修改字段。');
  if (name === 'update_index_subject' && !['comment', 'order'].some(key => Object.hasOwn(output, key))) throw new AppError('INVALID_INPUT', '至少指定短评或顺序。');
  return output;
}
