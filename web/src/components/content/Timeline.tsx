import type { ReactNode } from 'react';
import type { TimelineView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readMaybeText, readText, reading } from './payload';

/** 一条动态。等价性由 `_A` 把住。 */
export interface TimelineEntryProps {
  /** 时间（宿主已格式化，例：2026-04-12 21:40） */
  time: string;
  /** 事件文字（例：看到第 7 话） */
  text: string;
  /** 动作发出者（例：我） */
  actor?: string;
}

/** 入参。 */
export interface TimelineProps {
  /** 区块标题（例：最近动态） */
  title?: string;
  /** 按宿主给出的顺序渲染，组件不重排（例：[{"time":"2026-04-12 21:40","text":"看到第 7 话","actor":"我"},{"time":"2026-04-05 22:10","text":"收藏了条目","actor":"我"},{"time":"2026-03-28 19:02","text":"评分 8 分"}]） */
  entries: TimelineEntryProps[];
}
export type _A = AssertTrue<Equal<TimelineEntryProps, TimelineView['entries'][number]>>;
export type _B = AssertTrue<Equal<TimelineProps, TimelineView>>;

/**
 * 时间线。用 `ol`：动态天然有序。时间用 `<time>` 包裹但不填 `dateTime`——宿主给的是
 * 已格式化的展示文本，猜机器时间只会出错。actor 是行尾独立一列，与时间同级。
 */
export function Timeline({ view }: { view: TimelineProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="Timeline" data={view} />;
  if (!Array.isArray(view.entries)) return <ContentRaw kind="Timeline" data={view} />;

  const r = reading('Timeline');
  const entries: TimelineEntryProps[] = [];
  view.entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      r.miss(`entries[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：时间与文字都取不到的条目剔除（时间线缺一半就失去意义）。
    const time = readText(r, entry.time, `entries[${index}].time`);
    const text = readText(r, entry.text, `entries[${index}].text`);
    if (time === '' && text === '') return;
    const actor = readMaybeText(r, entry.actor, `entries[${index}].actor`);
    entries.push({ time, text, ...(actor === undefined ? {} : { actor }) });
  });

  const title = readMaybeText(r, view.title, 'title');
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
