import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai';
import { ERROR_ORIGINS, ERROR_STAGES, ERROR_RECOVERIES, type DiagnosticCause, type ErrorDiagnostic } from './error-diagnostic-types.js';
export { ERROR_ORIGINS, ERROR_STAGES, ERROR_RECOVERIES } from './error-diagnostic-types.js';
export type { DiagnosticIssue, DiagnosticCause, ErrorDiagnostic } from './error-diagnostic-types.js';
const evidenceKeys = ['provider', 'model', 'api', 'providerCode', 'responseId', 'rawStopReason', 'requestMaxTokens', 'configuredMaxTokens',
  'outputTokens', 'reasoningTokens', 'inputTokens', 'contextWindow', 'contextClamped', 'requestBelowConfigured', 'bytes', 'byteLimit', 'partCount',
  'partLimit', 'completedParts', 'completedComponents', 'pendingComponents', 'subjectCount', 'jsonComplete',
  'httpStatus', 'rpcCode', 'networkAttempted', 'submissionState', 'offset', 'line', 'column'] as const;
const shortString = { type: 'string', maxLength: 300 };
const closed = (properties: Record<string, unknown>, required = Object.keys(properties)): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });
export const ERROR_DIAGNOSTIC_SCHEMA = closed({
  schemaVersion: { const: 1 }, errorId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
  code: { type: 'string', pattern: '^[A-Z][A-Z_0-9]{0,79}$' }, reason: { type: 'string', pattern: '^[a-z][a-z_0-9]{0,79}$' },
  origin: { enum: [...ERROR_ORIGINS] }, stage: { enum: [...ERROR_STAGES] }, certainty: { enum: ['confirmed', 'inferred', 'unknown'] }, recovery: { enum: [...ERROR_RECOVERIES] },
  operation: { type: 'string', maxLength: 100, pattern: '^[a-zA-Z0-9_.-]+$' },
  issues: { type: 'array', maxItems: 8, items: closed({ path: { type: 'string', maxLength: 300 }, rule: { type: 'string', maxLength: 80 }, message: shortString, expected: shortString, actualType: shortString }, ['path', 'rule', 'message']) },
  evidence: closed(Object.fromEntries(evidenceKeys.map(key => [key, { anyOf: [shortString, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] }])), []),
  causes: { type: 'array', maxItems: 4, items: closed({ name: { type: 'string', maxLength: 100 }, code: { type: 'string', maxLength: 100 } }, ['name']) },
  links: closed({ traceId: { type: 'string', pattern: '^[a-f0-9]{32}$' }, spanId: { type: 'string', pattern: '^[a-f0-9]{16}$' }, sessionId: { type: 'string', maxLength: 100 } }),
}, ['schemaVersion', 'errorId', 'code', 'reason', 'origin', 'stage', 'certainty', 'recovery', 'issues', 'evidence', 'causes']);
const validate = new Ajv({ strict: true, allErrors: true }).compile(ERROR_DIAGNOSTIC_SCHEMA);
export function isErrorDiagnostic(value: unknown): value is ErrorDiagnostic { return Boolean(validate(value)); }

/** 恢复字段仅为诊断建议；本模块不授权、不重试、不改变写入状态。 */
export function createErrorDiagnostic(input: Pick<ErrorDiagnostic, 'code' | 'origin' | 'stage'> & Partial<Omit<ErrorDiagnostic, 'schemaVersion' | 'errorId'>>): ErrorDiagnostic {
  const diagnostic: ErrorDiagnostic = { schemaVersion: 1, errorId: randomUUID(), reason: 'operation_failed', certainty: 'confirmed', recovery: 'none', issues: [], evidence: {}, causes: [], ...structuredClone(input) };
  diagnostic.issues = diagnostic.issues.slice(0, 8).map(issue => ({ ...issue, path: issue.path.slice(0, 300), message: issue.message.slice(0, 300),
    ...(issue.expected === undefined ? {} : { expected: issue.expected.slice(0, 300) }) }));
  if (!isErrorDiagnostic(diagnostic)) throw new Error('本地错误诊断不符合固定契约。');
  return diagnostic;
}

const fallbackDiagnostics = new WeakMap<object, ErrorDiagnostic>();
const defaults: Record<string, Pick<ErrorDiagnostic, 'origin' | 'stage' | 'recovery'>> = {
  INVALID_INPUT: { origin: 'domain', stage: 'input', recovery: 'correct_parameters' },
  MCP_INVALID_RESULT: { origin: 'mcp', stage: 'validate', recovery: 'none' },
  INVALID_RESPONSE: { origin: 'http', stage: 'decode', recovery: 'replan_read' },
  BGM_NETWORK: { origin: 'http', stage: 'fetch', recovery: 'retry_request' },
  BGM_TIMEOUT: { origin: 'http', stage: 'fetch', recovery: 'retry_request' },
  BGM_AUTH_REQUIRED: { origin: 'http', stage: 'access', recovery: 'relogin' },
  BGM_AUTH_EXPIRED: { origin: 'http', stage: 'access', recovery: 'relogin' },
  BGM_HTTP_401: { origin: 'http', stage: 'access', recovery: 'relogin' },
  CANCELLED: { origin: 'host', stage: 'execution', recovery: 'none' },
};
export function errorCauses(error: unknown): DiagnosticCause[] {
  const result: DiagnosticCause[] = [], seen = new Set<object>();
  if (typeof error === 'string') return [{ name: 'ThrownValue' }];
  let current = error;
  while (current instanceof Error && result.length < 4 && !seen.has(current)) {
    seen.add(current);
    const code = (current as Error & { code?: unknown }).code;
    result.push({ name: current.name.slice(0, 100), ...(typeof code === 'string' || typeof code === 'number' ? { code: String(code).slice(0, 100) } : {}) });
    current = current.cause;
  }
  return result;
}
export function fallbackErrorDiagnostic(error: unknown, code: string): ErrorDiagnostic {
  if (error !== null && typeof error === 'object') {
    const existing = fallbackDiagnostics.get(error);
    if (existing) return existing;
  }
  const httpStatus = /^BGM_HTTP_(\d{3})$/.exec(code);
  const diagnostic = createErrorDiagnostic({ code, ...(defaults[code] ?? { origin: code === 'INTERNAL_ERROR' ? 'host' : 'domain', stage: 'execution', recovery: 'none' }),
    reason: code === 'INTERNAL_ERROR' ? 'unclassified_exception' : 'operation_failed',
    certainty: code === 'INTERNAL_ERROR' ? 'unknown' : 'confirmed', causes: errorCauses(error) });
  if (httpStatus) {
    diagnostic.origin = 'http'; diagnostic.stage = 'fetch'; diagnostic.reason = 'http_status_rejected'; diagnostic.evidence.httpStatus = Number(httpStatus[1]);
    diagnostic.recovery = Number(httpStatus[1]) === 401 ? 'relogin' : Number(httpStatus[1]) === 403 ? 'inspect_permissions' : 'replan_read';
  }
  if (code === 'BGM_OUTPUT_LIMIT' || code === 'MCP_OUTPUT_LIMIT') {
    diagnostic.origin = code === 'BGM_OUTPUT_LIMIT' ? 'http' : 'mcp'; diagnostic.stage = 'stream'; diagnostic.reason = 'response_bytes_limit'; diagnostic.recovery = 'correct_parameters';
  }
  if (error !== null && typeof error === 'object') fallbackDiagnostics.set(error, diagnostic);
  rememberErrorDebug(diagnostic, error);
  return diagnostic;
}

/** 原文/堆栈只进入本地 trace，永不进入诊断 DTO、模型反馈或 Web SSE。有界且按 errorId 隔离。 */
const debugRecords = new Map<string, { value: unknown; bytes: number }>();
let debugBytes = 0;
export function rememberErrorDebug(diagnostic: ErrorDiagnostic, error: unknown, responseText?: string): void {
  const value = { ...(error instanceof Error ? { name: error.name, message: error.message.slice(0, 2000), stack: error.stack?.slice(0, 8000) } : {}),
    ...(typeof error === 'string' ? { thrownValue: error.slice(0, 2000) } : {}),
    ...(responseText === undefined ? {} : { responseText: responseText.slice(0, 128 * 1024), responseCharacters: responseText.length, captureTruncated: responseText.length > 128 * 1024 }) };
  const bytes = Buffer.byteLength(JSON.stringify(value));
  const previous = debugRecords.get(diagnostic.errorId); if (previous) debugBytes -= previous.bytes;
  debugRecords.set(diagnostic.errorId, { value, bytes }); debugBytes += bytes;
  while (debugRecords.size > 32 || debugBytes > 1024 * 1024) {
    const id = debugRecords.keys().next().value!; debugBytes -= debugRecords.get(id)!.bytes; debugRecords.delete(id);
  }
}
export function takeErrorDebug(errorId: string): unknown {
  const record = debugRecords.get(errorId); if (!record) return undefined;
  debugRecords.delete(errorId); debugBytes -= record.bytes; return record.value;
}

export function withAssistantDiagnostic(message: AssistantMessage, diagnostic: ErrorDiagnostic): AssistantMessage {
  return { ...message, diagnostics: [...(message.diagnostics ?? []), { type: 'bangumi_error', timestamp: Date.now(),
    details: { diagnostic: JSON.parse(JSON.stringify(diagnostic)) as JsonObject } }] };
}
export function assistantErrorDiagnostic(message: AssistantMessage): ErrorDiagnostic | undefined {
  const value = message.diagnostics?.findLast(item => item.type === 'bangumi_error')?.details?.diagnostic;
  return isErrorDiagnostic(value) ? value : undefined;
}
const diagnosticLinks = new Map<string, NonNullable<ErrorDiagnostic['links']>>();
export function correlateDiagnostic(diagnostic: ErrorDiagnostic, links: NonNullable<ErrorDiagnostic['links']>): ErrorDiagnostic {
  diagnosticLinks.set(diagnostic.errorId, links);
  while (diagnosticLinks.size > 512) diagnosticLinks.delete(diagnosticLinks.keys().next().value!);
  return { ...diagnostic, links };
}
export function correlatedDiagnostic(diagnostic: ErrorDiagnostic): ErrorDiagnostic {
  const links = diagnostic.links ?? diagnosticLinks.get(diagnostic.errorId);
  return links ? { ...diagnostic, links } : diagnostic;
}

export function classifyProviderFailure(message: AssistantMessage): ErrorDiagnostic {
  const evidence: ErrorDiagnostic['evidence'] = { provider: message.provider, model: message.model, api: message.api, rawStopReason: message.rawStopReason ?? null,
    ...(message.responseId ? { responseId: message.responseId.slice(0, 300) } : {}) };
  const details = message.diagnostics?.findLast(item => item.type !== 'bangumi_error');
  const status = details?.details?.status ?? details?.details?.statusCode;
  const providerCode = details?.error?.code ?? details?.details?.code;
  if (typeof status === 'number' && Number.isFinite(status)) evidence.httpStatus = status;
  if (typeof providerCode === 'string') evidence.providerCode = providerCode.slice(0, 300);
  const text = message.errorMessage ?? '';
  let code = 'LLM_PROVIDER_ERROR', reason = 'provider_failure_unknown', certainty: ErrorDiagnostic['certainty'] = 'unknown', recovery: ErrorDiagnostic['recovery'] = 'none';
  // 有结构化状态时以状态为证据；旧适配器仅有文字时明确标为推断。
  const rules = [
    { match: /insufficient_quota|quota exceeded|billing|out of budget/i, code: 'LLM_QUOTA_EXHAUSTED', reason: 'quota_exhausted', recovery: 'none' },
    { match: /context_length_exceeded|maximum context length|context window.*exceed/i, code: 'LLM_CONTEXT_LIMIT', reason: 'context_budget_exceeded', recovery: 'correct_parameters' },
    { match: /max[_ ](?:completion[_ ]|output[_ ])?tokens.*(?:invalid|exceed|maximum)|unsupported.*max[_ ]tokens/i, code: 'LLM_REQUEST_LIMIT_INVALID', reason: 'request_output_limit_rejected', recovery: 'correct_parameters' },
    { match: /rate.?limit|too many requests|\b429\b/i, code: 'LLM_RATE_LIMIT', reason: 'rate_limited', recovery: 'retry_request' },
    { match: /timed? out|timeout/i, code: 'LLM_TRANSPORT_TIMEOUT', reason: 'transport_timeout', recovery: 'retry_request' },
    { match: /fetch failed|network.?error|ECONNRESET|ENOTFOUND|socket|connection/i, code: 'LLM_TRANSPORT_ERROR', reason: 'transport_failure', recovery: 'retry_request' },
    { match: /ended before|ended without|terminated/i, code: 'LLM_STREAM_INTERRUPTED', reason: 'stream_terminal_missing', recovery: 'continue_output' },
  ] as const;
  const rule = rules.find(item => item.match.test(text));
  if (rule) { ({ code, reason, recovery } = rule); certainty = 'inferred'; }
  const structuredCodes: Record<string, { code: string; reason: string; recovery: ErrorDiagnostic['recovery'] }> = {
    insufficient_quota: { code: 'LLM_QUOTA_EXHAUSTED', reason: 'quota_exhausted', recovery: 'none' },
    context_length_exceeded: { code: 'LLM_CONTEXT_LIMIT', reason: 'context_budget_exceeded', recovery: 'correct_parameters' },
    invalid_max_tokens: { code: 'LLM_REQUEST_LIMIT_INVALID', reason: 'request_output_limit_rejected', recovery: 'correct_parameters' },
    rate_limit_exceeded: { code: 'LLM_RATE_LIMIT', reason: 'rate_limited', recovery: 'retry_request' },
  };
  if (typeof providerCode === 'string' && structuredCodes[providerCode]) { ({ code, reason, recovery } = structuredCodes[providerCode]!); certainty = 'confirmed'; }
  if (status === 429 && code !== 'LLM_QUOTA_EXHAUSTED') { code = 'LLM_RATE_LIMIT'; reason = 'rate_limited'; recovery = 'retry_request'; certainty = 'confirmed'; }
  if (status === 401 || status === 403) { code = 'LLM_AUTH_REJECTED'; reason = 'provider_auth_rejected'; recovery = 'inspect_permissions'; certainty = 'confirmed'; }
  return createErrorDiagnostic({ code, reason, certainty, recovery, origin: 'llm', stage: code.startsWith('LLM_TRANSPORT') || code === 'LLM_STREAM_INTERRUPTED' ? 'stream' : 'request', evidence });
}
