import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { AppError } from '../../domain/errors.js';
import { object, positiveId } from '../../domain/bangumi.js';
import { policyFor, type ProxyOptions } from '../../config/proxy.js';
import { TOOL_DEFINITIONS, validateToolArguments, remoteInputError } from './catalog.js';
import { preparedBaseline, type PreparedBaseline } from './prepared.js';

export interface McpWriteGuard { accountId: number; subjectId?: number; expectedStatus?: number; prepared?: PreparedBaseline }
export interface McpCallClient {
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal, guard?: McpWriteGuard): Promise<unknown>;
  close(): Promise<void>;
}
const SAFE_ENVIRONMENT = ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PROCESSOR_ARCHITECTURE', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE', 'PROGRAMFILES', 'HOME', 'LANG', 'LC_ALL'];
// 只使用本地固定提示，不转发服务端任意正文，也不在传输层猜测是否已经提交。
const TOOL_ERROR_MESSAGES: Record<string, string> = {
  INCOMPLETE_COLLECTION: '目标条目的个人收藏快照不完整，无法核实状态或保留原值。',
  INVALID_RESPONSE: 'Bangumi 返回的数据结构或对象不符合预期。',
  BGM_AUTH_REQUIRED: '请先运行 login 或在 chat 中使用 /login。',
  BGM_AUTH_EXPIRED: '当前登录已失效，请重新 /login。',
  BGM_HTTP_401: '网站拒绝了当前登录，请重新 /login。',
  ACCOUNT_CHANGED: '当前账户与请求绑定的账户不一致，操作已停止。',
};
function childEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAFE_ENVIRONMENT) {
    const value = source[key] ?? source[Object.keys(source).find(name => name.toUpperCase() === key) ?? ''];
    if (value !== undefined && !value.startsWith('()')) result[key] = value;
  }
  return result;
}
function guarded(value: McpWriteGuard): McpWriteGuard {
  const accountId = positiveId(value.accountId);
  if (value.expectedStatus !== undefined && (!Number.isInteger(value.expectedStatus) || ![0, 1, 2, 3].includes(value.expectedStatus))) throw new AppError('INVALID_INPUT', '章节保护状态无效。');
  return { accountId, ...(value.subjectId === undefined ? {} : { subjectId: positiveId(value.subjectId) }), ...(value.expectedStatus === undefined ? {} : { expectedStatus: value.expectedStatus }), ...(value.prepared === undefined ? {} : { prepared: preparedBaseline(value.prepared) }) };
}
function interrupted(signal?: AbortSignal): void { if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消。'); }
async function awaitWithCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  interrupted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new AppError('CANCELLED', '操作已取消。'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 一次连接、长期复用；任何请求均不自动重连或重发，取消只发送 MCP 单次请求取消。 */
export class LocalMcpClient implements McpCallClient {
  private readonly client = new Client({ name: 'MyBangumiAssistant', version: '0.1.0' }, { capabilities: {} });
  private readonly transport: StdioClientTransport;
  private initialization: Promise<void> | undefined;
  private closed = false;
  private broken = false;
  constructor(private readonly options: { authDir: string; proxy: ProxyOptions; timeoutMs: number; entry?: string; env?: NodeJS.ProcessEnv }) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 300000) throw new AppError('INVALID_INPUT', 'MCP 超时须为1000～300000毫秒。');
    const entry = options.entry ?? fileURLToPath(new URL('./server.js', import.meta.url));
    if (!isAbsolute(entry) || !isAbsolute(options.authDir)) throw new AppError('INVALID_INPUT', 'MCP 服务及认证目录须使用绝对路径。');
    const env = childEnvironment(options.env ?? process.env);
    env.BANGUMI_AUTH_DIRECTORY = options.authDir;
    env.BANGUMI_PROXY_POLICY = JSON.stringify(policyFor(options.proxy));
    env.BANGUMI_REQUEST_TIMEOUT_MS = String(options.timeoutMs);
    // SDK 自身仅继承平台白名单；shell:false 且 Windows 使用 windowsHide。
    this.transport = new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: 'pipe', maxBufferSize: 2_000_000 });
    let stderrBytes = 0;
    this.transport.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > 100_000) { this.broken = true; void this.transport.close(); }
    });
    this.client.onclose = () => { this.broken = true; };
    this.client.onerror = () => { this.broken = true; };
  }
  private usable(): void {
    if (this.closed || this.broken) throw new AppError('MCP_CONNECTION_CLOSED', '本地 MCP 连接已关闭，请重新启动本助手；未自动重发任何操作。');
  }
  private ready(): Promise<void> {
    this.usable();
    this.initialization ??= this.initialize();
    return this.initialization;
  }
  private async initialize(): Promise<void> {
    try {
      await this.client.connect(this.transport, { timeout: this.options.timeoutMs });
      this.usable();
      const expected = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
      const seen = new Set<string>(); const cursors = new Set<string>(); let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await this.client.listTools(cursor === undefined ? {} : { cursor }, { timeout: this.options.timeoutMs });
        for (const tool of result.tools) {
          const definition = expected.get(tool.name);
          if (!definition || seen.has(tool.name) || !isDeepStrictEqual(tool.inputSchema, definition.inputSchema)) throw new AppError('MCP_CATALOG_MISMATCH', '本地 MCP 工具目录与锁定的55项定义不一致。');
          seen.add(tool.name);
        }
        if (!result.nextCursor) {
          if (seen.size !== 55 || expected.size !== 55) throw new AppError('MCP_CATALOG_MISMATCH', '本地 MCP 未完整返回锁定的55项工具。');
          return;
        }
        if (!result.tools.length || cursors.has(result.nextCursor)) throw new AppError('MCP_CATALOG_MISMATCH', 'MCP 工具分页未继续推进。');
        cursors.add(result.nextCursor); cursor = result.nextCursor;
      }
      throw new AppError('MCP_CATALOG_MISMATCH', 'MCP 工具分页超过上限。');
    } catch (error) {
      this.broken = true; await this.transport.close();
      if (error instanceof AppError) throw error;
      throw new AppError('MCP_START_FAILED', '本地 MCP 初始化失败，请核对安装和构建；未回显子进程原始错误。');
    }
  }
  async listTools(signal?: AbortSignal) {
    interrupted(signal);
    await awaitWithCancellation(this.ready(), signal); interrupted(signal); this.usable();
    // 权限及参数以本地固定目录为准，不采信服务端 annotations 或描述。
    return TOOL_DEFINITIONS.map(tool => structuredClone(tool));
  }
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal, guard?: McpWriteGuard): Promise<unknown> {
    interrupted(signal);
    const parameters = validateToolArguments(name, args);
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === name)!;
    if (definition.effect === 'write' && !guard) throw new AppError('AUTHORIZATION_REQUIRED', 'MCP 写入必须由宿主授权链路提交。');
    const metadata = guard === undefined ? undefined : guarded(guard);
    await awaitWithCancellation(this.ready(), signal); interrupted(signal); this.usable();
    let raw: unknown;
    try {
      raw = await this.client.callTool({ name, arguments: parameters, ...(metadata ? { _meta: { 'bangumi/guard': metadata } } : {}) }, undefined,
        { timeout: this.options.timeoutMs, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消；已提交写入须独立核实结果。');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === -32001) throw new AppError('BGM_TIMEOUT', 'MCP 请求超时；已提交写入须独立核实结果。');
      throw new AppError(this.broken ? 'MCP_TRANSPORT_ERROR' : 'MCP_PROTOCOL_ERROR', '本地 MCP 请求失败；未自动重连或重发，已提交写入须独立核实结果。');
    }
    const result = object(raw);
    if (!result.structuredContent || typeof result.structuredContent !== 'object' || Array.isArray(result.structuredContent)) throw new AppError('MCP_INVALID_RESULT', 'MCP 未返回结构化结果，不能解析展示文本。');
    const structured = object(result.structuredContent, 'MCP结构化结果');
    if (result.isError === true) {
      const remote = object(structured.error, 'MCP错误');
      const code = typeof remote.code === 'string' && /^[A-Z][A-Z_0-9]{0,79}$/.test(remote.code) ? remote.code : 'MCP_TOOL_ERROR';
      if (code === 'INVALID_INPUT' && definition.effect === 'read' && remote.networkAttempted === false) {
        const feedback = remoteInputError(name, parameters, remote.issues);
        if (feedback) throw feedback;
      }
      throw new AppError(code, TOOL_ERROR_MESSAGES[code] ?? 'Bangumi MCP 操作未完成，请核对输入及网站状态。');
    }
    if (!Object.hasOwn(structured, 'value')) throw new AppError('MCP_INVALID_RESULT', 'MCP 返回缺少结构化 value，不能将展示文本作为业务结果。');
    if (Buffer.byteLength(JSON.stringify(structured)) > 2_000_000) throw new AppError('MCP_OUTPUT_LIMIT', 'MCP 查询结果过大，请缩小范围。');
    return structured.value;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // SDK stdio 关闭有界：stdin结束、2秒后TERM、再2秒后KILL。
    await this.client.close();
  }
}
