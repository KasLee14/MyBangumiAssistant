import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { TOOL_DEFINITIONS, type McpToolDefinition } from './catalog.js';
import { isCommunityTool } from './community-schemas.js';
import { schemaArguments, type JsonSchema } from '../support/tool-schema.js';
import { AppError } from '../support/errors.js';
import { normalizeStrictOptionalNulls, toolConstraintState, type ToolProviderModel } from '../support/provider-tool-arguments.js';

export const BANGUMI_TOOL_DISCOVERY_NAME = 'discover_bangumi_tools';
export const TOOL_DISCOVERY_INSTRUCTION = '业务工具按需加载。先调用 discover_bangumi_tools 搜索用途或工具名；结果中的工具只在加载后下一次请求可调用。支持中文，工具名精确查询优先。查不到时省略 query 并按 category、next_offset 完整遍历；不能把一页结果当作全部能力。load=false 只读索引，tool_names 可精确加载已找到的工具。索引只含用途和字段名，实际调用以加载后的完整参数契约为准。';
type DiscoveryApi = Pick<ExtensionAPI, 'getAllTools' | 'getActiveTools' | 'setActiveTools'>;
const categories = {
  subjects: '作品搜索 浏览 简介 评分 排名 日期 图片',
  characters: '角色 详情 配音 出演',
  persons: '人物 声优 漫画家 制作 职业 组织',
  collections: '收藏 看过 在看 想看 状态 进度 用户',
  candidates: '候选 推荐 筛选 排除 分页 完整 范围 关系',
  community: '讨论 评论 吐槽 小组 日志 社区',
  indexes: '目录 目录作品',
  episodes: '章节 集数 播出',
  revisions: '修订 编辑 历史',
  cache: '缓存 引用 字段 补全',
  users: '账户 权限 用户 头像',
};
type Category = keyof typeof categories;
export function toolCategory(name: string): Category {
  if (name === 'read_cached_resource') return 'cache';
  if (isCommunityTool(name)) return 'community';
  if (/revision/.test(name)) return 'revisions';
  if (/candidate|continue_subject_query|expand_subject_relations/.test(name)) return 'candidates';
  if (/index/.test(name)) return 'indexes';
  if (/collection/.test(name)) return 'collections';
  if (/episode/.test(name)) return 'episodes';
  if (/character/.test(name)) return 'characters';
  if (/person/.test(name)) return 'persons';
  if (/user/.test(name)) return 'users';
  return 'subjects';
}
const schema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    query: { type: 'string', maxLength: 300, default: '', description: '中文用途、关键词或工具名；空字符串完整遍历目录。' },
    category: { type: 'string', enum: ['all', ...Object.keys(categories)], default: 'all', description: '限定索引分类；所有分类及中文用途会随结果返回。' },
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
    load: { type: 'boolean', default: true, description: 'true加载本页工具；false仅读取索引。' },
    tool_names: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'string', maxLength: 100 }, description: '按已读取索引精确加载工具；有此字段时不用搜索分页。' },
  }, required: [],
};
const normalize = (value: string): string => value.normalize('NFKC').toLowerCase();
function queryTerms(query: string): string[] {
  const text = normalize(query);
  const terms = [...text.matchAll(/[a-z0-9_]+/gu)].map(match => match[0]);
  // 汉字双字词和完整词共同检索，避免英文 BM25 将中文查询变成空词表。
  for (const run of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (run.length <= 2) terms.push(run);
    else for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2));
  }
  return [...new Set(terms)];
}
function rank(definition: McpToolDefinition, query: string): number {
  const name = normalize(definition.name);
  if (name === normalize(query.trim())) return 10_000;
  const description = normalize(definition.description);
  const fields = Object.keys((definition.modelInputSchema ?? definition.inputSchema).properties as object ?? {}).join(' ');
  const category = categories[toolCategory(definition.name)];
  const terms = queryTerms(query);
  return terms.reduce((score, term) => score + (name.includes(term) ? 8 : 0)
    + (description.includes(term) ? 3 : 0) + (fields.includes(term) ? 2 : 0) + (category.includes(term) ? 1 : 0), 0);
}

/** 每次只移除上个真实用户任务加载的业务工具；恢复和同轮工具调用不能触发此函数。 */
export function resetBangumiToolLoadout(pi: DiscoveryApi, essentialNames: readonly string[] = []): void {
  const business = new Set(TOOL_DEFINITIONS.map(tool => tool.name));
  const available = new Set(pi.getAllTools().map(tool => tool.name));
  pi.setActiveTools([...new Set([...pi.getActiveTools().filter(name => !business.has(name)),
    BANGUMI_TOOL_DISCOVERY_NAME, ...essentialNames])].filter(name => available.has(name)));
}

/** 使用 Pi 原生 active loadout；返回字段名不会代替真正加载下一次请求的 tools Schema。 */
export function createBangumiToolDiscovery(pi: DiscoveryApi, model?: () => ToolProviderModel | undefined): ToolDefinition {
  return {
    name: BANGUMI_TOOL_DISCOVERY_NAME, label: '读取并加载业务工具',
    description: TOOL_DISCOVERY_INSTRUCTION,
    parameters: schema as ToolDefinition['parameters'], exposure: 'model-only',
    constrainedSampling: { type: 'json_schema', strict: 'prefer' }, executionMode: 'sequential',
    prepareArguments: raw => schemaArguments(schema,
      normalizeStrictOptionalNulls(schema, raw, toolConstraintState(schema, model?.()).provider === 'enabled')),
    async execute(_id, raw) {
      const args = schemaArguments(schema, raw);
      const registered = new Set(pi.getAllTools().filter(tool => tool.exposure === 'deferred').map(tool => tool.name));
      const candidates = TOOL_DEFINITIONS.filter(tool => tool.effect === 'read' && registered.has(tool.name));
      const names = args.tool_names as string[] | undefined;
      const category = args.category as string;
      const query = (args.query as string).trim();
      let rows: McpToolDefinition[];
      if (names) {
        rows = names.map(name => {
          const row = candidates.find(tool => tool.name === name);
          if (!row) throw new AppError('INVALID_INPUT', 'tool_names 只能包含当前宿主已登记的只读业务工具；请读取完整索引确认名称。');
          return row;
        });
      } else {
        const scoped = candidates.filter(tool => category === 'all' || toolCategory(tool.name) === category);
        rows = scoped.map(tool => ({ tool, score: query ? rank(tool, query) : 1 }))
          .filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
          .map(row => row.tool);
      }
      const offset = names ? 0 : args.offset as number;
      const page = names ? rows : rows.slice(offset, offset + (args.limit as number));
      const loaded = args.load === true ? page.map(tool => tool.name) : [];
      if (loaded.length) pi.setActiveTools([...new Set([...pi.getActiveTools(), ...loaded])]);
      const hasMore = offset + page.length < rows.length;
      const value = {
        tools: page.map(tool => ({ name: tool.name, description: tool.description, category: toolCategory(tool.name),
          fields: Object.keys((tool.modelInputSchema ?? tool.inputSchema).properties as object ?? {}),
          required: (tool.modelInputSchema ?? tool.inputSchema).required ?? [],
          constraints: toolConstraintState(tool.modelInputSchema ?? tool.inputSchema, model?.()),
          active: pi.getActiveTools().includes(tool.name),
        })), loaded, total: rows.length, offset, has_more: hasMore,
        next_offset: hasMore ? offset + page.length : null,
        scope: names ? 'explicit_names' : query ? 'query_matches' : 'all_registered_read_tools',
        categories, ...(rows.length ? {} : { hint: '没有匹配；省略 query，按 category 和 next_offset 完整遍历。' }),
      };
      return { content: [{ type: 'text', text: JSON.stringify({ value }) }], details: value };
    },
  };
}
