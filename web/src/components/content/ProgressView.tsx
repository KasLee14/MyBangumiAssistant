import type { CSSProperties, ReactNode } from 'react';
import type { ProgressView as ProgressViewModel } from '../../../../bangumi/src/web/protocol';

type Episode = NonNullable<ProgressViewModel['episodes']>[number];
type EpisodeState = Episode['state'];

/** 章节状态的文案：一定要有文字，不能只靠颜色区分已看/当前/未看。 */
const EPISODE_LABEL: Record<EpisodeState, string> = {
  done: '已看',
  current: '当前',
  todo: '未看',
};

/** 数值进度的百分比；total 缺失或为 0 时不做除法，避免 NaN 宽度。 */
function percentOf(current: number | undefined, total: number | undefined): number | null {
  if (typeof current !== 'number' || typeof total !== 'number' || total <= 0) return null;
  return Math.min(100, Math.max(0, (current / total) * 100));
}

/**
 * 章节网格。
 *
 * 站点里这些方块是可点的，但本组件只做展示（宿主当前不接收章节点击），
 * 因此用 `span` + 状态文案，不伪装成按钮，也不把状态只写在 hover 里。
 */
function EpisodeGrid({ episodes }: { episodes: Episode[] }): ReactNode {
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

/**
 * 进度：数值进度条与章节网格。
 *
 * 两者可以同时出现（「整体第 12 / 28 话」+「逐话状态」），也可以只出现其一：
 * 只给数值时不画网格，只给章节时不编造总数。
 */
export function ProgressView({ view }: { view: ProgressViewModel }): ReactNode {
  const { title, current, total, unit, episodes, note } = view;
  const percent = percentOf(current, total);
  const unitText = unit === undefined || unit === '' ? '' : ` ${unit}`;
  // 数值行：有 current/total 才显示「12 / 28 话」。
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
              {/* 进度长度用 **CSS 变量**交给样式层（不写内联 `transform`）：
                  keyframes 的 `to` 帧会盖掉内联值，动画一结束条就被拉到满格。
                  几何与入场动画都在 `content.css` 的 `.contentProgressBar` 上。 */}
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
