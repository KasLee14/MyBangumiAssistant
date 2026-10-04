import { createHash } from 'node:crypto';
import { credentialValues, redact } from '../support/errors.js';
import type { PayloadRef } from './schema.js';

const payloadReferences = new WeakSet<object>();
/** 引用来自宿主生成的哈希，不能因它偶然包含短凭据片段而再次改写。 */
export function tracePayloadReference(value: PayloadRef): PayloadRef {
  payloadReferences.add(value);
  return Object.freeze(value);
}

const PRIVATE_KEYS = /^(?:api[_-]?key|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|headers|env|guard|prepared|permit|thinkingSignature|thoughtSignature|textSignature|encrypted_content)$/i;

/** 在写入队列前复制并脱敏；不保存供应商签名、请求头、环境或宿主授权对象。 */
export function traceRedact(value: unknown, partial = false): unknown {
  const secrets = credentialValues();
  const seen = new WeakSet<object>();
  const text = (raw: string, protectTail = false): string => {
    let safe = redact(raw, secrets)
      .replace(/((?:api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token|secret)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
    // 完整的部分消息快照仍可能以半个凭据结尾，先隐藏这些尾部再落盘。
    if (protectTail) for (const secret of secrets) {
      for (let length = Math.min(secret.length - 1, safe.length); length > 0; length--) {
        if (safe.endsWith(secret.slice(0, length))) { safe = safe.slice(0, -length) + '[PARTIAL_REDACTED]'; break; }
      }
    }
    return safe;
  };
  const visit = (item: unknown, depth: number, field = ''): unknown => {
    if (typeof item === 'string') {
      // 工具通常把结构化 JSON 包装成 text；递归处理它，防止敏感键藏在字符串内。
      if (depth < 64 && /^[\s]*[\[{]/.test(item)) {
        try { return JSON.stringify(visit(JSON.parse(item), depth + 1)); } catch { /* 普通文本照常脱敏。 */ }
      }
      return text(item, partial && ['text', 'thinking', 'content'].includes(field));
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item === 'bigint') return item.toString();
    if (typeof item !== 'object') return null;
    if (payloadReferences.has(item)) return item;
    if (depth > 64 || seen.has(item)) return '[UNSERIALIZABLE]';
    seen.add(item);
    let safe: unknown;
    if (Array.isArray(item)) safe = item.map(child => visit(child, depth + 1, field));
    else if (item instanceof Map) safe = [...item].map(([key, child]) => [visit(key, depth + 1), visit(child, depth + 1)]);
    else if (item instanceof Error) safe = { name: text(item.name), message: text(item.message) };
    else {
      const row = item as Record<string, unknown>;
      safe = Object.fromEntries(Object.entries(row).map(([key, child]) => [text(key), PRIVATE_KEYS.test(key) ? '[REDACTED]'
        : row.type === 'thinking' && row.redacted === true && key === 'thinking' ? '[PROVIDER_REDACTED]' : visit(child, depth + 1, key)]));
    }
    seen.delete(item);
    return safe;
  };
  try { return visit(value, 0); } catch { return '[FULLY_REDACTED: serialization_failed]'; }
}

/** 仅调整对象键顺序，保留数组、字符串及类型的原始含义。 */
export function traceJson(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)])) : item;
  return JSON.stringify(stable(value)) ?? 'null';
}

export function traceHash(value: unknown): string { return createHash('sha256').update(traceJson(value)).digest('hex'); }
