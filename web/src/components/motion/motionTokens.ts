/**
 * 动效令牌（JS 侧）。
 *
 * 与 `styles/tokens.css` 里的 CSS 变量一一对应：那边给 CSS 过渡用，这边给 motion
 * 的 `transition` 用。**改一处必须同时改另一处**，否则同一个界面会出现两条缓动曲线。
 *
 * 刻度取自已确认的 Bangumi 交互语汇（`docs/bgm-design/interaction-style.md`）：
 * 高频 hover 反馈 100ms、容器展开与主题切换 200–300ms。这里只补齐动效需要的
 * 慢档，不引入更长的时长——长动画会让一个高密度工具界面显得拖沓。
 */

/** 缓动：出场与落位统一用它，进得快、收得稳。 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** 缓动：需要「进出对称」的过渡（面板展开、遮挡淡入淡出）用它。 */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

/**
 * 缓动：明显弹性（过冲约 10%）。用于悬停抬升、按下回位、列表逐项入场。
 *
 * 与 `styles/tokens.css` 的 `--app-ease-spring` 一一对应。
 */
export const EASE_SPRING = [0.34, 1.9, 0.64, 1] as const;

/**
 * 缓动：spring 的**大面积收敛版**（过冲约 3%）。
 * 浮层、弹窗这类大面只允许很小的过冲，否则整块看起来像在弹跳。
 *
 * 与 `styles/tokens.css` 的 `--app-ease-spring-soft` 一一对应。
 */
export const EASE_SPRING_SOFT = [0.34, 1.22, 0.64, 1] as const;

/** 时长（秒，motion 的 transition 用它）。 */
export const DURATION = {
  /** 100ms：按下、聚焦一类即时反馈。 */
  instant: 0.1,
  /** 150ms：hover、颜色与描边变化。 */
  fast: 0.15,
  /** 240ms：小面板开合、状态迁移。 */
  base: 0.24,
  /** 360ms：弹窗、侧栏折叠、区块进入。 */
  slow: 0.36,
  /**
   * 460ms：内容块的**滚动入场**（[C19](../../../docs/design/decisions/C19-message-blocks.md)
   * 定稿 18px / 460ms，样张 `demo.css:3832-3839` 的 `blkInG10`）。
   *
   * 这一档只在 JS 侧消费（`AnimatedContent` 由 motion 驱动），CSS 侧没有对应消费点，
   * 所以不建同名 CSS 令牌——「CSS 与 JS 一一对应」是为了防止同一个过渡出现两条曲线，
   * 而这里只有一条路径。
   */
  reveal: 0.46,
  /** 450ms：只在首屏这样一次性、面积较大的进入里用。 */
  slower: 0.45,
} as const;

/** 位移刻度（px）：入场一律用这几个，避免每处各写一个距离。 */
export const SHIFT = {
  /** 8px：行、条目这类小面积的进入。 */
  row: 8,
  /** 16px：面板、弹窗这类整块的进入。 */
  panel: 16,
  /** 18px：内容块的滚动入场，与 `DURATION.reveal` 配对（同样只在 JS 侧消费）。 */
  reveal: 18,
} as const;

/**
 * 逐项入场的错峰间隔（秒）。
 *
 * 只给短列表用；长列表（会话轮次、长表格）用一次性入场，避免最后一项等太久。
 * 与 `styles/tokens.css` 的 `--app-stagger` 一一对应。
 */
export const STAGGER = 0.055;
