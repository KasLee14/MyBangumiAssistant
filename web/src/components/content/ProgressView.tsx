import type { CSSProperties, ReactNode } from 'react';
import type { ProgressView as ProgressViewModel } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readMaybeText, readNumber, readText, reading } from './payload';

/** 一个章节格。等价性由 `_A` 把住。 */
export interface ProgressEpisodeProps {
  /** 章节 ID，用作列表 key（例：7） */
  id: number;
  /** 短标签（例：7） */
  label: string;
  /** 三态（例：current） */
  state: 'done' | 'current' | 'todo';
}

/** 入参。 */
export interface ProgressViewProps {
  /** 区块标题（例：观看进度） */
  title?: string;
  /** 已看到第几（例：7） */
  current?: number;
  /** 总共多少（例：13） */
  total?: number;
  /** 单位（例：话） */
  unit?: string;
  /** 章节网格；与数值进度可同时出现（例：[{"id":1,"label":"1","state":"done"},{"id":2,"label":"2","state":"done"},{"id":3,"label":"3","state":"done"},{"id":4,"label":"4","state":"current"},{"id":5,"label":"5","state":"todo"},{"id":6,"label":"6","state":"todo"}]） */
  episodes?: ProgressEpisodeProps[];
  /** 脚注（例：上次观看：2026-04-12） */
  note?: string;
}
export type _A = AssertTrue<Equal<ProgressEpisodeProps, NonNullable<ProgressViewModel['episodes']>[number]>>;
export type _B = AssertTrue<Equal<ProgressViewProps, ProgressViewModel>>;

const EPISODE_LABEL: Record<ProgressEpisodeProps['state'], string> = { done: '已看', current: '当前', todo: '未看' };
const STATES = ['done', 'current', 'todo'] as const;

/** 数值进度的百分比；total 缺失或为 0 时不做除法，避免 NaN 宽度。 */
function percentOf(current: number | undefined, total: number | undefined): number | null {
  if (typeof current !== 'number' || typeof total !== 'number' || total <= 0) return null;
  return Math.min(100, Math.max(0, (current / total) * 100));
}

/** 章节网格：站点里可点，但本组件只做展示，因此用 `span` + 状态文案。 */
function EpisodeGrid({ episodes }: { episodes: ProgressEpisodeProps[] }): ReactNode {
  return (
    <ul className="contentEpGrid" aria-label="章节状态">
      {episodes.map(episode => (
        <li
          key={episode.id}
          className="contentEpCell"
          data-state={episode.state}
          title={`${episode.label} · ${EPISODE_LABEL[episode.state]}`}
        >
          <span className="contentEpLabel">{episode.label}</span>
          <span className="contentEpState">{EPISODE_LABEL[episode.state]}</span>
        </li>
      ))}
    </ul>
  );
}

/** 进度：数值进度条与章节网格，可同时出现，也可只出现其一。 */
export function ProgressView({ view }: { view: ProgressViewProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="ProgressView" data={view} />;

  const r = reading('ProgressView');
  // 局部降级：episodes 缺席或不是数组 → 当作没有章节网格，数值进度照常显示。
  let episodes: ProgressEpisodeProps[] | undefined;
  if (Array.isArray(view.episodes)) {
    episodes = [];
    view.episodes.forEach((episode, index) => {
      if (!isRecord(episode)) {
        r.miss(`episodes[${index}]`, '不是一个对象');
        return;
      }
      const id = readNumber(r, episode.id, `episodes[${index}].id`);
      if (id === undefined) return;
      const label = readText(r, episode.label, `episodes[${index}].label`);
      episodes?.push({
        id,
        label: label === '' ? String(id) : label,
        state: readChoice(r, episode.state, `episodes[${index}].state`, STATES, 'todo'),
      });
    });
  } else if (view.episodes !== undefined) {
    r.miss('episodes', '不是一个数组');
  }

  const title = readMaybeText(r, view.title, 'title');
  const unit = readMaybeText(r, view.unit, 'unit');
  const note = readMaybeText(r, view.note, 'note');
  const current = readNumber(r, view.current, 'current');
  const total = readNumber(r, view.total, 'total');
  const percent = percentOf(current, total);
  const unitText = unit === undefined || unit === '' ? '' : ` ${unit}`;
  const numeric = typeof current === 'number' && typeof total === 'number';
  const progressLabel = unit === undefined || unit === '' ? '进度' : `${unit}进度`;

  return (
    <section className="contentBlock contentProgress" aria-label={title === undefined || title === '' ? '进度' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {!numeric && episodes === undefined ? <p className="contentEmpty">没有可展示的进度。</p> : null}
      {numeric ? (
        <>
          <p className="contentProgressHead">
            <span className="contentProgressValue">{current} / {total}{unitText}</span>
            {percent === null ? null : <span className="contentProgressPercent">{percent.toFixed(0)}%</span>}
          </p>
          {percent === null ? null : (
            <div
              className="contentProgressTrack"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={current}
              aria-label={progressLabel}
            >
              <span
                className="contentProgressBar"
                style={{ '--content-progress': String(percent / 100) } as CSSProperties}
              />
            </div>
          )}
        </>
      ) : null}
      {episodes === undefined || episodes.length === 0 ? null : <EpisodeGrid episodes={episodes} />}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
