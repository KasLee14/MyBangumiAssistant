import type { Message } from '../core/types.js';
import type { OperationPlan } from '../core/operations.js';
import { safeError } from '../domain/errors.js';
import { displayText, planText } from './ui/format.js';

/** 只读取整轮返回的末条答复，不按正文关键词判断完成。 */
export function finalAnswer(messages: readonly Message[]): string {
  const message = messages.at(-1);
  return message?.role === 'assistant' && !message.tool_calls?.length ? displayText(message.content ?? '') : '';
}

/** SessionLog.messages()只返回完成轮次；展示与模型使用的完整历史分别处理。 */
export function visibleMessageIndexes(messages: readonly Message[]): Set<number> {
  const visible = new Set<number>();
  let final: number | undefined;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'user') {
      if (final !== undefined) visible.add(final);
      final = undefined;
      visible.add(index);
    } else if (message.role === 'assistant' && !message.tool_calls?.length && message.content) final = index;
  }
  if (final !== undefined) visible.add(final);
  return visible;
}

/** 总结失败或取消时，仅使用宿主已有的执行及独立回读结果。 */
export function operationOutcome(plans: Iterable<OperationPlan>): string {
  const completed = [...plans].filter(plan => plan.results !== undefined);
  return completed.length ? displayText('已执行变更的核查结果：\n' + completed.map(plan => planText(plan)).join('\n')) : '';
}

export function turnFailure(error: unknown, cancelled: boolean, plans: Iterable<OperationPlan>): string {
  const info = safeError(error);
  const outcome = operationOutcome(plans);
  const message = cancelled ? '本轮已停止；已发送的变更以回读结果及操作记录为准。'
    : `${outcome ? '本轮答复未完成：' : ''}[${info.code}] ${info.message}`;
  return displayText(message + (outcome ? '\n\n' + outcome : ''));
}
