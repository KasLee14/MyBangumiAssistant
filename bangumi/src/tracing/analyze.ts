import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TRACE_SCHEMA_VERSION, traceRecord, type TraceEvent, type TraceFinding } from './schema.js';

/** 只使用已记录的事实和指纹，不猜测模型是否利用了某段资料。 */
export function analyzeEvents(events: readonly TraceEvent[]) {
  const findings: TraceFinding[] = [];
  const calls = events.filter(event => event.event === 'mcp.end');
  const byTool: Record<string, { calls: number; errors: number; duration_ms: number; result_bytes: number }> = Object.create(null);
  const byPhase: Record<string, { calls: number; duration_ms: number }> = Object.create(null);
  const prior = new Map<string, TraceEvent>();
  const failures = new Map<string, TraceEvent>();
  const candidates = new Map<string, Set<number>>();
  let rpcAttempts = 0;
  let candidateRows = 0;
  let candidateNew = 0;
  for (const event of calls) {
    const data = event.data;
    const tool = String(data.tool_name);
    const phase = String(data.phase);
    const duration = Number(data.duration_ms ?? 0);
    const bytes = Number(data.result_bytes ?? 0);
    const metric = byTool[tool] ??= { calls: 0, errors: 0, duration_ms: 0, result_bytes: 0 };
    metric.calls++; metric.errors += data.outcome === 'error' ? 1 : 0; metric.duration_ms += duration; metric.result_bytes += bytes;
    const stage = byPhase[phase] ??= { calls: 0, duration_ms: 0 }; stage.calls++; stage.duration_ms += duration;
    if (data.rpc_attempted === true) rpcAttempts++;
    // 写入前后、不同账户和不同宿主阶段分别统计。回读重复仅作为检查项。
    const scope = `${tool}:${phase}:${data.account_scope}:${data.state_epoch}`;
    const key = `${scope}:${data.args_hash}`;
    const previous = prior.get(key);
    if (previous && data.effect === 'read' && data.outcome === 'completed' && previous.data.outcome === 'completed') {
      findings.push({ kind: 'duplicate_query', severity: 'inspect', span_ids: [previous.span_id, event.span_id], detail: `相同工具与参数再次读取（${phase}）；需核实是否为必要的一致性检查。` });
    }
    prior.set(key, event);
    const failed = failures.get(scope);
    if (failed) findings.push({ kind: failed.data.args_hash === data.args_hash ? 'repeated_failure' : 'changed_arguments_after_error',
      severity: 'inspect', span_ids: [failed.span_id, event.span_id], detail: failed.data.args_hash === data.args_hash ? '失败后再次使用相同参数。' : '失败后修改了参数，可检查错误反馈是否帮助恢复。' });
    if (data.outcome === 'error') failures.set(scope, event); else failures.delete(scope);
    if (Array.isArray(data.subject_ids)) {
      const set = candidates.get(`${data.account_scope}:${data.state_epoch}`) ?? new Set<number>();
      const ids = data.subject_ids.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0);
      const fresh = ids.filter(id => !set.has(id));
      candidateRows += ids.length; candidateNew += new Set(fresh).size;
      if (ids.length && !fresh.length) findings.push({ kind: 'no_new_candidates', severity: 'inspect', span_ids: [event.span_id], detail: '此次搜索没有产生此前搜索范围之外的新作品 ID。' });
      ids.forEach(id => set.add(id)); candidates.set(`${data.account_scope}:${data.state_epoch}`, set);
    }
  }
  for (const event of events.filter(item => item.event === 'write.fact')) {
    if (['failed', 'unknown'].includes(String(event.data.state))) findings.push({ kind: 'write_verification_failed', severity: 'error', span_ids: [event.span_id], detail: '宿主写入结果为失败或未知；检查实际状态与独立回读记录。' });
  }
  const llm = events.filter(event => event.event === 'llm.end');
  const initialization = new Map<string, number>();
  let initializationMs = 0;
  for (const event of events) {
    if (event.event === 'mcp.initializing') initialization.set(event.span_id, event.elapsed_ms);
    if (event.event === 'mcp.initialized' && initialization.has(event.span_id)) initializationMs += event.elapsed_ms - initialization.get(event.span_id)!;
  }
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 };
  for (const event of llm) {
    if (event.data.usage_status !== 'reported') continue;
    const usage = traceRecord(event.data.usage);
    tokens.input += Number(usage.input ?? 0); tokens.output += Number(usage.output ?? 0);
    tokens.cache_read += Number(usage.cacheRead ?? 0); tokens.cache_write += Number(usage.cacheWrite ?? 0);
    tokens.total += Number(usage.totalTokens ?? 0);
  }
  return {
    schema_version: TRACE_SCHEMA_VERSION,
    metrics: {
      llm_requests: events.filter(event => event.event === 'llm.start').length,
      usage_unavailable_requests: llm.filter(event => event.data.usage_status !== 'reported').length + events.filter(event => event.event === 'llm.incomplete').length,
      llm_duration_ms: llm.reduce((sum, event) => sum + Number(event.data.duration_ms ?? 0), 0),
      prompt_bytes_max: Math.max(0, ...events.filter(event => event.event === 'llm.start').map(event => Number(event.data.prompt_bytes ?? 0))),
      tokens,
      proposed_tool_calls: events.filter(event => event.event === 'tool.proposed').length,
      executed_tools: events.filter(event => event.event === 'tool.start').length,
      tool_errors: events.filter(event => event.event === 'tool.result' && event.data.is_error === true).length,
      mcp_client_calls: calls.length, mcp_rpc_attempts: rpcAttempts,
      mcp_initialization_ms: initializationMs,
      rpc_attempt_unknown_calls: calls.filter(event => event.data.rpc_attempted === null).length,
      mcp_result_bytes: calls.reduce((sum, event) => sum + Number(event.data.result_bytes ?? 0), 0),
      model_tool_result_bytes: events.filter(event => event.event === 'tool.result').reduce((sum, event) => sum + Number(event.data.model_visible_bytes ?? 0), 0),
      search_candidate_rows: candidateRows, search_unique_candidates: candidateNew,
      search_overlap_ratio: candidateRows ? (candidateRows - candidateNew) / candidateRows : null,
      mcp_by_tool: Object.fromEntries(Object.entries(byTool)), mcp_by_phase: Object.fromEntries(Object.entries(byPhase)),
      host_duration_ms: Object.fromEntries(['account_queue', 'confirmation', 'preflight', 'submit', 'verify'].map(phase => [phase,
        events.filter(event => (event.event === 'host.end' && event.data.phase === phase) || (phase === 'account_queue' && event.event === 'account_queue.wait'))
          .reduce((sum, event) => sum + Number(event.data.duration_ms ?? 0), 0)])),
    },
    findings,
  };
}

/** 独立重算：尾部半行、序号缺口及缺少 run.end 均标记为不完整。 */
export async function analyzeTrace(directory: string) {
  const root = resolve(directory);
  const canonicalRoot = await realpath(root);
  const source = await readFile(join(root, 'events.jsonl'), 'utf8');
  const events: TraceEvent[] = [];
  const issues: string[] = [];
  let lastSeq = 0;
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    try {
      const value: unknown = JSON.parse(line);
      const row = traceRecord(value);
      if (row.schema_version !== TRACE_SCHEMA_VERSION || typeof row.event !== 'string' || typeof row.span_id !== 'string'
        || typeof row.trace_id !== 'string' || !Number.isSafeInteger(row.seq) || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw new Error('Invalid event');
      if (row.seq !== lastSeq + 1) issues.push('sequence_gap');
      lastSeq = Number(row.seq);
      if (events.length && row.trace_id !== events[0]!.trace_id) issues.push('mixed_trace_ids');
      events.push(row as unknown as TraceEvent);
    } catch { issues.push('invalid_event_line'); }
  }
  const end = events.findLast(event => event.event === 'run.end');
  if (events[0]?.event !== 'run.start') issues.push('missing_run_start');
  if (!end) issues.push('missing_run_end');
  else if (events.at(-1) !== end) issues.push('events_after_run_end');
  if (traceRecord(end?.data.capture).complete === false) issues.push('capture_incomplete');
  // 正文引用仅能指向本份 trace 的哈希文件；重算同时检查遗漏、破损与哈希不一致。
  const checked = new Set<string>();
  const verify = async (value: unknown): Promise<void> => {
    if (Array.isArray(value)) { for (const child of value) await verify(child); return; }
    if (!value || typeof value !== 'object') return;
    const data = traceRecord(value);
    if (typeof data.sha256 === 'string' && typeof data.bytes === 'number' && Object.hasOwn(data, 'path')) {
      if (data.path === null) { issues.push('omitted_payload'); return; }
      if (typeof data.path !== 'string' || !/^payloads\/[a-f0-9]{64}\.json$/.test(data.path)
        || data.path !== `payloads/${data.sha256}.json`) { issues.push('invalid_payload_path'); return; }
      if (checked.has(data.path)) return;
      checked.add(data.path);
      try {
        const file = await realpath(join(root, data.path));
        const child = relative(canonicalRoot, file);
        if (isAbsolute(child) || child === '..' || child.startsWith('..' + sep)) { issues.push('invalid_payload_path'); return; }
        const body = (await readFile(file, 'utf8')).replace(/\n$/, '');
        if (createHash('sha256').update(body).digest('hex') !== data.sha256 || Buffer.byteLength(body) !== data.bytes) issues.push('payload_hash_mismatch');
        await verify(JSON.parse(body));
      } catch { issues.push('missing_or_invalid_payload'); }
      return;
    }
    for (const child of Object.values(data)) await verify(child);
  };
  for (const event of events) await verify(event.data);
  return { trace_id: events[0]?.trace_id ?? null, execution_status: end?.data.outcome ?? 'incomplete', complete: issues.length === 0,
    issues: [...new Set(issues)], ...analyzeEvents(events) };
}
