import { AppError } from '../support/errors.js';
import type { ResourceData } from './resource-contract.js';
const registered = new Set([
  'get_daily_broadcast',
  'search_subjects',
  'browse_subjects',
  'get_subject_details',
  'get_subject_image',
  'get_subject_persons',
  'get_subject_characters',
  'get_subject_relations',
  'get_episodes',
  'get_episode_details',
  'search_characters',
  'search_persons',
  'get_character_details',
  'get_character_image',
  'get_character_subjects',
  'get_character_persons',
  'collect_character',
  'uncollect_character',
  'get_user_character_collections',
  'get_user_character_collection',
  'get_person_details',
  'get_person_image',
  'get_person_subjects',
  'get_person_characters',
  'collect_person',
  'uncollect_person',
  'get_user_person_collections',
  'get_user_person_collection',
  'get_user_info',
  'get_user_avatar',
  'get_current_user',
  'get_user_collections',
  'query_user_collections',
  'get_user_subject_collection',
  'update_subject_collection',
  'get_user_episode_collection',
  'update_episode_collection',
  'get_single_episode_collection',
  'update_single_episode_collection',
  'get_person_revisions',
  'get_person_revision',
  'get_character_revisions',
  'get_character_revision',
  'get_subject_revisions',
  'get_subject_revision',
  'get_episode_revisions',
  'get_episode_revision',
  'create_index',
  'get_index',
  'update_index',
  'get_index_subjects',
  'add_subject_to_index',
  'update_index_subject',
  'remove_subject_from_index',
  'collect_index',
  'uncollect_index',
  'refine_subject_candidates',
  'expand_subject_relations',
  'get_candidate_coverage',
  'get_candidate_lineage',
  'continue_subject_query',
  'prepare_candidate_output',
  'get_subject_comments',
  'get_subject_reviews',
  'get_blog_details',
  'get_blog_comments',
  'get_subject_topics',
  'get_subject_topic_details',
  'get_subject_topic_replies',
  'read_community_content',
  'read_cached_resource',
]);
const fieldPolicies = new Map<string, ReadonlySet<string>>();
export function registerResourcePolicy(name: string, schema: ResourceData, input?: ResourceData): readonly string[] {
  if (!registered.has(name)) throw new AppError('MCP_POLICY_MISSING', `工具 ${name} 未登记资源缓存和投影策略。`);
  const keys = new Set<string>();
  const visitedRefs = new Set<string>();
  const definitions = schema.$defs as ResourceData | undefined;
  const atomicFields = new Set(['infobox','bio','ratingDistribution','content','images','stats','tagStats','excerpt','subjectFacts','ownCollection']);
  const metadata = new Set(['error', 'accessContext', 'scope', 'page', 'sourcePage', 'coverage', 'fieldStates']);
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const row = node as ResourceData;
    if (typeof row.$ref === 'string' && row.$ref.startsWith('#/$defs/') && !visitedRefs.has(row.$ref)) {
      visitedRefs.add(row.$ref);
      visit(definitions?.[row.$ref.slice(8)]);
    }
    if (row.properties && typeof row.properties === 'object') {
      for (const [key, child] of Object.entries(row.properties)) {
        if (metadata.has(key)) continue;
        keys.add(key);
        if(!atomicFields.has(key))visit(child);
      }
    }
    for (const [key, child] of Object.entries(row)) {
      if (!['properties', '$defs', '$ref'].includes(key)) visit(child);
    }
  }
  visit(schema);
  const fieldSchema = ((input?.properties as ResourceData | undefined)?.fields as ResourceData | undefined)?.items as ResourceData | undefined;
  if (Array.isArray(fieldSchema?.enum)) for (const field of fieldSchema.enum) if (typeof field === 'string') keys.add(field);
  keys.delete('raw');
  keys.delete('accessContext');
  keys.delete('value');
  keys.delete('error');
  const containers = [
    'data',
    'items',
    'subjects',
    'actors',
    'parents',
    'creatorRef',
    'subject',
    'person',
    'character',
    'episode',
    'target',
    'owner',
    'user',
    'author',
    'presentation',
    'content',
    'value',
    'raw',
    'scope',
    'accessContext',
    'filter',
    'fields',
    'page',
    'sourcePage',
    'coverage',
    'pending',
    'set',
    'result',
    'collectionScope',
    'collection',
    'relationStage',
    'appearanceStage',
    'fieldStates',
    'resourceRef'
  ];
  // content是正文事实（字符串），仅容器名禁止；裸content请求社区正文仍合法。
  for (const field of containers.filter(field => field !== 'content')) keys.delete(field);
  const declared = [...keys].filter(key => /^[A-Za-z][A-Za-z0-9]*$/.test(key)).sort();
  fieldPolicies.set(name, new Set(declared));
  return declared;
}
export function resourceFields(name: string): ReadonlySet<string> {
  const fields = fieldPolicies.get(name);
  if (!fields) throw new AppError('MCP_POLICY_MISSING', '工具缺少已编译资源投影策略。');
  return fields;
}
export function assertResourceFields(name: string, fields: readonly string[]): void {
  const allowed = resourceFields(name);
  if (fields.some(field => !allowed.has(field))) throw new AppError('INVALID_INPUT', '请求的缓存字段未在此工具资源契约中声明。');
}
