import type { ReactNode } from 'react';
import type { CalloutView } from '../../../../bangumi/src/web/protocol';
import { StarBorder } from '../motion/vendor/StarBorder';

/**
 * 四态文案与图标。
 *
 * 图标是装饰（`aria-hidden`），语义由可见文字承担：色觉障碍用户、浅底低对比的
 * 情形都不该是唯一区分「成功」和「失败」的通道。
 */
const TONE: Record<CalloutView['tone'], { mark: string; label: string }> = {
  progress: { mark: '·', label: '进行中' },
  success: { mark: '✓', label: '成功' },
  warning: { mark: '△', label: '注意' },
  error: { mark: '×', label: '失败' },
};

/**
 * 三段式提示（进行中 / 成功 / 警告 / 失败）。
 *
 * 用 `role="status"`：这类卡片是插入到会话流里的状态说明，读屏器需要主动播报
 * 而不是等用户游走过去。`detail` 用更小的字号做补充，不与主文案抢层级。
 */
export function Callout({ view }: { view: CalloutView }): ReactNode {
  const { tone, text, detail } = view;
  const meta = TONE[tone];
  return (
    // 同时带 contentBlock：四态底色依赖 .contentBlock 里派生的 --content-* 变量
    <div className="contentBlock contentCallout" data-tone={tone} role="status">
      {/* 只有「进行中」才让边框流动：成功/失败/警告是终态，常驻动画只会变成噪音。
          ReactBits StarBorder（参考 https://www.reactbits.dev/animations/star-border）在这里
          只做装饰层——绝对定位铺满、不参与布局，正文压在上层。 */}
      {tone === 'progress' ? (
        <StarBorder
          as="div"
          className="contentCalloutGlow"
          animated
          thickness={0}
          color="var(--bgm-interactive)"
          borderColor="transparent"
          backgroundColor="transparent"
          textColor="inherit"
          aria-hidden="true"
        />
      ) : null}
      <span className="contentCalloutMark" aria-hidden="true">{meta.mark}</span>
      <span className="contentCalloutText">{text}</span>
      <span className="contentCalloutTone">{meta.label}</span>
      {detail === undefined || detail === '' ? null : <p className="contentCalloutDetail">{detail}</p>}
    </div>
  );
}
