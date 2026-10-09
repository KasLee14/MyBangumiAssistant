import { isDeepStrictEqual } from 'node:util';
import type { TranscriptContext } from '@earendil-works/pi-ai';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * 仅修复已持久化恢复消息的宿主前缀顺序。原生签名须与现有wire reasoning完全匹配，
 * 不生成思考、不补summary、不改签名，也不跨普通assistant消息移动思考。
 */
export function orderDeepSeekRecoveryReasoning(payload: Record<string, unknown>, context: TranscriptContext): Record<string, unknown> {
  if (!Array.isArray(payload.input)) return payload;
  const input = [...payload.input];
  let changed = false;
  for (const message of context.messages) {
    if (message.role !== 'assistant' || message.provider !== 'deepseek' || message.api !== 'openai-responses') continue;
    const recovery = message.diagnostics?.findLast(item => item.type === 'application_recovery')?.details;
    const count = recovery?.retainedParts;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) continue;
    const firstThinking = message.content.findIndex(part => part.type === 'thinking');
    if (firstThinking !== count || message.content.slice(0, count).some(part => part.type !== 'text')) continue;
    const signatures: Record<string, unknown>[] = [];
    for (const part of message.content.slice(firstThinking)) {
      if (part.type !== 'thinking') break;
      if (!part.thinkingSignature) { signatures.length = 0; break; }
      let signature: unknown;
      try { signature = JSON.parse(part.thinkingSignature); } catch { signatures.length = 0; break; }
      if (!record(signature) || signature.type !== 'reasoning' || typeof signature.id !== 'string') { signatures.length = 0; break; }
      signatures.push(signature);
    }
    if (!signatures.length) continue;
    const thinkingIndex = input.findIndex(item => record(item) && isDeepStrictEqual(item, signatures[0]));
    const prefixIndex = thinkingIndex - count;
    if (prefixIndex < 0 || !signatures.every((signature, index) => isDeepStrictEqual(input[thinkingIndex + index], signature))) continue;
    const prefix = input.slice(prefixIndex, thinkingIndex);
    if (prefix.some(item => !record(item) || item.role !== 'assistant' || item.type !== 'message' || !Array.isArray(item.content)
      || item.content.some(part => !record(part) || part.type !== 'output_text'))) continue;
    // 前缀与thinking来自同一带宿主恢复标记的原生消息，只交换这两段已存在的item。
    const reasoning = input.splice(thinkingIndex, signatures.length);
    input.splice(prefixIndex, 0, ...reasoning);
    changed = true;
  }
  return changed ? { ...payload, input } : payload;
}
