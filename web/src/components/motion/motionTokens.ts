/**
 * 动效令牌（JS 侧）。
 *
 * 与 `styles/tokens.css` 里的 CSS 变量一一对应：那边给 CSS 过渡用，这边给 motion
 * 的 `transition` 用。**改一处必须同时改另一处**，否则同一个界面会出现两条缓动曲线。
 *
 * 刻度取自已确认的 Bangumi 交互语汇（`web/docs/agents/desgin/interaction-style.md`）：
 * 高频 hover 反馈 100ms、容器展开与主题切换 200–300ms。这里只补齐动效需要的
 * 慢档，不引入更长的时长——长动画会让一个高密度工具界面显得拖沓。
 */

/** 缓动：出场与落位统一用它，进得快、收得稳。 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** 缓动：需要「进出对称」的过渡（面板展开、遮挡淡入淡出）用它。 */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

/** 时长（秒，motion 的 transition 用它）。 */
export const DURATION = {
  /** 100ms：按下、聚焦一类即时反馈。 */
  instant: 0.1,
  /** 150ms：hover、颜色与描边变化。 */
  fast: 0.15,
  /** 200ms：小面板开合、状态迁移。 */
  base: 0.2,
  /** 300ms：弹窗、侧栏折叠、区块进入。 */
  slow: 0.3,
  /** 450ms：只在首屏这样一次性、面积较大的进入里用。 */
  slower: 0.45,
} as const;

/** 位移刻度（px）：入场一律用这两个，避免每处各写一个距离。 */
export const SHIFT = {
  /** 8px：行、条目这类小面积的进入。 */
  row: 8,
  /** 16px：面板、弹窗这类整块的进入。 */
  panel: 16,
} as const;
