import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { COMMUNITY_MAX_RESULT_CHARS, communityOutputSchema, isCommunityTool } from './community-schemas.js';

type Data = Record<string, unknown>;
function invalid(message: string): never { throw new AppError('MCP_INVALID_RESULT', message); }
function record(value: unknown): Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('社区返回对象格式错误。');
  return value as Data;
}
function validTime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}
function checkTimes(row: Data): void {
  for (const field of ['createdAt', 'updatedAt', 'readAt']) {
    if (Object.hasOwn(row, field) && row[field] !== null && !validTime(row[field])) invalid('社区返回时间不是有效的UTC时间。');
  }
}
function checkFields(row: Data, include: readonly string[]): void {
  for (const field of ['content', 'excerpt']) {
    if (Object.hasOwn(row, field) !== include.includes(field)) invalid('社区返回带有未请求的正文或缺少已请求字段。');
  }
}
function checkContent(value: unknown, offset: number, limit: number, expectedRef?: unknown): void {
  const content = record(value);
  if (content.state !== 'available') return;
  const range = record(content.range);
  const count = Array.from(content.text as string).length;
  const total = range.totalChars as number;
  const expectedCount = Math.min(limit, Math.max(0, total - offset));
  if (range.offset !== offset || offset > total || range.returnedChars !== count || count !== expectedCount
    || range.nextOffset !== (offset + count < total ? offset + count : null)
    || content.isFullText !== (offset === 0 && count === total)
    || expectedRef !== undefined && content.contentRef !== expectedRef) invalid('社区正文片段范围、续读引用或完整性不一致。');
}
function checkIdentity(name: string, row: Data, args: Data): void {
  if (args.subject_id !== undefined && row.subjectId !== args.subject_id
    || args.blog_id !== undefined && row.blogId !== args.blog_id
    || args.topic_id !== undefined && row.topicId !== args.topic_id) invalid('社区返回对象归属与请求不一致。');
  const expectedUrl = name === 'get_subject_comments' ? `https://bgm.tv/subject/${row.subjectId}/comments`
    : name === 'get_subject_topics' || name === 'get_subject_topic_details' || name === 'get_subject_topic_replies'
      ? `https://bgm.tv/subject/topic/${row.topicId}` : `https://bgm.tv/blog/${row.blogId}`;
  if (row.url !== expectedUrl) invalid('社区返回来源链接与资源身份不一致。');
  checkTimes(row);
}
function checkRelationships(data: Data[]): void {
  const byId = new Map(data.map(row => [row.id, row]));
  for (const row of data) {
    if (row.parentId === null) {
      if (row.rootId !== row.id) invalid('社区顶层评论的根记录不一致。');
    } else {
      if (row.parentId === row.id || row.rootId === row.id) invalid('社区回复包含自引用。');
      const parent = byId.get(row.parentId);
      if (parent && parent.rootId !== row.rootId) invalid('社区回复与父评论根记录不一致。');
    }
    const root = byId.get(row.rootId);
    if (root && (root.parentId !== null || root.rootId !== root.id)) invalid('社区回复指向的根评论不是顶层记录。');
    const visited = new Set<unknown>([row.id]);
    let ancestor = byId.get(row.parentId);
    while (ancestor) {
      if (visited.has(ancestor.id)) invalid('社区回复关系包含循环。');
      visited.add(ancestor.id); ancestor = byId.get(ancestor.parentId);
    }
  }
}

/** 校验解封后的成功value；公开输出schema、调用参数和片段语义必须同时成立。 */
export function checkCommunityResponse(name: string, value: unknown, args: Data, schema?: JsonSchema): void {
  if (!isCommunityTool(name)) return;
  const activeSchema = schema ?? communityOutputSchema(name)!;
  let serialized: string;
  try { serialized = JSON.stringify({ value }); }
  catch { invalid('社区返回不能序列化为固定JSON结果。'); }
  if (serialized.length > COMMUNITY_MAX_RESULT_CHARS) throw new AppError('CONTEXT_LIMIT', '社区单次返回超过20000字符；请缩小limit或include范围，未静默截断记录。');
  const validator = compileSchema(activeSchema);
  if (!validator({ value })) {
    if (validator.errors?.some(error => ['maxLength', 'maxItems'].includes(error.keyword))) throw new AppError('FIELD_LIMIT', '社区字段或清单超过固定上限；请缩小读取范围，未静默截断记录。');
    invalid('社区返回不符合固定输出契约。');
  }
  const raw = record(value);
  if (!isDeepStrictEqual(raw.scope, args)) invalid('社区返回范围与本次固定参数不一致。');
  checkTimes(raw);
  if (name === 'read_community_content') {
    checkContent(raw.content, args.offset as number, args.limit as number, args.content_ref);
    return;
  }
  const include = (args.include ?? []) as string[];
  if (!isDeepStrictEqual(raw.included, include)) invalid('社区返回字段组与本次请求不一致。');
  if (raw.kind === 'details') {
    checkIdentity(name, raw, args); checkFields(raw, include);
    if (include.includes('content')) checkContent(raw.content, 0, 5000);
    return;
  }
  const data = (raw.data as unknown[]).map(record);
  const page = record(raw.page);
  const offset = args.offset as number, limit = args.limit as number, total = page.total as number;
  const expectedCount = Math.min(limit, Math.max(0, total - offset));
  if (page.limit !== limit || page.offset !== offset || page.returnedCount !== data.length || data.length !== expectedCount
    || page.complete !== (offset === 0 && data.length === total)
    || page.nextOffset !== (offset + data.length < total ? offset + data.length : null)) invalid('社区列表分页范围或完整性不一致。');
  if (page.paginationSource === 'host' && args.snapshot_ref !== undefined && page.snapshotRef !== args.snapshot_ref) invalid('社区续页使用了其他内容快照。');
  const keys = data.map(row => name === 'get_subject_reviews' ? row.relationId : name === 'get_subject_topics' ? row.topicId : row.id);
  if (new Set(keys).size !== keys.length || name === 'get_subject_reviews' && new Set(data.map(row => row.blogId)).size !== data.length) invalid('社区列表包含重复资源记录。');
  for (const row of data) {
    checkIdentity(name, row, args); checkFields(row, include);
    if (include.includes('content')) checkContent(row.content, 0, 500);
    if (row.excerpt !== null && row.excerpt !== undefined) {
      const excerpt = record(row.excerpt);
      if (excerpt.origin !== (name === 'get_subject_reviews' ? 'upstream_summary' : 'content_prefix')) invalid('社区原文节选来源标记不一致。');
    }
  }
  if (name === 'get_blog_comments' || name === 'get_subject_topic_replies') checkRelationships(data);
}
