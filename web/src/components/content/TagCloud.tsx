import type { ReactNode } from 'react';
import type { TagCloudItemView } from '../../../../bangumi/src/web/protocol';
import { GlareHover } from '../motion/vendor/GlareHover';

/**
 * 标签云。
 *
 * 载荷就是标签数组本身（协议里 `tags` 成员的类型是 `TagCloudItemView[]`），与其余
 * 内容条目的「载荷是对象」不同，所以这里直接遍历 props 而不是先取一层字段。
 *
 * 整块包一层 ReactBits 的 `GlareHover`（参考 https://www.reactbits.dev/animations/glare-hover）：
 * `playOnce` 让它只在首次悬停时掠光一次，不做常驻扫光。
 *
 * 标签是**纯展示**：本组件不带点击行为，因此用 `span`，不用 `button`/`a`——
 * 伪装成按钮却什么都不做，比看起来不可点更糟。选中态由主色实心表达，并且
 * 同时带 `data-selected` 供样式与测试定位。
 */
export function TagCloud({ view }: { view: TagCloudItemView[] }): ReactNode {
  return (
    <section className="contentBlock contentTags" aria-label="标签">
      {view.length === 0 ? (
        <p className="contentEmpty">没有可展示的标签。</p>
      ) : (
        <GlareHover
          className="contentTagGlare"
          width="100%"
          height="auto"
          borderColor="transparent"
          borderRadius="var(--app-radius-control)"
          /* 掠光**压低调**：该 prop 的默认值是 `surface 70%`，在浅色标签上会糊成一片白。
             按 `style-demo-content-fix.html` 的「压低强度、只在 hover 掠过一次」原则收到 32%
             （样张只给了原则、没给具体数值，这个数是按原则定的，可随时调）。 */
          glareColor="color-mix(in srgb, var(--bgm-surface) 32%, transparent)"
          playOnce
        >
          <ul className="contentTagCloud">
            {view.map((tag, index) => (
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
