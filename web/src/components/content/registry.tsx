import type { ReactNode } from 'react';
import type { TranscriptItemView } from '../../../../bangumi/src/web/protocol';
import { Callout } from './Callout';
import { CompareTable } from './CompareTable';
import { DataTable } from './DataTable';
import { Gallery } from './Gallery';
import { InfoBox } from './InfoBox';
import { LinkList } from './LinkList';
import { ProgressView } from './ProgressView';
import { QuoteBlock } from './QuoteBlock';
import { StatsCard } from './StatsCard';
import { SubjectCards } from './SubjectCards';
import { TagCloud } from './TagCloud';
import { Timeline } from './Timeline';

/* ============================================================
 * 内容条目注册表
 * ------------------------------------------------------------
 * 把「kind → 渲染器」集中到一张表：新增一种内容展示只要在协议加成员、在这里
 * 加一项，分发逻辑不用改。
 *
 * 与原先 `switch` + `never` 的穷尽性检查等价：
 * 1. `satisfies { [K in ContentKind]: ContentRenderer<K> }` 要求 12 个键齐全，
 *    且每个 renderer 的参数类型就是它自己的协议成员——载荷字段名拼错会编译失败；
 * 2. 文件末尾的 `ContentRegistryCoverage` 断言协议里不存在未登记的内容 kind，
 *    避免「协议加了第 13 个 kind，但 ContentKind 忘了扩」这种盲区。
 * ============================================================ */

/** 12 个内容条目的 kind。 */
export type ContentKind =
  | 'subjects' | 'stats' | 'progress' | 'infobox' | 'table' | 'timeline'
  | 'tags' | 'gallery' | 'compare' | 'quote' | 'callout' | 'links';

/** 从协议里「挑」出内容成员；不复制类型定义，协议改动会自动传导。 */
export type ContentItemView = Extract<TranscriptItemView, { kind: ContentKind }>;

/** base 条目：本轮不做注册表化，仍由 `TurnView` 的分支渲染。 */
export type BaseTranscriptKind =
  | 'header' | 'user' | 'assistant' | 'notice' | 'error' | 'activity' | 'confirmation';

/** 某个 kind 的载荷字段名（去掉公共字段）。 */
export type ContentPayloadKey<K extends ContentKind> =
  Exclude<keyof Extract<ContentItemView, { kind: K }>, 'id' | 'version' | 'kind'>;

/** 载荷内数组字段的规模上限：超限截断并告警，不判定为非法。 */
export interface ArrayLimit {
  /** 载荷对象里的数组字段名，例如 `items`、`entries`、`rows`。 */
  readonly field: string;
  readonly max: number;
}

export interface ContentRenderer<K extends ContentKind> {
  /** 载荷字段名，供校验器与告警文案使用。 */
  readonly field: ContentPayloadKey<K>;
  /** 建议的数组规模上限；载荷里没有数组时为 undefined。 */
  readonly limit?: ArrayLimit;
  /** 渲染。传入的 item 已通过校验。 */
  readonly render: (item: Extract<ContentItemView, { kind: K }>) => ReactNode;
}

/** 12 个 kind 的登记顺序：与 component-library.html 的章节顺序一致。 */
export const CONTENT_KINDS = [
  'subjects', 'stats', 'progress', 'infobox', 'table', 'timeline',
  'tags', 'gallery', 'compare', 'quote', 'callout', 'links',
] as const satisfies readonly ContentKind[];

const KIND_SET: ReadonlySet<string> = new Set<string>(CONTENT_KINDS);

/** 判定一个未知字符串是否属于内容 kind。 */
export function isContentKind(value: unknown): value is ContentKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/**
 * 注册表本体。
 *
 * 规模上限的取值参考 Slack Block Kit 对 `blocks` 的硬上限与会话界面的实际容量：
 * 一次生成几百项既没有信息量，也会让流式帧的布局成本失控。
 */
export const CONTENT_RENDERERS = {
  subjects: {
    field: 'subjects',
    limit: { field: 'items', max: 50 },
    render: item => <SubjectCards view={item.subjects} />,
  },
  stats: {
    field: 'stats',
    limit: { field: 'entries', max: 100 },
    render: item => <StatsCard view={item.stats} />,
  },
  progress: {
    field: 'progress',
    limit: { field: 'episodes', max: 100 },
    render: item => <ProgressView view={item.progress} />,
  },
  infobox: {
    field: 'info',
    limit: { field: 'rows', max: 100 },
    render: item => <InfoBox view={item.info} />,
  },
  table: {
    field: 'table',
    limit: { field: 'rows', max: 200 },
    render: item => <DataTable view={item.table} />,
  },
  timeline: {
    field: 'timeline',
    limit: { field: 'entries', max: 100 },
    render: item => <Timeline view={item.timeline} />,
  },
  tags: {
    field: 'tags',
    limit: { field: 'tags', max: 50 },
    render: item => <TagCloud view={item.tags} />,
  },
  gallery: {
    field: 'gallery',
    limit: { field: 'items', max: 50 },
    render: item => <Gallery view={item.gallery} />,
  },
  compare: {
    field: 'compare',
    limit: { field: 'rows', max: 100 },
    render: item => <CompareTable view={item.compare} />,
  },
  quote: {
    field: 'quote',
    render: item => <QuoteBlock view={item.quote} />,
  },
  callout: {
    field: 'callout',
    render: item => <Callout view={item.callout} />,
  },
  links: {
    field: 'links',
    limit: { field: 'links', max: 50 },
    render: item => <LinkList view={item.links} />,
  },
} satisfies { [K in ContentKind]: ContentRenderer<K> };

/**
 * 判别式联合无法直接索引出「对应成员参数的函数」：TS 没有办法表达
 * 「按 `kind` 索引的函数表」，收窄只能在这里做一次。安全性由定义处的
 * `satisfies` 保证——每个 renderer 的参数类型精确到自己的协议成员。
 *
 * 注意取的是表项本身、再取它的 `render`：`CONTENT_RENDERERS[kind]` 是一个
 * `{ field, limit, render }` 对象，直接把它当函数调用会在运行时炸掉整棵 React
 * 树，而类型断言恰好不会报错——所以这一层必须显式写清楚。
 */
function rendererOf(kind: ContentKind): ContentRenderer<ContentKind> {
  return CONTENT_RENDERERS[kind] as ContentRenderer<ContentKind>;
}

/** 取某个 kind 的渲染函数；kind 未知时返回 undefined。 */
export function contentRenderer(kind: unknown): ((item: ContentItemView) => ReactNode) | undefined {
  return isContentKind(kind) ? rendererOf(kind).render : undefined;
}

/**
 * 分发入口。
 *
 * `kind` 不在注册表里时**丢弃**这条（返回 null），不做降级渲染：未知类型没有
 * 可依据的载荷语义，硬渲染一块占位比不渲染更容易误导。这条与 Adaptive Cards
 * 渲染器规范的「未知 type MUST BE DROPPED + SHOULD 告警」一致，告警由调用方
 * （`ContentItem`）负责，避免这里在渲染期产生副作用。
 */
export function renderContentItem(item: TranscriptItemView): ReactNode {
  const render = contentRenderer(item.kind);
  return render === undefined ? null : render(item as ContentItemView);
}

/** 协议新增内容 kind 而未同步 `ContentKind` 时，这一行会编译失败。 */
type AssertNever<T extends never> = T;
export type ContentRegistryCoverage = AssertNever<
  Exclude<TranscriptItemView['kind'], ContentKind | BaseTranscriptKind>
>;
