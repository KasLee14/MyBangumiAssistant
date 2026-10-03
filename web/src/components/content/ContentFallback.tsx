import type { ReactNode } from 'react';
import type { ItemIssue } from './validate';

/** 附加问题最多列几条：再多就淹没会话，完整数据在折叠区里。 */
const MAX_EXTRA_ISSUES = 4;

function stringify(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    return '[这段数据无法序列化]';
  }
}

/**
 * 内容条目的降级块。
 *
 * 用途是「`kind` 认识、数据不合法」这一种情形：整条丢掉会让宿主以为渲染成功，
 * 直接抛错会炸掉整棵会话树，所以这里把它换成一条可读提示加折叠的原始数据。
 *
 * 形态沿用 `ErrorRow` 的语汇——状态标记 + 文本，只有标记着色，不做整条彩色横幅；
 * `role="status"` 让读屏器播报，但不抢焦点、不阻断之后的条目。
 */
export function ContentFallback({ kind, issues, raw }: {
  kind: string;
  issues: ItemIssue[];
  raw: unknown;
}): ReactNode {
  const first = issues[0];
  const extra = issues.slice(1, 1 + MAX_EXTRA_ISSUES);
  return (
    <section className="contentBlock contentFallback" role="status">
      <p className="contentFallbackLine">
        <span className="contentFallbackMark" aria-hidden="true">△</span>
        <span className="contentFallbackText">
          {`内容条目「${kind}」无法展示：${first === undefined ? '数据不完整' : first.reason}`}
        </span>
      </p>
      {extra.length > 0 ? (
        <ul className="contentFallbackIssues">
          {extra.map(issue => <li key={issue.path}>{`${issue.path}：${issue.reason}`}</li>)}
        </ul>
      ) : null}
      <details className="contentFallbackRaw">
        <summary>{`原始数据${issues.length > 1 + MAX_EXTRA_ISSUES ? `（另有 ${issues.length - 1 - MAX_EXTRA_ISSUES} 处问题未列出）` : ''}`}</summary>
        <pre className="contentFallbackPre">{stringify(raw)}</pre>
      </details>
    </section>
  );
}
