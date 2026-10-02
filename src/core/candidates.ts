import type { Message } from './types.js';
import { AppError } from '../domain/errors.js';
import { mediaType, positiveId, type MediaType } from '../domain/bangumi.js';
import { mutationFrom, selectionFrom, unsafeMutationText, type Reference } from '../domain/dialogue-intent.js';

export interface Candidate { id: number; title: string; type: MediaType; url: string; aliases?: string[] }
export interface CandidateSet { id: string; items: Candidate[] }

function candidate(value: unknown): Candidate {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_RESPONSE', '候选应为对象。');
  const item = value as Record<string, unknown>; const id = positiveId(item.id);
  return { id, title: String(item.nameCn || item.name || item.title || '').slice(0, 300), type: mediaType(item.type), url: `https://bgm.tv/subject/${id}`,
    aliases: [...new Set([item.name, item.nameCn, item.title].filter((value): value is string => typeof value === 'string' && Boolean(value)).map(value => value.slice(0, 300)))] };
}

export class CandidateState {
  private sets: CandidateSet[] = [];
  private selected: Candidate | null = null;
  private sequence = 0;
  add(values: unknown[], setId?: string): CandidateSet {
    const items = values.map(candidate);
    if (items.length > 20 || new Set(items.map(item => item.id)).size !== items.length) throw new AppError('INVALID_RESPONSE', '候选数量超限或包含重复条目。');
    const id = setId ?? `c${++this.sequence}`;
    if (!/^c[1-9]\d*$/.test(id) || this.sets.some(set => set.id === id)) throw new AppError('INVALID_RESPONSE', '候选清单标识无效或重复。');
    this.sequence = Math.max(this.sequence, Number(id.slice(1)));
    const set = { id, items }; this.sets.push(set); this.sets = this.sets.slice(-10); this.selected = items.length === 1 ? structuredClone(items[0]!) : null;
    return structuredClone(set);
  }
  select(index: number, setId?: string): Candidate {
    const set = setId ? this.sets.find(item => item.id === setId) : this.sets.at(-1);
    if (!set || !Number.isInteger(index) || index < 1 || index > set.items.length) throw new AppError('CANDIDATE_NOT_FOUND', '候选编号不存在，请查看具体候选清单。');
    this.selected = structuredClone(set.items[index - 1]!); return structuredClone(this.selected);
  }
  fromUser(input: string): void {
    const command = /^\/select\s+(?:(c[1-9]\d*)\s+)?([1-9]\d*)$/.exec(input.trim());
    if (command) { this.select(Number(command[2]), command[1]); return; }
    if (unsafeMutationText(input)) return;
    const reference = mutationFrom(input)?.reference ?? selectionFrom(input)
      ?? (this.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (reference) { this.resolve(reference, true); return; }
    const indices = [...input.matchAll(/第([一二三四五六七八九十\d]+)[部个项]/g)];
    // 多个不同编号或同时存在其他条目ID时不把任意一个猜成单项授权。
    const targets = new Set(indices.map(match => match[1]));
    if (targets.size > 1) { this.selected = null; return; }
    if (indices.length) {
      const value = indices[0]![1]!; const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      const index = /^\d+$/.test(value) ? Number(value) : digits[value] ?? (value.startsWith('十') ? 10 + (digits[value.slice(1)] ?? NaN) : value === '二十' ? 20 : NaN);
      this.select(index);
    }
  }
  resolve(reference: Reference, focus = false): Candidate | null {
    let result: Candidate | null = null;
    const latest = this.sets.at(-1);
    if (reference.kind === 'current') result = this.selected;
    if (reference.kind === 'index') result = this.select(reference.index);
    if (reference.kind === 'id') result = latest?.items.find(item => item.id === reference.id) ?? (this.selected?.id === reference.id ? this.selected : null);
    if (reference.kind === 'name') {
      const normalize = (value: string) => value.normalize('NFC').replace(/\s/g, '').toLocaleLowerCase();
      const matches = latest?.items.filter(item => [item.title, ...(item.aliases ?? [])].some(name => normalize(name) === normalize(reference.name))) ?? [];
      if (matches.length === 1) result = matches[0]!;
      else if (matches.length === 0 && this.selected && normalize(this.selected.title) === normalize(reference.name)) result = this.selected;
    }
    // 未解析的文字片段不是一次有效选择；保留原有焦点供受限解析核对“这部”。
    if (focus && !(reference.kind === 'name' && !this.hasName(reference.name))) this.selected = result ? structuredClone(result) : null;
    return structuredClone(result);
  }
  focus(value: Candidate): void { this.selected = structuredClone(value); }
  hasName(value: string): boolean {
    const normalize = (text: string) => text.normalize('NFC').replace(/\s/g, '').toLocaleLowerCase();
    return [...(this.sets.at(-1)?.items ?? []), ...(this.selected ? [this.selected] : [])].some(item => [item.title, ...(item.aliases ?? [])].some(name => normalize(name) === normalize(value)));
  }
  restoreSnapshot(value: ReturnType<CandidateState['snapshot']>): void {
    this.sets = structuredClone(value.sets); this.selected = structuredClone(value.selected);
    this.sequence = Math.max(0, ...this.sets.map(set => Number(set.id.slice(1))));
  }
  current(): Candidate | null { return structuredClone(this.selected); }
  snapshot(): { sets: CandidateSet[]; selected: Candidate | null } { return structuredClone({ sets: this.sets, selected: this.selected }); }
  restore(messages: readonly Message[]): void {
    this.sets = []; this.selected = null; this.sequence = 0;
    const calls = new Map<string, string>();
    for (const message of messages) {
      if (message.role === 'user') { try { this.fromUser(message.content); } catch { this.selected = null; } }
      if (message.role === 'assistant') for (const call of message.tool_calls ?? []) calls.set(call.id, call.function.name);
      if (message.role !== 'tool' || calls.get(message.tool_call_id) !== 'search_subjects') continue;
      try {
        const result = JSON.parse(message.content);
        if (result.ok === true && Array.isArray(result.data?.data)) this.add(result.data.data, result.data.candidateSet?.id);
      } catch { /* 旧日志不合法的候选不用于授权或消歧。 */ }
    }
  }
}
