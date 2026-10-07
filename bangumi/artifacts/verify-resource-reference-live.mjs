/** 真实只读验收。沿用当前非敏感模型配置，原生 trace 仅保存 provider 实际可见思考。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { createBangumiExtension } from '../dist/src/extension.js';
import { createPiTransport } from '../dist/src/pi-transport.js';
import { policyFor } from '../dist/src/support/proxy.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { validateMixedContent } from '../dist/src/output/content-schema.js';
import { traceRedact } from '../dist/src/tracing/redact.js';

const prompts = {
  subject: '这是只读验收。查询 Bangumi 作品 253 的详情，先用默认字段查询，再从本轮资源缓存按需读取名称和评分（至少调用一次 read_cached_resource）。最后用 SubjectCards 的资源引用 props 展示它，卡片要有缓存中的封面、简介、评分与链接；不要在最终模型 JSON 中抄写缓存展示字段。请简要说明作品名称和评分，不修改账户数据。',
  subject_keys: '这是默认主键投影的只读验收，请严格按顺序完成。第一次调用 get_subject_details 时 arguments 必须且只能是 {"subject_id":253}，不得添加 fields 或 include。取得本轮 resourceRef 后，用 read_cached_resource 读取 name、nameCn、score，至少成功执行一次该缓存工具。最后使用 SubjectCards 的引用 props，只提供 resourceRef、items 中的 id 253 及 layout grid；卡片封面、简介、评分、名称和链接交由宿主从缓存补齐，不要为这些展示字段再调用详情或图片工具。用一句话说明实际读取的名称与评分。禁止任何账户写入。',
  entity: '这是只读验收。查询 Bangumi 人物 1 和角色 1 的公开详情，使用字段读取取得名称，至少对一个资源调用 read_cached_resource，然后用 Gallery 的资源引用 props 展示两者的图片、名称和链接。最后说明各自实体类型，保持人物与角色的身份区别。不修改账户数据。',
  search: '这是只读验收。搜索动画“星际牛仔”，只处理搜索得到的第一页；先读取默认主键投影，再用本轮缓存字段读取获取名称和评分，核实匹配对象后按需取得详情。至少调用一次 read_cached_resource。选择最符合标题的一个结果，用 SubjectCards 的资源引用 props 展示封面、简介、链接、评分，并根据已读取的事实给一句选择理由。不要声称全站穷尽，不修改账户数据。',
};
const scenario = process.argv[2] ?? 'subject';
if (!(scenario in prompts)) throw new Error('场景应为 subject、subject_keys、entity 或 search');
const destination = resolve(process.argv[3] ?? `artifacts/resource-reference-live-${scenario}`);
mkdirSync(destination, { recursive: true });
const dataDir = resolve(process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA, 'MyBangumiAssistant-Pi'));
const settingsPath = join(dataDir, 'pi', 'settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const configuration = { provider: settings.defaultProvider, model: settings.defaultModel, thinking: settings.defaultThinkingLevel };
if (!configuration.provider || !configuration.model) throw new Error('当前模型配置缺少 provider/model，停止真实验收');
const safe = value => JSON.stringify(traceRedact(value), null, 2);
const save = (file, value) => writeFileSync(join(destination, file), safe(value));
save('code-snapshot.json', { capturedAt: new Date().toISOString(), files: Object.fromEntries([
  'pi-host.js', 'extension.js', 'mcp/catalog.js', 'mcp/service.js', 'mcp/model-projection.js',
  'mcp/pi-tools.js', 'mcp/client.js', 'mcp/server.js', 'mcp/transport.js', 'mcp/resource-policy.js',
  'mcp/resource-contract.js', 'mcp/resource-store.js', 'mcp/resource-images.js', 'mcp/subject-output.js', 'mcp/resource-output.js',
  'output/resource-content.js', 'output/provider-output.js', 'output/model-context.js',
].map(file => [file, createHash('sha256').update(readFileSync(new URL(`../dist/src/${file}`, import.meta.url))).digest('hex')])) });
const reads = new Set(['read', ...TOOL_DEFINITIONS.filter(tool => tool.effect === 'read').map(tool => tool.name)]);
const transport = createPiTransport(policyFor('http://127.0.0.1:7890'));
const responseSaves = [];
const providerWireComponents = [];
const providerWireToolCalls = [];
let responseCount = 0;
let responseCaptureBytes = 0;
const responseCaptureLimit = 8 * 1024 * 1024;
async function boundedResponseText(response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks = [];
  try { while (true) {
    const { value, done } = await reader.read(); if (done) break;
    if (responseCaptureBytes + value.byteLength > responseCaptureLimit) {
      await reader.cancel().catch(() => {}); throw new Error('脱敏provider响应采集达到8MiB总上限，原响应不受影响');
    }
    responseCaptureBytes += value.byteLength; chunks.push(value);
  } } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
const observedFetch = async (...args) => {
  const response = await transport.fetch(...args), number = ++responseCount;
  // Response副本只供验收落盘，原响应继续交给Pi原生解析；不保存认证头。
  if (typeof response.clone === 'function') {
    const clone = response.clone();
    responseSaves.push(boundedResponseText(clone).then(body => {
      const data = body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(line => line && line !== '[DONE]');
      const events = data.map(line => { try { return JSON.parse(line); } catch { return { undecodedData: line }; } });
      if (!events.length) { try { events.push(JSON.parse(body)); } catch { events.push({ undecodedBody: body.slice(0, 10000) }); } }
      const wireText = events.flatMap(event => (event.choices ?? []).map(choice => choice.delta?.content ?? '')).join('')
        || events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta ?? '').join('');
      const wireCalls = new Map();
      for (const event of events) for (const choice of event.choices ?? []) for (const item of choice.delta?.tool_calls ?? []) {
        const call = wireCalls.get(item.index ?? 0) ?? { name: '', arguments: '' };
        call.name += item.function?.name ?? ''; call.arguments += item.function?.arguments ?? ''; wireCalls.set(item.index ?? 0, call);
      }
      for (const call of wireCalls.values()) { let args; try { args = JSON.parse(call.arguments); } catch {}
        providerWireToolCalls.push({ response: number, name: call.name, ...(args ? { arguments: args } : { undecodedArguments: call.arguments }) }); }
      try {
        const visit = value => { if (!value || typeof value !== 'object') return;
          if (value.type && value.props && typeof value.props === 'object') providerWireComponents.push({ response: number, type: value.type,
            propsKeys: Object.keys(value.props), resourceRef: value.props.resourceRef,
            itemKeys: Array.isArray(value.props.items) ? value.props.items.map(item => Object.keys(item)) : [] });
          for (const child of Object.values(value)) visit(child);
        }; visit(JSON.parse(wireText));
      } catch { /* tool-only response或非JSON原文保留在SSE证据中 */ }
      save(`provider-response-${number}.json`, { status: response.status, events });
    }).catch(error => save(`provider-response-${number}.json`, { captureError: String(error.message) })));
  }
  return response;
};
const assistantMessages = [], calls = [], results = [], requests = [], pending = [], errors = [];
let runtime, final, timer, cancellationWatcher;
const started = Date.now();
function toolPayloads(payload) {
  const rows = payload?.messages ?? payload?.input ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row.role === 'tool' || row.type === 'function_call_output').map(row => {
    const wire = row.output ?? row.content;
    try { return JSON.parse(typeof wire === 'string' ? wire : JSON.stringify(wire)); } catch { return wire; }
  });
}
function collectFacts(value, path = '', result = []) {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (['summary', 'image', 'images', 'url', 'description', 'body', 'text'].includes(key) && typeof child === 'string' && child) result.push({ path: `${path}/${key}`, bytes: Buffer.byteLength(child) });
    collectFacts(child, `${path}/${key}`, result);
  }
  return result;
}
try {
  const base = createBangumiExtension({ authDir: join(dataDir, 'auth'), proxy: policyFor('http://127.0.0.1:7890'), timeoutMs: 60000,
    generateSessionTitle: async () => '资源引用只读验收',
    channel: { canConfirm: () => false, canLogin: () => false, confirm: async () => false, login: async () => { throw new Error('验收不执行登录'); }, notify: () => {} },
    trace: { directory: join(destination, 'trace'), entryPoint: 'print' } });
  runtime = await createBangumiRuntime({ cwd: process.cwd(), agentDir: join(dataDir, 'pi'), sessionManager: SessionManager.inMemory(process.cwd()),
    fetch: observedFetch, provider: configuration.provider, model: configuration.model,
    ...(configuration.thinking ? { thinkingLevel: configuration.thinking } : {}),
    extension: pi => { base(pi); pi.on('before_provider_request', event => {
      requests.push(traceRedact(event.payload));
      save(`provider-request-${requests.length}.json`, event.payload);
    }); } });
  runtime.session.setActiveToolsByName(runtime.session.getActiveToolNames().filter(name => reads.has(name)));
  runtime.session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'content_update') pending.push({ elapsedMs: Date.now() - started,
      parts: event.message.content.filter(part => !['text', 'thinking', 'toolCall'].includes(part.type)).map(part => ({ type: part.type, pending: part.pending })) });
    if (event.type !== 'message_end') return;
    const message = event.message;
    if (message.role === 'assistant') {
      assistantMessages.push(message); final = message;
      for (const part of message.content) if (part.type === 'toolCall') calls.push({ id: part.id, name: part.name, arguments: part.arguments });
      if (message.stopReason === 'error') errors.push(message.errorMessage ?? 'assistant_error');
    } else if (message.role === 'toolResult') results.push({ name: message.toolName, toolCallId: message.toolCallId, isError: message.isError,
      content: message.content, full: message.details ?? message.structuredContent });
  });
  timer = setTimeout(() => { void runtime.session.abort(); }, 360000);
  cancellationWatcher = setInterval(() => { if (existsSync(join(destination, 'cancel'))) void runtime.session.abort(); }, 1000);
  await runtime.session.prompt(prompts[scenario]); await runtime.session.waitForIdle();
  await Promise.allSettled(responseSaves);
  const content = final?.content.filter(part => !['thinking', 'toolCall'].includes(part.type)) ?? [];
  let schemaValid = false;
  try { validateMixedContent({ content }); schemaValid = final?.stopReason === 'stop'; } catch (error) { errors.push(String(error.message)); }
  const components = content.filter(part => part.type !== 'text');
  const toolProjectionAudit = results.map(result => {
    let model; try { model = JSON.parse(result.content?.find(part => part.type === 'text')?.text ?? '{}'); } catch {}
    const call = calls.find(call => call.id === result.toolCallId);
    return { name: result.name, arguments: call?.arguments, error: !!result.isError, modelBytes: Buffer.byteLength(JSON.stringify(model ?? {})),
      fullBytes: Buffer.byteLength(JSON.stringify(result.full ?? {})), resourceRefs: JSON.stringify(model ?? {}).match(/rr_[a-zA-Z0-9_-]+/g) ?? [],
      visibleDisplayFields: collectFacts(model), fullDisplayFields: collectFacts(result.full),
      displayFieldsExplicitlyRequested: call?.arguments?.fields ?? [] };
  });
  const providerPayloadAudit = requests.map((request, index) => ({ request: index + 1,
    tools: toolPayloads(request).map((value, item) => ({ item, bytes: Buffer.byteLength(JSON.stringify(value)), displayFields: collectFacts(value) })) }));
  const readOnly = calls.length > 0 && calls.every(call => reads.has(call.name));
  const cachedReadExecuted = calls.some(call => call.name === 'read_cached_resource') && results.some(result => result.name === 'read_cached_resource' && !result.isError);
  const imagePresent = components.some(part => collectFacts(part.props).some(field => field.path.endsWith('/image')));
  const providerVisibleThinking = assistantMessages.flatMap(message => message.content.filter(part => part.type === 'thinking')).filter(part => !part.redacted);
  const toolErrorCount = results.filter(result => result.isError).length;
  const wireReferencePresent = providerWireComponents.some(part => typeof part.resourceRef === 'string');
  const finalWireComponents = providerWireComponents.filter(part => part.response === responseCount);
  const finalWireReferencePresent = finalWireComponents.some(part => typeof part.resourceRef === 'string');
  const firstApiCall = providerWireToolCalls.find(call => call.name !== 'read' && call.name !== 'read_cached_resource')
    ?? calls.find(call => call.name !== 'read' && call.name !== 'read_cached_resource');
  const strictPrimaryKeyProof = firstApiCall?.name === 'get_subject_details' && JSON.stringify(firstApiCall.arguments) === '{"subject_id":253}';
  const defaultProjectionLeaks = toolProjectionAudit.filter(item => !item.error && !['read', 'read_cached_resource'].includes(item.name)
    && !(item.arguments?.fields?.length) && item.visibleDisplayFields.length > 0);
  const usage = assistantMessages.map(message => message.usage).filter(Boolean);
  const tokenUsage = Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].map(key =>
    [key, usage.reduce((sum, value) => sum + (Number(value[key]) || 0), 0)]));
  const cumulativeInputTokens = tokenUsage.input + tokenUsage.cacheRead + tokenUsage.cacheWrite;
  const peakRequestInputTokens = Math.max(0, ...usage.map(value => (Number(value.input) || 0) + (Number(value.cacheRead) || 0) + (Number(value.cacheWrite) || 0)));
  const endToEndValid = schemaValid && readOnly && cachedReadExecuted && imagePresent && finalWireReferencePresent && defaultProjectionLeaks.length === 0
    && (scenario !== 'subject_keys' || strictPrimaryKeyProof);
  const summary = { scenario, prompt: prompts[scenario], configuration, configurationSource: settingsPath, durationMs: Date.now() - started,
    stopReason: final?.stopReason, schemaValid, readOnly, cachedReadExecuted, imagePresent, componentTypes: components.map(part => part.type),
    allComponentsComplete: components.every(part => part.pending === false), providerVisibleThinkingParts: providerVisibleThinking.length,
    wireReferencePresent, finalWireReferencePresent, finalWireComponents, providerWireComponents, providerWireToolCalls, responseCaptureBytes, toolErrorCount, strictPrimaryKeyProof,
    requestCount: requests.length, toolCalls: calls.map(call => call.name), errors,
    tokenUsage, cumulativeInputTokens, peakRequestInputTokens, perMessageUsage: usage, endToEndValid,
    defaultProjectionLeakCount: defaultProjectionLeaks.length, defaultProjectionLeaks,
    realHttpCountEvidence: '现有 trace 未记录 HTTP 请求次数；cache-only 零请求由独立可计数 transport 测试证明',
    valid: endToEndValid && toolErrorCount === 0 && errors.length === 0 };
  save('assistant-messages.json', assistantMessages); save('provider-visible-thinking.json', providerVisibleThinking);
  save('tool-calls.json', calls); save('tool-results.json', results); save('canonical-answer.json', { content }); save('component-lifecycle.json', pending);
  save('projection-audit.json', { toolProjectionAudit, providerPayloadAudit }); save('summary.json', summary);
  console.log(JSON.stringify(summary, null, 2)); if (!summary.valid) process.exitCode = 1;
} catch (error) {
  const failure = { valid: false, scenario, configuration, durationMs: Date.now() - started, error: String(error.message) };
  save('assistant-messages.json', assistantMessages); save('tool-calls.json', calls); save('tool-results.json', results);
  save('component-lifecycle.json', pending);
  save('summary.json', failure); console.log(safe(failure)); process.exitCode = 1;
} finally { clearTimeout(timer); clearInterval(cancellationWatcher); await runtime?.dispose(); await transport.close(); await Promise.allSettled(responseSaves); }
