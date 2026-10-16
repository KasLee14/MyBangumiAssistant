import { AppError } from '../support/errors.js';

/** 只由宿主提供的任务标识，不属于模型工具参数。 */
export interface McpReadContext { turnId: string; snapshotId?: string; nsfw?: 'exclude' | 'include' }

export function readContext(value: unknown): McpReadContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['turnId','snapshotId','nsfw'].includes(key))) throw new AppError('INVALID_INPUT', '读取任务上下文无效。');
  const turnId = (value as Record<string, unknown>).turnId;
  if (typeof turnId !== 'string' || !turnId.trim() || turnId.length > 200 || /[\u0000-\u001f\u007f]/.test(turnId)) {
    throw new AppError('INVALID_INPUT', '读取任务标识无效。');
  }
  const {snapshotId,nsfw}=value as Record<string,unknown>;
  if(snapshotId!==undefined&&(typeof snapshotId!=='string'||!/^[-A-Za-z0-9_.]{1,160}$/.test(snapshotId)))throw new AppError('INVALID_INPUT','读取快照标识无效。');
  if(nsfw!==undefined&&nsfw!=='exclude'&&nsfw!=='include')throw new AppError('INVALID_INPUT','本地内容显示范围无效。');
  return { turnId,...(snapshotId===undefined?{}:{snapshotId:snapshotId as string}),...(nsfw===undefined?{}:{nsfw:nsfw as 'exclude'|'include'}) };
}
