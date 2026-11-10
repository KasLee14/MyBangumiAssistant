import { useState, type ReactNode } from 'react';
import type { GalleryView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readLink, readMaybeText, readNumber, readText, reading } from './payload';

/** 一张卡。等价性由 `_A` 把住。 */
export interface GalleryItemProps {
  /** 唯一 id，用作列表 key（例：1） */
  id: number;
  /** 名称（例：丰崎爱生） */
  name: string;
  /** 封面地址，http(s) 绝对地址（例：https://lain.bgm.tv/pic/crt/l/1f/6b/1_x.jpg） */
  image?: string;
  /** 副标题（例：平泽唯） */
  subtitle?: string;
  /** 卡片地址（例：https://bgm.tv/person/1） */
  url?: string;
}

/** 入参。 */
export interface GalleryProps {
  /** 区块标题（例：主要声优） */
  title?: string;
  /** 横向卡片（例：[{"id":1,"name":"丰崎爱生","subtitle":"平泽唯","image":"https://lain.bgm.tv/pic/crt/l/1f/6b/1_x.jpg","url":"https://bgm.tv/person/1"},{"id":2,"name":"日笠阳子","subtitle":"秋山澪","url":"https://bgm.tv/person/2"},{"id":3,"name":"佐藤聪美","subtitle":"田井中律"}]） */
  items: GalleryItemProps[];
}
export type _A = AssertTrue<Equal<GalleryItemProps, GalleryView['items'][number]>>;
export type _B = AssertTrue<Equal<GalleryProps, GalleryView>>;

/**
 * 一张卡：封面加载失败时回落成同尺寸占位块，卡片不会因为某张图挂掉而参差不齐。
 */
function GalleryCard({ item }: { item: GalleryItemProps }): ReactNode {
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
 * 横向列表（角色、关联条目、图集）。`overflow-x: auto` 且**不隐藏滚动条**：滚动条是
 * 键盘与触屏之外唯一能说明「右边还有内容」的信号；容器可聚焦，方向键能滚动这一排。
 */
export function Gallery({ view }: { view: GalleryProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="Gallery" data={view} />;
  if (!Array.isArray(view.items)) return <ContentRaw kind="Gallery" data={view} />;

  const r = reading('Gallery');
  const items: GalleryItemProps[] = [];
  view.items.forEach((item, index) => {
    if (!isRecord(item)) {
      r.miss(`items[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：缺 id（列表 key）或缺名字的卡片剔除；坏封面/坏链接只影响该卡自己。
    const id = readNumber(r, item.id, `items[${index}].id`);
    const name = readText(r, item.name, `items[${index}].name`);
    if (id === undefined || name === '') return;
    const image = readLink(r, item.image, `items[${index}].image`);
    const subtitle = readMaybeText(r, item.subtitle, `items[${index}].subtitle`);
    const url = readLink(r, item.url, `items[${index}].url`);
    items.push({
      id,
      name,
      ...(image === undefined ? {} : { image }),
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(url === undefined ? {} : { url }),
    });
  });

  const title = readMaybeText(r, view.title, 'title');
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
