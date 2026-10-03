import { useState, type ReactNode } from 'react';
import type { GalleryView } from '../../../../bangumi/src/web/protocol';

type GalleryItem = GalleryView['items'][number];

/**
 * 一节横向卡片。
 *
 * 每张卡单独记录封面加载失败，失败时回落到占位块（尺寸不变），
 * 卡片不会因为某一张图挂掉而参差不齐。
 */
function GalleryCard({ item }: { item: GalleryItem }): ReactNode {
  const [failed, setFailed] = useState(false);
  const broken = item.image === undefined || item.image === '' || failed;
  const body = (
    <>
      <span className="contentGalleryCover" data-empty={broken}>
        {broken ? null : <img src={item.image} alt={`${item.name} 的封面`} loading="lazy" onError={() => setFailed(true)} />}
      </span>
      <span className="contentGalleryName">{item.name}</span>
      {item.subtitle === undefined || item.subtitle === '' ? null : (
        <span className="contentGallerySubtitle">{item.subtitle}</span>
      )}
    </>
  );
  return (
    <li className="contentGalleryItem">
      {item.url === undefined || item.url === '' ? (
        <div className="contentGalleryCard">{body}</div>
      ) : (
        <a className="contentGalleryCard" href={item.url} target="_blank" rel="noreferrer">{body}</a>
      )}
    </li>
  );
}

/**
 * 横向列表（角色、关联条目、图集）。
 *
 * `overflow-x: auto` 且**不隐藏滚动条**：滚动条是键盘与触屏之外唯一能说明
 * 「右边还有内容」的信号，隐藏它会让内容变成不可发现的溢出。容器加
 * `tabIndex={0}`，让键盘用户也能用方向键滚动这一排。
 */
export function Gallery({ view }: { view: GalleryView }): ReactNode {
  const { title, items } = view;
  return (
    <figure className="contentBlock contentGallery" aria-label={title === undefined || title === '' ? '横向列表' : title}>
      {title === undefined || title === '' ? null : <figcaption className="contentBlockTitle">{title}</figcaption>}
      {items.length === 0 ? (
        <p className="contentEmpty">没有可展示的条目。</p>
      ) : (
        <ul className="contentGalleryTrack" tabIndex={0}>
          {items.map(item => <GalleryCard key={item.id} item={item} />)}
        </ul>
      )}
    </figure>
  );
}
