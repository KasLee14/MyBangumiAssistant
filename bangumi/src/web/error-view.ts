import type { AssistantMessage } from '@earendil-works/pi-ai';
import { assistantErrorDiagnostic, correlatedDiagnostic, type ErrorDiagnostic } from '../support/error-diagnostic.js';
import { credentialValues, redact, sanitizeErrorDiagnostic, safeError } from '../support/errors.js';

const summaries: Record<string, string> = {
  LLM_OUTPUT_TRUNCATED: '模型输出被长度限制截断，已完成组件保留。', LLM_CONTEXT_LIMIT: '模型输入超出上下文容量。',
  LLM_REQUEST_LIMIT_INVALID: '模型服务拒绝了请求中的生成额度。', LLM_STREAM_INTERRUPTED: '模型响应流未正常结束。',
  CONTENT_JSON_SYNTAX: '模型输出存在 JSON 语法错误。', CONTENT_JSON_INCOMPLETE: '模型输出的 JSON 未完整闭合。',
  CONTENT_SCHEMA_INVALID: '模型输出字段不符合组件契约。', CONTENT_LIMIT_EXCEEDED: '模型输出超过本地内容容量。',
};
/** 仅宿主接口投影：返回脱敏的结构化诊断，不生成前端详情布局或动作。 */
export function assistantErrorView(message: AssistantMessage): { text: string; diagnostic?: ErrorDiagnostic } {
  const diagnostic = assistantErrorDiagnostic(message);
  return { text: diagnostic && summaries[diagnostic.code] ? `${diagnostic.code}：${summaries[diagnostic.code]}` : redact(message.errorMessage ?? '模型请求失败。', credentialValues()),
    ...(diagnostic ? { diagnostic: sanitizeErrorDiagnostic(correlatedDiagnostic(diagnostic)) } : {}) };
}
export function exceptionErrorView(error: unknown): { text: string; diagnostic?: ErrorDiagnostic } {
  const safe = safeError(error);
  return { text: `${safe.code}：${safe.message}`, ...(safe.diagnostic ? { diagnostic: sanitizeErrorDiagnostic(correlatedDiagnostic(safe.diagnostic)) } : {}) };
}
