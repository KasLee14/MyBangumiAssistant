import {
  lazyStream, type Api, type AssistantContent, type AssistantMessage,
  type AssistantMessageEvent, type AssistantMessageEventStream, type Model,
  type StreamOptions, type ThinkingContent, type ToolCall, type TranscriptContext,
} from '@earendil-works/pi-ai';
import { ContentDecoder, type ContentDelta } from './content-decoder.js';
import { validateMixedContent, type MixedContent } from './content-schema.js';
import { shouldUseMixedContent } from './provider-options.js';

type TextSlot = {
  kind: 'mixed'; sourceIndex: number; decoder: ContentDecoder; final?: MixedContent;
  signature?: string; started: Set<number>; ended: Set<number>;
};
type NativeSlot = { kind: 'native'; sourceIndex: number; part: ThinkingContent | ToolCall };
type Slot = TextSlot | NativeSlot;

/** 原生 content 直接存放文本和组件，provider 的 JSON 文字仅作为线路数据解码。 */
export function decodeProviderOutput(
  model: Model<Api>, context: TranscriptContext, options: StreamOptions | undefined,
  start: () => AssistantMessageEventStream,
): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    const enabled = shouldUseMixedContent(model, context);
    const source = start();
    if (!enabled) return source;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
        const slots: Slot[] = [];
        const active = new Map<number, Slot>();
        let lastSource: AssistantMessage | undefined;
        let parseError: unknown;
        const beginText = (index: number): TextSlot => {
          const previous = slots.at(-1);
          if (previous?.kind === 'mixed' && !previous.final && !parseError) {
            try { previous.final = previous.decoder.finish(); } catch (error) { parseError = error; }
          }
          const slot: TextSlot = { kind: 'mixed', sourceIndex: index, decoder: new ContentDecoder(), started: new Set(), ended: new Set() };
          active.set(index, slot);
          slots.push(slot);
          return slot;
        };
        const textAt = (index: number): TextSlot => {
          const slot = active.get(index);
          return slot?.kind === 'mixed' ? slot : beginText(index);
        };
        const observeNative = (index: number, message: AssistantMessage): NativeSlot | undefined => {
          const part = message.content[index];
          if (part?.type !== 'thinking' && part?.type !== 'toolCall') return undefined;
          let slot = active.get(index);
          if (slot?.kind === 'native') slot.part = structuredClone(part);
          else {
            slot = { kind: 'native', sourceIndex: index, part: structuredClone(part) };
            active.set(index, slot);
            slots.push(slot);
          }
          return slot;
        };
        const slotLength = (slot: Slot): number => slot.kind === 'native' ? 1 : slot.decoder.snapshot().content.length;
        const offset = (slot: Slot): number => slots.slice(0, slots.indexOf(slot)).reduce((size, item) => size + slotLength(item), 0);
        const visible = (message: AssistantMessage): AssistantMessage => {
          const content: AssistantContent[] = slots.flatMap<AssistantContent>(slot => {
            if (slot.kind === 'native') return [structuredClone(slot.part)];
            return slot.decoder.snapshot().content.map(part => part.type === 'text' && slot.signature
              ? { ...part, textSignature: slot.signature } : structuredClone(part));
          });
          return { ...message, content };
        };
        const updates = function* (slot: TextSlot, changes: ContentDelta[], message: AssistantMessage): Generator<AssistantMessageEvent> {
          for (const change of changes) {
            const index = offset(slot) + change.index;
            const part = slot.decoder.snapshot().content[change.index];
            if (part?.type === 'text' && !slot.started.has(change.index)) {
              slot.started.add(change.index);
              yield { type: 'text_start', contentIndex: index, partial: visible(message) };
            }
            if (change.type === 'text') {
              yield { type: 'text_delta', contentIndex: index, delta: change.delta, partial: visible(message) };
            } else if (change.type === 'text_end') {
              if (!slot.ended.has(change.index)) {
                slot.ended.add(change.index);
                yield { type: 'text_end', contentIndex: index, content: change.part.text, partial: visible(message) };
              }
            } else yield { type: 'content_update', contentIndex: index, partial: visible(message) };
          }
        };
        for await (const event of source) {
          lastSource = event.type === 'done' ? event.message : event.type === 'error' ? event.error : event.partial;
          if (options?.signal?.aborted && event.type !== 'error') {
            yield { type: 'error', reason: 'aborted', error: { ...visible(lastSource), stopReason: 'aborted', errorMessage: '请求已取消。' } };
            return;
          }
          if (event.type === 'start') {
            yield { ...event, partial: visible(event.partial) };
          } else if (event.type === 'text_start') {
            beginText(event.contentIndex);
          } else if (event.type === 'text_delta') {
            const slot = textAt(event.contentIndex);
            if (!parseError) {
              try { yield* updates(slot, slot.decoder.feed(event.delta), event.partial); }
              catch (error) { parseError = error; }
            }
          } else if (event.type === 'text_end') {
            const slot = textAt(event.contentIndex);
            const rawText = event.partial.content[event.contentIndex];
            if (rawText?.type === 'text' && rawText.textSignature) slot.signature = rawText.textSignature;
            if (!parseError) {
              try { slot.final ??= slot.decoder.finish(); }
              catch (error) { parseError = error; }
            }
            yield { type: 'content_update', contentIndex: offset(slot), partial: visible(event.partial) };
          } else if (event.type === 'done') {
            // 某些适配器只给终结消息；工具和思考不能因 UI 转换丢失。
            for (const [index, part] of event.message.content.entries()) {
              if (part.type === 'thinking' || part.type === 'toolCall') observeNative(index, event.message);
              else if (part.type === 'text' && !active.has(index) && !parseError) {
                const slot = beginText(index);
                if (part.textSignature) slot.signature = part.textSignature;
                try { yield* updates(slot, slot.decoder.feed(part.text), event.message); slot.final = slot.decoder.finish(); }
                catch (error) { parseError = error; }
              }
            }
            if (event.reason === 'toolUse' || event.message.content.some(part => part.type === 'toolCall')) {
              yield { ...event, message: visible(event.message) };
              return;
            }
            if (event.reason === 'deferred') { yield { ...event, message: visible(event.message) }; return; }
            try {
              if (event.reason !== 'stop' || parseError) throw new Error('组件输出未完整结束。');
              const content = slots.flatMap(slot => slot.kind === 'mixed' ? (slot.final ?? slot.decoder.finish()).content : []);
              validateMixedContent({ content });
              yield { ...event, message: visible(event.message) };
            } catch {
              yield { type: 'error', reason: 'error', error: { ...visible(event.message), stopReason: 'error',
                rawStopReason: event.message.rawStopReason ?? event.reason, errorMessage: 'CONTENT_OUTPUT_INVALID：模型输出未通过组件内容契约校验。' } };
            }
            return;
          } else if (event.type === 'error') {
            yield { ...event, error: visible(event.error) };
            return;
          } else {
            const slot = observeNative(event.contentIndex, event.partial);
            yield { ...event, contentIndex: slot ? offset(slot) : event.contentIndex, partial: visible(event.partial) };
          }
        }
        if (lastSource) yield { type: 'error', reason: 'error', error: { ...visible(lastSource), stopReason: 'error',
          errorMessage: 'CONTENT_OUTPUT_INCOMPLETE：模型响应未正常结束。' } };
        else throw new Error('CONTENT_OUTPUT_INCOMPLETE：模型响应未正常结束。');
      },
    };
  });
}
