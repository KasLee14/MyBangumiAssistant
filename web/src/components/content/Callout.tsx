import type { ReactNode } from 'react';
import type { CalloutView } from '../../types/protocol';
import { StarBorder } from '../motion/vendor/StarBorder';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readMaybeText, readText, reading } from './payload';

/**
 * 入参。
 *
 * 就地声明而不是从协议 import：例值、说明与渲染逻辑放一处。等价性由 `_PropsMatch` 把住
 * ——协议改了而这里没跟上就编译失败，所以不会成为「第二份真相」。
 */
export interface CalloutProps {
  /** 语义色调（例：success） */
  tone: 'progress' | 'success' | 'warning' | 'error';
  /** 主文案（例：已写入 3 项修改） */
  text: string;
  /** 补充说明（例：这一步由宿主执行，界面只反映状态） */
  detail?: string;
}
export type _PropsMatch = AssertTrue<Equal<CalloutProps, CalloutView>>;

const TONES = ['progress', 'success', 'warning', 'error'] as const;

/**
 * 四态文案与图标。
 *
 * 图标是装饰（`aria-hidden`），语义由可见文字承担：色觉障碍用户、浅底低对比的
 * 情形都不该是唯一区分「成功」和「失败」的通道。
 */
const TONE: Record<CalloutProps['tone'], { mark: string; label: string }> = {
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
export function Callout({ view }: { view: CalloutProps }): ReactNode {
  // 载荷来自线上：类型是预期，不是保证。根不是对象时整块退到原始数据。
  if (!isRecord(view)) return <ContentRaw kind="Callout" data={view} />;

  const r = reading('Callout');
  // 局部降级：色调不认识就回落 warning（四态里只有它是「不确定」），文案不是字符串就当没有。
  const tone = readChoice(r, view.tone, 'tone', TONES, 'warning');
  const text = readText(r, view.text, 'text');
  const detail = readMaybeText(r, view.detail, 'detail');
  const meta = TONE[tone];

  return (
    // 同时带 contentBlock：四态底色依赖 .contentBlock 里派生的 --content-* 变量
    <div className="contentBlock contentCallout" data-tone={tone} role="status">
      {/* 只有「进行中」才让边框流动：成功/失败/警告是终态，常驻动画只会变成噪音。 */}
      {tone === 'progress' ? (
        <StarBorder
          as="div"
          className="contentCalloutGlow"
          animated
          thickness={0}
          color="color-mix(in srgb, var(--bgm-interactive) 12%, transparent)"
          speed="2.2s"
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
