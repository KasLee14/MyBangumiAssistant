import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, safeError } from '../support/errors.js';
import type { ChatStateView, ServerEvent, ThinkingLevelName, TranscriptItemView } from './protocol.js';
import type { WebInteractionChannel, WebSession } from './session.js';

export interface WebTerminalOptions {
  session: WebSession;
  /** 浏览器连接数决定写入确认与登录输入是否可用。 */
  channel: WebInteractionChannel;
  /** 仅监听回环地址上的该端口。 */
  port: number;
  /** 启动后用默认浏览器打开带一次性令牌的地址。 */
  open: boolean;
  /** 静态资源目录；默认取构建产物 bangumi/dist/web。 */
  assetsDir?: string;
}

export interface WebTerminal {
  url: string;
  port: number;
  /** 停止服务并结束所有事件流；重复调用无害。 */
  close(): Promise<void>;
  /** 服务停止后 resolve，供调用方决定进程何时退出。 */
  closed: Promise<void>;
}

/** 单个客户端的下发记账：已下发的编号范围与各条目版本。 */
interface StreamBookkeeping {
  firstId: number | null;
  lastId: number;
  count: number;
  versions: Map<number, number>;
}

interface StreamClient extends StreamBookkeeping {
  res: ServerResponse;
  closed: boolean;
}

/**
 * 计算本帧要下发的条目，并更新下发记账。
 *
 * 三种情况必须下发：整体替换（首帧、会话切换、条目变少）、新条目（编号更大）、
 * 条目原地更新（编号不变但版本变了）。导出这个纯函数是为了能直接用脚本核对
 * 增量行为，避免只靠肉眼读闭包内的逻辑。
 */
export function takeFreshItems(
  items: readonly TranscriptItemView[],
  bookkeeping: StreamBookkeeping,
): { full: boolean; fresh: TranscriptItemView[] } {
  const first = items[0]?.id ?? 0;
  const last = items.at(-1)?.id ?? 0;
  const full = bookkeeping.firstId === null || items.length < bookkeeping.count || first !== bookkeeping.firstId;
  const fresh = full
    ? [...items]
    : items.filter(item => item.id > bookkeeping.lastId || bookkeeping.versions.get(item.id) !== item.version);
  bookkeeping.firstId = first;
  bookkeeping.lastId = last;
  bookkeeping.count = items.length;
  // 版本表按条目累积，整体替换时才重建（旧会话的编号不会再出现）。
  if (full) bookkeeping.versions.clear();
  for (const item of fresh) bookkeeping.versions.set(item.id, item.version);
  return { full, fresh };
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
};

/** 端口被占用时最多向后尝试的端口数。 */
const PORT_ATTEMPTS = 20;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', `${label}必须是 JSON 对象。`);
  return value as Record<string, unknown>;
}

function textValue(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new AppError('INVALID_INPUT', `${label}必须是${allowEmpty ? '' : '非空且'}不超过 ${max} 字的文本。`);
  }
  return value;
}

function positiveIntValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new AppError('INVALID_INPUT', `${label}必须是正整数。`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new AppError('INVALID_INPUT', `${label}必须是布尔值。`);
  return value;
}

/**
 * 启动本机 Web 终端：静态资源、会话状态事件流与命令接口。
 *
 * 只监听 127.0.0.1，并要求一次性令牌换取的 HttpOnly Cookie；Host 头必须是回环
 * 地址，避免浏览器被其它来源当作跳板。浏览器端只提交命令，授权判定、写入预览
 * 内容与提交前的复核仍在宿主。
 */
export async function startWebTerminal(options: WebTerminalOptions): Promise<WebTerminal> {
  const { session, channel } = options;
  const assetsDir = resolve(options.assetsDir ?? fileURLToPath(new URL('../../web/', import.meta.url)));
  const token = randomBytes(32).toString('hex');
  const clients = new Set<StreamClient>();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });

  const sameToken = (candidate: string): boolean => {
    const left = Buffer.from(candidate, 'utf8');
    const right = Buffer.from(token, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  };
  const loopbackHost = (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').toLowerCase();
    return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
  };
  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers['x-bgm-token'];
    if (typeof header === 'string' && sameToken(header)) return true;
    const match = /(?:^|;\s*)bgm_web_token=([0-9a-f]{64})/.exec(req.headers.cookie ?? '');
    return match ? sameToken(match[1]!) : false;
  };
  const sendJson = (res: ServerResponse, status: number, value: unknown): void => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...SECURITY_HEADERS });
    res.end(body);
  };
  const sendText = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
    res.end(message);
  };
  /** 断开一个流客户端；幂等，重复调用不会重复减计数。 */
  const dropClient = (client: StreamClient): void => {
    if (client.closed) return;
    client.closed = true;
    clients.delete(client);
    channel.setClients(clients.size);
  };
  const writeEvent = (client: StreamClient, event: ServerEvent): void => {
    if (client.closed) return;
    try { client.res.write(`data: ${JSON.stringify(event)}\n\n`); }
    catch { dropClient(client); }
  };
  /**
   * 增量下发的前提是首条目编号未变且条目数未减少；具体判定见 takeFreshItems，
   * 它同时负责把「版本变化的条目」重发出去——工具结束、确认卡定论都是原地更新，
   * 只按编号过滤会让界面永久停在「进行中」或「待确认」。
   */
  const flushClient = (client: StreamClient, state: ChatStateView): void => {
    const { full, fresh } = takeFreshItems(state.items, client);
    const { items: _ignored, ...scalars } = state;
    writeEvent(client, { type: 'state', full, items: fresh, state: scalars });
  };
  /** 一帧只取一次快照，避免每个客户端各读一次会话状态。 */
  const flush = (): void => {
    if (!clients.size) return;
    const state = session.snapshot();
    for (const client of clients) flushClient(client, state);
  };
  const schedule = (): void => {
    if (flushTimer || closing) return;
    flushTimer = setTimeout(() => { flushTimer = undefined; flush(); }, 40);
  };
  const unsubscribe = session.subscribe(schedule);

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > 64 * 1024) {
        // 不再继续读取剩余流，直接断开，避免为超大请求体分配内存。
        req.destroy();
        throw new AppError('INVALID_INPUT', '请求体过大。');
      }
      chunks.push(buffer);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new AppError('INVALID_INPUT', '请求体必须是 JSON。'); }
  };

  const dispatch = async (pathname: string, body: unknown): Promise<void> => {
    if (pathname === '/api/submit') {
      const payload = objectValue(body, '提交内容');
      await session.submit(textValue(payload.input, '输入', 8000));
      return;
    }
    if (pathname === '/api/cancel') { await session.cancel(); return; }
    if (pathname === '/api/confirm') {
      const payload = objectValue(body, '确认请求');
      session.resolveConfirmation(textValue(payload.id, '预览 ID', 80), booleanValue(payload.accepted, '确认结果'));
      return;
    }
    if (pathname === '/api/login-input') {
      const payload = objectValue(body, '登录凭据');
      const id = positiveIntValue(payload.id, '输入请求 ID');
      if (payload.cancelled === true) session.resolveLogin(id, undefined);
      else session.resolveLogin(id, {
        email: textValue(payload.email, '邮箱', 400),
        password: textValue(payload.password, '密码', 400),
      });
      return;
    }
    // 设置弹窗里的显式登录与登出：不经过会话输入，也不产生会话条目。
    if (pathname === '/api/login') {
      const payload = objectValue(body, '登录');
      await session.startLogin(textValue(payload.email, '邮箱', 400), textValue(payload.password, '密码', 400));
      return;
    }
    if (pathname === '/api/login-cancel') { session.cancelLogin(); return; }
    if (pathname === '/api/logout') { await session.logout(); return; }
    if (pathname === '/api/model') {
      const payload = objectValue(body, '模型选择');
      await session.setModel(textValue(payload.provider, '提供方', 200), textValue(payload.model, '模型', 200));
      return;
    }
    // 思考强度：级别由宿主按当前模型的可用列表校验，浏览器提交的字符串不作数。
    if (pathname === '/api/thinking') {
      const payload = objectValue(body, '思考强度');
      session.setThinkingLevel(textValue(payload.level, '思考强度', 20) as ThinkingLevelName);
      return;
    }
    if (pathname === '/api/session') {
      const payload = objectValue(body, '会话操作');
      const action = textValue(payload.action, '会话操作', 20);
      if (action === 'new') await session.newSession();
      else if (action === 'resume') await session.resumeSession(textValue(payload.path, '会话路径', 4096));
      else throw new AppError('INVALID_INPUT', '会话操作只能是 new 或 resume。');
      return;
    }
    if (pathname === '/api/credentials') {
      const payload = objectValue(body, '模型密钥');
      // 密钥只在本次运行内注入 Pi 的运行时凭据，不写文件；长度上限防止误贴大段文本。
      await session.setCredential(textValue(payload.provider, '提供方', 200), textValue(payload.key, 'API Key', 4000));
      return;
    }
    if (pathname === '/api/proxy') {
      const payload = objectValue(body, '网络线路');
      const mode = textValue(payload.mode, '线路模式', 10);
      if (mode !== 'auto' && mode !== 'direct' && mode !== 'manual') throw new AppError('INVALID_INPUT', '线路模式只能是 auto、direct 或 manual。');
      // manual 才需要地址；auto 会忽略它，direct 不用它。
      const url = mode === 'manual' ? textValue(payload.url, '代理地址', 300) : undefined;
      await session.setProxy(mode, url);
      return;
    }
    throw new AppError('INVALID_INPUT', '未知的 Web 终端命令。');
  };

  const stateView = (): ChatStateView => session.snapshot();

  const serveStatic = async (res: ServerResponse, pathname: string): Promise<void> => {
    let relative: string;
    try { relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); }
    catch { sendText(res, 400, '请求路径无效。'); return; }
    const target = resolve(assetsDir, normalize(relative));
    if (!target.startsWith(assetsDir + sep)) { sendText(res, 404, '未找到资源。'); return; }
    const type = MIME[extname(target).toLowerCase()];
    if (!type) { sendText(res, 404, '未找到资源。'); return; }
    let info;
    try { info = await stat(target); }
    catch { sendText(res, 404, '未找到静态资源；请先运行 npm run build:web。'); return; }
    if (!info.isFile()) { sendText(res, 404, '未找到资源。'); return; }
    res.writeHead(200, {
      'content-type': type, 'content-length': info.size, ...SECURITY_HEADERS,
      'cache-control': relative === 'index.html' ? 'no-store' : 'public, max-age=3600',
    });
    await new Promise<void>((finish, fail) => {
      const stream = createReadStream(target);
      stream.on('error', fail);
      stream.on('close', () => finish());
      stream.pipe(res);
    }).catch(() => { res.destroy(); });
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (!loopbackHost(req)) { sendText(res, 403, 'Web 终端只接受本机回环地址访问。'); return; }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const query = url.searchParams.get('token');
        if (query !== null) {
          if (!sameToken(query)) { sendText(res, 401, '访问令牌无效，请使用启动时打印的地址。'); return; }
          res.writeHead(302, { 'set-cookie': `bgm_web_token=${token}; HttpOnly; SameSite=Strict; Path=/`, location: '/', 'cache-control': 'no-store' });
          res.end();
          return;
        }
        if (!authorized(req)) { sendText(res, 401, '需要在启动时打印的地址上打开一次以取得访问凭据。'); return; }
        await serveStatic(res, url.pathname);
        return;
      }
      if (!authorized(req)) { sendJson(res, 401, { code: 'WEB_UNAUTHORIZED', message: '访问凭据无效，请重新打开启动时打印的地址。' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/state') { sendJson(res, 200, stateView()); return; }
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        sendJson(res, 200, await session.catalog());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
          'x-accel-buffering': 'no', ...SECURITY_HEADERS,
        });
        res.write(': connected\n\n');
        const client: StreamClient = { res, firstId: null, lastId: 0, count: 0, versions: new Map(), closed: false };
        clients.add(client);
        channel.setClients(clients.size);
        const cleanup = (): void => dropClient(client);
        req.on('close', cleanup);
        res.on('close', cleanup);
        // 新连接总是先拿一份完整快照。
        flushClient(client, session.snapshot());
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        try { await dispatch(url.pathname, await readBody(req)); }
        catch (error) { sendJson(res, 400, safeError(error)); return; }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') { await serveStatic(res, url.pathname); return; }
      sendText(res, 405, '不支持的请求方法。');
    })().catch(error => {
      const info = safeError(error);
      if (res.headersSent) { res.destroy(); return; }
      sendJson(res, 500, info);
    });
  });

  const listenOn = (candidate: number): Promise<void> => new Promise<void>((listen, fail) => {
    const onError = (error: unknown): void => { server.off('listening', onListening); fail(error); };
    const onListening = (): void => { server.off('error', onError); listen(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(candidate, '127.0.0.1');
  });

  // 端口被占用时顺延：默认端口常与其它本地服务冲突，实际监听端口以打印的地址为准。
  let boundPort = -1;
  let lastError: unknown;
  for (let offset = 0; offset < PORT_ATTEMPTS && options.port + offset <= 65535; offset++) {
    const candidate = options.port + offset;
    try { await listenOn(candidate); boundPort = candidate; break; }
    catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EADDRINUSE') break;
    }
  }
  if (boundPort < 0) {
    unsubscribe();
    const code = (lastError as NodeJS.ErrnoException | null)?.code;
    const reason = code === 'EADDRINUSE'
      ? `${options.port}～${Math.min(65535, options.port + PORT_ATTEMPTS - 1)} 都被占用`
      : lastError instanceof Error ? lastError.message : '未知错误';
    throw new AppError('WEB_START_FAILED', `无法在 127.0.0.1 上启动 Web 终端：${reason}；可用 --port 指定其它端口。`);
  }
  if (boundPort !== options.port) process.stdout.write(`端口 ${options.port} 已被占用，改用 ${boundPort}。\n`);

  // 心跳同时承担探活：写失败或连接已结束的客户端要立刻摘掉，否则
  // 「还有浏览器在等确认」会一直成立，写入便会挂在无人应答的等待上。
  heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.res.writableEnded || client.res.destroyed) { dropClient(client); continue; }
      try { client.res.write(': ping\n\n', error => { if (error) dropClient(client); }); }
      catch { dropClient(client); }
    }
  }, 15000);

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (heartbeat) clearInterval(heartbeat);
    if (flushTimer) clearTimeout(flushTimer);
    unsubscribe();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    for (const client of clients) { client.closed = true; try { client.res.end(); } catch { /* 已断开。 */ } }
    clients.clear();
    channel.setClients(0);
    // server.close() 只等已有连接结束；半开连接或卡住的请求会让它永不回调，
    // 因此给一个兜底：超时后强制关闭全部连接，进程仍能退出。
    await new Promise<void>(done => {
      const timer = setTimeout(() => { server.closeAllConnections(); done(); }, 3000);
      server.close(() => { clearTimeout(timer); done(); });
    });
    resolveClosed();
  };

  let forced = false;
  const onSignal = (): void => {
    if (forced) process.exit(130);
    forced = true;
    process.stdout.write('\n正在停止 Web 终端；再次按 Ctrl+C 立即退出。\n');
    void close();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const url = `http://127.0.0.1:${boundPort}/?token=${token}`;
  process.stdout.write(`Bangumi 助手 Web 终端：${url}\n`);
  process.stdout.write(`（该地址带一次性令牌，仅本机可访问；浏览器换取 Cookie 后地址栏会回到 http://127.0.0.1:${boundPort}/）\n`);
  if (options.open) {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(command, args, { stdio: 'ignore', detached: true }).unref(); }
    catch { process.stdout.write('未能自动打开浏览器；请手动打开上面的地址。\n'); }
  }
  return { url, port: boundPort, close, closed };
}
