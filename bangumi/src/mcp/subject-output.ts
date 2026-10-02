import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { object } from '../support/bangumi.js';

export const SUBJECT_INCLUDES = ['summary', 'infobox', 'tagStats', 'ratingDistribution'] as const;
export type SubjectInclude = typeof SUBJECT_INCLUDES[number];
export interface SubjectSummary {
  schemaVersion: 1; entity: 'subject'; id: number; subjectType: number | null;
  name: string; nameCn: string | null; date: string | null; platform: string | null;
  score: number | null; rank: number | null; ratingCount: number | null;
  totalEpisodes: number | null; totalVolumes: number | null;
  tags: string[] | null; metaTags: string[] | null; url: string;
  relation?: string | null; staff?: string | null;
  characters?: { id: number; name: string; nameCn: string | null; url: string }[];
}
export interface SubjectDetails extends SubjectSummary {
  included: SubjectInclude[]; summary?: string | null; infobox?: unknown[] | null;
  tagStats?: { name: string; count: number | null; totalCount: number | null }[] | null;
  ratingDistribution?: Record<string, number | null> | null;
}
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const integer = (minimum = 0): JsonSchema => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const string = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });
const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});
const stringList = nullable({ type: 'array', maxItems: 100, uniqueItems: true, items: { ...string(100), minLength: 1 } });
const properties = {
  schemaVersion: { type: 'integer', const: 1 }, entity: { type: 'string', const: 'subject' }, id: integer(1),
  subjectType: nullable({ type: 'integer', enum: [1, 2, 3, 4, 6] }), name: string(300), nameCn: nullable(string(300)),
  date: nullable(string(50)), platform: nullable(string(100)), score: nullable({ type: 'number', minimum: 0, maximum: 10 }),
  rank: nullable(integer(1)), ratingCount: nullable(integer()), totalEpisodes: nullable(integer()), totalVolumes: nullable(integer()),
  tags: stringList, metaTags: stringList, url: { ...string(100), pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' },
  relation: nullable(string(300)), staff: nullable(string(300)),
  characters: { type: 'array', maxItems: 100, items: closed({ id: integer(1), name: string(300), nameCn: nullable(string(300)),
    url: { ...string(100), pattern: '^https://bgm\\.tv/character/[1-9]\\d*$' } }) },
};
const required = Object.keys(properties).filter(key => !['relation', 'staff', 'characters'].includes(key));
export const subjectSummarySchema = closed(properties, required);
const infoboxSchema = { type: 'array', maxItems: 300, items: closed({ key: string(300), value: {
  anyOf: [string(20_000), { type: 'array', maxItems: 300, items: closed({ k: string(1000), v: string(20_000) }, ['v']) }],
} }) };
export const subjectDetailsSchema = closed({ ...properties,
  included: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...SUBJECT_INCLUDES] } },
  summary: nullable(string(50_000)), infobox: nullable(infoboxSchema),
  tagStats: nullable({ type: 'array', maxItems: 100, items: closed({ name: string(100), count: nullable(integer()), totalCount: nullable(integer()) }) }),
  ratingDistribution: nullable(closed(Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), nullable(integer())])))),
}, [...required, 'included']);
const pageSchema = closed({ total: nullable(integer()), limit: { ...integer(1), maximum: 100 }, offset: integer(),
  returnedCount: { ...integer(), maximum: 100 }, nextOffset: nullable(integer()), complete: { type: 'boolean' } });
const safeErrorSchema = closed({ code: string(100), message: string(20_000), networkAttempted: { type: 'boolean', const: false },
  issues: { type: 'array', maxItems: 200, items: closed({ path: string(300), rule: string(100), hint: string(3000),
    allowed: { type: 'array', maxItems: 100, items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } },
  }, ['path', 'rule', 'hint']) },
}, ['code', 'message']);
export const SUBJECT_OUTPUT_TOOLS = new Set(['search_subjects', 'browse_subjects', 'get_subject_details', 'get_daily_broadcast',
  'get_subject_relations', 'get_character_subjects', 'get_person_subjects', 'get_user_collections', 'get_index_subjects']);
export function subjectOutputSchema(name: string, inputSchema: JsonSchema): JsonSchema | undefined {
  if (!SUBJECT_OUTPUT_TOOLS.has(name)) return undefined;
  const scope = closed(structuredClone(inputSchema.properties as Record<string, JsonSchema>), []);
  const collectionItem = closed({ subject: subjectSummarySchema, subjectId: integer(1),
    collectionStatus: { type: 'integer', enum: [1, 2, 3, 4, 5] }, statusMeaning: string(30), personalRating: nullable({ type: 'integer', minimum: 0, maximum: 10 }),
    personalTags: stringList, private: nullable({ type: 'boolean' }), chapters: nullable(integer()), volumes: nullable(integer()), updatedAt: nullable(string(100)),
  });
  const indexItem = closed({ subject: subjectSummarySchema, relationId: nullable(integer(1)), order: nullable(integer()), comment: nullable(string(2000)) });
  const collection = name === 'get_user_collections'; const index = name === 'get_index_subjects';
  const page = closed({ schemaVersion: { type: 'integer', const: 1 }, kind: { type: 'string', const: 'page' },
    entity: { type: 'string', const: collection ? 'collection' : index ? 'indexSubject' : 'subject' },
    data: { type: 'array', maxItems: 100, items: collection ? collectionItem : index ? indexItem : subjectSummarySchema },
    page: pageSchema, scope, visibility: { type: 'string', enum: collection || index ? ['public', 'self'] : ['public'] }, readAt: string(50),
    ...(collection || index ? { account: closed({ id: integer(1), username: { ...string(200), minLength: 1 } }) } : {}),
  }, ['schemaVersion', 'kind', 'entity', 'data', 'page', 'scope', 'visibility', 'readAt']);
  if (collection || index) {
    page.if = { properties: { visibility: { const: 'self' } }, required: ['visibility'] };
    page.then = { properties: { account: (page.properties as Record<string, JsonSchema>).account }, required: ['account'] };
    page.else = { properties: { account: false } };
  }
  const weekday = closed({ id: { type: 'integer', minimum: 1, maximum: 7 }, en: string(100), cn: string(100), ja: string(100) }, ['id']);
  const value = name === 'get_subject_details' ? subjectDetailsSchema : name === 'get_daily_broadcast'
    ? closed({ schemaVersion: { type: 'integer', const: 1 }, kind: { type: 'string', const: 'weekly_schedule' },
      data: { type: 'array', maxItems: 7, items: closed({ weekday, subjects: page }) },
      complete: { type: 'boolean' }, visibility: { type: 'string', const: 'public' }, readAt: string(50) }) : page;
  return { type: 'object', oneOf: [closed({ value }), closed({ error: safeErrorSchema })] };
}
export function checkOutput(schema: JsonSchema, value: unknown): void {
  if (!compileSchema(schema)(value)) throw new AppError('MCP_INVALID_RESULT', 'MCP返回不符合固定输出契约。');
}
/** DTO验证之外，输出还必须与本次固定参数匹配；不采信异对象/异范围结果。 */
export function checkSubjectResponse(name: string, value: unknown, args: Record<string, unknown>): void {
  if (!SUBJECT_OUTPUT_TOOLS.has(name)) return;
  const raw = object(value);
  if (name === 'get_subject_details') {
    const include = args.include as string[];
    if (raw.id !== args.subject_id || raw.url !== `https://bgm.tv/subject/${raw.id}` || !Array.isArray(raw.included) || raw.included.length !== include.length
      || include.some(field => !(raw.included as unknown[]).includes(field))
      || SUBJECT_INCLUDES.some(field => Object.hasOwn(raw, field) !== include.includes(field))) throw new AppError('MCP_INVALID_RESULT', '作品详情对象或请求字段组不一致。');
    return;
  }
  const pages = name === 'get_daily_broadcast' ? (raw.data as { subjects: unknown }[]).map(day => day.subjects) : [raw];
  if (name === 'get_daily_broadcast' && raw.complete !== (pages.length === 7 && pages.every(value => object(object(value).page).complete === true))) throw new AppError('MCP_INVALID_RESULT', '周放送日历缺少星期或分页，不能声称完整。');
  for (const value of pages) {
    const result = object(value); const page = object(result.page); const scope = object(result.scope);
    const data = result.data as unknown[];
    const subjects = data.map(value => {
      const row = object(value); return result.entity === 'subject' ? row : object(row.subject);
    });
    if (new Set(subjects.map(subject => subject.id)).size !== subjects.length
      || subjects.some(subject => subject.url !== `https://bgm.tv/subject/${subject.id}` || args.subject_type !== undefined && subject.subjectType !== args.subject_type)
      || result.entity === 'collection' && data.some(value => args.collection_type !== undefined && object(value).collectionStatus !== args.collection_type)) throw new AppError('MCP_INVALID_RESULT', '作品返回身份、链接或筛选条件不一致。');
    if (page.limit !== args.limit || page.offset !== args.offset || page.returnedCount !== data.length
      || Object.keys(args).some(key => JSON.stringify(scope[key]) !== JSON.stringify(args[key]))
      || Object.keys(scope).length !== Object.keys(args).length
      || result.visibility !== (args.username === '-' || args.own === true ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '作品列表返回范围或可见性不一致。');
    const total = page.total as number | null; const start = Number(page.offset); const size = Number(page.limit);
    if (total === null && page.complete !== false || total !== null && (data.length !== Math.min(size, Math.max(0, total - start)) || page.complete !== (start === 0 && data.length === total))
      || page.nextOffset !== (total === null ? data.length === size ? start + data.length : null : start + data.length < total ? start + data.length : null)) throw new AppError('MCP_INVALID_RESULT', '作品列表返回的分页完整性不一致。');
  }
}
function count(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function names(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '作品标签不是数组。');
  const result = value.map(tag => typeof tag === 'string' ? tag : text(object(tag).name));
  if (result.some(tag => !tag)) throw new AppError('INVALID_RESPONSE', '作品标签名称无效。');
  return [...new Set(result as string[])];
}
/** 白名单投影；原始账户快照必须先核对，不经此函数判断未收藏。 */
export function subjectSummary(value: unknown): SubjectSummary {
  const raw = object(value); const rating = raw.rating == null ? {} : object(raw.rating);
  const id = count(raw.id, 1); if (id === null) throw new AppError('INVALID_RESPONSE', '作品缺少合法ID。');
  const type = raw.type ?? raw.subjectType;
  if (type !== undefined && type !== null && ![1, 2, 3, 4, 6].includes(type as number)) throw new AppError('INVALID_RESPONSE', '作品媒体类型无效。');
  const score = rating.score ?? raw.score;
  const result: SubjectSummary = { schemaVersion: 1, entity: 'subject', id, subjectType: typeof type === 'number' ? type : null,
    name: text(raw.name) ?? '', nameCn: text(raw.name_cn ?? raw.nameCN ?? raw.nameCn), date: text(raw.date),
    platform: text(raw.platform), score: typeof score === 'number' && score >= 0 && score <= 10 ? score : null,
    rank: count(rating.rank ?? raw.rank, 1), ratingCount: count(Object.hasOwn(raw, 'ratingCount') ? raw.ratingCount : rating.total),
    totalEpisodes: count(raw.total_episodes ?? raw.eps ?? raw.totalEpisodes), totalVolumes: count(raw.volumes ?? raw.totalVolumes),
    tags: names(raw.tags), metaTags: names(raw.meta_tags ?? raw.metaTags), url: `https://bgm.tv/subject/${id}`,
    ...(raw.relation === undefined ? {} : { relation: text(raw.relation) }), ...(raw.staff === undefined ? {} : { staff: text(raw.staff) }),
    ...(raw.characters === undefined ? {} : { characters: (() => {
      if (!Array.isArray(raw.characters)) throw new AppError('INVALID_RESPONSE', '关联角色不是数组。');
      return raw.characters.map(value => { const character = object(value); const id = count(character.id, 1);
        if (id === null) throw new AppError('INVALID_RESPONSE', '关联角色缺少合法ID。');
        return { id, name: text(character.name) ?? '', nameCn: text(character.name_cn ?? character.nameCN ?? character.nameCn), url: `https://bgm.tv/character/${id}` };
      });
    })() }) };
  checkOutput(subjectSummarySchema, result); return result;
}
export function subjectDetails(value: unknown, include: readonly SubjectInclude[], expectedId: number): SubjectDetails {
  const raw = object(value); const base = subjectSummary(raw);
  if (base.id !== expectedId || base.subjectType === null || !base.name) throw new AppError('INVALID_RESPONSE', '作品详情身份不完整或对象不一致。');
  const result: SubjectDetails = { ...base, included: [...include] };
  for (const field of include) {
    if (field === 'summary') result.summary = text(raw.summary);
    if (field === 'infobox') result.infobox = raw.infobox == null ? null : Array.isArray(raw.infobox) ? raw.infobox.map(value => {
      const item = object(value); return { key: item.key, value: Array.isArray(item.value) ? item.value.map(value => {
        const pair = object(value); return { ...(pair.k === undefined ? {} : { k: pair.k }), v: pair.v };
      }) : item.value };
    }) : (() => { throw new AppError('INVALID_RESPONSE', '作品infobox不是数组。'); })();
    if (field === 'tagStats') result.tagStats = raw.tags == null ? null : Array.isArray(raw.tags) ? raw.tags.map(value => {
      const tag = object(value); return { name: String(tag.name ?? ''), count: count(tag.count), totalCount: count(tag.total_count) };
    }) : null;
    if (field === 'ratingDistribution') {
      const rating = raw.rating == null ? {} : object(raw.rating);
      result.ratingDistribution = rating.count == null ? null : Object.fromEntries(Array.from({ length: 10 }, (_, index) =>
        [String(index + 1), count(object(rating.count)[String(index + 1)])]));
    }
  }
  checkOutput(subjectDetailsSchema, result); return result;
}
export function subjectPage(value: unknown, args: Record<string, unknown>, relation = false) {
  const raw = object(value); const data = raw.data;
  const limit = Number(args.limit ?? 30); const offset = Number(args.offset ?? 0);
  if (!Array.isArray(data) || data.length > limit || new Set(data.map(value => object(value).id)).size !== data.length
    || raw.offset !== undefined && raw.offset !== offset || raw.limit !== undefined && raw.limit !== limit) throw new AppError('INVALID_RESPONSE', '作品分页数量、重复或范围错误。');
  const total = count(raw.total);
  if (raw.total !== undefined && raw.total !== null && total === null) throw new AppError('INVALID_RESPONSE', '作品分页总数无效。');
  if (total !== null && data.length !== Math.min(limit, Math.max(0, total - offset))) throw new AppError('INCOMPLETE_DATA', '作品分页缺少记录。');
  const items = data.map(subjectSummary);
  if (!relation && items.some(item => item.subjectType === null || !item.name || args.subject_type !== undefined && item.subjectType !== args.subject_type)) throw new AppError('INVALID_RESPONSE', '作品列表身份或媒体筛选错误。');
  return { schemaVersion: 1, kind: 'page', entity: 'subject', data: items,
    page: { total, limit, offset, returnedCount: items.length,
      nextOffset: total === null ? items.length === limit ? offset + items.length : null : offset + items.length < total ? offset + items.length : null,
      complete: offset === 0 && total !== null && items.length === total }, scope: { ...args }, visibility: 'public', readAt: new Date().toISOString() };
}
/** 列表的个人字段与公开作品资料独立；完整修改快照不走此投影。 */
export function collectionPage(value: unknown, args: Record<string, unknown>) {
  const raw = object(value); if (!Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '收藏列表缺少数据。');
  const data = raw.data.map(value => {
    const row = object(value); const summary = subjectSummary(row.subject);
    const id = row.subject_id ?? summary.id;
    if (id !== summary.id || ![1, 2, 3, 4, 5].includes(row.type as number)
      || args.subject_type !== undefined && summary.subjectType !== args.subject_type
      || args.collection_type !== undefined && row.type !== args.collection_type) throw new AppError('INVALID_RESPONSE', '收藏归属、状态或筛选范围不符。');
    const rating = count(row.rate); const timestamp = row.updated_at;
    return { subject: summary, subjectId: id, collectionStatus: row.type,
      statusMeaning: ['计划', '已完成', '进行中', '搁置', '抛弃'][Number(row.type) - 1],
      personalRating: rating !== null && rating <= 10 ? rating : null, personalTags: names(row.tags),
      private: typeof row.private === 'boolean' ? row.private : null, chapters: count(row.ep_status), volumes: count(row.vol_status),
      updatedAt: typeof timestamp === 'string' ? timestamp : null };
  });
  const page = subjectPage({ ...raw, data: data.map(item => item.subject) }, args, true);
  return { ...page, entity: 'collection', data, visibility: args.username === '-' ? 'self' : 'public',
    ...(raw.account === undefined ? {} : { account: { id: object(raw.account).id, username: object(raw.account).username } }) };
}
export function indexSubjectPage(value: unknown, args: Record<string, unknown>) {
  const raw = object(value); if (!Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '目录作品列表缺少数据。');
  const data = raw.data.map(value => {
    const row = object(value); const nested = row.subject == null ? undefined : object(row.subject);
    const id = row.subject_id ?? row.sid ?? nested?.id ?? row.id;
    if (nested && nested.id !== id) throw new AppError('INVALID_RESPONSE', '目录作品归属不一致。');
    const summary = subjectSummary(nested ?? { ...row, id });
    if (args.subject_type !== undefined && summary.subjectType !== args.subject_type) throw new AppError('INVALID_RESPONSE', '目录媒体筛选不符。');
    if (args.own === true && (count(row.id, 1) === null || count(row.order) === null || typeof row.comment !== 'string')) throw new AppError('INCOMPLETE_RESPONSE', '目录关系、排序或评语不完整。');
    return { subject: summary, relationId: nested || args.own === true ? count(row.id, 1) : null,
      order: count(row.order), comment: text(row.comment) };
  });
  const page = subjectPage({ ...raw, data: data.map(item => item.subject) }, args, true);
  return { ...page, entity: 'indexSubject', data, visibility: args.own === true ? 'self' : 'public',
    ...(raw.account === undefined ? {} : { account: { id: object(raw.account).id, username: object(raw.account).username } }) };
}
