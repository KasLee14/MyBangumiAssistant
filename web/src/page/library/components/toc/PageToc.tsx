import { useEffect, useState, type ReactNode } from 'react';
import { PAGE_ANCHORS } from '../ComponentPage';

/**
 * 右侧页内目录：自绘，滚动时同步高亮。
 *
 * 为什么不走 `location.hash` 锚点：详情页的地址本身就是路径（`/library/components/<kind>`），
 * 哈希会与它互相覆盖；所以这里自己滚动（`scrollIntoView` + `data-active`），把路由留给页面。
 *
 * 锚点清单从 `ComponentPage` 取（`PAGE_ANCHORS` 是详情页四块结构的契约），不在这里再抄一份，
 * 否则详情页改了块 id 而目录指向旧 id 时会静默点不动。
 */
export function PageToc(): ReactNode {
  const [active, setActive] = useState<string>(PAGE_ANCHORS[0].id);

  useEffect(() => {
    const targets = PAGE_ANCHORS
      .map(anchor => document.getElementById(anchor.id))
      .filter((element): element is HTMLElement => element !== null);
    // 观察详情页真实存在的那几块（`PAGE_ANCHORS` 与 `ComponentPage` 渲染的 id 一一对应）：
    // 先在挂载时取一次元素，避免每次滚动都查 DOM。rootMargin 上方留 72px 给顶栏，
    // 下方收掉 70% 视口，于是「滚到视野上缘」才换高亮。
    const observer = new IntersectionObserver(entries => {
      // 同时可见时取最上面那个：向下滚时它才是「正在读的那一块」。
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible !== undefined) setActive(visible.target.id);
    }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <ul className="libToc">
      {PAGE_ANCHORS.map(anchor => (
        <li key={anchor.id}>
          <button
            type="button"
            className="libTocLink"
            data-active={anchor.id === active}
            onClick={() => { document.getElementById(anchor.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          >
            {anchor.title}
          </button>
        </li>
      ))}
    </ul>
  );
}
