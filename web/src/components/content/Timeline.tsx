import type { ReactNode } from 'react';
import type { TimelineView } from '../../../../bangumi/src/web/protocol';

/**
 * 时间线。
 *
 * 用 `ol`：动态天然有序，顺序由宿主决定（通常是倒序）。时间用 `<time>` 包裹，
 * 但不填 `dateTime`——宿主给的是已格式化的展示文本，猜机器时间只会出错。
 * actor 是行尾的独立一列（不是正文前缀）：它是「谁做的」这一维元信息，与时间同级。
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
              <p className="contentTimelineText">{entry.text}</p>
              {/* actor 是**行尾的独立列**（[C10](../../docs/design/decisions/C10-timeline.md) 定稿）：
                  它原先在 `<p>` 内部，而 `content.css` 给的是行内 flex 项写法
                  （`flex: none; margin-left: auto`）——`margin-left: auto` 在 `<p>` 里不生效，
                  actor 只能当正文前缀，还把正文挤成两段。移出来之后它才真正落到行尾。 */}
              {entry.actor === undefined || entry.actor === '' ? null : (
                <span className="contentTimelineActor">{entry.actor}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
