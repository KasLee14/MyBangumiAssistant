import type { ReactNode } from 'react';
import type { QuoteView } from '../../../../bangumi/src/web/protocol';
import { ShinyText } from '../motion/vendor/ShinyText';

/**
 * 引用块（工具原始输出、日志、需要保真的文本）。
 *
 * `mono` 为真时用 `<pre>`：等宽 + 保留空白与换行是「这是机器原始输出」的视觉承诺，
 * 换成普通段落再补 `white-space: pre-wrap` 会丢掉等宽这个更重要的信号。
 * 两种形态都**不截断**——日志被省略号吃掉半行就等于丢证据，溢出交给外层滚动。
 *
 * 标题走 ReactBits 的 `ShinyText`（参考 `https://www.reactbits.dev/text-animations/shiny-text`）：
 * 默认只扫一次（`shimmer` 未开），用来把「这段是原文引用」和普通正文区分开；正文一个字都不动。
 */
export function QuoteBlock({ view }: { view: QuoteView }): ReactNode {
  const { title, text, mono } = view;
  return (
    <figure className="contentBlock contentQuote" aria-label={title === undefined || title === '' ? '引用' : title}>
      {title === undefined || title === '' ? null : (
        <figcaption className="contentQuoteTitle"><ShinyText text={title} /></figcaption>
      )}
      {mono ? <pre className="contentQuoteBody contentQuoteMono">{text}</pre> : <div className="contentQuoteBody">{text}</div>}
    </figure>
  );
}
