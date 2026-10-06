import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { BlurText } from '../../motion/vendor/BlurText';
import { DURATION, EASE_OUT, SHIFT } from '../../motion/motionTokens';
import { GearIcon } from '../shell/icons';

/**
 * 首屏引导（空会话）。
 *
 * L-B 之后由三部分组成：标题（`BlurText` 逐个词从模糊里亮相）、一句能力说明、
 * 以及三枚**玻璃示例**。示例点一下就填进输入框——首屏因此从「看」变成可用入口，
 * 同时顺带示范了「浮起层用玻璃」这条表面规则。
 *
 * [C45](../../docs/design/decisions/C45-settings-entry.md) 定稿 ③ 的落脚点最初是「示例**下方**一枚同材质的
 * 玻璃胶囊」，**2026-10-10 修订**：改到**说明与示例之间**、做成**实心深档**按钮
 * 「设置 · 模型 / 代理 / 登录」——首屏是空会话唯一的界面，设置在这里必须有落点
 * （侧栏底部那枚齿轮只管「已经进入会话之后」的那条路径），而深档实心让它一眼就是入口、
 * 不会被读成「第四枚示例」。
 *
 * props 驱动：点示例要写输入草稿（属于全局状态），所以由调用方注入 `onPick`，
 * 组件自己不碰 store（`components/mainPage/conversation/**` 一律 props 驱动）；
 * 打开设置同理，走 `onOpenSettings`。
 *
 * 这里刻意只在首屏用一次这样的「亮相」：会话一旦开始，动效就退回到交互反馈
 * （流式光标、按钮状态），界面本身不再有常驻动画。
 */
const SAMPLES: readonly string[] = [
  '找几部百合标签、评分 8 分以上的动画',
  '把《雨夜之月》标记为看过',
  '我最近标记完成的动画有哪些',
];

export interface HeroProps {
  /** 点示例时把文案交给输入框；不传则不渲染示例（示例不可点就没有意义）。 */
  onPick?: ((text: string) => void) | undefined;
  /** 点「设置」入口时打开设置弹窗；不传则不渲染这一枚入口。 */
  onOpenSettings?: (() => void) | undefined;
}

export function Hero({ onPick, onOpenSettings }: HeroProps): ReactNode {
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
      <motion.p
        className="appHeroHint"
        initial={{ opacity: 0, y: SHIFT.row }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.18 }}
      >
        用自然语言查询作品、管理收藏与更新观看或阅读进度；写入前会先给出预览并等待确认。
      </motion.p>
      {onOpenSettings === undefined ? null : (
        <motion.button
          type="button"
          className="appHeroSettings"
          initial={{ opacity: 0, y: SHIFT.row }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.26 }}
          onClick={onOpenSettings}
        >
          <GearIcon />
          设置 · 模型 / 代理 / 登录
        </motion.button>
      )}
      {onPick === undefined ? null : (
        <motion.div
          className="appHeroSamples"
          initial={{ opacity: 0, y: SHIFT.row }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.34 }}
        >
          {SAMPLES.map(sample => (
            <button
              key={sample}
              type="button"
              className="appGlass appHeroSample"
              onClick={() => { onPick(sample); }}
            >
              {sample}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
