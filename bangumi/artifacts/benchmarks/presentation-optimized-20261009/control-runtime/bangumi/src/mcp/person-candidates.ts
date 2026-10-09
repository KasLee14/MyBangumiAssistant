import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import type { AccessContext } from './access-context.js';
import { CandidateStore, candidateRow, mergeCandidateFacts, type CandidateBinding } from './candidate-store.js';
import { CandidateQuery } from './candidate-query.js';
import { candidateValueSchema, checkCandidateResponse, DEFAULT_CANDIDATE_FIELDS, PERSONAL_CANDIDATE_FIELDS,
  type CandidateField, type CandidateResponse, type CandidateSeed, type CandidateSource } from './candidate-contract.js';
import type { AppearanceCoverage, AppearanceCandidateEvidence } from './person-characters.js';
import { normalizeCandidateDate } from './subject-facts.js';

type Data = Record<string, unknown>;
export interface PersonCandidatePage extends Data {
  data: Data[]; total: number; limit: number; offset: number; nextOffset: number | null; snapshotRef: string;
  coverage: AppearanceCoverage; candidateEvidence: AppearanceCandidateEvidence;
}
export interface AppearanceStage {
  snapshotRef: string; sourceUnit: 'character' | 'appearance'; sourceTotal: number; sourceReturnedCount: number;
  relationTotal: number; matchedRelationTotal: number; matchedSubjectTotal: number; relationRowsConsumed: number; subjectCount: number;
  unknownRoleCount: number; unknownFormCount: number; unavailableSubjectCount: number; unavailableCollectionCount: number;
  qualificationGapCount: number; nativeSourceComplete: boolean; sourcePaginationComplete: boolean;
}
export interface PersonCandidateResponse extends CandidateResponse { appearanceStage: AppearanceStage }
interface State {
  binding: CandidateBinding; signature: string; originRef: string | null; snapshotRef: string; nextOffset: number | null;
  rows: CandidateSeed[]; sources: CandidateSource[]; consumed: number; duplicateCount: number;
  coverage: AppearanceCoverage; evidence: AppearanceCandidateEvidence; requiresNsfw: boolean; pagesRead: number; inputRef: string | null; stageRef: string | null;
}
const nativeIncludes = (args: Data): string[] => {
  const fields = args.response_view === 'reference' ? [] : args.fields as CandidateField[] ?? DEFAULT_CANDIDATE_FIELDS;
  return [
    ...(fields.some(field => ['date', 'platform', 'subjectForm', 'score', 'ratingCount'].includes(field)) ? ['subject_facts'] : []),
    ...(fields.some(field => PERSONAL_CANDIDATE_FIELDS.includes(field)) ? ['own_collection'] : []),
  ];
};
const nativeArgs = (args: Data): Data => ({ ...Object.fromEntries(['person_id', 'subject_type', 'appearance_role', 'subject_form', 'snapshot_ref', 'offset', 'limit']
  .filter(key => args[key] !== undefined).map(key => [key, args[key]])), include: nativeIncludes(args) });
const signature = (args: Data): string => JSON.stringify([args.person_id, args.subject_type ?? null, args.appearance_role ?? null,
  args.subject_form ?? null, nativeIncludes(args)]);
const obj = (value: unknown): Data => value as Data;
const ids = (...groups: number[][]): number[] => [...new Set(groups.flat())].sort((a, b) => a - b);

/** 原生出演快照在宿主按作品去重，作品资格缺口独立于角色/关系分页；不增加网络读取或类别判断。 */
export class PersonCandidates {
  private readonly refs = new Map<string, State>();
  constructor(private readonly store: CandidateStore, private readonly deps: {
    readPage(args: Data, context: AccessContext, signal?: AbortSignal): Promise<PersonCandidatePage>;
    shouldYield?(): boolean;
  }) {}
  async execute(args: Data, binding: CandidateBinding, context: AccessContext, signal?: AbortSignal): Promise<PersonCandidateResponse> {
    const prior = typeof args.merge_ref === 'string' ? this.refs.get(args.merge_ref) : undefined;
    if (prior && (prior.signature !== signature(args) || args.snapshot_ref !== prior.snapshotRef || Number(args.offset ?? 0) !== prior.nextOffset))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '出演候选续读须使用同一快照、原筛选与准确来源offset。');
    if (args.snapshot_ref !== undefined && !prior) throw new AppError('CANDIDATE_SCOPE_MISMATCH', '出演候选snapshot_ref须关联本轮上一阶段merge_ref。');
    if (prior && (prior.binding.turnId !== binding.turnId || prior.binding.accountId !== binding.accountId || prior.binding.scopeKey !== binding.scopeKey))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '出演候选快照不属于当前轮次、账户或范围。');
    const origin = !prior && typeof args.merge_ref === 'string' ? this.store.get(args.merge_ref, binding) : undefined;
    const include = nativeIncludes(args);
    if (include.includes('own_collection') && binding.scopeKey.startsWith('public:collections:'))
      throw new AppError('CANDIDATE_SCOPE_MISMATCH', '第三方个人事实范围不能作为本人人物出演收藏缓存。');
    const state: State = prior ? structuredClone(prior) : { binding: structuredClone(binding), signature: signature(args), originRef: origin?.ref ?? null,
      snapshotRef: '', nextOffset: Number(args.offset ?? 0), rows: origin?.rows ?? [], sources: origin?.sources ?? [], consumed: 0, duplicateCount: origin?.duplicateCount ?? 0,
      coverage: {} as AppearanceCoverage, evidence: { unknownRoleSubjectIds: [] }, requiresNsfw: origin?.requiresNsfw ?? false, pagesRead: 0, inputRef: null, stageRef: null };
    if (!prior && Number(args.offset ?? 0) !== 0) throw new AppError('INVALID_INPUT', '新出演候选范围必须从offset=0开始。');
    const added = new Set<number>();
    let lastPage: PersonCandidatePage;
    do {
      signal?.throwIfAborted();
      const page = await this.deps.readPage({ ...nativeArgs(args), offset: state.nextOffset ?? 0,
        ...(state.snapshotRef ? { snapshot_ref: state.snapshotRef } : {}) }, context, signal);
      lastPage = page;
      if (!page.snapshotRef || page.offset !== state.nextOffset || page.total !== page.coverage.matchedRelationTotal
        || page.nextOffset !== null && page.nextOffset !== page.offset + page.data.length)
        throw new AppError('INVALID_RESPONSE', '出演原生快照页的范围或推进位置不一致。');
      state.snapshotRef = page.snapshotRef; state.coverage = structuredClone(page.coverage); state.evidence = structuredClone(page.candidateEvidence);
      const seen = new Set(state.rows.map(row => row.id));
      for (const edge of page.data) {
        const subject = obj(edge.subject), facts = obj(edge.subjectFacts ?? {}), own = obj(edge.ownCollection ?? {}), id = Number(subject.id);
        const values: Record<string, unknown> = { name: subject.name, nameCn: subject.name_cn ?? subject.nameCn,
          subjectType: subject.type ?? subject.subjectType, nsfw: subject.nsfw, url: `https://bgm.tv/subject/${id}` };
        if (Object.hasOwn(facts, 'airDate')) values.date = normalizeCandidateDate(facts.airDate);
        for (const [from, to] of [['platform', 'platform'], ['form', 'subjectForm'], ['score', 'score'], ['ratingCount', 'ratingCount']])
          if (facts[from!] !== undefined) values[to!] = facts[from!];
        if (own.state === 'collected') { values.collectionState = 'collected'; values.collectionStatus = own.collectionStatus; }
        else if (own.state === 'not_collected') { values.collectionState = 'not_collected'; values.collectionStatus = null; }
        else if (own.state === 'unavailable') { values.collectionState = 'unknown'; values.collectionStatus = null; }
        const seed: CandidateSeed = { id, facts: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)),
          requiresNsfw: edge.nsfw === true || subject.nsfw === true || context.nsfwApplied };
        state.requiresNsfw ||= seed.requiresNsfw === true;
        if (seen.has(id)) {
          state.duplicateCount++; const index = state.rows.findIndex(row => row.id === id);
          state.rows[index] = mergeCandidateFacts(candidateRow(state.rows[index]!), seed); added.add(id);
        } else { state.rows.push(seed); seen.add(id); added.add(id); }
      }
      state.consumed += page.data.length; state.nextOffset = page.nextOffset; state.pagesRead++;
    } while (args.response_view === 'reference' && state.nextOffset !== null && !this.deps.shouldYield?.());
    const coverage = state.coverage, gaps = ids(state.evidence.unknownRoleSubjectIds, coverage.unknownSubjectFormIds,
      coverage.unavailableSubjectIds, coverage.unavailableCollectionSubjectIds);
    const scope: Data = { ...nativeArgs(args), snapshot_ref: state.snapshotRef }; delete scope.offset; delete scope.limit;
    scope.appearanceEvidence = { sourceUnit: coverage.sourceUnit, sourceTotal: coverage.sourceTotal, relationTotal: coverage.relationTotal,
      matchedRelationTotal: coverage.matchedRelationTotal, matchedSubjectTotal: coverage.matchedSubjectTotal,
      unknownRoleSubjectIds: state.evidence.unknownRoleSubjectIds, unknownSubjectFormIds: coverage.unknownSubjectFormIds,
      unavailableSubjectIds: coverage.unavailableSubjectIds, unavailableCollectionSubjectIds: coverage.unavailableCollectionSubjectIds };
    const source: CandidateSource = { tool: 'get_person_characters', source: context.source, scope: JSON.stringify(scope),
      scannedCount: state.consumed, total: coverage.matchedRelationTotal, nextOffset: state.nextOffset,
      complete: coverage.sourceComplete && state.nextOffset === null, privateRecords: include.includes('own_collection') ? 'included' : 'not_applicable',
      readState: { revision: state.pagesRead, firstOffset: 0, pagesRead: state.pagesRead, continuous: true, totalKind: 'exact', excludedNsfwCount: 0, unknownNsfwCount: 0 } };
    const self = include.includes('own_collection');
    const set = this.store.create({ binding, ...(state.inputRef ? { replaceRef: state.inputRef } : {}), refRole: 'input', rows: state.rows, sources: [...state.sources, source], parentRef: state.originRef, inheritParentQualification: true,
      visibility: self ? 'self' : 'public', ...(self && context.account ? { account: context.account } : {}), requiresNsfw: state.requiresNsfw,
      duplicateCount: state.duplicateCount, scopeCoverage: { complete: gaps.length === 0, pendingCount: gaps.length, remainingCount: 0, unknownCount: 0, failedCount: 0 } });
    const fields = args.fields as CandidateField[] ?? DEFAULT_CANDIDATE_FIELDS;
    const query = new CandidateQuery(this.store, { loadFacts: async () => { throw new AppError('INTERNAL_ERROR', '出演召回只投影缓存；补字段应使用refine。'); } });
    const result = await query.execute({ candidate_ref: set.ref, fields, include: [], filter: {}, response_view: args.response_view as 'page' | 'reference' ?? 'page',
      hydrate_fields: false, limit: Number(args.limit ?? 20), coverage_mode: args.coverage_mode as 'summary' | 'full' ?? 'summary' }, binding, context, signal,
    { processIds: [...added], preserveInput: true, filterAlreadyApplied: true, hydrateProjection: false, ...(state.stageRef ? { stageRef: state.stageRef } : {}) });
    state.inputRef = set.ref; state.stageRef = result.candidateRef;
    result.scope = structuredClone(args); result.include = [];
    result.sourcePage = { offset: lastPage!.offset, limit: lastPage!.limit, total: coverage.matchedRelationTotal,
      returnedCount: lastPage!.data.length, nextOffset: state.nextOffset,
      complete: lastPage!.offset === 0 && lastPage!.data.length === coverage.matchedRelationTotal };
    const response: PersonCandidateResponse = { ...result, appearanceStage: { snapshotRef: state.snapshotRef, sourceUnit: coverage.sourceUnit,
      sourceTotal: coverage.sourceTotal, sourceReturnedCount: coverage.sourceReturnedCount, relationTotal: coverage.relationTotal,
      matchedRelationTotal: coverage.matchedRelationTotal, matchedSubjectTotal: coverage.matchedSubjectTotal, relationRowsConsumed: state.consumed,
      subjectCount: new Set(state.rows.map(row => row.id)).size, unknownRoleCount: state.evidence.unknownRoleSubjectIds.length,
      unknownFormCount: coverage.unknownSubjectFormIds.length, unavailableSubjectCount: coverage.unavailableSubjectIds.length,
      unavailableCollectionCount: coverage.unavailableCollectionSubjectIds.length, qualificationGapCount: gaps.length,
      nativeSourceComplete: coverage.sourceComplete, sourcePaginationComplete: state.nextOffset === null } };
    this.refs.set(result.candidateRef, structuredClone(state)); this.refs.set(result.resultRef, structuredClone(state)); return response;
  }
  endReadContext(turnId: string): void { for (const [ref, state] of this.refs) if (state.binding.turnId === turnId) this.refs.delete(ref); }
  close(): void { this.refs.clear(); }
}

const number: JsonSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export function personCandidateValueSchema(input: JsonSchema): JsonSchema {
  const schema = structuredClone(candidateValueSchema(input));
  (schema.properties as Record<string, JsonSchema>).appearanceStage = { type: 'object', additionalProperties: false,
    properties: { snapshotRef: { type: 'string', pattern: '^[a-f0-9]{32}$' }, sourceUnit: { enum: ['character', 'appearance'] },
      ...Object.fromEntries(['sourceTotal','sourceReturnedCount','relationTotal','matchedRelationTotal','matchedSubjectTotal','relationRowsConsumed','subjectCount',
        'unknownRoleCount','unknownFormCount','unavailableSubjectCount','unavailableCollectionCount','qualificationGapCount'].map(key => [key, number])),
      nativeSourceComplete: { type: 'boolean' }, sourcePaginationComplete: { type: 'boolean' } },
    required: ['snapshotRef','sourceUnit','sourceTotal','sourceReturnedCount','relationTotal','matchedRelationTotal','matchedSubjectTotal','relationRowsConsumed','subjectCount',
      'unknownRoleCount','unknownFormCount','unavailableSubjectCount','unavailableCollectionCount','qualificationGapCount','nativeSourceComplete','sourcePaginationComplete'] };
  (schema.required as string[]).push('appearanceStage'); return schema;
}
export function checkPersonCandidateResponse(value: unknown, args: Data, input?: JsonSchema): void {
  const response = value as PersonCandidateResponse, base = { ...response } as Data; delete base.appearanceStage;
  checkCandidateResponse(base, args, input);
  const s = response.appearanceStage;
  if (!s || s.sourceReturnedCount > s.sourceTotal || s.relationRowsConsumed > s.matchedRelationTotal
    || s.sourcePaginationComplete !== (response.sourcePage?.nextOffset === null) || s.subjectCount !== response.set.workingCount
    || s.qualificationGapCount && response.coverage.complete) throw new AppError('MCP_INVALID_RESULT', '出演候选来源单位、资格缺口或分页完成声明不一致。');
  if (input && !compileSchema(personCandidateValueSchema(input))(value)) throw new AppError('MCP_INVALID_RESULT', '出演候选返回不符合固定契约。');
}
