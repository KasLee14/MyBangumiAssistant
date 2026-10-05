import type { ReactNode } from 'react';
import type { MessageBlock } from '../../../../bangumi/src/web/protocol';
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
 * 内容块注册表
 * ------------------------------------------------------------
 * 把「type → 渲染器」集中到一张表：新增一种定制组件只要在协议加成员、在这里加一项，
 * 分发逻辑不用改。
 *
 * 与 `switch` + `never` 的穷尽性检查等价：
 * 1. `satisfies { [K in ContentKind]: ContentRenderer<K> }` 要求 12 个键齐全，且每个
 *    renderer 的参数类型就是它自己的协议成员；
 * 2. 文件末尾的 `ContentRegistryCoverage` 断言协议里不存在未登记的块 type，避免
 *    「协议加了第 13 个 type，但 ContentKind 忘了扩」这种盲区。
 *
 * **表里没有「载荷字段名」这一项**：定制组件的块形状统一为 `{ type, pending?, props }`，
 * 载荷恒在 `props` 上。所以这张表只有两个字段：可选的数组规模上限、渲染函数。
 * ============================================================ */

/** 协议里的块类型与内容块类型从这里转出，调用点不必再深入 `protocol.ts`。 */
export type { ContentBlockView, MessageBlock } from '../../../../bangumi/src/web/protocol';

/**
 * 12 个定制组件的 `type`。
 *
 * 取值就是**组件名**（与 `components/content/` 的文件名一致），因此不再需要「语义名 →
 * 组件」的对照表：`type` 直接说明该用哪个组件渲染。
 */
export type ContentKind =
  | 'SubjectCards' | 'StatsCard' | 'ProgressView' | 'InfoBox' | 'DataTable' | 'Timeline'
  | 'TagCloud' | 'Gallery' | 'CompareTable' | 'QuoteBlock' | 'Callout' | 'LinkList';

/**
 * 某个 kind 对应的协议块成员。
 *
 * 用 `Extract` 从协议里「挑」，不复制类型定义——协议改动会自动传导到这里的
 * `render` 签名上。`K` 是 `ContentKind`，因此天然排除文本块。
 */
export type ContentBlockOf<K extends ContentKind> = Extract<MessageBlock, { type: K }>;

/** base 条目：不做注册表化，仍由 `Turn` 的分支渲染（助手的正文是块数组，也属于这一类）。 */
export type BaseTranscriptKind =
  | 'header' | 'user' | 'assistant' | 'notice' | 'error' | 'activity' | 'confirmation';

/**
 * base 条目的 kind 清单。
 *
 * 定义在这里而不是 `validate.ts`：两处都要用它——接收侧校验靠它放行 base 条目，`Turn`
 * 靠它判断「既不是 base 条目、也不是内容块」（那是未知形态的开发期告警点）。
 * 清单只此一份。
 */
export const BASE_KINDS = [
  'header', 'user', 'assistant', 'notice', 'error', 'activity', 'confirmation',
] as const satisfies readonly BaseTranscriptKind[];

const BASE_KIND_SET: ReadonlySet<string> = new Set<string>(BASE_KINDS);

/** 判定一个未知字符串是否属于 base 条目 kind。 */
export function isBaseTranscriptKind(value: unknown): value is BaseTranscriptKind {
  return typeof value === 'string' && BASE_KIND_SET.has(value);
}

/**
 * 载荷内数组字段的规模上限：超限截断并告警，不判定为非法。
 *
 * `field` 是**载荷内部**的字段名（例如 `props.items` 的 `items`），与块上的字段无关——
 * 块上的载荷字段恒为 `props`。
 */
export interface ArrayLimit {
  /** 载荷对象里的数组字段名，例如 `items`、`entries`、`rows`。 */
  readonly field: string;
  readonly max: number;
}

export interface ContentRenderer<K extends ContentKind> {
  /** 建议的数组规模上限；载荷里没有数组时为 undefined。 */
  readonly limit?: ArrayLimit;
  /** 渲染。传入的块已通过校验（`pending` 期根本不会走到这里）。 */
  readonly render: (block: ContentBlockOf<K>) => ReactNode;
}

/** 12 个 kind 的登记顺序：与 component-library.html 的章节顺序一致。 */
export const CONTENT_KINDS = [
  'SubjectCards', 'StatsCard', 'ProgressView', 'InfoBox', 'DataTable', 'Timeline',
  'TagCloud', 'Gallery', 'CompareTable', 'QuoteBlock', 'Callout', 'LinkList',
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
  SubjectCards: {
    limit: { field: 'items', max: 50 },
    render: block => <SubjectCards view={block.props} />,
  },
  StatsCard: {
    limit: { field: 'entries', max: 100 },
    render: block => <StatsCard view={block.props} />,
  },
  ProgressView: {
    limit: { field: 'episodes', max: 100 },
    render: block => <ProgressView view={block.props} />,
  },
  InfoBox: {
    limit: { field: 'rows', max: 100 },
    render: block => <InfoBox view={block.props} />,
  },
  DataTable: {
    limit: { field: 'rows', max: 200 },
    render: block => <DataTable view={block.props} />,
  },
  Timeline: {
    limit: { field: 'entries', max: 100 },
    render: block => <Timeline view={block.props} />,
  },
  TagCloud: {
    // 这个 kind 的 `props` 就是数组本身（协议里 `tags` 成员是 `TagCloudItemView[]`），
    // 没有「载荷内的数组字段」可取，因此不声明 limit。
    render: block => <TagCloud view={block.props} />,
  },
  Gallery: {
    limit: { field: 'items', max: 50 },
    render: block => <Gallery view={block.props} />,
  },
  CompareTable: {
    limit: { field: 'rows', max: 100 },
    render: block => <CompareTable view={block.props} />,
  },
  QuoteBlock: {
    render: block => <QuoteBlock view={block.props} />,
  },
  Callout: {
    render: block => <Callout view={block.props} />,
  },
  LinkList: {
    limit: { field: 'links', max: 50 },
    render: block => <LinkList view={block.props} />,
  },
} satisfies { [K in ContentKind]: ContentRenderer<K> };

/**
 * 判别式联合无法直接索引出「对应成员参数的函数」：TS 没有办法表达
 * 「按 `type` 索引的函数表」，收窄只能在这里做一次。安全性由定义处的
 * `satisfies` 保证——每个 renderer 的参数类型精确到自己的协议成员。
 *
 * 注意取的是表项本身、再取它的 `render`：`CONTENT_RENDERERS[type]` 是一个
 * `{ limit, render }` 对象，直接把它当函数调用会在运行时炸掉整棵 React 树，
 * 而类型断言恰好不会报错——所以这一层必须显式写清楚。
 */
function rendererOf(type: ContentKind): ContentRenderer<ContentKind> {
  return CONTENT_RENDERERS[type] as ContentRenderer<ContentKind>;
}

/** 取某个 type 的渲染函数；type 未知时返回 undefined。 */
export function contentRenderer(type: unknown): ((block: ContentBlockOf<ContentKind>) => ReactNode) | undefined {
  return isContentKind(type) ? rendererOf(type).render : undefined;
}

/** 协议新增内容 type 而未同步 `ContentKind` 时，这一行会编译失败。 */
type AssertNever<T extends never> = T;
export type ContentRegistryCoverage = AssertNever<
  Exclude<MessageBlock['type'], ContentKind | 'text'>
>;
