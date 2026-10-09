import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { schemaArguments } from '../support/tool-schema.js';
import { safeError } from '../support/errors.js';
import { ComponentCatalogState } from './component-catalog.js';
import { COMPONENT_KINDS } from './content-types.js';
import { PRESENTATION_ERROR_SCHEMA } from './presentation-contract.js';

export const COMPONENT_READ_TOOL_NAMES = ['read_component_index', 'read_component_spec'] as const;
export const COMPONENT_READ_TOOL_DEFINITIONS = [
  { name: 'read_component_index', inputSchema: { type: 'object', additionalProperties: false, properties: {
    query: { type: 'string', maxLength: 100 }, category: { type: 'string', maxLength: 30 }, offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
  } }, outputSchema: { anyOf: [{ type: 'object', additionalProperties: false, required: ['version', 'entries', 'total', 'offset', 'nextOffset', 'categories'], properties: { version: { type: 'string' }, entries: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'category', 'purpose', 'data'], properties: { name: { type: 'string' }, category: { type: 'string' }, purpose: { type: 'string' }, data: { type: 'string' } } } }, total: { type: 'integer' }, offset: { type: 'integer' }, nextOffset: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, categories: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', additionalProperties: false, required: ['error'], properties: { error: PRESENTATION_ERROR_SCHEMA } }] } },
  { name: 'read_component_spec', inputSchema: { type: 'object', additionalProperties: false, required: ['names'], properties: {
    names: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'string', enum: [...COMPONENT_KINDS] } },
    mode: { type: 'string', enum: ['render', 'prepare'], default: 'render' },
  } }, outputSchema: { anyOf: [{ type: 'object', additionalProperties: false, required: ['version', 'status', 'tools'], properties: { version: { type: 'string' }, status: { type: 'string', enum: ['activated'] }, tools: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', additionalProperties: false, required: ['error'], properties: { error: PRESENTATION_ERROR_SCHEMA } }] } },
];
export function createComponentReadTools(state: ComponentCatalogState, activate?: (names: string[]) => void): ToolDefinition[] {
  const definitions = [
    { name: 'read_component_index', description: '读取组件用途索引，不含字段Schema。不确定组件名称时按中文用途或分类发现；nextOffset非空时可遍历下一页。明确名称可直接read_component_spec。普通解释可只输出text。',
      read: (args: Record<string, unknown>) => { const { audit: _audit, ...result } = state.readIndex(args); return result; } },
    { name: 'read_component_spec', description: '按明确的固定组件名称直接加载render工具Schema到下一次真实模型请求，无需预读用途索引，回执仅版本和工具名。不在同批调用新工具。mode默认render；只有需要先冻结再发布时选择prepare加载高级两步工具。',
      read: (args: Record<string, unknown>) => {
        if (!activate) throw new Error('组件加载器没有连接当前Pi工具目录。');
        return state.loadSpecs(args.names as string[], args.mode === 'prepare' ? 'prepare' : 'render', activate);
      } },
  ];
  return definitions.map(definition => ({ name: definition.name, label: definition.name, description: definition.description,
    parameters: COMPONENT_READ_TOOL_DEFINITIONS.find(item => item.name === definition.name)!.inputSchema as ToolDefinition['parameters'], executionMode: 'sequential',
    prepareArguments: raw => schemaArguments(COMPONENT_READ_TOOL_DEFINITIONS.find(item => item.name === definition.name)!.inputSchema, raw),
    async execute(_id, raw, signal) {
      if (signal?.aborted) throw new Error('组件契约读取已取消。');
      try {
        const result = definition.read(schemaArguments(COMPONENT_READ_TOOL_DEFINITIONS.find(item => item.name === definition.name)!.inputSchema, raw));
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const result = { error: safeError(error) };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, isError: true };
      }
    },
  }));
}
