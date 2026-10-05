import type { ReactNode } from 'react';
import type { StatEntryView, StatsView } from '../../../../bangumi/src/web/protocol';
import { Counter } from '../motion/vendor/Counter';

/** 条形/柱形长度：ratio 缺失或越界时给出可预期的兜底，不让 NaN 进到样式里。 */
function ratioOf(entry: StatEntryView): number {
  const value = entry.ratio;
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toneOf(entry: StatEntryView): string {
  return entry.tone ?? 'default';
}

/** 一项的数值与可选说明；条形与列表两种模式共用。 */
function EntryValue({ entry }: { entry: StatEntryView }): ReactNode {
  return (
    <span className="contentStatValue">
      {entry.value}
      {entry.hint === undefined || entry.hint === '' ? null : <span className="contentStatHint">{entry.hint}</span>}
    </span>
  );
}

/** 横向条形：长度编码占比，数字保持可读，不靠 tooltip 说明数值。 */
function Bars({ entries }: { entries: StatEntryView[] }): ReactNode {
  return (
    <ul className="contentStatBars">
      {entries.map((entry, index) => (
        <li key={`${entry.label}-${index}`} className="contentStatBarRow" data-tone={toneOf(entry)}>
          <span className="contentStatLabel">{entry.label}</span>
          <span className="contentStatTrack">
            {/* 长度用 scaleX 而不是 width：只动 transform，数据刷新时不触发布局重排 */}
            <span className="contentStatBar" style={{ transform: `scaleX(${ratioOf(entry).toFixed(4)})` }} />
          </span>
          <EntryValue entry={entry} />
        </li>
      ))}
    </ul>
  );
}

/**
 * 竖向柱状（评分分布）。
 *
 * 站点原型的直方图是 10→1 倒序，宿主按 `entries` 给出的顺序原样渲染：
 * 顺序属于数据语义，组件不替宿主重排。
 */
function Histogram({ entries }: { entries: StatEntryView[] }): ReactNode {
  return (
    <ul className="contentStatHistogram" aria-label="分布柱状图">
      {entries.map((entry, index) => {
        const ratio = ratioOf(entry);
        return (
          <li key={`${entry.label}-${index}`} className="contentStatColumn" data-tone={toneOf(entry)}>
            <span className="contentStatColumnValue">{entry.value}</span>
            <span className="contentStatColumnTrack">
              {/* 柱高用 scaleY（transform-origin: bottom），不写 height */}
              <span className="contentStatColumnBar" style={{ transform: `scaleY(${ratio.toFixed(4)})` }} />
            </span>
            <span className="contentStatColumnLabel">{entry.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 纯列表：只有标签与数值，适合平均值、计数这类不构成分布的数据。 */
function List({ entries }: { entries: StatEntryView[] }): ReactNode {
  return (
    <dl className="contentStatList">
      {entries.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="contentStatListRow" data-tone={toneOf(entry)}>
          <dt className="contentStatLabel">{entry.label}</dt>
          <dd className="contentStatListValue"><EntryValue entry={entry} /></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 统计卡：一个主数字 + 一组分布。
 *
 * `headline` 是视觉重心（平均分、总数），`mode` 决定分布的编码方式。这里不画
 * 坐标系与网格线——预览稿的结论是「用细柱承担信息，不要图表库式的装饰」。
 */
export function StatsCard({ view }: { view: StatsView }): ReactNode {
  const { title, headline, entries, mode, note } = view;
  // 只在「纯数字字符串」上启用滚轮读数：带单位或千分位的值（75.9%、12,480）交给静态文本，
  // 否则会把它显示成 75.9 / 12480 这种丢掉语义的数。
  const headlineNumber =
    headline !== undefined && /^-?\d+(\.\d+)?$/.test(headline.value.trim())
      ? Number(headline.value)
      : null;
  return (
    <section className="contentBlock contentStats" aria-label={title === undefined || title === '' ? '统计' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {headline === undefined ? null : (
        <p className="contentStatHeadline">
          <span className="contentStatHeadlineValue">
            {headlineNumber === null ? headline.value : (
              // ReactBits Counter（参考 https://www.reactbits.dev/components/counter）：数字首次出现时滚到位。
              // 关掉官方那两层上下渐隐（gradientHeight=0）——它服务的是整屏大字，这里是 30px 的行内读数。
              <Counter
                value={headlineNumber}
                fontSize={30}
                gap={2}
                horizontalPadding={0}
                gradientHeight={0}
                textColor="var(--bgm-text-strong)"
              />
            )}
          </span>
          <span className="contentStatHeadlineLabel">{headline.label}</span>
        </p>
      )}
      {entries.length === 0 ? (
        <p className="contentEmpty">没有可展示的统计项。</p>
      ) : mode === 'bars' ? (
        <Bars entries={entries} />
      ) : mode === 'histogram' ? (
        <Histogram entries={entries} />
      ) : (
        <List entries={entries} />
      )}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
