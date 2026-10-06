import { AppError } from '../support/errors.js';
import { MAX_CONTENT_PARTS, normalizeProviderContent, normalizeProviderPart, validateMixedContent } from '../output/content-schema.js';
import { ContentDecoder } from '../output/content-decoder.js';
import type { AccessContext } from './access-context.js';
import type { CandidateCoverage, CandidateRow } from './candidate-contract.js';
import { CandidateStore, summarizeCandidateCoverage, type CandidateBinding } from './candidate-store.js';
import type { RelationLineage } from './relation-contract.js';
import { candidatePresentationSet, prepareCandidateTable, formatCandidateTableRows } from './candidate-presentation.js';
import { MAX_CANDIDATE_TABLE_WIRE_BYTES, type CandidatePresentationArgs, type CandidatePresentationField, type CandidateProjectionOption } from './candidate-presentation-contract.js';
import { effectiveCandidateOutputArgs, checkCandidateOutputResponse, candidateReasonText,
  type CandidateOutputArgs, type EffectiveCandidateOutputArgs, type CandidateOutputResponse,
  type CandidateOutputWholePlan, type CandidateOutputPart, type CandidateCardItem, type CandidateCardField } from './candidate-output-contract.js';

const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const kinds = new Map<number, CandidateCardItem['kind']>([[1, 'book'], [2, 'anime'], [3, 'music'], [4, 'game'], [6, 'real']]);
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
function texts(args: EffectiveCandidateOutputArgs, subjects: { id: number; name: string }[], coverage: CandidateCoverage, unknownFieldCount: number): CandidateOutputPart[] {
  const result: CandidateOutputPart[] = [];
  if (args.introduction !== undefined) result.push({ type: 'text', nextType: args.format === 'table' ? 'DataTable' : 'SubjectCards', text: args.introduction });
  const tail = candidateReasonText(args, subjects, coverage, unknownFieldCount);
  if (tail !== undefined) result.push({ type: 'text', nextType: null, text: tail });
  return result;
}
function unknownTableFields(rows: CandidateRow[], fields: CandidatePresentationField[]): number {
  return rows.reduce((sum, row) => sum + fields.reduce((count, field) => {
    if (field === 'id' || field === 'url') return count;
    if (field === 'displayName') return count + (nonblank(row.facts.nameCn) || nonblank(row.facts.name) ? 0 : 1);
    const value = row.facts[field];
    return count + (nonblank(value) || typeof value === 'number' && Number.isFinite(value) ? 0 : 1);
  }, 0), 0);
}
function plan(memberCount: number, contentPartsCount: number, wholeWireBytes: number, extra: CandidateOutputWholePlan['reasons'] = []): CandidateOutputWholePlan {
  const reasons = [...extra];
  if (wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES) reasons.push('whole_bytes');
  if (contentPartsCount > MAX_CONTENT_PARTS) reasons.push('content_parts');
  return { memberCount, contentPartsCount, wholeWireBytes, maxWholeWireBytes: MAX_CANDIDATE_TABLE_WIRE_BYTES,
    maxContentParts: MAX_CONTENT_PARTS, fit: reasons.length === 0, reasons: [...new Set(reasons)] };
}
function card(row: CandidateRow, fields: CandidateCardField[]): { item: CandidateCardItem; unknown: number } {
  const type = row.facts.subjectType, kind = typeof type === 'number' ? kinds.get(type) : undefined;
  if (!kind) throw new AppError('CANDIDATE_REQUIRED_FACTS_MISSING', '卡片kind需要已核实subjectType；在原候选范围按ID补必要事实，不能猜媒体或缩小集合。');
  const name = nonblank(row.facts.name) ? row.facts.name : nonblank(row.facts.nameCn) ? row.facts.nameCn : `#${row.id}`;
  const item: CandidateCardItem = { id: row.id, name, kind, url: `https://bgm.tv/subject/${row.id}` };
  let unknown = nonblank(row.facts.name) || nonblank(row.facts.nameCn) ? 0 : 1;
  for (const field of fields) {
    const value = row.facts[field === 'scoreCount' ? 'ratingCount' : field];
    if (field === 'tags') {
      if (Array.isArray(value) && value.every(tag => typeof tag === 'string')) item.tags = [...value] as string[]; else unknown++;
    } else if (field === 'score' || field === 'scoreCount' || field === 'rank') {
      if (typeof value === 'number' && Number.isFinite(value)) item[field] = value; else unknown++;
    } else if (typeof value === 'string') item[field] = value; else unknown++;
  }
  return { item, unknown };
}
/** 缓存结果只读组装；显式分页只限制本次交付，不改变完整候选引用。 */
export function prepareCandidateOutput(store: CandidateStore, input: CandidateOutputArgs, binding: CandidateBinding, context?: AccessContext,
  getLineage?: (ref: string, ids: number[], binding: CandidateBinding) => RelationLineage[]): CandidateOutputResponse {
  const args = effectiveCandidateOutputArgs(input);
  const tableArgs: CandidatePresentationArgs = { candidate_ref: args.candidate_ref,
    ...(args.format === 'table' ? { fields: args.fields, lineage: args.lineage, lineage_format: args.lineage_format, max_bytes: args.max_bytes }
      : { max_bytes: 65536 }), ...(args.title === undefined ? {} : { title: args.title }) };
  const set = candidatePresentationSet(store, args.candidate_ref, binding, context, args.completion_scope);
  const common = { schemaVersion: 1 as const, candidateRef: set.ref, format: args.format, scope: args,
    coverage: summarizeCandidateCoverage(set), visibility: set.visibility, ...(set.account ? { account: structuredClone(set.account) } : {}),
    readAt: new Date().toISOString(), ...(context ? { accessContext: structuredClone(context) } : {}) };
  const receipt = (wholePlan: CandidateOutputWholePlan, projectionOptions: CandidateProjectionOption[] = []): CandidateOutputResponse => {
    const response: CandidateOutputResponse = { ...common, kind: 'candidate_output_plan', status: 'projection_required', wholePlan,
      counts: { memberCount: set.rows.length, preparedCount: 0, remainingCount: set.rows.length, unknownFieldCount: 0 },
      guidance: { keepCandidateRef: true, preserveRequiredFields: true, preserveReasons: true, change: 'display_projection_only',
        message: '本次内容超过展示容量。保留同一resultRef和必要字段，指定offset:0及limit启用分页，再按page.nextOffset继续交付。', projectionOptions } };
    checkCandidateOutputResponse(response, args as unknown as Record<string, unknown>);
    return response;
  };
  if (args.format === 'subject_cards') {
    const allowed = new Set(set.rows.map(row => row.id)), reasonIds = new Set<number>();
    for (const reason of args.reasons) {
      if (!allowed.has(reason.subject_id) || reasonIds.has(reason.subject_id)) throw new AppError('INVALID_INPUT', '推荐理由必须唯一对应当前resultRef中的已选作品。');
      reasonIds.add(reason.subject_id);
    }
  }
  if (args.offset !== undefined || args.limit !== undefined) {
    const offset = args.offset ?? 0, limit = args.limit ?? 50;
    if (offset > set.rows.length) throw new AppError('INVALID_INPUT', '输出offset超出已核结果集合。');
    const rows = set.rows.slice(offset, offset + limit);
    const formatted = args.format === 'table'
      ? formatCandidateTableRows(store, { ...set, rows }, tableArgs, binding, getLineage) : undefined;
    const parts: CandidateOutputPart[] = [], subjects: { id: number; name: string }[] = [];
    let unknown = 0, preparedCount = 0;
    const content = (components: CandidateOutputPart[], names: { id: number; name: string }[], missing: number): CandidateOutputPart[] => {
      const textParts = texts(args, names, common.coverage, missing), result: CandidateOutputPart[] = [];
      if (args.introduction !== undefined) result.push(textParts.shift()!);
      return [...result, ...components, ...textParts];
    };
    const emptyComponent = (): CandidateOutputPart => args.format === 'table'
      ? { ...formatted!.presentation, props: { ...formatted!.presentation.props, rows: [] } }
      : { type: 'SubjectCards', pending: false, props: { ...(args.title === undefined ? {} : { title: args.title }),
        layout: args.layout, total: set.rows.length, items: [] } };
    for (let index = 0; index < rows.length; index++) {
      const nextParts = structuredClone(parts), nextSubjects = [...subjects];
      let component = nextParts.at(-1), addedUnknown = 0;
      if (!component) { component = emptyComponent(); nextParts.push(component); }
      if (component.type === 'DataTable' && formatted && args.format === 'table') {
        const values = formatted.presentation.props.rows[index]!;
        if (component.props.rows.length && bytes({ ...component, props: { ...component.props, rows: [...component.props.rows, values] } }) > args.max_bytes) {
          component = emptyComponent(); nextParts.push(component);
        }
        if (component.type !== 'DataTable') throw new AppError('INTERNAL_ERROR', '输出表格格式不一致。');
        component.props.rows.push(values); addedUnknown = formatted.unknown[index]!;
        if (bytes(component) > args.max_bytes) {
          if (preparedCount === 0) throw new AppError('CANDIDATE_OUTPUT_ITEM_TOO_LARGE', '单项完整表格字段超过单块容量；不能截断字段。');
          break;
        }
      } else if (component.type === 'SubjectCards' && args.format === 'subject_cards') {
        const prepared = card(rows[index]!, args.card_fields);
        if (component.props.items.length === 50) { component = emptyComponent(); nextParts.push(component); }
        if (component.type !== 'SubjectCards') throw new AppError('INTERNAL_ERROR', '输出卡片格式不一致。');
        component.props.items.push(prepared.item); addedUnknown = prepared.unknown;
        nextSubjects.push({ id: prepared.item.id, name: prepared.item.name });
      }
      const presentation = { content: content(nextParts, nextSubjects, unknown + addedUnknown) };
      if (!plan(set.rows.length, presentation.content.length, bytes(presentation)).fit) {
        if (preparedCount === 0) throw new AppError('CANDIDATE_OUTPUT_ITEM_TOO_LARGE', '单项完整字段及本次解释文本超过40000字节内容容量；不能截断字段。');
        break;
      }
      parts.splice(0, parts.length, ...nextParts); subjects.splice(0, subjects.length, ...nextSubjects);
      unknown += addedUnknown; preparedCount++;
    }
    if (!parts.length) parts.push(emptyComponent());
    const presentation = { content: content(parts, subjects, unknown) }, wireBytes = bytes(presentation);
    const pagePlan = plan(set.rows.length, presentation.content.length, wireBytes);
    if (!pagePlan.fit) throw new AppError('CANDIDATE_OUTPUT_ITEM_TOO_LARGE', '本次输出的解释文本超过内容容量。');
    const next = offset + preparedCount, complete = next === set.rows.length;
    const response: CandidateOutputResponse = { ...common, kind: 'candidate_output', presentation, bytes: wireBytes, wholePlan: pagePlan,
      counts: { memberCount: set.rows.length, preparedCount, remainingCount: set.rows.length - next, unknownFieldCount: unknown },
      page: { offset, nextOffset: complete ? null : next, limit, returnedCount: preparedCount, totalCount: set.rows.length, complete } };
    const decoder = new ContentDecoder(); decoder.feed(JSON.stringify(presentation)); validateMixedContent(decoder.finish());
    checkCandidateOutputResponse(response, args as unknown as Record<string, unknown>);
    return response;
  }
  const components: CandidateOutputPart[] = []; let unknownFieldCount = 0;
  const subjects: { id: number; name: string }[] = [];
  if (args.format === 'table') {
    const first = prepareCandidateTable(store, tableArgs, binding, context, getLineage, args.completion_scope);
    if (first.kind === 'candidate_table_plan') {
      const textParts = texts(args, [], common.coverage, unknownTableFields(set.rows, args.fields));
      const extraBytes = textParts.reduce((sum, part) => sum + bytes(part), 0) + textParts.length;
      const reasons = first.wholePlan.reasons.filter(reason => reason !== 'whole_bytes');
      return receipt(plan(set.rows.length, first.wholePlan.tablePartsCount + textParts.length, first.wholePlan.wholeWireBytes + extraBytes, reasons),
        first.guidance.projectionOptions.map(option => ({ ...option, wholeWireBytes: option.wholeWireBytes + extraBytes,
          fit: option.fit && option.wholeWireBytes + extraBytes <= MAX_CANDIDATE_TABLE_WIRE_BYTES
            && option.tablePartsCount + textParts.length <= MAX_CONTENT_PARTS })));
    }
    let page = first;
    while (true) {
      components.push(page.presentation); unknownFieldCount += page.counts.unknownFieldCount;
      if (page.page.nextOffset === null) break;
      const next = prepareCandidateTable(store, { ...tableArgs, offset: page.page.nextOffset }, binding, context, getLineage, args.completion_scope);
      if (next.kind !== 'candidate_table') throw new AppError('MCP_INVALID_RESULT', '同一冻结缓存引用的全量表格规划在分页间变化。');
      page = next;
    }
  } else {
    const items = set.rows.map(row => { const result = card(row, args.card_fields); unknownFieldCount += result.unknown;
      subjects.push({ id: result.item.id, name: result.item.name }); return result.item; });
    for (let offset = 0; offset < items.length || offset === 0; offset += 50) components.push({ type: 'SubjectCards', pending: false,
      props: { ...(args.title === undefined ? {} : { title: args.title }), layout: args.layout, total: items.length, items: items.slice(offset, offset + 50) } });
  }
  const textParts = texts(args, subjects, common.coverage, unknownFieldCount), content: CandidateOutputPart[] = [];
  if (args.introduction !== undefined) content.push(textParts.shift()!);
  content.push(...components, ...textParts);
  const presentation = { content }, wholePlan = plan(set.rows.length, content.length, bytes(presentation));
  if (!wholePlan.fit) return receipt(wholePlan);
  for (const part of content) normalizeProviderPart(part);
  validateMixedContent(normalizeProviderContent(presentation));
  const decoder = new ContentDecoder(); decoder.feed(JSON.stringify(presentation)); validateMixedContent(decoder.finish());
  const response: CandidateOutputResponse = { ...common, kind: 'candidate_output', presentation, bytes: wholePlan.wholeWireBytes, wholePlan,
    counts: { memberCount: set.rows.length, preparedCount: set.rows.length, remainingCount: 0, unknownFieldCount } };
  checkCandidateOutputResponse(response, args as unknown as Record<string, unknown>);
  return response;
}
