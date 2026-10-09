// 旧JSON历史/恢复验收显式运行旧生成标记；生产扩展默认使用新展示工具。
import { createBangumiExtension, extensionComponentCatalog } from '../dist/src/extension.js';
import { createComponentReadTools } from '../dist/src/output/component-tools.js';
import { LEGACY_CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { schemaArguments } from '../dist/src/support/tool-schema.js';
export function createLegacyComponentReadTools(state) {
  return createComponentReadTools(state).map(tool => tool.name !== 'read_component_spec' ? tool : {
    ...tool, parameters: { type: 'object', additionalProperties: false, required: ['names'], properties: {
      names: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'string' } },
      representation: { type: 'string', enum: ['auto', 'reference', 'inline'] },
    } },
    prepareArguments(raw) { return schemaArguments(this.parameters, raw); },
    async execute(_id, args) { const result = state.readSpecs(args.names, args.representation); return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }; },
  });
}
export function createLegacyBangumiExtension(config) {
  return pi => {
    createBangumiExtension(config)(pi);
    pi.on('before_agent_start', event => { event.systemPromptOptions.sections.bangumi_content_output = LEGACY_CONTENT_OUTPUT_INSTRUCTION; });
    for (const tool of createLegacyComponentReadTools(extensionComponentCatalog(pi))) pi.registerTool(tool);
  };
}
