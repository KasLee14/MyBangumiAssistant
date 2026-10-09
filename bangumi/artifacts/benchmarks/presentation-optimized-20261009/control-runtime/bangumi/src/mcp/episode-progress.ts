import { AppError } from '../support/errors.js';

export const MAX_PROGRESS_EPISODES = 2000;
export interface ProgressEpisode { id: number; type: number | null; sort?: number | null }
export function isWatchedUntil(name: string, args: Record<string, unknown>): boolean {
  return name === 'update_single_episode_collection' && args.batch === true;
}
export function requestedEpisodeStatus(name: string, args: Record<string, unknown>): number {
  return isWatchedUntil(name, args) ? 2 : Number(args.collection_type);
}
/** 与官方 batch=true 的同作品正篇、sort<=目标sort谓词一致，不假定序号连续或唯一。 */
export function watchedUntilIds(episodes: readonly ProgressEpisode[], anchorId: number): number[] {
  const anchor = episodes.find(ep => ep.id === anchorId);
  if (!anchor || anchor.type !== 0) throw new AppError('UNSUPPORTED_PROGRESS', '看到此集仅支持正篇目标；特殊章节请明确逐集修改。');
  if (episodes.length > MAX_PROGRESS_EPISODES || episodes.some(ep => ep.type === 0 && (typeof ep.sort !== 'number' || !Number.isFinite(ep.sort)))
    || new Set(episodes.map(ep => ep.id)).size !== episodes.length) throw new AppError('INCOMPLETE_DATA', '正篇序号或完整范围无法核实，未提交看到此集。');
  return episodes.filter(ep => ep.type === 0 && ep.sort! <= anchor.sort!)
    .sort((a, b) => a.sort! - b.sort! || a.id - b.id).map(ep => ep.id);
}
