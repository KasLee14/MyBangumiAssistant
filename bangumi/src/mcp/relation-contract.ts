import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { DEFAULT_CANDIDATE_FIELDS, candidateCoverageSchema, candidateFilterSchema, candidateProjectionProperties, candidateValueSchema,
  type CandidateCoverage, type CandidateField, type CandidateQueryArgs,
  type CandidateResponse } from './candidate-contract.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';

const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const integer = (minimum = 0): JsonSchema => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const text = (maxLength = 300): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const labels: JsonSchema = { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: text() };

/** 关系条件作用于父→子这条边；filter只作用于派生的子作品。 */
export interface RelationQueryArgs extends CandidateQueryArgs {
  candidate_ref: string; parent_filter?: CandidateQueryArgs['filter']; relations?: string[]; exclude_relations?: string[];
  source_limit?: number; response_view?: 'page' | 'reference'; coverage_mode?: 'summary' | 'full';
}
export interface RelationLineage {
  subjectId: number; parentCount: number; parents: { parentId: number; relation: string | null }[];
}
export interface RelationStage {
  phase: 'parents' | 'relations' | 'children' | 'complete'; depth: number;
  parentInputCount: number; parentProcessedCount: number; parentMatchedCount: number; parentExcludedCount: number;
  parentPendingCount: number; parentRemainingCount: number;
  relationParentsProcessedCount: number; relationParentsRemainingCount: number; relationScannedCount: number;
  childCount: number; duplicateChildCount: number; failedParentCount: number; unknownRelationChildCount: number;
  parentSourceComplete: boolean; parentQualificationComplete: boolean; relationSourceComplete: boolean; childFilterComplete: boolean;
}
export interface RelationResponse extends CandidateResponse {
  resultRef: string; relationStage: RelationStage; lineage: RelationLineage[];
}
export interface CandidateLineageArgs {
  candidate_ref: string; subject_ids?: number[]; offset?: number; limit?: number;
}
export interface CandidateLineageResponse {
  schemaVersion: 1; kind: 'candidate_lineage'; candidateRef: string; scope: CandidateLineageArgs;
  data: { subjectId: number; parentCount: number; parents: { parentId: number; relation: string | null;
    name: string | null; nameCn: string | null; subjectType: number | null; url: string }[] }[];
  page: { offset: number; nextOffset: number | null; limit: number; returnedCount: number; totalCount: number; complete: boolean };
  coverage: CandidateCoverage; visibility: 'public' | 'self'; account?: { id: number; username: string }; readAt: string; accessContext?: AccessContext;
}

export const relationInputSchema: JsonSchema = closed({
  candidate_ref: { ...text(100), description: '父作品宿主候选引用。优先使用上阶段resultRef；工作集会沿用其父筛选资格。' },
  parent_filter: { ...candidateFilterSchema, description: '父作品筛选；仅资格确证的父作品展开。省略时沿用输入候选阶段的筛选。' },
  relations: { ...labels, description: '父到子关系标签白名单，按上游已登记标签精确匹配；未知标签保留待核实。' },
  exclude_relations: { ...labels, description: '父到子关系标签排除名单；不能把未知关系标签当作未命中。' },
  filter: { ...candidateFilterSchema, default: {}, description: '子作品条件；与parent_filter分开。' },
  ...candidateProjectionProperties,
  collection_ref: text(100), cursor: text(150),
  source_limit: { type: 'integer', minimum: 1, maximum: 10000, default: 10000,
    description: '本次关系来源扫描窗口，可用返回游标续读；不限制父作品、关系或子作品总数。' },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  response_view: { enum: ['page', 'reference'], default: 'page', description: 'reference只返回引用、累计计数和覆盖，不输出中间候选与回溯数组。' },
}, ['candidate_ref']);

export const relationStageSchema: JsonSchema = closed({
  phase: { enum: ['parents', 'relations', 'children', 'complete'] }, depth: integer(1),
  ...Object.fromEntries(['parentInputCount', 'parentProcessedCount', 'parentMatchedCount', 'parentExcludedCount', 'parentPendingCount',
    'parentRemainingCount', 'relationParentsProcessedCount', 'relationParentsRemainingCount', 'relationScannedCount', 'childCount',
    'duplicateChildCount', 'failedParentCount', 'unknownRelationChildCount'].map(key => [key, integer()])),
  ...Object.fromEntries(['parentSourceComplete', 'parentQualificationComplete', 'relationSourceComplete', 'childFilterComplete']
    .map(key => [key, { type: 'boolean' }])),
});
const lineageSchema: JsonSchema = { type: 'array', maxItems: 100, items: closed({ subjectId: integer(1), parentCount: integer(1),
  // 只投影本页已通过子作品的边，不投影未通过的原始关系集合。完整图始终留在宿主。
  parents: { type: 'array', items: closed({ parentId: integer(1), relation: nullable({ type: 'string', maxLength: 300 }) }) },
}) };

let valueSchema: JsonSchema | undefined;
export function relationValueSchema(): JsonSchema {
  if (valueSchema) return valueSchema;
  const base = structuredClone(candidateValueSchema(relationInputSchema));
  base.properties = { ...(base.properties as Record<string, JsonSchema>), resultRef: text(100), relationStage: relationStageSchema, lineage: lineageSchema };
  base.required = [...new Set([...(base.required as string[]), 'resultRef', 'relationStage', 'lineage'])];
  valueSchema = base; return base;
}
export function relationOutputSchema(): JsonSchema {
  return withAccessContext({ type: 'object', oneOf: [closed({ value: relationValueSchema() }),
    closed({ error: closed({ code: text(100), message: { type: 'string', maxLength: 20000 } }) })] });
}
export function validateRelationArguments(args: RelationQueryArgs): void {
  if (!compileSchema(relationInputSchema)(args)) throw new AppError('INVALID_INPUT', '关联展开参数不符合固定契约。');
  if (args.relations?.some(label => !label.trim()) || args.exclude_relations?.some(label => !label.trim())
    || args.relations?.some(label => args.exclude_relations?.includes(label)))
    throw new AppError('INVALID_INPUT', '关联标签条件为空白或包含与排除条件重叠。');
}
export function checkRelationResponse(value: unknown, args: Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '关联候选的参数、阶段、回溯或覆盖声明不一致。'); };
  const result = value as RelationResponse;
  if (!compileSchema(relationValueSchema())(value) || !isDeepStrictEqual(result.scope, args)) invalid();
  const fields = [...new Set(['id', ...((args.fields as CandidateField[] | undefined) ?? DEFAULT_CANDIDATE_FIELDS)])] as CandidateField[];
  if (!isDeepStrictEqual(result.fields, fields) || !isDeepStrictEqual(result.filter, args.filter ?? {})
    || !isDeepStrictEqual(result.include, args.include ?? []) || result.responseView !== (args.response_view ?? 'page')
    || result.coverage.mode !== (args.coverage_mode ?? 'summary')
    || result.page.limit !== (args.limit ?? 50) || result.page.cursor !== (args.cursor ?? null)
    || result.page.returnedCount !== result.data.length || result.data.length > result.page.limit || result.pending.length > result.page.limit) invalid();
  const stage = result.relationStage, child = result.stage;
  if (stage.parentProcessedCount !== stage.parentMatchedCount + stage.parentExcludedCount + stage.parentPendingCount
    || stage.parentInputCount !== stage.parentProcessedCount + stage.parentRemainingCount
    || stage.relationParentsProcessedCount + stage.relationParentsRemainingCount !== stage.parentMatchedCount
    || child.processedCount !== child.matchedCount + child.excludedCount + child.pendingCount
    || child.inputCount !== child.processedCount + child.remainingCount || child.inputCount !== stage.childCount
    || result.page.complete !== (stage.phase === 'complete') || (result.page.nextCursor === null) !== result.page.complete
    || stage.childFilterComplete !== (stage.phase === 'complete' && child.pendingCount === 0)
    || result.set.resultCount !== child.matchedCount || result.set.workingCount !== child.matchedCount + child.pendingCount + child.remainingCount
    || result.coverage.pendingCount !== child.pendingCount || result.coverage.remainingCount !== child.remainingCount
    || result.coverage.sourceCount !== result.coverage.completeSourceCount + result.coverage.incompleteSourceCount
    || result.coverage.unknownTotalSourceCount > result.coverage.sourceCount
    || result.coverage.complete && (!stage.parentSourceComplete || !stage.parentQualificationComplete || !stage.relationSourceComplete || !stage.childFilterComplete
      || result.coverage.incompleteSourceCount > 0 || result.coverage.unknownFieldCount > 0 || result.coverage.failedFieldCount > 0
      || result.coverage.dependencyIncompleteCount > 0)) invalid();
  if (args.response_view === 'reference' && (result.data.length || result.pending.length || result.lineage.length)) invalid();
  const ids = new Set([...result.data, ...result.pending].map(row => row.id));
  if (ids.size !== result.data.length + result.pending.length || result.lineage.some(row => !ids.has(row.subjectId)
    || row.parentCount !== row.parents.length || new Set(row.parents.map(parent => JSON.stringify(parent))).size !== row.parents.length)) invalid();
  for (const row of result.data) {
    if (Object.keys(row).some(key => key !== 'fieldStates' && !fields.includes(key as CandidateField)) || fields.some(field => !Object.hasOwn(row, field))
      || row.url !== undefined && row.url !== null && row.url !== `https://bgm.tv/subject/${row.id}`) invalid();
    for (const field of fields.filter(field => field !== 'id')) if ((row[field] === null) !== (row.fieldStates?.[field] !== undefined)) invalid();
    if (Object.keys(row.fieldStates ?? {}).some(field => !fields.includes(field as CandidateField))) invalid();
    if (row.collectionState === 'not_collected' && typeof row.collectionStatus === 'number'
      || row.collectionState === 'collected' && row.collectionStatus === null) invalid();
  }
  for (const row of result.pending) if (!row.missingFields.length && !row.failedFields.length || row.missingFields.some(field => row.failedFields.includes(field))) invalid();
  if (result.visibility === 'self' && (!result.account || result.accessContext
    && (result.accessContext.mode !== 'account' || !isDeepStrictEqual(result.account, result.accessContext.account)))
    || result.visibility === 'public' && result.account) invalid();
}

export const candidateLineageInputSchema: JsonSchema = closed({
  candidate_ref: { ...text(100), description: '关联展开返回的candidateRef/resultRef，或其进一步筛选后派生的候选引用。' },
  subject_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: integer(1),
    description: '只查看指定成员的回溯；须全部属于当前候选集合。省略时按集合成员分页。' },
  offset: { ...integer(), default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
}, ['candidate_ref']);
export const candidateLineageValueSchema: JsonSchema = closed({
  schemaVersion: { const: 1 }, kind: { const: 'candidate_lineage' }, candidateRef: text(100),
  scope: closed(structuredClone(candidateLineageInputSchema.properties as Record<string, JsonSchema>), []),
  data: { type: 'array', maxItems: 100, items: closed({ subjectId: integer(1), parentCount: integer(1),
    parents: { type: 'array', items: closed({ parentId: integer(1), relation: nullable({ type: 'string', maxLength: 300 }),
      name: nullable({ type: 'string', maxLength: 300 }), nameCn: nullable({ type: 'string', maxLength: 300 }),
      subjectType: nullable({ enum: [1, 2, 3, 4, 6] }), url: { ...text(100), pattern: '^https://bgm\\.tv/subject/[1-9]\\d*$' } }) },
  }) },
  page: closed({ offset: integer(), nextOffset: nullable(integer()), limit: { type: 'integer', minimum: 1, maximum: 100 },
    returnedCount: integer(), totalCount: integer(), complete: { type: 'boolean' } }),
  coverage: candidateCoverageSchema, visibility: { enum: ['public', 'self'] },
  account: closed({ id: integer(1), username: text(200) }), readAt: { type: 'string', maxLength: 50 }, accessContext: accessContextSchema,
}, ['schemaVersion', 'kind', 'candidateRef', 'scope', 'data', 'page', 'coverage', 'visibility', 'readAt']);
export const candidateLineageOutputSchema: JsonSchema = withAccessContext({ type: 'object', oneOf: [closed({ value: candidateLineageValueSchema }),
  closed({ error: closed({ code: text(100), message: { type: 'string', maxLength: 20000 } }) })] });
export function checkCandidateLineageResponse(value: unknown, input: CandidateLineageArgs | Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '候选回溯的成员、分页、账户或边声明不一致。'); };
  if (!compileSchema(candidateLineageInputSchema)(input)) invalid();
  const args = input as CandidateLineageArgs;
  const result = value as CandidateLineageResponse;
  if (!compileSchema(candidateLineageValueSchema)(value) || !isDeepStrictEqual(result.scope, args) || result.candidateRef !== args.candidate_ref) invalid();
  const page = result.page;
  if (page.offset !== (args.offset ?? 0) || page.limit !== (args.limit ?? 50) || page.returnedCount !== result.data.length
    || page.returnedCount > page.limit || page.offset + page.returnedCount > page.totalCount
    || page.complete !== (page.offset + page.returnedCount === page.totalCount)
    || page.nextOffset !== (page.complete ? null : page.offset + page.returnedCount)
    || new Set(result.data.map(row => row.subjectId)).size !== result.data.length) invalid();
  for (const row of result.data) {
    if (args.subject_ids && !args.subject_ids.includes(row.subjectId) || row.parentCount !== row.parents.length
      || new Set(row.parents.map(parent => JSON.stringify([parent.parentId, parent.relation]))).size !== row.parents.length
      || row.parents.some(parent => parent.url !== `https://bgm.tv/subject/${parent.parentId}`)) invalid();
  }
  if (result.visibility === 'self' && (!result.account || result.accessContext
    && (result.accessContext.mode !== 'account' || !isDeepStrictEqual(result.account, result.accessContext.account)))
    || result.visibility === 'public' && result.account) invalid();
  if (result.coverage.mode !== 'summary' || result.coverage.sourceCount !== result.coverage.completeSourceCount + result.coverage.incompleteSourceCount
    || result.coverage.unknownTotalSourceCount > result.coverage.sourceCount
    || result.coverage.complete && (result.coverage.pendingCount || result.coverage.remainingCount || result.coverage.incompleteSourceCount
      || result.coverage.unknownFieldCount || result.coverage.failedFieldCount || result.coverage.dependencyIncompleteCount)) invalid();
}
