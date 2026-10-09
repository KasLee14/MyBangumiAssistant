import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError, SchemaInputError } from '../support/errors.js';
import { schemaArguments } from '../support/tool-schema.js';
import { validateMixedPart, validateMixedContent, isComponentKind, type CompleteComponentPart, type ComponentKind } from './content-schema.js';
import { expandResourceContent, type ResourceContentResolver, type ResourceReferenceProps } from './resource-content.js';
import { presentationPrepareSchema, type PreparedPresentationSummary } from './presentation-contract.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface Prepared { generation: number; parts: CompleteComponentPart[]; sourceRef?: string; sourceValue?: unknown; selection?: { subjectIds: number[] } }
function count(part: CompleteComponentPart): number {
  const props = part.props;
  if (Array.isArray(props)) return props.length;
  for (const key of ['items', 'rows', 'entries', 'episodes', 'links']) if (key in props && Array.isArray((props as Record<string, unknown>)[key])) return ((props as Record<string, unknown>)[key] as unknown[]).length;
  return 1;
}
/** 准备资源不外发完整载荷；发布前再次核实原缓存版本与当前账户范围。 */
export class PresentationStore {
  private generation = 0;
  private active = false;
  private prepared = new Map<string, Prepared>();
  constructor(private readonly resolver: ResourceContentResolver) {}
  begin(): void { this.invalidate(); this.active = true; }
  invalidate(): void { this.generation++; this.active = false; this.prepared.clear(); }
  isCurrent(ref: string): boolean { return this.active && this.prepared.get(ref)?.generation === this.generation; }
  private check(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AppError('USER_CANCELLED', '展示操作已取消。');
    if (!this.active) throw new AppError('RESOURCE_SCOPE_MISMATCH', '展示不属于当前用户回合。');
  }
  async prepare(raw: Record<string, unknown>, signal?: AbortSignal): Promise<PreparedPresentationSummary> {
    this.check(signal);
    if (this.prepared.size >= 64) throw new AppError('PRESENTATION_LIMIT', '当前回合已准备64个组件，请复用或发布现有快照。');
    const generation = this.generation, component = raw.component as ComponentKind;
    if (!isComponentKind(component)) throw new AppError('INVALID_INPUT', 'component必须是已登记的组件名。');
    const args = schemaArguments(presentationPrepareSchema(component), raw);
    if (args.subjectIds !== undefined && args.members !== undefined) throw new AppError('INVALID_INPUT', 'subjectIds与members只能选择一种成员身份，不能隐式丢弃成员选择。');
    if (args.fields !== undefined && args.columns !== undefined) throw new SchemaInputError(['fields', 'columns'].map(field => ({
      path: `/${field}`, rule: 'mutually_exclusive', hint: 'fields与columns只能选择一种：fields使用直接字段名，columns使用带标签的列定义；保留所需事实列，不同时提交。',
    })));
    let part: CompleteComponentPart;
    let sourceRef: string | undefined, sourceValue: unknown;
    const selection = Array.isArray(args.subjectIds) ? { subjectIds: args.subjectIds as number[] } : undefined;
    if (component === 'QuoteBlock' || component === 'Callout') {
      const { component: _component, ...props } = args;
      part = validateMixedPart({ type: component, pending: false, props }) as CompleteComponentPart;
    } else {
      sourceRef = args.resourceRef as string;
      const source = await this.resolver(sourceRef, signal, selection);
      sourceValue = structuredClone(source.value);
      const { component: _component, subjectIds, members, ...controls } = args;
      const props = { ...controls, ...(subjectIds ? { items: (subjectIds as number[]).map(id => ({ subjectId: id })) } : members ? { items: members } : {}) } as unknown as ResourceReferenceProps;
      // 复用同一次已验证读取，防止准备跨两个不同事实版本。
      const pinned: ResourceContentResolver = async () => source;
      part = await expandResourceContent(component, props, pinned, signal);
    }
    this.check(signal);
    if (generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '准备期间用户回合已改变。');
    validateMixedContent({ content: [part] });
    const resourceRef = `rr_${randomUUID().replaceAll('-', '')}`;
    this.prepared.set(resourceRef, { generation, parts: [part], ...(sourceRef ? { sourceRef, sourceValue, ...(selection ? { selection } : {}) } : {}) });
    return { resourceRef, blocks: [{ blockIndex: 0, type: part.type, itemCount: count(part) }] };
  }
  async block(ref: string, blockIndex: number, signal?: AbortSignal): Promise<CompleteComponentPart> {
    this.check(signal);
    const generation = this.generation, prepared = this.prepared.get(ref);
    let parts: unknown[];
    if (prepared) {
      if (prepared.generation !== generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '准备快照已经失效。');
      if (prepared.sourceRef) {
        const current = await this.resolver(prepared.sourceRef, signal, prepared.selection);
        if (!isDeepStrictEqual(current.value, prepared.sourceValue)) throw new AppError('RESOURCE_VERSION_CHANGED', '缓存事实已变化，请重新准备展示。');
      }
      parts = prepared.parts;
    } else {
      const cached = await this.resolver(ref, signal);
      const value = record(cached.value) && cached.value.kind === 'candidate_continuation' && record(cached.value.result) ? cached.value.result : cached.value;
      const presentation = record(value) ? value.presentation : undefined;
      if (!record(presentation)) throw new AppError('PRESENTATION_REQUIRED', '该引用不是已准备展示快照。');
      parts = Array.isArray(presentation.content) ? presentation.content : [presentation];
    }
    this.check(signal);
    if (generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '发布期间用户回合已改变。');
    const part = parts[blockIndex];
    if (!part || !record(part) || part.type === 'text') throw new AppError('INVALID_INPUT', 'blockIndex 必须指向快照中的完整组件。');
    const result = validateMixedPart(structuredClone(part));
    if (result.type === 'text' || result.pending !== false) throw new AppError('PRESENTATION_REQUIRED', '只能发布已通过校验的完整组件。');
    return result;
  }
}
