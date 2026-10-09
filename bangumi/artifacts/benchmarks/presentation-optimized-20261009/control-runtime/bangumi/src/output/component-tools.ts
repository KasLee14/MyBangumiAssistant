import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { schemaArguments } from '../support/tool-schema.js';
import { safeError } from '../support/errors.js';
import { ComponentCatalogState } from './component-catalog.js';

export const COMPONENT_READ_TOOL_NAMES = ['read_component_index', 'read_component_spec'] as const;
export function createComponentReadTools(state: ComponentCatalogState): ToolDefinition[] {
  const definitions = [
    { name: 'read_component_index', description: '读取组件用途索引，不含字段Schema。需要结构化展示时先按中文用途或分类查询；nextOffset非空时可遍历下一页。普通解释可只输出text。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string', maxLength: 100 }, category: { type: 'string', maxLength: 30 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12 },
      } }, read: (args: Record<string, unknown>) => state.readIndex(args) },
    { name: 'read_component_spec', description: '读取所选组件最简prepare_component参数契约，一次可读取多个组件。完整同版本最新定义可跨用户轮复用；事实引用仅当前用户轮有效。宿主构建完整props，模型只选缓存成员和展示参数。',
      parameters: { type: 'object', additionalProperties: false, required: ['names'], properties: {
        names: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'string' } },
      } }, read: (args: Record<string, unknown>) => state.readPrepareSpecs(args.names as string[]) },
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
