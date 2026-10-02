import { MEDIA_LABELS, MEDIA_TYPES, type MediaType } from '../domain/bangumi.js';
import type { CollectionCounts, CollectionPage } from '../domain/collection-library.js';
import { summarizeCollections } from '../domain/collection-library.js';
import { displayText } from './ui/format.js';

function statusLabels(type: MediaType): Record<string, string> {
  const verb = ({ book: '读', anime: '看', music: '听', game: '玩', real: '看' })[type];
  return { wish: `想${verb}`, completed: `${verb}过`, in_progress: `在${verb}`, on_hold: '搁置', dropped: '抛弃' };
}
export function showCollectionPage(page: CollectionPage): string {
  return displayText([`账户：${page.account.username}（#${page.account.id}）　范围：${page.scope.type ? MEDIA_LABELS[page.scope.type] : '五类收藏'}${page.scope.status ? ` / ${page.scope.status}` : ''}`,
    `符合条件共${page.total}项，本页${page.data.length}项，偏移${page.offset}；${page.complete ? '本页覆盖完整范围' : '本页不是完整清单'}。`,
    ...page.data.map(item => `#${item.subjectId} ${item.nameCn || item.name}（${MEDIA_LABELS[item.type]}，${statusLabels(item.type)[item.status]}，个人评分：${item.rate === null ? '未知' : item.rate === 0 ? '未评分' : item.rate}）\n${item.url}`),
    ...(page.nextOffset === null ? [] : [`下一页：--offset ${page.nextOffset}`]), `读取时间：${page.readAt}`].join('\n'));
}
function ratingLine(counts: CollectionCounts): string {
  const ratings = counts.ratings;
  return `个人评分分布：${Object.entries(ratings.distribution).map(([rating, count]) => `${rating}分 ${count}`).join('；')}\n未评分：${ratings.unrated}；未知：${ratings.unknown}；平均分：${ratings.average ?? '无'}（${ratings.rated}项有效评分）`;
}
export function showCollectionSummary(summary: ReturnType<typeof summarizeCollections>): string {
  const types = summary.scope.type ? [summary.scope.type] : MEDIA_TYPES;
  const labels = summary.scope.type ? statusLabels(summary.scope.type) : { wish: '计划', completed: '已完成', in_progress: '进行中', on_hold: '搁置', dropped: '抛弃' };
  return displayText([`账户：${summary.account.username}（#${summary.account.id}）　范围：${summary.scope.type ? MEDIA_LABELS[summary.scope.type] : '五类收藏'}${summary.scope.status ? ` / ${labels[summary.scope.status]}` : ' / 全部状态'}`,
    `共${summary.overall.total}项；已完成${summary.overall.statuses.completed}项。`, ratingLine(summary.overall),
    ...types.map(type => {
      const counts = summary.byType[type]; const labels = statusLabels(type);
      return `\n${MEDIA_LABELS[type]}：${counts.total}项；${Object.entries(counts.statuses).map(([status, count]) => `${labels[status]} ${count}`).join('；')}\n${ratingLine(counts)}`;
    }), `\n读取时间：${summary.readAt}`, summary.basis, summary.consistency].join('\n'));
}
