import type { ReactNode } from 'react';
import type { QuoteView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readFlag, readMaybeText, readText, reading } from './payload';

/** 入参，等价性由 `_PropsMatch` 把住（理由见 `Callout.tsx` 的同名注释）。 */
export interface QuoteBlockProps {
  /** 区块标题（例：接口原始响应） */
  title?: string;
  /** 正文，保留换行与空白（例：{"subject_id":1424}） */
  text: string;
  /** 是否等宽呈现（例：true） */
  mono: boolean;
}
export type _PropsMatch = AssertTrue<Equal<QuoteBlockProps, QuoteView>>;

/**
 * 引用块（工具原始输出、日志、需要保真的文本）。
 *
 * `mono` 为真时用 `<pre>`：等宽 + 保留空白与换行是「这是机器原始输出」的视觉承诺，
 * 换成普通段落再补 `white-space: pre-wrap` 会丢掉等宽这个更重要的信号。
 * 两种形态都**不截断**——日志被省略号吃掉半行就等于丢证据，溢出交给外层滚动。
 */
export function QuoteBlock({ view }: { view: QuoteBlockProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="QuoteBlock" data={view} />;

  const r = reading('QuoteBlock');
  // 局部降级：`mono` 不是布尔就按普通段落——刻意**不**默认等宽，猜错会把普通文案伪装成日志。
  const text = readText(r, view.text, 'text');
  const mono = readFlag(r, view.mono, 'mono', false);
  const title = readMaybeText(r, view.title, 'title');

  return (
    <figure className="contentBlock contentQuote" aria-label={title === undefined || title === '' ? '引用' : title}>
      {title === undefined || title === '' ? null : (
        <figcaption className="contentQuoteTitle">{title}</figcaption>
      )}
      {mono ? <pre className="contentQuoteBody contentQuoteMono">{text}</pre> : <div className="contentQuoteBody">{text}</div>}
    </figure>
  );
}
