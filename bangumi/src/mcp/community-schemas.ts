import type { JsonSchema } from '../support/tool-schema.js';
import { withAccessContext } from './access-context.js';

/** 社区工具只读公开内容；登录时依据账户权限读取，默认值在严格验证后由宿主补齐。 */
export interface CommunityToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  access: 'public';
  effect: 'read';
}

export const COMMUNITY_MAX_RESULT_CHARS = 20_000;
export const COMMUNITY_CONTENT_REF_PATTERN = '^ct_[A-Za-z0-9_-]{32}$';
export const COMMUNITY_SNAPSHOT_REF_PATTERN = '^pg_[A-Za-z0-9_-]{32}$';
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER, extra: JsonSchema = {}): JsonSchema => ({
  type: 'integer', minimum, maximum, ...extra,
});
const string = (maxLength: number, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', maxLength, ...extra });
const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});
const ref = (pattern: string): JsonSchema => string(35, { minLength: 35, pattern });
const included = (values: readonly string[], defaults = false): JsonSchema => ({
  type: 'array', maxItems: 1, uniqueItems: true, items: { type: 'string', enum: values },
  ...(defaults ? { default: [] } : {}),
});
const pagination = (limit = 10): Record<string, JsonSchema> => ({
  limit: integer(1, 20, { default: limit }), offset: integer(0, Number.MAX_SAFE_INTEGER, { default: 0 }),
});
const definitions: CommunityToolDefinition[] = [];
function tool(name: string, description: string, properties: Record<string, JsonSchema>, required: string[]): void {
  definitions.push({ name, description, inputSchema: closed(properties, required), access: 'public', effect: 'read' });
}
function hostSnapshot(): void {
  const schema = definitions.at(-1)!.inputSchema;
  schema.if = { properties: { offset: integer(1) }, required: ['offset'] };
  schema.then = { properties: { snapshot_ref: ref(COMMUNITY_SNAPSHOT_REF_PATTERN) }, required: ['snapshot_ref'] };
}

tool('get_subject_comments', '分页读取条目公开吐槽；默认只有身份、作者、评分等元数据，include=[excerpt]取原文节选，include=[content]取每条最多500字符的正文片段；长文本用contentRef续读。', {
  subject_id: integer(1), ...pagination(), include: included(['excerpt', 'content'], true),
}, ['subject_id']);
tool('get_subject_reviews', '分页读取条目关联日志；relationId与blogId分开，不能把关联ID当日志ID。默认只取元数据，include=[excerpt]取上游已有原文节选；不逐篇获取正文或评论。', {
  subject_id: integer(1), ...pagination(5), include: included(['excerpt'], true),
}, ['subject_id']);
tool('get_blog_details', '读取公开日志基本信息；默认不含正文，include=[content]取最多5000字符的首段正文，未完整时通过contentRef继续读取。', {
  blog_id: integer(1), include: included(['content'], true),
}, ['blog_id']);
tool('get_blog_comments', '分页读取公开日志评论和回复，平铺保留父子关系；默认无文字，include=[excerpt]取节选，include=[content]取最多500字符片段。宿主分页offset>0须传上一页snapshotRef，快照过期不能静默重建。', {
  blog_id: integer(1), ...pagination(), snapshot_ref: ref(COMMUNITY_SNAPSHOT_REF_PATTERN), include: included(['excerpt', 'content'], true),
}, ['blog_id']);
hostSnapshot();
tool('get_subject_topics', '分页读取条目公开讨论主题元数据与来源链接，不展开主帖和回复正文。', {
  subject_id: integer(1), ...pagination(),
}, ['subject_id']);
tool('get_subject_topic_details', '读取指定条目的公开讨论主帖，核实topicId所属subjectId；默认无正文，include=[content]取最多5000字符首段。不会附带回复。', {
  subject_id: integer(1), topic_id: integer(1), include: included(['content'], true),
}, ['subject_id', 'topic_id']);
tool('get_subject_topic_replies', '分页读取指定条目的讨论回复，平铺保留父子关系；默认无文字，include=[excerpt]取节选，include=[content]取最多500字符片段。offset>0须传上一页snapshotRef。', {
  subject_id: integer(1), topic_id: integer(1), ...pagination(), snapshot_ref: ref(COMMUNITY_SNAPSHOT_REF_PATTERN), include: included(['excerpt', 'content'], true),
}, ['subject_id', 'topic_id']);
hostSnapshot();
tool('read_community_content', '续读宿主正文快照，不发起网络请求。content_ref来自此前明确请求正文的结果；offset及limit按规范化文本Unicode字符计算，正文完整性与列表完整性分开。', {
  content_ref: ref(COMMUNITY_CONTENT_REF_PATTERN), offset: integer(0, Number.MAX_SAFE_INTEGER, { default: 0 }), limit: integer(1, 5000, { default: 5000 }),
}, ['content_ref']);

export const COMMUNITY_TOOL_DEFINITIONS: readonly CommunityToolDefinition[] = definitions;
const names = new Set(definitions.map(definition => definition.name));
export function isCommunityTool(name: string): boolean { return names.has(name); }

const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const timestamp = string(24, { minLength: 24, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' });
const author = nullable(closed({ id: integer(1), username: nullable(string(100)), nickname: nullable(string(300)) }));
const range = closed({ offset: integer(), returnedChars: integer(0, 5000), totalChars: integer(), nextOffset: nullable(integer()) });
/** 真正的全文仍由宿主快照保存；响应中的可用正文只是一段有明确范围的纯文本。 */
export function communityContentSchema(maxLength = 5000, availableOnly = false): JsonSchema {
  const available = closed({ state: { type: 'string', const: 'available' }, format: { type: 'string', const: 'plain_text' },
    contentRef: ref(COMMUNITY_CONTENT_REF_PATTERN), text: string(maxLength), range, isFullText: { type: 'boolean' } });
  if (availableOnly) return available;
  return { oneOf: [available,
    closed({ state: { type: 'string', const: 'unavailable' }, reason: { type: 'string', enum: ['deleted', 'hidden', 'not_exposed', 'unknown'] } }),
    closed({ state: { type: 'string', const: 'unsupported_shape' } }),
  ] };
}
const excerpt = nullable(closed({ text: string(300), origin: { type: 'string', enum: ['upstream_summary', 'content_prefix'] }, truncated: { type: 'boolean' } }));
const blogUrl = string(100, { pattern: '^https://bgm\\.tv/blog/[1-9]\\d*$' });
const topicUrl = string(100, { pattern: '^https://bgm\\.tv/subject/topic/[1-9]\\d*$' });
const commentUrl = string(100, { pattern: '^https://bgm\\.tv/subject/[1-9]\\d*/comments$' });
const core = { title: string(300), author, createdAt: nullable(timestamp), updatedAt: nullable(timestamp), replyCount: nullable(integer()) };
const rows: Record<string, JsonSchema> = {
  get_subject_comments: closed({ id: integer(1), subjectId: integer(1), author,
    rating: nullable(integer(0, 10)), collectionStatus: nullable({ type: 'integer', enum: [1, 2, 3, 4, 5] }),
    updatedAt: nullable(timestamp), url: commentUrl, content: communityContentSchema(500), excerpt,
  }, ['id', 'subjectId', 'author', 'rating', 'collectionStatus', 'updatedAt', 'url']),
  get_subject_reviews: closed({ relationId: integer(1), blogId: integer(1), subjectId: integer(1), ...core, url: blogUrl, excerpt },
    ['relationId', 'blogId', 'subjectId', ...Object.keys(core), 'url']),
  get_blog_comments: closed({ id: integer(1), blogId: integer(1), parentId: nullable(integer(1)), rootId: integer(1), author,
    createdAt: nullable(timestamp), url: blogUrl, content: communityContentSchema(500), excerpt,
  }, ['id', 'blogId', 'parentId', 'rootId', 'author', 'createdAt', 'url']),
  get_subject_topics: closed({ topicId: integer(1), subjectId: integer(1), ...core, url: topicUrl }),
  get_subject_topic_replies: closed({ id: integer(1), subjectId: integer(1), topicId: integer(1), parentId: nullable(integer(1)), rootId: integer(1), author,
    createdAt: nullable(timestamp), url: topicUrl, content: communityContentSchema(500), excerpt,
  }, ['id', 'subjectId', 'topicId', 'parentId', 'rootId', 'author', 'createdAt', 'url']),
};
const entities: Record<string, string> = { get_subject_comments: 'subjectComment', get_subject_reviews: 'subjectReview',
  get_blog_comments: 'blogComment', get_subject_topics: 'subjectTopic', get_subject_topic_replies: 'topicPost' };
const source = { oneOf: [
  closed({ kind: { type: 'string', const: 'subjectComment' }, subjectId: integer(1), commentId: integer(1) }),
  closed({ kind: { type: 'string', const: 'blog' }, blogId: integer(1) }),
  closed({ kind: { type: 'string', const: 'blogComment' }, blogId: integer(1), commentId: integer(1) }),
  closed({ kind: { type: 'string', const: 'topicPost' }, subjectId: integer(1), topicId: integer(1), postId: integer(1) }),
] };
const safeError = closed({ code: string(100, { minLength: 1 }), message: string(20_000), networkAttempted: { type: 'boolean', const: false },
  issues: { type: 'array', maxItems: 200, items: closed({ path: string(300), rule: string(100), hint: string(3000),
    allowed: { type: 'array', maxItems: 100, items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } },
  }, ['path', 'rule', 'hint']) },
}, ['code', 'message']);
const outputSchemas = new Map<string, JsonSchema>();

/** 条件规则直接进入公开schema，不能仅靠工具说明避免未请求正文夹带。 */
function includeConditions(value: JsonSchema, choices: readonly string[], row: boolean): void {
  if (!choices.length) return;
  value.allOf = choices.map(field => {
    const item = field === 'content' ? communityContentSchema(row ? 500 : 5000) : excerpt;
    const includedField = { type: 'object', properties: { [field]: item }, required: [field] };
    const excludedField = { type: 'object', properties: { [field]: false } };
    const branch = (schema: JsonSchema): JsonSchema => row
      ? { properties: { data: { type: 'array', items: schema } } }
      : { properties: schema.properties, ...(schema.required ? { required: schema.required } : {}) };
    return {
      if: { properties: { included: { type: 'array', contains: { type: 'string', const: field } } }, required: ['included'] },
      then: branch(includedField), else: branch(excludedField),
    };
  });
}
for (const definition of definitions) {
  const properties = definition.inputSchema.properties as Record<string, JsonSchema>;
  const choices = (properties.include?.items as JsonSchema | undefined)?.enum as string[] | undefined ?? [];
  const scope = structuredClone(definition.inputSchema);
  scope.required = Object.keys(properties).filter(key => key !== 'snapshot_ref');
  const common = { schemaVersion: { type: 'integer', const: 1 }, scope, visibility: { type: 'string', const: 'public' }, readAt: timestamp };
  let value: JsonSchema;
  if (definition.name === 'read_community_content') {
    value = closed({ ...common, kind: { type: 'string', const: 'content_chunk' }, source, content: communityContentSchema(5000, true) });
  } else {
    const base = { ...common, included: choices.length ? included(choices) : { type: 'array', maxItems: 0, items: false } };
    const row = rows[definition.name];
    if (row) {
      const host = definition.name === 'get_blog_comments' || definition.name === 'get_subject_topic_replies';
      const page = closed({ paginationSource: { type: 'string', const: host ? 'host' : 'upstream' }, total: integer(),
        limit: integer(1, 20), offset: integer(), returnedCount: integer(0, 20), nextOffset: nullable(integer()), complete: { type: 'boolean' },
        ...(host ? { snapshotRef: ref(COMMUNITY_SNAPSHOT_REF_PATTERN) } : {}),
      });
      value = closed({ ...base, kind: { type: 'string', const: 'page' }, entity: { type: 'string', const: entities[definition.name] },
        data: { type: 'array', maxItems: 20, items: row }, page });
      includeConditions(value, choices, true);
    } else {
      const blog = definition.name === 'get_blog_details';
      const details = { ...base, kind: { type: 'string', const: 'details' }, entity: { type: 'string', const: blog ? 'blog' : 'subjectTopic' },
        ...(blog ? { blogId: integer(1) } : { subjectId: integer(1), topicId: integer(1) }), ...core, url: blog ? blogUrl : topicUrl,
        content: communityContentSchema(),
      };
      value = closed(details, Object.keys(details).filter(key => key !== 'content'));
      includeConditions(value, choices, false);
    }
  }
  const output = withAccessContext({ type: 'object', oneOf: [closed({ value }), closed({ error: safeError })] });
  outputSchemas.set(definition.name, output);
  definition.outputSchema = output;
}
export function communityOutputSchema(name: string): JsonSchema | undefined { return outputSchemas.get(name); }
