import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { AppError, diagnosedError } from '../support/errors.js';
import { createErrorDiagnostic, rememberErrorDebug } from '../support/error-diagnostic.js';
import { compileSchema, outputIssues, type JsonSchema } from '../support/tool-schema.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';

export const CANDIDATE_FIELDS = ['id', 'name', 'nameCn', 'subjectType', 'date', 'platform', 'subjectForm', 'nsfw', 'score', 'rank', 'ratingCount',
  'tags', 'metaTags', 'url', 'personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState', 'summary', 'infobox', 'relations',
  'durationMinutes'] as const;
export type CandidateField = typeof CANDIDATE_FIELDS[number];
export const CANDIDATE_INCLUDES = ['summary', 'infobox', 'relations', 'own_collection', 'subject_facts'] as const;
export const CANDIDATE_SUBJECT_FORMS = ['tv', 'ova', 'movie', 'web', 'other'] as const;
export type CandidateInclude = typeof CANDIDATE_INCLUDES[number];
export type CandidateFieldState = 'known' | 'unknown' | 'failed';
export const DEFAULT_CANDIDATE_FIELDS: CandidateField[] = ['id', 'name', 'nameCn', 'subjectType'];
export const PERSONAL_CANDIDATE_FIELDS: CandidateField[] = ['personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState'];
export const CANDIDATE_SUBJECT_FACT_FIELDS: CandidateField[] = ['id', 'name', 'nameCn', 'subjectType', 'platform', 'subjectForm', 'date', 'nsfw',
  'score', 'rank', 'ratingCount', 'tags', 'metaTags', 'url'];
export interface CandidateBounds { min?: number; max?: number }
export interface CandidateBaseFilter {
  subject_ids?: number[];
  subject_type?: number; subject_form?: string[]; air_date?: { min?: string; max?: string }; rating?: CandidateBounds; rating_count?: CandidateBounds; rank?: CandidateBounds;
  nsfw?: 'exclude' | 'account';
  tag?: string[]; meta_tags?: string[]; personal_rating?: CandidateBounds; personal_tags?: string[];
  collection_types?: number[]; exclude_collection_types?: number[];
  duration?: CandidateBounds;
}
export interface CandidateFilter extends CandidateBaseFilter { any_of?: CandidateBaseFilter[] }
export interface CandidateQueryArgs {
  candidate_ref?: string; subject_ids?: number[]; filter?: CandidateFilter; fields?: CandidateField[]; include?: CandidateInclude[];
  collection_ref?: string; cursor?: string; limit?: number; coverage_mode?: 'summary' | 'full'; response_view?: 'page' | 'reference'; hydrate_fields?: boolean;
  [key: string]: unknown;
}
export interface CandidateSource {
  tool: string; source: 'v0' | 'p1' | 'web'; scope: string; complete: boolean; scannedCount: number; total: number | null;
  nextOffset: number | null; privateRecords: 'included' | 'public_only' | 'not_applicable';
  readState?: CandidateSourceReadState;
}
/** 宿主沿同一来源的显式merge链保存的进度；不参与来源身份，不是模型输入。 */
export interface CandidateSourceReadState {
  revision: number; firstOffset: number; pagesRead: number; continuous: boolean; totalKind: 'exact' | 'estimated' | 'unknown';
  excludedNsfwCount: number; unknownNsfwCount: number;
  filterCoverage?: { scope: 'source_sequence'; scannedCount: number; matchedCount: number; unknownDateCount: number;
    unknownDateSubjectIds: number[]; complete: boolean };
}
/** 计数和游标变化不改变来源身份；scope参数顺序也不影响可引用证据。 */
export function candidateSourceRef(source: CandidateSource): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    return value;
  };
  return `cs_${createHash('sha256').update(JSON.stringify([source.tool, source.source, ordered(JSON.parse(source.scope)), source.privateRecords])).digest('hex').slice(0, 32)}`;
}
export interface CandidateSeed {
  id: number; facts: Partial<Record<CandidateField, unknown>>; fieldStates?: Partial<Record<CandidateField, CandidateFieldState>>;
  failureCodes?: Partial<Record<CandidateField, string>>; sources?: CandidateSource[]; resolvedFields?: CandidateField[]; excludesCollectionTypes?: number[]; requiresNsfw?: boolean;
}
export interface CandidateRow {
  id: number; facts: Partial<Record<CandidateField, unknown>>; fieldStates: Partial<Record<CandidateField, CandidateFieldState>>;
  failureCodes: Partial<Record<CandidateField, string>>; sources: CandidateSource[]; resolvedFields: CandidateField[]; excludesCollectionTypes: number[]; requiresNsfw: boolean;
}
export interface CandidateFactPatch {
  facts: Partial<Record<CandidateField, unknown>>; fieldStates?: Partial<Record<CandidateField, CandidateFieldState>>;
  failureCodes?: Partial<Record<CandidateField, string>>; sources?: CandidateSource[]; resolvedFields?: CandidateField[]; excludesCollectionTypes?: number[]; requiresNsfw?: boolean;
}
export interface CandidateView { id: number; fieldStates?: Partial<Record<CandidateField, 'unknown' | 'failed'>>; [key: string]: unknown }
export interface CandidateStage {
  inputCount: number; processedCount: number; matchedCount: number; excludedCount: number; pendingCount: number; remainingCount: number;
}
/** 来源计数按不同读取范围累计，scannedCount不是去重作品数。只列首次或变化来源的分组。 */
export interface CandidateSourceChange {
  tool: string; source: CandidateSource['source']; privateRecords: CandidateSource['privateRecords']; sourceCount: number;
  addedCount: number; updatedCount: number; completeSourceCount: number; incompleteSourceCount: number; unknownTotalSourceCount: number; scannedCount: number;
}
export interface CandidateScopeCoverage {
  complete: boolean; pendingCount: number; remainingCount: number; unknownCount: number; failedCount: number;
}
/** 只有不完整依赖需要保存；保留引用可区分本层已完成与祖先尚待核实。 */
export interface CandidateCoverageDependency extends CandidateScopeCoverage {
  candidateRef: string; coverageRef: string; kind: 'qualification' | 'source'; complete: false;
}
export interface CandidateCoverage {
  scope: 'candidate_set'; complete: boolean; coverageRef: string; mode: 'summary' | 'full'; sourceCount: number;
  completeSourceCount: number; incompleteSourceCount: number; unknownTotalSourceCount: number; pendingCount: number; remainingCount: number;
  unknownFieldCount: number; failedFieldCount: number; sourceChanges: CandidateSourceChange[]; sources?: CandidateSource[];
  dependencyIncompleteCount: number; dependencyPendingCount: number; dependencyRemainingCount: number; dependencyUnknownCount: number; dependencyFailedCount: number;
}
export interface CandidateCoverageArgs { coverage_ref: string; offset?: number; limit?: number }
export interface CandidateCoverageResponse {
  schemaVersion: 1; kind: 'candidate_coverage'; coverageRef: string; candidateRef: string; scope: CandidateCoverageArgs;
  coverage: CandidateCoverage; stage: CandidateStage; sources: (CandidateSource & { sourceRef: string })[];
  dependencies: CandidateCoverageDependency[];
  page: { offset: number; nextOffset: number | null; limit: number; returnedCount: number; totalCount: number; complete: boolean };
  visibility: 'public' | 'self'; account?: { id: number; username: string }; readAt: string; accessContext?: AccessContext;
}
export interface CandidateSourcePage {
  total: number | null; limit: number; offset: number; returnedCount: number; nextOffset: number | null; complete: boolean;
  totalKind?: 'exact' | 'estimated' | 'unknown'; sourceNextOffset?: number | null; sourceHasMore?: boolean; excludedNsfwCount?: number; unknownNsfwCount?: number;
}
export interface CandidateResponse {
  schemaVersion: 1; kind: 'candidate_page'; entity: 'subject_candidate'; candidateRef: string; resultRef: string; parentRef: string | null;
  responseView: 'page' | 'reference';
  collectionRef?: string; collectionScope?: CandidateCollectionScope; data: CandidateView[]; pending: { id: number; missingFields: CandidateField[]; failedFields: CandidateField[] }[];
  set: { workingCount: number; resultCount: number };
  fields: CandidateField[]; include: CandidateInclude[]; filter: CandidateFilter; scope: Record<string, unknown>;
  stage: CandidateStage;
  page: { cursor: string | null; nextCursor: string | null; limit: number; returnedCount: number; complete: boolean };
  sourcePage?: CandidateSourcePage;
  coverage: CandidateCoverage;
  visibility: 'public' | 'self'; account?: { id: number; username: string }; readAt: string; accessContext?: AccessContext;
}
export interface CandidateCollectionScope { username: string; subject_type: number; collection_type?: number; sourceComplete: boolean }
const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const count = (min = 0): JsonSchema => ({ type: 'integer', minimum: min, maximum: Number.MAX_SAFE_INTEGER });
const text = (maxLength = 300): JsonSchema => ({ type: 'string', maxLength });
const list = (maxLength = 100): JsonSchema => ({ type: 'array', maxItems: 100, uniqueItems: true, items: { ...text(maxLength), minLength: 1 } });
const fieldList: JsonSchema = { type: 'array', maxItems: CANDIDATE_FIELDS.length, uniqueItems: true, items: { enum: [...CANDIDATE_FIELDS] } };
const includes: JsonSchema = { type: 'array', maxItems: CANDIDATE_INCLUDES.length, uniqueItems: true, items: { enum: [...CANDIDATE_INCLUDES] }, default: [],
  description: 'subject_facts补基础身份/媒体/形式/日期/NSFW/公共评分统计/标签/链接，仅详情include=[]公共组；summary、infobox、relations、own_collection各自显式按需取得。' };
export const candidateFieldsSchema: JsonSchema = { ...fieldList, default: [...DEFAULT_CANDIDATE_FIELDS] };
export const candidateResponseViewSchema: JsonSchema = { enum: ['page', 'reference'], default: 'page',
  description: 'page按limit读取必要字段；reference不返回作品正文，只处理事实筛选并返回进度和引用。' };
const bounds = (minimum: number, maximum?: number, integer = false): JsonSchema => {
  const upper = maximum ?? (integer ? Number.MAX_SAFE_INTEGER : undefined);
  const value = { type: integer ? 'integer' : 'number', minimum, ...(upper === undefined ? {} : { maximum: upper }) };
  return { ...closed({ min: value, max: { ...value } }, []), minProperties: 1 };
};
const statuses: JsonSchema = { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { enum: [1, 2, 3, 4, 5] } };
export const candidateBaseFilterSchema: JsonSchema = closed({
  subject_ids: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: count(1),
    description: '在现有候选引用中保留明确ID白名单；语义判断由LLM完成后可回传选中ID，宿主只按ID匹配且复用事实与祖先引用，不重新召回。' },
  subject_type: { enum: [1, 2, 3, 4, 6], description: '本层目标媒体，不自动继承父媒体；用户限定媒体时须明确提供，与形式或语义类别分开。' }, subject_form: { type: 'array', minItems: 1, maxItems: CANDIDATE_SUBJECT_FORMS.length, uniqueItems: true,
    description: '动画形式：tv、ova、movie、web、other；媒体须为动画。', items: { enum: [...CANDIDATE_SUBJECT_FORMS] } },
  air_date: { ...closed({ min: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, max: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, []), minProperties: 1 },
  rating: bounds(0, 10), rating_count: bounds(0, undefined, true), rank: bounds(1, undefined, true), nsfw: { enum: ['exclude', 'account'] },
  tag: { ...list(), minItems: 1, description: '精确公共标签，多值为AND；语义题材可请求tags或summary后判断。' },
  meta_tags: { ...list(), minItems: 1, description: '精确元标签条件；仅用户明确要求该元标签值时作硬筛。不能用标签近似删除尚未完成语义判断的成员。' },
  personal_rating: bounds(0, 10, true), personal_tags: { ...list(), minItems: 1 }, collection_types: statuses, exclude_collection_types: statuses,
  duration: bounds(0),
}, []);
export const candidateFilterSchema: JsonSchema = closed({ ...(candidateBaseFilterSchema.properties as Record<string, JsonSchema>),
  any_of: { type: 'array', minItems: 1, maxItems: 10, description: '事实支路的OR，外层条件仍为AND，不嵌套。',
    items: { ...candidateBaseFilterSchema, minProperties: 1 } } }, []);
export const candidateProjectionProperties: Record<string, JsonSchema> = {
  fields: { ...fieldList, default: [...DEFAULT_CANDIDATE_FIELDS], description: '模型可见字段；page按需从缓存或固定资源补取，reference只处理事实筛选。完整已读资料保存在宿主。' },
  response_view: candidateResponseViewSchema,
};
export const refineCandidateInputSchema: JsonSchema = {
  ...closed({ candidate_ref: { ...text(100), minLength: 1, description: '当前读取轮次的候选引用；与subject_ids互斥，两者必选一。' },
    subject_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: count(1), description: '明确作品ID；与candidate_ref互斥，两者必选一。' },
    filter: { ...candidateFilterSchema, default: {} }, ...candidateProjectionProperties,
    collection_ref: { ...text(100), minLength: 1, description: '当前账户和媒体的收藏证据引用；多状态完整核对须全状态来源，单状态快照只能证明该状态缺席。' }, cursor: { ...text(150), minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, []),
  allOf: [{ oneOf: [{ type: 'object', properties: { candidate_ref: {} }, required: ['candidate_ref'], not: { type: 'object', properties: { subject_ids: {} }, required: ['subject_ids'] } },
    { type: 'object', properties: { subject_ids: {} }, required: ['subject_ids'], not: { type: 'object', properties: { candidate_ref: {} }, required: ['candidate_ref'] } }] }],
};
const infobox = { type: 'array', maxItems: 300, items: closed({ key: text(300), value: { anyOf: [text(20_000), { type: 'array', maxItems: 300,
  items: closed({ k: text(1000), v: text(20_000) }, ['v']) }] } }) };
export const candidateFieldSchemas: Record<CandidateField, JsonSchema> = {
  id: count(1), name: nullable(text()), nameCn: nullable(text()), subjectType: nullable({ enum: [1, 2, 3, 4, 6] }), date: nullable(text(50)),
  platform: nullable(text(100)), subjectForm: nullable({ enum: [...CANDIDATE_SUBJECT_FORMS] }), nsfw: nullable({ type: 'boolean' }), score: nullable({ type: 'number', minimum: 0, maximum: 10 }),
  rank: nullable(count(1)), ratingCount: nullable(count()), tags: nullable(list()), metaTags: nullable(list()),
  url: nullable({ ...text(100), pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' }), personalRating: nullable({ type: 'integer', minimum: 0, maximum: 10 }),
  personalTags: nullable(list()), personalComment: nullable(text(20_000)), collectionStatus: nullable({ enum: [1, 2, 3, 4, 5] }),
  collectionState: nullable({ enum: ['collected', 'not_collected', 'unknown'] }), summary: nullable(text(50_000)), infobox: nullable(infobox),
  relations: nullable({ type: 'array', maxItems: 100, items: closed({ id: count(1), relation: nullable(text(300)), name: nullable(text()), nameCn: nullable(text()),
    subjectType: nullable({ enum: [1, 2, 3, 4, 6] }), url: { ...text(100), pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' } }, ['id', 'relation']) }),
  durationMinutes: nullable({ type: 'number', minimum: 0 }),
};
const stateProperties = Object.fromEntries(CANDIDATE_FIELDS.filter(field => field !== 'id').map(field => [field, { enum: ['unknown', 'failed'] }]));
const view = closed({ ...candidateFieldSchemas, fieldStates: closed(stateProperties, []) }, ['id']);
const valueSchemas = new WeakMap<JsonSchema, JsonSchema>();
export const candidateSourceReadStateSchema: JsonSchema = closed({
  revision: { type: 'number', minimum: 0, description: '同服务的宿主单调进度版本；不表示上游内容修改时间。' },
  firstOffset: count(), pagesRead: count(1), continuous: { type: 'boolean' }, totalKind: { enum: ['exact', 'estimated', 'unknown'] },
  excludedNsfwCount: count(), unknownNsfwCount: count(),
  filterCoverage: closed({ scope: { const: 'source_sequence' }, scannedCount: count(), matchedCount: count(), unknownDateCount: count(),
    unknownDateSubjectIds: { type: 'array', uniqueItems: true, items: count(1), description: '累计未核实日期作品ID，去重；不限于单页100项。' }, complete: { type: 'boolean' } }),
}, ['revision', 'firstOffset', 'pagesRead', 'continuous', 'totalKind', 'excludedNsfwCount', 'unknownNsfwCount']);
export const candidateSourceSchema: JsonSchema = closed({ tool: { ...text(100), minLength: 1 }, source: { enum: ['v0', 'p1', 'web'] }, scope: text(4000),
  complete: { type: 'boolean' }, scannedCount: count(), total: nullable(count()), nextOffset: nullable(count()), privateRecords: { enum: ['included', 'public_only', 'not_applicable'] },
  readState: candidateSourceReadStateSchema }, ['tool', 'source', 'scope', 'complete', 'scannedCount', 'total', 'nextOffset', 'privateRecords']);
const stageSchema = closed({ inputCount: count(), processedCount: count(), matchedCount: count(), excludedCount: count(), pendingCount: count(), remainingCount: count() });
const sourceChangeSchema = closed({ tool: { ...text(100), minLength: 1 }, source: { enum: ['v0', 'p1', 'web'] },
  privateRecords: { enum: ['included', 'public_only', 'not_applicable'] }, sourceCount: count(), addedCount: count(), updatedCount: count(),
  completeSourceCount: count(), incompleteSourceCount: count(), unknownTotalSourceCount: count(), scannedCount: count() });
export const candidateScopeCoverageSchema: JsonSchema = closed({ complete: { type: 'boolean' }, pendingCount: count(), remainingCount: count(), unknownCount: count(), failedCount: count() });
export const candidateCoverageDependencySchema: JsonSchema = closed({ ...(candidateScopeCoverageSchema.properties as Record<string, JsonSchema>),
  complete: { const: false }, candidateRef: { ...text(100), minLength: 1 }, coverageRef: { ...text(100), minLength: 1 }, kind: { enum: ['qualification', 'source'] } });
export const candidateCoverageSchema: JsonSchema = {
  ...closed({ scope: { const: 'candidate_set' }, complete: { type: 'boolean' }, coverageRef: { ...text(100), minLength: 1 }, mode: { enum: ['summary', 'full'] },
    sourceCount: count(), completeSourceCount: count(), incompleteSourceCount: count(), unknownTotalSourceCount: count(), pendingCount: count(), remainingCount: count(),
    unknownFieldCount: count(), failedFieldCount: count(), sourceChanges: { type: 'array', items: sourceChangeSchema },
    dependencyIncompleteCount: count(), dependencyPendingCount: count(), dependencyRemainingCount: count(), dependencyUnknownCount: count(), dependencyFailedCount: count(),
    sources: { type: 'array', items: candidateSourceSchema } },
  ['scope', 'complete', 'coverageRef', 'mode', 'sourceCount', 'completeSourceCount', 'incompleteSourceCount', 'unknownTotalSourceCount',
    'pendingCount', 'remainingCount', 'unknownFieldCount', 'failedFieldCount', 'sourceChanges', 'dependencyIncompleteCount', 'dependencyPendingCount',
    'dependencyRemainingCount', 'dependencyUnknownCount', 'dependencyFailedCount']),
  allOf: [{ if: { properties: { mode: { const: 'full' } }, required: ['mode'] },
    then: { type: 'object', properties: { sources: {} }, required: ['sources'] },
    else: { not: { type: 'object', properties: { sources: {} }, required: ['sources'] } } }],
};
export const candidateCoverageInputSchema: JsonSchema = closed({ coverage_ref: { ...text(100), minLength: 1, description: '候选响应中的覆盖引用，仅同一读取任务和可见范围可用。' },
  offset: { ...count(), default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, ['coverage_ref']);
export const candidateCoverageValueSchema: JsonSchema = closed({ schemaVersion: { const: 1 }, kind: { const: 'candidate_coverage' },
  coverageRef: { ...text(100), minLength: 1 }, candidateRef: { ...text(100), minLength: 1 }, scope: closed(candidateCoverageInputSchema.properties as Record<string, JsonSchema>, ['coverage_ref']),
  coverage: candidateCoverageSchema, stage: stageSchema, sources: { type: 'array', maxItems: 100,
    items: closed({ ...(candidateSourceSchema.properties as Record<string, JsonSchema>), sourceRef: { ...text(100), minLength: 1 } },
      [...(candidateSourceSchema.required as string[]), 'sourceRef']) },
  dependencies: { type: 'array', items: candidateCoverageDependencySchema },
  page: closed({ offset: count(), nextOffset: nullable(count()), limit: { type: 'integer', minimum: 1, maximum: 100 }, returnedCount: count(), totalCount: count(), complete: { type: 'boolean' } }),
  visibility: { enum: ['public', 'self'] }, account: closed({ id: count(1), username: { ...text(200), minLength: 1 } }), readAt: text(50), accessContext: accessContextSchema,
}, ['schemaVersion', 'kind', 'coverageRef', 'candidateRef', 'scope', 'coverage', 'stage', 'sources', 'dependencies', 'page', 'visibility', 'readAt']);
export const candidateCoverageOutputSchema: JsonSchema = withAccessContext({ type: 'object', oneOf: [closed({ value: candidateCoverageValueSchema }),
  closed({ error: closed({ code: text(100), message: text(20_000) }) })] });
export const candidateSourcePageSchema: JsonSchema = closed({ total: nullable(count()), limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: count(),
  returnedCount: { ...count(), maximum: 100 }, nextOffset: nullable(count()), complete: { type: 'boolean' }, totalKind: { enum: ['exact', 'estimated', 'unknown'] },
  sourceNextOffset: nullable(count()), sourceHasMore: { type: 'boolean' }, excludedNsfwCount: count(), unknownNsfwCount: count() },
  ['total', 'limit', 'offset', 'returnedCount', 'nextOffset', 'complete']);
const candidateCollectionScopeSchema: JsonSchema = closed({ username: { ...text(100), minLength: 1 }, subject_type: { enum: [1, 2, 3, 4, 6] },
  collection_type: { enum: [1, 2, 3, 4, 5] }, sourceComplete: { type: 'boolean' } }, ['username', 'subject_type', 'sourceComplete']);
/** 成功值单独导出供服务端与两种客户端校验，scope由最终工具参数闭合定义。 */
export function candidateValueSchema(inputSchema: JsonSchema = refineCandidateInputSchema): JsonSchema {
  const cached = valueSchemas.get(inputSchema); if (cached) return cached;
  const schema = closed({ schemaVersion: { const: 1 }, kind: { const: 'candidate_page' }, entity: { const: 'subject_candidate' },
    candidateRef: { ...text(100), minLength: 1 }, resultRef: { ...text(100), minLength: 1 }, parentRef: nullable(text(100)), responseView: { enum: ['page', 'reference'] }, collectionRef: { ...text(100), minLength: 1 },
    data: { type: 'array', maxItems: 100, items: view }, pending: { type: 'array', maxItems: 100, items: closed({ id: count(1), missingFields: fieldList, failedFields: fieldList }) },
    set: closed({ workingCount: count(), resultCount: count() }),
    fields: fieldList, include: includes, filter: candidateFilterSchema, scope: closed(structuredClone(inputSchema.properties as Record<string, JsonSchema>), []),
    stage: stageSchema,
    page: closed({ cursor: nullable(text(150)), nextCursor: nullable(text(150)), limit: { type: 'integer', minimum: 1, maximum: 100 }, returnedCount: count(), complete: { type: 'boolean' } }),
    sourcePage: candidateSourcePageSchema, collectionScope: candidateCollectionScopeSchema,
    coverage: candidateCoverageSchema,
    visibility: { enum: ['public', 'self'] }, account: closed({ id: count(1), username: { ...text(200), minLength: 1 } }), readAt: text(50), accessContext: accessContextSchema,
  }, ['schemaVersion', 'kind', 'entity', 'candidateRef', 'resultRef', 'parentRef', 'responseView', 'data', 'pending', 'set', 'fields', 'include', 'filter', 'scope', 'stage', 'page', 'coverage', 'visibility', 'readAt']);
  valueSchemas.set(inputSchema, schema); return schema;
}
export function candidateOutputSchema(inputSchema: JsonSchema = refineCandidateInputSchema): JsonSchema {
  return withAccessContext({ type: 'object', oneOf: [closed({ value: candidateValueSchema(inputSchema) }),
    closed({ error: closed({ code: text(100), message: text(20_000) }) })] });
}
export function validateCandidateFilter(filter: CandidateFilter): void {
  if (!compileSchema(candidateFilterSchema)(filter)) throw new AppError('INVALID_INPUT', '候选筛选条件不符合固定字段契约。');
  const validateBase = (filter: CandidateBaseFilter): void => {
  for (const field of ['rating', 'rating_count', 'rank', 'personal_rating', 'air_date', 'duration'] as const) {
    const value = filter[field]; if (!value) continue;
    if (value.min === undefined && value.max === undefined || value.min !== undefined && value.max !== undefined && value.min > value.max)
      throw new AppError('INVALID_INPUT', '候选筛选范围为空或上下界相反。');
  }
  if (filter.air_date) for (const value of Object.values(filter.air_date)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError('INVALID_INPUT', '候选日期筛选必须使用有效完整日期。');
  }
  if (filter.collection_types?.some(status => filter.exclude_collection_types?.includes(status))) throw new AppError('INVALID_INPUT', '收藏状态包含条件与排除条件重叠。');
  if (filter.subject_form && filter.subject_type !== undefined && filter.subject_type !== 2) throw new AppError('INVALID_INPUT', '动画形式筛选只适用于动画类型。');
  for (const tags of [filter.tag, filter.meta_tags, filter.personal_tags]) if (tags?.some(tag => !tag.trim())) throw new AppError('INVALID_INPUT', '候选标签筛选不能为空白。');
  if (filter.meta_tags?.includes('-')) throw new AppError('INVALID_INPUT', '元标签排除条件必须提供实际标签名。');
  };
  validateBase(filter); for (const branch of filter.any_of ?? []) validateBase(branch);
}
export function validateCandidateArguments(args: Record<string, unknown>): void {
  validateCandidateFilter((args.filter ?? {}) as CandidateFilter);
  if (args.fields !== undefined && !compileSchema(fieldList)(args.fields) || args.include !== undefined && !compileSchema(includes)(args.include))
    throw new AppError('INVALID_INPUT', '候选返回字段或证据组不在固定白名单中。');
  if (args.candidate_ref !== undefined && args.subject_ids !== undefined) throw new AppError('INVALID_INPUT', '候选引用与明确作品ID必须二选一。');
  if (args.cursor !== undefined && args.candidate_ref === undefined) throw new AppError('INVALID_INPUT', '候选续页需要本阶段返回的候选引用。');
  if (args.coverage_mode !== undefined && !['summary', 'full'].includes(args.coverage_mode as string)
    || args.response_view !== undefined && !['page', 'reference'].includes(args.response_view as string)) throw new AppError('INVALID_INPUT', '候选覆盖模式或响应视图无效。');
  if (args.hydrate_fields !== undefined && typeof args.hydrate_fields !== 'boolean') throw new AppError('INVALID_INPUT', '候选展示字段补取开关必须为布尔值。');
}
export function validateCandidateCoverageArguments(args: unknown): asserts args is CandidateCoverageArgs {
  if (!compileSchema(candidateCoverageInputSchema)(args)) throw new AppError('INVALID_INPUT', '候选覆盖详情需要有效引用与分页范围。');
}
function validSource(source: CandidateSource): boolean {
  if (source.complete && source.nextOffset !== null) return false;
  try { const parsed: unknown = JSON.parse(source.scope); return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed); } catch { return false; }
}
function validCoverage(coverage: CandidateCoverage, stage: CandidateStage): boolean {
  if (coverage.sourceCount !== coverage.completeSourceCount + coverage.incompleteSourceCount || coverage.unknownTotalSourceCount > coverage.sourceCount
    || coverage.pendingCount !== stage.pendingCount || coverage.remainingCount !== stage.remainingCount
    || coverage.complete !== (stage.remainingCount === 0 && stage.pendingCount === 0 && coverage.incompleteSourceCount === 0
      && coverage.unknownFieldCount === 0 && coverage.failedFieldCount === 0 && coverage.dependencyIncompleteCount === 0)
    || coverage.dependencyIncompleteCount === 0 && (coverage.dependencyPendingCount !== 0 || coverage.dependencyRemainingCount !== 0
      || coverage.dependencyUnknownCount !== 0 || coverage.dependencyFailedCount !== 0)) return false;
  const groups = new Set<string>(); let changedCount = 0;
  for (const change of coverage.sourceChanges) {
    const key = JSON.stringify([change.tool, change.source, change.privateRecords]);
    if (groups.has(key) || change.sourceCount < 1 || change.sourceCount !== change.addedCount + change.updatedCount
      || change.sourceCount !== change.completeSourceCount + change.incompleteSourceCount || change.unknownTotalSourceCount > change.sourceCount) return false;
    groups.add(key); changedCount += change.sourceCount;
  }
  if (changedCount > coverage.sourceCount) return false;
  if (coverage.mode === 'full') {
    const sources = coverage.sources!;
    if (sources.length !== coverage.sourceCount || sources.filter(source => source.complete).length !== coverage.completeSourceCount
      || sources.filter(source => source.total === null).length !== coverage.unknownTotalSourceCount || sources.some(source => !validSource(source))) return false;
  }
  return true;
}
function validStage(stage: CandidateStage): boolean {
  return stage.processedCount === stage.matchedCount + stage.excludedCount + stage.pendingCount && stage.inputCount === stage.processedCount + stage.remainingCount;
}
function validVisibility(value: Pick<CandidateResponse, 'visibility' | 'account' | 'accessContext'>): boolean {
  return value.visibility === 'self' ? value.account !== undefined && (!value.accessContext || value.accessContext.mode === 'account'
    && isDeepStrictEqual(value.account, value.accessContext.account)) : value.account === undefined;
}
function validSourcePage(page: CandidateSourcePage): boolean {
  const kind = page.totalKind ?? (page.total === null ? 'unknown' : 'exact'), excluded = page.excludedNsfwCount ?? 0, unknown = page.unknownNsfwCount ?? 0;
  if (page.returnedCount > page.limit) return false;
  const explicit = Object.hasOwn(page, 'sourceNextOffset') || Object.hasOwn(page, 'sourceHasMore');
  let nextOffset: number | null;
  if (explicit) {
    if (!Object.hasOwn(page, 'sourceNextOffset') || typeof page.sourceHasMore !== 'boolean'
      || page.sourceHasMore !== (page.sourceNextOffset !== null) || page.sourceNextOffset !== null && page.sourceNextOffset! <= page.offset) return false;
    nextOffset = page.sourceNextOffset!;
  } else nextOffset = kind === 'exact' && page.total !== null ? page.offset + page.returnedCount < page.total ? page.offset + page.returnedCount : null
    : page.returnedCount === page.limit ? page.offset + page.returnedCount : null;
  if (kind === 'exact' && page.total !== null && excluded === 0 && unknown === 0
    && page.returnedCount !== Math.min(page.limit, Math.max(0, page.total - page.offset))) return false;
  return page.nextOffset === nextOffset && page.complete === (kind === 'exact' && page.offset === 0 && page.total !== null
    && page.returnedCount === page.total && excluded === 0 && unknown === 0);
}
export function checkCandidateResponse(value: unknown, args: Record<string, unknown>, inputSchema?: JsonSchema, expectedCollectionScope?: CandidateCollectionScope): void {
  const invalid = (reason = 'candidate_invariant_mismatch', path = ''): never => {
    const diagnostic = createErrorDiagnostic({ code: 'MCP_INVALID_RESULT', origin: 'mcp', stage: 'validate', reason,
      issues: reason === 'response_schema_invalid' ? outputIssues(candidateValueSchema(inputSchema), value)
        : [{ path, rule: reason, message: '候选返回必须与本次固定参数及覆盖计数一致' }] });
    rememberErrorDebug(diagnostic, undefined, JSON.stringify(value));
    throw diagnosedError(new AppError('MCP_INVALID_RESULT', `候选返回校验失败：${reason}，字段 ${path || '/'}。`), diagnostic);
  };
  const response = value as CandidateResponse;
  if (!compileSchema(candidateValueSchema(inputSchema))(value)) invalid('response_schema_invalid');
  const fields = [...new Set(['id', ...((args.fields as CandidateField[] | undefined) ?? DEFAULT_CANDIDATE_FIELDS)])] as CandidateField[];
  const projections: [string, unknown, unknown][] = [['scope', response.scope, args], ['fields', response.fields, fields],
    ['include', response.include, args.include ?? []], ['filter', response.filter, args.filter ?? {}],
    ['responseView', response.responseView, args.response_view ?? 'page'], ['coverage/mode', response.coverage.mode, args.coverage_mode ?? 'summary'],
    ['page/limit', response.page.limit, args.limit ?? 50], ['page/cursor', response.page.cursor, args.cursor ?? null]];
  for (const [path, actual, expected] of projections) if (!isDeepStrictEqual(actual, expected)) invalid('request_scope_mismatch', `/${path}`);
  if (response.page.returnedCount !== response.data.length) invalid('page_count_mismatch', '/page/returnedCount');
  if (response.data.length > response.page.limit || response.pending.length > response.page.limit) invalid('page_window_exceeded', '/page/limit');
  const stage = response.stage;
  if (!validStage(stage)) invalid('stage_counts_inconsistent', '/stage');
  if (response.page.complete !== (stage.remainingCount === 0)) invalid('page_completion_mismatch', '/page/complete');
  if ((response.page.nextCursor === null) !== response.page.complete) invalid('cursor_completion_mismatch', '/page/nextCursor');
  if (!validCoverage(response.coverage, stage)) invalid('coverage_counts_inconsistent', '/coverage');
  if (response.data.length > stage.matchedCount || response.pending.length > stage.pendingCount
    || response.set.resultCount > response.set.workingCount || response.set.resultCount < stage.matchedCount
    || response.set.workingCount < stage.matchedCount + stage.pendingCount + stage.remainingCount) invalid('set_counts_inconsistent', '/set');
  if (response.responseView === 'reference' && (response.data.length || response.pending.length)) invalid('reference_projection_not_empty', '/data');
  if (response.sourcePage && !validSourcePage(response.sourcePage)) invalid('source_page_inconsistent', '/sourcePage');
  if (expectedCollectionScope && !isDeepStrictEqual(response.collectionScope, expectedCollectionScope)) invalid('collection_scope_mismatch', '/collectionScope');
  if (response.collectionRef && args.username !== undefined && args.collection_ref === undefined
    && (!response.collectionScope || response.collectionScope.collection_type !== args.collection_type)) invalid();
  if (response.collectionScope && (args.username !== undefined && response.collectionScope.username !== args.username
    || args.subject_type !== undefined && response.collectionScope.subject_type !== args.subject_type
    || args.collection_type !== undefined && response.collectionScope.collection_type !== args.collection_type)) invalid();
  const ids = [...response.data, ...response.pending].map(row => row.id);
  if (new Set(ids).size !== ids.length || Array.isArray(args.subject_ids) && ids.some(id => !(args.subject_ids as unknown[]).includes(id))) invalid();
  for (const row of response.data) {
    if (Object.keys(row).some(key => key !== 'fieldStates' && !fields.includes(key as CandidateField)) || fields.some(field => !Object.hasOwn(row, field))) invalid();
    if (row.url !== undefined && row.url !== null && row.url !== `https://bgm.tv/subject/${row.id}`) invalid();
    for (const field of fields.filter(field => field !== 'id')) {
      const state = row.fieldStates?.[field];
      if ((row[field] === null) !== (state !== undefined) || state !== undefined && !['unknown', 'failed'].includes(state)) invalid();
    }
    if (Object.keys(row.fieldStates ?? {}).some(field => !fields.includes(field as CandidateField))) invalid();
    if (row.collectionState === 'not_collected' && typeof row.collectionStatus === 'number' || row.collectionState === 'collected' && row.collectionStatus === null) invalid();
  }
  for (const row of response.pending) if (!row.missingFields.length && !row.failedFields.length || row.missingFields.some(field => row.failedFields.includes(field))) invalid();
  if (!validVisibility(response)) invalid();
}
export function checkCandidateCoverageResponse(value: unknown, rawArgs: CandidateCoverageArgs | Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '候选覆盖详情的引用、来源或分页范围不一致。'); };
  if (!compileSchema(candidateCoverageInputSchema)(rawArgs)) invalid();
  const args = rawArgs as CandidateCoverageArgs;
  const response = value as CandidateCoverageResponse;
  if (!compileSchema(candidateCoverageValueSchema)(value)) invalid();
  const page = response.page;
  if (!isDeepStrictEqual(response.scope, args) || response.coverageRef !== args.coverage_ref || response.coverage.coverageRef !== response.coverageRef
    || response.coverage.mode !== 'summary' || response.coverage.sourceChanges.length !== 0 || !validStage(response.stage) || !validCoverage(response.coverage, response.stage)
    || page.offset !== (args.offset ?? 0) || page.limit !== (args.limit ?? 50) || page.offset > page.totalCount || page.totalCount !== response.coverage.sourceCount
    || page.returnedCount !== response.sources.length || response.sources.length > page.limit || page.offset + page.returnedCount > page.totalCount
    || page.complete !== (page.offset + page.returnedCount === page.totalCount)
    || page.nextOffset !== (page.complete ? null : page.offset + page.returnedCount)
    || !page.complete && page.returnedCount === 0 || response.sources.some(source => !validSource(source))
    || new Set(response.sources.map(source => source.sourceRef)).size !== response.sources.length || !validVisibility(response)) invalid();
  if (response.sources.some(source => source.sourceRef !== candidateSourceRef(source))) invalid();
  const dependencies = response.dependencies, keys = dependencies.map(dependency => JSON.stringify([dependency.coverageRef, dependency.kind]));
  if (dependencies.length !== response.coverage.dependencyIncompleteCount || new Set(keys).size !== keys.length
    || dependencies.reduce((sum, dependency) => sum + dependency.pendingCount, 0) !== response.coverage.dependencyPendingCount
    || dependencies.reduce((sum, dependency) => sum + dependency.remainingCount, 0) !== response.coverage.dependencyRemainingCount
    || dependencies.reduce((sum, dependency) => sum + dependency.unknownCount, 0) !== response.coverage.dependencyUnknownCount
    || dependencies.reduce((sum, dependency) => sum + dependency.failedCount, 0) !== response.coverage.dependencyFailedCount) invalid();
  if (page.offset === 0 && page.complete) {
    const sources = response.sources;
    if (sources.filter(source => source.complete).length !== response.coverage.completeSourceCount
      || sources.filter(source => source.total === null).length !== response.coverage.unknownTotalSourceCount) invalid();
  }
}
