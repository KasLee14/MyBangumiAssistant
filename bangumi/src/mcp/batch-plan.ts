import { batchDependencyKeys, batchEffectKeys } from './batch-policy.js';
import type { Data } from './resource-output.js';
import type { PlannedWrite } from './write-boundary.js';

/** 编号永远来自原始输入，跳过节点不会改写新目录引用。 */
export function planDependencies(step: PlannedWrite, previous: Map<string, number>): number[] {
  const dependencies = new Set<number>();
  const id = Number(step.binding.args.index_id);
  if (id < 0) dependencies.add(-id);
  for (const key of batchDependencyKeys(step.name, step.binding.args, step.binding.target)) {
    const prior = previous.get(key); if (prior !== undefined) dependencies.add(prior);
  }
  return [...dependencies].sort((a, b) => a - b);
}
export function rememberPlanEffects(name: string, args: Data, target: Data, stepId: number, previous: Map<string, number>): void {
  if (name === 'create_index') return;
  for (const key of batchEffectKeys(name, args, target)) previous.set(key, stepId);
  if (name.includes('episode_collection') && (args.subject_id ?? target.subjectId)) previous.set(`subject:${args.subject_id ?? target.subjectId}`, stepId);
}
export function operationTarget(tool: string, args: Data, indexFrom?: number): Data {
  if (tool === 'create_index') return { kind: 'newIndex', title: args.title };
  if (tool.includes('episode_collection')) return { kind: 'episodes', ...(args.subject_id ? { subjectId: args.subject_id } : {}), episodeIds: args.episode_ids ?? [args.episode_id] };
  if (tool === 'update_subject_collection') return { kind: 'subject', id: args.subject_id };
  if (/^(collect|uncollect)_(character|person)$/.test(tool)) {
    const kind = tool.endsWith('_character') ? 'character' : 'person'; return { kind, id: args[`${kind}_id`] };
  }
  const index = indexFrom ? { indexFrom } : { indexId: args.index_id };
  return args.subject_id ? { kind: 'indexSubject', ...index, subjectId: args.subject_id }
    : { kind: 'index', ...(indexFrom ? { indexFrom } : { id: args.index_id }) };
}
