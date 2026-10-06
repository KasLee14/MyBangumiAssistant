import type { ReactNode } from 'react';
import type { QuoteView } from '../../../../bangumi/src/web/protocol';

/**
 * 引用块（工具原始输出、日志、需要保真的文本）。
 *
 * `mono` 为真时用 `<pre>`：等宽 + 保留空白与换行是「这是机器原始输出」的视觉承诺，
 * 换成普通段落再补 `white-space: pre-wrap` 会丢掉等宽这个更重要的信号。
 * 两种形态都**不截断**——日志被省略号吃掉半行就等于丢证据，溢出交给外层滚动。
 *
 * 标题这里是**纯文本**：原先用 ReactBits 的 `ShinyText`（常驻闪光）把「原文引用」与普通正文
 * 区分开，但用户在 `style-demo-content-v2.html` 选的是 **V3 · 点睛对比**——
 * 按该样本，引用块的标题退成**等宽小字弱色**（见 `styles/content.css` 的 `.contentQuoteTitle`），
 * 区分靠字号与字色，不靠循环动效；常驻循环也因此少一处。
 */
export function QuoteBlock({ view }: { view: QuoteView }): ReactNode {
  const { title, text, mono } = view;
  return (
    <figure className="contentBlock contentQuote" aria-label={title === undefined || title === '' ? '引用' : title}>
      {title === undefined || title === '' ? null : (
        <figcaption className="contentQuoteTitle">{title}</figcaption>
      )}
      {mono ? <pre className="contentQuoteBody contentQuoteMono">{text}</pre> : <div className="contentQuoteBody">{text}</div>}
    </figure>
  );
}
