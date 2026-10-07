import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, safeError } from '../support/errors.js';
import type { ChatStateView, MessageBlock, ServerEvent, StreamDeltaView, ThinkingLevelName, TranscriptItemView } from './protocol.js';
import type { WebSessionManager } from './session-manager.js';

export interface WebTerminalOptions {
  sessions: WebSessionManager;
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
  clientId: string;
  sessionId: string;
  summaries: string;
  /**
   * 上一帧下发给该客户端的流式正文与思考快照，用于算增量。
   *
   * `null` 表示还没有基线（新连接、刚换会话）：此时必须发全量 `state` 帧，否则增量
   * 没有可累加的起点。
   */
  liveContent: readonly MessageBlock[] | null;
  liveThinking: string | null;
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

/** 流式增量里与本模块有关的两项；`scalars` 由调用方补上。 */
type LiveDelta = Pick<StreamDeltaView, 'text' | 'thinking'>;

/**
 * 计算流式增量；**无法用增量安全表达时返回 `null`**，调用方改发 `state` 全量帧。
 *
 * 这个函数是「自愈」的那一半：只要判定有任何不确定，就退回全量帧，浏览器因此不需要
 * 增量回退逻辑。判定只用三条：
 *
 * 1. 必须有上一帧的基线（新连接、刚换会话时没有）；
 * 2. 思考文本必须是上一帧的**前缀**——否则说明它被清空或改写（换会话、打断恢复）；
 * 3. 正文块数组长度不变，且除最后一块外**引用相同**。引用比较可行是因为
 *    `blocksFromContent` 对未变的块做了结构共享（见 message-blocks.ts）：文本内容没变
 *    就复用上一帧的对象引用。最后一块要么引用相同（只有思考在变），要么是上一块文本的延长。
 *
 * 「块数变化」——新的内容块出现、流式结束清空、整体替换——一律回退全量帧：这些事件频率低，
 * 而全量帧是浏览器唯一的自愈通道。导出这个纯函数是为了能直接用脚本核对增量行为。
 */
export function takeLiveDelta(
  previous: { liveContent: readonly MessageBlock[] | null; liveThinking: string | null },
  liveContent: readonly MessageBlock[],
  liveThinking: string,
): LiveDelta | null {
  if (previous.liveContent === null || previous.liveThinking === null) return null;
  if (!liveThinking.startsWith(previous.liveThinking)) return null;
  if (liveContent.length !== previous.liveContent.length) return null;
  for (let index = 0; index < liveContent.length - 1; index += 1) {
    if (liveContent[index] !== previous.liveContent[index]) return null;
  }
  const thinking = liveThinking.slice(previous.liveThinking.length);
  const before = previous.liveContent.at(-1);
  const after = liveContent.at(-1);
  // 最后一块没换引用：只有思考在增长（正文块的首帧、结束清空都落在这里）。
  if (after === before) return { text: null, thinking };
  if (before === undefined || after === undefined) return null;
  if (before.type !== 'text' || after.type !== 'text') return null;
  if (!after.text.startsWith(before.text)) return null;
  const delta = after.text.slice(before.text.length);
  return delta === '' ? { text: null, thinking } : { text: { index: liveContent.length - 1, delta }, thinking };
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
  const { sessions } = options;
  const assetsDir = resolve(options.assetsDir ?? fileURLToPath(new URL('../../web/', import.meta.url)));
  const token = randomBytes(32).toString('hex');
  const instanceId = randomUUID();
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
    sessions.setClients(clients.size);
  };
  const writeEvent = (client: StreamClient, event: ServerEvent): void => {
    if (client.closed) return;
    try { client.res.write(`data: ${JSON.stringify(event)}\n\n`); }
    catch { dropClient(client); }
  };
  /**
   * 下发本帧：条目走 `state` 帧的 `items`，流式正文与思考走 `stream` 增量帧。
   *
   * 两条通道的分工：
   * - `state` 帧是**自愈通道**，携带完整快照。首帧、会话切换、条目新增或原地更新
   *   （工具结束、确认卡定论都是原地更新，只按编号过滤会让界面永久停在「进行中」）、
   *   以及任何算不出增量的情况都走它；
   * - `stream` 帧是**高频通道**，只带正文与思考的追加部分，省掉每帧重发全部文本的
   *   O(n²) 开销（诊断见 `artifacts/web-streaming-diagnosis-and-plan.md`）。
   *
   * 条目记账见 takeFreshItems，增量判定见 takeLiveDelta。
   */
  const flushClient = (client: StreamClient, state: ChatStateView): void => {
    if (client.sessionId !== state.sessionId) {
      client.firstId = null;
      client.sessionId = state.sessionId;
      // 换会话后旧的流式快照不再可比：增量以「接上一帧累加」为前提。
      client.liveContent = null;
      client.liveThinking = null;
    }
    const { full, fresh } = takeFreshItems(state.items, client);
    const { items: _ignored, liveContent, liveThinking, ...scalars } = state;
    // 条目有变化时必须走 `state` 帧——条目只挂在它上面；其余情况尽量发增量。
    const delta = full || fresh.length > 0 ? null : takeLiveDelta(client, liveContent, liveThinking);
    client.liveContent = liveContent;
    client.liveThinking = liveThinking;
    if (delta === null) {
      writeEvent(client, {
        type: 'state', instanceId, revision: sessions.revision, full, items: fresh,
        state: { ...scalars, liveContent, liveThinking },
      });
    } else {
      writeEvent(client, { type: 'stream', instanceId, revision: sessions.revision, delta: { ...delta, scalars } });
    }
    const summaries = sessions.sessions(client.clientId);
    const serialized = JSON.stringify(summaries);
    if (client.summaries !== serialized) {
      client.summaries = serialized;
      writeEvent(client, { type: 'sessions', sessions: summaries });
    }
  };
  /** 一帧只取一次快照，避免每个客户端各读一次会话状态。 */
  const flush = (): void => {
    if (!clients.size) return;
    const snapshots = new Map<string, ChatStateView>();
    for (const client of clients) {
      const session = sessions.selected(client.clientId);
      let state = snapshots.get(session.id);
      if (!state) { state = session.snapshot(); snapshots.set(session.id, state); }
      flushClient(client, state);
    }
  };
  /**
   * 合并窗口：约一帧（60Hz）的时长。
   *
   * 上游的 delta 是细粒度的（实测正文平均 1.6 字符/个、约 140 个/秒），所以窗口越长，
   * 每帧一次吐出的字越多——40ms 时实测每帧 10~127 字符。取 16ms 让每帧落在几个字符上，
   * 同时不给浏览器制造超过刷新率的帧。
   */
  const FLUSH_MS = 16;
  const schedule = (): void => {
    if (flushTimer || closing) return;
    flushTimer = setTimeout(() => { flushTimer = undefined; flush(); }, FLUSH_MS);
  };
  const unsubscribe = sessions.subscribe(schedule);

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

  const dispatch = async (pathname: string, body: unknown, req: IncomingMessage): Promise<ServerEvent | undefined> => {
    const clientId = textValue(req.headers['x-bgm-client'], '浏览器 ID', 80);
    if (pathname === '/api/session') {
      const payload = objectValue(body, '会话操作');
      const action = textValue(payload.action, '会话操作', 20);
      if (action !== 'new' && action !== 'resume') throw new AppError('INVALID_INPUT', '会话操作只能是 new 或 resume。');
      await sessions.select(clientId, action, {
        ...(payload.sessionId === undefined ? {} : { id: textValue(payload.sessionId, '会话 ID', 80) }),
        ...(payload.path === undefined ? {} : { path: textValue(payload.path, '会话路径', 4096) }),
      });
      const { items, ...state } = sessions.selected(clientId).snapshot();
      return { type: 'state', instanceId, revision: sessions.revision, full: true, items, state };
    }
    // 请求归属以发出时的会话 ID 为准，不能在 await 后改用当前查看的会话。
    const session = sessions.get(textValue(req.headers['x-bgm-session'], '会话 ID', 80));
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
      await sessions.refreshLogin();
      return;
    }
    if (pathname === '/api/login-cancel') { session.cancelLogin(); return; }
    if (pathname === '/api/logout') { await session.logout(); await sessions.refreshLogin(); return; }
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
    if (pathname === '/api/credentials') {
      const payload = objectValue(body, '模型密钥');
      // 默认只注入本次运行的运行时凭据；persist 为 true 才写入本机 Pi 凭据存储。
      // 长度上限防止误贴大段文本。
      const persist = payload.persist === undefined ? false : booleanValue(payload.persist, '保存到本机');
      await session.setCredential(textValue(payload.provider, '提供方', 200), textValue(payload.key, 'API Key', 4000), persist);
      sessions.notifySettingsChange();
      return;
    }
    if (pathname === '/api/credentials/clear') {
      const payload = objectValue(body, '清除模型密钥');
      await session.clearCredential(textValue(payload.provider, '提供方', 200));
      sessions.notifySettingsChange();
      return;
    }
    if (pathname === '/api/proxy') {
      const payload = objectValue(body, '网络线路');
      const mode = textValue(payload.mode, '线路模式', 10);
      if (mode !== 'auto' && mode !== 'direct' && mode !== 'manual') throw new AppError('INVALID_INPUT', '线路模式只能是 auto、direct 或 manual。');
      // manual 才需要地址；auto 会忽略它，direct 不用它。
      const url = mode === 'manual' ? textValue(payload.url, '代理地址', 300) : undefined;
      await session.setProxy(mode, url);
      sessions.notifySettingsChange();
      return;
    }
    throw new AppError('INVALID_INPUT', '未知的 Web 终端命令。');
  };

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
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const id = req.headers['x-bgm-session'];
        const session = id === undefined ? sessions.selected(textValue(req.headers['x-bgm-client'], '浏览器 ID', 80))
          : sessions.get(textValue(id, '会话 ID', 80));
        sendJson(res, 200, session.snapshot()); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        const id = req.headers['x-bgm-session'];
        sendJson(res, 200, await sessions.catalog(textValue(req.headers['x-bgm-client'], '浏览器 ID', 80),
          id ? textValue(id, '会话 ID', 80) : undefined));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const clientId = textValue(url.searchParams.get('clientId'), '浏览器 ID', 80);
        // EventSource 断线重连时可恢复本标签页的选择，恢复失败则使用初始会话。
        const selectedId = url.searchParams.get('sessionId');
        if (selectedId && !sessions.hasView(clientId)) {
          try { await sessions.select(clientId, 'resume', { id: selectedId }); } catch { /* 会话已失效。 */ }
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
          'x-accel-buffering': 'no', ...SECURITY_HEADERS,
        });
        res.write(': connected\n\n');
        const client: StreamClient = { res, firstId: null, lastId: 0, count: 0, versions: new Map(), closed: false,
          clientId, sessionId: '', summaries: '', liveContent: null, liveThinking: null };
        clients.add(client);
        sessions.setClients(clients.size);
        const cleanup = (): void => dropClient(client);
        req.on('close', cleanup);
        res.on('close', cleanup);
        // 新连接总是先拿一份完整快照。
        flushClient(client, sessions.selected(clientId).snapshot());
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        let result: ServerEvent | undefined;
        try { result = await dispatch(url.pathname, await readBody(req), req); }
        catch (error) { sendJson(res, 400, safeError(error)); return; }
        sendJson(res, 200, result ?? { ok: true });
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
    sessions.setClients(0);
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
