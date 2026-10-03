import { memo, type ReactNode } from 'react';
import type { TranscriptItemView } from '../../../../bangumi/src/web/protocol';
import { Callout } from './Callout';
import { CompareTable } from './CompareTable';
import { DataTable } from './DataTable';
import { Gallery } from './Gallery';
import { InfoBox } from './InfoBox';
import { LinkList } from './LinkList';
import { ProgressView } from './ProgressView';
import { QuoteBlock } from './QuoteBlock';
import { StatsCard } from './StatsCard';
import { SubjectCards } from './SubjectCards';
import { TagCloud } from './TagCloud';
import { Timeline } from './Timeline';

/**
 * 内容条目联合类型。
 *
 * 用 `Extract` 从协议里「挑」出 12 个内容成员，而不是把类型重写一遍：协议新增
 * 或调整字段时，这里会自动跟着变，不会出现两份定义漂移。
 */
export type ContentItemView = Extract<TranscriptItemView,
  | { kind: 'subjects' } | { kind: 'stats' } | { kind: 'progress' } | { kind: 'infobox' }
  | { kind: 'table' } | { kind: 'timeline' } | { kind: 'tags' } | { kind: 'gallery' }
  | { kind: 'compare' } | { kind: 'quote' } | { kind: 'callout' } | { kind: 'links' }>;

/**
 * 内容条目分发器。
 *
 * 用 `switch` 而不是「kind → 组件」映射表：每种条目的载荷字段名不同，只有逐个
 * 分支才能让编译器把 `item` 收窄成对应成员，从而在传参处发现拼错的字段。
 *
 * `default` 里的穷尽性检查是刻意的：一旦协议新增第 13 个 kind，`item` 就不再是
 * `never`，这里的类型断言会立刻编译失败——提醒维护者来这里补一个分支，而不是
 * 让新条目在界面上静默消失。
 *
 * `memo`：内容条目的载荷来自 `TranscriptItemView`，宿主只在条目本身变化时才发新
 * 对象。流式帧只改标量，历史内容的这一层因此可以整块跳过。各具体组件不需要再
 * 单独包一层——它们只由这里渲染。
 */
export const ContentItem = memo(function ContentItem({ item }: { item: ContentItemView }): ReactNode {
  switch (item.kind) {
    case 'subjects': return <SubjectCards view={item.subjects} />;
    case 'stats': return <StatsCard view={item.stats} />;
    case 'progress': return <ProgressView view={item.progress} />;
    case 'infobox': return <InfoBox view={item.info} />;
    case 'table': return <DataTable view={item.table} />;
    case 'timeline': return <Timeline view={item.timeline} />;
    case 'tags': return <TagCloud view={item.tags} />;
    case 'gallery': return <Gallery view={item.gallery} />;
    case 'compare': return <CompareTable view={item.compare} />;
    case 'quote': return <QuoteBlock view={item.quote} />;
    case 'callout': return <Callout view={item.callout} />;
    case 'links': return <LinkList view={item.links} />;
    default: {
      // 运行时兜底：宿主将来下发了本组件库未覆盖的 kind，就当没有这条，不炸整棵会话树。
      const unknown: never = item;
      void unknown;
      return null;
    }
  }
});
