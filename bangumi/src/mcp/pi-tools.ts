import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { AppError, safeError } from '../support/errors.js';
import { TOOL_DEFINITIONS, validateToolArguments } from './catalog.js';
import type { McpCallClient } from './client.js';
import { checkOutput, checkSubjectResponse } from './subject-output.js';
import { checkResourceResponse } from './resource-output.js';
import { resourceOutputSchema } from './resource-schemas.js';
import { isCommunityTool } from './community-schemas.js';
import { checkCommunityResponse } from './community-output.js';
import { checkAccessResponse } from './access-context.js';
import { diagnoseReadError } from './read-recovery.js';
import { projectModelResult } from './model-projection.js';
import { schemaArguments } from '../support/tool-schema.js';
import { stripResourceRef } from './resource-contract.js';
import { CollectionQueryInputState } from './collection-query-input.js';
export interface ReadToolInputContext {
  collectionQueries: CollectionQueryInputState;
  owner: () => string | undefined;
}
/** 写入接入由应用宿主实现，不向模型开放账户guard或授权标记。 */
export type McpWriteHandler = (
  name: string, args: Record<string, unknown>, signal: AbortSignal | undefined,
  ctx: ExtensionToolContext, toolCallId: string,
) => Promise<AgentToolResult<unknown>>;
function jsonResult(value: Record<string, unknown>, isError = false, name?: string, args: Record<string, unknown> = {}, projectionSource?: Record<string, unknown>): AgentToolResult<unknown> {
  // 完整结果保留固定MCP契约；模型content仅携带本次读取投影。
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 1_900_000) throw new AppError('MCP_OUTPUT_LIMIT', '结果超出单次返回容量。保持检索范围，使用候选引用、精简展示字段或按原范围分页续读；不能把缩小全集当作完整结果。');
  const modelValue = value.value && typeof value.value === 'object' && !Array.isArray(value.value)
    ? { value: projectModelResult(projectionSource ?? value.value as Record<string, unknown>, name, args) } : value;
  if (name) {
    const schema = TOOL_DEFINITIONS.find(tool => tool.name === name)?.modelOutputSchema;
    if (schema) checkOutput(schema, modelValue);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(modelValue) }], details: value,
    structuredContent: JSON.parse(serialized), ...(isError ? { isError: true } : {})
  };
}
/** Pi会再次用公开schema校验prepare结果；内部默认字段只在execute补入。 */
export function prepareModelToolArguments(name: string, raw: unknown): Record<string, unknown> {
  const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
  if (!definition) throw new AppError('UNKNOWN_TOOL', '未登记的Bangumi工具。');
  const publicArgs = schemaArguments(definition.modelInputSchema ?? definition.inputSchema, raw);
  validateToolArguments(name, publicArgs);
  return publicArgs;
}
/** Pi只负责原生工具循环；此桥接保留原始参数严格校验及MCP结果契约。 */
export function createMcpTools(client: McpCallClient, writeHandler?: McpWriteHandler, inputContext?: ReadToolInputContext): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter(definition => definition.effect === 'read' || writeHandler !== undefined).map(definition => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: structuredClone(definition.modelInputSchema ?? definition.inputSchema) as ToolDefinition['parameters'],
    ...(definition.effect === 'read' && definition.outputSchema
      ? { outputSchema: structuredClone(definition.modelOutputSchema) as ToolDefinition['parameters'] } : {}),
    executionMode: 'sequential' as const,
    // 在Pi的兼容类型转换之前执行；不删除非法字段、不转换类型、不回显原始值。
    prepareArguments: (raw: unknown) => {
      try {
        const publicArgs = prepareModelToolArguments(definition.name, raw);
        const args = validateToolArguments(definition.name, publicArgs);
        inputContext?.collectionQueries.validate(definition.name, args, inputContext.owner());
        return publicArgs;
      }
      catch (error) {
        // Pi在准备阶段只序列化Error.message；应用桥接提供同源JSON且保留严格失败。
        throw new AppError('INVALID_INPUT', JSON.stringify({
          error: safeError(diagnoseReadError(definition.name,
            raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}, error))
        }));
      }
    },
    async execute(toolCallId, raw, signal, _onUpdate, ctx) {
      try {
        const args = validateToolArguments(definition.name, raw);
        const owner = inputContext?.owner();
        inputContext?.collectionQueries.validate(definition.name, args, owner);
        if (definition.effect === 'write') return await writeHandler!(definition.name, args, signal, ctx, toolCallId);
        const value = await client.call(definition.name, args, signal);
        checkAccessResponse(definition.name, value);
        // 即使测试/嵌入宿主注入另一客户端，也不得绕过完整输出及对象/范围验证。
        if (definition.outputSchema) {
          checkOutput(definition.outputSchema, { value });
          checkSubjectResponse(definition.name, stripResourceRef(value), args, definition.inputSchema);
          if (isCommunityTool(definition.name)) checkCommunityResponse(definition.name, stripResourceRef(value), args,definition.outputSchema);
          if (resourceOutputSchema(definition.name)) checkResourceResponse(definition.name, value, args, definition.outputSchema);
        }
        if(definition.name==='read_cached_resource' && value && typeof value==='object') {
          const cached=value as Record<string,unknown>;
          const source=TOOL_DEFINITIONS.find(tool=>tool.name===cached.sourceTool&&tool.name!=='read_cached_resource');
          if(!source?.modelOutputSchema||!cached.value||typeof cached.value!=='object')throw new AppError('MCP_INVALID_RESULT','缓存投影缺少已登记来源契约。');
          const projectedSchema=structuredClone(source.modelOutputSchema);
          const windows=(node:unknown):void=>{if(Array.isArray(node)){node.forEach(windows);return;}if(!node||typeof node!=='object')return;
            const row=node as Record<string,unknown>;if(row.type==='string'&&typeof row.maxLength==='number'&&row.maxLength<5000&&row.maxLength>=500)row.maxLength=5000;
            Object.values(row).forEach(windows);};windows(projectedSchema);
          checkOutput(projectedSchema,{value:cached.value});
        }
        if (owner === inputContext?.owner()) inputContext?.collectionQueries.remember(definition.name, args, value, owner);
        // 首次字段读取保留原工具窗口；全量缓存事实续读由read_cached_resource显式完成。
        return jsonResult({ value }, false, definition.name, args);
      } catch (error) {
        let result = {
          error: safeError(definition.effect === 'read' ? diagnoseReadError(definition.name,
            raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}, error) : error)
        };
        if (definition.effect === 'read' && definition.outputSchema) {
          try {
            if (result.error.sourceTool !== undefined && result.error.sourceTool !== definition.name
              || result.error.recovery !== undefined && result.error.code !== 'MCP_INVALID_RESULT') throw new AppError('MCP_INVALID_RESULT', '错误来源或恢复分类无效。');
            checkOutput(definition.outputSchema, result);
          } catch { result = { error: { code: 'MCP_INVALID_RESULT', message: '本地工具错误不符合固定输出契约。' } }; }
        }
        return jsonResult(result, true, definition.name);
      }
    },
  }));
}
export function createReadTools(client: McpCallClient, inputContext?: ReadToolInputContext): ToolDefinition[] { return createMcpTools(client, undefined, inputContext); }
