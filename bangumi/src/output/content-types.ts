import type {
  SubjectCollectionView, StatsView, ProgressView, InfoBoxView, TableView,
  TimelineView, TagCloudItemView, GalleryView, CompareView, QuoteView,
  CalloutView, LinkListView,
} from '../web/protocol.js';

/** 组件 props 复用现有展示库；tags 的数组额外包装为对象。 */
export interface ComponentPropsMap {
  subjects: SubjectCollectionView;
  stats: StatsView;
  progress: ProgressView;
  infobox: InfoBoxView;
  table: TableView;
  timeline: TimelineView;
  tags: { tags: TagCloudItemView[] };
  gallery: GalleryView;
  compare: CompareView;
  quote: QuoteView;
  callout: CalloutView;
  links: LinkListView;
}

export const COMPONENT_KINDS = [
  'subjects', 'stats', 'progress', 'infobox', 'table', 'timeline',
  'tags', 'gallery', 'compare', 'quote', 'callout', 'links',
] as const satisfies readonly (keyof ComponentPropsMap)[];
export type ComponentKind = keyof ComponentPropsMap;
export type ContentKind = 'text' | ComponentKind;
export interface TextPart { type: 'text'; nextType: ContentKind | null; text: string }

/** pending:true 表示生成中，pending:false 表示完整且校验通过。 */
export type ComponentState<K extends ComponentKind> =
  | { pending: true; props: Partial<ComponentPropsMap[K]> }
  | { pending: false; props: ComponentPropsMap[K] };
export type ComponentPartFor<K extends ComponentKind> = { type: K } & ComponentState<K>;
export type ComponentPart = { [K in ComponentKind]: ComponentPartFor<K> }[ComponentKind];
export type CompleteComponentPart = { [K in ComponentKind]: {
  type: K; pending: false; props: ComponentPropsMap[K];
} }[ComponentKind];
export type MixedPart = TextPart | ComponentPart;
export interface MixedContent { content: MixedPart[] }

const kinds: ReadonlySet<string> = new Set(COMPONENT_KINDS);
export function isComponentKind(value: unknown): value is ComponentKind {
  return typeof value === 'string' && kinds.has(value);
}
export function isContentKind(value: unknown): value is ContentKind {
  return value === 'text' || isComponentKind(value);
}

/** Pi 只提供扩展槽位，应用组件字段仍由本模块负责。 */
declare module '@earendil-works/pi-ai' {
  interface AssistantContentExtensions {
    subjects: ComponentState<'subjects'>;
    stats: ComponentState<'stats'>;
    progress: ComponentState<'progress'>;
    infobox: ComponentState<'infobox'>;
    table: ComponentState<'table'>;
    timeline: ComponentState<'timeline'>;
    tags: ComponentState<'tags'>;
    gallery: ComponentState<'gallery'>;
    compare: ComponentState<'compare'>;
    quote: ComponentState<'quote'>;
    callout: ComponentState<'callout'>;
    links: ComponentState<'links'>;
  }
}
