import type { ReactNode } from 'react';
import type { TagCloudView } from '../../../../bangumi/src/web/protocol';

/**
 * 标签云。
 *
 * 标签是**纯展示**：本组件不带点击行为，因此用 `span`，不用 `button`/`a`——
 * 伪装成按钮却什么都不做，比看起来不可点更糟。选中态由主色实心表达，并且
 * 同时带 `data-selected` 供样式与测试定位。
 */
export function TagCloud({ view }: { view: TagCloudView }): ReactNode {
  const { tags } = view;
  return (
    <section className="contentBlock contentTags" aria-label="标签">
      {tags.length === 0 ? (
        <p className="contentEmpty">没有可展示的标签。</p>
      ) : (
        <ul className="contentTagCloud">
          {tags.map((tag, index) => (
            <li key={`${tag.name}-${index}`} className="contentTagCloudItem">
              <span className="contentTag" data-selected={tag.selected === true}>
                {tag.name}
                {tag.count === undefined ? null : <span className="contentTagCount">{tag.count}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
