import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createLoginPrompt } from './login/prompt.js';
import { confirmWrite } from './mcp/confirm.js';

export type NoticeType = 'info' | 'warning' | 'error';

/**
 * 写入确认与登录输入的通道。
 *
 * 这两类交互原先只存在于 Pi 交互终端：TUI 用 `ui.custom` 自绘组件，而
 * RPC/print/json 模式下 `ui.custom` 不可用，写入与登录因此必然被拒。Web 终端
 * 需要自己的通道，把同一个完整预览与字段请求送到浏览器再取回结果；授权判定、
 * 预览内容与提交前的二次校验仍全部留在宿主，浏览器只是呈现与回话。
 *
 * `canLogin` 与 `canConfirm` 表示当前是否真的有人可以回答：Web 端在没有浏览器
 * 连接时必须为假，避免把待确认的写入变成无人应答的挂起。
 */
export interface InteractionChannel {
  canConfirm(): boolean;
  confirm(ctx: ExtensionContext, preview: string, signal: AbortSignal | undefined): Promise<boolean>;
  canLogin(): boolean;
  login(ctx: ExtensionContext, kind: 'email' | 'password', signal: AbortSignal): Promise<string>;
  notify(ctx: ExtensionContext, message: string, type: NoticeType): void;
}

/** 本地 Pi 交互终端的通道：沿用原有预览组件与隐藏输入组件。 */
export function createTerminalChannel(): InteractionChannel {
  return {
    // 这个通道只在交互终端里创建，因此具备完整预览与隐藏输入能力。
    canConfirm: () => true,
    confirm: (ctx, preview, signal) => confirmWrite(ctx, preview, signal),
    canLogin: () => true,
    login: (ctx, kind, signal) => createLoginPrompt(ctx)(kind, signal),
    notify: (ctx, message, type) => ctx.ui.notify(message, type),
  };
}
