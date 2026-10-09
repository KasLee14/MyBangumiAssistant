import { isCommunityTool } from './community-schemas.js';
import { subjectSearchLimitations } from './search-capabilities.js';

export interface ReadPlan {
  source: 'v0' | 'p1' | 'community';
  requiresIdentity: boolean;
  requiresNsfw: boolean;
  canFallbackToAccount: boolean;
}
/** 仅按固定工具参数规划来源；是否有本地登录不改变默认公开读取。 */
export function planRead(name: string, args: Record<string, unknown>): ReadPlan {
  const candidateFilter = args.filter as Record<string, unknown> | undefined;
  const candidateTool = ['refine_subject_candidates', 'expand_subject_relations'].includes(name);
  const filters = [candidateFilter, args.parent_filter as Record<string, unknown> | undefined]
    .flatMap(filter => filter ? [filter, ...(Array.isArray(filter.any_of) ? filter.any_of as Record<string, unknown>[] : [])] : []);
  const candidatePrivate = candidateTool && (
    (args.include as string[] | undefined)?.includes('own_collection') === true
    || (args.fields as string[] | undefined)?.some(field => ['personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState'].includes(field)) === true
    || filters.some(filter => ['personal_rating', 'personal_tags', 'collection_types', 'exclude_collection_types'].some(field => filter[field] !== undefined))
  );
  const own = args.username === '-' || args.own === true || name === 'get_current_user'
    || candidatePrivate && args.collection_ref === undefined
    || ['get_single_episode_collection', 'get_user_episode_collection'].includes(name)
    || name === 'get_person_characters' && ((args.include as string[] | undefined)?.includes('own_collection') === true
      || args.result_mode === 'candidates' && args.response_view !== 'reference'
        && (args.fields as string[] | undefined)?.some(field => ['personalRating', 'personalTags', 'personalComment', 'collectionStatus', 'collectionState'].includes(field)) === true);
  const write = /^(?:update_|delete_|add_|remove_|create_|collect_|uncollect_|mark_)/.test(name) || name === 'execute_write_batch';
  const filter = args.filter as Record<string, unknown> | undefined;
  const requiresNsfw = candidateTool && filters.some(filter => filter.nsfw === 'account')
    || name === 'search_subjects' && filter?.nsfw === 'account' && subjectSearchLimitations(filter).length === 0
    || name === 'search_characters' && args.nsfw_filter === true;
  if (own || write) return { source: 'p1', requiresIdentity: true, requiresNsfw: false, canFallbackToAccount: false };
  if (isCommunityTool(name)) return { source: 'community', requiresIdentity: false, requiresNsfw: false, canFallbackToAccount: false };
  return { source: 'v0', requiresIdentity: false, requiresNsfw, canFallbackToAccount:
    ['get_subject_details', 'get_subject_image', 'get_subject_persons', 'get_subject_characters', 'get_subject_relations',
      'get_character_details', 'get_character_image', 'get_character_subjects', 'get_character_persons',
      'get_person_details', 'get_person_image', 'get_person_subjects', 'get_person_characters',
      'get_episode_details', 'get_episodes'].includes(name) };
}
