import { useState, type ReactNode } from 'react';
import type { SubjectCardView, SubjectCollectionView, SubjectKind } from '../../../../bangumi/src/web/protocol';
/* SpotlightCard 已移除：用户在 style-demo-interaction.html 里选的是「A · 只精修状态反馈」，
   明确排除了指针跟随类效果。详见 GridCard 的注释。 */

/** 类型角标的文案与简写；未知值只显示角标色块，不猜测媒体类型。 */
const KIND_LABEL: Record<SubjectKind, string> = {
  book: '书籍',
  anime: '动画',
  music: '音乐',
  game: '游戏',
  real: '三次元',
};
const KIND_SHORT: Record<SubjectKind, string> = {
  book: '书',
  anime: '动',
  music: '音',
  game: '游',
  real: '三',
};

/** 评分统一保留一位小数。缺评分时不显示占位符，避免把「无数据」读成 0 分。 */
function scoreText(score: number | undefined): string | null {
  return typeof score === 'number' ? score.toFixed(1) : null;
}

/**
 * 外壳：有 `url` 时用 `<a>`（可点、可键盘聚焦、新窗口打开），没有时退回 `<div>`。
 * 不给无地址的条目留一个空 `<a>`，否则键盘用户会 Tab 到一个什么也不做的链接。
 */
function Shell({ url, className, children }: { url: string | undefined; className: string; children: ReactNode }): ReactNode {
  if (url === undefined || url === '') return <div className={className}>{children}</div>;
  return <a className={className} href={url} target="_blank" rel="noreferrer">{children}</a>;
}

/**
 * 封面块。
 *
 * 宿主给的图片地址可能失效（Bangumi 图片有防盗链与过期路径），所以用本地状态
 * 记录加载失败并回落到占位块：占位块保留相同的宽高，卡片不会因为图片挂掉而跳版。
 */
function Cover({ image, name, className }: { image: string | undefined; name: string; className: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  const broken = image === undefined || image === '' || failed;
  return (
    <div className={className} data-empty={broken}>
      {broken ? null : <img src={image} alt={`${name} 的封面`} loading="lazy" onError={() => setFailed(true)} />}
    </div>
  );
}

/** 网格布局的一张卡：封面墙 + 下方文字。 */
function GridCard({ item }: { item: SubjectCardView }): ReactNode {
  const score = scoreText(item.score);
  return (
    <li className="contentSubjectGridItem">
      {/* 这里原有 ReactBits 的 SpotlightCard（指针跟随光斑）。已移除：
          用户在 `style-demo-interaction.html` 里选的是「A · 只精修状态反馈」，
          明确排除了指针光斑、磁吸与行光带这三类「指针跟随」效果——
          卡片的指针反馈只保留 hover 抬升与阴影加深。 */}
      <Shell url={item.url} className="contentSubjectCard">
        <Cover className="contentSubjectCover" image={item.image} name={item.name} />
        {/* 文字区是**一层独立的内距容器**（[C05](../../docs/design/decisions/C05-subject-cards.md)
            定稿：内距 `9px 10px 11px`）。卡片自己不能带内距，否则封面会被一起推进去、
            四周露出卡片底色；名称的上边距也归零——间距由这层的内距表达，不再各写一份。 */}
        <div className="contentSubjectBody">
          <p className="contentSubjectName">{item.name}</p>
          {/* 中文名：样张的网格卡有这一行（`11.5px / text-muted`，见 content.html 的 `.cn`）。
              与原名相同、或宿主没给时都不渲染——免得同一串字出现两遍。 */}
          {item.nameCn === undefined || item.nameCn === '' || item.nameCn === item.name ? null : (
            <p className="contentSubjectNameCn">{item.nameCn}</p>
          )}
          <p className="contentSubjectFacts">
            <span className="contentKindBadge" title={KIND_LABEL[item.kind]}>{KIND_SHORT[item.kind]}</span>
            {KIND_LABEL[item.kind]}
            {score === null ? null : <span className="contentSubjectScore">{score}</span>}
          </p>
        </div>
      </Shell>
    </li>
  );
}

/** 列表布局的一行：左侧标题与元信息，右侧评分。 */
function ListRow({ item }: { item: SubjectCardView }): ReactNode {
  const score = scoreText(item.score);
  const meta: string[] = [KIND_LABEL[item.kind]];
  if (item.date !== undefined && item.date !== '') meta.push(item.date);
  if (item.scoreCount !== undefined) meta.push(`${item.scoreCount} 人评分`);
  return (
    <li className="contentSubjectRow">
      <Shell url={item.url} className="contentSubjectRowLink">
        <span className="contentSubjectRowTitle">
          {item.name}
          {item.nameCn === undefined || item.nameCn === '' || item.nameCn === item.name ? null : (
            <span className="contentSubjectRowCn">{item.nameCn}</span>
          )}
        </span>
        <span className="contentSubjectRowMeta">{meta.join(' · ')}</span>
        {score === null ? null : <span className="contentSubjectRowScore">{score}</span>}
      </Shell>
    </li>
  );
}

/**
 * 条目集合。
 *
 * 一个组件承担两种密度：`layout: 'grid'` 是封面墙（浏览、候选），`list` 是紧凑
 * 行（收藏核对、结果列表）。两者都保留同一份元信息，只是排列方式不同。
 */
export function SubjectCards({ view }: { view: SubjectCollectionView }): ReactNode {
  const { title, items, layout, total, hint } = view;
  const remaining = total === undefined ? 0 : total - items.length;
  return (
    <section className="contentBlock contentSubjects" aria-label={title === undefined || title === '' ? '条目集合' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {items.length === 0 ? (
        <p className="contentEmpty">没有可展示的条目。</p>
      ) : layout === 'grid' ? (
        <ul className="contentSubjectGrid">
          {items.map(item => <GridCard key={item.id} item={item} />)}
        </ul>
      ) : (
        <ul className="contentSubjectList">
          {items.map(item => <ListRow key={item.id} item={item} />)}
        </ul>
      )}
      {/* 总数多于本帧条目时显式提示，避免把「本帧 20 条」误读为「总共 20 条」。 */}
      {remaining > 0 ? (
        <p className="contentMore" role="note">本帧展示 {items.length} 条，共 {total} 条，还有 {remaining} 条未展示。</p>
      ) : null}
      {hint === undefined || hint === '' ? null : <p className="contentHint">{hint}</p>}
    </section>
  );
}
