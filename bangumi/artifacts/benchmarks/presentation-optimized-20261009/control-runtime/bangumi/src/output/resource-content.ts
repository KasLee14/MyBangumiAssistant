import { ContentOutputError, validateMixedPart, type ComponentKind, type CompleteComponentPart, type MixedPart, type Schema } from './content-schema.js';
import type { TranscriptContext } from '@earendil-works/pi-ai';
import { AppError, safeError } from '../support/errors.js';
import { isDeepStrictEqual } from 'node:util';
import { resourceFields } from '../mcp/resource-policy.js';
import type { CachedResourceSelection } from '../mcp/resource-contract.js';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
export interface ResourceReferenceProps {
  resourceRef: string;
  items?: Row[];
  partIndex?: number;
  title?: string;
  layout?: 'grid' | 'list';
  fields?: string[];
  columns?: { key: string; label: string; align?: 'left' | 'right' }[];
  mode?: 'list' | 'bars' | 'histogram';
}
export type ResourceContentResolver = ((ref: string, signal?: AbortSignal, selection?: CachedResourceSelection) => Promise<{
  resourceRef: string; sourceTool: string; value: unknown; accessContext?: unknown;
}>) & { isCurrent?: (ref: string) => boolean };
const contexts = new WeakMap<object, ResourceContentResolver>();
export function bindResourceResolver(context: TranscriptContext, resolver: ResourceContentResolver): void {
  contexts.set(context, resolver); contexts.set(context.messages, resolver);
}
export function resourceResolverFor(context: TranscriptContext): ResourceContentResolver | undefined {
  // ModelRuntime.normalizeContext 重建信封，但共享同一条请求的 messages 数组。
  return contexts.get(context) ?? contexts.get(context.messages);
}
const fail = (message: string, details = [{ path: '/props/resourceRef', rule: 'resource_reference', message }]): never => {
  throw new ContentOutputError(message, 'schema', [], details, 'resource_reference_invalid');
};
function resourceReadFailure(error: unknown): ContentOutputError {
  const safe = safeError(error);
  const reason = ['RESOURCE_EXPIRED', 'RESOURCE_REF_EXPIRED', 'RESOURCE_VERSION_CHANGED', 'CANDIDATE_REF_EXPIRED'].includes(safe.code)
    ? 'resource_reference_refresh_required'
    : ['CANDIDATE_STAGE_INCOMPLETE', 'CANDIDATE_REQUIRED_FACTS_MISSING'].includes(safe.code) ? 'resource_reference_stage_incomplete'
      : ['ACCOUNT_CHANGED', 'RESOURCE_SCOPE_MISMATCH', 'CANDIDATE_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED', 'NSFW_SCOPE_MISMATCH',
        'BGM_AUTH_REQUIRED', 'BGM_AUTH_EXPIRED', 'PERMISSION_DENIED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN', 'NSFW_FORBIDDEN'].includes(safe.code)
        ? 'resource_reference_access_denied' : 'resource_reference_unavailable';
  return new ContentOutputError(`缓存引用读取失败（${safe.code}）：${safe.message}`, 'schema', [],
    [{ path: '/props/resourceRef', rule: 'resource_reference', message: safe.message }], reason,
    { cause: error, ...(safe.diagnostic === undefined ? {} : { diagnostic: safe.diagnostic }),
      ...(safe.sourceTool === undefined ? {} : { sourceTool: safe.sourceTool }) });
}
export const RESOURCE_REFERENCE_SCHEMA: Schema = {
  type: 'object', additionalProperties: false, required: ['resourceRef'], properties: {
    resourceRef: { type: 'string', pattern: '^rr_[A-Za-z0-9_-]+$' },
    items: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, properties: {
      ...Object.fromEntries(['id', 'subjectId', 'episodeId', 'characterId', 'personId', 'revisionId', 'targetId', 'relationId', 'ownerId'].map(key => [key, { type: 'number' }])),
      entity: { type: 'string', enum: ['subject', 'character', 'person', 'episode', 'revision', 'user', 'index'] },
      targetKind: { type: 'string', enum: ['subject', 'character', 'person', 'episode', 'revision', 'user', 'index'] }, username: { type: 'string' },
    } } },
    partIndex: { type: 'number' }, title: { type: 'string' }, layout: { type: 'string', enum: ['grid', 'list'] },
    fields: { type: 'array', items: { type: 'string' } },
    columns: { type: 'array', items: { type: 'object', required: ['key', 'label'], additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, align: { type: 'string', enum: ['left', 'right'] } } } },
    mode: { type: 'string', enum: ['list', 'bars', 'histogram'] },
  },
};
const referenceControls: Record<ComponentKind, string[]> = {
  SubjectCards: ['title', 'layout', 'items'], Gallery: ['title', 'items'], LinkList: ['title', 'items'],
  DataTable: ['title', 'items', 'fields', 'columns'], InfoBox: ['title', 'items', 'fields'], TagCloud: ['items'],
  StatsCard: ['title', 'items', 'mode'], ProgressView: ['title', 'items'], Timeline: ['title', 'items'],
  CompareTable: ['title', 'fields'], QuoteBlock: [], Callout: [],
};
const referenceLimits: Partial<Record<ComponentKind, number>> = { SubjectCards: 50, Gallery: 50, LinkList: 50, DataTable: 200,
  InfoBox: 1, StatsCard: 1, ProgressView: 100, Timeline: 100, TagCloud: 200 };
export function resourceReferenceSchema(kind: ComponentKind): Schema {
  const allowed = new Set(['resourceRef', 'partIndex', ...referenceControls[kind]]);
  const schema = structuredClone(RESOURCE_REFERENCE_SCHEMA);
  schema.properties = Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => allowed.has(key)));
  if (schema.properties.items && referenceLimits[kind] !== undefined) schema.properties.items.maxItems = referenceLimits[kind]!;
  return schema;
}
export function isResourceReference(value: unknown): value is ResourceReferenceProps { return record(value) && Object.hasOwn(value, 'resourceRef'); }
export function normalizeResourceReference(value: unknown, partial = false, kind?: ComponentKind): ResourceReferenceProps {
  if (!record(value)) return fail('资源引用 props 必须是对象。');
  const schema = kind ? resourceReferenceSchema(kind) : RESOURCE_REFERENCE_SCHEMA;
  const allowed = Object.keys(schema.properties!);
  if (Object.keys(value).some(key => !allowed.includes(key))) return fail('资源引用包含未声明字段。');
  if ((!partial || value.resourceRef !== undefined) && (typeof value.resourceRef !== 'string' || !/^rr_[A-Za-z0-9_-]+$/.test(value.resourceRef))) return fail('资源引用格式无效。');
  for (const key of ['title'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') return fail(`${key} 必须是文字。`);
  if (value.partIndex !== undefined && (!Number.isSafeInteger(value.partIndex) || Number(value.partIndex) < 0)) return fail('partIndex 必须是非负整数。');
  if (value.layout !== undefined && !['grid', 'list'].includes(String(value.layout))) return fail('layout 无效。');
  if (value.mode !== undefined && !['list', 'bars', 'histogram'].includes(String(value.mode))) return fail('mode 无效。');
  if (value.fields !== undefined && (!Array.isArray(value.fields) || value.fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)))) return fail('fields 必须是直接字段名数组。');
  if (value.columns !== undefined && (!Array.isArray(value.columns) || value.columns.some(column => !record(column) || typeof column.key !== 'string' || typeof column.label !== 'string' || Object.keys(column).some(key => !['key', 'label', 'align'].includes(key)) || column.align !== undefined && !['left', 'right'].includes(String(column.align))))) return fail('columns 格式无效。');
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length > (schema.properties!.items?.maxItems ?? 200) || value.items.some(item => !record(item) || !Object.keys(item).length || Object.entries(item).some(([key, field]) => {
    if (['entity', 'targetKind'].includes(key)) return typeof field !== 'string' || !['subject', 'character', 'person', 'episode', 'revision', 'user', 'index'].includes(field);
    if (key === 'username') return typeof field !== 'string' || !field.trim();
    return !['id', 'subjectId', 'episodeId', 'characterId', 'personId', 'revisionId', 'targetId', 'relationId', 'ownerId'].includes(key) || typeof field !== 'number' || !Number.isSafeInteger(field) || field < 1;
  })))) return fail('items 只允许实体身份和复合主键。');
  return structuredClone(value) as unknown as ResourceReferenceProps;
}
export function resourcePlaceholder(kind: ComponentKind): MixedPart { return { type: kind, pending: true, props: kind === 'TagCloud' ? [] : {} } as MixedPart; }
const scalar = (value: unknown): string => value == null ? '' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join('、') : fail('展示字段不是可验证的标量。');
const compact = (value: Row): Row => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
function unwrap(row: Row, kind: ComponentKind): Row {
  const identities = Object.fromEntries(['subject', 'episode', 'person', 'character'].flatMap(entity => record(row[entity]) && row[entity].id !== undefined ? [[`${entity}Id`, row[entity].id]] : []));
  const order = kind === 'SubjectCards' ? ['subject', 'episode', 'target', 'character', 'person'] : ['character', 'person', 'episode', 'target', 'subject'];
  const nested = order.map(key => row[key]).find(record);
  const result: Row = nested ? { ...row, ...identities, ...nested } : record(row.facts) ? { ...row, ...row.facts, entity: row.entity ?? 'subject' } : { ...row };
  const merge = (field: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (result[field] !== undefined && result[field] !== null && !isDeepStrictEqual(result[field], value)) return fail(`缓存资料的 ${field} 字段相互冲突。`);
    result[field] = structuredClone(value);
  };
  // 只展开固定规范化字段组；不递归展开任意来源对象。
  if (record(row.collection)) {
    const collection = row.collection;
    if (row.target && record(row.target) && row.target.kind === 'subject' && collection.subjectId !== undefined && collection.subjectId !== row.target.id)
      return fail('收藏字段与原目标身份冲突。');
    if (record(collection.target)) {
      const target = collection.target;
      if (record(row.target) && row.target.kind !== undefined && target.entity !== row.target.kind) return fail('收藏实体类型与原目标身份冲突。');
      for (const field of ['id', 'entity', 'name', 'nameCn', 'personType', 'characterType', 'career', 'nsfw', 'url', 'image']) merge(field, target[field]);
    }
    for (const field of ['subjectId', 'collectionStatus', 'personalRating', 'personalTags', 'private', 'chapters', 'volumes', 'collected', 'createdAt']) merge(field, collection[field]);
    merge('personalComment', collection.comment); merge('comment', collection.comment);
  }
  if (row.kind === 'collectionState') merge('collectionState', row.state);
  if (record(row.subjectFacts)) {
    const facts = row.subjectFacts;
    for (const field of ['airDate', 'platform', 'score', 'ratingCount']) merge(field, facts[field]);
    merge('subjectForm', facts.form);
    if (result.date === undefined || result.date === null) merge('date', facts.airDate);
  }
  if (record(row.ownCollection)) {
    const own = row.ownCollection;
    merge('collectionState', own.state);
    for (const field of ['collectionStatus', 'chapters', 'volumes', 'personalRating', 'personalTags', 'personalComment']) merge(field, own[field]);
  }
  return result;
}
function sourceRows(value: Row, kind: ComponentKind): Row[] {
  if (value.kind === 'weekly_schedule' && Array.isArray(value.data)) return value.data.flatMap(day => record(day) && record(day.subjects) ? sourceRows(day.subjects, kind) : fail('每周放送缓存结构错误。'));
  const rows = Array.isArray(value.data) ? value.data : record(value.data) ? [value.data] : Array.isArray(value.items) ? value.items : [value];
  const scope = record(value.scope) ? value.scope : {};
  const parentIds = Object.fromEntries(['subject', 'episode', 'person', 'character'].flatMap(entity => scope[`${entity}_id`] !== undefined ? [[`${entity}Id`, scope[`${entity}_id`]]] : []));
  return rows.flatMap(row => {
    if (!record(row)) return fail('缓存成员格式错误。');
    const entity = unwrap(row, kind);
    const entityKind = entity.entity === 'subject_candidate' ? 'subject' : entity.entity ?? (value.entity === 'subject_candidate' ? 'subject' : value.entity);
    const principal = typeof entityKind === 'string' && typeof entity.id === 'number' ? { [`${entityKind}Id`]: entity.id } : {};
    return [{ ...parentIds, ...principal, ...entity }];
  });
}
function selectRows(value: Row, props: ResourceReferenceProps, kind: ComponentKind): Row[] {
  const rows = sourceRows(value, kind);
  if (!props.items) return rows;
  const selected = props.items.map(key => {
    const matches = rows.filter(row => Object.entries(key).every(([name, expected]) => {
      const actual = row[name] ?? (name === 'entity' ? value.entity : undefined);
      return actual === expected || name === 'entity' && actual === 'subject_candidate' && expected === 'subject';
    }));
    if (matches.length !== 1) return fail('引用成员不存在或复合主键不唯一。', [{ path: '/props/items', rule: 'resource_membership', message: '选择成员必须属于当前引用且身份唯一。' }]);
    return matches[0]!;
  });
  if (new Set(selected).size !== selected.length) return fail('引用成员重复。', [{ path: '/props/items', rule: 'resource_member_duplicate', message: '选择成员不能重复指向同一缓存对象。' }]);
  return selected;
}
/** 只将明确作品身份送给宿主；关联角色/章节等身份仍按原复合主键选取。 */
function subjectSelection(props: ResourceReferenceProps): CachedResourceSelection | undefined {
  if (!props.items?.length) return undefined;
  const ids = props.items.map(item => {
    if (typeof item.subjectId === 'number') return item.subjectId;
    if (typeof item.id === 'number' && (item.entity === 'subject' || Object.keys(item).every(key => key === 'id'))) return item.id;
    return undefined;
  });
  if (ids.some(id => id === undefined)) return undefined;
  if (new Set(ids).size !== ids.length) return fail('引用作品成员重复。');
  return { subjectIds: ids as number[] };
}
const factFields = new Set(['id', 'subjectId', 'characterId', 'personId', 'episodeId', 'name', 'nameCn', 'subjectType', 'subjectForm', 'date', 'airDate', 'score', 'rank', 'ratingCount', 'summary', 'url', 'platform', 'totalEpisodes', 'totalVolumes', 'sort', 'episodeType', 'duration', 'collectionStatus', 'collectionState', 'personalRating', 'personalTags', 'personalComment', 'private', 'collected', 'chapters', 'volumes', 'updatedAt', 'revisionId', 'createdAt', 'title', 'description', 'relation', 'staff', 'username', 'comment', 'statusMeaning', 'episodeStatus', 'totalSubjects', 'nsfw', 'tags']);
const derivedFields = new Set(['subjectId', 'characterId', 'personId', 'episodeId', 'subjectForm', 'date', 'airDate', 'platform', 'score', 'ratingCount',
  'collectionStatus', 'collectionState', 'personalRating', 'personalTags', 'personalComment', 'comment', 'private', 'collected', 'chapters', 'volumes', 'createdAt']);
function field(row: Row, key: string, policy?: ReadonlySet<string>): unknown {
  if (!(policy ? policy.has(key) || derivedFields.has(key) : factFields.has(key))) return fail(`展示字段 ${key} 未登记。`);
  return row[key];
}

/** 仅解析当前轮次的缓存；没有网络补读，也不执行模型提供的表达式。 */
export async function expandResourceContent(kind: ComponentKind, input: ResourceReferenceProps, resolver?: ResourceContentResolver, signal?: AbortSignal): Promise<CompleteComponentPart> {
  const props = normalizeResourceReference(input, false, kind);
  if (!resolver) return fail('当前会话没有资源引用解析器。');
  if (signal?.aborted) throw new ContentOutputError('资源展开已取消。');
  let cached: Awaited<ReturnType<ResourceContentResolver>>;
  try { cached = await resolver(props.resourceRef, signal, subjectSelection(props)); }
  catch (error) { if (error instanceof ContentOutputError) throw error; throw resourceReadFailure(error); }
  if (signal?.aborted) throw new ContentOutputError('资源展开已取消。');
  if (cached.resourceRef !== props.resourceRef || !record(cached.value)) return fail('缓存返回的资源与引用不一致。');
  const value = cached.value.kind === 'candidate_continuation' && record(cached.value.result) && cached.value.result.kind === 'candidate_page'
    ? cached.value.result : cached.value;
  const presentation = value.presentation;
  const prepared = record(presentation) && Array.isArray(presentation.content) ? presentation.content : record(presentation) && typeof presentation.type === 'string' ? [presentation] : undefined;
  if (prepared) {
    const candidates = prepared.filter(part => record(part) && part.type === kind);
    const selected = candidates[props.partIndex ?? 0];
    if (!selected || (props.partIndex === undefined && candidates.length !== 1)) return fail('展示快照含多个组件，请指定 partIndex。');
    const snapshotProps = record(selected) && record(selected.props) ? selected.props : undefined;
    for (const key of Object.keys(props)) {
      if (['resourceRef', 'partIndex'].includes(key)) continue;
      if ((key === 'title' || key === 'layout') && snapshotProps && Object.hasOwn(snapshotProps, key)
        && isDeepStrictEqual(snapshotProps[key], props[key])) continue;
      return fail('已准备快照不可被模型重新筛选或覆盖；请只传 resourceRef、必要的 partIndex，或与快照相同的 title/layout。');
    }
    return validateMixedPart(structuredClone(selected)) as CompleteComponentPart;
  }
  if (props.partIndex !== undefined) return fail('普通资源不支持 partIndex。');
  if (Object.keys(props).some(key => key !== 'resourceRef' && !referenceControls[kind].includes(key))) return fail(`${kind} 不支持此引用展示参数。`);
  if (props.fields && props.columns) return fail('表格不能同时提供 fields 与 columns。', ['fields', 'columns'].map(field => ({ path: `/props/${field}`, rule: 'mutually_exclusive', message: 'fields与columns只能选择一种。' })));
  if (value.responseView === 'reference' && Array.isArray(value.data) && value.data.length === 0
    && record(value.set) && Number(value.set.resultCount) > 0)
    return fail('此引用只保存候选进度，没有展示成员窗口；请沿 resultRef 读取缓存成员字段后使用新的资源引用，不能将非空结果展示为空集合。');
  const rows = selectRows(value, props, kind), title = props.title === undefined ? {} : { title: props.title };
  let policy: ReadonlySet<string> | undefined;
  try { policy = resourceFields(cached.sourceTool); } catch { /* 独立renderer或未知来源仅用固定安全字段回退。 */ }
  const readField = (row: Row, key: string): unknown => field(row, key, policy);
  let output: unknown;
  if (kind === 'SubjectCards') {
    output = { ...title, layout: props.layout ?? 'grid', items: rows.map(row => {
      if (!['subject', 'subject_candidate'].includes(String(row.entity ?? value.entity))) return fail('SubjectCards 只接受作品资源。');
      const kinds: Record<number, string> = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
      const name = typeof row.name === 'string' && row.name.trim() ? row.name : typeof row.nameCn === 'string' && row.nameCn.trim() ? row.nameCn : undefined;
      if (!kinds[Number(row.subjectType)] || !name || record(row.fieldStates) && (row.fieldStates.subjectType !== 'known'
        || row.fieldStates.name !== 'known' && row.fieldStates.nameCn !== 'known')) {
        const error = new AppError('CANDIDATE_REQUIRED_FACTS_MISSING', '卡片需要已核实的作品名称和媒体类型；请在原成员范围补齐必要事实。');
        Object.defineProperty(error, 'sourceTool', { value: cached.sourceTool });
        throw resourceReadFailure(error);
      }
      return compact({ id: row.id, name, kind: kinds[Number(row.subjectType)], nameCn: row.nameCn, image: row.image, score: row.score, scoreCount: row.ratingCount, rank: row.rank, date: row.date, summary: row.summary, tags: row.tags, url: row.url });
    }) };
  } else if (kind === 'Gallery') output = { ...title, items: rows.map(row => compact({ id: row.id, name: row.name ?? row.title ?? row.nickname ?? row.username, image: row.image, subtitle: row.relation ?? row.staff, url: row.url })) };
  else if (kind === 'LinkList') output = { ...title, links: rows.map(row => compact({ label: row.nameCn ?? row.name ?? row.title ?? row.nickname ?? row.username, url: row.url })) };
  else if (kind === 'DataTable') {
    const columns = props.columns ?? (props.fields ?? ['id', 'name']).map(key => ({ key, label: key }));
    output = { ...title, columns, rows: rows.map(row => Object.fromEntries(columns.map(column => [column.key, scalar(readField(row, column.key))]))) };
  } else if (kind === 'InfoBox') {
    if (rows.length !== 1) return fail('InfoBox 需要选择单个资源。');
    const row = rows[0]!;
    output = { ...title, rows: props.fields ? props.fields.map(key => ({ label: key, value: scalar(readField(row, key)) })) : Array.isArray(row.infobox) ? row.infobox.map(item => {
      if (!record(item)) return fail('infobox 格式错误。');
      return { label: item.key, value: Array.isArray(item.value) ? item.value.map(entry => record(entry) ? `${entry.k ?? ''}${entry.v ?? ''}` : fail('infobox 项格式错误。')).join('；') : scalar(item.value) };
    }) : fail('缓存没有 infobox；请指定 fields。') };
  } else if (kind === 'TagCloud') {
    const entries = rows.flatMap(row => Array.isArray(row.tagStats) ? row.tagStats : Array.isArray(row.tags) ? row.tags : []);
    output = entries.map(item => typeof item === 'string' ? { name: item } : record(item) ? compact({ name: item.name, count: item.count }) : fail('标签格式错误。'));
  } else if (kind === 'StatsCard') {
    if (rows.length !== 1 || !record(rows[0]!.ratingDistribution)) return fail('StatsCard 需要已取得的单个作品评分分布。');
    output = { ...title, mode: props.mode ?? 'histogram', entries: Object.entries(rows[0]!.ratingDistribution as Row).filter(([, count]) => count !== null).map(([label, count]) => ({ label, value: scalar(count) })) };
  } else if (kind === 'ProgressView') {
    const episodes = rows.map(row => ({ id: row.id, label: scalar(row.sort ?? row.name), state: row.episodeStatus === 2 ? 'done' : [0, 1, 3].includes(Number(row.episodeStatus)) && typeof row.episodeStatus === 'number' ? 'todo' : fail('章节进度缺少个人状态。') }));
    output = { ...title, episodes };
  } else if (kind === 'Timeline') output = { ...title, entries: rows.map(row => {
    const time = row.updatedAt ?? row.createdAt ?? row.date ?? row.airDate;
    const text = row.comment ?? row.changeNote ?? row.title ?? row.name;
    if (typeof time !== 'string' || typeof text !== 'string') return fail('时间线资源缺少时间或正文。');
    return compact({ time, text, actor: row.username });
  }) };
  else if (kind === 'CompareTable') {
    if (!record(value.before) || !record(value.after) || !props.fields?.length) return fail('CompareTable 需要同一缓存中的 before/after 及 fields。');
    output = { ...title, rows: props.fields.map(key => { const before = scalar(readField(value.before as Row, key)), after = scalar(readField(value.after as Row, key)); return { label: key, before, after, changed: before !== after }; }) };
  } else return fail(`${kind} 需要已准备的完整展示快照。`);
  const result = validateMixedPart({ type: kind, pending: false, props: output });
  return result as CompleteComponentPart;
}
