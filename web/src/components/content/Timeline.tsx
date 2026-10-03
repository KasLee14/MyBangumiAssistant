import type { ReactNode } from 'react';
import type { TimelineView } from '../../../../bangumi/src/web/protocol';

/**
 * 时间线。
 *
 * 用 `ol`：动态天然有序，顺序由宿主决定（通常是倒序）。时间用 `<time>` 包裹，
 * 但不填 `dateTime`——宿主给的是已格式化的展示文本，猜机器时间只会出错。
 * actor 只是弱化前缀，不隐藏：悬停才看得到的「谁做的」等于没有。
 */
export function Timeline({ view }: { view: TimelineView }): ReactNode {
  const { title, entries } = view;
  return (
    <section className="contentBlock contentTimeline" aria-label={title === undefined || title === '' ? '时间线' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {entries.length === 0 ? (
        <p className="contentEmpty">没有可展示的动态。</p>
      ) : (
        <ol className="contentTimelineList">
          {entries.map((entry, index) => (
            <li key={`${entry.time}-${index}`} className="contentTimelineRow">
              <time className="contentTimelineTime">{entry.time}</time>
              <p className="contentTimelineText">
                {entry.actor === undefined || entry.actor === '' ? null : (
                  <span className="contentTimelineActor">{entry.actor}</span>
                )}
                {entry.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
