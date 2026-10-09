export const BENCHMARK_SCHEMA = 1;
export type Data = Record<string, unknown>;
export type Rule =
  | { kind: 'subjects'; turn?: number; exact?: number[]; allowed?: number[]; required?: number[]; min?: number; max?: number }
  | { kind: 'text'; turn?: number; pattern: string; absent?: boolean }
  | { kind: 'component'; turn?: number; type: string }
  | { kind: 'evidence'; turn?: number; subjectIds: number[]; fields: string[]; selected?: boolean }
  | { kind: 'called'; turn?: number; names: string[]; successful?: boolean }
  | { kind: 'visible_text'; turn?: number; text: string }
  | { kind: 'coverage'; turn?: number; tool: string; scope?: 'source' | 'result' }
  | { kind: 'confirmations'; count: number; accepted: boolean }
  | { kind: 'writes'; subjectIds: number[]; count: number; collectionType?: number; comment?: string; verify?: boolean; preserveOtherFields?: boolean }
  | { kind: 'no_write_retry' }
  | { kind: 'recovery'; expectedTerminal: 'success' | 'error'; prefix?: string };
export type OfflineScript = 'bare_component' | 'blank_output' | 'text_field' | 'component_field' | 'prefix_then_invalid' | 'exhausted';
export interface BenchmarkCase {
  id: string; version: number; family: string; tags: string[]; core: boolean;
  fixture: string; turns: string[]; rules: Rule[]; semanticRubric?: string;
  confirmation: 'approve' | 'reject';
  offlineScript?: OfflineScript;
  expectedTerminal?: 'success' | 'error';
  budget: { timeoutMs: number; modelRequests: number; toolExecutions: number; mcpCalls: number };
}
export interface FixtureSubject {
  id: number; name: string; date: string | null; form: string; score: number;
  summary: string; tags: string[]; status?: number;
}
export interface FixtureDefinition {
  id: string; version: number; subjects: FixtureSubject[];
  account: { id: number; username: string };
  relations: Array<{ parent: number; child: number; relation: string }>;
  appearances: Array<{ characterId: number; subjectId: number; role: number }>;
  blog: { id: number; title: string; content: string };
  fault?: 'read_once' | 'read_always' | 'auth_expired' | 'write_unknown';
}
export interface NetworkEvent {
  seq: number; timestampMs: number; elapsedMs: number; durationMs: number; source: 'fixture' | 'live';
  path: string; method: string; status: number | null; write: boolean;
  subjectId: number | null; body: unknown; fixtureMiss: boolean; error?: string;
}
export interface TurnObservation {
  prompt: string; final: unknown; text: string;
  tools: Array<{ name: string; arguments: unknown; value: unknown; error: boolean }>;
  durationMs: number;
}
export interface RequestMetric {
  inputTokens: number | null; contextInputTokens: number | null; reasoningTokens: number | null;
  outputTokens: number | null; cacheReadTokens: number | null;
  cacheWriteTokens: number | null; totalTokens: number | null; estimatedCost: number | null;
  providerPayloadBytes: number | null; durationMs: number; firstTextMs: number | null;
  firstThinkingMs: number | null; visibleThinkingMs: number | null; thinkingChars: number;
  responseModel: string | null;
}
export interface RunMetrics {
  totalMs: number; startupMs: number; modelRequests: number; providerHttpRequests: number | null;
  proposedToolCalls: number; toolExecutions: number; toolErrors: number; mcpCalls: number;
  mcpMs: number; mcpInitializationMs: number;
  cacheRpcCalls: number; rpcDispatches: number; upstreamRequests: number | null;
  upstreamWriteRequests: number | null; upstreamMs: number | null;
  modelMs: number; providerPayloadBytesMax: number | null; inputTokensMax: number | null;
  inputTokensSum: number | null; contextInputTokensMax: number | null; contextInputTokensSum: number | null;
  reasoningTokensSum: number | null; outputTokensSum: number | null; cacheReadTokensSum: number | null;
  cacheWriteTokensSum: number | null; totalTokensSum: number | null; estimatedCost: number | null;
  usageUnavailableRequests: number; modelToolResultBytes: number;
  firstTextMs: number | null; firstCompleteResultMs: number | null; confirmationsMs: number;
  duplicateReads: number; requests: RequestMetric[];
  outputErrors: number; blankOutputErrors: number; schemaOutputErrors: number; jsonOutputErrors: number;
  modelErrors: number; terminalModelErrors: number;
  recoveryScheduled: number; recoveryRunning: number; recoveryRecovered: number; recoveryStopped: number;
  strictToolsSent: number; toolDeclarationsSent: number; initialToolCount: number | null;
  initialToolSchemaBytes: number | null; initialProviderPayloadBytes: number | null;
  validatedFinals: number; prefixMonotonic: boolean; prefixDuplications: number;
}
export interface CheckResult { rule: Rule; passed: boolean; detail: string }
export interface Grade {
  passed: boolean; checks: CheckResult[]; semanticReview: 'not_required' | 'pending';
  rubric: string | null;
}
export type Outcome = 'passed' | 'failed' | 'timeout' | 'budget_exceeded' | 'errored' | 'invalid_fixture' | 'incomplete_capture' | 'not_run';
export interface RunObservation {
  schemaVersion: 1; caseId: string; family: string; variant: string; repeat: number;
  protocolHash: string; versionHash: string; model: string; thinking: string; mode: 'fixture' | 'live-read';
  outcome: Outcome; error: string | null; turns: TurnObservation[]; metrics: RunMetrics;
  grade: Grade; confirmations: Array<{ preview: string; accepted: boolean; timestampMs: number }>;
  network: NetworkEvent[]; traceDirectories: string[]; captureIssues: string[];
}
export interface WorkerConfig {
  runtimeRoot: string; outputDir: string; case: BenchmarkCase; fixture: FixtureDefinition;
  variant: string; repeat: number; protocolHash: string; versionHash: string;
  model: string; thinking: string; mode: 'fixture' | 'live-read'; agentDir: string;
  proxy: string | null; offline: boolean;
  recovery?: 'enabled' | 'disabled';
}
export function record(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}
export function walk(value: unknown, visit: (row: Data) => void): void {
  if (Array.isArray(value)) value.forEach(item => walk(item, visit));
  else if (value !== null && typeof value === 'object') { const row = record(value); visit(row); Object.values(row).forEach(item => walk(item, visit)); }
}
export function validateCases(value: unknown): BenchmarkCase[] {
  if (!Array.isArray(value) || !value.length) throw new Error('案例必须是非空数组。');
  const ids = new Set<string>();
  return value.map(raw => {
    const row = record(raw);
    if (typeof row.id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(row.id) || ids.has(row.id)) throw new Error('案例ID无效或重复。');
    ids.add(row.id);
    if (row.offlineScript !== undefined && !['bare_component', 'blank_output', 'text_field', 'component_field', 'prefix_then_invalid', 'exhausted'].includes(String(row.offlineScript))) throw new Error('离线故障脚本必须是已登记枚举。');
    if (row.expectedTerminal !== undefined && !['success', 'error'].includes(String(row.expectedTerminal))) throw new Error('预期终态必须是success或error。');
    if (!Number.isSafeInteger(row.version) || Number(row.version) < 1 || typeof row.family !== 'string' || !row.family
      || typeof row.fixture !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(row.fixture)
      || typeof row.core !== 'boolean' || !Array.isArray(row.tags) || row.tags.some(tag => typeof tag !== 'string')
      || !Array.isArray(row.turns) || !row.turns.length || row.turns.some(turn => typeof turn !== 'string' || !turn.trim())
      || !Array.isArray(row.rules) || !row.rules.length || !['approve', 'reject'].includes(String(row.confirmation))) throw new Error('案例定义不完整：' + row.id);
    const budget = record(row.budget);
    for (const key of ['timeoutMs', 'modelRequests', 'toolExecutions', 'mcpCalls']) {
      if (!Number.isSafeInteger(budget[key]) || Number(budget[key]) < 1) throw new Error('案例预算无效：' + row.id);
    }
    if (Number(budget.timeoutMs) > 3_600_000 || Number(budget.modelRequests) > 500 || Number(budget.toolExecutions) > 1000 || Number(budget.mcpCalls) > 2000) throw new Error('案例预算超过上限。');
    for (const rawRule of row.rules) {
      const rule = record(rawRule), kind = rule.kind;
      const allowed: Record<string, string[]> = {
        subjects: ['kind', 'turn', 'exact', 'allowed', 'required', 'min', 'max'],
        text: ['kind', 'turn', 'pattern', 'absent'], component: ['kind', 'turn', 'type'],
        evidence: ['kind', 'turn', 'subjectIds', 'fields', 'selected'], called: ['kind', 'turn', 'names', 'successful'], visible_text: ['kind', 'turn', 'text'],
        coverage: ['kind', 'turn', 'tool', 'scope'], confirmations: ['kind', 'count', 'accepted'],
        writes: ['kind', 'subjectIds', 'count', 'collectionType', 'comment', 'verify', 'preserveOtherFields'], no_write_retry: ['kind'],
        recovery: ['kind', 'expectedTerminal', 'prefix'],
      };
      if (typeof kind !== 'string' || !allowed[kind] || Object.keys(rule).some(key => !allowed[kind]!.includes(key))) throw new Error('判分规则类型或字段无效：' + row.id);
      if (rule.turn !== undefined && (!Number.isSafeInteger(rule.turn) || Number(rule.turn) < 0 || Number(rule.turn) >= row.turns.length)) throw new Error('规则轮次越界。');
      for (const key of ['exact', 'allowed', 'required', 'subjectIds']) if (rule[key] !== undefined
        && (!Array.isArray(rule[key]) || rule[key].some(id => !Number.isSafeInteger(id) || Number(id) < 1) || new Set(rule[key]).size !== rule[key].length)) throw new Error('规则ID集合无效。');
      for (const key of ['count', 'min', 'max']) if (rule[key] !== undefined && (!Number.isSafeInteger(rule[key]) || Number(rule[key]) < 0)) throw new Error('规则计数无效。');
      if (kind === 'text') { if (typeof rule.pattern !== 'string' || rule.pattern.length > 2000) throw new Error('文本规则无效。'); new RegExp(rule.pattern, 'u'); }
      if (kind === 'subjects' && !['exact', 'allowed', 'required', 'min', 'max'].some(key => rule[key] !== undefined)) throw new Error('作品规则缺少约束。');
      if (kind === 'evidence' && (!Array.isArray(rule.subjectIds) || !rule.subjectIds.length && rule.selected !== true || !Array.isArray(rule.fields) || !rule.fields.length || rule.fields.some(field => typeof field !== 'string'))) throw new Error('证据规则无效。');
      if (kind === 'called' && (!Array.isArray(rule.names) || !rule.names.length || rule.names.some(name => typeof name !== 'string'))) throw new Error('工具规则无效。');
      if (kind === 'coverage' && rule.scope !== undefined && !['source', 'result'].includes(String(rule.scope))) throw new Error('覆盖规则范围无效。');
      if (['component', 'coverage', 'visible_text'].includes(kind) && typeof rule[kind === 'component' ? 'type' : kind === 'coverage' ? 'tool' : 'text'] !== 'string') throw new Error('规则缺少文本参数。');
      if (kind === 'confirmations' && (rule.count === undefined || typeof rule.accepted !== 'boolean')) throw new Error('确认规则无效。');
      if (kind === 'writes' && (!Array.isArray(rule.subjectIds) || rule.count === undefined || rule.collectionType !== undefined && ![1, 2, 3, 4, 5].includes(Number(rule.collectionType)))) throw new Error('写入规则无效。');
      for (const key of ['absent', 'selected', 'successful', 'accepted', 'verify', 'preserveOtherFields'])
        if (rule[key] !== undefined && typeof rule[key] !== 'boolean') throw new Error('规则布尔参数无效。');
      if (rule.comment !== undefined && typeof rule.comment !== 'string') throw new Error('短评规则无效。');
      if (kind === 'recovery' && (!['success', 'error'].includes(String(rule.expectedTerminal))
        || rule.prefix !== undefined && (typeof rule.prefix !== 'string' || !rule.prefix.length || rule.prefix.length > 500))) throw new Error('恢复规则无效。');
    }
    return raw as BenchmarkCase;
  });
}
