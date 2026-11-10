import type { ReactNode } from 'react';
import type { ContentKind } from '../../types/content';
import type { MessageBlock } from '../../types/protocol';
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
 * 全仓**唯一**的「type → 组件」表。它只做一件事：把 `type` 映射到组件。
 *
 * 载荷合不合法、坏了怎么显示，不在这里——每个组件自己收窄自己降级（见同目录各组件
 * 文件头的「入参」注释）。所以表项只有一个 `render`。
 *
 * 穷尽性：`satisfies { [K in ContentKind]: ContentRenderer<K> }` 要求每个 kind 都有组件，
 * 且每个 renderer 的入参精确到它自己的协议成员——组件的 props 因此能是强类型，
 * 不需要在调用点断言。
 *
 * 新增一种 kind：本表加一项 + 组件内写自己的 props（含 `AssertEqual` 断言）+
 * `sections.ts` 加一条数据。`kind` 清单本身不手写（见 `CONTENT_KINDS`）。
 * ============================================================ */

/** 协议里的块类型与内容块类型从这里转出，调用点不必再深入 `protocol.ts`。 */
export type { ContentBlockView, MessageBlock } from '../../types/protocol';

/**
 * 某个 kind 对应的协议块成员。
 *
 * 用 `Extract` 从协议里「挑」，不复制类型定义——协议改动会自动传导到 `render` 签名上。
 */
export type ContentBlockOf<K extends ContentKind> = Extract<MessageBlock, { type: K }>;

/** base 条目：不做注册表化，仍由 `Turn` 的分支渲染。 */
export type BaseTranscriptKind =
  | 'header' | 'user' | 'assistant' | 'notice' | 'error'
  | 'reasoning' | 'tool' | 'turn' | 'confirmation';

/**
 * base 条目的 kind 清单（`Turn` 靠它判断「既不是 base 条目、也不是内容块」）。只此一份。
 * `reasoning` / `tool` / `turn` 是过程区与轮次边界，**不是内容块**。
 */
export const BASE_KINDS = [
  'header', 'user', 'assistant', 'notice', 'error', 'reasoning', 'tool', 'turn', 'confirmation',
] as const satisfies readonly BaseTranscriptKind[];

const BASE_KIND_SET: ReadonlySet<string> = new Set<string>(BASE_KINDS);

export function isBaseTranscriptKind(value: unknown): value is BaseTranscriptKind {
  return typeof value === 'string' && BASE_KIND_SET.has(value);
}

/** 一个 kind 的渲染入口；入参精确到该 kind 的协议块成员。 */
export interface ContentRenderer<K extends ContentKind> {
  /** 渲染。传入的块已由分发器判过信封（`pending` 与非内容块不会走到这里）。 */
  readonly render: (block: ContentBlockOf<K>) => ReactNode;
}

/**
 * 注册表本体。
 *
 * ⚠️ 新增 kind **追加到表尾**：`CONTENT_KINDS` 由本表的键序派生，顺序即文档页章节顺序。
 */
export const CONTENT_RENDERERS = {
  SubjectCards: { render: block => <SubjectCards view={block.props} /> },
  StatsCard: { render: block => <StatsCard view={block.props} /> },
  ProgressView: { render: block => <ProgressView view={block.props} /> },
  InfoBox: { render: block => <InfoBox view={block.props} /> },
  DataTable: { render: block => <DataTable view={block.props} /> },
  Timeline: { render: block => <Timeline view={block.props} /> },
  TagCloud: { render: block => <TagCloud view={block.props} /> },
  Gallery: { render: block => <Gallery view={block.props} /> },
  CompareTable: { render: block => <CompareTable view={block.props} /> },
  QuoteBlock: { render: block => <QuoteBlock view={block.props} /> },
  Callout: { render: block => <Callout view={block.props} /> },
  LinkList: { render: block => <LinkList view={block.props} /> },
} satisfies { [K in ContentKind]: ContentRenderer<K> };

/** kind 清单：从渲染表派生（顺序 = 文档页章节顺序 = 宿主 `COMPONENT_KINDS` 顺序）。 */
export const CONTENT_KINDS: readonly ContentKind[] = Object.keys(CONTENT_RENDERERS) as ContentKind[];

const KIND_SET: ReadonlySet<string> = new Set<string>(CONTENT_KINDS);

/** 判定一个未知字符串是否属于内容 kind。 */
export function isContentKind(value: unknown): value is ContentKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/**
 * 判别式联合无法直接索引出「按 `type` 取函数」的表：TS 不能表达这种索引，收窄只能做
 * 一次。安全性由定义处的 `satisfies` 保证——每个 renderer 的入参精确到自己的协议成员。
 */
function rendererOf(type: ContentKind): ContentRenderer<ContentKind> {
  return CONTENT_RENDERERS[type] as ContentRenderer<ContentKind>;
}

/** 取某个 type 的渲染函数；type 未知时返回 undefined。 */
export function contentRenderer(type: unknown): ((block: ContentBlockOf<ContentKind>) => ReactNode) | undefined {
  return isContentKind(type) ? rendererOf(type).render : undefined;
}
