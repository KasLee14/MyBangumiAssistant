import { displayText } from './format.js';

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
function parts(text: string): string[] { return [...segmenter.segment(text)].map(part => part.segment); }
/** 按字素编辑，中文、组合字符及 emoji 不按 UTF-16 单元拆开。 */
export class PromptEditor {
  private value: string[] = [];
  cursor = 0;
  private history: string[] = [];
  private historyIndex = 0;
  private draft = '';
  get text(): string { return this.value.join(''); }
  get before(): string { return this.value.slice(0, this.cursor).join(''); }
  get after(): string { return this.value.slice(this.cursor).join(''); }
  set(text: string): void { this.value = parts(displayText(text)); this.cursor = this.value.length; }
  insert(text: string): boolean {
    const safe = displayText(text); if ((this.text + safe).length > 8000) return false;
    const add = parts(safe); this.value.splice(this.cursor, 0, ...add); this.cursor += add.length; return true;
  }
  left(): void { this.cursor = Math.max(0, this.cursor - 1); }
  right(): void { this.cursor = Math.min(this.value.length, this.cursor + 1); }
  home(): void { while (this.cursor > 0 && this.value[this.cursor - 1] !== '\n') this.cursor--; }
  end(): void { while (this.cursor < this.value.length && this.value[this.cursor] !== '\n') this.cursor++; }
  backspace(): void { if (this.cursor) this.value.splice(--this.cursor, 1); }
  delete(): void { this.value.splice(this.cursor, 1); }
  vertical(direction: -1 | 1): void {
    let start = this.cursor; while (start > 0 && this.value[start - 1] !== '\n') start--;
    const column = this.cursor - start;
    let end = this.cursor; while (end < this.value.length && this.value[end] !== '\n') end++;
    if (direction < 0 && start > 0) {
      const previousEnd = start - 1; let previousStart = previousEnd;
      while (previousStart > 0 && this.value[previousStart - 1] !== '\n') previousStart--;
      this.cursor = Math.min(previousEnd, previousStart + column);
    } else if (direction > 0 && end < this.value.length) {
      const nextStart = end + 1; let nextEnd = nextStart;
      while (nextEnd < this.value.length && this.value[nextEnd] !== '\n') nextEnd++;
      this.cursor = Math.min(nextEnd, nextStart + column);
    }
  }
  recall(direction: -1 | 1): void {
    if (this.historyIndex === this.history.length) this.draft = this.text;
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
    this.set(this.historyIndex === this.history.length ? this.draft : this.history[this.historyIndex]!);
  }
  submit(): string {
    const text = this.text;
    if (text.trim()) { this.history.push(text); if (this.history.length > 100) this.history.shift(); }
    this.historyIndex = this.history.length; this.draft = ''; this.set(''); return text;
  }
}
