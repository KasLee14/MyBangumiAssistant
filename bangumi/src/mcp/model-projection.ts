import { AppError } from '../support/errors.js';
import { assertResourceFields, resourceFields } from './resource-policy.js';
type Data = Record<string, unknown>;
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export const identityProjectionKeys = [
  'id',
  'entity',
  'kind',
  'subjectType',
  'subjectId',
  'characterId',
  'personId',
  'episodeId',
  'indexId',
  'revisionId',
  'blogId',
  'topicId',
  'relationId',
  'replyId',
  'parentId',
  'username',
  'userIdentifier',
  'target',
  'owner',
  'user',
  'author',
  'person',
  'character',
  'subject',
  'episode',
  'weekday',
  'code',
  'targetId',
  'targetKind',
  'ownerId',
  'subjects',
  'actors',
  'creatorRef',
  'appearanceRole',
  'collection'
] as const;
const identity = new Set<string>(identityProjectionKeys);
export const statusProjectionKeys = [
  'schemaVersion',
  'resourceRef',
  'sourceTool',
  'candidateRef',
  'resultRef',
  'collectionRef',
  'coverageRef',
  'contentRef',
  'snapshotRef',
  'collectionScope',
  'visibility',
  'readAt',
  'page',
  'sourcePage',
  'filterCoverage',
  'coverage',
  'accessContext',
  'scope',
  'pending',
  'set',
  'stage',
  'relationStage',
  'appearanceStage',
  'responseView',
  'tool',
  'state',
  'complete',
  'submitted',
  'verified',
  'unknown',
  'failed',
  'submission',
  'verification',
  'targets',
  'steps',
  'items',
  'data',
  'result',
  'continuation',
  'matchedCount',
  'total',
  'count',
  'hasMore',
  'nextOffset',
  'nextCursor',
  'operation',
  'accountId',
  'requiresNsfw',
  'included',
  'delivery',
  'capacity',
  'output',
  'fieldStates',
  'readFields',
  'availableFields',
  'submissionState',
  'expectedAccountId',
  'createdId',
  'relatedId',
  'requestedFields',
  'requestedCollected',
  'requestedEpisodeStatus',
  'affectedEpisodeIds',
  'rejection',
  'networkAttempted',
  'format',
  'status',
  'counts',
  'wholePlan',
  'guidance',
  'bytes',
  'filter',
  'missingFields',
  'failedFields',
  'parents',
  'parentCount'
] as const;
const status = new Set<string>(statusProjectionKeys);
/** 只投影登记工具的身份、流程元数据与显式字段，完整DTO永远留给宿主。 */
export function projectModelResult(value: Data, name?: string, args: Data = {}): Data {
  if (name === 'read_cached_resource') return structuredClone(value);
  if (!name) {
    if (Array.isArray(value.fields)) args = { ...args, fields: value.fields };
    // 兼容显式候选投影调用；普通资源必须给出工具策略。
    if (!String(value.kind).startsWith('candidate_')) throw new AppError('MCP_POLICY_MISSING', '普通资源投影必须指定工具。');
    name = value.kind === 'candidate_coverage' ? 'get_candidate_coverage' : value.kind === 'candidate_lineage' ? 'get_candidate_lineage' : 'refine_subject_candidates';
  }
  if(name==='continue_subject_query' && record(value.result) && Array.isArray(value.result.fields))args={...args,fields:value.result.fields};
  const fields = Array.isArray(args.fields) ? args.fields.filter((field): field is string => typeof field === 'string')
    : name==='read_community_content' ? ['content'] : [];
  assertResourceFields(name, fields);
  const allowed = resourceFields(name);
  const selected = new Set(fields);
  if(name==='get_candidate_lineage')selected.add('relation');
  function project(raw: unknown, key?: string): unknown {
    if (Array.isArray(raw)) return raw.map(item => project(item, key ?? 'data'));
    if (!record(raw)) return raw;
    const output: Data = {};
    for (const [field, item] of Object.entries(raw)) {
      if(field==='scope' && String(raw.kind).startsWith('candidate_')&&!String(raw.kind).startsWith('candidate_output'))continue;
      if(field==='filter'&&!record(raw.collectionScope))continue;
      if(field==='coverage' && record(item)){
        const {sources:_sources,dependencies:_dependencies,...coverage}=structuredClone(item);
        output.coverage=String(raw.kind).startsWith('candidate_')?{...coverage,...(coverage.mode==='full'?{mode:'summary'}:{})}:structuredClone(item);
        continue;
      }
      if(field==='fieldStates'&&record(item)){
        const states=Object.fromEntries(Object.entries(item).filter(([fact,state])=>fact!=='id'&&selected.has(fact)&&['unknown','failed'].includes(String(state))));
        if(Object.keys(states).length)output.fieldStates=states;
        continue;
      }
      if (field === 'presentation') continue;
      if (selected.has(field) && allowed.has(field)) {
        output[field] = structuredClone(item);
        continue;
      }
      if (identity.has(field) || status.has(field)) {
        if (['page', 'sourcePage', 'filterCoverage', 'scope', 'collectionScope', 'fieldStates', 'accessContext', 'delivery', 'capacity', 'counts', 'wholePlan', 'guidance', 'filter', 'stage', 'set', 'relationStage', 'appearanceStage'].includes(field)) output[field] = structuredClone(item);
        else output[field] = project(item, field);
      }
    }
    if (key === undefined) {
      output.fields = fields;
      const available = new Set<string>();
      const visit = (item: unknown): void => {
        if (Array.isArray(item)) {
          item.forEach(visit);
          return;
        }
        if (!record(item)) return;
        for (const [field, data] of Object.entries(item)) {
          if (allowed.has(field)) available.add(field);
          if (!['scope', 'accessContext', 'page', 'fieldStates'].includes(field)) visit(data);
        }
      };
      visit(raw);
      output.availableFields = [...available];
    }
    return output;
  }
  const result = project(value) as Data;
  if (value.kind === 'candidate_coverage') {
    if (Object.hasOwn(value,'sources')) result.sources = structuredClone(value.sources);
    if (Object.hasOwn(value,'dependencies')) result.dependencies = structuredClone(value.dependencies);
  }
  return result;
}
