import type { ServerEvent } from './protocol';

/** 会话状态事件流的两个回调；`onStatus` 只在连接开合时触发（EventSource 自带重连）。 */
export interface StreamHandlers {
  onFrame(frame: ServerEvent): void;
  onStatus(connected: boolean): void;
}
