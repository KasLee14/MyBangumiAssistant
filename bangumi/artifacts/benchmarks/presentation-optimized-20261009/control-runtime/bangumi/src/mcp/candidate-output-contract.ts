import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { MAX_CONTENT_PARTS, CONTENT_OUTPUT_SCHEMA, validateMixedContent, validateMixedPart } from '../output/content-schema.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';
import { candidateCoverageSchema, type CandidateCoverage } from './candidate-contract.js';
import { CANDIDATE_PRESENTATION_FIELDS, MAX_CANDIDATE_TABLE_WIRE_BYTES, MAX_CANDIDATE_TABLE_PARTS,
  type CandidatePresentationField, type CandidateProjectionOption, type CandidateTablePart } from './candidate-presentation-contract.js';

export const CANDIDATE_CARD_FIELDS = ['nameCn', 'score', 'scoreCount', 'rank', 'date', 'summary', 'tags', 'image'] as const;
export type CandidateCardField = typeof CANDIDATE_CARD_FIELDS[number];
export interface CandidateOutputReason { subject_id: number; reason: string }
interface CandidateOutputCommonArgs { candidate_ref: string; offset?: number; limit?: number; completion_scope?: 'selected' | 'exhaustive'; title?: string; introduction?: string; conclusion?: string }
export interface CandidateTableOutputArgs extends CandidateOutputCommonArgs {
  format?: 'table'; fields?: CandidatePresentationField[]; lineage?: 'none' | 'witness' | 'all';
  lineage_format?: 'names' | 'ids' | 'full'; max_bytes?: number;
}
export interface CandidateCardOutputArgs extends CandidateOutputCommonArgs {
  format: 'subject_cards'; card_fields?: CandidateCardField[]; layout?: 'list' | 'grid'; reasons?: CandidateOutputReason[];
}
export type CandidateOutputArgs = CandidateTableOutputArgs | CandidateCardOutputArgs;
export type EffectiveCandidateOutputArgs = (CandidateOutputCommonArgs & {
  format: 'table'; completion_scope: 'selected' | 'exhaustive'; fields: CandidatePresentationField[]; lineage: 'none' | 'witness' | 'all';
  lineage_format: 'names' | 'ids' | 'full'; max_bytes: number;
}) | (CandidateOutputCommonArgs & { format: 'subject_cards'; completion_scope: 'selected' | 'exhaustive'; card_fields: CandidateCardField[];
  layout: 'list' | 'grid'; reasons: CandidateOutputReason[] });
export interface CandidateOutputText { type: 'text'; nextType: 'DataTable' | 'SubjectCards' | 'text' | null; text: string }
export interface CandidateCardItem {
  id: number; name: string; kind: 'book' | 'anime' | 'music' | 'game' | 'real'; url: string;
  nameCn?: string; score?: number; scoreCount?: number; rank?: number;
  date?: string; summary?: string; tags?: string[]; image?: string;
}
export interface CandidateCardPart {
  type: 'SubjectCards'; pending: false; props: { title?: string; layout: 'list' | 'grid'; total: number; items: CandidateCardItem[] };
}
export type CandidateOutputPart = CandidateOutputText | CandidateTablePart | CandidateCardPart;
export interface CandidateOutputPresentation { content: CandidateOutputPart[] }
export interface CandidateOutputWholePlan {
  memberCount: number; contentPartsCount: number; wholeWireBytes: number; maxWholeWireBytes: 40000;
  maxContentParts: 16; fit: boolean; reasons: ('whole_bytes' | 'content_parts' | 'table_parts' | 'row_bytes')[];
}
interface CandidateOutputBase {
  schemaVersion: 1; candidateRef: string; format: 'table' | 'subject_cards'; scope: EffectiveCandidateOutputArgs;
  counts: { memberCount: number; preparedCount: number; remainingCount: number; unknownFieldCount: number };
  wholePlan: CandidateOutputWholePlan; coverage: CandidateCoverage; visibility: 'public' | 'self';
  account?: { id: number; username: string }; readAt: string; accessContext?: AccessContext;
}
export interface CandidatePreparedOutputResponse extends CandidateOutputBase {
  kind: 'candidate_output'; presentation: CandidateOutputPresentation; bytes: number;
  page?: { offset: number; nextOffset: number | null; limit: number; returnedCount: number; totalCount: number; complete: boolean };
}
export interface CandidateOutputPlanResponse extends CandidateOutputBase {
  kind: 'candidate_output_plan'; status: 'projection_required'; guidance: {
    keepCandidateRef: true; preserveRequiredFields: true; preserveReasons: true; change: 'display_projection_only';
    message: string; projectionOptions: CandidateProjectionOption[];
  };
}
export type CandidateOutputResponse = CandidatePreparedOutputResponse | CandidateOutputPlanResponse;

const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const count = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): JsonSchema => ({ type: 'integer', minimum, maximum });
const ref: JsonSchema = { type: 'string', minLength: 1, maxLength: 100 };
const fields: JsonSchema = { type: 'array', minItems: 1, maxItems: CANDIDATE_PRESENTATION_FIELDS.length, uniqueItems: true,
  items: { enum: [...CANDIDATE_PRESENTATION_FIELDS] }, default: ['displayName', 'url'] };
const cardFields: JsonSchema = { type: 'array', maxItems: CANDIDATE_CARD_FIELDS.length, uniqueItems: true,
  items: { enum: [...CANDIDATE_CARD_FIELDS] }, default: ['nameCn'],
  description: '额外卡片事实字段；同一候选缓存中已核实的封面由宿主自动附加。显式image可按原范围补齐缺失封面，不猜测地址。' };
const commonArgs: Record<string, JsonSchema> = { candidate_ref: { ...ref, description: '已完成本层选择的resultRef；只展示此引用成员，默认只读缓存。显式image缺失时仅在原成员范围补图；权限与当前必要条件仍须有效。' },
  offset: { ...count(), description: '同一结果引用的交付起点；指定offset或limit启用分页，不改变集合及覆盖。' },
  limit: { ...count(1, 100), description: '单次交付最多成员数；实际数量也受内容容量约束，按page.nextOffset继续。' },
  title: { type: 'string', maxLength: 300 }, introduction: { type: 'string', maxLength: 4000 }, conclusion: { type: 'string', maxLength: 4000 } };
const tableProperties: Record<string, JsonSchema> = { ...commonArgs, format: { const: 'table', default: 'table' }, fields,
  completion_scope: { enum: ['selected', 'exhaustive'], default: 'exhaustive', description: 'exhaustive还须来源与上游扫描耗尽；selected仅交付已处理完成的选集并保留母池覆盖缺口，不放宽选中作品条件。' },
  lineage: { enum: ['none', 'witness', 'all'], default: 'none' }, lineage_format: { enum: ['names', 'ids', 'full'], default: 'names' },
  max_bytes: { ...count(1024, 65536), default: 16000, description: '内部表格单块预算；每次交付仍受40000字节内容根限制。'  } };
const cardProperties: Record<string, JsonSchema> = { ...commonArgs, format: { const: 'subject_cards' }, card_fields: cardFields,
  completion_scope: { enum: ['selected', 'exhaustive'], default: 'selected', description: '少量推荐selected不要求未选母池扫描耗尽，但已选集合必须完成本层处理、资格与权限核实；全量请求使用exhaustive。' },
  layout: { enum: ['list', 'grid'], default: 'list' }, reasons: { type: 'array', default: [], items: closed({ subject_id: count(1),
    reason: { type: 'string', minLength: 1, maxLength: 4000 } }),
    description: '当前resultRef内每个已选作品至多一条模型理由；宿主仅按ID关联为Text并转义，不改事实summary。' } };
export const candidateOutputInputSchema: JsonSchema = { type: 'object', oneOf: [closed(tableProperties, ['candidate_ref']), closed(cardProperties, ['candidate_ref', 'format'])] };
// 模型的工具schema根可见全部字段；严格互斥与defaults仍只由格式分支负责。
const visibleProperties: Record<string, JsonSchema> = {};
for (const branch of candidateOutputInputSchema.oneOf as JsonSchema[]) for (const [key, schema] of Object.entries(branch.properties as Record<string, JsonSchema>)) {
  const property = structuredClone(schema); delete property.default; visibleProperties[key] = property;
}
visibleProperties.format = { enum: ['table', 'subject_cards'] };
candidateOutputInputSchema.properties = visibleProperties;
const scopeSchema: JsonSchema = { oneOf: [closed(tableProperties, ['candidate_ref', 'format', 'completion_scope', 'fields', 'lineage', 'lineage_format', 'max_bytes']),
  closed(cardProperties, ['candidate_ref', 'format', 'completion_scope', 'card_fields', 'layout', 'reasons'])] };
const wholePlanSchema = closed({ memberCount: count(), contentPartsCount: count(), wholeWireBytes: count(),
  maxWholeWireBytes: { const: MAX_CANDIDATE_TABLE_WIRE_BYTES }, maxContentParts: { const: MAX_CONTENT_PARTS }, fit: { type: 'boolean' },
  reasons: { type: 'array', maxItems: 4, uniqueItems: true, items: { enum: ['whole_bytes', 'content_parts', 'table_parts', 'row_bytes'] } } });
const common: Record<string, JsonSchema> = { schemaVersion: { const: 1 }, candidateRef: ref, format: { enum: ['table', 'subject_cards'] }, scope: scopeSchema,
  counts: closed({ memberCount: count(), preparedCount: count(), remainingCount: count(), unknownFieldCount: count() }), wholePlan: wholePlanSchema,
  coverage: candidateCoverageSchema, visibility: { enum: ['public', 'self'] },
  account: closed({ id: count(1), username: { type: 'string', minLength: 1, maxLength: 200 } }),
  readAt: { type: 'string', maxLength: 50 }, accessContext: accessContextSchema };
const requiredCommon = Object.keys(common).filter(key => !['account', 'accessContext'].includes(key));
const providerBranches = CONTENT_OUTPUT_SCHEMA.properties!.content!.items!.anyOf!
  .filter(branch => branch.properties?.type?.enum?.some(value => ['text', 'DataTable', 'SubjectCards'].includes(String(value))));
const presentationSchema = closed({ content: { type: 'array', minItems: 1, maxItems: MAX_CONTENT_PARTS,
  items: { anyOf: structuredClone(providerBranches) } } });
export const candidateOutputValueSchema: JsonSchema = { oneOf: [
  closed({ ...common, kind: { const: 'candidate_output' }, presentation: presentationSchema, bytes: count(),
    page: closed({ offset: count(), nextOffset: { anyOf: [count(), { type: 'null' }] }, limit: count(1, 100), returnedCount: count(), totalCount: count(), complete: { type: 'boolean' } }) }, [...requiredCommon, 'kind', 'presentation', 'bytes']),
  closed({ ...common, kind: { const: 'candidate_output_plan' }, status: { const: 'projection_required' }, guidance: closed({
    keepCandidateRef: { const: true }, preserveRequiredFields: { const: true }, preserveReasons: { const: true }, change: { const: 'display_projection_only' },
    message: { type: 'string', minLength: 1, maxLength: 1000 }, projectionOptions: { type: 'array', maxItems: 4, items: closed({
      fields, lineage: { enum: ['none', 'witness', 'all'] }, lineage_format: { enum: ['names', 'ids'] },
      wholeWireBytes: count(), tablePartsCount: count(), fit: { type: 'boolean' } }) },
  }) }, [...requiredCommon, 'kind', 'status', 'guidance']),
] };
export const candidateOutputOutputSchema: JsonSchema = withAccessContext({ type: 'object', oneOf: [closed({ value: candidateOutputValueSchema }),
  closed({ error: closed({ code: { type: 'string', minLength: 1, maxLength: 100 }, message: { type: 'string', maxLength: 20000 } }) })] });
export function validateCandidateOutputArgs(input: unknown): asserts input is CandidateOutputArgs {
  if (!compileSchema(candidateOutputInputSchema)(input)) throw new AppError('INVALID_INPUT', '最终输出只允许同一已核结果引用、已声明的显示投影和解释文本；table与subject_cards参数不能混用。');
}
export function effectiveCandidateOutputArgs(input: CandidateOutputArgs): EffectiveCandidateOutputArgs {
  validateCandidateOutputArgs(input);
  const paged = input.offset !== undefined || input.limit !== undefined;
  const common: CandidateOutputCommonArgs = { candidate_ref: input.candidate_ref,
    ...(paged ? { offset: input.offset ?? 0, limit: input.limit ?? 50 } : {}),
    ...(input.title === undefined ? {} : { title: input.title }), ...(input.introduction === undefined ? {} : { introduction: input.introduction }),
    ...(input.conclusion === undefined ? {} : { conclusion: input.conclusion }) };
  if (input.format === 'subject_cards') return { ...common, format: input.format, completion_scope: input.completion_scope ?? 'selected', card_fields: [...(input.card_fields ?? ['nameCn'])],
    layout: input.layout ?? 'list', reasons: (input.reasons ?? []).map(item => ({ ...item })) };
  return { ...common, format: 'table', completion_scope: input.completion_scope ?? 'exhaustive', fields: [...(input.fields ?? ['displayName', 'url'])], lineage: input.lineage ?? 'none',
    lineage_format: input.lineage_format ?? 'names', max_bytes: input.max_bytes ?? 16000 };
}
export function candidateOutputCoverageNote(coverage: CandidateCoverage, unknownFieldCount: number,
  completionScope: 'selected' | 'exhaustive' = 'exhaustive'): string | undefined {
  const details: string[] = [];
  if (!coverage.complete) {
    details.push(`${completionScope === 'selected' ? '已选集合已处理完成，母池仍有覆盖缺口' : '本次仅展示已核实部分'}；未完整来源${coverage.incompleteSourceCount}个，本层待核${coverage.pendingCount}项、未处理${coverage.remainingCount}项`);
    if (coverage.dependencyIncompleteCount) details.push(`上游未完整依赖${coverage.dependencyIncompleteCount}项，依赖待核${coverage.dependencyPendingCount}项、未处理${coverage.dependencyRemainingCount}项（依赖计数不是去重作品总数）`);
    if (coverage.unknownFieldCount || coverage.failedFieldCount || coverage.dependencyUnknownCount || coverage.dependencyFailedCount)
      details.push(`事实缺口：本层未知${coverage.unknownFieldCount}处、失败${coverage.failedFieldCount}处；上游未知${coverage.dependencyUnknownCount}处、失败${coverage.dependencyFailedCount}处`);
  }
  if (unknownFieldCount) details.push(`展示字段缺失${unknownFieldCount}处，保留为空或已注明的ID回退名称`);
  return details.length ? `${details.join('；')}。` : undefined;
}
export function candidateReasonText(args: EffectiveCandidateOutputArgs, subjects: { id: number; name: string }[],
  coverage?: CandidateCoverage, unknownFieldCount = 0): string | undefined {
  const reasons = args.format === 'subject_cards' ? new Map(args.reasons.map(item => [item.subject_id, item.reason])) : new Map<number, string>();
  const texts = subjects.flatMap(subject => reasons.has(subject.id) ? [`${subject.name}（https://bgm.tv/subject/${subject.id}）：${reasons.get(subject.id)!}`] : []);
  if (args.conclusion !== undefined) texts.push(args.conclusion);
  const note = coverage && candidateOutputCoverageNote(coverage, unknownFieldCount, args.completion_scope);
  if (note) texts.push(note);
  return texts.length ? texts.join('\n\n') : undefined;
}
export function checkCandidateOutputResponse(value: unknown, input: Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '候选最终输出根、完整成员、投影或覆盖契约不一致。'); };
  validateCandidateOutputArgs(input);
  const args = effectiveCandidateOutputArgs(input), response = value as CandidateOutputResponse;
  if (!compileSchema(candidateOutputValueSchema)(value) || !isDeepStrictEqual(response.scope, args)
    || response.candidateRef !== args.candidate_ref || response.format !== args.format || response.wholePlan.memberCount !== response.counts.memberCount) invalid();
  const plan = response.wholePlan;
  if (plan.fit !== (plan.reasons.length === 0) || plan.reasons.includes('whole_bytes') !== (plan.wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES)
    || plan.reasons.includes('content_parts') !== (plan.contentPartsCount > MAX_CONTENT_PARTS)
    || args.format !== 'table' && plan.reasons.some(reason => reason === 'row_bytes' || reason === 'table_parts')) invalid();
  if (response.visibility === 'self' && (!response.account || response.accessContext && !isDeepStrictEqual(response.account, response.accessContext.account))
    || response.visibility === 'public' && response.account) invalid();
  if (response.kind === 'candidate_output_plan') {
    if (plan.fit || response.counts.preparedCount !== 0 || response.counts.remainingCount !== response.counts.memberCount
      || response.counts.unknownFieldCount !== 0 || response.guidance.projectionOptions.some(option => option.fit
        && (option.wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES || option.tablePartsCount > MAX_CANDIDATE_TABLE_PARTS))) invalid();
    return;
  }
  const page = response.page, paged = args.offset !== undefined || args.limit !== undefined;
  if (paged) {
    if (!page || page.offset !== args.offset || page.limit !== args.limit || page.totalCount !== response.counts.memberCount
      || page.returnedCount !== response.counts.preparedCount || page.returnedCount > page.limit || page.offset > page.totalCount
      || page.offset + page.returnedCount > page.totalCount || page.complete !== (page.offset + page.returnedCount === page.totalCount)
      || page.nextOffset !== (page.complete ? null : page.offset + page.returnedCount)
      || !page.complete && page.returnedCount === 0 || response.counts.remainingCount !== page.totalCount - page.offset - page.returnedCount) invalid();
  } else if (page || response.counts.preparedCount !== response.counts.memberCount || response.counts.remainingCount !== 0) invalid();
  if (!plan.fit
    || response.bytes !== Buffer.byteLength(JSON.stringify(response.presentation), 'utf8') || plan.wholeWireBytes !== response.bytes
    || plan.contentPartsCount !== response.presentation.content.length) invalid();
  try {
    for (const part of response.presentation.content) validateMixedPart(part);
    validateMixedContent(response.presentation);
  } catch { invalid(); }
  const parts = response.presentation.content, components = parts.filter(part => part.type !== 'text');
  if (!components.length || components.some(part => part.type !== (args.format === 'table' ? 'DataTable' : 'SubjectCards'))) invalid();
  let members = 0;
  const subjects: { id: number; name: string }[] = [];
  for (const part of components) {
    if (part.type === 'DataTable' && args.format === 'table') {
      const keys = [...args.fields, ...(args.lineage === 'none' ? [] : ['lineage', 'parentCount'])];
      if (!isDeepStrictEqual(part.props.columns.map(column => column.key), keys) || part.props.title !== args.title
        || part.props.columns.some(column => Object.hasOwn(column, 'align'))
        || part.props.rows.some(row => !isDeepStrictEqual(Object.keys(row).sort(), [...keys].sort()))
        || Buffer.byteLength(JSON.stringify(part), 'utf8') > args.max_bytes) invalid();
      members += part.props.rows.length;
    } else if (part.type === 'SubjectCards' && args.format === 'subject_cards') {
      if (part.props.title !== args.title || part.props.layout !== args.layout || part.props.total !== response.counts.memberCount) invalid();
      for (const item of part.props.items) {
        if (!Number.isSafeInteger(item.id) || item.id < 1 || item.url !== `https://bgm.tv/subject/${item.id}`
          || CANDIDATE_CARD_FIELDS.some(field => field !== 'image' && !args.card_fields.includes(field) && Object.hasOwn(item, field))) invalid();
        subjects.push({ id: item.id, name: item.name });
      }
      members += part.props.items.length;
    }
  }
  if (members !== response.counts.preparedCount || new Set(subjects.map(item => item.id)).size !== subjects.length
    || args.format === 'subject_cards' && (new Set(args.reasons.map(item => item.subject_id)).size !== args.reasons.length
      || !paged && args.reasons.some(reason => !subjects.some(item => item.id === reason.subject_id)))) invalid();
  const expectedTexts: CandidateOutputText[] = [];
  if (args.introduction !== undefined) expectedTexts.push({ type: 'text', nextType: args.format === 'table' ? 'DataTable' : 'SubjectCards', text: args.introduction });
  const tail = candidateReasonText(args, subjects, response.coverage, response.counts.unknownFieldCount);
  if (tail !== undefined) expectedTexts.push({ type: 'text', nextType: null, text: tail });
  if (!isDeepStrictEqual(parts.filter(part => part.type === 'text'), expectedTexts)
    || args.introduction !== undefined && parts[0]?.type !== 'text'
    || tail !== undefined && parts.at(-1)?.type !== 'text') invalid();
}
