import { COMPONENT_KINDS, COMPONENT_PAYLOAD_SCHEMAS, type ComponentKind } from './content-schema.js';
import { resourceReferenceSchema } from './resource-content.js';
import type { JsonSchema } from '../support/tool-schema.js';

export const PRESENTATION_SYSTEM_MARKER = '[bangumi-presentation-v1]';
export const RENDER_TOOL_NAMES = COMPONENT_KINDS.map(kind => `render_${kind}`);
export const PREPARE_TOOL_NAMES = COMPONENT_KINDS.map(kind => `prepare_${kind}`);
export const PRESENTATION_TOOL_NAMES = ['prepare_component', 'present_component', 'present_text', ...RENDER_TOOL_NAMES, ...PREPARE_TOOL_NAMES] as const;
export const PRESENTATION_MODEL_TOOL_ROLES: ReadonlyMap<string, 'presentation' | 'definition'> = new Map([
  ...PRESENTATION_TOOL_NAMES.map(name => [name, 'presentation'] as const),
  ...['read_component_index', 'read_component_spec'].map(name => [name, 'definition'] as const),
]);
const ids = { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: { type: 'integer', minimum: 1 } };
/** 工具参数仅描述选择与展示意图；实体事实始终由宿主缓存构建。 */
export function presentationPrepareSchema(component: ComponentKind): JsonSchema {
  if (component === 'QuoteBlock' || component === 'Callout') {
    const payload = COMPONENT_PAYLOAD_SCHEMAS[component];
    return { ...structuredClone(payload), required: ['component', ...(payload.required ?? [])],
      properties: { component: { type: 'string', enum: [component] }, ...structuredClone(payload.properties) } };
  }
  const reference = resourceReferenceSchema(component);
  const { partIndex: _partIndex, items, ...controls } = reference.properties!;
  return { type: 'object', additionalProperties: false, required: ['component', 'resourceRef'],
    properties: { component: { type: 'string', enum: [component] }, ...structuredClone(controls),
      ...(component === 'CompareTable' ? {} : { subjectIds: { ...ids, maxItems: items?.maxItems ?? ids.maxItems }, ...(component === 'SubjectCards' ? {} : items ? { members: structuredClone(items) } : {}) }) } };
}
export const PREPARE_COMPONENT_SCHEMA: JsonSchema = { type: 'object', anyOf: COMPONENT_KINDS.map(presentationPrepareSchema) };
/** 固定工具名决定组件，声明与incoming校验使用同一份不可替换参数契约。 */
export function componentToolSchema(component: ComponentKind, atomic = true): JsonSchema {
  const base = presentationPrepareSchema(component);
  const properties = structuredClone(base.properties) as Record<string, JsonSchema>;
  delete properties.component;
  // 默认表格使用唯一列说明；高级准备保留直接字段快捷形式，不隐式接受别名。
  if (atomic && component === 'DataTable') delete properties.fields;
  const required = (base.required as string[]).filter(key => key !== 'component');
  if (component !== 'QuoteBlock' && component !== 'Callout') {
    properties.resourceRef = { ...properties.resourceRef, description: '单来源快捷形式；与sources二选一，成员必须属于本引用。' };
    properties.blockIndex = { type: 'integer', minimum: 0, description: '已准备快照的绝对组件下标；不能同时覆盖成员或布局。' };
    const selectionProperties: Record<string, JsonSchema> = { resourceRef: { ...properties.resourceRef, description: '本来源的当前缓存引用。' }, blockIndex: properties.blockIndex };
    for (const key of ['subjectIds', 'members']) if (properties[key]) selectionProperties[key] = properties[key]!;
    properties.sources = { type: 'array', minItems: 1, maxItems: ['InfoBox', 'StatsCard', 'CompareTable', 'TagCloud', 'Timeline'].includes(component) ? 1 : 50,
      description: '有序组合当前回合已取得的缓存引用，各来源各自选择其成员；不混入顶层resourceRef/成员。',
      items: { type: 'object', additionalProperties: false, required: ['resourceRef'], properties: selectionProperties } };
    required.splice(required.indexOf('resourceRef'), 1);
  }
  if (atomic) Object.assign(properties, {
    before: { type: 'string', maxLength: 65536, description: '紧邻组件前的用户说明，不另重复输出。' },
    after: { type: 'string', maxLength: 65536, description: '紧邻组件后的说明或结论。' },
    final: { type: 'boolean', description: '明确本次回答已完整交付；必须放在本批最后一个工具，整批成功后宿主结束用户回合。' },
  });
  return { type: 'object', additionalProperties: false, required, properties,
    ...(component === 'QuoteBlock' || component === 'Callout' ? {} : { oneOf: [
      { type: 'object', properties: { resourceRef: {} }, required: ['resourceRef'], not: { type: 'object', properties: { sources: {} }, required: ['sources'] } },
      { type: 'object', properties: { sources: {} }, required: ['sources'], not: { type: 'object', anyOf: ['resourceRef', 'subjectIds', 'members', 'blockIndex'].map(key => ({ type: 'object', properties: { [key]: {} }, required: [key] })) } },
    ] }),
  };
}
export const PRESENT_COMPONENT_SCHEMA: JsonSchema = { type: 'object', additionalProperties: false, required: ['resourceRef', 'blockIndex'], properties: {
  resourceRef: { type: 'string', pattern: '^rr_[A-Za-z0-9_-]+$' }, blockIndex: { type: 'integer', minimum: 0 },
} };
export const PRESENT_TEXT_SCHEMA: JsonSchema = { type: 'object', additionalProperties: false, required: ['text'], properties: {
  text: { type: 'string', minLength: 1, maxLength: 65536 },
} };
export interface PreparedBlockSummary { blockIndex: number; type: ComponentKind; itemCount: number }
export interface PreparedPresentationSummary { resourceRef: string; blocks: PreparedBlockSummary[] }
export const PRESENTATION_ERROR_SCHEMA = { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: {
  code: { type: 'string' }, message: { type: 'string' }, sourceTool: { type: 'string' }, networkAttempted: { type: 'boolean', enum: [false] },
  issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'rule', 'hint'], properties: {
    path: { type: 'string' }, rule: { type: 'string' }, hint: { type: 'string' }, allowed: { type: 'array', items: {} },
  } } },
  diagnostic: { type: 'object', additionalProperties: true }, rejection: { type: 'object', additionalProperties: true }, submission: { type: 'object', additionalProperties: true },
  accessContext: { type: 'object', additionalProperties: true }, recovery: { type: 'object', additionalProperties: true },
  diagnosis: { type: 'object', additionalProperties: true }, contractIssue: { type: 'object', additionalProperties: true },
} };
const errorSchema = PRESENTATION_ERROR_SCHEMA;
const publicationResult = { type: 'object', additionalProperties: false, required: ['replyId', 'blockIndex', 'reused'], properties: {
  replyId: { type: 'string' }, blockIndex: { type: 'integer', minimum: 0 }, reused: { type: 'boolean' },
} };
const prepareResult = { type: 'object', additionalProperties: false, required: ['resourceRef', 'blocks'], properties: {
  resourceRef: { type: 'string', pattern: '^rr_[A-Za-z0-9_-]+$' }, blocks: { type: 'array', minItems: 1, items: {
    type: 'object', additionalProperties: false, required: ['blockIndex', 'type', 'itemCount'], properties: {
      blockIndex: { type: 'integer', minimum: 0 }, type: { type: 'string', enum: [...COMPONENT_KINDS] }, itemCount: { type: 'integer', minimum: 0 },
    },
  } },
} };
export const RENDER_TOOL_DEFINITIONS = COMPONENT_KINDS.map(component => ({ name: `render_${component}`, component,
  inputSchema: componentToolSchema(component), outputSchema: { anyOf: [publicationResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } }));
export const PREPARE_TOOL_DEFINITIONS = COMPONENT_KINDS.map(component => ({ name: `prepare_${component}`, component,
  inputSchema: componentToolSchema(component, false), outputSchema: { anyOf: [prepareResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } }));
export const PRESENTATION_TOOL_DEFINITIONS = [
  ...RENDER_TOOL_DEFINITIONS, ...PREPARE_TOOL_DEFINITIONS,
  { name: 'prepare_component', inputSchema: PREPARE_COMPONENT_SCHEMA, outputSchema: { anyOf: [prepareResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
  { name: 'present_component', inputSchema: PRESENT_COMPONENT_SCHEMA, outputSchema: { anyOf: [publicationResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
  { name: 'present_text', inputSchema: PRESENT_TEXT_SCHEMA, outputSchema: { anyOf: [publicationResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
];
function freezeSchema(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeSchema); Object.freeze(value);
}
// 固定登记的参数不能在loadout或payload观察中被改成另一套incoming契约。
[...RENDER_TOOL_DEFINITIONS, ...PREPARE_TOOL_DEFINITIONS].forEach(definition => freezeSchema(definition.inputSchema));
