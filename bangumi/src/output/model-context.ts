import type { TranscriptContext } from '@earendil-works/pi-ai';
import { isComponentKind } from './content-types.js';
import type { ResourceContentResolver } from './resource-content.js';
import { validateMixedPart } from './content-schema.js';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
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
  return { ...context, messages: context.messages.map(message => {
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
    return { ...visible, content: message.content.map(part => {
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
    }) };
  }) };
}
