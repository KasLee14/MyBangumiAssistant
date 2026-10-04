export const TRACE_SCHEMA_VERSION = 1;
export type TraceData = Record<string, unknown>;
export type TracePhase = 'query' | 'preflight' | 'confirmation' | 'submit' | 'verify' | 'account_queue';
export type TraceOutcome = 'completed' | 'aborted' | 'error' | 'incomplete';

export interface TraceOptions {
  directory: string;
  entryPoint?: 'web' | 'cli' | 'print' | 'json' | 'rpc';
  /** 限制日志内存队列，不限制模型或 MCP 的调用次数。 */
  maxQueueBytes?: number;
  onWarning?: (code: string) => void;
}

export interface PayloadRef {
  path: string | null;
  sha256: string;
  bytes: number;
  omitted?: 'queue_limit' | 'serialization_failed' | 'writer_failed';
}

export interface TraceEvent {
  schema_version: 1;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  seq: number;
  ts: string;
  elapsed_ms: number;
  event: string;
  data: TraceData;
}

export interface TraceSession {
  session_id: string;
  session_file: string | null;
  branch_start_id: string | null;
  branch_end_id: string | null;
}

export interface TraceLink { trace_id: string; session_id: string }

export interface TraceFinding {
  kind: 'duplicate_query' | 'repeated_failure' | 'changed_arguments_after_error' | 'no_new_candidates' | 'write_verification_failed';
  severity: 'inspect' | 'error';
  span_ids: string[];
  detail: string;
}

/** 通用 span 接口只观察执行；关闭日志时 task 仍按原样调用一次。 */
export interface TraceHost {
  phase<T>(phase: TracePhase, task: () => Promise<T>, data?: TraceData): Promise<T>;
  operation<T>(name: string, task: () => Promise<T>, data?: TraceData): Promise<T>;
  record(event: string, value: unknown): void;
}

export function traceRecord(value: unknown): TraceData {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as TraceData : {};
}
