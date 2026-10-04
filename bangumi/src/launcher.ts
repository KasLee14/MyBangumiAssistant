#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type Args, InteractiveMode, parseArgs, runPrintMode, runRpcMode, SessionManager, VERSION,
} from '@earendil-works/pi-coding-agent';
import { createBangumiExtension } from './extension.js';
import { createTerminalChannel, type InteractionChannel } from './interaction.js';
import { AccountSessionStore } from './login/index.js';
import { createBangumiRuntime } from './pi-host.js';
import { createPiTransport } from './pi-transport.js';
import { AppError, safeError } from './support/errors.js';
import { policyFor, type ProxyOptions } from './support/proxy.js';
import { discoverProxy, ProxyController, type ProxyMode } from './support/proxy-controller.js';
import { startWebTerminal } from './web/server.js';
import { WebInteractionChannel } from './web/session.js';
import { WebSessionManager } from './web/session-manager.js';
import { TaskQueue } from './support/task-queue.js';
import { analyzeTrace } from './tracing/analyze.js';
import type { TraceOptions } from './tracing/schema.js';

export interface WebOptions { port: number; open: boolean }

export interface LauncherOptions { pi: Args; dataDir: string; timeoutMs: number; proxy?: ProxyOptions; web?: WebOptions; trace?: TraceOptions }

/** Web 终端的默认端口与两个入口专属开关。 */
const DEFAULT_WEB_PORT = 8787;

/** 只解析本应用自己的参数，其余交给 Pi；web 子命令先摘掉自己的开关。 */
function parsePiArgs(argv: string[], env: NodeJS.ProcessEnv): Omit<LauncherOptions, 'web'> {
  const piArgs: string[] = [];
  let dataDir = env.BANGUMI_PI_HOME ?? join(env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'MyBangumiAssistant-Pi');
  let timeoutMs = 60_000;
  let proxy: ProxyOptions | undefined;
  let traceMode = env.BANGUMI_TRACE ?? 'local';
  let traceDirectory = env.BANGUMI_TRACE_DIR;
  const allowed = new Set(['--help', '-h', '--version', '-v', '--print', '-p', '--mode', '--continue', '-c', '--session', '--no-session', '--session-dir', '--name', '-n', '--provider', '--model', '--thinking', '--list-models', '--tui-mode', '--use-theme', '--verbose']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--') { piArgs.push(...argv.slice(index)); break; }
    if (['--data-dir', '--timeout', '--proxy', '--trace', '--trace-dir'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new AppError('INVALID_ARGUMENT', `${arg} 需要一个值。`);
      if (arg === '--data-dir') dataDir = value;
      else if (arg === '--proxy') proxy = policyFor(value);
      else if (arg === '--trace') traceMode = value;
      else if (arg === '--trace-dir') traceDirectory = value;
      else {
        timeoutMs = Number(value);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw new AppError('INVALID_ARGUMENT', '--timeout 需要 1000～300000 毫秒。');
      }
      continue;
    }
    if (arg === '--direct') { proxy = null; continue; }
    if (arg.startsWith('-') && !allowed.has(arg)) throw new AppError('INVALID_ARGUMENT', '存在未支持的参数；使用 --help 查看入口选项。');
    piArgs.push(arg);
  }
  if (!['local', 'off'].includes(traceMode)) throw new AppError('INVALID_ARGUMENT', '--trace（或 BANGUMI_TRACE）只能是 local 或 off。');
  const pi = parseArgs(piArgs);
  if (pi.diagnostics.some(item => item.type === 'error') || pi.unknownFlags.size || pi.fileArgs.length) {
    throw new AppError('INVALID_ARGUMENT', 'Pi 参数无效；使用 --help 查看入口选项。');
  }
  return { pi, dataDir: resolve(dataDir), timeoutMs, ...(proxy === undefined ? {} : { proxy }),
    ...(traceMode === 'off' ? {} : { trace: { directory: resolve(traceDirectory ?? join(dataDir, 'tracelog')) } }) };
}

export function parseLauncherArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): LauncherOptions {
  if (argv[0] === 'web') {
    let port = DEFAULT_WEB_PORT;
    let open = true;
    const rest: string[] = [];
    for (let index = 1; index < argv.length; index++) {
      const arg = argv[index]!;
      if (arg === '--no-open') { open = false; continue; }
      if (arg === '--port') {
        const value = argv[++index];
        const parsed = Number(value);
        if (!value || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new AppError('INVALID_ARGUMENT', '--port 需要 1～65535 的整数。');
        port = parsed;
        continue;
      }
      rest.push(arg);
    }
    return { ...parsePiArgs(rest, env), web: { port, open } };
  }
  return parsePiArgs(argv, env);
}

const help = `MyBangumiAssistant · Pi ${VERSION}
用法：my-bangumi-assistant [Pi 参数] [消息]
      my-bangumi-assistant web [--port 8787] [--no-open] [Pi 参数]
      my-bangumi-assistant trace-analyze <某次 trace 目录>

  web                     启动本机浏览器 Web 终端；默认自动打开带令牌的地址
  --port <端口>           Web 终端端口，默认 ${DEFAULT_WEB_PORT}，被占用时顺延
  --no-open               只打印地址，不自动打开浏览器
  --print, -p <消息>       Pi 单次文本输出
  --mode json|rpc         Pi 原生 JSON 事件或 RPC
  --provider <提供方>     Pi models.json 中的提供方
  --model <模型>          Pi 模型名或 provider/model
  --thinking <级别>       off/minimal/low/medium/high/xhigh/max
  --continue, -c          继续最近的 Pi 会话
  --session <路径或ID>    恢复指定 Pi 会话
  --no-session           内存会话
  --list-models          列出 Pi 模型
  --data-dir <目录>      隔离登录和 Pi 数据（或 BANGUMI_PI_HOME）
  --trace local|off      独立 tracelog，默认 local（或 BANGUMI_TRACE）
  --trace-dir <目录>     日志根目录，默认数据目录/tracelog（或 BANGUMI_TRACE_DIR）
  --proxy <地址>         显式 HTTP/HTTPS 代理
  --direct               显式直连，关闭自动发现
  --timeout <毫秒>       Bangumi 请求超时，默认 60000

交互命令：/bangumi-login、/bangumi-login-status、/bangumi-logout。
模型、会话恢复、分支和压缩使用 Pi 原生 /model、/resume、/tree、/compact。
模型配置保存在数据目录的 pi/models.json，密钥使用环境变量引用。
`;

export async function launcherMain(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === 'trace-analyze') {
    if (argv.length !== 2 || !argv[1]) throw new AppError('INVALID_ARGUMENT', '用法：my-bangumi-assistant trace-analyze <某次 trace 目录>。');
    process.stdout.write(JSON.stringify(await analyzeTrace(argv[1]), null, 2) + '\n');
    return 0;
  }
  const options = parseLauncherArgs(argv);
  const args = options.pi;
  if (args.help) { process.stdout.write(help); return 0; }
  if (args.version) { process.stdout.write(`MyBangumiAssistant Pi ${VERSION}\n`); return 0; }
  const interactive = !options.web && !args.print && args.mode === undefined && process.stdin.isTTY && process.stdout.isTTY;
  const trace = options.trace ? { ...options.trace, entryPoint: options.web ? 'web' as const : args.mode === 'rpc' ? 'rpc' as const
    : args.mode === 'json' ? 'json' as const : interactive ? 'cli' as const : 'print' as const } : undefined;
  if (!interactive && options.web === undefined && args.mode !== 'rpc' && !args.listModels && args.messages.length === 0) {
    throw new AppError('TTY_REQUIRED', '交互模式需要终端；单次运行请使用 --print "消息"，浏览器界面请使用 web 子命令。');
  }
  // 启动时定一次线路，之后可以在 Web 终端里运行内切换（只影响本次运行）。
  // 同时记住启动时用的是哪种配置项，供设置弹窗回显（自动发现 / 直连 / 手动指定）。
  const proxyMode: ProxyMode = options.proxy === undefined ? 'auto' : options.proxy === null ? 'direct' : 'manual';
  const proxy = new ProxyController(await discoverProxy(options.proxy), proxyMode);
  const agentDir = join(options.dataDir, 'pi');
  const authDir = join(options.dataDir, 'auth');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(authDir, { recursive: true });
  const cwd = process.cwd();
  const sessionDir = args.sessionDir ? resolve(args.sessionDir) : join(agentDir, 'sessions');
  let sessionManager: SessionManager;
  if (args.session) {
    const path = SessionManager.findById(cwd, args.session, sessionDir) ?? resolve(args.session);
    if (!existsSync(path)) throw new AppError('SESSION_NOT_FOUND', '指定 Pi 会话不存在。');
    sessionManager = SessionManager.open(path, sessionDir);
  } else if (args.noSession) sessionManager = SessionManager.inMemory(cwd);
  else if (args.continue) sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  else sessionManager = SessionManager.create(cwd, sessionDir);
  const transport = createPiTransport(proxy.current);
  // 换线路时先更新 dispatcher：Pi 侧已注入的 fetch 会立刻走新线路，无需重建运行时。
  proxy.onChange(candidate => transport.update(candidate));
  // Web 终端需要在浏览器里确认写入与输入登录字段，终端模式沿用原地的 Pi 组件。
  const webChannel = options.web ? new WebInteractionChannel() : undefined;
  const channel: InteractionChannel = webChannel ?? createTerminalChannel();
  const accountQueue = new TaskQueue();
  let runtime;
  let webSessions: WebSessionManager | undefined;
  let printOwnsDisposal = false;
  try {
    runtime = await createBangumiRuntime({
      cwd, agentDir, sessionManager, fetch: transport.fetch,
      extension: createBangumiExtension({ authDir, timeoutMs: options.timeoutMs, proxy, channel, accountQueue,
        ...(trace ? { trace } : {}) }),
      ...(args.provider === undefined ? {} : { provider: args.provider }),
      ...(args.model === undefined ? {} : { model: args.model }),
      ...(args.thinking === undefined ? {} : { thinkingLevel: args.thinking }),
    });
    if (args.name) runtime.session.sessionManager.appendSessionInfo(args.name);
    if (args.listModels) {
      const pattern = typeof args.listModels === 'string' ? args.listModels.toLowerCase() : '';
      for (const model of runtime.services.modelRuntime.getModels()) {
        const name = `${model.provider}/${model.id}`;
        if (!pattern || name.toLowerCase().includes(pattern)) process.stdout.write(`${name}\n`);
      }
      return 0;
    }
    if (options.web && webChannel) {
      const modelRuntime = runtime.services.modelRuntime;
      webSessions = new WebSessionManager({ initial: { runtime, channel: webChannel },
        store: new AccountSessionStore(authDir), cwd, sessionDir, proxy, timeoutMs: options.timeoutMs, accountQueue,
        createRuntime: (manager, sessionChannel) => createBangumiRuntime({
          cwd, agentDir, sessionManager: manager, modelRuntime, fetch: transport.fetch,
          extension: createBangumiExtension({ authDir, timeoutMs: options.timeoutMs, proxy, channel: sessionChannel, accountQueue,
            ...(trace ? { trace } : {}) }),
          ...(args.provider === undefined ? {} : { provider: args.provider }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.thinking === undefined ? {} : { thinkingLevel: args.thinking }),
        }),
      });
      await webSessions.start();
      const terminal = await startWebTerminal({ sessions: webSessions, port: options.web.port, open: options.web.open });
      await terminal.closed;
      return 0;
    }
    if (args.mode === 'rpc') return await runRpcMode(runtime);
    const [initialMessage, ...messages] = args.messages;
    if (interactive) {
      await new InteractiveMode(runtime, {
        startupDiagnostics: [...runtime.diagnostics],
        ...(runtime.modelFallbackMessage === undefined ? {} : { modelFallbackMessage: runtime.modelFallbackMessage }),
        ...(initialMessage === undefined ? {} : { initialMessage }), initialMessages: messages,
        ...(args.tuiMode === undefined ? {} : { tuiMode: args.tuiMode }),
        ...(args.useTheme === undefined ? {} : { initialThemeSetting: args.useTheme }),
        ...(args.verbose === undefined ? {} : { verbose: args.verbose }),
      }).run();
      return 0;
    }
    printOwnsDisposal = true;
    return await runPrintMode(runtime, {
      mode: args.mode === 'json' ? 'json' : 'text', messages,
      ...(initialMessage === undefined ? {} : { initialMessage }),
    });
  } finally {
    // print 模式自行处置运行时；其余分支（含 Web 终端退出后）由这里统一释放。
    try {
      if (webSessions) await webSessions.dispose();
      else if (runtime && !printOwnsDisposal) await runtime.dispose();
    } finally { await transport.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launcherMain().then(code => { process.exitCode = code; }).catch(error => {
    const safe = safeError(error);
    process.stderr.write(`${safe.code}：${safe.message}\n`);
    process.exitCode = 1;
  });
}
