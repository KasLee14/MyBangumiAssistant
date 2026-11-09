import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { COMPONENT_KINDS, type ComponentKind } from './content-types.js';
import { COMPONENT_PAYLOAD_SCHEMAS, ContentOutputError, MAX_CONTENT_PARTS, type Schema } from './content-schema.js';
import { resourceReferenceSchema } from './resource-content.js';
import { AppError } from '../support/errors.js';
import { compileSchema, outputIssues } from '../support/tool-schema.js';
import { presentationPrepareSchema, RENDER_TOOL_DEFINITIONS, PREPARE_TOOL_DEFINITIONS } from './presentation-contract.js';
import { getCurrentTools } from '@earendil-works/pi-ai';

/** 这里只维护选择信息。字段、必填性和引用限制始终由实际校验 Schema 派生。 */
const purposes: Record<ComponentKind, { category: string; purpose: string; data: string }> = {
  SubjectCards: { category: '作品', purpose: '展示作品搜索、推荐及收藏结果，少量推荐优先封面卡片', data: '作品身份、名称、媒体类型，缓存作品引用' },
  StatsCard: { category: '统计', purpose: '展示评分、数量分布和指标汇总', data: '标签及指标值、评分分布' },
  ProgressView: { category: '进度', purpose: '展示观看进度和章节状态', data: '进度数值、章节和个人状态' },
  InfoBox: { category: '事实', purpose: '展示单对象的键值信息', data: '单个对象的字段、资料信息' },
  DataTable: { category: '事实', purpose: '按列比较多行事实、季度计数及行列数据', data: '列定义和对象行' },
  Timeline: { category: '事件', purpose: '按时间展示事件', data: '事件时间、正文及参与者' },
  TagCloud: { category: '标签', purpose: '展示标签及频次', data: '标签名称、计数、选中状态' },
  Gallery: { category: '人物图片', purpose: '展示简单人物、角色候选或图片列表', data: '实体身份、名称及可用图片' },
  CompareTable: { category: '事实', purpose: '展示前后变化', data: '同一字段的修改前后值' },
  QuoteBlock: { category: '文字', purpose: '展示引用正文或代码', data: '引用文字' },
  Callout: { category: '文字', purpose: '展示业务提示和结果状态，内部格式错误不放入正文', data: '业务状态和提示文字' },
  LinkList: { category: '链接', purpose: '展示链接集合', data: '链接名称及绝对地址' },
};
export type ComponentRepresentation = 'reference' | 'inline';
export type ComponentRepresentationChoice = ComponentRepresentation | 'auto';
const representationChoices = new Set(['auto', 'reference', 'inline']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function componentPropsSchema(name: ComponentKind, representation: ComponentRepresentation): Schema {
  return representation === 'reference' ? resourceReferenceSchema(name) : structuredClone(COMPONENT_PAYLOAD_SCHEMAS[name]);
}
function exampleFor(schema: Schema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'array') return [];
  if (schema.type === 'number') return 1;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map(name => [name, exampleFor(schema.properties![name]!)]));
  return '示例文字';
}
/** auto仅使用明确的实体/已准备格式，不推断图片、章节个人状态或评分分布存在。 */
function applicableReferenceKinds(value: Record<string, unknown>, source: string): ComponentKind[] {
  if (value.format === 'cards') return ['SubjectCards'];
  if (value.format === 'table') return ['DataTable'];
  const entity = String(value.entity ?? '');
  const fields = Array.isArray(value.availableFields) ? value.availableFields : [];
  if (entity === 'subject' || entity === 'subject_candidate' || /subject|candidate/.test(source) && !/person|character|episode/.test(source))
    return ['SubjectCards', 'InfoBox', 'DataTable', 'LinkList', 'TagCloud', ...(record(value.ratingDistribution) || fields.includes('ratingDistribution') ? ['StatsCard' as const] : [])];
  if (/person|character/.test(entity) || /person|character/.test(source)) return ['Gallery', 'InfoBox', 'DataTable', 'LinkList'];
  if (entity === 'episode' || /episode/.test(source)) return ['InfoBox', 'DataTable', 'LinkList', ...(fields.includes('episodeStatus') ? ['ProgressView' as const] : [])];
  if (/collection/.test(source)) return ['SubjectCards', 'InfoBox', 'DataTable', 'LinkList'];
  if (record(value.before) && record(value.after)) return ['CompareTable'];
  if (entity) return ['InfoBox', 'DataTable', 'LinkList'];
  return [];
}
export const COMPONENT_CATALOG_VERSION = createHash('sha256').update(JSON.stringify({ representationProtocol: 3, purposes,
  payloads: COMPONENT_PAYLOAD_SCHEMAS, prepareProtocol: 5, render: RENDER_TOOL_DEFINITIONS, selectedPrepare: PREPARE_TOOL_DEFINITIONS,
  prepare: COMPONENT_KINDS.map(presentationPrepareSchema), references: COMPONENT_KINDS.map(name => resourceReferenceSchema(name)) })).digest('hex').slice(0, 16);
export interface ComponentCatalogAudit {
  version: string; turn: number; indexReads: number; specReads: number; discovered: ComponentKind[]; loaded: ComponentKind[];
  representations: Partial<Record<ComponentKind, ComponentRepresentation>>;
  contracts: Partial<Record<ComponentKind, { selectionId: number; sourceTurn: number; reused: boolean }>>;
}
export interface ComponentIndexQuery { query?: string; category?: string; offset?: number; limit?: number }
export function componentIndex(query: ComponentIndexQuery = {}) {
  const terms = (query.query ?? '').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const category = (query.category ?? '').trim().toLocaleLowerCase();
  const matchesTerm = (haystack: string, term: string): boolean => {
    if (haystack.includes(term)) return true;
    // 中文自然描述没有空格，以相邻双字召回用途；不依赖英文分词或外部服务。
    if (!/^[\p{Script=Han}]+$/u.test(term) || term.length < 2) return false;
    return Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2)).some(token => haystack.includes(token));
  };
  const matched = COMPONENT_KINDS.map(name => ({ name, ...purposes[name] })).filter(item =>
    (!category || item.category.toLocaleLowerCase().includes(category))
    && terms.every(term => matchesTerm(`${item.name} ${item.category} ${item.purpose} ${item.data}`.toLocaleLowerCase(), term)));
  const offset = query.offset ?? 0, limit = query.limit ?? 6;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 12)
    throw new AppError('INVALID_INPUT', 'offset必须为非负整数，limit必须为1至12的整数。');
  const entries = matched.slice(offset, offset + limit);
  return { version: COMPONENT_CATALOG_VERSION, entries, total: matched.length, offset,
    nextOffset: offset + entries.length < matched.length ? offset + entries.length : null,
    categories: [...new Set(COMPONENT_KINDS.map(name => purposes[name].category))] };
}

/** 每个用户读取轮次独立。只读成功后登记状态，失败不污染 loaded。 */
export class ComponentCatalogState {
  private turn = 0;
  private indexReads = 0;
  private specReads = 0;
  private discovered = new Set<ComponentKind>();
  private loaded = new Set<ComponentKind>();
  private successfulDiscovered = new Set<ComponentKind>();
  private successfulLoaded = new Set<ComponentKind>();
  private representations = new Map<ComponentKind, ComponentRepresentation>();
  private latestSelections = new Map<ComponentKind, { representation: ComponentRepresentation; selectionId: number; sourceTurn: number }>();
  private selectionSequence = 0;
  private referenceKinds = new Set<ComponentKind>();
  private observedReferences = new Map<string, ComponentKind[]>();
  private referenceIsCurrent: ((ref: string) => boolean) | undefined;
  private requestComponents: Set<ComponentKind> | undefined;
  /** 新用户轮只使事实引用失效。纯契约能否复用由下一次请求的真实可见性决定。 */
  reset(): void { this.turn++; this.indexReads = 0; this.specReads = 0; this.referenceKinds.clear(); this.observedReferences.clear(); }
  currentAudit(): ComponentCatalogAudit {
    return { version: COMPONENT_CATALOG_VERSION, turn: this.turn, indexReads: this.indexReads, specReads: this.specReads,
      discovered: [...this.discovered], loaded: [...this.loaded], representations: Object.fromEntries(this.representations),
      contracts: Object.fromEntries([...this.loaded].map(name => {
        const selection = this.latestSelections.get(name)!;
        return [name, { selectionId: selection.selectionId, sourceTurn: selection.sourceTurn, reused: selection.sourceTurn !== this.turn }];
      })) };
  }
  setReferenceValidator(isCurrent: (ref: string) => boolean): void { this.referenceIsCurrent = isCurrent; }
  isCurrentReference(ref: string): boolean | undefined { return this.referenceIsCurrent?.(ref); }
  isLoadedForRequest(name: ComponentKind): boolean { return this.requestComponents ? this.requestComponents.has(name) : this.loaded.has(name); }
  /** 成功工具结果可在同批后续工具执行前告知已取得引用；不保存任何缓存事实。 */
  observeResource(value: unknown, sourceTool: string): void {
    if (!record(value)) return;
    const body = typeof value.resourceRef === 'string' ? value : record(value.value) ? value.value : value;
    if (typeof body.resourceRef !== 'string' || !/^rr_[A-Za-z0-9_-]+$/u.test(body.resourceRef)) return;
    if (this.referenceIsCurrent && !this.referenceIsCurrent(body.resourceRef)) return;
    const source = typeof body.sourceTool === 'string' ? body.sourceTool : sourceTool;
    const data = record(body.value) ? body.value : body;
    const kinds = new Set(applicableReferenceKinds(data, source));
    const presentation = record(data.presentation) ? data.presentation : undefined;
    const parts = Array.isArray(presentation?.content) ? presentation.content : presentation?.type ? [presentation] : [];
    for (const part of parts) if (record(part) && COMPONENT_KINDS.includes(part.type as ComponentKind)) kinds.add(part.type as ComponentKind);
    this.observedReferences.set(body.resourceRef, [...kinds]);
    kinds.forEach(kind => this.referenceKinds.add(kind));
  }
  readIndex(query: ComponentIndexQuery = {}) {
    const result = componentIndex(query);
    this.indexReads++;
    result.entries.forEach(entry => { this.discovered.add(entry.name); this.successfulDiscovered.add(entry.name); });
    return { ...result, audit: this.currentAudit() };
  }
  readSpecs(names: readonly string[], choice: ComponentRepresentationChoice = 'auto') {
    if (!this.discovered.size) throw new AppError('COMPONENT_INDEX_REQUIRED', '先读取可见的同版本组件索引选择组件，再读取字段。');
    if (!names.length || names.length > 12 || new Set(names).size !== names.length) throw new AppError('INVALID_INPUT', 'names必须包含1至12个不重复的组件名称。');
    if (!representationChoices.has(choice)) throw new AppError('INVALID_INPUT', 'representation仅允许auto、reference或inline。');
    for (const name of names) if (!this.discovered.has(name as ComponentKind))
      throw new AppError('COMPONENT_NOT_DISCOVERED', '组件不在当前可见的已读目录中，请按用途查询或遍历索引。');
    const specs = names.map(name => {
      const kind = name as ComponentKind;
      const representation: ComponentRepresentation = choice === 'auto' ? this.referenceKinds.has(kind) && !['Callout', 'QuoteBlock'].includes(kind) ? 'reference' : 'inline' : choice;
      const props = componentPropsSchema(kind, representation);
      return { name: kind, ...purposes[kind], representation, selectionId: this.selectionSequence + 1, sourceTurn: this.turn,
        selectionReason: choice !== 'auto' ? '模型明确选择此形式' : representation === 'reference' ? '本轮上下文存在实体或准备格式明确适用的缓存引用' : '本轮无明确适用缓存引用，或组件为创作文字',
        required: [...(props.required ?? [])], props,
        canonicalContract: '宿主完成结果独立使用严格COMPONENT_PAYLOAD_SCHEMAS校验；内部展开字段不是本次生成props字段。只填写上面唯一props契约，禁止混用reference与inline。',
        requestedFacts: '用户要求的事实若没有此props合法字段（例如SubjectCards没有总集数字段），在text或另读InfoBox等组件交付；不能新增字段，也不能把组件合法当成请求全部完成。修复时保留未完成事实要求。',
        envelopeExample: { content: [{ type: kind, props: representation === 'reference' ? { resourceRef: 'rr_example' } : exampleFor(props) }] },
        exampleNote: '示例仅说明content根对象和组件嵌套形状，不是事实。rr_example须替换为本轮适用缓存引用；inline示例值须替换为已获得信息。',
        representationUsage: representation === 'reference'
          ? '只填引用props允许的字段，禁止加入inline的total、hint等字段；items仅选择本引用的主键成员，不能抄入name等实体事实。已准备presentation仅提供resourceRef和必要的partIndex，不覆盖快照。需要直接字段时重新读取representation=inline。'
          : '按本次props填写已获得事实，不提供resourceRef。适用缓存引用已取得时可重新读取representation=reference切换，不能混填。未知可选字段省略；严格正文模式可用null表达未知可选字段。',
        ...(kind === 'DataTable' ? { constraints: representation === 'inline'
          ? ['rows为对象数组，单元格必须是字符串；空单元格为空字符串', 'columns.key唯一，每行键与列定义对应']
          : ['fields与columns不能同时填写；已准备快照仅resourceRef和必要partIndex', '不提供rows，实际对象行由宿主缓存展开'] }
          : kind === 'SubjectCards' ? { constraints: ['推荐少量作品优先layout=grid；紧凑核对列表可用list', representation === 'inline'
            ? '作品kind按真实媒体类型填写，不猜测名称、图片或评分' : 'items仅填写props.items声明的成员主键，不填名称、媒体类型、图片等实体事实'] } : {}),
      };
    });
    this.specReads++; this.selectionSequence++;
    specs.forEach(spec => { this.loaded.add(spec.name); this.successfulLoaded.add(spec.name); this.representations.set(spec.name, spec.representation); this.latestSelections.set(spec.name, { representation: spec.representation, selectionId: spec.selectionId, sourceTurn: spec.sourceTurn }); });
    return { version: COMPONENT_CATALOG_VERSION, turn: this.turn, specs, audit: this.currentAudit() };
  }
  readPrepareSpecs(names: readonly string[]) {
    const read = this.readSpecs(names);
    return { ...read, specs: read.specs.map(spec => ({ name: spec.name, ...purposes[spec.name],
      selectionId: spec.selectionId, sourceTurn: spec.sourceTurn,
      tool: 'prepare_component', prepare: presentationPrepareSchema(spec.name),
      constraints: [...(['QuoteBlock', 'Callout'].includes(spec.name) ? [] : ['明确成员必须来自此resourceRef的当前成员；单对象详情不能选择其他对象。保持用户完整范围，多个已有详情引用可分别准备和发布，不跨引用合并ID。']),
        ...(spec.name === 'DataTable' ? ['fields与columns只能选择一种；fields是直接字段名，columns是带标签的列定义，保留所需事实列。'] : [])],
      publication: 'prepare成功后使用present_component({resourceRef,blockIndex})发布；blockIndex为整个快照绝对下标。候选准备快照可直接发布。普通说明为原生文字；精确交错可用present_text。',
    })) };
  }
  loadSpecs(names: readonly string[], mode: 'render' | 'prepare', activate: (tools: string[]) => void) {
    // 明确名称由固定注册目录核验；用途索引用于发现，不承担授权或激活门禁。
    if (!names.length || names.length > 12 || new Set(names).size !== names.length
      || names.some(name => !COMPONENT_KINDS.includes(name as ComponentKind)))
      throw new AppError('INVALID_INPUT', 'names必须包含1至12个不重复的固定组件名称。');
    if (mode !== 'render' && mode !== 'prepare') throw new AppError('INVALID_INPUT', 'mode只允许render或prepare。');
    const tools = names.map(name => `${mode}_${name}`);
    if (mode === 'prepare') tools.push('present_component', 'present_text');
    activate(tools);
    this.specReads++; this.selectionSequence++;
    for (const name of names) {
      const kind = name as ComponentKind;
      const representation = ['Callout', 'QuoteBlock'].includes(kind) ? 'inline' : 'reference';
      this.loaded.add(kind); this.successfulLoaded.add(kind); this.representations.set(kind, representation);
      this.latestSelections.set(kind, { representation, selectionId: this.selectionSequence, sourceTurn: this.turn });
    }
    // 完整Schema只在下一request固定工具声明中出现，回执不重复整份契约。
    return { version: COMPONENT_CATALOG_VERSION, status: 'activated' as const, tools };
  }
  /** 纯定义可跨轮复用；压缩/重建后仅承认真实可读的当前版本最新完整说明。 */
  reconcile(context: { messages: object }): void {
    const discovered = new Set<ComponentKind>(), loaded = new Set<ComponentKind>(), representations = new Map<ComponentKind, ComponentRepresentation>();
    this.referenceKinds.clear();
    for (const [ref, kinds] of this.observedReferences) {
      if (this.referenceIsCurrent && !this.referenceIsCurrent(ref)) { this.observedReferences.delete(ref); continue; }
      kinds.forEach(kind => this.referenceKinds.add(kind));
    }
    const messages = Array.isArray(context.messages) ? context.messages : [];
    const realUserIndex = messages.findLastIndex(message => {
      if (!record(message) || message.role !== 'user') return false;
      const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(record).map(part => part.text ?? '').join('') : '';
      try { return JSON.parse(text).kind !== 'host_recovery_feedback'; } catch { return true; }
    });
    for (const [messageIndex, message] of messages.entries()) {
      if (!record(message) || message.role !== 'toolResult' || message.isError === true
        || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (!record(part) || part.type !== 'text' || typeof part.text !== 'string') continue;
        let value: unknown; try { value = JSON.parse(part.text); } catch { continue; }
        if (messageIndex > realUserIndex && record(value) && !['read_component_index', 'read_component_spec'].includes(String(message.toolName))) {
          this.observeResource(value, String(message.toolName));
        }
        if (record(value) && value.version === COMPONENT_CATALOG_VERSION && message.toolName === 'read_component_spec'
          && value.status === 'activated' && Array.isArray(value.tools)) {
          for (const tool of value.tools) {
            const definition = [...RENDER_TOOL_DEFINITIONS, ...PREPARE_TOOL_DEFINITIONS].find(item => item.name === tool);
            if (!definition) continue;
            const name = definition.component;
            discovered.add(name); loaded.add(name); representations.set(name, this.latestSelections.get(name)?.representation ?? 'reference');
            if (!this.latestSelections.has(name)) this.latestSelections.set(name, { representation: 'reference', selectionId: ++this.selectionSequence, sourceTurn: this.turn });
          }
        }
        if (record(value) && value.version === COMPONENT_CATALOG_VERSION && !value.audit && message.toolName === 'read_component_index' && Array.isArray(value.entries)) {
          for (const entry of value.entries) if (record(entry) && COMPONENT_KINDS.includes(entry.name as ComponentKind)) discovered.add(entry.name as ComponentKind);
        }
        if (!record(value) || value.version !== COMPONENT_CATALOG_VERSION || !record(value.audit)
          || value.audit.version !== COMPONENT_CATALOG_VERSION) continue;
        if (message.toolName === 'read_component_index' && Array.isArray(value.entries)) for (const entry of value.entries) {
          if (record(entry) && this.successfulDiscovered.has(entry.name as ComponentKind)) discovered.add(entry.name as ComponentKind);
        }
        if (message.toolName === 'read_component_spec' && Array.isArray(value.specs)) for (const spec of value.specs) {
          if (!record(spec) || !this.successfulLoaded.has(spec.name as ComponentKind)) continue;
          const name = spec.name as ComponentKind;
          const latest = this.latestSelections.get(name);
          if (!latest || spec.selectionId !== latest.selectionId || spec.sourceTurn !== latest.sourceTurn
            || !(spec.tool === 'prepare_component' && isDeepStrictEqual(spec.prepare, presentationPrepareSchema(name))
              || spec.representation === latest.representation && isDeepStrictEqual(spec.props, componentPropsSchema(name, latest.representation)))) continue;
          // 完整字段说明含用途信息；复用保留原sourceTurn，不伪装成本轮新读取。
          discovered.add(name); loaded.add(name); representations.set(name, latest.representation);
        }
      }
    }
    this.discovered = discovered; this.loaded = loaded; this.representations = representations;
    const active = getCurrentTools(messages.filter(record).map(message => message as { role: string }));
    const declarations = [...RENDER_TOOL_DEFINITIONS, ...PREPARE_TOOL_DEFINITIONS];
    // 兼容旧正文仅用原字段门禁；新固定工具必须在本请求真实完整声明中存在。
    this.requestComponents = new Set(active.flatMap(tool => {
        const definition = declarations.find(item => item.name === tool.name);
        return definition && isDeepStrictEqual(tool.parameters, definition.inputSchema) ? [definition.component] : [];
      }));
  }
}
export const createComponentCatalogState = (): ComponentCatalogState => new ComponentCatalogState();
const contexts = new WeakMap<object, ComponentCatalogState>();
export function bindComponentCatalog(context: { messages: object }, state: ComponentCatalogState): void {
  state.reconcile(context);
  contexts.set(context, state); contexts.set(context.messages, state);
}
export function componentCatalogFor(context: { messages: object }): ComponentCatalogState | undefined {
  return contexts.get(context) ?? contexts.get(context.messages);
}
export function validateLoadedComponents<T extends { content: readonly { type: string; props?: unknown }[] }>(answer: T, state: ComponentCatalogState): T {
  const audit = state.currentAudit(), loaded = new Set(audit.loaded);
  answer.content.forEach((part, index) => {
    if (part.type !== 'text' && !loaded.has(part.type as ComponentKind)) throw new ContentOutputError(
      '组件输出前必须取得当前上下文完整可见的同版本最新字段契约', 'schema', [],
      [{ path: `/content/${index}/type`, rule: 'component_spec_required', message: '没有可复用的完整契约时，先调用read_component_index及read_component_spec' }], 'component_spec_required');
    if (part.type === 'text') return;
    const name = part.type as ComponentKind, representation = audit.representations[name]!;
    const schema = componentPropsSchema(name, representation);
    if (!compileSchema(schema)(part.props)) throw new ContentOutputError('组件props不符合本轮已选表示形式，不能混填引用与实体字段', 'schema', [],
      outputIssues(schema, part.props).map(issue => ({ ...issue, path: `/content/${index}/props${issue.path}`, message: `${issue.message}；只填写${representation}契约，其他用户要求的事实用text或另一个适用组件交付` })), 'component_representation_invalid');
    if (representation === 'reference' && record(part.props) && typeof part.props.resourceRef === 'string'
      && state.isCurrentReference(part.props.resourceRef) === false) throw new ContentOutputError('缓存引用不属于当前读取轮次', 'schema', [],
      [{ path: `/content/${index}/props/resourceRef`, rule: 'resource_reference', message: '纯组件契约可复用，事实引用必须来自当前读取轮次；重新读取事实获得适用引用' }], 'resource_reference_refresh_required');
  });
  return answer;
}

/** 只生成本轮已读取组件的生成契约。text不要求读取索引。 */
export function providerSchemaForComponents(names: readonly ComponentKind[], representations: Partial<Record<ComponentKind, ComponentRepresentation>> = {}): Schema {
  return { type: 'object', additionalProperties: false, required: ['content'], properties: {
    content: { type: 'array', maxItems: MAX_CONTENT_PARTS, items: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'text'], properties: { type: { type: 'string', enum: ['text'] }, text: { type: 'string' } } },
      ...[...new Set(names)].map(name => ({ type: 'object', additionalProperties: false, required: ['type', 'props'],
        properties: { type: { type: 'string', enum: [name] }, props: componentPropsSchema(name, representations[name] ?? 'inline') } })),
    ] } },
  } };
}

/** 动态键对象不能转为strict；回退保留原正文协议和完整本地校验。 */
export function strictProviderSchema(schema: Schema): Schema | undefined {
  if (schema.type === 'object' && schema.additionalProperties !== false) return undefined;
  const result = structuredClone(schema);
  if (schema.anyOf) {
    const branches = schema.anyOf.map(strictProviderSchema);
    if (branches.some(branch => !branch)) return undefined;
    result.anyOf = branches as Schema[];
  }
  if (schema.items) { const item = strictProviderSchema(schema.items); if (!item) return undefined; result.items = item; }
  if (schema.properties) {
    const properties: Record<string, Schema> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const strict = strictProviderSchema(child); if (!strict) return undefined;
      properties[name] = schema.required?.includes(name) ? strict : { anyOf: [strict, { type: 'null' }] };
    }
    result.properties = properties; result.required = Object.keys(properties);
  }
  return result;
}
