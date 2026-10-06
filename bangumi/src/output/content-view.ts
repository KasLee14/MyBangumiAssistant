import type { AssistantContent } from '@earendil-works/pi-ai';
import type { MessageBlock } from '../web/protocol.js';
import { isComponentKind } from './content-types.js';

/** 原生内容投影到新版消息块；生成中和完成态使用同一 pending 语义。 */
export function contentView(part: AssistantContent): MessageBlock | undefined {
  if (part.type === 'text') return { ...part };
  if (!isComponentKind(part.type) || !('props' in part)) return undefined;
  return {
    type: part.type,
    pending: part.pending,
    props: part.props,
  } as MessageBlock;
}

export function hasStructuredContent(content: readonly AssistantContent[]): boolean {
  return content.some(part => isComponentKind(part.type) || part.type === 'text' && Object.hasOwn(part, 'nextType'));
}
