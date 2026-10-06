import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { CONTENT_OUTPUT_SCHEMA, MAX_CONTENT_PARTS, validateMixedPart } from '../output/content-schema.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';
import { candidateCoverageSchema, type CandidateCoverage } from './candidate-contract.js';

export const CANDIDATE_PRESENTATION_FIELDS = ['displayName', 'id', 'name', 'nameCn', 'date', 'subjectForm',
  'score', 'rank', 'ratingCount', 'url', 'collectionStatus'] as const;
export type CandidatePresentationField = typeof CANDIDATE_PRESENTATION_FIELDS[number];
/** 实测大正文截断后的保守展示预算；不限制候选数量或修改模型生成额度。 */
export const MAX_CANDIDATE_TABLE_WIRE_BYTES = 40000;
export const RESERVED_CANDIDATE_TABLE_TEXT_PARTS = 2;
export const MAX_CANDIDATE_TABLE_PARTS = MAX_CONTENT_PARTS - RESERVED_CANDIDATE_TABLE_TEXT_PARTS;
export interface CandidatePresentationArgs {
  candidate_ref: string; fields?: CandidatePresentationField[]; lineage?: 'none' | 'witness' | 'all';
  lineage_format?: 'names' | 'ids' | 'full'; offset?: number; limit?: number; max_bytes?: number; title?: string;
}
export type EffectiveCandidatePresentationArgs = Required<Omit<CandidatePresentationArgs, 'title'>> & Pick<CandidatePresentationArgs, 'title'>;
export interface CandidateTablePart {
  type: 'DataTable'; pending: false; props: { title?: string; columns: { key: string; label: string }[]; rows: Record<string, string>[] };
}
export interface CandidateTableWholePlan {
  memberCount: number; tablePartsCount: number; wholeWireBytes: number; maxWholeWireBytes: 40000;
  maxTableParts: number; reservedTextParts: 2; remainingContentSlots: number; fit: boolean;
  reasons: ('whole_bytes' | 'table_parts' | 'row_bytes')[];
}
export interface CandidateProjectionOption {
  fields: CandidatePresentationField[]; lineage: 'none' | 'witness' | 'all'; lineage_format: 'names' | 'ids';
  wholeWireBytes: number; tablePartsCount: number; fit: boolean;
}
interface CandidatePresentationBase {
  schemaVersion: 1; candidateRef: string; fields: CandidatePresentationField[];
  lineage: 'none' | 'witness' | 'all'; lineage_format: 'names' | 'ids' | 'full'; wholePlan: CandidateTableWholePlan;
  counts: { memberCount: number; preparedCount: number; remainingCount: number; unknownFieldCount: number };
  scope: EffectiveCandidatePresentationArgs; coverage: CandidateCoverage; visibility: 'public' | 'self';
  account?: { id: number; username: string }; readAt: string; accessContext?: AccessContext;
}
export interface CandidatePreparedTableResponse extends CandidatePresentationBase {
  kind: 'candidate_table'; presentation: CandidateTablePart; bytes: number;
  page: { offset: number; nextOffset: number | null; limit: number; returnedCount: number; totalCount: number; complete: boolean };
}
export interface CandidateTablePlanResponse extends CandidatePresentationBase {
  kind: 'candidate_table_plan'; status: 'projection_required';
  guidance: { keepCandidateRef: true; preserveRequiredFields: true; change: 'display_projection_only';
    message: string; projectionOptions: CandidateProjectionOption[] };
}
export type CandidatePresentationResponse = CandidatePreparedTableResponse | CandidateTablePlanResponse;
const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): JsonSchema => ({ type: 'integer', minimum, maximum });
const ref: JsonSchema = { type: 'string', minLength: 1, maxLength: 100 };
const fields: JsonSchema = { type: 'array', minItems: 1, maxItems: CANDIDATE_PRESENTATION_FIELDS.length,
  uniqueItems: true, items: { enum: [...CANDIDATE_PRESENTATION_FIELDS] }, default: ['displayName', 'url'] };
const properties: Record<string, JsonSchema> = {
  candidate_ref: { ...ref, description: '已完成本层扫描的resultRef；只读缓存，不取新事实。' }, fields,
  lineage: { enum: ['none', 'witness', 'all'], default: 'none', description: 'none不回溯；witness一条父边并列父边总数；all保留全部父边。' },
  lineage_format: { enum: ['names', 'ids', 'full'], default: 'names', description: 'names仅父名，重名或缺名用#ID辨识；ids仅#ID；full显式展示父名、重复链接及关系。关联总数始终另列，完整关系仍在缓存。' },
  offset: { ...integer(), default: 0 }, limit: { ...integer(1, 200), default: 200 },
  max_bytes: { ...integer(1024, 65536), default: 16000, description: '单个presentation的UTF-8字节预算，按完整行停止，不截字段。' },
  title: { type: 'string', maxLength: 300 },
};
export const candidatePresentationInputSchema: JsonSchema = closed(properties, ['candidate_ref']);
const tableSchema = CONTENT_OUTPUT_SCHEMA.properties!.content!.items!.anyOf!
  .find(branch => branch.properties?.type?.enum?.includes('DataTable'))!;
const wholePlanSchema = closed({ memberCount: integer(), tablePartsCount: integer(), wholeWireBytes: integer(),
  maxWholeWireBytes: { const: MAX_CANDIDATE_TABLE_WIRE_BYTES }, maxTableParts: { const: MAX_CANDIDATE_TABLE_PARTS },
  reservedTextParts: { const: RESERVED_CANDIDATE_TABLE_TEXT_PARTS }, remainingContentSlots: integer(0, MAX_CONTENT_PARTS), fit: { type: 'boolean' },
  reasons: { type: 'array', maxItems: 3, uniqueItems: true, items: { enum: ['whole_bytes', 'table_parts', 'row_bytes'] } } });
const common: Record<string, JsonSchema> = {
  schemaVersion: { const: 1 }, candidateRef: ref, fields, lineage: { enum: ['none', 'witness', 'all'] },
  lineage_format: { enum: ['names', 'ids', 'full'] }, wholePlan: wholePlanSchema,
  counts: closed({ memberCount: integer(), preparedCount: integer(), remainingCount: integer(), unknownFieldCount: integer() }),
  scope: closed(properties, ['candidate_ref', 'fields', 'lineage', 'lineage_format', 'offset', 'limit', 'max_bytes']), coverage: candidateCoverageSchema,
  visibility: { enum: ['public', 'self'] }, account: closed({ id: integer(1), username: { type: 'string', minLength: 1, maxLength: 200 } }),
  readAt: { type: 'string', maxLength: 50 }, accessContext: accessContextSchema,
};
const requiredCommon = Object.keys(common).filter(key => !['account', 'accessContext'].includes(key));
export const candidatePresentationValueSchema: JsonSchema = { oneOf: [
  closed({ ...common, kind: { const: 'candidate_table' }, presentation: structuredClone(tableSchema) as JsonSchema, bytes: integer(),
    page: closed({ offset: integer(), nextOffset: { anyOf: [integer(), { type: 'null' }] }, limit: integer(1, 200),
      returnedCount: integer(), totalCount: integer(), complete: { type: 'boolean' } }) }, [...requiredCommon, 'kind', 'presentation', 'bytes', 'page']),
  closed({ ...common, kind: { const: 'candidate_table_plan' }, status: { const: 'projection_required' }, guidance: closed({
    keepCandidateRef: { const: true }, preserveRequiredFields: { const: true }, change: { const: 'display_projection_only' },
    message: { type: 'string', minLength: 1, maxLength: 1000 }, projectionOptions: { type: 'array', maxItems: 4,
      items: closed({ fields, lineage: { enum: ['none', 'witness', 'all'] }, lineage_format: { enum: ['names', 'ids'] },
        wholeWireBytes: integer(), tablePartsCount: integer(), fit: { type: 'boolean' } }) },
  }) }, [...requiredCommon, 'kind', 'status', 'guidance']),
] };
export const candidatePresentationOutputSchema: JsonSchema = withAccessContext({ type: 'object', oneOf: [closed({ value: candidatePresentationValueSchema }),
  closed({ error: closed({ code: { type: 'string', minLength: 1, maxLength: 100 }, message: { type: 'string', maxLength: 20000 } }) })] });
export function validateCandidatePresentationArgs(input: unknown): asserts input is CandidatePresentationArgs {
  if (!compileSchema(candidatePresentationInputSchema)(input)) throw new AppError('INVALID_INPUT', '表格准备参数只允许候选引用、显示字段、回溯方式和合法窗口。');
}
export function effectiveCandidatePresentationArgs(input: CandidatePresentationArgs): EffectiveCandidatePresentationArgs {
  validateCandidatePresentationArgs(input);
  return { candidate_ref: input.candidate_ref, fields: [...(input.fields ?? ['displayName', 'url'])], lineage: input.lineage ?? 'none', lineage_format: input.lineage_format ?? 'names',
    offset: input.offset ?? 0, limit: input.limit ?? 200, max_bytes: input.max_bytes ?? 16000,
    ...(input.title === undefined ? {} : { title: input.title }) };
}
export function checkCandidatePresentationResponse(value: unknown, input: Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '表格准备的范围、整行窗口或内容契约不一致。'); };
  validateCandidatePresentationArgs(input);
  const args = effectiveCandidatePresentationArgs(input), response = value as CandidatePresentationResponse;
  if (!compileSchema(candidatePresentationValueSchema)(value) || !isDeepStrictEqual(response.scope, args)
    || response.candidateRef !== args.candidate_ref || !isDeepStrictEqual(response.fields, args.fields) || response.lineage !== args.lineage
    || response.lineage_format !== args.lineage_format || response.wholePlan.memberCount !== response.counts.memberCount) invalid();
  const plan = response.wholePlan;
  if (plan.remainingContentSlots !== Math.max(0, MAX_CONTENT_PARTS - plan.tablePartsCount)
    || plan.fit !== (plan.reasons.length === 0)
    || plan.reasons.includes('whole_bytes') !== (plan.wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES)
    || plan.reasons.includes('table_parts') !== (plan.tablePartsCount > MAX_CANDIDATE_TABLE_PARTS)) invalid();
  if (response.visibility === 'self' && (!response.account || response.accessContext && !isDeepStrictEqual(response.account, response.accessContext.account))
    || response.visibility === 'public' && response.account) invalid();
  if (response.kind === 'candidate_table_plan') {
    if (plan.fit || response.counts.preparedCount !== 0 || response.counts.remainingCount !== response.counts.memberCount
      || response.counts.unknownFieldCount !== 0 || response.guidance.projectionOptions.some(option => option.fit
        && (option.wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES || option.tablePartsCount > MAX_CANDIDATE_TABLE_PARTS))) invalid();
    return;
  }
  if (!plan.fit) invalid();
  try { validateMixedPart(response.presentation); } catch { invalid(); }
  const rows = response.presentation.props.rows, page = response.page, counts = response.counts;
  if (response.bytes !== Buffer.byteLength(JSON.stringify(response.presentation), 'utf8') || response.bytes > args.max_bytes
    || page.offset !== args.offset || page.limit !== args.limit || page.returnedCount !== rows.length || rows.length > args.limit
    || page.offset > page.totalCount || page.offset + rows.length > page.totalCount
    || counts.memberCount !== page.totalCount || counts.preparedCount !== rows.length
    || counts.remainingCount !== page.totalCount - page.offset - rows.length
    || counts.unknownFieldCount > rows.length * args.fields.length
    || page.complete !== (counts.remainingCount === 0)
    || page.nextOffset !== (page.complete ? null : page.offset + rows.length)
    || !page.complete && rows.length === 0
    || response.presentation.props.title !== args.title
    || response.presentation.props.columns.some(column => Object.hasOwn(column, 'align'))) invalid();
  const expectedKeys = [...args.fields, ...(args.lineage === 'none' ? [] : ['lineage', 'parentCount'])];
  if (!isDeepStrictEqual(response.presentation.props.columns.map(column => column.key), expectedKeys)) invalid();
  if (rows.some(row => !isDeepStrictEqual(Object.keys(row).sort(), [...expectedKeys].sort()))) invalid();
}
