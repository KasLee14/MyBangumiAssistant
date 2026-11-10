import type { ReactNode } from 'react';

/** 折叠区里的原始数据：循环引用等极端情况不抛错，退化成一句说明。 */
function stringify(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    return '[这段数据无法序列化]';
  }
}

/**
 * 「整块不可渲染」的出口：显示一句说明加折叠的原始数据。
 *
 * 什么时候用：各组件自己的 `readXxx` 判断这条载荷连降级都摆不出来（例如 `Callout` 的
 * 文字与详情都取不到、`SubjectCards` 的 `items` 根本不是数组）。**由组件决定何时调用**，
 * 分发器不做这个判断——这是这次改造的核心分工。
 *
 * 与改造前的 `ContentFallback` 的差别：不再有「问题清单」。逐字段的问题说明现在只进
 * 开发期 `console.warn`（见 `payload.ts` 的 `Reading.miss`），界面上只有一句「数据不完整」。
 * 用户不需要知道是哪个字段的类型错了，开发者有控制台。
 *
 * 样式复用 `.contentFallback*`（`content.css`）：那组类名现在表达的是「原始数据兜底」，
 * 与组件的降级形态无关。
 */
export function ContentRaw({ kind, data }: { kind: string; data: unknown }): ReactNode {
  return (
    <section className="contentBlock contentFallback" role="status">
      <p className="contentFallbackLine">
        <span className="contentFallbackMark" aria-hidden="true">△</span>
        <span className="contentFallbackText">{`内容条目「${kind}」的数据不完整，无法展示。`}</span>
      </p>
      <details className="contentFallbackRaw">
        <summary>原始数据</summary>
        <pre className="contentFallbackPre">{stringify(data)}</pre>
      </details>
    </section>
  );
}
