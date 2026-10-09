import { AppError } from '../support/errors.js';
import { object, positiveId } from '../support/bangumi.js';

/** 只经宿主 _meta 传递，模型工具参数没有批次上下文或预检快照。 */
export interface McpBatchScope { id: string; phase: 'prepare' | 'submit' | 'verify' | 'close' }
export interface BatchPreparation {
  tool: string; args: Record<string, unknown>; target: Record<string, unknown>;
  before: unknown; after: unknown; relationId?: number;
}
export function batchScope(value: unknown): McpBatchScope {
  const raw = object(value);
  if (Object.keys(raw).some(key => !['id', 'phase'].includes(key)) || typeof raw.id !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(raw.id) || !['prepare', 'submit', 'verify', 'close'].includes(String(raw.phase))) {
    throw new AppError('BATCH_SCOPE_INVALID', '宿主批次上下文无效。');
  }
  return { id: raw.id, phase: raw.phase as McpBatchScope['phase'] };
}
export function batchPreparation(value: unknown): BatchPreparation {
  const raw = object(value);
  if (Object.keys(raw).some(key => !['tool', 'args', 'target', 'before', 'after', 'relationId'].includes(key))
    || typeof raw.tool !== 'string' || !Object.hasOwn(raw, 'before') || !Object.hasOwn(raw, 'after')) {
    throw new AppError('INVALID_INPUT', '宿主批次写入快照无效。');
  }
  return structuredClone({ tool: raw.tool, args: object(raw.args), target: object(raw.target), before: raw.before, after: raw.after,
    ...(raw.relationId === undefined ? {} : { relationId: positiveId(raw.relationId) }) });
}
