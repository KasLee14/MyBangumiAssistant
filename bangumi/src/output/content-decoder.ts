import {
  ContentOutputError, MAX_CONTENT_BYTES, MAX_CONTENT_PARTS,
  normalizePartialComponentProps, validateMixedContent, validateMixedPart,
  isComponentKind, isContentKind,
  type MixedContent, type MixedPart, type TextPart, type CompleteComponentPart, type ComponentKind,
} from './content-schema.js';
import { normalizeProviderContent, normalizeProviderPart, normalizeProviderReferenceProps, projectProviderComponentProps, type OutputAdjustment } from './provider-content.js';
import { deriveNextTypes } from './content-normalize.js';
import type { FailureScope } from './recovery-checkpoint.js';
import { credentialValues, redact } from '../support/errors.js';
import { isResourceReference, type ResourceReferenceProps } from './resource-content.js';

export type ContentDelta =
  | { type: 'text'; index: number; delta: string }
  | { type: 'text_end'; index: number; part: TextPart }
  | { type: 'update'; index: number; part: MixedPart }
  | { type: 'component'; index: number; part: CompleteComponentPart };

type Path = (string | number)[];
type ObjectFrame = { kind: 'object'; path: Path; value: Record<string, unknown>; keys: Set<string>; key: string; state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd' };
type ArrayFrame = { kind: 'array'; path: Path; value: unknown[]; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };
type Frame = ObjectFrame | ArrayFrame;
type Token =
  | { kind: 'string'; path: Path; key: boolean; value: string; escape: boolean; unicode: string | null }
  | { kind: 'number' | 'literal'; value: string; path: Path };

const isSpace = (char: string): boolean => /[\x20\t\r\n]/.test(char);
const isPartPath = (path: Path): boolean => path.length === 2 && path[0] === 'content' && typeof path[1] === 'number';
const clone = <T>(value: T): T => structuredClone(value);

/** 每个模型响应创建一个实例。只解码文字通道，不接收工具参数或思考增量。 */
export class ContentDecoder {
  private readonly mode: 'provider' | 'canonical';
  private readonly frames: Frame[] = [];
  private token: Token | null = null;
  private raw = '';
  private byteLength = 0;
  private position = 0;
  private root: unknown;
  private rootComplete = false;
  private ended = false;
  private failure: Error | null = null;
  private readonly parts: MixedPart[] = [];
  private readonly predicted = new Map<number, ComponentKind>();
  private readonly adjustments: OutputAdjustment[] = [];
  private completedCount = 0;
  private readonly emittedText = new Map<number, number>();
  private output: ContentDelta[] = [];
  private readonly references = new Map<number, { kind: ComponentKind; props: ResourceReferenceProps }>();
  resourceReferences(): [number, { kind: ComponentKind; props: ResourceReferenceProps }][] { return structuredClone([...this.references]); }

  constructor(options: { mode?: 'provider' | 'canonical' } = {}) {
    this.mode = options.mode ?? 'provider';
  }

  feed(delta: string): ContentDelta[] {
    this.assertActive();
    this.output = [];
    try {
      // 分片可能正好拆开 UTF-16 代理对，合并后的 UTF-8 字节数需扣回两字节。
      const previous = this.raw.charCodeAt(this.raw.length - 1);
      const first = delta.charCodeAt(0);
      this.byteLength += Buffer.byteLength(delta, 'utf8');
      if (previous >= 0xd800 && previous <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) this.byteLength -= 2;
      if (this.byteLength > MAX_CONTENT_BYTES) this.fail('size', '混合内容响应超过字节上限');
      this.raw += delta;
      for (const char of delta.split('')) { this.position++; this.consume(char); }
      // 一个 provider delta 内的文字合并交付，避免逐字符切片导致长正文二次方开销。
      this.syncText();
      return this.output.map(clone);
    } catch (error) {
      this.failure = this.locate(error);
      throw this.failure;
    }
  }

  /** 有序快照包括提前占位、已闭合 props 字段及可安全展示的文字。 */
  snapshot(): MixedContent {
    const content = [...this.parts];
    for (const [index, kind] of this.predicted) if (!content[index]) content[index] = kind === 'TagCloud'
      ? { type: kind, pending: true, props: [] } : { type: kind, pending: true, props: {} };
    return clone({ content });
  }
  normalizationAdjustments(): OutputAdjustment[] { return clone(this.adjustments); }
  private adjustment(value: OutputAdjustment): void {
    if (this.adjustments.length < 8 && !this.adjustments.some(item => item.path === value.path && item.rule === value.rule))
      this.adjustments.push({ ...value, path: redact(value.path, credentialValues()).slice(0, 300) });
  }
  diagnosticState(): { bytes: number; completedParts: number; jsonComplete: boolean } {
    return { bytes: this.byteLength, completedParts: this.completedCount, jsonComplete: this.rootComplete && this.frames.length === 0 && this.token === null };
  }
  /** 正文交付边界：字符串、字段草稿和预测占位只留在解析器内部。 */
  completedParts(): MixedPart[] { return clone(this.parts.slice(0, this.completedCount)); }
  recoveryCheckpoint(): { prefix: MixedPart[]; draft?: unknown; jsonComplete: boolean; failureScope: FailureScope; failedPartIndex?: number } {
    let draft: unknown;
    try { draft = (JSON.parse(this.raw) as { content?: unknown[] }).content?.[this.completedCount]; }
    catch { draft = this.parts[this.completedCount] ?? this.frames.find(frame => isPartPath(frame.path) && frame.path[1] === this.completedCount)?.value; }
    const error = this.failure instanceof ContentOutputError ? this.failure : undefined;
    const path = error?.issueDetails[0]?.path ?? '';
    const failedPartIndex = Number(path.match(/^\/content\/(\d+)(?:\/|$)/)?.[1]);
    const failureScope: FailureScope = error?.code === 'size' ? 'capacity' : error?.code === 'syntax' || error?.code === 'truncated' ? 'json'
      : Number.isInteger(failedPartIndex) ? 'part' : error?.reason === 'content_envelope_invalid' ? 'envelope' : 'host';
    return { prefix: clone(this.parts.slice(0, this.completedCount)), jsonComplete: this.diagnosticState().jsonComplete, failureScope,
      ...(Number.isInteger(failedPartIndex) ? { failedPartIndex } : {}),
      ...(draft === undefined ? {} : { draft: clone(draft) }) };
  }
  private locate(error: unknown): Error {
    if (error instanceof ContentOutputError && !error.location) {
      const before = this.raw.slice(0, this.position), lines = before.split('\n');
      error.location = { offset: this.position, line: lines.length, column: lines.at(-1)!.length + 1 };
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  finish(): MixedContent {
    this.assertActive();
    try {
      if (!this.raw.trim()) throw new ContentOutputError('模型没有生成有效正文。', 'schema', [],
        [{ path: '/content', rule: 'empty_output', message: '正文为空或仅包含空白' }], 'empty_output');
      if (this.token?.kind === 'number' || this.token?.kind === 'literal') this.finishScalar();
      if (this.token || this.frames.length || !this.rootComplete) this.fail('incomplete', '混合内容 JSON 未完整结束');
      const answer = this.mode === 'provider' ? normalizeProviderContent(this.root, adjustment => this.adjustment(adjustment)) : validateMixedContent(this.root);
      const actual = this.mode === 'provider' ? deriveNextTypes(this.parts.slice(0, this.completedCount)) : this.parts;
      if (this.completedCount !== answer.content.length || JSON.stringify(answer.content) !== JSON.stringify(actual)) this.fail('schema', '增量结果与完整响应不一致');
      this.parts.splice(0, this.parts.length, ...answer.content);
      this.predicted.clear();
      this.ended = true;
      return clone(answer);
    } catch (error) {
      this.failure = this.locate(error);
      throw this.failure;
    }
  }

  private assertActive(): void {
    if (this.failure) throw this.failure;
    if (this.ended) this.fail('parse', '混合内容响应已结束');
  }

  private fail(code: string, message: string): never {
    const category = code === 'parse' ? 'syntax' : code === 'incomplete' ? 'truncated' : code;
    const reason = code === 'incomplete' ? 'json_unclosed' : code === 'parse' ? 'json_syntax_invalid'
      : code === 'size' ? message.includes('嵌套') ? 'json_nesting_limit' : message.includes('字节') ? 'content_bytes_limit' : 'content_parts_limit'
      : 'schema_invalid';
    throw new ContentOutputError(message, category as 'schema' | 'size' | 'syntax' | 'truncated', [],
      [{ path: this.valuePath().map(value => `/${String(value)}`).join(''), rule: reason, message }], reason);
  }

  private consume(char: string): void {
    const token = this.token;
    if (token?.kind === 'string') {
      this.consumeString(token, char);
      return;
    }
    if (token) {
      if (token.kind === 'number' ? /[0-9eE+\-.]/.test(char) : /[a-z]/.test(char)) {
        token.value += char;
        return;
      }
      this.finishScalar();
      this.consume(char);
      return;
    }
    if (isSpace(char)) return;
    const frame = this.frames.at(-1);
    if (frame?.kind === 'object') {
      if (frame.state === 'keyOrEnd' || frame.state === 'key') {
        if (char === '}' && frame.state === 'keyOrEnd') return this.closeFrame();
        if (char !== '"') this.fail('parse', 'JSON 对象需要字段名');
        this.token = { kind: 'string', key: true, path: frame.path, value: '', escape: false, unicode: null };
        return;
      }
      if (frame.state === 'colon') {
        if (char !== ':') this.fail('parse', 'JSON 字段缺少冒号');
        frame.state = 'value';
        return;
      }
      if (frame.state === 'commaOrEnd') {
        if (char === '}') return this.closeFrame();
        if (char !== ',') this.fail('parse', 'JSON 对象缺少分隔符');
        frame.state = 'key';
        return;
      }
    } else if (frame?.kind === 'array') {
      if (frame.state === 'commaOrEnd') {
        if (char === ']') return this.closeFrame();
        if (char !== ',') this.fail('parse', 'JSON 数组缺少分隔符');
        frame.state = 'value';
        return;
      }
      if (char === ']' && frame.state === 'valueOrEnd') return this.closeFrame();
    } else if (this.rootComplete) this.fail('parse', 'JSON 根对象之后包含额外内容');

    const path = this.valuePath();
    if (isPartPath(path) && Number(path[1]) >= MAX_CONTENT_PARTS) this.fail('size', '混合内容块超过数量上限');
    if (char === '{' || char === '[') {
      if (this.frames.length >= 64) this.fail('size', 'JSON 嵌套超过上限');
      this.frames.push(char === '{'
        ? { kind: 'object', path, value: Object.create(null), keys: new Set(), key: '', state: 'keyOrEnd' }
        : { kind: 'array', path, value: [], state: 'valueOrEnd' });
    } else if (char === '"') {
      this.token = { kind: 'string', key: false, path, value: '', escape: false, unicode: null };
    } else if (char === '-' || /[0-9]/.test(char)) {
      this.token = { kind: 'number', path, value: char };
    } else if (char === 't' || char === 'f' || char === 'n') {
      this.token = { kind: 'literal', path, value: char };
    } else this.fail('parse', `JSON 中出现非法字符 ${JSON.stringify(char)}`);
  }

  private consumeString(token: Extract<Token, { kind: 'string' }>, char: string): void {
    if (token.unicode !== null) {
      if (!/[0-9a-fA-F]/.test(char)) this.fail('parse', 'JSON Unicode 转义不合法');
      token.unicode += char;
      if (token.unicode.length === 4) {
        token.value += String.fromCharCode(Number.parseInt(token.unicode, 16));
        token.unicode = null;
      }
      return;
    }
    if (token.escape) {
      token.escape = false;
      if (char === 'u') { token.unicode = ''; return; }
      const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      const decoded = escapes[char];
      if (decoded === undefined) this.fail('parse', 'JSON 字符串转义不合法');
      token.value += decoded;
      return;
    }
    if (char === '\\') { token.escape = true; return; }
    if (char === '"') {
      this.token = null;
      if (token.key) {
        const frame = this.frames.at(-1);
        if (frame?.kind !== 'object') this.fail('parse', 'JSON 字段名不在对象中');
        if (frame.keys.has(token.value)) this.fail('parse', `JSON 包含重复字段 ${token.value}`);
        frame.keys.add(token.value);
        frame.key = token.value;
        frame.state = 'colon';
      } else this.attach(token.value);
      return;
    }
    if (char.charCodeAt(0) < 0x20) this.fail('parse', 'JSON 字符串包含未转义控制字符');
    token.value += char;
  }

  private finishScalar(): void {
    const token = this.token;
    if (!token || token.kind === 'string') this.fail('parse', 'JSON 标量状态不合法');
    if (token.kind === 'number' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.value)) this.fail('parse', 'JSON 数字不合法');
    if (token.kind === 'literal' && !['true', 'false', 'null'].includes(token.value)) this.fail('parse', 'JSON 常量不合法');
    const value: unknown = JSON.parse(token.value);
    if (typeof value === 'number' && !Number.isFinite(value)) this.fail('parse', 'JSON 数字超出有限值范围');
    this.token = null;
    this.attach(value);
  }

  private valuePath(): Path {
    const frame = this.frames.at(-1);
    return frame ? [...frame.path, frame.kind === 'object' ? frame.key : frame.value.length] : [];
  }

  private closeFrame(): void {
    const frame = this.frames.pop();
    if (!frame) this.fail('parse', 'JSON 闭合状态不合法');
    if (isPartPath(frame.path)) this.completePart(frame.path[1] as number, frame.value);
    this.attach(frame.value);
  }

  private attach(value: unknown): void {
    const frame = this.frames.at(-1);
    if (!frame) {
      this.root = value;
      this.rootComplete = true;
    } else if (frame.kind === 'object') {
      const path = [...frame.path, frame.key];
      frame.value[frame.key] = value;
      frame.state = 'commaOrEnd';
      // 仅完整顶层字段发布 props，嵌套对象/数组里的字段先留在解析栈中。
      if ((path.length === 3 && path[0] === 'content') ||
          (path.length === 4 && path[0] === 'content' && path[2] === 'props')) this.syncPart();
    } else {
      frame.value.push(value);
      frame.state = 'commaOrEnd';
    }
  }

  private syncText(): void {
    const frame = this.frames.findLast((item): item is ObjectFrame => item.kind === 'object' && isPartPath(item.path));
    if (!frame || frame.value.type !== 'text') return;
    this.syncTextFrame(frame);
  }

  private syncTextFrame(frame: ObjectFrame): void {
    const token = this.token;
    const active = token?.kind === 'string' && !token.key && token.path.length === 3
      && token.path[0] === 'content' && token.path[1] === frame.path[1] && token.path[2] === 'text';
    const rawText = active ? token.value : frame.value.text;
    if (typeof rawText !== 'string') return;
    let text = rawText;
    if (active && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    const index = frame.path[1] as number;
    const part = this.parts[index];
    if (!part || part.type !== 'text') this.fail('schema', '文本块没有有效的序列位置');
    this.parts[index] = { ...part, text };
    const emitted = this.emittedText.get(index) ?? 0;
    if (text.length <= emitted) return;
    const delta = text.slice(emitted);
    this.emittedText.set(index, text.length);
    const last = this.output.at(-1);
    if (last?.type === 'text' && last.index === index) last.delta += delta;
    else this.output.push({ type: 'text', index, delta });
  }

  private assertIndex(index: number, type: MixedPart['type']): void {
    if (index !== this.completedCount) this.fail('schema', '内容块顺序不一致');
    const existing = this.parts[index];
    if (existing && existing.type !== type) this.fail('schema', `content[${index}] 与提前声明的组件类型不一致`);
    const previous = this.parts[index - 1];
    if (previous?.type === 'text' && previous.nextType !== type && this.mode === 'provider') {
      this.adjustment({ path: `/content/${index - 1}/nextType`, rule: 'derived_next_type' });
      this.update(index - 1, { ...previous, nextType: type });
    } else if (previous?.type === 'text' && previous.nextType !== type) {
      throw new ContentOutputError('nextType 与实际下一项类型不一致', 'schema', [],
        [{ path: `/content/${index - 1}/nextType`, rule: 'next_type', message: '声明的下一类型与实际内容不一致', expected: type }], 'next_type_mismatch');
    }
  }

  private update(index: number, part: MixedPart): void {
    if (index > this.parts.length) this.fail('schema', '内容块序列出现空缺');
    if (JSON.stringify(this.parts[index]) === JSON.stringify(part)) return;
    this.parts[index] = part;
    this.predicted.delete(index);
    this.output.push({ type: 'update', index, part: clone(part) });
  }

  private reserve(index: number, kind: ComponentKind): void {
    if (this.mode === 'provider') {
      if (index >= MAX_CONTENT_PARTS || this.parts[index]) return;
      if (this.predicted.get(index) === kind) return;
      this.predicted.set(index, kind);
      this.output.push({ type: 'update', index, part: kind === 'TagCloud'
        ? { type: kind, pending: true, props: [] } : { type: kind, pending: true, props: {} } });
      return;
    }
    if (index >= MAX_CONTENT_PARTS) this.fail('size', '提前声明的组件超过内容数量上限');
    const existing = this.parts[index];
    if (existing) {
      if (existing.type !== kind) this.fail('schema', '提前声明的组件与实际类型不一致');
      return;
    }
    if (kind === 'TagCloud') this.update(index, { type: kind, pending: true, props: [] });
    else this.update(index, { type: kind, pending: true, props: {} });
  }

  private syncPart(): void {
    const frame = this.frames.findLast((item): item is ObjectFrame => item.kind === 'object' && isPartPath(item.path));
    if (!frame || !Object.hasOwn(frame.value, 'type')) return;
    const kind = frame.value.type;
    if (!isContentKind(kind)) this.fail('schema', `未知内容类型 ${String(kind)}`);
    const index = frame.path[1] as number;
    this.assertIndex(index, kind);
    const allowed = kind === 'text' ? ['type', 'nextType', 'text'] : ['type', 'pending', 'props'];
    if (Object.keys(frame.value).some(key => !allowed.includes(key))) this.fail('schema', `content[${index}] 包含未知字段`);
    if (kind === 'text') {
      const declared = frame.value.nextType;
      const hasDeclared = Object.hasOwn(frame.value, 'nextType');
      if (hasDeclared && declared !== null && !isContentKind(declared)) {
        if (this.mode === 'canonical') this.fail('schema', 'nextType 必须是已知内容类型或 null');
        this.adjustment({ path: `/content/${index}/nextType`, rule: 'derived_next_type' });
      }
      const nextType = isContentKind(declared) ? declared : null;
      const previous = this.parts[index];
      this.update(index, { type: 'text', nextType, text: previous?.type === 'text' ? previous.text : '' });
      if (isComponentKind(nextType)) this.reserve(index + 1, nextType);
      this.syncTextFrame(frame);
      return;
    }
    const propsFrame = this.frames.findLast((item): item is ObjectFrame => item.kind === 'object'
      && item.path.length === 3 && item.path[0] === 'content' && item.path[1] === index && item.path[2] === 'props');
    const source = propsFrame?.value ?? (Object.hasOwn(frame.value, 'props') ? frame.value.props : kind === 'TagCloud' ? [] : {});
    let props;
    try {
      if (this.mode === 'provider' && isResourceReference(source)) {
        normalizeProviderReferenceProps(kind, source, true); props = kind === 'TagCloud' ? [] : {};
      } else {
        try { props = normalizePartialComponentProps(kind, this.mode === 'provider' ? projectProviderComponentProps(kind, source) : source); }
        catch (error) {
          // 引用键可以最后生成；仅接受另一套已声明的部分输入契约。
          if (this.mode !== 'provider' || source === null || typeof source !== 'object' || Array.isArray(source)) throw error;
          try { normalizeProviderReferenceProps(kind, source, true); props = kind === 'TagCloud' ? [] : {}; }
          catch { throw error; }
        }
      }
    } catch (error) { if (error instanceof ContentOutputError) throw error.at(`/content/${index}/props`); throw error; }
    // kind 和每个已闭合字段都已校验，pending 分支允许缺失尚在生成的顶层字段。
    this.update(index, { type: kind, pending: true, props } as MixedPart);
  }

  private completePart(index: number, value: unknown): void {
    let part;
    try { part = this.mode === 'provider' ? normalizeProviderPart(value, adjustment => this.adjustment({ ...adjustment, path: `/content/${index}${adjustment.path}` })) : validateMixedPart(value); }
    catch (error) { if (error instanceof ContentOutputError) throw error.at(`/content/${index}`); throw error; }
    this.assertIndex(index, part.type);
    if (part.type === 'text') {
      const emitted = this.emittedText.get(index) ?? 0;
      // 空文字块也占据序列位置，交付一次空增量让消费方能还原完整序列。
      if (emitted < part.text.length || !this.emittedText.has(index)) this.output.push({ type: 'text', index, delta: part.text.slice(emitted) });
      this.emittedText.set(index, part.text.length);
      this.output.push({ type: 'text_end', index, part: clone(part) });
      if (isComponentKind(part.nextType)) this.reserve(index + 1, part.nextType);
    } else {
      const raw = value as { props?: unknown };
      if (part.pending === true && this.mode === 'provider' && isResourceReference(raw.props)) {
        this.references.set(index, { kind: part.type, props: normalizeProviderReferenceProps(part.type, raw.props) });
        this.output.push({ type: 'update', index, part: clone(part) });
      } else {
        if (part.pending === true) this.fail('schema', '完整组件仍处于占位状态');
        this.output.push({ type: 'component', index, part: clone(part) });
      }
    }
    this.parts[index] = part;
    this.predicted.delete(index);
    this.completedCount++;
  }
}
