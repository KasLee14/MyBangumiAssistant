import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError, credentialValues, redact } from '../support/errors.js';
import type { Data } from './resource-output.js';

export interface WriteFactStore { entries(): Data[]; append(fact: Data): void }

/** 宿主事实账本跨聊天共享；只记录事实，不保存 Cookie、guard、用户原文或可恢复授权。 */
export class WriteJournal implements WriteFactStore {
  constructor(private readonly path: string) {}
  entries(): Data[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, 'utf8').split('\n');
    const facts: Data[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim(); if (!line) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        facts.push(value as Data);
      } catch { throw new AppError('WRITE_JOURNAL_INVALID', `写入事实账本第${i + 1}行不完整；未忽略未决修改，请保留账本并核实。`); }
    }
    return facts;
  }
  append(fact: Data): void {
    // 不接受授权对象；JSON 事实中也不会包含不可序列化的运行期对象。
    if (['guard', 'permit', 'token', 'input', 'cookie', 'sessionId'].some(key => Object.hasOwn(fact, key))) throw new AppError('WRITE_RECORD_INVALID', '写入事实不得包含凭据或授权对象。');
    mkdirSync(dirname(this.path), { recursive: true });
    const serialized = redact(JSON.stringify(fact), credentialValues()) + '\n';
    const fd = openSync(this.path, 'a', 0o600);
    try { writeSync(fd, serialized, undefined, 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
}
