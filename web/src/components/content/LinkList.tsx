import type { ReactNode } from 'react';
import type { LinkListView } from '../../../../bangumi/src/web/protocol';

/**
 * 链接列表。
 *
 * 每个链接都是真实可聚焦的 `<a>`：`target="_blank"` 一定配 `rel="noreferrer"`，
 * 否则新页面能通过 `window.opener` 反向控制本页面。`hint` 是同一行的弱文本，
 * 不用 `title` 属性——工具提示只在 hover 时出现，触屏与键盘都拿不到。
 */
export function LinkList({ view }: { view: LinkListView }): ReactNode {
  const { title, links } = view;
  return (
    <section className="contentBlock contentLinks" aria-label={title === undefined || title === '' ? '链接' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {links.length === 0 ? (
        <p className="contentEmpty">没有可展示的链接。</p>
      ) : (
        <ul className="contentLinkList">
          {links.map((link, index) => (
            <li key={`${link.url}-${index}`} className="contentLinkRow">
              <a className="contentLink" href={link.url} target="_blank" rel="noreferrer">
                <span className="contentLinkLabel">{link.label}</span>
                {link.hint === undefined || link.hint === '' ? null : (
                  <span className="contentLinkHint">{link.hint}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
