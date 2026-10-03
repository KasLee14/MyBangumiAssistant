#!/usr/bin/env node
/**
 * 一条命令启动 Web 终端的本地调试：宿主进程 + 前端开发服务器（HMR）。
 *
 * 宿主仍是唯一持有 Pi 运行时、工具与会话的进程，它照旧从构建产物启动、只监听
 * 回环地址并校验一次性令牌；这里只负责把它启动时打印的令牌与端口交给 Vite，
 * 由 Vite 的 `/api` 反代把浏览器的请求转回宿主（配置见 vite.config.ts）。
 *
 * 用法（在 bangumi/ 目录）：
 *   node dev-web.mjs [--host-port 8787] [--web-port 5173] [--proxy <地址>]
 *
 * 默认让宿主走 `--direct`（不自动发现 Windows 系统代理）：自动发现需要在 Windows 上
 * 起子进程读注册表，在受限沙箱里会以 spawn EPERM 失败。需要走代理时用 `--proxy`，
 * 或设置 `BANGUMI_AGENT_PROXY`；用 `--auto-proxy` 恢复宿主的自动发现。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = join(here, 'dist', 'src', 'main.js');
/** 宿主启动地址里的令牌；格式由 src/web/server.ts 固定为 64 位十六进制。 */
const TOKEN_PATTERN = /[?&]token=([0-9a-f]{64})/;
/** 单个端口最多向后顺延的次数，与宿主的 PORT_ATTEMPTS 保持一致。 */
const PORT_ATTEMPTS = 20;
/** 等宿主打印地址的上限；超过就认为启动失败。 */
const READY_TIMEOUT_MS = 60_000;

const usage = `用法：node dev-web.mjs [选项]

  --host-port <端口>   宿主监听端口，默认 8787（被占用时向后顺延）
  --web-port <端口>    前端开发服务器端口，默认 5173（被占用时向后顺延）
  --proxy <地址>       宿主走该 HTTP/HTTPS 代理
  --auto-proxy         宿主按 Pi 原生逻辑自动发现代理（Windows 上需要读注册表）
  -h, --help           显示本帮助
`;

function parseOptions(argv) {
  const options = { hostPort: 8787, webPort: 5173, autoProxy: false, proxy: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') { process.stdout.write(usage); process.exit(0); }
    if (arg === '--auto-proxy') { options.autoProxy = true; continue; }
    if (arg === '--proxy') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error('--proxy 需要一个地址。');
      options.proxy = value;
      continue;
    }
    if (arg === '--host-port' || arg === '--web-port') {
      const value = argv[++index];
      const port = Number(value);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`${arg} 需要 1～65535 的整数。`);
      if (arg === '--host-port') options.hostPort = port;
      else options.webPort = port;
      continue;
    }
    throw new Error(`未支持的参数：${arg}（用 --help 查看用法）。`);
  }
  return options;
}

/** 探测端口是否可用；只把「被占用」当作可继续的信号，其它错误照实抛出。 */
function portFree(port) {
  return new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      probe.close();
      if (error.code === 'EADDRINUSE') accept(false);
      else reject(error);
    });
    probe.once('listening', () => probe.close(() => accept(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/** 从起始端口向后找第一个空闲端口，避免宿主与 dev server 撞在一起。 */
async function pickPort(start) {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset++) {
    const candidate = start + offset;
    if (candidate > 65535) break;
    if (await portFree(candidate)) return candidate;
  }
  throw new Error(`${start}～${Math.min(65535, start + PORT_ATTEMPTS - 1)} 都被占用，可用 --host-port/--web-port 另选。`);
}

/**
 * Vite 的启动方式：直接用 node 跑它的 JS 入口。
 *
 * 不走 `node_modules/.bin/vite`（Windows 上是 .cmd）：那会多出一层 cmd 包装进程，
 * 而这层的父进程一旦先退出，`taskkill /T` 就追不到它下面的真正 node 进程，
 * 结果 dev server 会变成孤儿继续占着端口。
 */
function viteCommand() {
  const entry = join(here, 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(entry)) return { command: process.execPath, args: [entry] };
  return { command: process.execPath, args: [join(here, 'node_modules', 'vite', 'bin', 'vite.mjs')] };
}

/** 子进程输出原样转发到终端；不缓冲，保证 Vite 的提示与宿主日志实时可见。 */
function forward(child) {
  child.stdout?.on('data', chunk => process.stdout.write(chunk));
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
}

function waitForExit(child) {
  return new Promise(accept => child.once('exit', (code, signal) => accept({ code, signal })));
}

/**
 * 兜底停止一个子进程。
 *
 * Windows 上 `child.kill()` 只结束直接子进程：npm run 与 .cmd 包装会留下真正的
 * node/vite 进程占着端口，所以走 `taskkill /T` 连同它的进程树一起结束。
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!existsSync(HOST_ENTRY)) {
    process.stderr.write(`缺少宿主构建产物 ${HOST_ENTRY}；先执行 npm run build。\n`);
    return 1;
  }

  const hostPort = await pickPort(options.hostPort);
  const webPort = await pickPort(options.webPort);
  if (hostPort !== options.hostPort) process.stdout.write(`宿主端口 ${options.hostPort} 被占用，改用 ${hostPort}。\n`);
  if (webPort !== options.webPort) process.stdout.write(`前端端口 ${options.webPort} 被占用，改用 ${webPort}。\n`);

  const hostArgs = [HOST_ENTRY, 'web', '--no-open', '--port', String(hostPort)];
  if (options.proxy !== undefined) hostArgs.push('--proxy', options.proxy);
  else if (!options.autoProxy) hostArgs.push('--direct');

  const host = spawn(process.execPath, hostArgs, { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let token;
  let seen = '';
  let ready;
  const readyPromise = new Promise(accept => { ready = accept; });
  host.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    if (token) return;
    // 地址可能被拆到两个 data 块里，先累积再匹配。
    seen += chunk.toString('utf8');
    const match = TOKEN_PATTERN.exec(seen);
    if (match) { token = match[1]; ready(); }
  });
  host.stderr.on('data', chunk => process.stderr.write(chunk));
  host.once('exit', (code, signal) => {
    if (!token) ready();
    process.stderr.write(`\n宿主进程已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）。\n`);
  });

  const timedOut = await Promise.race([
    readyPromise.then(() => false),
    new Promise(accept => setTimeout(() => accept(true), READY_TIMEOUT_MS)),
  ]);
  if (!token) {
    process.stderr.write(timedOut
      ? `等待宿主打印访问地址超时（${READY_TIMEOUT_MS / 1000} 秒）。\n`
      : '宿主未能启动，未取得访问令牌。\n');
    killTree(host);
    return 1;
  }

  const vite = viteCommand();
  const web = spawn(vite.command, vite.args, {
    cwd: here,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, BGM_WEB_PORT: String(hostPort), BGM_DEV_PORT: String(webPort), BGM_WEB_TOKEN: token },
  });
  forward(web);

  process.stdout.write(`\n调试地址：http://127.0.0.1:${webPort}/  ← 改 web/src 会立即热更新\n`);
  process.stdout.write(`宿主地址：http://127.0.0.1:${hostPort}/（构建产物形态，调试不用它）\n`);
  process.stdout.write('停止：在本终端按 Ctrl+C。\n\n');

  // Ctrl+C 会广播给同控制台的子进程，但 npm run 与 .cmd 包装会在中间多出一层，
  // 所以这里显式先收掉整棵树再退出，避免留下占着端口的孤儿进程。
  let stopRequested = false;
  const stopAll = (signal) => {
    if (stopRequested) return;
    stopRequested = true;
    process.stdout.write(`\n收到 ${signal}，正在停止宿主与前端开发服务器…\n`);
    killTree(host);
    killTree(web);
    // 子进程万一不响应，也不要让父进程永远挂着。
    setTimeout(() => process.exit(0), 5000).unref();
  };
  const onInterrupt = () => stopAll('Ctrl+C');
  const onTerminate = () => stopAll('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  // 任一进程先退出就整体收尾，避免留下半个环境（例如宿主没了但页面还挂着旧令牌）。
  const first = await Promise.race([
    waitForExit(host).then(result => ({ who: '宿主', ...result })),
    waitForExit(web).then(result => ({ who: '前端开发服务器', ...result })),
  ]);
  process.stdout.write(`\n${first.who}已退出，正在停止另一个进程…\n`);
  killTree(host);
  killTree(web);
  await Promise.all([waitForExit(host), waitForExit(web)]);
  // 正常收尾（0）或收到信号都算干净退出，只有子进程真的报错才透传它的退出码。
  if (first.code === 0 || first.signal) return 0;
  return first.code ?? 1;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
