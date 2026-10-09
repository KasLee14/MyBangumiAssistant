import { COMPONENT_KINDS, COMPONENT_PAYLOAD_SCHEMAS, type ComponentKind } from './content-schema.js';
import { resourceReferenceSchema } from './resource-content.js';
import type { JsonSchema } from '../support/tool-schema.js';

export const PRESENTATION_SYSTEM_MARKER = '[bangumi-presentation-v1]';
export const PRESENTATION_TOOL_NAMES = ['prepare_component', 'present_component', 'present_text'] as const;
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
export const PRESENT_COMPONENT_SCHEMA: JsonSchema = { type: 'object', additionalProperties: false, required: ['resourceRef', 'blockIndex'], properties: {
  resourceRef: { type: 'string', pattern: '^rr_[A-Za-z0-9_-]+$' }, blockIndex: { type: 'integer', minimum: 0 },
} };
export const PRESENT_TEXT_SCHEMA: JsonSchema = { type: 'object', additionalProperties: false, required: ['text'], properties: {
  text: { type: 'string', minLength: 1, maxLength: 65536 },
} };
export interface PreparedBlockSummary { blockIndex: number; type: ComponentKind; itemCount: number }
export interface PreparedPresentationSummary { resourceRef: string; blocks: PreparedBlockSummary[] }
const errorSchema = { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: {
  code: { type: 'string' }, message: { type: 'string' }, sourceTool: { type: 'string' }, networkAttempted: { type: 'boolean', enum: [false] },
  issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'rule', 'hint'], properties: {
    path: { type: 'string' }, rule: { type: 'string' }, hint: { type: 'string' }, allowed: { type: 'array', items: {} },
  } } },
  diagnostic: { type: 'object', additionalProperties: true }, rejection: { type: 'object', additionalProperties: true }, submission: { type: 'object', additionalProperties: true },
  accessContext: { type: 'object', additionalProperties: true }, recovery: { type: 'object', additionalProperties: true },
  diagnosis: { type: 'object', additionalProperties: true }, contractIssue: { type: 'object', additionalProperties: true },
} };
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
export const PRESENTATION_TOOL_DEFINITIONS = [
  { name: 'prepare_component', inputSchema: PREPARE_COMPONENT_SCHEMA, outputSchema: { anyOf: [prepareResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
  { name: 'present_component', inputSchema: PRESENT_COMPONENT_SCHEMA, outputSchema: { anyOf: [publicationResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
  { name: 'present_text', inputSchema: PRESENT_TEXT_SCHEMA, outputSchema: { anyOf: [publicationResult, { type: 'object', additionalProperties: false, required: ['error'], properties: { error: errorSchema } }] } },
];
