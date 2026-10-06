import { AppError } from '../support/errors.js';
import { normalizeProviderPart } from '../output/content-schema.js';
import type { AccessContext } from './access-context.js';
import type { CandidateRow } from './candidate-contract.js';
import { CandidateStore, candidateStage, summarizeCandidateCoverage, type CandidateBinding, type CandidateSet } from './candidate-store.js';
import { evaluateCandidateFacts } from './candidate-query.js';
import type { RelationLineage } from './relation-contract.js';
import { effectiveCandidatePresentationArgs, checkCandidatePresentationResponse, MAX_CANDIDATE_TABLE_WIRE_BYTES,
  MAX_CANDIDATE_TABLE_PARTS, RESERVED_CANDIDATE_TABLE_TEXT_PARTS,
  type CandidatePresentationArgs, type EffectiveCandidatePresentationArgs, type CandidatePresentationField,
  type CandidatePresentationResponse, type CandidateTablePart, type CandidateTableWholePlan, type CandidateProjectionOption } from './candidate-presentation-contract.js';
import { MAX_CONTENT_PARTS } from '../output/content-schema.js';

const labels: Record<CandidatePresentationField, string> = { displayName: '作品名', id: 'ID', name: '原名', nameCn: '中文名',
  date: '日期', subjectForm: '形式', score: '评分', rank: '排名', ratingCount: '评分人数', url: '链接', collectionStatus: '收藏状态' };
const subjectUrl = (id: number): string => `https://bgm.tv/subject/${id}`;
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function cell(row: CandidateRow, field: CandidatePresentationField): { text: string; unknown: number } {
  if (field === 'id') return { text: String(row.id), unknown: 0 };
  if (field === 'url') return { text: subjectUrl(row.id), unknown: 0 };
  if (field === 'displayName') {
    const name = nonblank(row.facts.nameCn) ? row.facts.nameCn : nonblank(row.facts.name) ? row.facts.name : undefined;
    return { text: name ?? `#${row.id}`, unknown: name === undefined ? 1 : 0 };
  }
  const value = row.facts[field];
  if (nonblank(value) || typeof value === 'number' && Number.isFinite(value)) return { text: String(value), unknown: 0 };
  return { text: '', unknown: 1 };
}
function tablePart(args: EffectiveCandidatePresentationArgs, rows: Record<string, string>[] = []): CandidateTablePart {
  const part: CandidateTablePart = { type: 'DataTable', pending: false, props: {
    ...(args.title === undefined ? {} : { title: args.title }),
    columns: args.fields.map(field => ({ key: field, label: labels[field] })), rows } };
  if (args.lineage !== 'none') part.props.columns.push({ key: 'lineage', label: args.lineage === 'witness' ? '关联来源（示例）' : '全部关联来源' },
    { key: 'parentCount', label: '父关联总数' });
  return part;
}
function wholePlan(args: EffectiveCandidatePresentationArgs, rows: Record<string, string>[]): CandidateTableWholePlan {
  const emptyBytes = Buffer.byteLength(JSON.stringify(tablePart(args)), 'utf8');
  const partBytes: number[] = []; let currentBytes = emptyBytes, currentRows = 0, rowOversized = emptyBytes > args.max_bytes;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (currentRows > 0 && (currentRows === args.limit || currentBytes + 1 + size > args.max_bytes)) {
      partBytes.push(currentBytes); currentBytes = emptyBytes; currentRows = 0;
    }
    rowOversized ||= emptyBytes + size > args.max_bytes;
    currentBytes += (currentRows ? 1 : 0) + size; currentRows++;
  }
  if (currentRows || !rows.length) partBytes.push(currentBytes);
  const wholeWireBytes = Buffer.byteLength('{"content":[]}', 'utf8') + partBytes.reduce((sum, size) => sum + size, 0) + Math.max(0, partBytes.length - 1);
  const reasons: CandidateTableWholePlan['reasons'] = [];
  if (wholeWireBytes > MAX_CANDIDATE_TABLE_WIRE_BYTES) reasons.push('whole_bytes');
  if (partBytes.length > MAX_CANDIDATE_TABLE_PARTS) reasons.push('table_parts');
  if (rowOversized) reasons.push('row_bytes');
  return { memberCount: rows.length, tablePartsCount: partBytes.length, wholeWireBytes, maxWholeWireBytes: MAX_CANDIDATE_TABLE_WIRE_BYTES,
    maxTableParts: MAX_CANDIDATE_TABLE_PARTS, reservedTextParts: RESERVED_CANDIDATE_TABLE_TEXT_PARTS,
    remainingContentSlots: Math.max(0, MAX_CONTENT_PARTS - partBytes.length), fit: reasons.length === 0, reasons };
}
/** 已选集合必须处理完成且当前事实仍满足本层条件；全量另外要求来源与祖先扫描耗尽。 */
export function candidatePresentationSet(store: CandidateStore, ref: string, binding: CandidateBinding, context?: AccessContext,
  completionScope: 'selected' | 'exhaustive' = 'exhaustive'): CandidateSet {
  const set = store.get(ref, binding), stage = candidateStage(set);
  if (set.refRole !== 'result' || set.qualification?.complete === false || stage.remainingCount > 0 || set.continuation
    || completionScope === 'exhaustive' && (set.sources.some(source => source.nextOffset !== null)
      || set.coverageDependencies.some(dependency => dependency.remainingCount > 0)))
    throw new AppError('CANDIDATE_STAGE_INCOMPLETE', '请先完成本层选择；全量展示还须完成来源及祖先扫描。原引用仍保留。');
  if (set.visibility === 'self' && (!context?.account || context.account.id !== set.account?.id))
    throw new AppError('CANDIDATE_SCOPE_MISMATCH', '本人候选展示需要匹配的当前账户。');
  if ((set.requiresNsfw || set.rows.some(row => row.requiresNsfw || row.facts.nsfw === true))
    && (!context?.account || context.account.id !== binding.accountId || context.nsfw.allowed !== true || context.nsfw.preference === false))
    throw new AppError('NSFW_SCOPE_CHANGED', '当前可见权限不能展示此候选范围。');
  for (const row of set.rows) for (const filter of set.factFilters) {
    const result = evaluateCandidateFacts(row, filter).result;
    if (result !== 'match') throw new AppError(result === 'unknown' ? 'CANDIDATE_REQUIRED_FACTS_MISSING' : 'CANDIDATE_STAGE_INCOMPLETE',
      '当前缓存事实不能确证已执行的筛选条件；请在原范围补证并复核。');
  }
  return set;
}
/** 对指定缓存行格式化，供输出分页复用；不改变集合、覆盖或事实。 */
function tableProjection(store: CandidateStore, set: CandidateSet, args: EffectiveCandidatePresentationArgs, binding: CandidateBinding,
  getLineage?: (ref: string, ids: number[], binding: CandidateBinding) => RelationLineage[]) {
  const lineage = new Map<number, RelationLineage>();
  if (args.lineage !== 'none') {
    if (!getLineage) throw new AppError('CANDIDATE_LINEAGE_UNAVAILABLE', '当前缓存没有可用的关联回溯读取器。');
    for (let offset = 0; offset < set.rows.length; offset += 100) {
      const ids = set.rows.slice(offset, offset + 100).map(row => row.id), allowed = new Set(ids);
      const rows = getLineage(set.ref, ids, binding);
      if (!Array.isArray(rows)) throw new AppError('MCP_INVALID_RESULT', '关联缓存不是当前集合的合法回溯数组。');
      for (const row of rows) {
        if (!row || !allowed.has(row.subjectId) || lineage.has(row.subjectId) || !Number.isSafeInteger(row.parentCount)
          || !Array.isArray(row.parents) || row.parentCount < 0 || row.parentCount !== row.parents.length || row.parents.some(parent => !Number.isSafeInteger(parent.parentId)
            || parent.parentId < 1 || parent.relation !== null && typeof parent.relation !== 'string'))
          throw new AppError('MCP_INVALID_RESULT', '关联缓存不符合当前表格窗口。');
        lineage.set(row.subjectId, row);
      }
      if (ids.some(id => !lineage.has(id))) throw new AppError('MCP_INVALID_RESULT', '关联缓存遗漏当前表格窗口成员。');
    }
  }
  const parentName = (parent: RelationLineage['parents'][number]): string => {
    const rich = parent as typeof parent & { name?: string | null; nameCn?: string | null };
    const cached = store.publicFacts(parent.parentId, binding.turnId)?.facts;
    const name = nonblank(rich.nameCn) ? rich.nameCn : nonblank(rich.name) ? rich.name
      : nonblank(cached?.nameCn) ? cached.nameCn : nonblank(cached?.name) ? cached.name : `#${parent.parentId}`;
    return name;
  };
  const names = new Map<string, Set<number>>();
  for (const item of lineage.values()) for (const parent of item.parents) {
    const name = parentName(parent), ids = names.get(name) ?? new Set<number>(); ids.add(parent.parentId); names.set(name, ids);
  }
  const projection = (options: EffectiveCandidatePresentationArgs): { rows: Record<string, string>[]; unknown: number[] } => {
    const unknown: number[] = [];
    const rows = set.rows.map(row => {
      const cells = options.fields.map(field => cell(row, field)), values = cells.map(value => value.text);
      unknown.push(cells.reduce((sum, value) => sum + value.unknown, 0));
      if (options.lineage !== 'none') {
        const item = lineage.get(row.id)!;
        const parents = [...item.parents].sort((a, b) => a.parentId - b.parentId || String(a.relation ?? '').localeCompare(String(b.relation ?? '')));
        values.push((options.lineage === 'witness' ? parents.slice(0, 1) : parents).map(parent => {
          if (options.lineage_format === 'ids') return `#${parent.parentId}`;
          const name = parentName(parent);
          if (options.lineage_format === 'full') return `${name} ${subjectUrl(parent.parentId)}${nonblank(parent.relation) ? `（${parent.relation}）` : ''}`;
          return (names.get(name)?.size ?? 0) > 1 && name !== `#${parent.parentId}` ? `${name} #${parent.parentId}` : name;
        }).join('；'));
        values.push(String(item.parentCount));
      }
      const keys = [...options.fields, ...(options.lineage === 'none' ? [] : ['lineage', 'parentCount'])];
      return Object.fromEntries(keys.map((key, index) => [key, values[index]!]));
    });
    return { rows, unknown };
  };
  return projection;
}
export function formatCandidateTableRows(store: CandidateStore, set: CandidateSet, input: CandidatePresentationArgs, binding: CandidateBinding,
  getLineage?: (ref: string, ids: number[], binding: CandidateBinding) => RelationLineage[]) {
  const args = effectiveCandidatePresentationArgs(input), prepared = tableProjection(store, set, args, binding, getLineage)(args);
  return { presentation: tablePart(args, prepared.rows), unknown: prepared.unknown };
}
/** 只格式化已核实集合的现有缓存；不创建新引用、不取网络事实、不解释语义。 */
export function prepareCandidateTable(store: CandidateStore, input: CandidatePresentationArgs, binding: CandidateBinding, context?: AccessContext,
  getLineage?: (ref: string, ids: number[], binding: CandidateBinding) => RelationLineage[],
  completionScope: 'selected' | 'exhaustive' = 'exhaustive'): CandidatePresentationResponse {
  const args = effectiveCandidatePresentationArgs(input), set = candidatePresentationSet(store, args.candidate_ref, binding, context, completionScope);
  if (args.offset > set.rows.length) throw new AppError('INVALID_INPUT', '表格offset超出已核实集合范围。');
  const projection = tableProjection(store, set, args, binding, getLineage);
  const prepared = projection(args), plan = wholePlan(args, prepared.rows);
  const common = { schemaVersion: 1 as const, candidateRef: set.ref, fields: args.fields, lineage: args.lineage, lineage_format: args.lineage_format,
    wholePlan: plan, scope: args, coverage: summarizeCandidateCoverage(set), visibility: set.visibility,
    ...(set.account ? { account: structuredClone(set.account) } : {}), readAt: new Date().toISOString(),
    ...(context ? { accessContext: structuredClone(context) } : {}) };
  if (!plan.fit) {
    const projectionOptions: CandidateProjectionOption[] = [];
    for (const fields of [args.fields, ['displayName', 'url'] as CandidatePresentationField[]]) for (const format of ['names', 'ids'] as const) {
      if (projectionOptions.some(option => JSON.stringify([option.fields, option.lineage_format]) === JSON.stringify([fields, format]))) continue;
      const proposed = { ...args, fields: [...fields], lineage_format: format }, size = wholePlan(proposed, projection(proposed).rows);
      projectionOptions.push({ fields: [...fields], lineage: args.lineage, lineage_format: format,
        wholeWireBytes: size.wholeWireBytes, tablePartsCount: size.tablePartsCount, fit: size.fit });
    }
    const receipt: CandidatePresentationResponse = { ...common, kind: 'candidate_table_plan', status: 'projection_required',
      counts: { memberCount: set.rows.length, preparedCount: 0, remainingCount: set.rows.length, unknownFieldCount: 0 },
      guidance: { keepCandidateRef: true, preserveRequiredFields: true, change: 'display_projection_only',
        message: '整集合展示超过保守容量或页面整行容量。保留同一候选引用及全部成员，只按用户实际需要调整显示字段、父关联简写或显示窗口；不得删除用户必需字段、缩小候选范围或提高每页字节预算绕过全量上界。', projectionOptions } };
    checkCandidatePresentationResponse(receipt, args as unknown as Record<string, unknown>);
    return receipt;
  }
  const presentation = tablePart(args); let actualBytes = Buffer.byteLength(JSON.stringify(presentation), 'utf8'), unknownFieldCount = 0;
  for (let index = args.offset; index < Math.min(set.rows.length, args.offset + args.limit); index++) {
    const values = prepared.rows[index]!;
    const nextBytes = actualBytes + (presentation.props.rows.length ? 1 : 0) + Buffer.byteLength(JSON.stringify(values), 'utf8');
    if (nextBytes > args.max_bytes) break;
    presentation.props.rows.push(values); actualBytes = nextBytes;
    unknownFieldCount += prepared.unknown[index]!;
  }
  normalizeProviderPart(presentation);
  const preparedCount = presentation.props.rows.length, next = args.offset + preparedCount, complete = next === set.rows.length;
  const response: CandidatePresentationResponse = { ...common, kind: 'candidate_table', presentation, bytes: actualBytes,
    counts: { memberCount: set.rows.length, preparedCount, remainingCount: set.rows.length - next, unknownFieldCount },
    page: { offset: args.offset, nextOffset: complete ? null : next, limit: args.limit, returnedCount: preparedCount, totalCount: set.rows.length, complete },
  };
  checkCandidatePresentationResponse(response, args as unknown as Record<string, unknown>);
  return response;
}
