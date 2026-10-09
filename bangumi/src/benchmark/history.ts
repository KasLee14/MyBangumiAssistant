import { traceHash } from '../tracing/redact.js';
import { record } from './schema.js';
import { COMPONENT_KINDS } from '../output/content-schema.js';

export interface CanonicalTextSource { userTurn: number; replyId: string; partIndex: number; text: string }
export interface HistoryTextRepresentations { raw: number; jsonEncoded: number }
export interface HistoryTextOccurrence {
  sourceUserTurn: number; replyId: string; partIndex: number; textHash: string; textBytes: number;
  nativeOccurrences: number; displayArgumentOccurrences: number; otherOccurrences: number;
  nativeRepresentations: HistoryTextRepresentations; displayArgumentRepresentations: HistoryTextRepresentations;
  otherRepresentations: HistoryTextRepresentations;
  signedFallback: boolean | null;
}
const renderNames = new Set(COMPONENT_KINDS.map(kind => `render_${kind}`));
const displayTool = (name: string) => name === 'present_text' || renderNames.has(name);
interface Span { start: number; end: number }
function spans(value: string, text: string): Span[] {
  const found: Span[] = [];
  if (!text) return found;
  let offset = 0;
  while ((offset = value.indexOf(text, offset)) >= 0) {
    found.push({ start: offset, end: offset + text.length }); offset += text.length;
  }
  return found;
}
function representations(value: string, text: string): HistoryTextRepresentations {
  const tokens: (Span & { matched: boolean })[] = [], encoded: Span[] = [];
  // 先解出完整JSON字面量，再按完整正文定位；不能把字面\\n当成换行的转义证明。
  for (const match of value.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    const token = match[0], start = match.index;
    let decoded: unknown;
    try { decoded = JSON.parse(token); } catch { continue; }
    if (typeof decoded !== 'string') continue;
    const boundary = { start, end: start + token.length, matched: false };
    tokens.push(boundary);
    // 只证明实际JSON.stringify表示，不把其它等价或猜测的编码算成已观察正文。
    if (JSON.stringify(decoded) !== token) continue;
    for (const span of spans(decoded, text)) {
      const prefix = JSON.stringify(decoded.slice(0, span.start)).slice(1, -1);
      const form = JSON.stringify(text).slice(1, -1);
      const encodedStart = start + 1 + prefix.length;
      if (value.slice(encodedStart, encodedStart + form.length) === form) {
        encoded.push({ start: encodedStart, end: encodedStart + form.length });
        boundary.matched = true;
      }
    }
  }
  const raw = spans(value, text).filter(span => !tokens.some(token => span.start >= token.start + (token.matched ? 0 : 1)
    && span.end <= token.end - (token.matched ? 0 : 1))
    && !encoded.some(other => span.start < other.end && other.start < span.end));
  return { raw: raw.length, jsonEncoded: encoded.length };
}
function sumRepresentations(values: string[], text: string): HistoryTextRepresentations {
  return values.reduce((sum, value) => {
    const observed = representations(value, text);
    return { raw: sum.raw + observed.raw, jsonEncoded: sum.jsonEncoded + observed.jsonEncoded };
  }, { raw: 0, jsonEncoded: 0 });
}

/** 只核对同一实际请求中的已完成正文；跨请求历史重发在metrics另计，不当作投影错误。 */
export function inspectHistoryOccurrences(payload: unknown, sources: CanonicalTextSource[],
  signedByReply: ReadonlyMap<string, boolean> = new Map()): HistoryTextOccurrence[] {
  const root = record(payload), messages = Array.isArray(root.messages) ? root.messages : Array.isArray(root.input) ? root.input : [];
  const native: string[] = [], arguments_: string[] = [], other: string[] = [];
  const textParts = (content: unknown, target: string[]): void => {
    if (typeof content === 'string') target.push(content);
    else if (Array.isArray(content)) for (const part of content) {
      const item = record(part);
      if (['text', 'output_text', 'input_text'].includes(String(item.type)) && typeof item.text === 'string') target.push(item.text);
    }
  };
  const call = (name: string, args: unknown): void => {
    if (!displayTool(name)) return;
    let value = args;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return; } }
    const data = record(value);
    for (const key of name === 'present_text' ? ['text'] : ['before', 'after']) if (typeof data[key] === 'string') arguments_.push(String(data[key]));
  };
  for (const message of messages) {
    const row = record(message);
    if (row.role === 'assistant') textParts(row.content, native);
    else textParts(row.content, other);
    for (const tool of Array.isArray(row.tool_calls) ? row.tool_calls : []) {
      const fn = record(record(tool).function); call(String(fn.name), fn.arguments);
    }
    if (row.type === 'function_call') call(String(row.name), row.arguments);
  }
  return sources.map(source => {
    const nativeRepresentations = sumRepresentations(native, source.text);
    const displayArgumentRepresentations = sumRepresentations(arguments_, source.text);
    const otherRepresentations = sumRepresentations(other, source.text);
    return { sourceUserTurn: source.userTurn, replyId: source.replyId, partIndex: source.partIndex,
    textHash: traceHash(source.text), textBytes: Buffer.byteLength(source.text),
    nativeOccurrences: nativeRepresentations.raw + nativeRepresentations.jsonEncoded,
    displayArgumentOccurrences: displayArgumentRepresentations.raw + displayArgumentRepresentations.jsonEncoded,
    otherOccurrences: otherRepresentations.raw + otherRepresentations.jsonEncoded,
    nativeRepresentations, displayArgumentRepresentations, otherRepresentations,
    signedFallback: signedByReply.get(source.replyId) ?? null };
  });
}
