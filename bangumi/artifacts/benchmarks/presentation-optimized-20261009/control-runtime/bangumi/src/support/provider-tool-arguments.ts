import { makeStrictJsonSchema } from '@earendil-works/pi-ai/api/constrained-sampling';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { JsonSchema } from './tool-schema.js';

/** 兼容 OpenAI 的协议名不代表服务支持 strict；请求和准备校验共享有效能力政策。 */
export type ToolProviderModel = Pick<Model<Api>, 'api' | 'compat'> & Partial<Pick<Model<Api>, 'provider' | 'baseUrl'>>;
const openAiToolApis = new Set(['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses']);
/** 与请求编码使用同一政策；未知兼容服务的协议名不构成 strict 能力证明。 */
export function toolModelSupportsStrict(model?: ToolProviderModel): boolean {
  if (!model || !openAiToolApis.has(model.api)) return false;
  const compat = model.compat;
  if (compat && 'supportsStrictMode' in compat && typeof compat.supportsStrictMode === 'boolean') return compat.supportsStrictMode;
  if (model.provider !== 'openai' || !model.baseUrl || !['openai-completions', 'openai-responses'].includes(model.api)) return false;
  try { return new URL(model.baseUrl).protocol === 'https:' && new URL(model.baseUrl).hostname === 'api.openai.com'; }
  catch { return false; }
}
/** 只覆盖单次请求的有效模型，不写入用户模型配置。 */
export function effectiveToolConstraintModel<T extends Api>(model: Model<T>): Model<T> {
  if (!openAiToolApis.has(model.api)) return model;
  return Object.assign({}, model, { compat: Object.assign({}, model.compat, { supportsStrictMode: toolModelSupportsStrict(model) }) });
}
export interface ToolConstraintState {
  schema: 'compatible' | 'fallback';
  provider: 'enabled' | 'unsupported';
  reason?: string;
}
export function toolConstraintState(schema: JsonSchema, model?: ToolProviderModel): ToolConstraintState {
  try { makeStrictJsonSchema(schema as ToolDefinition['parameters']); }
  catch (error) {
    return { schema: 'fallback', provider: 'unsupported', reason: error instanceof Error ? error.message : 'strict 子集不支持此契约' };
  }
  const enabled = toolModelSupportsStrict(model);
  return { schema: 'compatible', provider: enabled ? 'enabled' : 'unsupported' };
}

function acceptsNull(schema: JsonSchema): boolean {
  return schema.type === 'null' || Array.isArray(schema.type) && schema.type.includes('null')
    || schema.const === null || Array.isArray(schema.enum) && schema.enum.includes(null)
    || Array.isArray(schema.anyOf) && (schema.anyOf as JsonSchema[]).some(acceptsNull);
}
/**
 * strict 将原本可选字段变成 required + null。仅在明确启用 strict 的线路还原这些字段；
 * 未知键、必填 null、类型错误及原契约允许的 null 均保留，交给现有严格校验拒绝或接受。
 */
export function normalizeStrictOptionalNulls(schema: JsonSchema, raw: unknown, enabled: boolean): unknown {
  if (!enabled) return raw;
  const output: unknown = structuredClone(raw);
  const visit = (node: JsonSchema, value: unknown): void => {
    if (node.type === 'array' && Array.isArray(value) && node.items && typeof node.items === 'object') {
      value.forEach(item => visit(node.items as JsonSchema, item));
    } else if (node.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      for (const [key, child] of Object.entries(node.properties as Record<string, JsonSchema> ?? {})) {
        if (!Object.hasOwn(object, key)) continue;
        if (object[key] === null && !required.has(key) && !acceptsNull(child)) delete object[key];
        else visit(child, object[key]);
      }
    }
  };
  visit(schema, output);
  return output;
}
