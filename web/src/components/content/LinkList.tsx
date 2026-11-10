import type { ReactNode } from 'react';
import type { LinkListView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readLink, readMaybeText, readText, reading } from './payload';

/** 一条链接。等价性由 `_A` 把住。 */
export interface LinkListLinkProps {
  /** 链接文字（例：条目页） */
  label: string;
  /** 必须是 http(s) 绝对地址（例：https://bgm.tv/subject/1424） */
  url: string;
  /** 同行弱文本（例：官方） */
  hint?: string;
}

/** 入参。 */
export interface LinkListProps {
  /** 区块标题（例：相关链接） */
  title?: string;
  /** 链接（例：[{"label":"条目页","url":"https://bgm.tv/subject/1424","hint":"官方"},{"label":"角色列表","url":"https://bgm.tv/subject/1424/characters"},{"label":"制作人员","url":"https://bgm.tv/subject/1424/persons"}]） */
  links: LinkListLinkProps[];
}
export type _A = AssertTrue<Equal<LinkListLinkProps, LinkListView['links'][number]>>;
export type _B = AssertTrue<Equal<LinkListProps, LinkListView>>;

/**
 * 链接列表。每个链接都是真实可聚焦的 `<a>`：`target="_blank"` 必配 `rel="noreferrer"`，
 * 否则新页面能通过 `window.opener` 反向控制本页面。`hint` 是同一行的弱文本——不用
 * `title` 属性，工具提示只在 hover 时出现，触屏与键盘都拿不到。
 */
export function LinkList({ view }: { view: LinkListProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="LinkList" data={view} />;
  if (!Array.isArray(view.links)) return <ContentRaw kind="LinkList" data={view} />;

  const r = reading('LinkList');
  const links: LinkListLinkProps[] = [];
  view.links.forEach((link, index) => {
    if (!isRecord(link)) {
      r.miss(`links[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：没有可用地址的链接剔除——一个点不开的「链接」比没有更糟。
    const url = readLink(r, link.url, `links[${index}].url`);
    if (url === undefined) return;
    const label = readText(r, link.label, `links[${index}].label`);
    const hint = readMaybeText(r, link.hint, `links[${index}].hint`);
    links.push({ label: label === '' ? url : label, url, ...(hint === undefined ? {} : { hint }) });
  });

  const title = readMaybeText(r, view.title, 'title');
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
