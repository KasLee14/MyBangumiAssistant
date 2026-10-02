import { appendFile, readFile, mkdir, readdir, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from '../core/types.js';
import { AppError, credentialValues, redact } from '../domain/errors.js';

export interface SessionEvent {
  version: 1; at: string; type: string; data: unknown;
}
export class SessionLog {
  readonly id: string;
  private appendReady = false;
  constructor(private readonly directory: string, id?: string) {
    this.id = id ?? randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(this.id)) throw new AppError('INVALID_INPUT', '会话 ID 格式无效。');
  }
  async append(type: string, data: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${this.id}.jsonl`);
    if (!this.appendReady) {
      try {
        const body = await readFile(file, 'utf8');
        if (body && !body.endsWith('\n')) {
          const start = body.lastIndexOf('\n') + 1;
          let valid = false; try { JSON.parse(body.slice(start)); valid = true; } catch { /* 未完整写入的最后一条事件。 */ }
          if (valid) await appendFile(file, '\n');
          else await truncate(file, Buffer.byteLength(body.slice(0, start)));
        }
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw new AppError('SESSION_WRITE', '无法准备会话日志追加。');
      }
      this.appendReady = true;
    }
    const event: SessionEvent = { version: 1, at: new Date().toISOString(), type, data };
    await appendFile(file, redact(JSON.stringify(event), credentialValues()) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
  async messages(): Promise<Message[]> {
    let body: string;
    try { body = await readFile(join(this.directory, `${this.id}.jsonl`), 'utf8'); }
    catch { throw new AppError('SESSION_READ', '无法读取会话。'); }
    const messages: Message[] = []; let active: Message[] | null = null;
    try {
      const lines = body.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (!line.trim()) continue;
        let event: SessionEvent;
        try { event = JSON.parse(line) as SessionEvent; }
        catch {
          // 仅容忍崩溃留下的最后一段未完成 JSON；中间损坏仍拒绝恢复。
          if (index === lines.length - 1 && !body.endsWith('\n')) break;
          throw new Error('invalid event');
        }
        if (event.version !== 1) throw new Error('unsupported version');
        if (event.type === 'turn/start') active = [];
        else if (event.type === 'message' && active) active.push(event.data as Message);
        else if (event.type === 'turn/end' && active) {
          if (event.data && typeof event.data === 'object' && 'status' in event.data && event.data.status === 'completed') messages.push(...active);
          active = null;
        }
      }
    } catch { throw new AppError('SESSION_FORMAT', '会话日志不完整或版本不受支持。'); }
    return messages;
  }
  static async list(directory: string): Promise<string[]> {
    try { return (await readdir(directory)).filter(name => /^[a-f0-9-]+\.jsonl$/.test(name)).map(name => name.slice(0,-6)).sort(); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw new AppError('SESSION_READ', '无法列出会话。');
    }
  }
}
