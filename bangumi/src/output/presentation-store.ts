import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError, SchemaInputError } from '../support/errors.js';
import { schemaArguments } from '../support/tool-schema.js';
import { ContentOutputError, validateMixedPart, validateMixedContent, isComponentKind, type CompleteComponentPart, type ComponentKind } from './content-schema.js';
import { expandResourceContent, resourceSelectionIdentities, type ResourceContentResolver, type ResourceReferenceProps } from './resource-content.js';
import { componentToolSchema, presentationPrepareSchema, type PreparedPresentationSummary } from './presentation-contract.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
interface Dependency { ref: string; value: unknown; sourceTool: string; accessContext?: unknown; selection?: { subjectIds: number[] } }
interface Prepared { generation: number; parts: CompleteComponentPart[]; dependencies: Dependency[]; identities?: string[] }
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
    const component = raw.component as ComponentKind;
    if (!isComponentKind(component)) throw new AppError('INVALID_INPUT', 'component必须是已登记的组件名。');
    const args = schemaArguments(presentationPrepareSchema(component), raw);
    if (args.subjectIds !== undefined && args.members !== undefined) throw new AppError('INVALID_INPUT', 'subjectIds与members只能选择一种成员身份，不能隐式丢弃成员选择。');
    if (args.fields !== undefined && args.columns !== undefined) throw new SchemaInputError(['fields', 'columns'].map(field => ({
      path: `/${field}`, rule: 'mutually_exclusive', hint: 'fields与columns只能选择一种：fields使用直接字段名，columns使用带标签的列定义；保留所需事实列，不同时提交。',
    })));
    return this.freeze(await this.build(component, args, signal), signal);
  }
  async prepareSelected(component: ComponentKind, input: Record<string, unknown>, signal?: AbortSignal): Promise<PreparedPresentationSummary> {
    this.check(signal);
    if (this.prepared.size >= 64) throw new AppError('PRESENTATION_LIMIT', '当前回合已准备64个组件。');
    const args = schemaArguments(componentToolSchema(component, false), input);
    return this.freeze(await this.build(component, args, signal), signal);
  }
  async materialize(component: ComponentKind, input: Record<string, unknown>, signal?: AbortSignal): Promise<CompleteComponentPart> {
    this.check(signal);
    const args = schemaArguments(componentToolSchema(component, false), input);
    const prepared = await this.build(component, args, signal);
    await this.verify(prepared, signal);
    return structuredClone(prepared.parts[0]!);
  }
  private async build(component: ComponentKind, args: Record<string, unknown>, signal?: AbortSignal): Promise<Prepared> {
    this.check(signal);
    const generation = this.generation;
    if (args.fields !== undefined && args.columns !== undefined) throw new SchemaInputError(['fields', 'columns'].map(field => ({ path: `/${field}`, rule: 'mutually_exclusive', hint: 'fields与columns只能选择一种。' })));
    const dependencies: Dependency[] = [], parts: CompleteComponentPart[] = [], selectedIdentities: string[] = [];
    let identityComplete = true;
    if (component === 'QuoteBlock' || component === 'Callout') {
      const { component: _component, ...props } = args;
      parts.push(validateMixedPart({ type: component, pending: false, props }) as CompleteComponentPart);
    } else {
      if ((args.sources !== undefined) === (args.resourceRef !== undefined)) throw new SchemaInputError([{ path: '/resourceRef', rule: 'source_choice', hint: 'resourceRef快捷来源与sources有序来源必须且只能选择一种。' }]);
      if (args.sources !== undefined && ['subjectIds', 'members', 'blockIndex'].some(key => args[key] !== undefined)) throw new SchemaInputError([{ path: '/sources', rule: 'source_choice', hint: '使用sources时，成员与blockIndex放在对应来源中，不能混入顶层选择。' }]);
      const sources = Array.isArray(args.sources) ? args.sources as Record<string, unknown>[] : [{ resourceRef: args.resourceRef, subjectIds: args.subjectIds, members: args.members, blockIndex: args.blockIndex }];
      const { component: _component, resourceRef: _ref, sources: _sources, subjectIds: _ids, members: _members, blockIndex: _index, ...controls } = args;
      const identities = new Set<string>();
      for (const [sourceIndex, sourceArgs] of sources.entries()) {
        if (sourceArgs.subjectIds !== undefined && sourceArgs.members !== undefined) throw new SchemaInputError([{ path: '/sources', rule: 'member_choice', hint: '每个来源的subjectIds与members只能选择一种。' }]);
        const ref = sourceArgs.resourceRef as string, ids = sourceArgs.subjectIds as number[] | undefined;
        const selection = ids ? { subjectIds: ids } : undefined;
        const local = this.prepared.get(ref);
        if (local) {
          if (ids || sourceArgs.members || Object.keys(controls).length) throw new SchemaInputError([{ path: '/sources', rule: 'frozen_snapshot', hint: '宿主准备快照只用resourceRef/blockIndex，不能覆盖成员或展示字段。' }]);
          await this.verify(local, signal);
          const part = local.parts[(sourceArgs.blockIndex as number | undefined) ?? 0];
          if (!part || part.type !== component) throw new AppError('INVALID_INPUT', '宿主快照块类型或下标不匹配。');
          if (sources.length > 1 && !local.identities) throw new SchemaInputError([{ path: `/sources/${sourceIndex}`, rule: 'identity_unknown', hint: '此准备快照没有完整可证明成员身份，不能跨来源合并。' }]);
          for (const key of local.identities ?? []) {
            if (identities.has(key)) throw new SchemaInputError([{ path: '/sources', rule: 'duplicate_member', hint: '来源重复指向同一实体成员，不能自动删除。' }]);
            identities.add(key); selectedIdentities.push(key);
          }
          if (!local.identities) identityComplete = false;
          parts.push(structuredClone(part)); dependencies.push(...structuredClone(local.dependencies));
          continue;
        }
        const cached = await this.resolver(ref, signal, selection);
        if (cached.resourceRef !== ref || !record(cached.value)) throw new AppError('MCP_PROTOCOL_ERROR', '缓存返回资源与请求引用不一致。');
        const props = { ...controls, resourceRef: ref, ...(ids ? { items: ids.map(subjectId => ({ subjectId })) } : sourceArgs.members ? { items: sourceArgs.members } : {}) } as ResourceReferenceProps;
        let part: CompleteComponentPart;
        if (sourceArgs.blockIndex !== undefined) {
          if (ids || sourceArgs.members || Object.keys(controls).length) throw new SchemaInputError([{ path: '/blockIndex', rule: 'frozen_snapshot', hint: '已准备快照只选resourceRef与blockIndex，不覆盖成员或展示字段。' }]);
          part = this.snapshotPart(cached.value, sourceArgs.blockIndex as number);
          if (part.type !== component) throw new AppError('INVALID_INPUT', '快照块类型与所加载组件不一致。');
        } else {
          const pinned: ResourceContentResolver = async () => cached;
          try { part = await expandResourceContent(component, props, pinned, signal); }
          catch (error) { if (args.sources && error instanceof ContentOutputError) throw error.at(`/sources/${sourceIndex}`); throw error; }
        }
        let keys: string[] | undefined;
        try {
          keys = sourceArgs.blockIndex !== undefined && part.type === 'SubjectCards'
            ? part.props.items.map(item => JSON.stringify({ entity: 'subject', id: item.id }))
            : resourceSelectionIdentities(cached.value, props, component);
        } catch (error) {
          identityComplete = false;
          if (sources.length > 1) { if (error instanceof ContentOutputError) throw error.at(`/sources/${sourceIndex}`); throw error; }
        }
        if (keys) {
          for (const key of keys) {
            if (identities.has(key)) throw new SchemaInputError([{ path: '/sources', rule: 'duplicate_member', hint: '不同来源重复指向同一实体成员，不能重复或自动删成员。' }]);
            identities.add(key); selectedIdentities.push(key);
          }
        }
        parts.push(part);
        dependencies.push({ ref, value: structuredClone(cached.value), sourceTool: cached.sourceTool, ...(cached.accessContext !== undefined ? { accessContext: structuredClone(cached.accessContext) } : {}), ...(selection ? { selection } : {}) });
      }
    }
    this.check(signal);
    if (generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '准备期间用户回合已改变。');
    const part = parts.length === 1 ? parts[0]! : this.merge(component, parts);
    validateMixedContent({ content: [part] });
    return { generation, parts: [part], dependencies, ...(identityComplete ? { identities: selectedIdentities } : {}) };
  }
  private merge(component: ComponentKind, parts: CompleteComponentPart[]): CompleteComponentPart {
    const fields: Partial<Record<ComponentKind, string>> = { SubjectCards: 'items', Gallery: 'items', DataTable: 'rows', LinkList: 'links', ProgressView: 'episodes' };
    const field = fields[component];
    if (!field) throw new SchemaInputError([{ path: '/sources', rule: 'single_source', hint: '此组件没有可证明的跨来源组合语义，只允许一个来源。' }]);
    const first = structuredClone(parts[0]!.props) as Record<string, unknown>;
    const allowed = new Set([field, 'title', ...(component === 'SubjectCards' ? ['layout'] : component === 'DataTable' ? ['columns'] : [])]);
    for (const part of parts) {
      const props = part.props as Record<string, unknown>;
      if (Object.keys(props).some(key => !allowed.has(key)) || [...allowed].filter(key => key !== field).some(key => !isDeepStrictEqual(first[key], props[key])))
        throw new SchemaInputError([{ path: '/sources', rule: 'source_conflict', hint: '各来源的列或固定展示属性冲突，不能猜测聚合事实或覆盖已准备快照。' }]);
    }
    first[field] = parts.flatMap(part => (part.props as Record<string, unknown>)[field] as unknown[]);
    return validateMixedPart({ type: component, pending: false, props: first }) as CompleteComponentPart;
  }
  private freeze(prepared: Prepared, signal?: AbortSignal): PreparedPresentationSummary {
    this.check(signal);
    const resourceRef = `rr_${randomUUID().replaceAll('-', '')}`;
    this.prepared.set(resourceRef, prepared);
    return { resourceRef, blocks: prepared.parts.map((part, blockIndex) => ({ blockIndex, type: part.type, itemCount: count(part) })) };
  }
  private async verify(prepared: Prepared, signal?: AbortSignal): Promise<void> {
    this.check(signal);
    if (prepared.generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '准备快照已经失效。');
    for (const dependency of prepared.dependencies) {
      const current = await this.resolver(dependency.ref, signal, dependency.selection);
      if (current.resourceRef !== dependency.ref || current.sourceTool !== dependency.sourceTool || !isDeepStrictEqual(current.value, dependency.value) || !isDeepStrictEqual(current.accessContext, dependency.accessContext))
        throw new AppError('RESOURCE_VERSION_CHANGED', '准备依赖的事实或访问范围已变化，请重新核实全部来源。');
    }
    this.check(signal);
    if (prepared.generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '发布期间用户回合已改变。');
  }
  private snapshotPart(value: unknown, blockIndex: number): CompleteComponentPart {
    const body = record(value) && value.kind === 'candidate_continuation' && record(value.result) ? value.result : value;
    const presentation = record(body) ? body.presentation : undefined;
    if (!record(presentation)) throw new AppError('PRESENTATION_REQUIRED', '该引用不是已准备展示快照。');
    const parts = Array.isArray(presentation.content) ? presentation.content : [presentation], part = parts[blockIndex];
    if (!part || !record(part) || part.type === 'text') throw new AppError('INVALID_INPUT', 'blockIndex必须指向快照完整组件。');
    const checked = validateMixedPart(structuredClone(part));
    if (checked.type === 'text' || checked.pending !== false) throw new AppError('PRESENTATION_REQUIRED', '只能发布完整组件。');
    return checked;
  }
  async block(ref: string, blockIndex: number, signal?: AbortSignal): Promise<CompleteComponentPart> {
    this.check(signal);
    const generation = this.generation, prepared = this.prepared.get(ref);
    let parts: unknown[];
    if (prepared) {
      await this.verify(prepared, signal);
      parts = prepared.parts;
    } else {
      const cached = await this.resolver(ref, signal);
      this.check(signal);
      if (generation !== this.generation) throw new AppError('RESOURCE_SCOPE_MISMATCH', '发布期间用户回合已改变。');
      return this.snapshotPart(cached.value, blockIndex);
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
