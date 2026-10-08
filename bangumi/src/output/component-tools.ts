import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { schemaArguments } from '../support/tool-schema.js';
import { safeError } from '../support/errors.js';
import { ComponentCatalogState, type ComponentRepresentationChoice } from './component-catalog.js';

export const COMPONENT_READ_TOOL_NAMES = ['read_component_index', 'read_component_spec'] as const;
export function createComponentReadTools(state: ComponentCatalogState): ToolDefinition[] {
  const definitions = [
    { name: 'read_component_index', description: '读取组件用途索引，不含字段Schema。需要结构化展示时先按中文用途或分类查询；nextOffset非空时可遍历下一页。普通解释可只输出text。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string', maxLength: 100 }, category: { type: 'string', maxLength: 30 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12 },
      } }, read: (args: Record<string, unknown>) => state.readIndex(args) },
    { name: 'read_component_spec', description: '读取当前可见目录中组件的唯一props契约，一次可读取多个组件。完整同版本最新契约在上下文可见时可跨用户轮复用，不必重读；事实引用只当前轮有效。representation默认auto：有适用缓存引用用reference，否则inline，可显式切换。不能混填，未支持事实用text或其他组件。无可复用定义时先索引再字段。',
      parameters: { type: 'object', additionalProperties: false, required: ['names'], properties: {
        names: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'string' } },
        representation: { type: 'string', enum: ['auto', 'reference', 'inline'] },
      } }, read: (args: Record<string, unknown>) => state.readSpecs(args.names as string[], args.representation as ComponentRepresentationChoice | undefined) },
  ];
  return definitions.map(definition => ({ name: definition.name, label: definition.name, description: definition.description,
    parameters: definition.parameters as ToolDefinition['parameters'], executionMode: 'sequential',
    prepareArguments: raw => schemaArguments(definition.parameters, raw),
    async execute(_id, raw, signal) {
      if (signal?.aborted) throw new Error('组件契约读取已取消。');
      try {
        const result = definition.read(schemaArguments(definition.parameters, raw));
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const result = { error: safeError(error) };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, isError: true };
      }
    },
  }));
}
