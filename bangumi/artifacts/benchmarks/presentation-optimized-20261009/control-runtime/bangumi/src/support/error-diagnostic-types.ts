/** 共享纯数据契约；浏览器只引用类型，不依赖Node、校验器或本地debug缓冲。 */
export const ERROR_ORIGINS = ['llm', 'content', 'http', 'mcp', 'domain', 'host'] as const;
export const ERROR_STAGES = ['input', 'access', 'request', 'connect', 'stream', 'decode', 'validate', 'fetch', 'submit', 'verify', 'execution'] as const;
export const ERROR_RECOVERIES = ['retry_request', 'continue_output', 'repair_component', 'correct_parameters', 'relogin', 'inspect_permissions', 'replan_read', 'verify_write', 'none'] as const;
export interface DiagnosticIssue { path: string; rule: string; message: string; expected?: string; actualType?: string }
export interface DiagnosticCause { name: string; code?: string }
export interface ErrorDiagnostic {
  schemaVersion: 1; errorId: string; code: string; reason: string;
  origin: typeof ERROR_ORIGINS[number]; stage: typeof ERROR_STAGES[number];
  certainty: 'confirmed' | 'inferred' | 'unknown'; recovery: typeof ERROR_RECOVERIES[number];
  operation?: string; issues: DiagnosticIssue[]; evidence: Record<string, string | number | boolean | null>; causes: DiagnosticCause[];
  links?: { traceId: string; spanId: string; sessionId: string };
}
