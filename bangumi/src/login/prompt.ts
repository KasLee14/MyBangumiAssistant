import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  CURSOR_MARKER, decodeKittyPrintable, matchesKey, truncateToWidth,
  type Component, type Focusable,
} from '@earendil-works/pi-tui';
import { AppError } from '../support/errors.js';
import type { LoginPrompt } from './login.js';

/** 独立 Pi 输入组件。不使用普通 editor、Input 的撤销历史或 kill ring。 */
export class LoginInputComponent implements Component, Focusable {
  focused = true;
  private characters: string[] = [];
  private cursor = 0;
  private paste = '';
  private pasting = false;
  private completed = false;
  private invalidPaste = false;

  constructor(
    private readonly kind: 'email' | 'password',
    private readonly requestRender: () => void,
    private readonly done: (result: string | undefined) => void,
  ) {}

  private clear(): void {
    this.characters.fill('');
    this.characters = [];
    this.cursor = 0;
    this.paste = '';
    this.pasting = false;
    this.invalidPaste = false;
  }

  private finish(value: string | undefined): void {
    if (this.completed) return;
    this.completed = true;
    this.clear();
    this.requestRender();
    this.done(value);
  }

  cancel(): void { this.finish(undefined); }
  dispose(): void { this.completed = true; this.clear(); }
  invalidate(): void {}

  private insert(value: string): void {
    // 控制字符和多行粘贴拒绝，避免终端转义或粘贴时自动提交。
    if (/[\x00-\x1f\x7f-\x9f]/u.test(value)) {
      this.invalidPaste = true;
      this.requestRender();
      return;
    }
    const limit = this.kind === 'email' ? 254 : 4000;
    if (this.characters.join('').length + value.length > limit) {
      this.invalidPaste = true;
      this.requestRender();
      return;
    }
    const incoming = Array.from(value);
    this.characters.splice(this.cursor, 0, ...incoming);
    this.cursor += incoming.length;
    this.invalidPaste = false;
    this.requestRender();
  }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.cancel();
      return;
    }
    // 与 Pi TUI 一致处理 bracketed paste，但不进入共享粘贴历史。
    const start = data.indexOf('\x1b[200~');
    if (start >= 0 && !this.pasting) {
      this.pasting = true;
      this.paste = '';
      data = data.slice(start + 6);
    }
    if (this.pasting) {
      this.paste += data;
      const end = this.paste.indexOf('\x1b[201~');
      if (end >= 0) {
        const content = this.paste.slice(0, end);
        const remainder = this.paste.slice(end + 6);
        this.paste = '';
        this.pasting = false;
        this.insert(content);
        if (remainder) this.handleInput(remainder);
      } else if (this.paste.length > 16384) {
        this.paste = '';
        this.pasting = false;
        this.invalidPaste = true;
        this.requestRender();
      }
      return;
    }
    if (matchesKey(data, 'enter') || data === '\n') {
      if (!this.invalidPaste) this.finish(this.characters.join(''));
      return;
    }
    if (matchesKey(data, 'backspace')) {
      if (this.cursor > 0) this.characters.splice(--this.cursor, 1);
    } else if (matchesKey(data, 'delete')) {
      this.characters.splice(this.cursor, 1);
    } else if (matchesKey(data, 'left')) {
      this.cursor = Math.max(0, this.cursor - 1);
    } else if (matchesKey(data, 'right')) {
      this.cursor = Math.min(this.characters.length, this.cursor + 1);
    } else if (matchesKey(data, 'home') || matchesKey(data, 'ctrl+a')) {
      this.cursor = 0;
    } else if (matchesKey(data, 'end') || matchesKey(data, 'ctrl+e')) {
      this.cursor = this.characters.length;
    } else if (matchesKey(data, 'ctrl+u')) {
      this.clear();
    } else {
      const printable = decodeKittyPrintable(data) ?? data;
      if (!printable.includes('\x1b')) this.insert(printable);
      return;
    }
    this.invalidPaste = false;
    this.requestRender();
  }

  render(width: number): string[] {
    const label = this.kind === 'email' ? 'Bangumi 登录邮箱' : 'Bangumi 登录密码（隐藏）';
    const display = this.kind === 'password' ? this.characters.map(() => '•') : this.characters;
    const before = display.slice(0, this.cursor).join('');
    const after = display.slice(this.cursor).join('');
    const cursor = this.focused && !this.completed ? CURSOR_MARKER : '';
    return [
      truncateToWidth(label, width),
      truncateToWidth(`> ${before}${cursor}${after}`, width),
      truncateToWidth(this.invalidPaste ? '输入过长或包含控制字符，请重新输入。' : 'Enter 提交 · Esc / Ctrl+C 取消 · Ctrl+U 清空', width),
    ];
  }
}

/** 只能在 Pi 本地 TUI 命令中使用，原值不写入聊天 editor、事件或会话。 */
export function createLoginPrompt(ctx: Pick<ExtensionContext, 'mode' | 'ui'>): LoginPrompt {
  return async (kind, signal) => {
    signal.throwIfAborted();
    if (ctx.mode !== 'tui') throw new AppError('BGM_LOGIN_UI_REQUIRED', '登录需要本地交互终端，请使用 /bangumi-login。');
    let component: LoginInputComponent | undefined;
    const abort = () => component?.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const value = await ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => {
        component = new LoginInputComponent(kind, () => tui.requestRender(), done);
        if (signal.aborted) queueMicrotask(abort);
        return component;
      }, { overlay: true });
      signal.throwIfAborted();
      if (value === undefined) throw new AppError('CANCELLED', '登录已取消。');
      return value;
    } finally {
      signal.removeEventListener('abort', abort);
      component?.dispose();
      component = undefined;
    }
  };
}
