import { lazyStream, getCurrentSystemMessage, getSystemMessageText, type Api, type Model, type AssistantMessage, type AssistantMessageEventStream, type TranscriptContext, type StreamOptions } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { PRESENTATION_SYSTEM_MARKER } from './presentation-contract.js';
import { replyAssemblerFor } from './reply-assembler.js';
import { ContentOutputError } from './content-schema.js';
import { createErrorDiagnostic, withAssistantDiagnostic } from '../support/error-diagnostic.js';

export function shouldUsePresentation(context: TranscriptContext): boolean {
  const system = getCurrentSystemMessage(context.messages);
  return !!system && getSystemMessageText(system).includes(PRESENTATION_SYSTEM_MARKER);
}
/** 提供方继续发送原生文字及工具；宿主完成文字另进入唯一正文快照。 */
export function assemblePresentationOutput(model: Model<Api>, context: TranscriptContext, options: StreamOptions | undefined, source: AssistantMessageEventStream): AssistantMessageEventStream {
  const assembler = replyAssemblerFor(context);
  if (!assembler || !shouldUsePresentation(context)) return source;
  const owner = assembler.snapshot();
  const requestId = randomUUID();
  return lazyStream(model, async () => ({
    async *[Symbol.asyncIterator]() {
      const accepted = new Set<number>();
      const accept = (message: AssistantMessage, index: number): void => {
        const part = message.content[index];
        if (accepted.has(index) || part?.type !== 'text' || !part.text.trim() || options?.signal?.aborted || !assembler.active) return;
        assembler.append({ type: 'text', text: part.text, nextType: null }, `${requestId}:${index}`, undefined, options?.signal);
        accepted.add(index);
      };
      for await (const event of source) {
        if (owner?.turnId !== assembler.snapshot()?.turnId) {
          const message = event.type === 'done' ? event.message : event.type === 'error' ? event.error : event.partial;
          yield { type: 'error', reason: 'aborted', error: assembler.mark({ ...message, stopReason: 'aborted', errorMessage: '用户回合已改变，旧输出已停止。' }, owner) }; return;
        }
        if (event.type === 'done') {
          // 工具回合的原生文字属于过程审计；显式交错正文使用present_text。
          // 只有正常stop确认后的文字可进入稳定完成前缀，length/取消不提交草稿。
          try {
            if (event.reason === 'stop') for (const [index] of event.message.content.entries()) accept(event.message, index);
          } catch (error) {
            const contentError = error instanceof ContentOutputError ? error : undefined;
            const diagnostic = createErrorDiagnostic({ code: contentError?.code === 'size' ? 'CONTENT_LIMIT_EXCEEDED' : 'CONTENT_SCHEMA_INVALID',
              reason: contentError?.reason ?? 'presentation_append_failed', origin: 'content', stage: 'validate', recovery: 'none',
              issues: [...(contentError?.issueDetails ?? [])], evidence: { completedParts: assembler.snapshot()?.content.length ?? 0 } });
            yield { type: 'error', reason: 'error', error: assembler.mark(withAssistantDiagnostic({ ...event.message, stopReason: 'error', errorMessage: '正文未能完整发布，已完成内容保留。' }, diagnostic), owner) }; return;
          }
          yield { ...event, message: assembler.mark(event.message) };
        } else if (event.type === 'error') yield { ...event, error: assembler.mark(event.error) };
        else yield { ...event, partial: assembler.mark(event.partial) };
      }
    },
  }));
}
