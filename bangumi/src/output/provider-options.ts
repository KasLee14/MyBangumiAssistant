import {
  getCurrentSystemMessage, getSystemMessageText,
  type Api, type Model, type ProviderRequestOptions, type TranscriptContext,
} from '@earendil-works/pi-ai';
import { CONTENT_OUTPUT_SYSTEM_MARKER, ContentOutputError } from './content-schema.js';

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

function constrainPayload(payload: unknown, model: Model<Api>): Record<string, unknown> {
  if (!object(payload) || (payload.text !== undefined && !object(payload.text))) {
    throw new ContentOutputError('混合内容输出需要对象请求体及对象 text 配置。', 'schema');
  }
  // 请求和 schema 均为每次调用深拷贝；回调可以修改自己的副本。
  const cloned = structuredClone(payload);
  if (model.api === 'openai-completions') {
    // DataTable 的动态对象行与历史回放一致，不转换为 strict schema 的矩阵。
    // JSON 对象约束负责语法，字段及组件完成状态由本地同一份 schema 校验。
    cloned.response_format = { type: 'json_object' };
    return cloned;
  }
  cloned.text = {
    ...(object(cloned.text) ? cloned.text : {}),
    format: { type: 'json_object' },
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
      const constrained = constrainPayload(payload, model);
      const replacement = await originalCallback?.(constrained, callbackModel);
      // 回调可观察/替换请求，但不能撤掉已启用的应用输出契约。
      return constrainPayload(replacement === undefined ? constrained : replacement, model);
    },
  } as O;
}
