import {
  lazyStream, type Api, type AssistantContent, type AssistantMessage,
  type AssistantMessageEvent, type AssistantMessageEventStream, type Model,
  type StreamOptions, type ThinkingContent, type ToolCall, type TranscriptContext,
} from '@earendil-works/pi-ai';
import { ContentDecoder, type ContentDelta } from './content-decoder.js';
import { ContentOutputError, MAX_CONTENT_BYTES, MAX_CONTENT_PARTS, validateMixedContent, type MixedContent } from './content-schema.js';
import { shouldUseMixedContent } from './provider-options.js';
import { attachOutputCheckpoint } from './recovery-checkpoint.js';
import { deriveNextTypes } from './content-normalize.js';
import { createErrorDiagnostic, errorCauses, rememberErrorDebug, withAssistantDiagnostic, type ErrorDiagnostic } from '../support/error-diagnostic.js';
import { sanitizeErrorDiagnostic } from '../support/errors.js';
import { expandResourceContent, type ResourceContentResolver } from './resource-content.js';
import { componentCatalogFor, validateLoadedComponents } from './component-catalog.js';
import { assemblePresentationOutput, shouldUsePresentation } from './presentation-output.js';

type TextSlot = {
  kind: 'mixed'; sourceIndex: number; decoder: ContentDecoder; final?: MixedContent;
  signature?: string; started: Set<number>; ended: Set<number>;
  resolved: Map<number, MixedContent['content'][number]>;
  approved: number;
};
type NativeSlot = { kind: 'native'; sourceIndex: number; part: ThinkingContent | ToolCall };
type Slot = TextSlot | NativeSlot;

/** 原生 content 直接存放文本和组件，provider 的 JSON 文字仅作为线路数据解码。 */
export function decodeProviderOutput(
  model: Model<Api>, context: TranscriptContext, options: StreamOptions | undefined,
  start: (observePayload: (payload: unknown) => void) => AssistantMessageEventStream,
  resolver?: ResourceContentResolver,
): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    const enabled = shouldUseMixedContent(model, context);
    let requestMaxTokens: number | null = null;
    const source = start(payload => {
      if (payload === null || typeof payload !== 'object') return;
      const record = payload as Record<string, unknown>;
      const limit = record.max_tokens ?? record.max_completion_tokens ?? record.max_output_tokens;
      if (typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0) requestMaxTokens = limit;
    });
    if (shouldUsePresentation(context)) return assemblePresentationOutput(model, context, options, source);
    if (!enabled) return source;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
        const slots: Slot[] = [];
        const active = new Map<number, Slot>();
        const catalog = componentCatalogFor(context);
        let lastSource: AssistantMessage | undefined;
        let parseError: unknown;
        let parseErrorSlot: TextSlot | undefined;
        const precedingParts = (): number => {
          if (!parseErrorSlot) return 0;
          return slots.slice(0, slots.indexOf(parseErrorSlot)).reduce((count, slot) => count + (slot.kind === 'mixed' ? slot.decoder.recoveryCheckpoint().prefix.length : 0), 0);
        };
        const failedOutput = (message: AssistantMessage, reason: string, cause?: unknown): AssistantMessage => {
          const content = visible(message).content;
          const state = slots.filter((slot): slot is TextSlot => slot.kind === 'mixed').map(slot => slot.decoder.diagnosticState());
          const error = cause instanceof ContentOutputError ? cause : parseError instanceof ContentOutputError ? parseError : undefined;
          let code = error?.reason === 'empty_output' ? 'CONTENT_OUTPUT_EMPTY' : error?.code === 'syntax' ? 'CONTENT_JSON_SYNTAX' : error?.code === 'truncated' ? 'CONTENT_JSON_INCOMPLETE'
            : error?.code === 'size' ? 'CONTENT_LIMIT_EXCEEDED' : 'CONTENT_SCHEMA_INVALID';
          let detail = error?.reason ?? 'schema_invalid', certainty: ErrorDiagnostic['certainty'] = 'confirmed';
          if (reason === 'length') { code = 'LLM_OUTPUT_TRUNCATED'; detail = requestMaxTokens !== null && message.usage.output >= requestMaxTokens ? 'output_budget_exhausted' : 'provider_length_stop'; certainty = detail === 'output_budget_exhausted' ? 'inferred' : 'confirmed'; }
          else if (reason === 'incomplete') { code = 'LLM_STREAM_INTERRUPTED'; detail = 'stream_terminal_missing'; }
          const evidence: ErrorDiagnostic['evidence'] = { provider: model.provider, model: model.id, api: model.api,
            rawStopReason: message.rawStopReason ?? reason, configuredMaxTokens: model.maxTokens, requestMaxTokens,
            outputTokens: message.usage.output, inputTokens: message.usage.input, contextWindow: model.contextWindow,
            bytes: state.reduce((sum, item) => sum + item.bytes, 0), byteLimit: MAX_CONTENT_BYTES,
            partCount: content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').length, partLimit: MAX_CONTENT_PARTS,
            completedParts: content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').length,
            completedComponents: content.filter(part => 'pending' in part && part.pending === false).length,
            pendingComponents: content.filter(part => 'pending' in part && part.pending === true).length,
            subjectCount: new Set(content.flatMap(part => part.type === 'SubjectCards' && part.pending === false ? part.props.items.map(item => item.id) : [])).size,
            jsonComplete: state.length > 0 && state.every(item => item.jsonComplete),
          };
          if (message.usage.reasoning !== undefined) evidence.reasoningTokens = message.usage.reasoning;
          if (message.responseId) evidence.responseId = message.responseId.slice(0, 300);
          // 额度更低不等于上下文裁剪，也可能是显式maxTokens或payload回调；不猜原因。
          if (requestMaxTokens !== null) evidence.requestBelowConfigured = requestMaxTokens < model.maxTokens;
          evidence.contextClamped = null;
          if (error?.location) Object.assign(evidence, error.location);
          const sourceDiagnostic = error?.diagnostic ? sanitizeErrorDiagnostic(error.diagnostic) : undefined;
          const operation = error?.sourceTool ?? sourceDiagnostic?.operation;
          const causes = [...errorCauses(error ?? cause), ...(sourceDiagnostic ? [{ name: 'ResourceReadError', code: sourceDiagnostic.code }, ...sourceDiagnostic.causes] : [])]
            .filter((item, index, values) => values.findIndex(other => other.name === item.name && other.code === item.code) === index).slice(0, 4);
          const referenceFailure = detail.startsWith('resource_reference_') && detail !== 'resource_reference_invalid';
          const diagnostic = sanitizeErrorDiagnostic(createErrorDiagnostic({ code, reason: detail, origin: code.startsWith('LLM_') ? 'llm' : 'content',
            stage: code.startsWith('LLM_') ? 'stream' : code === 'CONTENT_SCHEMA_INVALID' || code === 'CONTENT_LIMIT_EXCEEDED' ? 'validate' : 'decode',
            certainty: referenceFailure ? sourceDiagnostic?.certainty ?? certainty : certainty,
            recovery: referenceFailure ? detail === 'resource_reference_refresh_required' ? 'replan_read' : 'none'
              : code === 'CONTENT_SCHEMA_INVALID' || code === 'CONTENT_JSON_SYNTAX' ? 'repair_component'
                : code === 'CONTENT_LIMIT_EXCEEDED' ? 'correct_parameters' : 'continue_output',
            evidence: { ...(sourceDiagnostic?.evidence ?? {}), ...evidence },
            ...(operation && /^[a-zA-Z0-9_.-]{1,100}$/.test(operation) ? { operation } : {}),
            issues: error ? error.issueDetails.slice(0, 8).map(issue => ({ ...issue, path: issue.path.replace(/^\/content\/(\d+)(?=\/|$)/,
              (_match, index) => `/content/${precedingParts() + Number(index)}`) })) : [],
            causes }));
          rememberErrorDebug(diagnostic, error ?? cause, message.content.filter(part => part.type === 'text').map(part => part.text).join(''));
          const summaries: Record<string, string> = { LLM_OUTPUT_TRUNCATED: '模型输出被长度限制截断，已完成组件保留。',
            LLM_STREAM_INTERRUPTED: '模型流未正常结束，已完成内容保留。', CONTENT_JSON_SYNTAX: '模型输出不是合法 JSON。',
            CONTENT_JSON_INCOMPLETE: '模型输出的 JSON 未完整闭合。', CONTENT_OUTPUT_EMPTY: '模型没有生成有效正文。', CONTENT_SCHEMA_INVALID: '模型输出字段不符合组件契约。', CONTENT_LIMIT_EXCEEDED: '模型输出超过本地内容容量。' };
          // 解码器只记录错误；会话宿主根据结构化诊断决定恢复，独立流保留错误标记。
          const legacy = reason === 'incomplete' ? 'CONTENT_OUTPUT_INCOMPLETE' : 'CONTENT_OUTPUT_INVALID';
          const failed = withAssistantDiagnostic({ ...visible(message), stopReason: 'error', rawStopReason: message.rawStopReason ?? reason,
            errorMessage: `${legacy}：${referenceFailure ? '缓存引用未能展开，已完成内容保留。' : summaries[code]}${error ? ` ${error.message}` : ''}` }, diagnostic);
          return checkpoint(failed);
        };
        const checkpoint = (message: AssistantMessage): AssistantMessage => {
          const states = slots.filter((slot): slot is TextSlot => slot.kind === 'mixed').map(slot => slot.decoder.recoveryCheckpoint());
          const localBadIndex = parseError instanceof ContentOutputError ? Number(parseError.issueDetails[0]?.path.match(/^\/content\/(\d+)(?:\/|$)/)?.[1]) : NaN;
          const badIndex = Number.isInteger(localBadIndex) ? precedingParts() + localBadIndex : NaN;
          const prefix = slots.filter((slot): slot is TextSlot => slot.kind === 'mixed').flatMap(slot => {
            const parts = slot.decoder.recoveryCheckpoint().prefix.slice(0, slot.approved).map((part, index) => slot.resolved.get(index) ?? part);
            const firstPending = parts.findIndex(part => part.type !== 'text' && part.pending);
            return firstPending < 0 ? parts : parts.slice(0, firstPending);
          });
          // 错误块之前的真实完成前缀才可保留；预测占位不属于断点。
          const kept = Number.isInteger(badIndex) && badIndex < prefix.length ? prefix.slice(0, badIndex) : prefix;
          const failedReference = Number.isInteger(localBadIndex) ? parseErrorSlot?.decoder.resourceReferences().find(([index]) => index === localBadIndex)?.[1] : undefined;
          const failedPartDraft = Number.isInteger(localBadIndex) ? parseErrorSlot?.decoder.completedParts()[localBadIndex] : undefined;
          return attachOutputCheckpoint(message, { prefix: kept, jsonComplete: states.length > 0 && states.every(item => item.jsonComplete),
            failureScope: parseError instanceof ContentOutputError ? states.find(item => item.failedPartIndex !== undefined)?.failureScope
              ?? states.find(item => item.failureScope !== 'host')?.failureScope ?? 'host' : 'transport',
            ...(Number.isInteger(badIndex) ? { failedPartIndex: badIndex } : {}),
            ...(failedReference ? { draft: { type: failedReference.kind, props: failedReference.props } } : failedPartDraft ? { draft: failedPartDraft } : kept.length < prefix.length ? { draft: prefix[kept.length] } : states.find(item => item.draft !== undefined)?.draft === undefined ? {}
              : { draft: states.find(item => item.draft !== undefined)!.draft }) });
        };
        const beginText = (index: number): TextSlot => {
          const previous = slots.at(-1);
          if (previous?.kind === 'mixed' && !previous.final && !parseError) {
            try { previous.final = previous.decoder.finish(); } catch (error) { parseError = error; parseErrorSlot = previous; }
          }
          const slot: TextSlot = { kind: 'mixed', sourceIndex: index, decoder: new ContentDecoder(), started: new Set(), ended: new Set(), resolved: new Map(), approved: 0 };
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
        const approveClosed = (slot: TextSlot): void => {
          const parts = slot.decoder.completedParts();
          if (parts.length <= slot.approved) return;
          try {
            const references = new Map(slot.decoder.resourceReferences());
            if (catalog) validateLoadedComponents({ content: parts.map((part, index) => index < slot.approved ? { type: 'text' }
              : references.has(index) ? { ...part, props: references.get(index)!.props } : part) }, catalog);
            slot.approved = parts.length;
          } catch (error) {
            const index = error instanceof ContentOutputError ? Number(error.issueDetails[0]?.path.match(/^\/content\/(\d+)/)?.[1]) : NaN;
            if (Number.isInteger(index)) slot.approved = index;
            throw error;
          }
        };
        const feed = (slot: TextSlot, delta: string): ContentDelta[] => {
          try { return slot.decoder.feed(delta); } finally { approveClosed(slot); }
        };
        const stableParts = (slot: TextSlot): MixedContent['content'] => {
          const parts = slot.decoder.completedParts().slice(0, slot.approved).map((part, index) => slot.resolved.get(index) ?? part);
          const pending = parts.findIndex(part => part.type !== 'text' && part.pending === true);
          return pending < 0 ? parts : parts.slice(0, pending);
        };
        const slotLength = (slot: Slot): number => slot.kind === 'native' ? 1 : stableParts(slot).length;
        const offset = (slot: Slot): number => slots.slice(0, slots.indexOf(slot)).reduce((size, item) => size + slotLength(item), 0);
        const visible = (message: AssistantMessage): AssistantMessage => {
          const content: AssistantContent[] = slots.flatMap<AssistantContent>(slot => {
            if (slot.kind === 'native') return [structuredClone(slot.part)];
            return stableParts(slot).map(part => { return part.type === 'text' && slot.signature
              ? { ...part, textSignature: slot.signature } : structuredClone(part);
            });
          });
          const adjustments = slots.flatMap(slot => slot.kind === 'mixed' ? slot.decoder.normalizationAdjustments() : []).slice(0, 8);
          return { ...message, content, ...(adjustments.length ? { diagnostics: [...(message.diagnostics ?? []).filter(item => item.type !== 'bangumi_output_normalized'),
            { type: 'bangumi_output_normalized', timestamp: Date.now(), details: { schemaVersion: 1, adjustments: adjustments.map(({ path, rule }) => ({ path, rule })) } }] } : {}) };
        };
        const updates = function* (slot: TextSlot, changes: ContentDelta[], message: AssistantMessage): Generator<AssistantMessageEvent> {
          for (const change of changes) {
            // 未闭合文字和组件草稿不是用户正文，不发送其 delta/占位。
            if (change.type === 'text' || change.type === 'update') continue;
            const index = offset(slot) + change.index;
            const part = stableParts(slot)[change.index];
            if (!part) continue;
            if (part?.type === 'text' && !slot.started.has(change.index)) {
              slot.started.add(change.index);
              yield { type: 'text_start', contentIndex: index, partial: visible(message) };
            }
            if (change.type === 'text_end') {
              yield { type: 'text_delta', contentIndex: index, delta: change.part.text, partial: visible(message) };
              if (!slot.ended.has(change.index)) {
                slot.ended.add(change.index);
                yield { type: 'text_end', contentIndex: index, content: change.part.text, partial: visible(message) };
              }
            } else yield { type: 'content_update', contentIndex: index, partial: visible(message) };
          }
        };
        const resolveReferences = async function* (slot: TextSlot, message: AssistantMessage): AsyncGenerator<AssistantMessageEvent> {
          for (const [index, reference] of slot.decoder.resourceReferences()) {
            if (slot.resolved.has(index)) continue;
            try {
              const canonical = await expandResourceContent(reference.kind, reference.props, resolver, options?.signal);
              slot.resolved.set(index, canonical);
              // 只有缓存读取及完整契约验证完成后才发布 pending:false。
              yield { type: 'content_update', contentIndex: offset(slot) + index, partial: visible(message) };
            } catch (error) { if (error instanceof ContentOutputError) throw error.at(`/content/${index}`); throw error; }
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
              try { yield* updates(slot, feed(slot, event.delta), event.partial); yield* resolveReferences(slot, event.partial); }
              catch (error) { parseError = error; parseErrorSlot = slot; }
            }
          } else if (event.type === 'text_end') {
            const slot = textAt(event.contentIndex);
            const rawText = event.partial.content[event.contentIndex];
            if (rawText?.type === 'text' && rawText.textSignature) slot.signature = rawText.textSignature;
            if (!parseError) {
              try { slot.final ??= slot.decoder.finish(); }
              catch (error) { parseError = error; parseErrorSlot = slot; }
            }
            yield { type: 'content_update', contentIndex: offset(slot), partial: visible(event.partial) };
          } else if (event.type === 'done') {
            // 某些适配器只给终结消息；工具和思考不能因 UI 转换丢失。
            for (const [index, part] of event.message.content.entries()) {
              if (part.type === 'thinking' || part.type === 'toolCall') observeNative(index, event.message);
              else if (part.type === 'text' && !active.has(index) && !parseError) {
                const slot = beginText(index);
                if (part.textSignature) slot.signature = part.textSignature;
                try { yield* updates(slot, feed(slot, part.text), event.message); yield* resolveReferences(slot, event.message); slot.final = slot.decoder.finish(); }
                catch (error) { parseError = error; parseErrorSlot = slot; }
              }
            }
            if (event.reason === 'toolUse' || event.message.content.some(part => part.type === 'toolCall')) {
              yield { ...event, message: visible(event.message) };
              return;
            }
            if (event.reason === 'deferred') { yield { ...event, message: visible(event.message) }; return; }
            try {
              if (parseError) throw parseError;
              if (!slots.some(slot => slot.kind === 'mixed')) throw new ContentOutputError('模型没有生成有效正文。', 'schema', [],
                [{ path: '/content', rule: 'empty_output', message: '响应没有正文内容' }], 'empty_output');
              const content = deriveNextTypes(slots.flatMap(slot => slot.kind === 'mixed' ? (slot.final ?? slot.decoder.finish()).content.map((part, index) => slot.resolved.get(index) ?? part) : []));
              validateMixedContent({ content });
              if (event.reason !== 'stop' && event.reason !== 'length') throw new ContentOutputError('模型输出未正常结束。', 'truncated');
              const final = visible(event.message);
              let partIndex = 0;
              const finalContent = final.content.map(part => {
                if (part.type === 'thinking' || part.type === 'toolCall') return part;
                const connected = content[partIndex++];
                return part.type === 'text' && connected?.type === 'text' ? { ...part, nextType: connected.nextType } : part;
              });
              yield { type: 'done', reason: 'stop', message: { ...final, content: finalContent, stopReason: 'stop',
                ...(event.reason === 'length' ? { rawStopReason: event.message.rawStopReason ?? 'length', diagnostics: [...(final.diagnostics ?? []),
                  { type: 'bangumi_output_finalized', timestamp: Date.now(), details: { reason: 'complete_json_at_length_boundary' } }] } : {}) } };
            } catch (error) {
              yield { type: 'error', reason: 'error', error: failedOutput(event.message, event.reason, error) };
            }
            return;
          } else if (event.type === 'error') {
            yield { ...event, error: checkpoint(visible(event.error)) };
            return;
          } else {
            const slot = observeNative(event.contentIndex, event.partial);
            yield { ...event, contentIndex: slot ? offset(slot) : event.contentIndex, partial: visible(event.partial) };
          }
        }
        if (lastSource) yield { type: 'error', reason: 'error', error: failedOutput(lastSource, 'incomplete') };
        else throw new Error('CONTENT_OUTPUT_INCOMPLETE：模型响应未正常结束。');
      },
    };
  });
}
