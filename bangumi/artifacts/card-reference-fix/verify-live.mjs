import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime } from '../../dist/src/pi-host.js';
import { createBangumiExtension } from '../../dist/src/extension.js';
import { LocalMcpClient } from '../../dist/src/mcp/client.js';
import { TOOL_DEFINITIONS } from '../../dist/src/mcp/catalog.js';
import { validateMixedContent } from '../../dist/src/output/content-schema.js';
import { createPiTransport } from '../../dist/src/pi-transport.js';
import { policyFor } from '../../dist/src/support/proxy.js';
import { ProxyController } from '../../dist/src/support/proxy-controller.js';
import { TaskQueue } from '../../dist/src/support/task-queue.js';
import { AccountSessionStore } from '../../dist/src/login/index.js';
import { AppError, safeError } from '../../dist/src/support/errors.js';
import { WebInteractionChannel } from '../../dist/src/web/session.js';
import { WebSessionManager } from '../../dist/src/web/session-manager.js';
import { startWebTerminal } from '../../dist/src/web/server.js';

const cwd = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dataRoot = process.env.BANGUMI_PI_HOME ?? path.join(process.env.LOCALAPPDATA, 'MyBangumiAssistant-Pi');
const runRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), `live-${Date.now()}`);
const agentDir = path.join(runRoot, 'pi'), sessionDir = path.join(agentDir, 'sessions');
fs.mkdirSync(agentDir, { recursive: true });
fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultThinkingLevel: 'high', retry: { enabled: true } }));
const proxy = new ProxyController(policyFor('http://127.0.0.1:7890'));
const providerTransport = createPiTransport(proxy.current);
const modelRuntime = await ModelRuntime.create({ authPath: path.join(dataRoot, 'pi', 'auth.json'),
  modelsPath: path.join(dataRoot, 'pi', 'models.json'), allowModelNetwork: false });
const authDir = path.join(dataRoot, 'auth'), channel = new WebInteractionChannel();
channel.canLogin = () => false; channel.canConfirm = () => false;
const client = new LocalMcpClient({ authDir, timeoutMs: 60000, proxy: proxy.current });
const definitions = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
const calls = [], selections = [], errors = [], toolErrors = [], requests = [];
let runtime, sessions, terminal, placeholderSeen = false, completeSeen = false;
const guarded = {
  async call(name, args, signal, guard, batch, read) {
    if (definitions.get(name)?.effect !== 'read') throw new AppError('AUTHORIZATION_REQUIRED', '本次验收仅允许读取，写工具已被阻断。');
    calls.push({ name, subjectId: args.subject_id ?? null });
    process.stdout.write(JSON.stringify({ event: 'read', count: calls.length, name }) + '\n');
    try { return await client.call(name, args, signal, guard, batch, read); }
    catch (error) { toolErrors.push({ name, error: safeError(error) }); throw error; }
  },
  async readCachedResource(ref, signal, read, selection) {
    selections.push(selection ?? null);
    return client.readCachedResource(ref, signal, read, selection);
  },
  endReadContext: turnId => client.endReadContext(turnId), close: () => client.close(),
};
const manager = SessionManager.create(cwd, sessionDir);
const timeout = setTimeout(() => { process.stdout.write('{"event":"timeout"}\n'); void runtime?.session.abort(); }, 900000);
let result;
try {
  runtime = await createBangumiRuntime({ cwd, agentDir, modelRuntime, sessionManager: manager,
    provider: 'deepseek', model: 'deepseek-flash', thinkingLevel: 'high', fetch: providerTransport.fetch,
    extension: pi => {
      createBangumiExtension({ authDir, timeoutMs: 60000, proxy, client: guarded, channel,
        generateSessionTitle: async () => '百合卡片修复验收', trace: { directory: path.join(runRoot, 'tracelog') } })(pi);
      pi.on('before_provider_request', event => {
        requests.push({ model: event.payload?.model, maxTokens: event.payload?.max_tokens,
          reasoningEffort: event.payload?.reasoning_effort, thinking: event.payload?.thinking });
      });
    },
  });
  runtime.session.subscribe(event => {
    if (event.type === 'message_update') for (const part of (event.assistantMessageEvent?.partial ?? event.message)?.content ?? []) {
      if (part.type === 'SubjectCards') {
        if (part.pending === true) placeholderSeen = true;
        if (part.pending === false) completeSeen = true;
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error')
      errors.push({ message: event.message.errorMessage, diagnostics: event.message.diagnostics });
  });
  await runtime.session.prompt('推荐几部我没看过的百合标签、评分 8 分以上的动画');
  await runtime.session.waitForIdle();
  const answer = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  const content = answer.content.filter(part => !['thinking', 'toolCall'].includes(part.type));
  validateMixedContent({ content });
  const cards = content.filter(part => part.type === 'SubjectCards').flatMap(part => part.props.items);
  const restored = SessionManager.open(manager.getSessionFile());
  const saved = restored.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant').message;
  result = { status: answer.stopReason, provider: 'deepseek', model: 'deepseek-flash', thinking: 'high', requests,
    cardCount: cards.length, withImage: cards.filter(item => typeof item.image === 'string' && item.image).length,
    layouts: content.filter(part => part.type === 'SubjectCards').map(part => part.props.layout),
    selectedRpcCalls: selections.filter(Boolean).length, calls, errors, toolErrors, placeholderSeen, completeSeen,
    replayEqual: JSON.stringify(saved.content) === JSON.stringify(answer.content),
    ids: cards.map(item => item.id), sessionFile: manager.getSessionFile(), content };
  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ event: 'complete', resultFile: path.join(runRoot, 'result.json'),
    status: result.status, cardCount: result.cardCount, withImage: result.withImage, errorCount: errors.length,
    replayEqual: result.replayEqual, placeholderSeen, completeSeen, requestCount: requests.length }) + '\n');
  if (!cards.length || result.withImage !== cards.length || answer.stopReason !== 'stop') process.exitCode = 1;
  if (process.argv.includes('--serve') && cards.length) {
    clearTimeout(timeout);
    sessions = new WebSessionManager({ initial: { runtime, channel }, store: new AccountSessionStore(authDir), cwd, sessionDir,
      proxy, timeoutMs: 60000, accountQueue: new TaskQueue(),
      createRuntime: async () => { throw new AppError('INVALID_INPUT', '验收预览只展示本次结果。'); },
    });
    await sessions.start();
    const port = await new Promise((resolve, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(error => error ? reject(error) : resolve(port)); });
    });
    terminal = await startWebTerminal({ sessions, port, open: false });
    process.stdout.write(JSON.stringify({ event: 'browser_ready', port: terminal.port }) + '\n');
    await Promise.race([terminal.closed, new Promise(resolve => {
      process.stdin.resume(); process.stdin.once('data', resolve); process.stdin.once('end', resolve); setTimeout(resolve, 1200000).unref();
    })]);
  }
} catch (error) {
  result = { status: 'failed', error: safeError(error), calls, errors, requests };
  fs.writeFileSync(path.join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify({ event: 'failed', resultFile: path.join(runRoot, 'result.json'), error: result.error }) + '\n');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await terminal?.close();
  await sessions?.dispose();
  if (!sessions) await runtime?.dispose();
  await client.close(); await providerTransport.close();
}
