import type { Episode, MediaType } from './bangumi.js';
import { positiveId, progressCapability } from './bangumi.js';
import { AppError } from './errors.js';

export type EpisodeIntent = { mode: 'through' | 'single'; number: number } | { mode: 'explicit'; episodeId: number };

/** 只生成目标清单；不写网站、不清除其他章节，也不联动收藏状态。 */
export function planEpisodeTargets(type: MediaType, episodes: readonly Episode[], complete: boolean, intent: EpisodeIntent): number[] {
  if (type !== 'anime' && type !== 'real') throw new AppError('UNSUPPORTED_PROGRESS', progressCapability(type).reason);
  if (!complete) throw new AppError('INCOMPLETE_EPISODES', '章节列表不完整，请先读取完整列表。');
  if (intent.mode === 'explicit') {
    const id = positiveId(intent.episodeId);
    if (!episodes.some(ep => ep.id === id)) throw new AppError('EPISODE_NOT_FOUND', '指定章节不属于已确认作品。');
    return [id];
  }
  const number = positiveId(intent.number);
  const main = episodes.filter(ep => ep.type === 0 && ep.number !== null && ep.number >= 1);
  const exact = main.filter(ep => ep.number === number);
  if (exact.length !== 1) throw new AppError('EPISODE_AMBIGUOUS', '主线集数不存在或匹配不唯一，请明确章节。');
  if (intent.mode === 'single') return [exact[0]!.id];
  // 完整分页不等于1～N主线编号连续；不能用存在第N集掩盖中间缺失或重复。
  const numbered = new Map<number, number>();
  for (const ep of main) if (Number.isInteger(ep.number) && ep.number! <= number) numbered.set(ep.number!, (numbered.get(ep.number!) ?? 0) + 1);
  if (numbered.size !== number || [...numbered.values()].some(count => count !== 1)) throw new AppError('EPISODE_AMBIGUOUS', '累计范围存在缺失或重复的主线集数，请明确单集。');
  return main.filter(ep => ep.number! <= number).sort((a,b) => a.number! - b.number!).map(ep => ep.id);
}
