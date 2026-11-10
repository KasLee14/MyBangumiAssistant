import { useState, type ReactNode } from 'react';
import type { SubjectCardView, SubjectCollectionView, SubjectKind } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readLink, readMaybeText, readNumber, readText, readTextList, reading } from './payload';

/** 一张条目卡。等价性由 `_A` 把住。 */
export interface SubjectCardProps {
  /** 条目 ID，用作列表 key（例：1424） */
  id: number;
  /** 原名（例：けいおん!） */
  name: string;
  /** 中文名；缺失或与原名相同时不重复显示（例：轻音少女） */
  nameCn?: string;
  /** 媒体类型，决定角标（例：anime） */
  kind: SubjectKind;
  /** 封面地址（例：https://lain.bgm.tv/pic/cover/l/48/9d/1424_q8FMQ.jpg） */
  image?: string;
  /** 全站评分，保留一位小数（例：8.2） */
  score?: number;
  /** 评分人数（例：12480） */
  scoreCount?: number;
  /** 站内排名（例：128） */
  rank?: number;
  /** 放送/发售日期，宿主已格式化（例：2009-04-03） */
  date?: string;
  /** 简介（例：樱丘高中轻音部的日常。） */
  summary?: string;
  /** 标签名（例：["音乐","日常"]） */
  tags?: string[];
  /** 条目页地址（例：https://bgm.tv/subject/1424） */
  url?: string;
}

/** 入参。 */
export interface SubjectCardsProps {
  /** 区块标题（例：搜索结果） */
  title?: string;
  /** 条目卡（例：[{"id":1424,"name":"けいおん!","nameCn":"轻音少女","kind":"anime","score":8.2,"image":"https://lain.bgm.tv/pic/cover/l/48/9d/1424_q8FMQ.jpg","url":"https://bgm.tv/subject/1424"},{"id":876,"name":"CLANNAD","nameCn":"团子大家族","kind":"anime","score":8.7,"image":"https://lain.bgm.tv/pic/cover/l/67/d1/876_dCfrd.jpg","url":"https://bgm.tv/subject/876"},{"id":2747,"name":"涼宮ハルヒの憂鬱","nameCn":"凉宫春日的忧郁","kind":"anime","score":8,"url":"https://bgm.tv/subject/2747"}]） */
  items: SubjectCardProps[];
  /** `grid` 封面墙、`list` 紧凑行（例：grid） */
  layout: 'grid' | 'list';
  /** 结果总数；大于 items.length 时提示还有多少条（例：24） */
  total?: number;
  /** 排序口径一类的补充说明（例：按匹配度排序） */
  hint?: string;
}
export type _A = AssertTrue<Equal<SubjectCardProps, SubjectCardView>>;
export type _B = AssertTrue<Equal<SubjectCardsProps, SubjectCollectionView>>;

const KIND_LABEL: Record<SubjectKind, string> = { book: '书籍', anime: '动画', music: '音乐', game: '游戏', real: '三次元' };
const KIND_SHORT: Record<SubjectKind, string> = { book: '书', anime: '动', music: '音', game: '游', real: '三' };
const KINDS = ['book', 'anime', 'music', 'game', 'real'] as const;
const LAYOUTS = ['grid', 'list'] as const;

/**
 * 角标文案：类型不认识的卡片仍然显示（封面与标题才是内容），只是不写角标。
 *
 * 用 `Object.hasOwn` 而不是直接索引——`KIND_LABEL` 是已知键的映射，编译器不会给
 * `| undefined`，但线上可能送来 `kind: "movie"`。
 */
function badgeOf(kind: string): { label: string; short: string } | undefined {
  return Object.hasOwn(KIND_LABEL, kind) ? { label: KIND_LABEL[kind as SubjectKind], short: KIND_SHORT[kind as SubjectKind] } : undefined;
}

/** 评分统一保留一位小数；缺评分不显示占位符，避免把「无数据」读成 0 分。 */
function scoreText(score: number | undefined): string | null {
  return typeof score === 'number' ? score.toFixed(1) : null;
}

/** 有 `url` 时用 `<a>`，没有时退回 `<div>`：不给无地址条目留一个空链接。 */
function Shell({ url, className, children }: { url: string | undefined; className: string; children: ReactNode }): ReactNode {
  if (url === undefined || url === '') return <div className={className}>{children}</div>;
  return <a className={className} href={url} target="_blank" rel="noreferrer">{children}</a>;
}

/** 封面：加载失败回落同尺寸占位块。 */
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
function GridCard({ item }: { item: SubjectCardProps }): ReactNode {
  const score = scoreText(item.score);
  const badge = badgeOf(item.kind);
  return (
    <li className="contentSubjectGridItem">
      <Shell url={item.url} className="contentSubjectCard">
        <Cover className="contentSubjectCover" image={item.image} name={item.name} />
        <div className="contentSubjectBody">
          <p className="contentSubjectName">{item.name}</p>
          {item.nameCn === undefined || item.nameCn === '' || item.nameCn === item.name ? null : (
            <p className="contentSubjectNameCn">{item.nameCn}</p>
          )}
          <p className="contentSubjectFacts">
            {badge === undefined ? null : (
              <>
                <span className="contentKindBadge" title={badge.label}>{badge.short}</span>
                {badge.label}
              </>
            )}
            {score === null ? null : <span className="contentSubjectScore">{score}</span>}
          </p>
        </div>
      </Shell>
    </li>
  );
}

/** 列表布局的一行：左侧标题与元信息，右侧评分。 */
function ListRow({ item }: { item: SubjectCardProps }): ReactNode {
  const score = scoreText(item.score);
  const badge = badgeOf(item.kind);
  const meta: string[] = [];
  if (badge !== undefined) meta.push(badge.label);
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
        {meta.length === 0 ? null : <span className="contentSubjectRowMeta">{meta.join(' · ')}</span>}
        {score === null ? null : <span className="contentSubjectRowScore">{score}</span>}
      </Shell>
    </li>
  );
}

/**
 * 条目集合。一个组件承担两种密度：`grid` 封面墙、`list` 紧凑行，元信息相同。
 */
export function SubjectCards({ view }: { view: SubjectCardsProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="SubjectCards" data={view} />;
  if (!Array.isArray(view.items)) return <ContentRaw kind="SubjectCards" data={view} />;

  const r = reading('SubjectCards');
  const items: SubjectCardProps[] = [];
  view.items.forEach((item, index) => {
    if (!isRecord(item)) {
      r.miss(`items[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：缺 id（列表 key）或缺名字的卡片剔除；其余字段取不到就不显示。
    const id = readNumber(r, item.id, `items[${index}].id`);
    const name = readText(r, item.name, `items[${index}].name`);
    if (id === undefined || name === '') return;

    const nameCn = readMaybeText(r, item.nameCn, `items[${index}].nameCn`);
    const image = readLink(r, item.image, `items[${index}].image`);
    const score = readNumber(r, item.score, `items[${index}].score`);
    const scoreCount = readNumber(r, item.scoreCount, `items[${index}].scoreCount`);
    const rank = readNumber(r, item.rank, `items[${index}].rank`);
    const date = readMaybeText(r, item.date, `items[${index}].date`);
    const summary = readMaybeText(r, item.summary, `items[${index}].summary`);
    const tags = readTextList(r, item.tags, `items[${index}].tags`);
    const url = readLink(r, item.url, `items[${index}].url`);
    items.push({
      id,
      name,
      kind: readChoice(r, item.kind, `items[${index}].kind`, KINDS, 'anime'),
      ...(nameCn === undefined ? {} : { nameCn }),
      ...(image === undefined ? {} : { image }),
      ...(score === undefined ? {} : { score }),
      ...(scoreCount === undefined ? {} : { scoreCount }),
      ...(rank === undefined ? {} : { rank }),
      ...(date === undefined ? {} : { date }),
      ...(summary === undefined ? {} : { summary }),
      ...(tags === undefined ? {} : { tags }),
      ...(url === undefined ? {} : { url }),
    });
  });

  const layout = readChoice(r, view.layout, 'layout', LAYOUTS, 'grid');
  const total = readNumber(r, view.total, 'total');
  const hint = readMaybeText(r, view.hint, 'hint');
  const title = readMaybeText(r, view.title, 'title');
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
      {remaining > 0 ? (
        <p className="contentMore" role="note">本帧展示 {items.length} 条，共 {total} 条，还有 {remaining} 条未展示。</p>
      ) : null}
      {hint === undefined || hint === '' ? null : <p className="contentHint">{hint}</p>}
    </section>
  );
}
