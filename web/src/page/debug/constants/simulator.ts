/**
 * 调试页模拟器的常量表。
 *
 * `KEEP` 是 `SimStep.play` 的哨兵；`DEBUG_INSTANCE_ID` 是调试专用 store 的实例标识
 * （首帧必须用非空 instanceId，否则 `store/reducers/stream.ts` 的 `switched` 会把它当成
 * 「同实例的增量」而不是整体替换）；`SUPPORTED_EVENTS` 供调试页给出可读的错误提示。
 */

/** `play: KEEP` 表示「不改动流式区当前内容」；空数组表示清空流式区。 */
export const KEEP = Symbol('keep-live-content');

export const DEBUG_INSTANCE_ID = 'debug-instance';

/** 已知的事件类型，供调试页给出可读的错误提示。 */
export const SUPPORTED_EVENTS = [
  'agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
  'agent_end', 'agent_settled',
  'compaction_start', 'compaction_end',
  'auto_retry_start', 'auto_retry_end', 'session_info_changed',
] as const;
