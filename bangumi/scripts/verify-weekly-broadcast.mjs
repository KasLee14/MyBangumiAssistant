/** 原prompt真实只读验收。使用隔离的内存会话，凭据仅由现有宿主读取，不打印。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { createPiTransport } from '../dist/src/pi-transport.js';
import { policyFor } from '../dist/src/support/proxy.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { validateMixedContent } from '../dist/src/output/content-schema.js';
import { normalizeProviderContent } from '../dist/src/output/provider-content.js';
import { redact, credentialValues } from '../dist/src/support/errors.js';

const prompt = '帮我整理一下我在看的本季度新番的播出时间，整理成一个表格，展现周一到周日每天有哪些动画更新。同一天更新的动画放到同一行';
const dataDir = resolve(process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA, 'MyBangumiAssistant-Pi'));
const auditDir = process.argv[2] === '--audit-trace' ? resolve(process.argv[3]) : undefined;
const destination = resolve((auditDir ? process.argv[4] : process.argv[2]) ?? '../artifacts/weekly-broadcast-retest');
mkdirSync(destination, { recursive: true });
const sourceFile = join(dataDir, 'pi/sessions/2026-10-06T09-14-15-693Z_01a1107e-010d-752d-a102-7941f14815f5.jsonl');
const original = readFileSync(sourceFile, 'utf8').trim().split('\n').map(JSON.parse);
const originalUser = original.find(row => row.message?.role === 'user')?.message.content.find(part => part.type === 'text')?.text;
if (originalUser !== prompt) throw new Error('复测prompt与原始会话不一致');
const originalAssistant = original.find(row => row.message?.role === 'assistant' && row.message.stopReason === 'error')?.message;
const model = originalAssistant.model, provider = originalAssistant.provider;
const debugFile = join(dataDir, 'tracelog/2026-10-06/01a1107e-010d-752d-a102-7941f14815f5/2a7b4a115b915563e801e703e778f82f/payloads/7fdb674bb845030cb29cc745aadab8ece17d7e2118e20c21332ab05dd64b55c2.json');
const replayAdjustments = [];
const replay = normalizeProviderContent(JSON.parse(JSON.parse(readFileSync(debugFile, 'utf8')).responseText), adjustment => replayAdjustments.push(adjustment));
const transport = createPiTransport(policyFor('http://127.0.0.1:7890'));
let runtime, final, timer, auditDuration, auditStarted;
const started = Date.now();
const toolCalls = [], toolResults = [], errors = [], recovery = [];
const reads = new Set(['read', ...TOOL_DEFINITIONS.filter(tool => tool.effect === 'read').map(tool => tool.name)]);
let requestCount = 0, contentRequests = 0, componentUpdates = 0, pendingSeen = false;
const collect = (value, callback) => { if (value && typeof value === 'object') { callback(value); for (const child of Object.values(value)) collect(child, callback); } };
try {
  if (auditDir) {
    const summary = JSON.parse(readFileSync(join(auditDir, 'summary.json'), 'utf8'));
    if (summary.purpose !== 'agent' || summary.inputs[0]?.text !== prompt) throw new Error('保存的trace不是原prompt主任务');
    const records = readFileSync(join(auditDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    final = JSON.parse(readFileSync(join(auditDir, summary.final_output.message_ref.path), 'utf8'));
    auditDuration = summary.duration_ms;
    auditStarted = summary.started_at;
    for (const event of records) {
      if (event.event === 'mcp.end' && event.data.result_ref?.path) toolResults.push({ tool: event.data.tool_name, value: JSON.parse(readFileSync(join(auditDir, event.data.result_ref.path), 'utf8')) });
      if (event.event === 'tool.result') toolCalls.push(event.data.tool_name);
      if (event.event === 'error.diagnostic') errors.push(event.data.diagnostic.code);
      if (event.event === 'recovery.state') recovery.push(event.data.stage);
      if (event.event === 'llm.provider_request') {
        requestCount++; const payload = JSON.parse(readFileSync(join(auditDir, event.data.payload_ref.path), 'utf8'));
        if (payload.response_format?.type === 'json_object' || payload.text?.format?.type === 'json_object') contentRequests++;
      }
      if (event.event === 'llm.partial') {
        const partial = JSON.parse(readFileSync(join(auditDir, event.data.message_ref.path), 'utf8'));
        pendingSeen ||= partial.content?.some(part => part.type === 'DataTable' && part.pending === true) ?? false;
      }
    }
  } else {
  const base = createBangumiExtension({ authDir: join(dataDir, 'auth'), proxy: policyFor('http://127.0.0.1:7890'), timeoutMs: 60000,
    generateSessionTitle: async () => '新番周历复测', channel: { canConfirm: () => false, canLogin: () => false, confirm: async () => false, login: async () => { throw new Error('复测不执行登录'); }, notify: () => {} },
    trace: { directory: join(destination, 'trace'), entryPoint: 'print' } });
  runtime = await createBangumiRuntime({ cwd: process.cwd(), agentDir: join(dataDir, 'pi'),
    sessionManager: SessionManager.inMemory(process.cwd()), fetch: transport.fetch, provider, model, thinkingLevel: 'high',
    extension: pi => { base(pi); pi.on('before_provider_request', event => {
      requestCount++; if (event.payload?.response_format?.type === 'json_object' || event.payload?.text?.format?.type === 'json_object') contentRequests++;
    }); } });
  runtime.session.setActiveToolsByName(runtime.session.getActiveToolNames().filter(name => reads.has(name)));
  runtime.session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'content_update') {
      componentUpdates++; pendingSeen ||= event.message.content.some(part => part.type === 'DataTable' && part.pending === true);
    }
    if (event.type === 'message_end') {
      const message = event.message;
      if (message.role === 'assistant') {
        final = message;
        for (const part of message.content) if (part.type === 'toolCall') toolCalls.push(part.name);
        if (message.stopReason === 'error') errors.push(...(message.diagnostics ?? []).filter(item => item.type === 'bangumi_error').map(item => item.details.diagnostic.code));
      } else if (message.role === 'toolResult') toolResults.push({ tool: message.toolName, value: message.details?.value, isError: message.isError });
    }
    if (event.type === 'entry_appended' && event.entry.type === 'custom' && event.entry.customType === 'bangumi/recovery') recovery.push(event.entry.data.stage);
  });
  timer = setTimeout(() => { void runtime.session.abort(); }, 300000);
  await runtime.session.prompt(prompt); await runtime.session.waitForIdle();
  }
  const content = final?.content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').map(part => part.type === 'text'
    ? { type: 'text', nextType: part.nextType, text: part.text } : part) ?? [];
  let schemaValid = false;
  try { validateMixedContent({ content }); schemaValid = final?.stopReason === 'stop'; } catch {}
  const tables = content.filter(part => part.type === 'DataTable' && part.pending === false);
  const rows = tables.flatMap(part => part.props.rows);
  const patterns = [/星期一|周一|^Mon(?:day)?$/i, /星期二|周二|^Tue(?:sday)?$/i, /星期三|周三|^Wed(?:nesday)?$/i, /星期四|周四|^Thu(?:rsday)?$/i,
    /星期五|周五|^Fri(?:day)?$/i, /星期六|周六|^Sat(?:urday)?$/i, /星期日|星期天|周日|周天|^Sun(?:day)?$/i];
  const orderedWeek = rows.length === 7 && rows.every((row, index) => Object.values(row).some(cell => patterns[index].test(cell)));
  const collections = new Map(), broadcast = new Map(); let collectionReadComplete = false, calendarReadComplete = false;
  for (const result of toolResults) {
    if (['get_user_collections', 'query_user_collections', 'continue_subject_query', 'refine_subject_candidates'].includes(result.tool)) {
      const value = result.value?.result ?? result.value;
      const scope = value?.scope;
      const knownWatching = value?.collectionScope?.collection_type === 3 || scope?.collection_type === 3 || JSON.stringify(scope?.filter?.collection_types) === '[3]';
      collect(result.value, item => {
      if (item.collectionStatus === 3 && item.subject?.id && typeof item.subject.date === 'string') collections.set(item.subject.id, { ...item.subject, collectionStatus: 3 });
      if (Number.isSafeInteger(item.id) && typeof item.name === 'string' && typeof item.date === 'string' && (item.collectionStatus === 3 || item.collectionStatus === undefined && knownWatching)) collections.set(item.id, item);
      if (item.page?.complete === true && item.scope?.collection_type === 3) collectionReadComplete = true;
      const collectionScope = item.collectionScope ?? item.scope;
      if (item.coverage?.complete === true && (collectionScope?.collection_type === 3 || knownWatching)
        && item.coverage.incompleteSourceCount === 0 && item.coverage.unknownTotalSourceCount === 0
        && item.stage?.processedCount === item.stage?.inputCount && item.stage?.pendingCount === 0 && item.stage?.remainingCount === 0)
        collectionReadComplete = true;
      });
    }
    if (result.tool === 'get_daily_broadcast') {
      calendarReadComplete ||= result.value?.complete === true;
      for (const day of result.value?.data ?? []) for (const subject of day.subjects?.data ?? []) broadcast.set(subject.id, day.weekday.id);
    }
  }
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(auditStarted ? new Date(auditStarted) : new Date());
  const year = Number(now.slice(0, 4)), month = Number(now.slice(5, 7)), firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const begin = `${year}-${String(firstMonth).padStart(2, '0')}-01`, end = `${year}-${String(firstMonth + 2).padStart(2, '0')}-31`;
  const eligible = [...collections.values()].filter(item => item.date >= begin && item.date <= end && broadcast.has(item.id));
  const normalizedName = text => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  const names = [...new Set(eligible.flatMap(item => [item.nameCn, item.name].filter(Boolean).map(normalizedName)))];
  const missing = eligible.filter(item => !Object.values(rows[broadcast.get(item.id) - 1] ?? {}).some(cell => {
    const text = normalizedName(cell);
    return [item.nameCn, item.name].filter(Boolean).map(normalizedName).some(name => text.includes(name)
      || name.length >= 12 && names.filter(other => other.startsWith(name.slice(0, 12))).length === 1 && text.includes(name.slice(0, 12)));
  }));
  const readOnly = toolCalls.length > 0 && toolCalls.every(name => reads.has(name));
  const factAudit = collectionReadComplete && calendarReadComplete && eligible.length > 0 && missing.length === 0;
  const valid = schemaValid && orderedWeek && readOnly && errors.length === 0 && recovery.length === 0 && factAudit;
  const result = { valid, outputValid: schemaValid && orderedWeek && readOnly && errors.length === 0 && recovery.length === 0, mode: auditDir ? 'saved_trace_audit' : 'live_generation', ...(auditDir ? { sourceTrace: auditDir } : {}), promptIdentical: true, prompt, provider, model, thinking: 'high', stopReason: final?.stopReason, durationMs: auditDuration ?? Date.now() - started,
    requestCount, contentRequests, toolCalls, readOnly, errors, recovery, schemaValid, types: content.map(part => part.type),
    completedTables: tables.length, weekdayRows: rows.length, orderedWeek, componentUpdates, pendingSeen,
    factAudit, collectionReadComplete, calendarReadComplete, titleMatching: 'full_name_or_unique_12_character_prefix',
    observedCollectionCount: collections.size, calendarSubjectCount: broadcast.size, eligibleMatchedCount: eligible.length,
    missingFromExpectedWeekday: missing.map(item => ({ id: item.id, name: item.nameCn || item.name })),
    originalWireReplay: { valid: true, types: replay.content.map(part => part.type), adjustments: replayAdjustments },
    normalization: final?.diagnostics?.filter(item => item.type === 'bangumi_output_normalized').map(item => item.details) ?? [] };
  const safe = value => redact(JSON.stringify(value, null, 2), credentialValues());
  writeFileSync(join(destination, 'summary.json'), safe(result)); writeFileSync(join(destination, 'answer.json'), safe({ content }));
  console.log(JSON.stringify(result, null, 2)); if (!valid) process.exitCode = 1;
} catch (error) {
  const safeFailure = { valid: false, requestCount, durationMs: Date.now() - started, error: redact(error instanceof Error ? error.message : String(error), credentialValues()) };
  writeFileSync(join(destination, 'summary.json'), JSON.stringify(safeFailure, null, 2)); console.log(JSON.stringify(safeFailure)); process.exitCode = 1;
} finally { clearTimeout(timer); await runtime?.dispose(); await transport.close(); }
