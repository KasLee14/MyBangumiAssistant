/**
 * 历史会话右侧那一格的相对时间文案。
 *
 * 侧栏常驻列表与 `/sessions` 弹窗是同一件事的两个入口，右边显示的也是同一句话，
 * 所以判定与文案都收在这里，组件只负责把它放进 `<span className="time">`。
 *
 * 分档与 dsh 的会话列表（`@deepseek-ai/dsh-client-ui-primitives` 的 `relativeTime`）
 * 逐档对齐：<1 分钟「刚刚」、<1 小时「N分钟」、<1 天「N小时」、<30 天「N天」、
 * <365 天「N个月」，更久「N年」。浏览器侧没有本地化表，文案直接写进这张表。
 */

/** 一档相对时间。顺序即判定优先级，`limit` 必须递增，末档用 `Infinity` 兜底。 */
interface TimeBucket {
  /** 本档上界（毫秒，取不到）：小于它就算落在本档。 */
  limit: number;
  /** 本档的计数单位（毫秒）；`0` 表示只给固定文案、不拼数量。 */
  unit: number;
  /** 单位词；`unit` 为 `0` 时即整档文案。 */
  word: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BUCKETS: readonly TimeBucket[] = [
  { limit: MINUTE, unit: 0, word: '刚刚' },
  { limit: HOUR, unit: MINUTE, word: '分钟' },
  { limit: DAY, unit: HOUR, word: '小时' },
  { limit: 30 * DAY, unit: DAY, word: '天' },
  { limit: 365 * DAY, unit: 30 * DAY, word: '个月' },
  { limit: Infinity, unit: 365 * DAY, word: '年' },
];

/**
 * 把 `SessionOptionView.modified`（宿主 `toISOString()` 出来的时间串）渲染成那一格文案。
 *
 * `now` 由调用方注入，不在这里取 `Date.now()`：同一屏里的多行必须共用一个时刻，
 * 否则相邻两行可能落在不同档上（与 dsh 把 `now` 注入纯函数的做法一致）。
 *
 * 时间串解析不出来时返回空串——那格留空，好过伪造一个「刚刚」。
 */
export function relativeTimeLabel(modified: string, now: number): string {
  const at = Date.parse(modified);
  if (Number.isNaN(at)) return '';
  // 宿主与浏览器时钟不同步时可能算出负数，按「刚刚」处理（dsh 同样夹到 0）。
  const diff = Math.max(0, now - at);
  // 末档 `limit` 是 `Infinity`，`find` 必然命中；断言只是把 `undefined` 收掉。
  const bucket = BUCKETS.find(candidate => diff < candidate.limit)!;
  return bucket.unit === 0 ? bucket.word : `${Math.floor(diff / bucket.unit)}${bucket.word}`;
}

/** 某个时刻所在**日历日**的零点。用 `setHours` 而不是减 86400000，跨月与夏令时都不会偏。 */
function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 在某个零点上偏移若干**日历日**（`setDate` 会自己处理月/年进位）。 */
function dayOffset(zero: number, days: number): number {
  const date = new Date(zero);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/**
 * 侧栏时间分组：今天 / 昨天 / 7 天内 / 更早。
 *
 * [C44](../../docs/design/decisions/C44-sidebar.md) 把分组从「今天 / 更早」改成四档；
 * 「置顶」不在这里判——它不是时间档，而是一个**独立于时间**的分组，由侧栏先按
 * `ui.pinned` 挑出去（见 `components/mainPage/shell/Sidebar.tsx`）。
 *
 * 与 `relativeTimeLabel` 一样，`now` 由调用方注入，保证同一屏里所有行共用同一个时刻
 * （否则跨零点时相邻两行会落进不同分组）。解析不出来的时间归入「更早」，好过伪造一个今天。
 */
export function sessionDayGroup(modified: string, now: number): string {
  const at = Date.parse(modified);
  if (Number.isNaN(at)) return '更早';
  const today = startOfDay(now);
  if (at >= today) return '今天';
  if (at >= dayOffset(today, -1)) return '昨天';
  // 「7 天内」= 前天起的 5 个日历日（昨天与今天已各占一档）。
  if (at >= dayOffset(today, -6)) return '7 天内';
  return '更早';
}

/** 分组标题的固定顺序：置顶永远在最前，其余按时间由近到远。 */
export const SESSION_GROUP_ORDER = ['置顶', '今天', '昨天', '7 天内', '更早'] as const;
