import { createHash } from 'node:crypto';
import type { MixedPart } from './content-types.js';

/** 连接关系是展示序列的派生状态，不是模型提供的事实。保留签名等附加元数据。 */
export function deriveNextTypes<T extends { type: string; nextType?: string | null }>(parts: readonly T[]): T[] {
  return parts.map((part, index) => part.type === 'text'
    ? { ...part, nextType: parts[index + 1]?.type ?? null } : part);
}

/** 前缀保护只比较真实内容；续接允许更新末段的派生连接字段。 */
export function contentFingerprint(parts: readonly MixedPart[]): string {
  return createHash('sha256').update(JSON.stringify(parts.map(part => part.type === 'text'
    ? { type: part.type, text: part.text } : { type: part.type, props: part.props }))).digest('hex');
}
