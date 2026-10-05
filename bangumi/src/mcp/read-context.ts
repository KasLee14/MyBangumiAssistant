import { AppError } from '../support/errors.js';

/** 只由宿主提供的任务标识，不属于模型工具参数。 */
export interface McpReadContext { turnId: string }

export function readContext(value: unknown): McpReadContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'turnId')) throw new AppError('INVALID_INPUT', '读取任务上下文无效。');
  const turnId = (value as Record<string, unknown>).turnId;
  if (typeof turnId !== 'string' || !turnId.trim() || turnId.length > 200 || /[\u0000-\u001f\u007f]/.test(turnId)) {
    throw new AppError('INVALID_INPUT', '读取任务标识无效。');
  }
  return { turnId };
}
