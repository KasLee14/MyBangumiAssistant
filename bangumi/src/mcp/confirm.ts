import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { AppError } from '../support/errors.js';

export interface WriteConfirmOptions { title?: string; confirmLabel?: string }

/** 仅负责一个写入预览的分页查看与明确确认，不持有对话或修改任务。 */
export class WritePreviewComponent implements Component {
  private readonly text: Text;
  private lines: string[] = [];
  private seen: boolean[] = [];
  private offset = 0;
  private pageSize = 1;
  private width = 0;
  private rows = 0;
  private layout = 0;
  private selectedConfirm = false;
  private flushed = false;
  private completed = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    preview: string,
    private readonly requestRender: () => void,
    private readonly getRows: () => number,
    private readonly done: (accepted: boolean) => void,
    private readonly options: WriteConfirmOptions = {},
  ) { this.text = new Text(preview, 0, 0); }

  private viewedAll(): boolean { return this.seen.length > 0 && this.seen.every(Boolean); }
  private atEnd(): boolean { return this.offset + this.pageSize >= this.lines.length; }
  canConfirm(): boolean { return !this.completed && this.width >= 20 && this.rows >= 6 && this.flushed && this.viewedAll() && this.atEnd(); }

  private clear(): void {
    this.text.setText(''); this.lines = []; this.seen = [];
    this.offset = 0; this.selectedConfirm = false; this.flushed = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
  private finish(accepted: boolean): void {
    if (this.completed) return;
    this.completed = true; this.clear(); this.requestRender(); this.done(accepted);
  }
  cancel(): void { this.finish(false); }
  dispose(): void { this.completed = true; this.clear(); }
  invalidate(): void { this.text.invalidate(); }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) { this.cancel(); return; }
    if (matchesKey(data, 'enter') || data === '\n') {
      // 默认取消。确认选项只能在全部预览实际呈现且当前停留末页时选中。
      if (!this.selectedConfirm) this.finish(false);
      else if (this.canConfirm()) this.finish(true);
      return;
    }
    if (matchesKey(data, 'left')) { this.selectedConfirm = false; this.requestRender(); return; }
    if (matchesKey(data, 'right') || matchesKey(data, 'tab')) {
      this.selectedConfirm = this.canConfirm() && !this.selectedConfirm;
      this.requestRender(); return;
    }
    let next = this.offset;
    if (matchesKey(data, 'pageDown')) next += this.pageSize;
    else if (matchesKey(data, 'pageUp')) next -= this.pageSize;
    else if (matchesKey(data, 'down')) next++;
    else if (matchesKey(data, 'up')) next--;
    else if (matchesKey(data, 'home')) next = 0;
    else if (matchesKey(data, 'end')) next = this.lines.length;
    else return;
    this.offset = Math.max(0, Math.min(next, Math.max(0, this.lines.length - this.pageSize)));
    this.selectedConfirm = false; this.flushed = false; this.requestRender();
  }

  render(width: number): string[] {
    if (this.completed) return [];
    const rows = Math.max(1, Math.floor(this.getRows()));
    if (width !== this.width || rows !== this.rows) {
      this.width = width; this.rows = rows; this.layout++;
      this.lines = this.text.render(Math.max(1, width));
      this.seen = this.lines.map(() => false);
      this.offset = 0; this.selectedConfirm = false; this.flushed = false;
    }
    if (width < 20 || rows < 6) return new Text('终端太小，无法完整预览。请扩大窗口，或 Esc 取消。', 0, 0).render(Math.max(1, width)).slice(0, rows);
    this.pageSize = rows - 4;
    this.offset = Math.min(this.offset, Math.max(0, this.lines.length - this.pageSize));
    const start = this.offset; const end = Math.min(start + this.pageSize, this.lines.length);
    const layout = this.layout;
    this.flushed = false;
    // Pi renderer在当前调用栈输出返回的行；下一事件轮才登记覆盖，防止快速按键提前确认。
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.completed || layout !== this.layout || start !== this.offset) return;
      let changed = false;
      for (let line = start; line < end; line++) if (!this.seen[line]) { this.seen[line] = true; changed = true; }
      this.flushed = true;
      if (changed) this.requestRender();
    }, 0);
    this.timers.add(timer);
    const ready = this.viewedAll() && this.atEnd();
    const label = this.options.confirmLabel ?? '确认修改';
    const choice = ready ? this.selectedConfirm ? `取消    [${label}]` : `[取消]    ${label}` : '[取消]    确认未解锁';
    return [
      truncateToWidth(this.options.title ?? 'Bangumi 修改预览', width),
      truncateToWidth(`第 ${start + 1}-${end}/${this.lines.length} 行 · ${ready ? '完整预览已显示' : '请查看全部内容'}`, width),
      ...this.lines.slice(start, end),
      truncateToWidth('↑↓ / PgUp PgDn 翻页 · ←→ 选择 · Enter 执行选择', width),
      truncateToWidth(choice, width),
    ];
  }
}

/** 不回退到可能裁切长文本且默认Yes的原生confirm。 */
export async function confirmWrite(ctx: ExtensionContext, preview: string, signal?: AbortSignal, options: WriteConfirmOptions = {}): Promise<boolean> {
  signal?.throwIfAborted();
  if (ctx.mode !== 'tui' || !ctx.hasUI || typeof ctx.ui.custom !== 'function') throw new AppError('AUTHORIZATION_REQUIRED', '写入需要能完整显示预览的本地 Pi 交互终端。');
  let component: WritePreviewComponent | undefined;
  const abort = () => component?.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const accepted = await ctx.ui.custom<boolean>((tui, _theme, _keys, done) => {
      component = new WritePreviewComponent(preview, () => tui.requestRender(), () => tui.terminal.rows, done, options);
      if (signal?.aborted) queueMicrotask(abort);
      return component;
    }, { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', margin: 0, anchor: 'top-left' } });
    return !signal?.aborted && accepted;
  } finally {
    signal?.removeEventListener('abort', abort);
    component?.dispose(); component = undefined;
  }
}
