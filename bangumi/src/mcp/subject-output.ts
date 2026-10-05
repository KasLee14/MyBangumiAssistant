import { AppError, ContractError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { object } from '../support/bangumi.js';
import { withAccessContext, type AccessContext } from './access-context.js';
import { checkCollectionQuery, dateMatches, fullDate, type DateBounds } from './collection-query.js';
import { normalizeInfobox, type InfoboxItem } from './infobox-output.js';
import { checkSubjectQueryCoverage } from './search-capabilities.js';
import { browseDateEvidenceSchema, resolveBrowseDate, matchesBrowseDate, checkBrowseDateEvidence } from './browse-date.js';

export const SUBJECT_INCLUDES = ['summary', 'infobox', 'tagStats', 'ratingDistribution'] as const;
export type SubjectInclude = typeof SUBJECT_INCLUDES[number];
export interface SubjectSummary {
  schemaVersion: 1; entity: 'subject'; id: number; subjectType: number | null;
  name: string; nameCn: string | null; date: string | null; platform: string | null; nsfw: boolean | null;
  score: number | null; rank: number | null; ratingCount: number | null;
  totalEpisodes: number | null; totalVolumes: number | null;
  tags: string[] | null; metaTags: string[] | null; url: string;
  relation?: string | null; staff?: string | null;
  series?: boolean | null;
  characters?: { id: number; name: string; nameCn: string | null; url: string }[];
}
export interface SubjectDetails extends SubjectSummary {
  included: SubjectInclude[]; summary?: string | null; infobox?: InfoboxItem[] | null;
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
  nsfw: nullable({ type: 'boolean' }),
  rank: nullable(integer(1)), ratingCount: nullable(integer()), totalEpisodes: nullable(integer()), totalVolumes: nullable(integer()),
  tags: stringList, metaTags: stringList, url: { ...string(100), pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' },
  relation: nullable(string(300)), staff: nullable(string(300)),
  series: nullable({ type: 'boolean' }),
  characters: { type: 'array', maxItems: 100, items: closed({ id: integer(1), name: string(300), nameCn: nullable(string(300)),
    url: { ...string(100), pattern: '^https://bgm\\.tv/character/[1-9]\\d*$' } }) },
};
const required = Object.keys(properties).filter(key => !['relation', 'staff', 'characters', 'series'].includes(key));
export const subjectSummarySchema = closed(properties, required);
const browseSummarySchema = closed({ ...properties, dateEvidence: browseDateEvidenceSchema }, [...required, 'dateEvidence']);
const browseFilterCoverageSchema = closed({
  scope: { const: 'source_window', description: '仅评价当前来源窗口的日期筛选核实，不代表全站完整。' },
  scannedCount: { ...integer(), maximum: 100, description: '当前窗口经NSFW处理后参与日期核实的条目数。' },
  matchedCount: { ...integer(), maximum: 100 }, unknownDateCount: { ...integer(), maximum: 100 },
  unknownDateSubjectIds: { type: 'array', maxItems: 100, uniqueItems: true, items: integer(1) },
  complete: { type: 'boolean', description: '当前窗口日期筛选没有未知条目；分页和NSFW覆盖另见page/accessContext。' },
});
const infoboxSchema = { type: 'array', maxItems: 300, items: closed({ key: string(300), value: {
  anyOf: [string(20_000), { type: 'array', maxItems: 300, items: closed({ k: string(1000), v: string(20_000) }, ['v']) }],
} }) };
export const subjectDetailsSchema = closed({ ...properties,
  included: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...SUBJECT_INCLUDES] } },
  summary: nullable(string(50_000)), infobox: nullable(infoboxSchema),
  tagStats: nullable({ type: 'array', maxItems: 100, items: closed({ name: string(100), count: nullable(integer()), totalCount: nullable(integer()) }) }),
  ratingDistribution: nullable(closed(Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), nullable(integer())])))),
}, [...required, 'included']);
export const paginationExtraProperties: Record<string, JsonSchema> = {
  totalKind: { enum: ['estimated', 'exact', 'unknown'] }, sourceNextOffset: nullable(integer()), sourceHasMore: { type: 'boolean' },
  excludedNsfwCount: integer(), unknownNsfwCount: integer(),
};
const pageSchema = closed({ total: nullable(integer()), limit: { ...integer(1), maximum: 100 }, offset: integer(),
  returnedCount: { ...integer(), maximum: 100 }, nextOffset: nullable(integer()), complete: { type: 'boolean' }, ...paginationExtraProperties },
  ['total', 'limit', 'offset', 'returnedCount', 'nextOffset', 'complete']);
/** 分页游标绑定实际读取的来源窗口；被过滤的资料不缩短上游游标。 */
export function pageMetadata(raw: Record<string, unknown>, length: number, limit: number, offset: number) {
  const total = count(raw.total), totalKind = raw.totalKind ?? (total === null ? 'unknown' : 'exact');
  if (!['estimated', 'exact', 'unknown'].includes(String(totalKind))) throw new AppError('INVALID_RESPONSE', '分页总数性质无效。');
  const explicit = Object.hasOwn(raw, 'sourceNextOffset') || Object.hasOwn(raw, 'sourceHasMore');
  let nextOffset: number | null;
  if (explicit) {
    nextOffset = count(raw.sourceNextOffset);
    if (typeof raw.sourceHasMore !== 'boolean' || !Object.hasOwn(raw, 'sourceNextOffset')
      || raw.sourceHasMore !== (nextOffset !== null) || nextOffset !== null && nextOffset <= offset) throw new AppError('INVALID_RESPONSE', '来源窗口分页游标无效。');
  } else nextOffset = totalKind === 'exact' && total !== null ? offset + length < total ? offset + length : null : length === limit ? offset + length : null;
  const excluded = count(raw.excludedNsfwCount) ?? 0, unknown = count(raw.unknownNsfwCount) ?? 0;
  if (totalKind === 'exact' && total !== null && excluded === 0 && unknown === 0
    && length !== Math.min(limit, Math.max(0, total - offset))) throw new AppError('INCOMPLETE_DATA', '分页缺少记录。');
  return { total, limit, offset, returnedCount: length, nextOffset,
    complete: totalKind === 'exact' && offset === 0 && total !== null && length === total && excluded === 0 && unknown === 0,
    ...(raw.totalKind === undefined ? {} : { totalKind }),
    ...(explicit ? { sourceNextOffset: nextOffset, sourceHasMore: raw.sourceHasMore } : {}),
    ...(raw.excludedNsfwCount === undefined ? {} : { excludedNsfwCount: excluded }),
    ...(raw.unknownNsfwCount === undefined ? {} : { unknownNsfwCount: unknown }) };
}
export function checkPageMetadata(page: Record<string, unknown>, length: number, coverageKind?: unknown): void {
  try {
    if (coverageKind !== undefined && page.totalKind !== undefined && page.totalKind !== coverageKind) throw new Error('total kind');
    const expected = pageMetadata({ ...page, totalKind: page.totalKind ?? coverageKind }, length, Number(page.limit), Number(page.offset));
    if (page.nextOffset !== expected.nextOffset || page.complete !== expected.complete) throw new Error('pagination');
  } catch { throw new AppError('MCP_INVALID_RESULT', '列表返回的来源分页或完整性不一致。'); }
}
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
    personalTags: stringList, private: nullable({ type: 'boolean' }), chapters: { ...nullable(integer()), description: '书籍已读章数；动画/三次元为派生已看集数，不能直接写ep_status。' }, volumes: nullable(integer()), updatedAt: nullable(string(100)),
  });
  const indexItem = closed({ subject: subjectSummarySchema, relationId: nullable(integer(1)), order: nullable(integer()), comment: nullable(string(2000)) });
  const collection = name === 'get_user_collections'; const index = name === 'get_index_subjects'; const browse = name === 'browse_subjects';
  const page = closed({ schemaVersion: { type: 'integer', const: 1 }, kind: { type: 'string', const: 'page' },
    entity: { type: 'string', const: collection ? 'collection' : index ? 'indexSubject' : 'subject' },
    data: { type: 'array', maxItems: 100, items: collection ? collectionItem : index ? indexItem : browse ? browseSummarySchema : subjectSummarySchema },
    page: pageSchema, scope, visibility: { type: 'string', enum: collection || index ? ['public', 'self'] : ['public'] }, readAt: string(50),
    ...(collection || index ? { account: closed({ id: integer(1), username: { ...string(200), minLength: 1 } }) } : {}),
    ...(browse ? { filterCoverage: browseFilterCoverageSchema } : {}),
  }, ['schemaVersion', 'kind', 'entity', 'data', 'page', 'scope', 'visibility', 'readAt', ...(browse ? ['filterCoverage'] : [])]);
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
  return withAccessContext({ type: 'object', oneOf: [closed({ value }), closed({ error: safeErrorSchema })] });
}
export function checkOutput(schema: JsonSchema, value: unknown): void {
  if (!compileSchema(schema)(value)) throw new AppError('MCP_INVALID_RESULT', 'MCP返回不符合固定输出契约。');
}
/** DTO验证之外，输出还必须与本次固定参数匹配；不采信异对象/异范围结果。 */
export function checkSubjectResponse(name: string, value: unknown, args: Record<string, unknown>): void {
  if (name === 'query_user_collections') { checkCollectionQuery(value, args); return; }
  if (!SUBJECT_OUTPUT_TOOLS.has(name)) return;
  const raw = object(value);
  checkSubjectQueryCoverage(name, args, raw);
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
    if ((name === 'search_subjects' || name === 'browse_subjects') && object(result.accessContext).queryCoverage
      && object(object(result.accessContext).queryCoverage).nsfw === 'excluded' && subjects.some(subject => subject.nsfw !== false)) throw new AppError('MCP_INVALID_RESULT', '非R18范围的作品缺少明确的可见性事实。');
    if (new Set(subjects.map(subject => subject.id)).size !== subjects.length
      || subjects.some(subject => subject.url !== `https://bgm.tv/subject/${subject.id}` || args.subject_type !== undefined && subject.subjectType !== args.subject_type)
      || result.entity === 'collection' && data.some(value => args.collection_type !== undefined && object(value).collectionStatus !== args.collection_type)) throw new AppError('MCP_INVALID_RESULT', '作品返回身份、链接或筛选条件不一致。');
    if (name === 'search_subjects' && args.filter) {
      const filter = args.filter as Record<string, unknown>;
      for (const subject of subjects) {
        if (filter.nsfw === 'exclude' && subject.nsfw !== false) throw new AppError('MCP_INVALID_RESULT', '搜索作品没有明确满足非R18条件。');
        if (filter.air_date) { const date = fullDate(subject.date); if (!date || !dateMatches(date, filter.air_date as DateBounds)) throw new AppError('MCP_INVALID_RESULT', '搜索作品日期不符合明确条件。'); }
        for (const [input, field] of [['rating', 'score'], ['rating_count', 'ratingCount'], ['rank', 'rank']] as const) {
          if (!filter[input]) continue; const bounds = filter[input] as { min?: number; max?: number }; const actual = subject[field];
          if (typeof actual !== 'number' || bounds.min !== undefined && actual < bounds.min || bounds.max !== undefined && actual > bounds.max) throw new AppError('MCP_INVALID_RESULT', '搜索作品数值不符合明确条件。');
        }
      }
    }
    if (name === 'browse_subjects') for (const subject of subjects) {
      checkBrowseDateEvidence(subject);
      if (matchesBrowseDate(subject.dateEvidence as ReturnType<typeof resolveBrowseDate>, args) !== 'match')
        throw new ContractError('browse_date_mismatch', '/data/dateEvidence', Number(subject.id));
      checkBrowseForm(subject, args);
    }
    if (name === 'browse_subjects') {
      const coverage = object(result.filterCoverage);
      const ids = coverage.unknownDateSubjectIds;
      const consumed = Number(coverage.scannedCount) + Number(page.excludedNsfwCount ?? 0) + Number(page.unknownNsfwCount ?? 0);
      if (!compileSchema(browseFilterCoverageSchema)(coverage) || !Array.isArray(ids)
        || coverage.matchedCount !== data.length || coverage.unknownDateCount !== ids.length
        || coverage.scannedCount !== data.length + ids.length || Number(coverage.scannedCount) > Number(args.limit)
        || ids.some(id => subjects.some(subject => subject.id === id))
        || coverage.complete !== (ids.length === 0) || args.year === undefined && args.month === undefined && ids.length !== 0
        || consumed > Number(args.limit) || !Object.hasOwn(page, 'sourceNextOffset') || !Object.hasOwn(page, 'sourceHasMore')
        || page.sourceNextOffset !== null && page.sourceNextOffset !== Number(args.offset) + consumed) {
        throw new ContractError('browse_filter_coverage_invalid', '/filterCoverage', null);
      }
    }
    if (page.limit !== args.limit || page.offset !== args.offset || page.returnedCount !== data.length
      || Object.keys(args).some(key => JSON.stringify(scope[key]) !== JSON.stringify(args[key]))
      || Object.keys(scope).length !== Object.keys(args).length
      || result.visibility !== (args.username === '-' || args.own === true ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '作品列表返回范围或可见性不一致。');
    checkPageMetadata(page, data.length, (result.accessContext as AccessContext | undefined)?.queryCoverage?.totalKind);
  }
}
function count(value: unknown, minimum = 0): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new AppError('INVALID_RESPONSE', '作品数字字段类型或范围无效，不能转换为未知值。');
  return value;
}
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AppError('INVALID_RESPONSE', '作品文本字段类型无效，不能转换为未知值。');
  return value;
}
function optionalText(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new AppError('INVALID_RESPONSE', `作品详情字段 ${path} 应为字符串或空值。`);
  return value;
}
function optionalCount(value: unknown, path: string): number | null {
  if (value == null) return null;
  const result = count(value);
  if (result === null) throw new AppError('INVALID_RESPONSE', `作品详情字段 ${path} 应为非负安全整数或空值。`);
  return result;
}
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
  if (score !== undefined && score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10)) throw new AppError('INVALID_RESPONSE', '作品评分字段无效。');
  if (raw.nsfw !== undefined && raw.nsfw !== null && typeof raw.nsfw !== 'boolean') throw new AppError('INVALID_RESPONSE', '作品NSFW字段必须是布尔值或未知。');
  const rank = rating.rank ?? raw.rank;
  const result: SubjectSummary = { schemaVersion: 1, entity: 'subject', id, subjectType: typeof type === 'number' ? type : null,
    name: text(raw.name) ?? '', nameCn: text(raw.name_cn ?? raw.nameCN ?? raw.nameCn), date: text(raw.date),
    platform: text(raw.platform), nsfw: typeof raw.nsfw === 'boolean' ? raw.nsfw : null, score: typeof score === 'number' && score >= 0 && score <= 10 ? score : null,
    rank: rank === 0 ? null : count(rank, 1), ratingCount: count(Object.hasOwn(raw, 'ratingCount') ? raw.ratingCount : rating.total),
    totalEpisodes: count(raw.total_episodes ?? raw.eps ?? raw.totalEpisodes), totalVolumes: count(raw.volumes ?? raw.totalVolumes),
    tags: names(raw.tags), metaTags: names(raw.meta_tags ?? raw.metaTags), url: `https://bgm.tv/subject/${id}`,
    ...(raw.relation === undefined ? {} : { relation: text(raw.relation) }), ...(raw.staff === undefined ? {} : { staff: text(raw.staff) }),
    ...(raw.series === undefined ? {} : { series: raw.series === null || typeof raw.series === 'boolean' ? raw.series : (() => { throw new AppError('INVALID_RESPONSE', '作品系列标志无效。'); })() }),
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
    if (field === 'summary') result.summary = optionalText(raw.summary, '/summary');
    if (field === 'infobox') result.infobox = normalizeInfobox(raw.infobox);
    if (field === 'tagStats') result.tagStats = raw.tags == null ? null : Array.isArray(raw.tags) ? raw.tags.map((value, index) => {
      const tag = object(value);
      if (typeof tag.name !== 'string') throw new AppError('INVALID_RESPONSE', `作品详情字段 /tags/${index}/name 应为字符串。`);
      return { name: tag.name, count: optionalCount(tag.count, `/tags/${index}/count`), totalCount: optionalCount(tag.total_count, `/tags/${index}/total_count`) };
    }) : (() => { throw new AppError('INVALID_RESPONSE', '作品详情字段 /tags 应为数组或空值。'); })();
    if (field === 'ratingDistribution') {
      const rating = raw.rating == null ? {} : object(raw.rating);
      if (Array.isArray(rating.count) && rating.count.length !== 10) throw new AppError('INVALID_RESPONSE', '账户评分分布须完整提供1至10分的十个计数。');
      const distribution = Array.isArray(rating.count) ? Object.fromEntries(rating.count.map((value, index) => [String(index + 1), value])) : rating.count;
      result.ratingDistribution = rating.count == null ? null : Object.fromEntries(Array.from({ length: 10 }, (_, index) =>
        [String(index + 1), optionalCount(object(distribution)[String(index + 1)], `/rating/count/${index + 1}`)]));
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
  const items = data.map(subjectSummary);
  if (!relation && items.some(item => item.subjectType === null || !item.name || args.subject_type !== undefined && item.subjectType !== args.subject_type)) throw new AppError('INVALID_RESPONSE', '作品列表身份或媒体筛选错误。');
  return { schemaVersion: 1, kind: 'page', entity: 'subject', data: items,
    page: pageMetadata(raw, items.length, limit, offset), scope: { ...args }, visibility: 'public', readAt: new Date().toISOString() };
}
/** 在NSFW/日期过滤之前冻结连续来源窗口的游标，避免短页或空页漏读。 */
export function browseSourceWindow(value: unknown, args: Record<string, unknown>) {
  const raw = object(value);
  const base = subjectPage({ ...raw, totalKind: 'unknown' }, args);
  const offset = Number(args.offset ?? 0);
  const hasMore = Object.hasOwn(raw, 'sourceHasMore') ? raw.sourceHasMore === true
    : base.page.nextOffset !== null || typeof raw.total === 'number' && offset + base.data.length < raw.total;
  if (hasMore && base.data.length === 0) throw new AppError('INCOMPLETE_DATA', '浏览来源声称还有记录但返回空窗口，不能推进分页。');
  return { ...raw, totalKind: 'unknown', sourceNextOffset: hasMore ? base.page.nextOffset ?? offset + base.data.length : null, sourceHasMore: hasMore };
}
export function browseSubjectPage(value: unknown, args: Record<string, unknown>) {
  const raw = object(value);
  // 直接调用适配器时也先计算来源游标；服务链路已在NSFW过滤前冻结它。
  const window: Record<string, unknown> = Object.hasOwn(raw, 'sourceNextOffset') ? raw : browseSourceWindow(raw, args);
  const base = subjectPage(window, args);
  const unknownDateSubjectIds: number[] = [];
  const data = base.data.flatMap((subject, index) => {
    // 日期未知不能掩盖来源已明确违反的其他硬条件。
    checkBrowseForm(subject as unknown as Record<string, unknown>, args);
    const dateEvidence = resolveBrowseDate(object((window.data as unknown[])[index]));
    const match = matchesBrowseDate(dateEvidence, args);
    if (match === 'mismatch') throw new ContractError('browse_date_mismatch', '/data/dateEvidence', subject.id);
    if (match === 'unknown') { unknownDateSubjectIds.push(subject.id); return []; }
    return [{ ...subject, dateEvidence }];
  });
  return { ...base, data, page: { ...base.page, returnedCount: data.length, complete: false },
    filterCoverage: { scope: 'source_window', scannedCount: base.data.length, matchedCount: data.length,
      unknownDateCount: unknownDateSubjectIds.length, unknownDateSubjectIds, complete: unknownDateSubjectIds.length === 0 } };
}
function checkBrowseForm(subject: Record<string, unknown>, args: Record<string, unknown>): void {
  if (args.platform !== undefined && subject.platform !== args.platform) throw new AppError('MCP_INVALID_RESULT', '浏览作品平台不符合明确条件。');
  if (args.cat !== undefined && browseCategory(Number(subject.subjectType), subject.platform) !== args.cat) throw new AppError('MCP_INVALID_RESULT', '浏览作品形式未知或不符合明确cat条件。');
  if (args.series !== undefined && subject.series !== args.series) throw new AppError('MCP_INVALID_RESULT', '浏览作品系列事实未知或不符合明确条件。');
}
function browseCategory(type: number, platform: unknown): number | null {
  if (typeof platform !== 'string') return null;
  const groups: Record<number, Record<number, string[]>> = {
    1: { 0: ['其他'], 1001: ['漫画'], 1002: ['小说'], 1003: ['画集'] },
    2: { 0: ['其他'], 1: ['TV', 'TV动画'], 2: ['OVA', 'OAD'], 3: ['Movie', '剧场版', '电影'], 5: ['WEB', 'ONA', '网络动画'] },
    3: { 0: ['音乐', '其他'] }, 4: { 0: ['其他'], 4001: ['游戏'], 4002: ['软件'], 4003: ['扩展包'], 4005: ['桌游'] },
    6: { 0: ['其他'], 1: ['日剧'], 2: ['欧美剧'], 3: ['华语剧'], 6001: ['电视剧'], 6002: ['电影'], 6003: ['演出'], 6004: ['综艺'] },
  };
  const found = Object.entries(groups[type] ?? {}).find(([, names]) => names.some(name => name.toLowerCase() === platform.trim().toLowerCase()));
  return found ? Number(found[0]) : null;
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
    if (rating !== null && rating > 10 || row.private !== undefined && row.private !== null && typeof row.private !== 'boolean') throw new AppError('INVALID_RESPONSE', '个人评分或私密字段类型/范围无效。');
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
