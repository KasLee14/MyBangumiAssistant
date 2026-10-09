import { isDeepStrictEqual } from 'node:util';
import { PRESENTATION_MODEL_TOOL_ROLES } from './presentation-contract.js';

interface LoadoutApi {
  getActiveToolNames(): string[];
  getAllTools(): readonly { name: string }[];
  setActiveToolsByName(names: string[]): void;
}

/** 恢复只持有执行域快照；宿主展示集合始终取Pi当前值，不复制目录或事实状态。 */
export class RecoveryLoadout {
  private original: string[] | undefined;
  private allowed: Set<string> | undefined;
  private preserveHost = false;
  constructor(private readonly api: LoadoutApi) {}
  get preservesHost(): boolean { return this.preserveHost; }
  isHost(name: string): boolean {
    return PRESENTATION_MODEL_TOOL_ROLES.has(name) && this.api.getAllTools().some(tool => tool.name === name);
  }
  restrict(select: (execution: readonly string[]) => readonly string[], preserveHost: boolean): void {
    if (!this.original) {
      this.preserveHost = preserveHost;
      this.original = this.api.getActiveToolNames().filter(name => !preserveHost || !this.isHost(name));
    }
    this.allowed = new Set(select(this.original).filter(name => !this.preserveHost || !this.isHost(name)));
    const host = this.preserveHost ? this.api.getActiveToolNames().filter(name => this.isHost(name)) : [];
    this.api.setActiveToolsByName([...new Set([...host, ...this.allowed])]);
  }
  allows(name: string): boolean {
    return !this.allowed || this.preserveHost && this.isHost(name) || this.allowed.has(name);
  }
  restore(): void {
    if (this.original) {
      const host = this.preserveHost ? this.api.getActiveToolNames().filter(name => this.isHost(name)) : [];
      this.api.setActiveToolsByName([...new Set([...host, ...this.original])]);
    }
    this.original = undefined; this.allowed = undefined; this.preserveHost = false;
  }
}

/** 顶层与nested可重复经过同一hook，但只有同callID/同参数可重入一次来源读取许可。 */
export class ReferenceReadGate {
  private callId: string | undefined;
  private completed = false;
  constructor(private readonly name: string, private readonly args: unknown,
    private readonly validate: (name: string, args: unknown) => unknown) {}
  allows(callId: string, name: string, args: unknown): boolean {
    if (this.completed) return false;
    try {
      if (name !== this.name || !isDeepStrictEqual(this.validate(name, args), this.args)) return false;
    } catch { return false; }
    if (this.callId && this.callId !== callId) return false;
    this.callId = callId;
    return true;
  }
  complete(callId: string, name: string): void {
    if (this.callId === callId && name === this.name) this.completed = true;
  }
}
