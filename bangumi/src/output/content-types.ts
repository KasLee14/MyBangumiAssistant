import type { ContentBlockView } from '../web/protocol.js';

/** 名称与载荷直接取自 Web 协议，模型输出不另建组件别名。 */
export type ComponentPropsMap = {
  [K in ContentBlockView['type']]: Extract<ContentBlockView, { type: K }>['props'];
};

export const COMPONENT_KINDS = [
  'SubjectCards', 'StatsCard', 'ProgressView', 'InfoBox', 'DataTable', 'Timeline',
  'TagCloud', 'Gallery', 'CompareTable', 'QuoteBlock', 'Callout', 'LinkList',
] as const satisfies readonly (keyof ComponentPropsMap)[];
export type ComponentKind = keyof ComponentPropsMap;
type AssertNever<T extends never> = T;
/** 协议新增组件而运行时目录未登记时必须编译失败。 */
export type ComponentKindCoverage = AssertNever<Exclude<ComponentKind, typeof COMPONENT_KINDS[number]>>;
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
    SubjectCards: ComponentState<'SubjectCards'>;
    StatsCard: ComponentState<'StatsCard'>;
    ProgressView: ComponentState<'ProgressView'>;
    InfoBox: ComponentState<'InfoBox'>;
    DataTable: ComponentState<'DataTable'>;
    Timeline: ComponentState<'Timeline'>;
    TagCloud: ComponentState<'TagCloud'>;
    Gallery: ComponentState<'Gallery'>;
    CompareTable: ComponentState<'CompareTable'>;
    QuoteBlock: ComponentState<'QuoteBlock'>;
    Callout: ComponentState<'Callout'>;
    LinkList: ComponentState<'LinkList'>;
  }
}
