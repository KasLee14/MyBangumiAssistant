import type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages';
import { validateMixedContent } from './content-schema.js';
import { isComponentKind } from './content-types.js';
import { PRESENTATION_MESSAGE_MARKER, type PresentationSnapshot } from './reply-assembler.js';
import { credentialValues, redact } from '../support/errors.js';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
export type PresentationHistoryToolRole = 'presentation' | 'definition';
export interface PresentationHistoryOptions {
  /** 完整当前分支的原生来源，不能用压缩后的上下文替代。 */
  sourceMessages: readonly AssistantMessage[];
  sourceTranscript?: readonly Message[];
  model?: Model<Api>;
  toolRoles?: ReadonlyMap<string, PresentationHistoryToolRole>;
}
interface HistoryBinding {
  snapshots: Map<string, PresentationSnapshot>;
  sources: Map<string, string[]>;
  toolRoles: ReadonlyMap<string, PresentationHistoryToolRole>;
  resultKeys: Map<string, string[]>;
  model?: Model<Api>;
}
interface Source { replyId: string; turnId: string }
interface ToolPair { call: ToolCall; messageIndex: number; contentIndex: number; resultIndex: number; result: ToolResultMessage }
interface TextSource { text: string; reference: Row }
type TextSourceOutcome = 'ok' | 'error' | 'unknown';
export interface PresentationHistoryAudit {
  replyId: string; turnId: string; sourceComplete: boolean; foldedCallCount: number;
  retainedSignedCallCount: number; summaryInjected: boolean; textSourceRefs: Row[];
}
const histories = new WeakMap<object, HistoryBinding>();
export const HISTORY_REFERENCE_NOTE_PREFIX = '历史引用仅标识原操作，当前请求未验证可复用，不得照抄到新工具参数：';

function referenceFields(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) { value.forEach(item => referenceFields(item, refs)); return; }
  if (!record(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (['resourceRef', 'resource_ref'].includes(key) && typeof item === 'string') refs.add(item);
    else referenceFields(item, refs);
  }
}

function sourceOf(message: Message): Source | undefined {
  if (message.role !== 'assistant') return;
  const details = message.diagnostics?.findLast(value => value.type === PRESENTATION_MESSAGE_MARKER)?.details;
  return typeof details?.replyId === 'string' && typeof details.turnId === 'string'
    ? { replyId: details.replyId, turnId: details.turnId } : undefined;
}
function sourceFingerprint(message: AssistantMessage): string {
  return JSON.stringify({ api: message.api, provider: message.provider, model: message.model,
    timestamp: message.timestamp, stopReason: message.stopReason, content: message.content });
}
/** 快照与来源分别绑定；原来源缺失、被编辑或压缩时不会从旁路存储复活整轮正文。 */
export function bindPresentationHistory(context: { messages: object }, snapshots: readonly unknown[], options?: PresentationHistoryOptions): void {
  const binding: HistoryBinding = { snapshots: new Map(), sources: new Map(), resultKeys: new Map(), toolRoles: new Map(options?.toolRoles ?? []),
    ...(options?.model ? { model: options.model } : {}) };
  for (const snapshot of snapshots) {
    if (!record(snapshot) || snapshot.version !== 1 || typeof snapshot.replyId !== 'string' || typeof snapshot.turnId !== 'string'
      || !['completed', 'error', 'aborted'].includes(String(snapshot.status))) continue;
    try { validateMixedContent({ content: snapshot.content }); } catch { continue; }
    binding.snapshots.set(snapshot.replyId, structuredClone(snapshot) as unknown as PresentationSnapshot);
  }
  for (const message of options?.sourceMessages ?? []) {
    const source = sourceOf(message), snapshot = source && binding.snapshots.get(source.replyId);
    if (!source || !snapshot || source.turnId !== snapshot.turnId) continue;
    const keys = binding.sources.get(source.replyId) ?? [];
    keys.push(sourceFingerprint(message)); binding.sources.set(source.replyId, keys);
  }
  for (const pair of pairedTools(options?.sourceTranscript ?? [])) {
    const original = options!.sourceTranscript![pair.messageIndex], source = original && sourceOf(original);
    if (!source) continue;
    const keys = binding.resultKeys.get(source.replyId) ?? [];
    keys.push(resultFingerprint(pair)); binding.resultKeys.set(source.replyId, keys);
  }
  histories.set(context, binding); histories.set(context.messages, binding);
}

/** 只投影已校验的可见事实；表格动态列和值不得因字段名像内部元数据而被删掉。 */
export function projectPresentationContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectPresentationContent);
  if (!record(value)) return value;
  if (value.type === 'text') return { type: 'text', text: value.text };
  if (!isComponentKind(value.type)) return value;
  const part = structuredClone(value);
  if (!record(part.props)) return { type: part.type, props: part.props };
  if (part.type === 'SubjectCards' || part.type === 'Gallery') {
    if (Array.isArray(part.props.items)) part.props.items = part.props.items.map(item => {
      if (!record(item)) return item;
      const { image: _image, url: _url, summary: _summary, ...facts } = item;
      return facts;
    });
  }
  return { type: part.type, props: part.props };
}
function resultFingerprint(pair: ToolPair): string {
  return JSON.stringify({ call: pair.call, id: pair.result.toolCallId, name: pair.result.toolName,
    timestamp: pair.result.timestamp, isError: pair.result.isError, content: pair.result.content });
}

function pairedTools(messages: readonly Message[]): ToolPair[] {
  const result: ToolPair[] = [];
  let pending = new Map<string, { call: ToolCall; messageIndex: number; contentIndex: number; results: number[] }>();
  const flush = (): void => {
    for (const row of pending.values()) {
      if (row.results.length !== 1) continue;
      const resultIndex = row.results[0]!, response = messages[resultIndex];
      if (response?.role === 'toolResult' && response.toolName === row.call.name) result.push({ ...row, resultIndex, result: response });
    }
    pending = new Map();
  };
  for (const [index, message] of messages.entries()) {
    if (message.role === 'assistant') {
      flush();
      const duplicateIds = new Set<string>();
      for (const [contentIndex, call] of message.content.entries()) {
        if (call.type !== 'toolCall') continue;
        if (pending.has(call.id)) { duplicateIds.add(call.id); continue; }
        pending.set(call.id, { call, messageIndex: index, contentIndex, results: [] });
      }
      for (const id of duplicateIds) pending.delete(id);
    } else if (message.role === 'user') flush();
    else if (message.role === 'toolResult') pending.get(message.toolCallId)?.results.push(index);
  }
  flush(); return result;
}
function resultComplete(result: ToolResultMessage): boolean {
  if (result.isError) return false;
  if (!result.content.length) return false;
  const incomplete = new Set(['unknown', 'pending', 'running', 'open', 'partial', 'incomplete', 'aborted', 'cancelled', 'error', 'failed']);
  for (const part of result.content) {
    if (part.type !== 'text') return false;
    let value: unknown;
    try { value = JSON.parse(part.text); } catch { return false; }
    if (!record(value) || Object.hasOwn(value, 'error')) return false;
    const state = record(value.value) ? value.value : value;
    if (['state', 'status', 'submissionState'].some(key => typeof state[key] === 'string' && incomplete.has(state[key] as string))) return false;
  }
  return true;
}
/** 文本可被定位不等于操作成功；错误信封必须可解释，不能借坏结果赋予来源资格。 */
function textSourceOutcome(result: ToolResultMessage): TextSourceOutcome | undefined {
  if (resultComplete(result)) return 'ok';
  if (!result.content.length) return;
  let failed = false, unfinished = false;
  const states = new Set(['unknown', 'pending', 'running', 'open', 'partial', 'incomplete', 'aborted', 'cancelled', 'error', 'failed']);
  for (const part of result.content) {
    if (part.type !== 'text') return;
    let value: unknown;
    try { value = JSON.parse(part.text); } catch { return; }
    if (!record(value)) return;
    if (Object.hasOwn(value, 'error')) {
      const error = value.error;
      if (!record(error) || typeof error.code !== 'string' || !error.code.trim()
        || error.message !== undefined && typeof error.message !== 'string' || !result.isError) return;
      failed = true;
    }
    const row = record(value.value) ? value.value : value;
    for (const key of ['state', 'status', 'submissionState']) {
      if (typeof row[key] !== 'string' || !states.has(row[key] as string)) continue;
      if (['error', 'failed'].includes(row[key] as string)) failed = true;
      else unfinished = true;
    }
  }
  if (failed) return 'error';
  return unfinished ? 'unknown' : undefined;
}
/** 不透明思考可能绑定其后原生 item；工具签名直接绑定调用，不能靠删签名绕过。 */
function signedGroup(message: AssistantMessage): boolean {
  return message.content.some(part => part.type === 'toolCall' && !!part.thoughtSignature
    || part.type === 'thinking' && (!!part.redacted || !!part.thinkingSignature
      && !['reasoning', 'reasoning_content', 'reasoning_text'].includes(part.thinkingSignature)));
}
function findTextSources(value: unknown, reference: Row, path: string, result: TextSource[]): void {
  if (!record(value)) return;
  // 只认参数上的明确创作字符串；错误类型里的嵌套text与facts都不充当创作文字。
  for (const key of ['text', 'before', 'after', 'detail', 'title']) {
    const text = value[key];
    if (typeof text === 'string') result.push({ text, reference: { ...reference, path: `${path}/${key}` } });
  }
}
function referenceExistingText(value: unknown, sources: readonly TextSource[], used: Row[]): unknown {
  if (Array.isArray(value)) return value.map(part => referenceExistingText(part, sources, used));
  if (!record(value)) return value;
  if (value.type === 'text' && typeof value.text === 'string') {
    const source = sources.find(item => item.text === value.text);
    if (source) used.push(source.reference);
    return source ? { type: 'text', source: source.reference } : value;
  }
  if (!isComponentKind(value.type)) return value;
  const props = record(value.props) ? { ...value.props } : value.props;
  // 仅把明确由原调用/文字表达的创作字段换成定位，不替换表格/统计等可见事实。
  if (record(props)) for (const key of ['text', 'detail', 'title']) {
    if (typeof props[key] !== 'string') continue;
    const source = sources.find(item => item.text === props[key]);
    if (source) { props[key] = { source: source.reference }; used.push(source.reference); }
  }
  return { ...value, props };
}

/** 位置只依据实际保留的工具名/出现序号或目标API的助手文本位置，不依赖会变化的消息索引和call ID。 */
function locateSources(base: TranscriptContext, rewritten: ReadonlyMap<number, AssistantMessage>, removedResults: ReadonlySet<number>,
  summaryIndices: readonly number[], sources: readonly TextSource[], model?: Model<Api>): TextSource[] {
  const originals = new Map<object, AssistantMessage[]>();
  const byIndex = new Map<number, AssistantMessage>();
  const planned = base.messages.flatMap<Message>((message, index) => {
    if (removedResults.has(index)) return [];
    const next = rewritten.get(index) ?? message;
    if (next.role !== 'assistant') return [next];
    const plan = summaryIndices.includes(index) ? { ...next, content: [...next.content, { type: 'text' as const, text: '历史摘要定位占位' }] } : next;
    if (!plan.content.length) return [];
    if (plan.diagnostics && !['error', 'aborted'].includes(plan.stopReason)) {
      const list = originals.get(plan.diagnostics) ?? []; list.push(plan); originals.set(plan.diagnostics, list);
    }
    byIndex.set(index, plan);
    return [plan];
  });
  const transformed = model ? transformMessages(planned, model) : planned;
  const toolCounts = new Map<string, number>(), toolLocations = new Map<object, Row>(), textLocations = new Map<object, Row>();
  const responseApis = new Set(['openai-responses', 'azure-openai-responses', 'openai-codex-responses']);
  let user = 0, assistantResponse = 0, assistantTextItem = 0;
  for (const message of transformed) {
    if (message.role === 'user') {
      const visible = typeof message.content === 'string' || message.content.some(part => part.type !== 'text'
        || (model?.api === 'openai-completions' ? part.text.length > 0 : true));
      if (visible) { user++; assistantResponse = 0; assistantTextItem = 0; }
      continue;
    }
    if (message.role !== 'assistant' || ['error', 'aborted'].includes(message.stopReason)) continue;
    const original = message.diagnostics && originals.get(message.diagnostics)?.shift();
    const originalCalls = original?.content.filter(part => part.type === 'toolCall') ?? [];
    let callIndex = 0;
    for (const part of message.content) if (part.type === 'toolCall') {
      const occurrence = (toolCounts.get(part.name) ?? 0) + 1; toolCounts.set(part.name, occurrence);
      const originalCall = originalCalls[callIndex++];
      if (originalCall) toolLocations.set(originalCall, { kind: 'tool_arguments', toolName: part.name, occurrence });
    }
    if (!model || !(model.api === 'openai-completions' || responseApis.has(model.api))) continue;
    const chat = model.api === 'openai-completions';
    const prefix = chat && model.compat && 'requiresThinkingAsText' in model.compat && model.compat.requiresThinkingAsText
      ? message.content.filter(part => part.type === 'thinking' && part.thinking.trim()).map(part => part.type === 'thinking' ? part.thinking : '').join('\n\n') : '';
    const renderedTexts = message.content.filter(part => part.type === 'text' && (!chat || part.text.trim()));
    if (chat && (prefix || renderedTexts.length || message.content.some(part => part.type === 'toolCall'))) assistantResponse++;
    if (!original) { if (!chat) assistantTextItem += renderedTexts.length; continue; }
    let offset = prefix.length;
    for (const part of original.content) {
      const converted = transformMessages([{ ...original, content: [part] }], model).find(value => value.role === 'assistant');
      const texts = converted?.role === 'assistant' ? converted.content.filter(value => value.type === 'text' && (!chat || value.text.trim())) : [];
      for (const value of texts) {
        if (value.type !== 'text') continue;
        if (!chat) assistantTextItem++;
        if (part.type === 'text') textLocations.set(part, chat
          ? { kind: 'assistant_text', api: model.api, afterUser: user, assistantResponse, start: offset, length: value.text.length }
          : { kind: 'assistant_text', api: model.api, afterUser: user, assistantTextItem, start: 0, length: value.text.length });
        offset += value.text.length;
      }
    }
  }
  return sources.flatMap(source => {
    const message = byIndex.get(source.reference.sourceMessage as number);
    const part = message?.content[source.reference.contentIndex as number];
    if (!part) return [];
    const location = part.type === 'toolCall' ? toolLocations.get(part) : textLocations.get(part);
    const outcome = source.reference.operationOutcome;
    const supported = !!model && (model.api === 'openai-completions' || responseApis.has(model.api));
    if ((outcome === 'error' || outcome === 'unknown') && !supported) return [];
    return location ? [{ text: source.text, reference: { ...location, ...(part.type === 'toolCall'
      ? { argumentPointer: source.reference.path, operationOutcome: outcome } : {}) } }] : [];
  });
}

function historyNote(source: AssistantMessage, text: string): AssistantMessage {
  return { role: 'assistant', api: source.api, provider: source.provider, model: source.model,
    timestamp: source.timestamp, usage: source.usage, stopReason: 'stop', content: [{ type: 'text', text }] };
}

/** 只改变单次请求投影，成功展示按调用/结果成对归并；审计消息本身不变。 */
export function projectPresentationHistory(context: TranscriptContext, base = context, keepTexts: ReadonlySet<object> = new Set(),
  observe?: (audit: PresentationHistoryAudit) => void): TranscriptContext {
  const binding = histories.get(context) ?? histories.get(context.messages);
  if (!binding) return base;
  const pairs = pairedTools(context.messages);
  const groups = new Map<string, number[]>();
  for (const [index, message] of context.messages.entries()) {
    const source = sourceOf(message), snapshot = source && binding.snapshots.get(source.replyId);
    if (!source || !snapshot || source.turnId !== snapshot.turnId) continue;
    const group = groups.get(source.replyId) ?? []; group.push(index); groups.set(source.replyId, group);
  }
  const eligible = new Map<string, number[]>();
  const audits = new Map<string, PresentationHistoryAudit>();
  for (const snapshot of binding.snapshots.values()) audits.set(snapshot.replyId, { replyId: snapshot.replyId, turnId: snapshot.turnId,
    sourceComplete: false, foldedCallCount: 0, retainedSignedCallCount: 0, summaryInjected: false, textSourceRefs: [] });
  for (const [replyId, indices] of groups) {
    const expected = binding.sources.get(replyId);
    const first = indices[0]!, last = indices.at(-1)!;
    const crossesUser = context.messages.slice(first + 1, last).some(message => message.role === 'user');
    const groupPairs = pairs.filter(pair => indices.includes(pair.messageIndex));
    const callCount = indices.reduce((total, index) => { const message = context.messages[index];
      return total + (message?.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall').length : 0); }, 0);
    const expectedResults = binding.resultKeys.get(replyId) ?? [];
    const resultsComplete = callCount === groupPairs.length && expectedResults.length === groupPairs.length
      && groupPairs.every((pair, offset) => resultFingerprint(pair) === expectedResults[offset]);
    if (!crossesUser && resultsComplete && expected?.length === indices.length && indices.every((index, offset) => {
      const message = context.messages[index]; return message?.role === 'assistant' && sourceFingerprint(message) === expected[offset];
    })) { eligible.set(replyId, indices); audits.get(replyId)!.sourceComplete = true; }
  }
  if (!eligible.size) { for (const audit of audits.values()) observe?.(audit); return base; }
  const removedCalls = new Map<number, Set<number>>(), removedResults = new Set<number>();
  const rewritten = new Map<number, AssistantMessage>();
  const summaries: { index: number; snapshot: PresentationSnapshot; sources: TextSource[] }[] = [];
  const extraNotes = new Map<number, AssistantMessage[]>();
  for (const [replyId, indices] of eligible) {
    const snapshot = binding.snapshots.get(replyId)!;
    const protectedIndices = new Set(indices.filter(index => {
      const message = context.messages[index]; return message?.role === 'assistant' && signedGroup(message);
    }));
    const group = new Set(indices);
    const audit = audits.get(replyId)!;
    audit.retainedSignedCallCount = indices.flatMap(index => {
      const message = context.messages[index];
      return protectedIndices.has(index) && message?.role === 'assistant'
        ? message.content.filter(part => part.type === 'toolCall' && binding.toolRoles.get(part.name) === 'presentation') : [];
    }).length;
    if (snapshot.status === 'completed') for (const pair of pairs) {
      const sourceMessage = context.messages[pair.messageIndex];
      if (!group.has(pair.messageIndex) || protectedIndices.has(pair.messageIndex) || binding.toolRoles.get(pair.call.name) !== 'presentation'
        || sourceMessage?.role !== 'assistant' || !['stop', 'toolUse'].includes(sourceMessage.stopReason) || !resultComplete(pair.result)) continue;
      const removed = removedCalls.get(pair.messageIndex) ?? new Set(); removed.add(pair.contentIndex); removedCalls.set(pair.messageIndex, removed);
      removedResults.add(pair.resultIndex);
      audit.foldedCallCount++;
    }
    const sources: TextSource[] = [];
    for (const index of indices) {
      const message = base.messages[index]; if (message?.role !== 'assistant') continue;
      const removed = removedCalls.get(index);
      const preserveWhole = snapshot.status !== 'completed' || protectedIndices.has(index);
      let content = message.content.filter((part, contentIndex) => {
        if (removed?.has(contentIndex)) return false;
        if (part.type === 'text') return preserveWhole || !!part.textSignature || keepTexts.has(part);
        return true;
      });
      // 展示调用已归并时，其引用说明也不再留作第二份过程；混合同批仍说明真正保留的业务引用。
      const remainingRefs = new Set<string>();
      for (const part of content) if (part.type === 'toolCall') referenceFields(part.arguments, remainingRefs);
      content = content.flatMap(part => {
        if (part.type !== 'text' || !keepTexts.has(part)) return [part];
        const refs = (JSON.parse(part.text.slice(HISTORY_REFERENCE_NOTE_PREFIX.length)) as string[]).filter(ref => remainingRefs.has(ref));
        return refs.length ? [{ ...part, text: HISTORY_REFERENCE_NOTE_PREFIX + JSON.stringify(refs) }] : [];
      });
      for (const [contentIndex, part] of content.entries()) {
        if (part.type === 'text' && ['stop', 'toolUse'].includes(message.stopReason)) sources.push({ text: part.text, reference: { sourceMessage: index, contentIndex } });
        else if (part.type === 'toolCall' && binding.toolRoles.get(part.name) === 'presentation') {
          const pair = pairs.find(pair => pair.messageIndex === index && pair.call.id === part.id);
          const outcome = pair && textSourceOutcome(pair.result);
          if (outcome) findTextSources(part.arguments, { sourceMessage: index, contentIndex, operationOutcome: outcome }, '', sources);
        }
      }
      // Chat兼容转换会丢弃仅thinking的消息；加无正文语义的定位保持思考原位。
      const onlyThinking = content.length > 0 && !content.some(part => part.type !== 'thinking');
      if (onlyThinking) content.push({ type: 'text', text: '历史展示步骤已归并，正文见本回合展示摘要。' });
      rewritten.set(index, { ...message, content });
    }
    summaries.push({ index: indices.at(-1)!, snapshot, sources });
  }
  for (const { index, snapshot, sources } of summaries) {
    const audit = audits.get(snapshot.replyId)!;
    const content = referenceExistingText(projectPresentationContent(snapshot.content), locateSources(base, rewritten, removedResults, summaries.map(row => row.index),
      sources, binding.model), audit.textSourceRefs);
    const text = `历史已展示回答摘要（status=${snapshot.status}，按真实阅读顺序）：${JSON.stringify(content)}`;
    const target = rewritten.get(index)!;
    if (['error', 'aborted'].includes(target.stopReason)) {
      // Pi会跳过错误/取消消息；另放明确标注未完成的历史数据，不伪造原响应成功或改签名。
      const after = Math.max(index, ...pairs.filter(pair => eligible.get(snapshot.replyId)!.includes(pair.messageIndex)).map(pair => pair.resultIndex));
      const note = historyNote(target, text);
      if (target.errorMessage) note.content.push({ type: 'text', text: `原生未完成反馈：${JSON.stringify({ stopReason: target.stopReason,
        errorMessage: redact(target.errorMessage, credentialValues()) })}` });
      const notes = extraNotes.get(after) ?? []; notes.push(note); extraNotes.set(after, notes);
    } else target.content.push({ type: 'text', text });
    audit.summaryInjected = true;
  }
  for (const audit of audits.values()) observe?.(audit);
  return { ...base, messages: base.messages.flatMap((message, index) => {
    if (removedResults.has(index)) return [];
    const next = rewritten.get(index) ?? message;
    return [...(next.role === 'assistant' && !next.content.length ? [] : [next]), ...(extraNotes.get(index) ?? [])];
  }) };
}

/** 仅离线复算不含正文的决策证据；不往模型请求、JSONL或Web注入审计字段。 */
export function inspectPresentationHistory(context: TranscriptContext, base = context, keepTexts: ReadonlySet<object> = new Set()): PresentationHistoryAudit[] {
  const audit: PresentationHistoryAudit[] = [];
  projectPresentationHistory(context, base, keepTexts, value => audit.push(structuredClone(value)));
  return audit;
}
