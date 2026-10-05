import { useEffect, useState } from 'react';
import { isContentKind, type ContentKind } from '../../components/content/registry';

/**
 * 文档页的极简 hash 路由。
 *
 * 形态对齐 ant.design 文档站：**一个组件一页**，外加一个总览页。
 * 没有引路由库——两台路由（总览 / 某个 kind）用 `hashchange` 手写十几行就够，
 * 也避免为了一个静态文档页新增依赖。
 *
 * - `library.html`（空 hash）→ 总览页
 * - `#/components/overview` → 总览页
 * - `#/components/<kind>` → 该 kind 的详情页（kind 必须是注册表里的 12 个之一）
 * - 其它 hash → `unknown`（页面显示"没这个组件"并给回总览的链接）
 */
export const ROUTE_PREFIX = '#/components/';

export type Route =
  | { name: 'overview' }
  | { name: 'component'; kind: ContentKind }
  | { name: 'unknown'; path: string };

export const OVERVIEW_HREF = `${ROUTE_PREFIX}overview`;

export function componentHref(kind: ContentKind): string {
  return `${ROUTE_PREFIX}${kind}`;
}

export function parseRoute(hash: string): Route {
  const raw = hash.trim();
  if (raw === '' || raw === '#' || raw === ROUTE_PREFIX) return { name: 'overview' };
  if (!raw.startsWith(ROUTE_PREFIX)) return { name: 'unknown', path: raw };
  const tail = raw.slice(ROUTE_PREFIX.length).replace(/\/+$/, '');
  if (tail === '' || tail === 'overview') return { name: 'overview' };
  return isContentKind(tail) ? { name: 'component', kind: tail } : { name: 'unknown', path: tail };
}

/** 订阅 hash 变化；前进/后退与手改地址栏都会走到这里。 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const sync = (): void => { setRoute(parseRoute(window.location.hash)); };
    window.addEventListener('hashchange', sync);
    sync();
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return route;
}

/**
 * 切页：写 hash（进历史，前进后退可用）并把内容区滚回顶部。
 *
 * 用 `location.hash = ...` 而不是 `history.pushState`：前者会触发 `hashchange`，
 * 路由状态只有一处来源；后者要自己再通知一次，反而容易出现两套状态。
 */
export function navigate(href: string): void {
  window.location.hash = href.startsWith('#') ? href.slice(1) : href;
  document.querySelector('.libContent')?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}
