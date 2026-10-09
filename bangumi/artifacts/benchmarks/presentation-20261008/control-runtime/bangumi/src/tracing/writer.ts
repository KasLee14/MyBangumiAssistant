import { createHash } from 'node:crypto';
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PayloadRef, TraceEvent, TraceOptions } from './schema.js';
import { traceJson, tracePayloadReference } from './redact.js';

/** 每份 trace 一个串行文件队列；正文按哈希去重，stdout 永远不承载诊断。 */
export class TraceWriter {
  readonly directory: string;
  readonly issues = new Set<string>();
  droppedEvents = 0;
  private queue: Promise<void>;
  private pendingBytes = 0;
  private failed = false;
  private readonly payloads = new Map<string, PayloadRef>();
  private readonly maxQueueBytes: number;

  constructor(private readonly options: TraceOptions, date: string, sessionId: string, traceId: string) {
    const sessionPath = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : createHash('sha256').update(sessionId).digest('hex');
    this.directory = resolve(options.directory, date, sessionPath, traceId);
    this.maxQueueBytes = options.maxQueueBytes ?? 32 * 1024 * 1024;
    this.queue = mkdir(join(this.directory, 'payloads'), { recursive: true }).then(() => {}).catch(() => this.fail('writer_failed'));
  }

  private fail(code: string): void {
    const first = !this.issues.has(code);
    this.issues.add(code);
    if (code === 'writer_failed') this.failed = true;
    if (first) try {
      if (this.options.onWarning) this.options.onWarning(code);
      else process.stderr.write(`TRACE_SAVE_INCOMPLETE：tracelog 保存不完整（${code}）。\n`);
    } catch { /* 诊断失败不能影响业务。 */ }
  }
  issue(code: string): void { this.fail(code); }

  private enqueue(task: () => Promise<void>, bytes: number, final = false): boolean {
    if (this.failed) return false;
    if (!final && this.pendingBytes + bytes > this.maxQueueBytes) { this.fail('queue_limit'); return false; }
    this.pendingBytes += bytes;
    this.queue = this.queue.then(async () => { if (!this.failed) await task(); })
      .catch(() => this.fail('writer_failed')).finally(() => { this.pendingBytes -= bytes; });
    return true;
  }

  payload(value: unknown): PayloadRef {
    const body = traceJson(value);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const cached = this.payloads.get(sha256);
    if (cached) return cached;
    const bytes = Buffer.byteLength(body);
    const relativePath = `payloads/${sha256}.json`;
    const saved = this.enqueue(() => writeFile(join(this.directory, relativePath), body + '\n', { encoding: 'utf8', flag: 'wx' }), bytes + 1);
    const ref = tracePayloadReference(saved ? { path: relativePath, sha256, bytes }
      : { path: null, sha256, bytes, omitted: this.failed ? 'writer_failed' : 'queue_limit' });
    if (saved) this.payloads.set(sha256, ref);
    return ref;
  }

  event(event: TraceEvent, final = false): void {
    const body = JSON.stringify(event) + '\n';
    if (!this.enqueue(() => appendFile(join(this.directory, 'events.jsonl'), body, 'utf8'), Buffer.byteLength(body), final)) this.droppedEvents++;
  }

  summary(value: unknown): void {
    const body = JSON.stringify(value, null, 2) + '\n';
    this.enqueue(async () => {
      const temporary = join(this.directory, 'summary.json.tmp');
      await writeFile(temporary, body, 'utf8');
      await rename(temporary, join(this.directory, 'summary.json'));
    }, Buffer.byteLength(body), true);
  }

  async flush(): Promise<void> { await this.queue; }
}
