import type { TranscriptContext } from '@earendil-works/pi-ai';
import { isComponentKind } from './content-types.js';
import type { ResourceContentResolver } from './resource-content.js';
import { validateMixedPart, validateMixedContent } from './content-schema.js';
import { PRESENTATION_MESSAGE_MARKER, type PresentationSnapshot } from './reply-assembler.js';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const presentationHistories = new WeakMap<object, PresentationSnapshot[]>();
/** 只提供宿主终态记录；真正注入范围仍以本次实际可见的source消息为准。 */
export function bindPresentationHistory(context: { messages: object }, snapshots: readonly unknown[]): void {
  const latest = new Map<string, PresentationSnapshot>();
  for (const snapshot of snapshots) {
    if (!record(snapshot) || snapshot.version !== 1 || typeof snapshot.replyId !== 'string' || !['completed', 'error', 'aborted'].includes(String(snapshot.status))) continue;
    try { validateMixedContent({ content: snapshot.content }); }
    catch { continue; }
    latest.set(snapshot.replyId, snapshot as unknown as PresentationSnapshot);
  }
  presentationHistories.set(context, [...latest.values()]); presentationHistories.set(context.messages, [...latest.values()]);
}
const identity = new Set(['id', 'entity', 'subjectId', 'episodeId', 'revisionId', 'targetKind', 'targetId', 'relationId', 'username', 'ownerId', 'name', 'nameCn', 'displayName', 'title', 'label']);
function names(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(names);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => identity.has(key)).map(([key, item]) => [key, names(item)]));
}
/** 展示快照保留在会话文件；模型仅看到成员身份及模型创作的说明。 */
export function projectContentForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectContentForModel);
  if (!record(value)) return value;
  if (isComponentKind(value.type)) {
    const props = value.props;
    if (value.type === 'Callout' || value.type === 'QuoteBlock') return value;
    if (Array.isArray(props)) return { type: value.type, props: names(props) };
    if (!record(props)) return { type: value.type };
    const result: Row = {};
    for (const key of ['title', 'layout', 'hint', 'note']) if (props[key] !== undefined) result[key] = props[key];
    if (Array.isArray(props.items)) result.items = names(props.items);
    if (Array.isArray(props.links)) result.links = names(props.links);
    if (Array.isArray(props.episodes)) result.episodes = names(props.episodes);
    if (Array.isArray(props.rows) && value.type === 'DataTable') result.rows = names(props.rows);
    return { type: value.type, props: result };
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['resourceRef', 'images', 'image', 'summary', 'url'].includes(key)).map(([key, item]) => [key, projectContentForModel(item)]));
}
function pruneExpiredReferences(value: unknown, resolver?: ResourceContentResolver): unknown {
  if (Array.isArray(value)) return value.map(item => pruneExpiredReferences(item, resolver));
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !['resourceRef', 'resource_ref'].includes(key) || typeof item === 'string' && resolver?.isCurrent?.(item) === true).map(([key, item]) => [key, pruneExpiredReferences(item, resolver)]));
}
export function projectTranscriptForModel(context: TranscriptContext, resolver?: ResourceContentResolver): TranscriptContext {
  const history = presentationHistories.get(context) ?? presentationHistories.get(context.messages) ?? [];
  const snapshots = new Map(history.map(snapshot => [snapshot.replyId, snapshot]));
  const lastSources = new Map<string, number>();
  for (const [index, message] of context.messages.entries()) {
    if (message.role !== 'assistant') continue;
    const replyId = message.diagnostics?.findLast(value => value.type === PRESENTATION_MESSAGE_MARKER)?.details?.replyId;
    if (typeof replyId === 'string' && snapshots.has(replyId)) lastSources.set(replyId, index);
  }
  return { ...context, messages: context.messages.map((message, index) => {
    if (message.role === 'toolResult') {
      const visible = { ...message } as typeof message & { structuredContent?: unknown };
      delete visible.details; delete visible.structuredContent;
      return { ...visible, content: message.content.map(part => {
      if (part.type !== 'text') return part;
      // 本地组件契约中的 resourceRef 是Schema字段名，不能当过期事实引用剔除。
      if (message.toolName === 'read_component_index' || message.toolName === 'read_component_spec') return part;
      try { return { ...part, text: JSON.stringify(pruneExpiredReferences(JSON.parse(part.text), resolver)) }; } catch { return part; }
      }) };
    }
    if (message.role !== 'assistant') return message;
    const { diagnostics: _diagnostics, ...visible } = message;
    const content = message.content.map(part => {
      if (isComponentKind(part.type)) return { type: 'text' as const, text: `历史展示摘要：${JSON.stringify(projectContentForModel(part))}` };
      if (part.type === 'toolCall') return { ...part, arguments: pruneExpiredReferences(part.arguments, resolver) as typeof part.arguments };
      if (part.type === 'text' && part.text.trimStart().startsWith('{')) {
        // Pi.convertToLlm 已将应用组件变成 JSON 文字；仍须在 provider 边界投影。
        try {
          const value: unknown = JSON.parse(part.text);
          if (record(value) && isComponentKind(value.type) && value.pending === false) {
            validateMixedPart(value);
            return { ...part, text: `历史展示摘要：${JSON.stringify(projectContentForModel(value))}` };
          }
        } catch { /* 普通助手文字保持原样，不猜测JSON包装。 */ }
      }
      return part;
    });
    const replyId = message.diagnostics?.findLast(value => value.type === PRESENTATION_MESSAGE_MARKER)?.details?.replyId;
    const snapshot = typeof replyId === 'string' && lastSources.get(replyId) === index ? snapshots.get(replyId) : undefined;
    if (snapshot?.content.length) content.push({ type: 'text', text: `历史已展示回答摘要（按真实阅读顺序）：${JSON.stringify(projectContentForModel(snapshot.content))}` });
    return { ...visible, content };
  }) };
}
