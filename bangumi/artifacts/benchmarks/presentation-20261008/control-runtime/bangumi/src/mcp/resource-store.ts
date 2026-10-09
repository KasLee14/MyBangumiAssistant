import { randomBytes } from 'node:crypto';
import { AppError } from '../support/errors.js';
import type { AccessContext } from './access-context.js';
import type { CachedResource, ResourceData } from './resource-contract.js';
interface Entry { bindingKey?: string; turnId: string; bytes: number; resource: CachedResource; raw: unknown }
/** 原始响应只在服务内存；引用固定版本，读取返回副本。 */
export class ResourceStore {
  private readonly entries = new Map<string, Entry>(); private bytes = 0;
  private readonly rawEntries = new Map<string, { turnId: string; bytes: number; raw: ResourceData; context: AccessContext }>();
  constructor(private readonly maxBytes = 64 * 1024 * 1024) {
  }
  put(sourceTool: string, value: ResourceData, raw: unknown, turnId: string, accessContext: AccessContext, bindingKey?: string): string {
    const resourceRef = `rr_${randomBytes(16).toString('hex')}`;
    const resource: CachedResource = { schemaVersion: 1, kind: 'cached_resource', resourceRef, sourceTool, value: structuredClone(value), accessContext: structuredClone(accessContext) };
    const entry = { turnId, ...(bindingKey ? { bindingKey } : {}), resource, raw: structuredClone(raw), bytes: Buffer.byteLength(JSON.stringify([resource, raw])) };
    if (entry.bytes > this.maxBytes) throw new AppError('MCP_OUTPUT_LIMIT', '单个资源超过缓存容量，请保持查询范围分页读取。');
    this.reserve(entry.bytes);
    this.entries.set(resourceRef, entry);
    this.bytes += entry.bytes;
    return resourceRef;
  }
  bindingKey(ref: string): string | undefined {
    return this.entries.get(ref)?.bindingKey;
  }
  get(ref: string, turnId: string): CachedResource {
    const entry = this.entries.get(ref);
    if (!entry) throw new AppError('RESOURCE_EXPIRED', '资源引用已过期，请重新读取原来源。');
    if (entry.turnId !== turnId) throw new AppError('RESOURCE_SCOPE_MISMATCH', '资源引用不属于当前读取轮次。');
    return structuredClone(entry.resource);
  }
  putRaw(key: string, raw: ResourceData, context: AccessContext, turnId: string): void {
    const previous = this.rawEntries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.rawEntries.delete(key);
    }
    const row = { turnId, raw: structuredClone(raw), context: structuredClone(context), bytes: Buffer.byteLength(JSON.stringify([key, raw, context])) };
    if (row.bytes > this.maxBytes) return;
    this.reserve(row.bytes);
    this.rawEntries.set(key, row);
    this.bytes += row.bytes;
  }
  getRaw(key: string): { raw: ResourceData; context: AccessContext } | undefined {
    const row = this.rawEntries.get(key);
    return row ? { raw: structuredClone(row.raw), context: structuredClone(row.context) } : undefined;
  }
  clear(turnId?: string): void {
    for (const [ref, row] of this.entries) if (turnId === undefined || row.turnId === turnId) {
      this.entries.delete(ref);
      this.bytes -= row.bytes;
    }
    for (const [key, row] of this.rawEntries) if (turnId === undefined || row.turnId === turnId) {
      this.rawEntries.delete(key);
      this.bytes -= row.bytes;
    }
  }
  private reserve(bytes: number): void {
    while (this.bytes + bytes > this.maxBytes) {
      const first = this.entries.entries().next().value;
      if (first) {
        this.entries.delete(first[0]);
        this.bytes -= first[1].bytes;
        continue;
      }
      const raw = this.rawEntries.entries().next().value;
      if (raw) {
        this.rawEntries.delete(raw[0]);
        this.bytes -= raw[1].bytes;
        continue;
      }
      break;
    }
  }
}
