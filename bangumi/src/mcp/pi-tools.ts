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

/** 写入接入由应用宿主实现，不向模型开放账户guard或授权标记。 */
export type McpWriteHandler = (
  name: string, args: Record<string, unknown>, signal: AbortSignal | undefined,
  ctx: ExtensionToolContext, toolCallId: string,
) => Promise<AgentToolResult<unknown>>;

function jsonResult(value: Record<string, unknown>, isError = false): AgentToolResult<unknown> {
  // 完整结果保留固定MCP契约；模型content仅携带本次读取投影。
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 1_900_000) throw new AppError('MCP_OUTPUT_LIMIT', '结果超出单次返回容量。保持检索范围，使用候选引用、精简展示字段或按原范围分页续读；不能把缩小全集当作完整结果。');
  const modelValue = value.value && typeof value.value === 'object' && !Array.isArray(value.value)
    ? { value: projectModelResult(value.value as Record<string, unknown>) } : value;
  return { content: [{ type: 'text', text: JSON.stringify(modelValue) }], details: value,
    structuredContent: JSON.parse(serialized), ...(isError ? { isError: true } : {}) };
}

/** Pi只负责原生工具循环；此桥接保留原始参数严格校验及MCP结果契约。 */
export function createMcpTools(client: McpCallClient, writeHandler?: McpWriteHandler): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter(definition => definition.effect === 'read' || writeHandler !== undefined).map(definition => ({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: structuredClone(definition.inputSchema) as ToolDefinition['parameters'],
    ...(definition.effect === 'read' && definition.outputSchema
      ? { outputSchema: structuredClone(definition.outputSchema) as ToolDefinition['parameters'] } : {}),
    executionMode: 'sequential' as const,
    // 在Pi的兼容类型转换之前执行；不删除非法字段、不转换类型、不回显原始值。
    prepareArguments: (raw: unknown) => {
      try { return validateToolArguments(definition.name, raw); }
      catch (error) {
        // Pi在准备阶段只序列化Error.message；应用桥接提供同源JSON且保留严格失败。
        throw new AppError('INVALID_INPUT', JSON.stringify({ error: safeError(diagnoseReadError(definition.name,
          raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}, error)) }));
      }
    },
    async execute(toolCallId, raw, signal, _onUpdate, ctx) {
      try {
        const args = validateToolArguments(definition.name, raw);
        if (definition.effect === 'write') return await writeHandler!(definition.name, args, signal, ctx, toolCallId);
        const value = await client.call(definition.name, args, signal);
        checkAccessResponse(definition.name, value);
        // 即使测试/嵌入宿主注入另一客户端，也不得绕过完整输出及对象/范围验证。
        if (definition.outputSchema) {
          checkOutput(definition.outputSchema, { value });
          checkSubjectResponse(definition.name, value, args, definition.inputSchema);
          if (isCommunityTool(definition.name)) checkCommunityResponse(definition.name, value, args);
          if (resourceOutputSchema(definition.name)) checkResourceResponse(definition.name, value, args, definition.outputSchema);
        }
        return jsonResult({ value });
      } catch (error) {
        let result = { error: safeError(definition.effect === 'read' ? diagnoseReadError(definition.name,
          raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}, error) : error) };
        if (definition.effect === 'read' && definition.outputSchema) {
          try {
            if (result.error.sourceTool !== undefined && result.error.sourceTool !== definition.name
              || result.error.recovery !== undefined && result.error.code !== 'MCP_INVALID_RESULT') throw new AppError('MCP_INVALID_RESULT', '错误来源或恢复分类无效。');
            checkOutput(definition.outputSchema, result);
          } catch { result = { error: { code: 'MCP_INVALID_RESULT', message: '本地工具错误不符合固定输出契约。' } }; }
        }
        return jsonResult(result, true);
      }
    },
  }));
}

export function createReadTools(client: McpCallClient): ToolDefinition[] { return createMcpTools(client); }
