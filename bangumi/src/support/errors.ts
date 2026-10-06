import type { AccessContext } from '../mcp/access-context.js';
import { createErrorDiagnostic, fallbackErrorDiagnostic, isErrorDiagnostic, rememberErrorDebug, type ErrorDiagnostic } from './error-diagnostic.js';
export const DIAGNOSIS_CATEGORIES = ['input', 'authentication', 'capability', 'transient', 'not_found', 'incomplete', 'cancelled', 'contract', 'other'] as const;
export const DIAGNOSIS_STAGES = ['input', 'access', 'fetch', 'response_contract', 'execution'] as const;
export const CAPABILITY_SUGGESTIONS = ['correct_parameters', 'use_public_sfw', 'use_account_source', 'relogin', 'inspect_permissions', 'narrow_scope', 'read_alternate_source', 'report_gap', 'stop'] as const;
/** 固定宿主诊断；字段、合法值来自本地目录，不包含远端正文或建议工具名。 */
export interface ReadDiagnosis {
  category: typeof DIAGNOSIS_CATEGORIES[number]; stage: typeof DIAGNOSIS_STAGES[number]; effect: 'read' | 'write' | 'unknown';
  blockedFields: string[]; allowedValues: { field: string; values: (string | number | boolean | null)[] }[];
  capabilitySuggestions: typeof CAPABILITY_SUGGESTIONS[number][]; replanAllowed: boolean; retryable: boolean;
}
export const READ_DIAGNOSIS_SCHEMA: Record<string, unknown> = { type: 'object', additionalProperties: false, properties: {
  category: { type: 'string', enum: [...DIAGNOSIS_CATEGORIES] }, stage: { type: 'string', enum: [...DIAGNOSIS_STAGES] }, effect: { enum: ['read', 'write', 'unknown'] },
  blockedFields: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', maxLength: 200 } },
  allowedValues: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, properties: {
    field: { type: 'string', maxLength: 200 }, values: { type: 'array', maxItems: 100, items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } },
  }, required: ['field', 'values'] } },
  capabilitySuggestions: { type: 'array', maxItems: 9, uniqueItems: true, items: { type: 'string', enum: [...CAPABILITY_SUGGESTIONS] } },
  replanAllowed: { type: 'boolean' }, retryable: { type: 'boolean' },
}, required: ['category', 'stage', 'effect', 'blockedFields', 'allowedValues', 'capabilitySuggestions', 'replanAllowed', 'retryable'] };
export class AppError extends Error {
  readonly diagnostic?: ErrorDiagnostic;
  readonly networkAttempted?: false;
  readonly rejection?: SubmissionRejection;
  readonly sourceTool?: string;
  readonly recovery?: { stage: 'response_contract'; retryable: false };
  readonly diagnosis?: ReadDiagnosis;
  readonly contractIssue?: ContractIssue;
  constructor(public readonly code: string, message: string, public readonly accessContext?: AccessContext) {
    super(message);
    this.name = 'AppError';
  }
}
export function diagnosedError<T extends AppError>(error: T, diagnostic: ErrorDiagnostic, cause?: unknown): T {
  Object.defineProperty(error, 'diagnostic', { value: diagnostic, configurable: true });
  if (cause !== undefined) rememberErrorDebug(diagnostic, cause);
  return error;
}
export function sanitizeErrorDiagnostic(diagnostic: ErrorDiagnostic): ErrorDiagnostic {
  const safe = structuredClone(diagnostic), secrets = credentialValues();
  // 本地随机关联ID不按正文脱敏，避免短凭据碰巧命中ID使关联契约失效。
  safe.issues = safe.issues.map(issue => ({ ...issue, path: redact(issue.path, secrets).slice(0, 300), message: redact(issue.message, secrets).slice(0, 300),
    ...(issue.expected === undefined ? {} : { expected: redact(issue.expected, secrets).slice(0, 300) }) }));
  safe.evidence = Object.fromEntries(Object.entries(safe.evidence).map(([key, value]) => [key, typeof value === 'string' ? redact(value, secrets).slice(0, 300) : value]));
  safe.causes = safe.causes.map(cause => ({ name: redact(cause.name, secrets).slice(0, 100), ...(cause.code === undefined ? {} : { code: redact(cause.code, secrets).slice(0, 100) }) }));
  return safe;
}
export interface InputIssue { path: string; rule: string; hint: string; allowed?: readonly unknown[] }
const contractPaths = {
  browse_date_mismatch: '/data/dateEvidence', browse_date_evidence_invalid: '/data/dateEvidence',
  browse_filter_coverage_invalid: '/filterCoverage',
} as const;
export interface ContractIssue { reason: keyof typeof contractPaths; path: typeof contractPaths[keyof typeof contractPaths]; subjectId: number | null }
export const CONTRACT_ISSUE_SCHEMA: Record<string, unknown> = { type: 'object', additionalProperties: false,
  properties: { reason: { enum: Object.keys(contractPaths) }, path: { enum: [...new Set(Object.values(contractPaths))] },
    subjectId: { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'null' }] } },
  required: ['reason', 'path', 'subjectId'],
};
export function isContractIssue(value: unknown): value is ContractIssue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const issue = value as ContractIssue;
  return Object.keys(issue).length === 3 && Object.hasOwn(contractPaths, issue.reason) && issue.path === contractPaths[issue.reason]
    && (issue.subjectId === null || Number.isSafeInteger(issue.subjectId) && issue.subjectId > 0)
    && (issue.reason === 'browse_filter_coverage_invalid' ? issue.subjectId === null : issue.subjectId !== null);
}
export function contractIssueMessage(issue: ContractIssue): string {
  const messages = { browse_date_mismatch: '浏览作品日期不符合明确年月条件',
    browse_date_evidence_invalid: '浏览作品日期证据或精度无效', browse_filter_coverage_invalid: '浏览日期筛选覆盖计数或分页不一致' };
  return `${messages[issue.reason]}${issue.subjectId === null ? '' : `（作品 ${issue.subjectId}）`}，字段 ${issue.path}。`;
}
export class ContractError extends AppError {
  constructor(reason: ContractIssue['reason'], path: ContractIssue['path'], subjectId: number | null) {
    const issue = { reason, path, subjectId };
    super('MCP_INVALID_RESULT', contractIssueMessage(issue));
    if (!isContractIssue(issue)) throw new Error('本地契约诊断参数无效。');
    Object.defineProperty(this, 'contractIssue', { value: issue });
    Object.defineProperty(this, 'sourceTool', { value: 'browse_subjects' });
    diagnosedError(this, createErrorDiagnostic({ code: this.code, origin: 'mcp', stage: 'validate', reason, operation: 'browse_subjects',
      issues: [{ path, rule: reason, message: contractIssueMessage(issue).slice(0, 300) }] }));
  }
}
/** 仅本地固定契约生成的反馈；不包含原始参数值或服务端正文。 */
export class SchemaInputError extends AppError {
  readonly networkAttempted = false;
  constructor(readonly issues: readonly InputIssue[]) {
    super('INVALID_INPUT', issues.map(issue => `${issue.path || '/'}：${issue.hint}`).join('；'));
    diagnosedError(this, createErrorDiagnostic({ code: this.code, origin: 'domain', stage: 'input', reason: 'input_schema_invalid', recovery: 'correct_parameters',
      evidence: { networkAttempted: false }, issues: issues.slice(0, 8).map(issue => ({ path: issue.path, rule: issue.rule, message: issue.hint.slice(0, 300) })) }));
  }
}
/** 仅固定上游契约证明修改前已拒绝；不根据 HTTP 状态或任意正文推断。 */
export interface SubmissionRejection {
  kind: 'rate_limit'; httpStatus: 429; upstreamCode: 'RATE_LIMIT_EXCEEDED'; retryAfterMs: number | null;
}
export function isSubmissionRejection(value: unknown): value is SubmissionRejection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).length === 4 && raw.kind === 'rate_limit' && raw.httpStatus === 429 && raw.upstreamCode === 'RATE_LIMIT_EXCEEDED'
    && (raw.retryAfterMs === null || typeof raw.retryAfterMs === 'number' && Number.isSafeInteger(raw.retryAfterMs) && raw.retryAfterMs >= 0 && raw.retryAfterMs <= 86_400_000);
}
export interface SubmissionItem { target: Record<string, unknown> | null; stage: string; submissionState: 'acknowledged' | 'rejected' | 'unknown' | 'not_attempted'; rejection?: SubmissionRejection }
export interface SubmissionReceipt {
  schemaVersion: 1; kind: 'submission'; tool: string; expectedAccountId: number; target: Record<string, unknown> | null;
  submissionState: 'acknowledged' | 'partial' | 'rejected' | 'unknown' | 'not_attempted'; verification: 'pending'; items: SubmissionItem[];
  requestedFields: string[]; createdId: number | null; relatedId: number | null; requestedCollected: boolean | null; requestedEpisodeStatus: number | null;
  /** 官方看到此集：一次请求实际覆盖的完整正篇ID；普通逐集操作省略。 */
  affectedEpisodeIds?: number[];
}
export class SubmissionError extends AppError {
  constructor(code: string, message: string, readonly submission: SubmissionReceipt) {
    super(code, message);
    const rejection = submission.items.find(item => item.submissionState === 'rejected')?.rejection;
    if (isSubmissionRejection(rejection)) Object.defineProperty(this, 'rejection', { value: structuredClone(rejection) });
  }
}
export interface SafeError { code: string; message: string; diagnostic?: ErrorDiagnostic; issues?: readonly InputIssue[]; networkAttempted?: false; rejection?: SubmissionRejection; submission?: SubmissionReceipt; accessContext?: AccessContext; sourceTool?: string; recovery?: { stage: 'response_contract'; retryable: false }; diagnosis?: ReadDiagnosis; contractIssue?: ContractIssue }
const localSecrets = new Set<string>();
/** 本地凭据也参与模型、日志和终端的统一裁剪，原值不进入配置或会话。 */
export function registerCredentials(values: readonly string[]): void { for (const value of values) if (value) localSecrets.add(value); }

export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) {
      result = result.split(secret).join('[REDACTED]');
      result = result.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]');
    }
  }
  return result
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/((?:chiiNextSessionID|chii_auth|chii_sid|chii_sec_id|cf_clearance)=)[^\s;"']+/gi, '$1[REDACTED]')
    .replace(/([?&]gh=)[^\s&"']+/gi, '$1[REDACTED]');
}

/** 保留可能跨流式片段的凭据尾部，避免逐片段脱敏漏掉完整值。 */
export class StreamingRedactor {
  private pending = '';
  private readonly reserve: number;
  constructor(private readonly secrets: readonly string[]) {
    this.reserve = Math.max(1, ...secrets.map(secret => secret.length)) - 1;
  }
  push(chunk: string): string {
    this.pending += chunk;
    let cut = Math.max(0, this.pending.length - this.reserve);
    for (const secret of this.secrets) {
      if (!secret) continue;
      let index = this.pending.indexOf(secret);
      while (index >= 0 && index < cut) {
        if (index + secret.length > cut) { cut = index; break; }
        index = this.pending.indexOf(secret, index + secret.length);
      }
    }
    const output = redact(this.pending.slice(0,cut), this.secrets);
    this.pending = this.pending.slice(cut);
    return output;
  }
  finish(): string { const output = redact(this.pending, this.secrets); this.pending = ''; return output; }
}

export function credentialValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...localSecrets, ...Object.entries(env)
    .filter(([name, value]) => value && /(TOKEN|API_KEY|PASSWORD|SECRET|COOKIE|SESSION_ID)/i.test(name))
    .map(([, value]) => value!)];
}

export function safeError(error: unknown): SafeError {
  const code = error instanceof AppError ? error.code : error instanceof Error && error.name === 'AbortError' ? 'CANCELLED' : 'INTERNAL_ERROR';
  const diagnostic = structuredClone(error instanceof AppError && isErrorDiagnostic(error.diagnostic) ? error.diagnostic : fallbackErrorDiagnostic(error, code));
  if (error instanceof AppError && error.sourceTool) diagnostic.operation = error.sourceTool;
  if (error instanceof AppError && error.networkAttempted === false) diagnostic.evidence.networkAttempted = false;
  if (error instanceof SubmissionError) { diagnostic.recovery = ['unknown', 'partial', 'acknowledged'].includes(error.submission.submissionState) ? 'verify_write' : 'none'; diagnostic.evidence.submissionState = error.submission.submissionState; }
  const safeDiagnostic = sanitizeErrorDiagnostic(diagnostic);
  const context = error instanceof AppError ? { ...(error.accessContext ? { accessContext: structuredClone(error.accessContext) } : {}), ...(error.sourceTool ? { sourceTool: error.sourceTool } : {}),
    ...(isSubmissionRejection(error.rejection) ? { rejection: structuredClone(error.rejection) } : {}),
    ...(error.recovery ? { recovery: structuredClone(error.recovery) } : {}), ...(error.diagnosis ? { diagnosis: structuredClone(error.diagnosis) } : {}),
    ...(isContractIssue(error.contractIssue) ? { contractIssue: structuredClone(error.contractIssue) } : {}), ...(error.networkAttempted === false ? { networkAttempted: false as const } : {}) } : {};
  const information = { ...context, diagnostic: safeDiagnostic };
  if (error instanceof SubmissionError) return { code: error.code, message: redact(error.message, credentialValues()), submission: structuredClone(error.submission), ...information };
  if (error instanceof SchemaInputError) return { code: error.code, message: redact(error.message, credentialValues()), issues: error.issues, networkAttempted: false, ...information };
  if (error instanceof AppError) return { code: error.code, message: redact(error.message, credentialValues()), ...information };
  if (code === 'CANCELLED') return { code, message: '操作已取消。', ...information };
  return { code, message: '内部执行失败；返回的诊断包含错误ID和底层原因。', ...information };
}
