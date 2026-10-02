import type { Message } from './types.js';
import { AppError } from '../domain/errors.js';
import { mediaType, positiveId, type MediaType } from '../domain/bangumi.js';
import { mutationFrom, selectionFrom, selectionCommand, unsafeMutationText, type Reference } from '../domain/dialogue-intent.js';
import { normalizeSubjectName, subjectQuery } from '../domain/subject-query.js';
import { readTaskFrom, type ReadTask } from '../domain/model-task.js';

export interface Candidate { id: number; title: string; type: MediaType; url: string; aliases?: string[] }
export interface CandidateSet { id: string; items: Candidate[] }

function candidate(value: unknown): Candidate {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_RESPONSE', '候选应为对象。');
  const item = value as Record<string, unknown>; const id = positiveId(item.id);
  return { id, title: String(item.nameCn || item.name || item.title || '').slice(0, 300), type: mediaType(item.type), url: `https://bgm.tv/subject/${id}`,
    aliases: [...new Set([item.name, item.nameCn, item.title, ...(Array.isArray(item.aliases) ? item.aliases : [])].filter((value): value is string => typeof value === 'string' && Boolean(value)).map(value => value.slice(0, 300)))].slice(0, 10) };
}

export class CandidateState {
  private sets: CandidateSet[] = [];
  private targets: Candidate[] = [];
  private antecedents: Candidate[] = [];
  private taskEstablished = false;
  private multiple = false;
  private antecedentMultiple = false;
  private sequence = 0;
  /** 新任务不继承默认对象；上一任务只作为明确指代的来源。 */
  beginTask(): void { this.antecedents = structuredClone(this.targets); this.antecedentMultiple = this.multiple; this.targets = []; this.taskEstablished = false; this.multiple = false; }
  objects(): Candidate[] { return structuredClone(this.targets); }
  references(): Candidate[] { return structuredClone(this.taskEstablished ? this.targets : this.antecedents); }
  known(): Candidate[] {
    return structuredClone([...new Map([...this.antecedents, ...this.sets.flatMap(set => set.items), ...this.targets].map(item => [item.id, item])).values()]);
  }
  remember(value: Candidate): void { this.taskEstablished = true; this.targets = [...this.targets.filter(item => item.id !== value.id), structuredClone(value)]; }
  clearTask(): void { this.targets = []; this.antecedents = []; this.taskEstablished = true; this.multiple = false; this.antecedentMultiple = false; }
  set(id?: string): CandidateSet | null { return structuredClone((id ? this.sets.find(set => set.id === id) : this.sets.at(-1)) ?? null); }
  add(values: unknown[], setId?: string): CandidateSet {
    const items = values.map(candidate);
    if (items.length > 20 || new Set(items.map(item => item.id)).size !== items.length) throw new AppError('INVALID_RESPONSE', '候选数量超限或包含重复条目。');
    const id = setId ?? `c${++this.sequence}`;
    if (!/^c[1-9]\d*$/.test(id) || this.sets.some(set => set.id === id)) throw new AppError('INVALID_RESPONSE', '候选清单标识无效或重复。');
    this.sequence = Math.max(this.sequence, Number(id.slice(1)));
    const set = { id, items }; this.sets.push(set); this.sets = this.sets.slice(-10);
    if (items.length === 1) this.remember(items[0]!);
    else { this.taskEstablished = true; if (!this.multiple) this.targets = []; }
    return structuredClone(set);
  }
  select(index: number, setId?: string): Candidate {
    const set = setId ? this.sets.find(item => item.id === setId) : this.sets.at(-1);
    if (!set || !Number.isInteger(index) || index < 1 || index > set.items.length) throw new AppError('CANDIDATE_NOT_FOUND', '候选编号不存在，请查看具体候选清单。');
    this.focus(set.items[index - 1]!); return structuredClone(set.items[index - 1]!);
  }
  matchQuery(input: string): Candidate | null {
    const query = subjectQuery(input);
    if (!query) return null;
    const matches = this.queryMatches(input);
    if (matches.length || query.type || /第.+[季期]/.test(query.name)) this.targets = matches.length === 1 ? structuredClone(matches) : [];
    return this.current();
  }
  queryMatches(input: string): Candidate[] {
    const query = subjectQuery(input);
    if (!query) return [];
    const name = normalizeSubjectName(query.name);
    const items = this.sets.at(-1)?.items.filter(item => !query.type || item.type === query.type) ?? [];
    const names = (item: Candidate) => [item.title, ...(item.aliases ?? [])].map(normalizeSubjectName);
    const exact = items.filter(item => names(item).includes(name));
    if (query.fields.length && !/第\d+季/.test(name)) {
      const seasons = items.filter(item => names(item).some(alias => alias.startsWith(name) && /^第\d+季$/.test(alias.slice(name.length))));
      if (exact.length && seasons.length) return structuredClone([...items.filter(item => exact.includes(item) || seasons.includes(item))]);
    }
    return structuredClone(exact);
  }
  /** 主对话使用模型结构化目标，宿主仅核对已读取候选，不解析自由表达。 */
  targetMatches(task: ReadTask | null): Candidate[] {
    if (!task?.targetName || task.mode !== 'single') return [];
    const name = normalizeSubjectName(task.targetName);
    const items = this.known().filter(item => !task.type || item.type === task.type);
    const names = (item: Candidate) => [item.title, ...(item.aliases ?? [])].map(normalizeSubjectName);
    const exact = items.filter(item => names(item).includes(name));
    if (!/第\d+季/.test(name)) {
      const seasons = items.filter(item => names(item).some(alias => alias.startsWith(name) && /^第\d+季$/.test(alias.slice(name.length))));
      if (exact.length && seasons.length) return structuredClone(items.filter(item => exact.includes(item) || seasons.includes(item)));
    }
    return structuredClone(exact);
  }
  matchTarget(task: ReadTask | null): Candidate | null {
    if (!task) return this.current();
    const matches = this.targetMatches(task);
    this.taskEstablished = true;
    this.multiple = task.mode !== 'single';
    if (task.mode === 'single') this.targets = matches.length === 1 ? structuredClone(matches) : [];
    return this.current();
  }
  fromExplicitUser(input: string): void {
    const command = selectionCommand(input);
    if (command) {
      if (command.reference.kind === 'index') this.select(command.reference.index, command.setId);
      else if (!this.resolve(command.reference, true)) this.targets = [];
      return;
    }
    const ref = selectionFrom(input) ?? (this.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (ref) this.resolve(ref, true);
  }
  fromUser(input: string): void {
    const command = selectionCommand(input);
    if (command) {
      if (command.reference.kind === 'index') this.select(command.reference.index, command.setId);
      else if (!this.resolve(command.reference, true)) this.targets = [];
      return;
    }
    if (unsafeMutationText(input)) return;
    const reference = mutationFrom(input)?.reference ?? selectionFrom(input)
      ?? (this.hasName(input.trim()) ? { kind: 'name' as const, name: input.trim() } : null);
    if (reference) { this.resolve(reference, true); return; }
    const indices = [...input.matchAll(/第([一二三四五六七八九十\d]+)[部个项]/g)];
    // 多个不同编号或同时存在其他条目ID时不把任意一个猜成单项授权。
    const targets = new Set(indices.map(match => match[1]));
    if (targets.size > 1) { this.targets = []; return; }
    if (indices.length) {
      const value = indices[0]![1]!; const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      const index = /^\d+$/.test(value) ? Number(value) : digits[value] ?? (value.startsWith('十') ? 10 + (digits[value.slice(1)] ?? NaN) : value === '二十' ? 20 : NaN);
      this.select(index);
    }
  }
  resolve(reference: Reference, focus = false, setId?: string, type?: MediaType): Candidate | null {
    let result: Candidate | null = null;
    const set = this.set(setId);
    if (setId && !set) throw new AppError('CANDIDATE_NOT_FOUND', '候选清单不存在。');
    const items = (setId ? set!.items : this.known()).filter(item => !type || item.type === type);
    if (reference.kind === 'current') {
      const refs = this.references();
      if (!(this.taskEstablished ? this.multiple : this.antecedentMultiple) && refs.length === 1 && (!type || refs[0]!.type === type) && (!setId || items.some(item => item.id === refs[0]!.id))) result = refs[0]!;
    }
    if (reference.kind === 'index') {
      if (!set || reference.index < 1 || reference.index > set.items.length || !Number.isInteger(reference.index)) throw new AppError('CANDIDATE_NOT_FOUND', '候选编号不存在。');
      result = set.items[reference.index - 1]!;
    }
    if (reference.kind === 'id') result = items.find(item => item.id === reference.id) ?? null;
    if (reference.kind === 'name') {
      const normalize = normalizeSubjectName;
      const nameItems = setId ? set!.items : this.known();
      const matches = nameItems.filter(item => [item.title, ...(item.aliases ?? [])].some(name => normalize(name) === normalize(reference.name)));
      if (matches.length === 1) result = matches[0]!;
    }
    if (result && type && result.type !== type) result = null;
    if (focus && result) this.focus(result);
    return structuredClone(result);
  }
  focus(value: Candidate): void { this.taskEstablished = true; this.multiple = false; this.targets = [structuredClone(value)]; }
  hasName(value: string): boolean {
    const normalize = (text: string) => text.normalize('NFC').replace(/\s/g, '').toLocaleLowerCase();
    return this.known().some(item => [item.title, ...(item.aliases ?? [])].some(name => normalize(name) === normalize(value)));
  }
  restoreSnapshot(value: ReturnType<CandidateState['snapshot']>): void {
    this.sets = structuredClone(value.sets); this.targets = structuredClone(value.targets); this.antecedents = structuredClone(value.antecedents); this.taskEstablished = value.taskEstablished; this.multiple = value.multiple; this.antecedentMultiple = value.antecedentMultiple;
    this.sequence = Math.max(0, ...this.sets.map(set => Number(set.id.slice(1))));
  }
  /** 仅表示本次任务已经唯一核实的对象，不作为新操作的默认参数。 */
  current(): Candidate | null { return structuredClone(!this.multiple && this.targets.length === 1 ? this.targets[0]! : null); }
  snapshot(): { sets: CandidateSet[]; targets: Candidate[]; antecedents: Candidate[]; taskEstablished: boolean; multiple: boolean; antecedentMultiple: boolean } { return structuredClone({ sets: this.sets, targets: this.targets, antecedents: this.antecedents, taskEstablished: this.taskEstablished, multiple: this.multiple, antecedentMultiple: this.antecedentMultiple }); }
  restore(messages: readonly Message[]): void {
    this.sets = []; this.targets = []; this.antecedents = []; this.taskEstablished = false; this.multiple = false; this.antecedentMultiple = false; this.sequence = 0;
    const calls = new Map<string, string>();
    let input = '';
    for (const message of messages) {
      if (message.role === 'user') { input = message.content; this.beginTask(); try { this.fromExplicitUser(input); } catch { this.targets = []; } }
      if (message.role === 'assistant') for (const call of message.tool_calls ?? []) calls.set(call.id, call.function.name);
      if (message.role !== 'tool') continue;
      try {
        const result = JSON.parse(message.content);
        if (calls.get(message.tool_call_id) === 'search_subjects' && result.ok === true && Array.isArray(result.data?.data)) {
          this.add(Array.isArray(result.data.candidateSet?.items) ? result.data.candidateSet.items : result.data.data, result.data.candidateSet?.id);
          // 仅恢复成功读取的结构化目标；旧自然语言解析不再进入主会话恢复。
          if (result.data.readTask?.kind === 'read') this.matchTarget(readTaskFrom(result.data.readTask, input));
        }
        if (result.ok === true && ['get_subject', 'get_subject_details'].includes(calls.get(message.tool_call_id) ?? '') && result.data?.id) this.remember(candidate(result.data));
        if (result.ok === true && ['propose_dialogue_request', 'preview_collection_changes', 'preview_progress_changes'].includes(calls.get(message.tool_call_id) ?? '') && Array.isArray(result.data?.actions)) {
          for (const action of result.data.actions) {
            const known = this.resolve({ kind: 'id', id: positiveId(action.subjectId) });
            if (known) this.remember(known);
            else if (action.baseline?.type && typeof action.title === 'string') this.remember(candidate({ id: action.subjectId, type: action.baseline.type, title: action.title }));
          }
        }
      } catch { /* 旧日志不合法的候选不用于授权或消歧。 */ }
    }
  }
}
