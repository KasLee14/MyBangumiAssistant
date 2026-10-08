import {
  getCurrentSystemMessage, getSystemMessageText,
  type Api, type Model, type ProviderRequestOptions, type TranscriptContext,
} from '@earendil-works/pi-ai';
import { CONTENT_OUTPUT_SYSTEM_MARKER, ContentOutputError } from './content-schema.js';
import { PROVIDER_CONTENT_SCHEMA } from './provider-content.js';
import { componentCatalogFor, providerSchemaForComponents, strictProviderSchema } from './component-catalog.js';
import { orderDeepSeekRecoveryReasoning } from './deepseek-responses-replay.js';

/** 只读取有效系统规则；用户或工具结果不能启用应用输出协议。 */
export function shouldUseMixedContent(model: Model<Api>, context: TranscriptContext): boolean {
  const system = getCurrentSystemMessage(context.messages);
  if (!system || !getSystemMessageText(system).includes(CONTENT_OUTPUT_SYSTEM_MARKER)) return false;
  if (model.api !== 'openai-responses' && model.api !== 'openai-completions') {
    throw new ContentOutputError(`混合内容输出暂不支持模型 API：${model.api}。`, 'unsupported');
  }
  return true;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOfficialDeepSeekResponses(model: Model<Api>): boolean {
  let endpoint: URL;
  try { endpoint = new URL(model.baseUrl); } catch { return false; }
  return model.api === 'openai-responses' && model.provider === 'deepseek' && endpoint.protocol === 'https:'
    && endpoint.hostname === 'api.deepseek.com' && ['', '/', '/v1', '/v1/'].includes(endpoint.pathname)
    && ['deepseek-flash', 'deepseek-v4-pro'].includes(model.id);
}

/** 协议兼容不代表正文能力兼容。官方DeepSeek只在Responses路径启用已声明的json_schema。 */
export function supportsStrictContentSchema(model: Model<Api>): boolean {
  if (isOfficialDeepSeekResponses(model)) return true;
  let endpoint: URL;
  try { endpoint = new URL(model.baseUrl); } catch { return false; }
  if (model.provider !== 'openai' || endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.openai.com') return false;
  return /^(gpt-4o-mini(?:-|$)|gpt-4o(?:$|-2024-(?:08|11))|gpt-4\.1(?:-|$)|gpt-[56](?:-|$)|o3(?:-|$)|o4-mini(?:-|$))/u.test(model.id);
}

function constrainPayload(payload: unknown, model: Model<Api>, context: TranscriptContext): Record<string, unknown> {
  if (!object(payload) || (payload.text !== undefined && !object(payload.text))) {
    throw new ContentOutputError('混合内容输出需要对象请求体及对象 text 配置。', 'schema');
  }
  // 请求和 schema 均为每次调用深拷贝；回调可以修改自己的副本。
  let cloned = structuredClone(payload);
  if (isOfficialDeepSeekResponses(model) && Array.isArray(cloned.input)) {
    // Pi按OpenAI语义将推理模型系统规则编码为developer；DeepSeek将developer视为user。
    // 恢复真正的system角色，避免本地compat缺失时降级应用规则的权限。
    cloned.input = cloned.input.map(item => object(item) && item.role === 'developer' ? { ...item, role: 'system' } : item);
    cloned = orderDeepSeekRecoveryReasoning(cloned, context);
  }
  const state = componentCatalogFor(context);
  const audit = state?.currentAudit();
  const schema = audit ? providerSchemaForComponents(audit.loaded, audit.representations) : PROVIDER_CONTENT_SCHEMA;
  const strict = supportsStrictContentSchema(model) ? strictProviderSchema(schema) : undefined;
  if (model.api === 'openai-completions') {
    // DataTable 的动态对象行与历史回放一致，不转换为 strict schema 的矩阵。
    // JSON 对象约束负责语法，字段及组件完成状态由本地同一份 schema 校验。
    cloned.response_format = strict ? { type: 'json_schema', json_schema: { name: 'bangumi_content', strict: true, schema: strict } } : { type: 'json_object' };
    return cloned;
  }
  cloned.text = {
    ...(object(cloned.text) ? cloned.text : {}),
    // DeepSeek参考仅声明type/name/schema；不据此虚构function strict或strict开关的服务端保证。
    format: strict ? { type: 'json_schema', name: 'bangumi_content', ...(!isOfficialDeepSeekResponses(model) ? { strict: true } : {}), schema: strict } : { type: 'json_object' },
  };
  return cloned;
}

/** 保留原请求配置，通过 Pi 原生 onPayload 注入当前 API 的生成约束。 */
export function withContentConstraint<T extends Api, O extends ProviderRequestOptions<Model<T>>>(
  model: Model<T>, context: TranscriptContext, options: O | undefined,
): O | undefined {
  if (!shouldUseMixedContent(model, context)) return options;
  const originalCallback = options?.onPayload;
  return {
    ...options,
    onPayload: async (payload: unknown, callbackModel: Model<T>) => {
      const constrained = constrainPayload(payload, model, context);
      const replacement = await originalCallback?.(constrained, callbackModel);
      // 回调可观察/替换请求，但不能撤掉已启用的应用输出契约。
      return constrainPayload(replacement === undefined ? constrained : replacement, model, context);
    },
  } as O;
}
