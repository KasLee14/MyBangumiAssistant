import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError, SchemaInputError, safeError, type ReadDiagnosis } from '../support/errors.js';
import { TOOL_DEFINITIONS, remoteInputError } from './catalog.js';

const temporary = new Set(['BGM_TIMEOUT', 'BGM_NETWORK', 'BGM_HTTP_429', 'BGM_HTTP_502', 'BGM_HTTP_503', 'BGM_HTTP_504']);
const capability = new Set(['SEARCH_CAPABILITY_UNSUPPORTED', 'NSFW_PERMISSION_UNKNOWN', 'NSFW_UNAVAILABLE', 'NSFW_SCOPE_MISMATCH', 'NSFW_SCOPE_CHANGED']);
const authentication = new Set(['BGM_AUTH_REQUIRED', 'BGM_AUTH_EXPIRED', 'BGM_HTTP_401', 'BGM_HTTP_403', 'ACCOUNT_CHANGED']);
export interface ReadRecoveryScope { turnId?: string; signal?: AbortSignal; maxRetries?: number; retryDelayMs?: number }
function definition(name: string) { return TOOL_DEFINITIONS.find(tool => tool.name === name); }

/** 本地目录与固定错误码唯一决定诊断；外部消息和建议不作为输入。 */
export function diagnoseReadError(name: string, args: Record<string, unknown>, error: unknown): AppError {
  const local = error instanceof AppError ? error : new AppError(safeError(error).code, safeError(error).message);
  const effect = definition(name)?.effect ?? 'unknown';
  const code = local.code;
  let category: ReadDiagnosis['category'] = 'other', stage: ReadDiagnosis['stage'] = 'execution';
  let suggestions: ReadDiagnosis['capabilitySuggestions'] = ['report_gap'];
  if (code === 'INVALID_INPUT') { category = 'input'; stage = 'input'; suggestions = ['correct_parameters']; }
  else if (authentication.has(code)) { category = 'authentication'; stage = 'access'; suggestions = ['use_public_sfw', 'relogin', 'report_gap']; }
  else if (capability.has(code)) { category = 'capability'; stage = 'access'; suggestions = ['use_public_sfw', 'read_alternate_source', 'report_gap']; }
  else if (temporary.has(code)) { category = 'transient'; stage = 'fetch'; suggestions = ['read_alternate_source', 'report_gap']; }
  else if (code === 'BGM_HTTP_404') { category = 'not_found'; stage = 'fetch'; suggestions = ['read_alternate_source', 'report_gap']; }
  else if (code === 'CANCELLED') { category = 'cancelled'; suggestions = ['stop']; }
  else if (code === 'MCP_INVALID_RESULT' || code === 'INVALID_RESPONSE') { category = 'contract'; stage = 'response_contract'; suggestions = ['read_alternate_source', 'report_gap']; }
  else if (['INCOMPLETE_DATA', 'INCOMPLETE_COLLECTION', 'FIELD_LIMIT', 'CONTEXT_LIMIT', 'BGM_OUTPUT_LIMIT', 'MCP_OUTPUT_LIMIT'].includes(code)) {
    category = 'incomplete'; stage = 'response_contract'; suggestions = ['narrow_scope', 'report_gap'];
  }
  // 重新从目录生成issue，不能采信外部附带的allowed、hint或路径。
  const issues = local instanceof SchemaInputError ? remoteInputError(name, args, local.issues)?.issues ?? [] : [];
  const blockedFields = [...new Set(issues.map(issue => issue.path))].slice(0, 8);
  if (category === 'capability' && name === 'search_subjects') {
    const filter = args.filter && typeof args.filter === 'object' ? args.filter as Record<string, unknown> : {};
    blockedFields.push(...['air_date', 'rating', 'rating_count', 'rank', 'nsfw'].filter(field => Object.hasOwn(filter, field)).map(field => `/filter/${field}`));
  } else if (category === 'capability' && name === 'browse_subjects') blockedFields.push('/nsfw');
  const self = definition(name)?.access === 'account' || args.username === '-' || args.own === true
    || Array.isArray(args.include) && args.include.includes('own_collection');
  if (self) suggestions = suggestions.filter(value => value !== 'use_public_sfw');
  const diagnosis: ReadDiagnosis = { category, stage, effect, blockedFields: [...new Set(blockedFields)].slice(0, 8),
    allowedValues: issues.filter(issue => issue.allowed).map(issue => ({ field: issue.path, values: structuredClone(issue.allowed) as (string | number | boolean | null)[] })).slice(0, 8),
    capabilitySuggestions: suggestions, replanAllowed: effect === 'read' && category !== 'cancelled' && local.diagnosis?.replanAllowed !== false,
    retryable: effect === 'read' && temporary.has(code) && local.diagnosis?.retryable !== false };
  Object.defineProperty(local, 'diagnosis', { value: diagnosis, configurable: true });
  return local;
}

/** 远端诊断必须等于本地固定推导，只能降低可重试/重新规划权限。 */
export function checkReadDiagnosis(name: string, args: Record<string, unknown>, error: AppError, value: unknown): void {
  const expected = diagnoseReadError(name, args, error).diagnosis!;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('MCP_INVALID_RESULT', 'MCP错误诊断无效。');
  const raw = value as ReadDiagnosis;
  if (!isDeepStrictEqual({ ...raw, retryable: expected.retryable, replanAllowed: expected.replanAllowed }, expected)
    || raw.retryable && !expected.retryable || raw.replanAllowed && !expected.replanAllowed) throw new AppError('MCP_INVALID_RESULT', 'MCP错误诊断与固定目录及错误码不一致。');
  Object.defineProperty(error, 'diagnosis', { value: structuredClone(raw), configurable: true });
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
interface TurnFailures { calls: Map<string, AppError>; barriers: Map<string, AppError> }
const turns = new Map<string, TurnFailures>();
/** 宿主结束、取消或新真实输入可主动释放；无turnId的独立调用不跨任务记忆失败。 */
export function clearReadRecoveryScope(turnId?: string): void { if (turnId === undefined) turns.clear(); else turns.delete(turnId); }
function failures(turnId: string): TurnFailures {
  let state = turns.get(turnId);
  if (!state) { state = { calls: new Map(), barriers: new Map() }; turns.set(turnId, state); }
  // 上限只约束任务缓存，不限制工具、候选或分页数量。
  while (turns.size > 64) turns.delete(turns.keys().next().value!);
  return state;
}
function barrierKey(name: string, args: Record<string, unknown>, category?: ReadDiagnosis['category']): string {
  const substantive = Object.fromEntries(Object.entries(args).filter(([field]) => !['keyword', 'offset', 'limit', 'sort'].includes(field)));
  const route = definition(name)?.access === 'account' || args.username === '-' || args.own === true
    || Array.isArray(args.include) && args.include.includes('own_collection') ? 'self' :
    (args.nsfw === 'account' || (args.filter as Record<string, unknown> | undefined)?.nsfw === 'account') ? 'account_nsfw' : 'public_sfw';
  return fingerprint(category === 'authentication' ? { category, route } : { name, route, args: substantive });
}
function exhausted(error: AppError): AppError {
  if (error.diagnosis) Object.defineProperty(error, 'diagnosis', { value: { ...error.diagnosis, retryable: false }, configurable: true });
  return error;
}
/** 仅固定read工具允许一次暂时性重试，写入与未知工具执行一次且永不重发。 */
export async function executeReadRecovery<T>(name: string, args: Record<string, unknown>, operation: () => Promise<T>, scope: ReadRecoveryScope = {}): Promise<T> {
  const read = definition(name)?.effect === 'read';
  const state = read && scope.turnId ? failures(scope.turnId) : undefined;
  const call = fingerprint({ name, args });
  const previous = state?.calls.get(call) ?? state?.barriers.get(barrierKey(name, args)) ?? state?.barriers.get(barrierKey(name, args, 'authentication'));
  if (previous) {
    // 跨工具复用能力障碍时重新绑定当前工具与参数诊断，不能携带旧sourceTool。
    const repeated = previous instanceof SchemaInputError ? new SchemaInputError(previous.issues) : new AppError(previous.code, previous.message, previous.accessContext);
    if (previous.networkAttempted === false) Object.defineProperty(repeated, 'networkAttempted', { value: false });
    if (previous.recovery) Object.defineProperty(repeated, 'recovery', { value: structuredClone(previous.recovery) });
    Object.defineProperty(repeated, 'sourceTool', { value: name });
    throw exhausted(diagnoseReadError(name, args, repeated));
  }
  const retries = read ? Math.min(1, Math.max(0, Math.floor(scope.maxRetries ?? 1))) : 0;
  for (let attempt = 0; ; attempt++) {
    if (scope.signal?.aborted) { if (scope.turnId) clearReadRecoveryScope(scope.turnId); throw diagnoseReadError(name, args, new AppError('CANCELLED', '操作已取消。')); }
    try { return await operation(); }
    catch (error) {
      const diagnosed = diagnoseReadError(name, args, error);
      if (diagnosed.code === 'CANCELLED' || scope.signal?.aborted) { if (scope.turnId) clearReadRecoveryScope(scope.turnId); throw diagnosed; }
      if (diagnosed.diagnosis?.retryable && attempt < retries) {
        try { await delay(Math.min(1000, Math.max(0, scope.retryDelayMs ?? 150)), undefined, { signal: scope.signal }); }
        catch { if (scope.turnId) clearReadRecoveryScope(scope.turnId); throw diagnoseReadError(name, args, new AppError('CANCELLED', '操作已取消。')); }
        continue;
      }
      exhausted(diagnosed);
      if (state) {
        state.calls.set(call, diagnosed);
        if (['authentication', 'capability'].includes(diagnosed.diagnosis!.category)) state.barriers.set(barrierKey(name, args, diagnosed.diagnosis!.category), diagnosed);
      }
      throw diagnosed;
    }
  }
}
