#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type Args, InteractiveMode, parseArgs, runPrintMode, runRpcMode, SessionManager, VERSION,
} from '@earendil-works/pi-coding-agent';
import { createBangumiExtension } from './extension.js';
import { createBangumiRuntime } from './pi-host.js';
import { createPiTransport } from './pi-transport.js';
import { AppError, safeError } from './support/errors.js';
import {
  environmentProxy, policyFor, readWindowsProxy, windowsProxy, type ProxyOptions, type ProxyPolicy,
} from './support/proxy.js';

export interface LauncherOptions { pi: Args; dataDir: string; timeoutMs: number; proxy?: ProxyOptions }

/** 通用参数仍由 Pi 解析，只提取本应用的隔离目录和网络策略。 */
export function parseLauncherArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): LauncherOptions {
  const piArgs: string[] = [];
  let dataDir = env.BANGUMI_PI_HOME ?? join(env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'MyBangumiAssistant-Pi');
  let timeoutMs = 60_000;
  let proxy: ProxyOptions | undefined;
  const allowed = new Set(['--help', '-h', '--version', '-v', '--print', '-p', '--mode', '--continue', '-c', '--session', '--no-session', '--session-dir', '--name', '-n', '--provider', '--model', '--thinking', '--list-models', '--tui-mode', '--use-theme', '--verbose']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--') { piArgs.push(...argv.slice(index)); break; }
    if (['--data-dir', '--timeout', '--proxy'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new AppError('INVALID_ARGUMENT', `${arg} 需要一个值。`);
      if (arg === '--data-dir') dataDir = value;
      else if (arg === '--proxy') proxy = policyFor(value);
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
  const pi = parseArgs(piArgs);
  if (pi.diagnostics.some(item => item.type === 'error') || pi.unknownFlags.size || pi.fileArgs.length) {
    throw new AppError('INVALID_ARGUMENT', 'Pi 参数无效；使用 --help 查看入口选项。');
  }
  return { pi, dataDir: resolve(dataDir), timeoutMs, ...(proxy === undefined ? {} : { proxy }) };
}

async function discoverProxy(explicit?: ProxyOptions): Promise<ProxyPolicy> {
  if (explicit !== undefined) return policyFor(explicit);
  if (process.env.BANGUMI_AGENT_PROXY !== undefined) return policyFor(process.env.BANGUMI_AGENT_PROXY, 'app-env');
  const environment = environmentProxy(process.env);
  if (environment) return environment;
  if (process.platform === 'win32') {
    const system = windowsProxy(await readWindowsProxy());
    if (system) return system;
  }
  return policyFor(null, 'direct');
}

const help = `MyBangumiAssistant · Pi ${VERSION}
用法：my-bangumi-assistant [Pi 参数] [消息]

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
  --proxy <地址>         显式 HTTP/HTTPS 代理
  --direct               显式直连，关闭自动发现
  --timeout <毫秒>       Bangumi 请求超时，默认 60000

交互命令：/bangumi-login、/bangumi-login-status、/bangumi-logout。
模型、会话恢复、分支和压缩使用 Pi 原生 /model、/resume、/tree、/compact。
模型配置保存在数据目录的 pi/models.json，密钥使用环境变量引用。
`;

export async function launcherMain(argv = process.argv.slice(2)): Promise<number> {
  const options = parseLauncherArgs(argv);
  const args = options.pi;
  if (args.help) { process.stdout.write(help); return 0; }
  if (args.version) { process.stdout.write(`MyBangumiAssistant Pi ${VERSION}\n`); return 0; }
  const interactive = !args.print && args.mode === undefined && process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive && args.mode !== 'rpc' && !args.listModels && args.messages.length === 0) {
    throw new AppError('TTY_REQUIRED', '交互模式需要终端；单次运行请使用 --print "消息"。');
  }
  const proxy = await discoverProxy(options.proxy);
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
  const transport = createPiTransport(proxy);
  let runtime;
  let printOwnsDisposal = false;
  try {
    runtime = await createBangumiRuntime({
      cwd, agentDir, sessionManager, fetch: transport.fetch,
      extension: createBangumiExtension({ authDir, timeoutMs: options.timeoutMs, proxy }),
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
    if (runtime && !printOwnsDisposal) await runtime.dispose();
    await transport.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launcherMain().then(code => { process.exitCode = code; }).catch(error => {
    const safe = safeError(error);
    process.stderr.write(`${safe.code}：${safe.message}\n`);
    process.exitCode = 1;
  });
}
