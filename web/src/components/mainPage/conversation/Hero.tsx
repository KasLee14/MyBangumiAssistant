import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { BlurText } from '../../motion/vendor/BlurText';
import { DURATION, EASE_OUT, SHIFT } from '../../motion/motionTokens';

/**
 * 首屏引导。
 *
 * 它是会话滚动体的 `hero` 槽位内容：会话完全空且空闲时由页面装配传入，此时
 * `.appStageScroll[data-phase='hero']` 生效，输入卡改用更高的最小高度。
 *
 * 标题用 ReactBits 的 `BlurText` 由模糊解析清晰（逐词错峰 40ms），徽标与提示语随后浮入。
 * 这里刻意只在首屏用一次这样的「亮相」：会话一旦开始，动效就退回到交互反馈
 * （消息入场、流式光标、按钮状态），界面本身不再有常驻动画。
 */
export function Hero(): ReactNode {
  return (
    <div className="appHero">
      <BlurText
        text="Bangumi 助手"
        className="appHeroHeadline"
        animateBy="words"
        direction="top"
        delay={40}
        stepDuration={0.35}
      />
      <motion.span
        className="appHeroBadge"
        initial={{ opacity: 0, y: SHIFT.row }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.18 }}
      >
        Web 终端
      </motion.span>
      <motion.p
        className="appHeroHint"
        initial={{ opacity: 0, y: SHIFT.row }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.26 }}
      >
        用自然语言查询作品、管理收藏与更新观看或阅读进度；写入前会先给出预览并等待确认。
      </motion.p>
    </div>
  );
}
