import type { CSSProperties, ReactNode } from 'react';
import type { StatEntryView, StatsView } from '../../types/protocol';
import { Counter } from '../motion/vendor/Counter';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readMaybeText, readNumber, readText, reading } from './payload';

/** 一个分布项。等价性由 `_A` 把住。 */
export interface StatEntryProps {
  /** 分档名（例：9） */
  label: string;
  /** 展示值，宿主已格式化的字符串（例：3860） */
  value: string;
  /** 相对量 0–1，决定条形/柱高；越界由组件夹取（例：0.31） */
  ratio?: number;
  /** 数值旁的弱说明（例：占比 31%） */
  hint?: string;
  /** 强调层级（例：primary） */
  tone?: 'default' | 'primary' | 'muted';
}

/** 入参。 */
export interface StatsCardProps {
  /** 区块标题（例：评分分布） */
  title?: string;
  /** 主数字与说明；两者都在才生效（例：{"value":"8.2","label":"平均分"}） */
  headline?: { value: string; label: string };
  /** 分布项（例：[{"label":"10","value":"1420","ratio":0.11},{"label":"9","value":"3860","ratio":0.31},{"label":"8","value":"4210","ratio":0.34}]） */
  entries: StatEntryProps[];
  /** 分布编码方式（例：histogram） */
  mode: 'list' | 'bars' | 'histogram';
  /** 脚注（例：共 12480 人评分） */
  note?: string;
}
export type _A = AssertTrue<Equal<StatEntryProps, StatEntryView>>;
export type _B = AssertTrue<Equal<StatsCardProps, StatsView>>;

const MODES = ['list', 'bars', 'histogram'] as const;
const TONES = ['default', 'primary', 'muted'] as const;

/** 条形/柱形长度：ratio 缺失或越界时给出可预期的兜底，不让 NaN 进到样式里。 */
function ratioOf(entry: StatEntryProps): number {
  const value = entry.ratio;
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function EntryValue({ entry }: { entry: StatEntryProps }): ReactNode {
  return (
    <span className="contentStatValue">
      {entry.value}
      {entry.hint === undefined || entry.hint === '' ? null : <span className="contentStatHint">{entry.hint}</span>}
    </span>
  );
}

function Bars({ entries }: { entries: StatEntryProps[] }): ReactNode {
  return (
    <ul className="contentStatBars">
      {entries.map((entry, index) => (
        <li key={`${entry.label}-${index}`} className="contentStatBarRow" data-tone={entry.tone ?? 'default'}>
          <span className="contentStatLabel">{entry.label}</span>
          <span className="contentStatTrack">
            {/* 长度用 CSS 变量交给样式层：keyframes 的 `to` 帧会盖掉内联 transform。 */}
            <span className="contentStatBar" style={{ '--content-bar': ratioOf(entry).toFixed(4) } as CSSProperties} />
          </span>
          <EntryValue entry={entry} />
        </li>
      ))}
    </ul>
  );
}

/** 竖向柱状（评分分布）：柱高即占比，顺序按宿主给的原样渲染（10→1 属于数据语义）。 */
function Histogram({ entries }: { entries: StatEntryProps[] }): ReactNode {
  return (
    <ul className="contentStatHistogram" aria-label="分布柱状图">
      {entries.map((entry, index) => (
        <li key={`${entry.label}-${index}`} className="contentStatColumn" data-tone={entry.tone ?? 'default'}>
          <span className="contentStatColumnValue">{entry.value}</span>
          <span className="contentStatColumnTrack">
            <span className="contentStatColumnBar" style={{ transform: `scaleY(${ratioOf(entry).toFixed(4)})` }} />
          </span>
          <span className="contentStatColumnLabel">{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

function List({ entries }: { entries: StatEntryProps[] }): ReactNode {
  return (
    <dl className="contentStatList">
      {entries.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="contentStatListRow" data-tone={entry.tone ?? 'default'}>
          <dt className="contentStatLabel">{entry.label}</dt>
          <dd className="contentStatListValue"><EntryValue entry={entry} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** 统计卡：一个主数字 + 一组分布。不画坐标轴与网格线——用细柱承担信息。 */
export function StatsCard({ view }: { view: StatsCardProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="StatsCard" data={view} />;
  if (!Array.isArray(view.entries)) return <ContentRaw kind="StatsCard" data={view} />;

  const r = reading('StatsCard');
  const entries: StatEntryProps[] = [];
  view.entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      r.miss(`entries[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：名与值都取不到的项剔除；ratio 越界由 ratioOf 夹取，不算非法。
    const label = readText(r, entry.label, `entries[${index}].label`);
    const value = readText(r, entry.value, `entries[${index}].value`);
    if (label === '' && value === '') return;
    const ratio = readNumber(r, entry.ratio, `entries[${index}].ratio`);
    const hint = readMaybeText(r, entry.hint, `entries[${index}].hint`);
    entries.push({
      label,
      value,
      tone: readChoice(r, entry.tone, `entries[${index}].tone`, TONES, 'default'),
      ...(ratio === undefined ? {} : { ratio }),
      ...(hint === undefined ? {} : { hint }),
    });
  });

  // headline 不是对象就当没有（不编造一个 0），主数字与说明都取不到也当没有。
  let headline: StatsCardProps['headline'];
  if (isRecord(view.headline)) {
    const value = readText(r, view.headline.value, 'headline.value');
    const label = readText(r, view.headline.label, 'headline.label');
    if (value !== '' || label !== '') headline = { value, label };
  } else if (view.headline !== undefined) {
    r.miss('headline', '不是一个对象');
  }

  const mode = readChoice(r, view.mode, 'mode', MODES, 'list');
  const title = readMaybeText(r, view.title, 'title');
  const note = readMaybeText(r, view.note, 'note');
  // 只在纯数字字符串上启用滚轮读数：带单位或千分位的值交给静态文本，否则会丢掉语义。
  const headlineNumber = headline !== undefined && /^-?\d+(\.\d+)?$/.test(headline.value.trim())
    ? Number(headline.value)
    : null;

  return (
    <section className="contentBlock contentStats" aria-label={title === undefined || title === '' ? '统计' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {headline === undefined ? null : (
        <p className="contentStatHeadline">
          <span className="contentStatHeadlineValue">
            {headlineNumber === null ? headline.value : (
              <Counter
                value={headlineNumber}
                fontSize={28}
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
