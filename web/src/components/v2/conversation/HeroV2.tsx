import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { BlurText } from '../../motion/vendor/BlurText';
import { V2_DURATION, V2_EASE_OUT, V2_SHIFT } from '../../motion/motionTokens';

/**
 * v2 首屏引导。
 *
 * 与 v1 的 `Hero` 是同一段文案与同一个位置，差别在进入方式：标题用 ReactBits 的
 * `BlurText` 由模糊解析清晰（逐词错峰 40ms），徽标与提示语随后浮入。
 *
 * 这里刻意只在首屏用一次这样的「亮相」：会话一旦开始，动效就退回到交互反馈
 * （消息入场、流式光标、按钮状态），界面本身不再有常驻动画。
 */
export function HeroV2(): ReactNode {
  return (
    <div className="v2Hero">
      <BlurText
        text="Bangumi 助手"
        className="v2HeroHeadline"
        animateBy="words"
        direction="top"
        delay={40}
        stepDuration={0.35}
      />
      <motion.span
        className="v2HeroBadge"
        initial={{ opacity: 0, y: V2_SHIFT.row }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: V2_DURATION.slow, ease: V2_EASE_OUT, delay: 0.18 }}
      >
        Web 终端
      </motion.span>
      <motion.p
        className="v2HeroHint"
        initial={{ opacity: 0, y: V2_SHIFT.row }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: V2_DURATION.slow, ease: V2_EASE_OUT, delay: 0.26 }}
      >
        用自然语言查询作品、管理收藏与更新观看或阅读进度；写入前会先给出预览并等待确认。
      </motion.p>
    </div>
  );
}
