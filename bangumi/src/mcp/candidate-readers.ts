import { AppError } from '../support/errors.js';
import { CANDIDATE_SUBJECT_FACT_FIELDS, type CandidateField, type CandidateFactPatch, type CandidateRow, type CandidateSource } from './candidate-contract.js';
import { durationFacts, normalizeCandidateDate } from './subject-facts.js';

type Data = Record<string, unknown>;
export interface CandidateNativeReads {
  details(id: number, include: string[], signal?: AbortSignal): Promise<Data>;
  collection(id: number, signal?: AbortSignal): Promise<Data>;
  relations(id: number, signal?: AbortSignal): Promise<Data>;
}
const personal = new Set(['collectionState', 'collectionStatus', 'personalRating', 'personalTags', 'personalComment']);
/** 只由规范化平台/元标签判断形式；标题不作为证据。 */
export function candidateSubjectForm(row: Data): string | null {
  const values = [row.platform, ...(Array.isArray(row.metaTags) ? row.metaTags : [])];
  const forms = new Set(values.flatMap(value => {
    if (typeof value !== 'string') return [];
    const label = value.trim().toLowerCase();
    return ['tv', '电视动画', 'tv动画', 'テレビアニメ'].includes(label) ? ['tv']
      : ['ova', 'oad'].includes(label) ? ['ova']
      : ['movie', '剧场版', '映画', '剧场动画'].includes(label) ? ['movie']
      : ['web', 'ona', '网络动画', '网络放送'].includes(label) ? ['web'] : [];
  }));
  return forms.size === 1 ? [...forms][0]! : null;
}
function evidence(value: Data, tool: string, fallbackScope: Data = {}): CandidateSource[] {
  const context = value.accessContext as Data | undefined;
  if (!context || !['v0', 'p1', 'web'].includes(String(context.source))) return [];
  const page = value.page as Data | undefined;
  return [{ tool, source: context.source as 'v0' | 'p1' | 'web', scope: JSON.stringify(value.scope ?? fallbackScope),
    complete: !page || page.nextOffset === null, scannedCount: page ? Number(page.returnedCount) : 1,
    total: page && typeof page.total === 'number' ? page.total : 1, nextOffset: page ? page.nextOffset as number | null : null,
    privateRecords: value.visibility === 'self' ? 'included' : 'public_only' }];
}
/** 依赖组只读取一次；所有返回事实先经过原生工具的账户、对象和类型校验。 */
export class CandidateReaders {
  constructor(private readonly reads: CandidateNativeReads) {}
  async load(row: CandidateRow, fields: readonly CandidateField[], include: readonly string[], signal?: AbortSignal): Promise<CandidateFactPatch> {
    const facts: Data = {}; const sources: CandidateSource[] = []; let requiresNsfw = false;
    const fieldStates: NonNullable<CandidateFactPatch['fieldStates']> = {};
    const failureCodes: NonNullable<CandidateFactPatch['failureCodes']> = {};
    const group = async (owned: string[], operation: () => Promise<void>) => {
      signal?.throwIfAborted();
      try { await operation(); }
      catch (error) {
        signal?.throwIfAborted();
        if (error instanceof AppError && ['ACCOUNT_CHANGED', 'CANDIDATE_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED', 'BGM_AUTH_EXPIRED', 'BGM_AUTH_REQUIRED', 'CREF_COVERAGE_INSUFFICIENT'].includes(error.code)) throw error;
        for (const field of owned as CandidateField[]) {
          facts[field] = null; fieldStates[field] = 'failed';
          failureCodes[field] = error instanceof AppError ? error.code : 'READ_FAILED';
        }
      }
    };
    const requested = new Set<string>(fields);
    if (include.includes('subject_facts')) for (const field of CANDIDATE_SUBJECT_FACT_FIELDS)
      if (field !== 'id' && row.fieldStates[field] !== 'known' && !row.resolvedFields.includes(field)) requested.add(field);
    const publicFields = [...requested].filter(field => !personal.has(field) && field !== 'relations' && field !== 'id');
    if (publicFields.length) {
      await group(publicFields, async () => {
      const groups = ['summary', 'infobox'].filter(field => requested.has(field));
      if (requested.has('durationMinutes') && !groups.includes('infobox')) groups.push('infobox');
      const value = await this.reads.details(row.id, groups, signal);
      const supplementOnly = value.candidateCacheSupplementOnly === true;
      for (const field of ['name', 'nameCn', 'subjectType', 'date', 'platform', 'nsfw', 'score', 'rank', 'ratingCount', 'tags', 'metaTags', 'url', 'summary', 'infobox']) {
        if (Object.hasOwn(value, field) && (!supplementOnly || groups.includes(field) || row.fieldStates[field as CandidateField] !== 'known')) facts[field] = field === 'date' ? normalizeCandidateDate(value[field]) : value[field];
      }
      // 原生body缓存只补缺：较新的宿主已知基础事实和派生事实不能被旧body回写。
      const formInput = supplementOnly ? { ...value, ...Object.fromEntries(['subjectType', 'platform', 'metaTags']
        .filter(field => row.fieldStates[field as CandidateField] === 'known').map(field => [field, row.facts[field as CandidateField]])) } : value;
      if (!supplementOnly || row.fieldStates.subjectForm !== 'known') facts.subjectForm = candidateSubjectForm(formInput);
      if (Object.hasOwn(value, 'infobox') && (!supplementOnly || row.fieldStates.durationMinutes !== 'known')) Object.assign(facts, durationFacts(value));
      requiresNsfw ||= value.nsfw === true || value.candidateRequiresNsfw === true;
      sources.push(...evidence(value, 'get_subject_details', { subject_id: row.id, include: groups }));
      });
    }
    if ([...requested].some(field => personal.has(field))) {
      await group([...requested].filter(field => personal.has(field)), async () => {
      const value = await this.reads.collection(row.id, signal);
      requiresNsfw ||= value.candidateRequiresNsfw === true;
      if (!['collected', 'not_collected', 'unavailable'].includes(String(value.state))) throw new AppError('MCP_INVALID_RESULT', '候选收藏状态缺少有效证据。');
      facts.collectionState = value.state === 'unavailable' ? 'unknown' : value.state;
      const collection = value.collection as Data | null;
      for (const field of ['collectionStatus', 'personalRating', 'personalTags']) facts[field] = collection?.[field] ?? null;
      facts.personalComment = collection?.comment ?? null;
      sources.push(...evidence(value, 'get_user_subject_collection'));
      });
    }
    if (requested.has('relations')) {
      await group(['relations'], async () => {
      const value = await this.reads.relations(row.id, signal);
      facts.relations = value.data;
      requiresNsfw ||= value.candidateRequiresNsfw === true;
      sources.push(...evidence(value, 'get_subject_relations'));
      });
    }
    return { facts, sources, fieldStates, failureCodes, resolvedFields: Object.keys(facts) as CandidateField[], requiresNsfw } as CandidateFactPatch;
  }
}
