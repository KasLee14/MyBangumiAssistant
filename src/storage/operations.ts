import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, credentialValues, redact } from '../domain/errors.js';

export type OperationState = 'started' | 'success' | 'failed' | 'unknown';
export interface OperationRecord { operationId: string; planId: string; state: OperationState }
export class OperationJournal {
  private readonly file: string;
  constructor(private readonly directory: string, sessionId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId)) throw new AppError('INVALID_INPUT', '会话 ID 格式无效。');
    this.file = join(directory, `${sessionId}.operations.jsonl`);
  }
  async states(): Promise<Map<string, OperationState>> {
    let body: string;
    try { body = await readFile(this.file, 'utf8'); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return new Map();
      throw new AppError('OPERATION_LOG_READ', '无法读取操作记录，已停止执行。');
    }
    const states = new Map<string, OperationState>();
    try {
      for (const line of body.split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.version !== 1 || typeof event.operationId !== 'string' || typeof event.planId !== 'string' || !['started', 'success', 'failed', 'unknown'].includes(event.state)) throw new Error('invalid');
        const before = states.get(event.operationId);
        if ((!before && event.state !== 'started') || (before && (before !== 'started' || event.state === 'started'))) throw new Error('invalid transition');
        states.set(event.operationId, event.state);
      }
    } catch { throw new AppError('OPERATION_LOG_FORMAT', '操作记录不完整，已停止执行；不得自动重试写入。'); }
    return states;
  }
  async append(record: OperationRecord): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true });
      await appendFile(this.file, redact(JSON.stringify({ version: 1, at: new Date().toISOString(), ...record }), credentialValues()) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch { throw new AppError('OPERATION_LOG_WRITE', '无法保存操作记录，执行已停止；已经开始的操作需先核对状态，不自动重试。'); }
  }
}
