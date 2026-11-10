import type { ReactNode } from 'react';
import type { TagCloudItemView } from '../../types/protocol';
import { GlareHover } from '../motion/vendor/GlareHover';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readFlag, readNumber, readText, reading } from './payload';

/** 一个标签。等价性由 `_ItemMatch` 把住。 */
export interface TagCloudItemProps {
  /** 标签名（例：音乐） */
  name: string;
  /** 使用人数（例：1820） */
  count?: number;
  /** 选中态（例：true） */
  selected?: boolean;
}
/** 这个 kind 的载荷**就是数组本身**，没有外层对象。 */
export type TagCloudProps = TagCloudItemProps[];
export type _ItemMatch = AssertTrue<Equal<TagCloudItemProps, TagCloudItemView>>;

/**
 * 标签云。
 *
 * 整块包一层 ReactBits 的 `GlareHover`：`playOnce` 让它只在首次悬停时掠光一次。
 * 标签是**纯展示**：用 `span` 而不是 `button`/`a`——伪装成按钮却什么都不做，比看起来
 * 不可点更糟。
 */
export function TagCloud({ view }: { view: TagCloudProps }): ReactNode {
  // 这个 kind 的根就是数组，不是数组才算结构性失败。
  if (!Array.isArray(view)) return <ContentRaw kind="TagCloud" data={view} />;

  const r = reading('TagCloud');
  const tags: TagCloudItemProps[] = [];
  view.forEach((entry, index) => {
    if (!isRecord(entry)) {
      r.miss(`[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：没有名字的标签剔除（count/选中态只是修饰，名字才是内容）。
    const name = readText(r, entry.name, `[${index}].name`);
    if (name === '') return;

    const count = readNumber(r, entry.count, `[${index}].count`);
    const selected = readFlag(r, entry.selected, `[${index}].selected`, false);
    tags.push({ name, ...(count === undefined ? {} : { count }), ...(selected ? { selected: true } : {}) });
  });

  return (
    <section className="contentBlock contentTags" aria-label="标签">
      {tags.length === 0 ? (
        <p className="contentEmpty">没有可展示的标签。</p>
      ) : (
        <GlareHover
          className="contentTagGlare"
          width="100%"
          height="auto"
          borderColor="transparent"
          borderRadius="var(--app-radius-control)"
          glareColor="color-mix(in srgb, var(--bgm-surface) 32%, transparent)"
          playOnce
        >
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
        </GlareHover>
      )}
    </section>
  );
}
