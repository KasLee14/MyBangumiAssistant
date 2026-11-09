import type { MessageBlock, ToolFamily, ToolResultView, ToolState } from './protocol.js';
import { blocksFromContent } from './message-blocks.js';
import { projectWriteActivity } from './write-activity.js';

/**
 * 工具视图表：把一次工具调用投影成浏览器要显示的结构。
 *
 * 分工（与 `web/src/utils/toolViews.ts` 相对）：**宿主负责文案与载荷，浏览器负责视觉**。
 * 这与协议既有的约定一致——`protocol.ts` 开头说明「排版文案、状态名、脱敏与控制字符清理
 * 全部在宿主侧生成，浏览器只负责呈现」，因此中文标题、参数摘要、结果文本都在这里定。
 *
 * 三条设计原则：
 *
 * 1. **表驱动**：新增一个工具只改 `EXACT` / `RULES` 两张表，不新增分支（`web/AGENTS.md`
 *    跨层约束第 4 条）。
 * 2. **结果复用消息内容块**：Bangumi 工具的结果本身就带 presentation（例如
 *    `prepare_candidate_output` 的 `{ presentation: { content: MixedPart[] } }`、
 *    `prepare_candidate_table` 的 `{ presentation: MixedPart }`），直接沿用
 *    `blocksFromContent` 投影成 `MessageBlock[]`，于是过程区与正文区共用一个渲染入口。
 *    文本兜底只服务无法结构化的结果。
 * 3. **不猜**：拿不到摘要就留空，拿不到结构化载荷就退回文本；不拼凑看起来合理的内容。
 */

export interface ToolViewSpec {
  family: ToolFamily;
  /** 中文标题；浏览器直接显示，不做映射。 */
  title: string;
  access: 'read' | 'write';
  /** 参数摘要的候选字段，按优先级排列（支持 `filter.tag` 这样的点号路径）。 */
  summaryKeys: readonly string[];
}

/** 参数摘要上限：一个流水行的宽度决定它不该更长（对齐 DSH 的 160 grapheme 量级）。 */
const SUMMARY_LIMIT = 160;
/** 参数原文上限：超过就不下发，展开体只显示摘要。 */
const ARGS_LIMIT = 4096;
/** 结果文本上限：按字符与行数双重裁剪，超出由 `truncated` 告知浏览器。 */
const TEXT_LIMIT = 8192;
const TEXT_LINE_LIMIT = 200;

const spec = (
  family: ToolFamily,
  title: string,
  access: 'read' | 'write',
  summaryKeys: readonly string[],
): ToolViewSpec => ({ family, title, access, summaryKeys });

/**
 * 精确匹配表。
 *
 * 覆盖 `bangumi/src/mcp/catalog.ts` 里全部具名工具；动态生成的名字（`get_${entity}_*`）
 * 由下面的 `RULES` 兜住。
 */
const EXACT: Readonly<Record<string, ToolViewSpec>> = {
  get_daily_broadcast: spec('calendar', '获取放送日历', 'read', ['weekday', 'date']),
  search_subjects: spec('search', '搜索作品', 'read', ['keyword', 'filter.tag', 'sort']),
  browse_subjects: spec('search', '浏览作品', 'read', ['cat', 'series', 'platform', 'date']),
  search_characters: spec('search', '搜索角色', 'read', ['keyword']),
  search_persons: spec('search', '搜索人物', 'read', ['keyword', 'career_filter']),
  refine_subject_candidates: spec('candidate', '筛选候选作品', 'read', ['filter.subject_ids', 'filter.tag']),
  expand_subject_relations: spec('candidate', '展开关联作品', 'read', ['parent_filter', 'filter.tag']),
  get_candidate_coverage: spec('candidate', '读取候选来源覆盖', 'read', ['coverage_ref']),
  get_candidate_lineage: spec('candidate', '读取候选来源', 'read', ['collection_ref', 'subject_ids']),
  continue_subject_query: spec('candidate', '继续候选查询', 'read', ['reference', 'collection_ref']),
  prepare_candidate_output: spec('candidate', '准备结果展示', 'read', ['title', 'kind']),
  prepare_component: spec('tools', '准备展示组件', 'read', ['component', 'title']),
  present_component: spec('tools', '发布展示组件', 'read', ['blockIndex']),
  present_text: spec('tools', '发布说明文字', 'read', ['text']),
  read_component_index: spec('tools', '查找展示组件', 'read', ['query', 'category']),
  read_component_spec: spec('tools', '加载展示组件', 'read', ['mode']),
  read_cached_resource: spec('detail', '读取缓存字段', 'read', ['fields', 'keys', 'range']),
  get_subject_details: spec('detail', '读取作品资料', 'read', ['subject_id', 'fields', 'include']),
  get_subject_image: spec('image', '获取作品图片', 'read', ['subject_id', 'image_type']),
  get_episodes: spec('list', '读取章节列表', 'read', ['subject_id', 'episode_type']),
  get_episode_details: spec('detail', '读取章节详情', 'read', ['episode_id']),
  get_user_info: spec('detail', '读取用户资料', 'read', ['username']),
  get_user_avatar: spec('image', '获取用户头像', 'read', ['username', 'avatar_type']),
  get_current_user: spec('detail', '核实当前账户', 'read', ['check_nsfw']),
  get_user_collections: spec('list', '读取用户收藏', 'read', ['username', 'subject_type', 'collection_type']),
  query_user_collections: spec('list', '采集收藏快照', 'read', ['username', 'collection_type', 'collection_ref']),
  get_user_subject_collection: spec('single', '查询作品收藏', 'read', ['username', 'subject_id']),
  get_user_episode_collection: spec('list', '读取章节收藏', 'read', ['subject_id', 'episode_type']),
  get_single_episode_collection: spec('single', '查询章节状态', 'read', ['episode_id']),
  update_subject_collection: spec('write', '修改作品收藏', 'write', ['subject_id', 'collection_type', 'rating', 'comment', 'tags']),
  update_episode_collection: spec('write', '修改章节状态', 'write', ['subject_id', 'episode_ids', 'collection_type']),
  update_single_episode_collection: spec('write', '修改单集状态', 'write', ['episode_id', 'collection_type', 'batch']),
  create_index: spec('write', '创建目录', 'write', ['title']),
  get_index: spec('detail', '读取目录', 'read', ['index_id', 'own']),
  update_index: spec('write', '修改目录', 'write', ['index_id', 'title']),
  get_index_subjects: spec('list', '读取目录作品', 'read', ['index_id', 'subject_type', 'own']),
  add_subject_to_index: spec('write', '加入目录', 'write', ['index_id', 'subject_id']),
  update_index_subject: spec('write', '修改目录条目', 'write', ['index_id', 'subject_id', 'comment', 'order']),
  remove_subject_from_index: spec('write', '移出目录', 'write', ['index_id', 'subject_id']),
  collect_index: spec('write', '收藏目录', 'write', ['index_id']),
  uncollect_index: spec('write', '取消收藏目录', 'write', ['index_id']),
  execute_write_batch: spec('batch', '执行修改计划', 'write', []),
};

/** 规则表：处理 `catalog.ts` 里用模板动态生成的名字；按顺序取第一个命中。 */
const RULES: readonly (readonly [RegExp, ToolViewSpec])[] = [
  [/^render_[A-Za-z]+$/, spec('tools', '发布展示组件', 'read', ['title', 'before'])],
  [/^prepare_[A-Za-z]+$/, spec('tools', '准备展示组件', 'read', ['title'])],
  [/^get_user_character_/, spec('list', '读取角色收藏', 'read', ['username', 'collection_type'])],
  [/^get_user_person_/, spec('list', '读取人物收藏', 'read', ['username', 'collection_type'])],
  [/^get_character_/, spec('detail', '读取角色资料', 'read', ['character_id', 'include'])],
  [/^get_person_/, spec('detail', '读取人物资料', 'read', ['person_id', 'include'])],
  [/_image$/, spec('image', '获取图片地址', 'read', ['image_type'])],
  [/_revisions?$/, spec('list', '读取编辑历史', 'read', ['revision_id'])],
  [/^get_/, spec('detail', '读取资料', 'read', [])],
  [/^search_/, spec('search', '搜索', 'read', ['keyword'])],
  [/^update_|^create_|^add_|^remove_|^collect_|^uncollect_/, spec('write', '修改资料', 'write', [])],
];

const FALLBACK: ToolViewSpec = spec('tools', '工具调用', 'read', []);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 取 `a.b.c` 形式的嵌套字段；任一段缺失即返回 undefined。 */
function pick(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    const holder = record(current);
    if (!(segment in holder)) return undefined;
    current = holder[segment];
  }
  return current;
}

/** 压平空白并截断；摘要与标题都走这里，避免控制字符与换行破坏单行布局。 */
function clamp(value: string, limit = SUMMARY_LIMIT): string {
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** 找一个工具对应的视图规格。 */
export function toolSpec(name: string): ToolViewSpec {
  const exact = EXACT[name];
  if (exact !== undefined) return exact;
  for (const [pattern, rule] of RULES) if (pattern.test(name)) return rule;
  return FALLBACK;
}

/** 中文标题；未知工具回落为「工具调用」。 */
export function toolTitle(name: string): string {
  return toolSpec(name).title;
}

/** 读/写：决定图标族，也决定浏览器侧是否把它与写入确认联系起来。 */
export function toolAccess(name: string): 'read' | 'write' {
  return toolSpec(name).access;
}

/** 过程组标题里的活动分类。 */
export function toolFamily(name: string): ToolFamily {
  return toolSpec(name).family;
}

/**
 * 参数摘要。
 *
 * 优先按规格里的字段顺序取第一个可用值，其次取参数对象里第一个非空字符串——这是
 * 保守的退化路径：宁可显示一个不完美的参数，也不要让流水行只剩工具名。
 */
export function toolSummary(name: string, args: unknown): string {
  const data = record(args);
  for (const key of toolSpec(name).summaryKeys) {
    const value = pick(data, key);
    if (typeof value === 'string' && value.trim()) return clamp(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
  }
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.trim()) return clamp(value);
  }
  return '';
}

/** 参数原文（展开体用）；超过阈值或无法序列化时返回 undefined，由摘要兜住。 */
export function toolArgsText(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  let text: string;
  try {
    text = JSON.stringify(args, null, 2);
  } catch {
    return undefined;
  }
  if (typeof text !== 'string' || !text.trim()) return undefined;
  return text.length > ARGS_LIMIT ? undefined : text;
}

/**
 * 结果里的结构化载荷 → 内容块。
 *
 * 位置按实际生产者的形状探测：MCP 结果可能在顶层、`structuredContent`、`details` 或
 * `details.value` 上挂 `presentation`；`presentation` 本身可能是单个 part（`{type, props}`）
 * 或 part 数组（`{content: MixedPart[]}`）。三种形状都覆盖，取值失败就交给文本兜底。
 */
function presentationBlocks(result: unknown): MessageBlock[] {
  const envelope = record(result);
  const holders = [
    envelope,
    record(envelope['structuredContent']),
    record(envelope['details']),
    record(record(envelope['details'])['value']),
  ];
  for (const holder of holders) {
    const presentation = holder['presentation'];
    if (presentation === undefined) continue;
    if (Array.isArray(presentation)) {
      const blocks = blocksFromContent(presentation);
      if (blocks.length > 0) return blocks;
      continue;
    }
    const value = record(presentation);
    const content = value['content'];
    if (Array.isArray(content)) {
      const blocks = blocksFromContent(content);
      if (blocks.length > 0) return blocks;
      continue;
    }
    if (typeof value['type'] === 'string') {
      const blocks = blocksFromContent([presentation]);
      if (blocks.length > 0) return blocks;
    }
  }
  return [];
}

/** 结果文本：优先 MCP 的 `content[].text`，其次 JSON，最后原样字符串。 */
function resultText(result: unknown): { text: string; truncated: boolean } {
  const strings: string[] = [];
  if (typeof result === 'string') strings.push(result);
  else if (result !== null && result !== undefined && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const value = record(part)['text'];
        if (typeof value === 'string' && value) strings.push(value);
      }
    }
    if (strings.length === 0) {
      try {
        strings.push(JSON.stringify(result, null, 2));
      } catch {
        // 无法序列化的结果（循环引用等）没有可显示的文本，交给 errorText 兜住。
      }
    }
  } else if (result !== null && result !== undefined) strings.push(String(result));

  let text = strings.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  let truncated = false;
  const lines = text.split('\n');
  if (lines.length > TEXT_LINE_LIMIT) {
    text = lines.slice(0, TEXT_LINE_LIMIT).join('\n');
    truncated = true;
  }
  if (text.length > TEXT_LIMIT) {
    text = text.slice(0, TEXT_LIMIT);
    truncated = true;
  }
  return { text, truncated };
}

/** 一次工具调用的结果投影。 */
export interface ToolOutcome {
  /** 更细的状态（目前只有批量写入会给出）；缺省时由 `isError` 决定 ok / error。 */
  state?: ToolState;
  result: ToolResultView;
  showDetail?: boolean;
}

/**
 * 投影工具结果。
 *
 * `final` 为 false 表示这是执行中的中间回执：只有批量写入会给出可用的进展（批次计数、
 * 额度等待），其它工具沿用最终结果。那条通道的细节（依赖步骤、缺口、香港时间）不适合
 * 结构化，保留为文本是刻意的选择。
 *
 * 失败判定不只取决于 Pi 的 `isError`：MCP 信封里的 `details.value.state` 也能表达
 * `failed` / `unknown`——改造前的活动条目就是这么判的，这条语义不能丢。
 */
export function toolOutcome(
  name: string,
  result: unknown,
  isError: boolean,
  final = true,
): ToolOutcome {
  if (name === 'execute_write_batch') {
    const projected = projectWriteActivity(result, final);
    if (projected !== undefined) {
      return {
        state: projected.state,
        result: {
          blocks: [],
          text: projected.detail,
          isError: projected.state === 'error',
          ...(projected.state === 'error' ? { errorText: projected.detail } : {}),
        },
        showDetail: projected.showDetail,
      };
    }
    // 中间回执拿不到业务进展时给一个空结果：状态仍是「进行中」，不要假装已经完成。
    if (!final) return { result: { blocks: [], isError: false } };
  }
  const state = record(record(record(result)['details'])['value'])['state'];
  const failed = isError || state === 'failed' || state === 'unknown';
  const blocks = presentationBlocks(result);
  const { text, truncated } = resultText(result);
  // 已经有内容块时不再重复下发同一份文本（presentation 就是它的结构化形态）。
  const keepText = text.trim().length > 0 && (blocks.length === 0 || failed);
  const view: ToolResultView = {
    blocks,
    isError: failed,
    ...(keepText ? { text } : {}),
    ...(truncated ? { truncated: true } : {}),
    ...(failed ? { errorText: clamp(text, 400) || '工具执行失败。' } : {}),
  };
  return final ? { state: failed ? 'error' : 'ok', result: view } : { result: view };
}
