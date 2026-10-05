import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { AppError, SubmissionError, isSubmissionRejection, isContractIssue, contractIssueMessage, type SubmissionReceipt } from '../support/errors.js';
import { object, positiveId } from '../support/bangumi.js';
import { policyFor, type ProxyOptions } from '../support/proxy.js';
import { TOOL_DEFINITIONS, validateToolArguments, remoteInputError } from './catalog.js';
import { preparedBaseline, type PreparedBaseline } from './prepared.js';
import { checkOutput, checkSubjectResponse } from './subject-output.js';
import { checkResourceResponse } from './resource-output.js';
import { resourceOutputSchema } from './resource-schemas.js';
import { isCommunityTool } from './community-schemas.js';
import { checkCommunityResponse } from './community-output.js';
import { checkAccessResponse, type AccessContext } from './access-context.js';
import { batchPreparation, batchScope, type BatchPreparation, type McpBatchScope } from './batch-context.js';
import { checkSubmission } from './submission.js';
import { readContext, type McpReadContext } from './read-context.js';
import { checkReadDiagnosis, diagnoseReadError, executeReadRecovery, clearReadRecoveryScope } from './read-recovery.js';

export interface McpWriteGuard { accountId: number; subjectId?: number; expectedStatus?: number; prepared?: PreparedBaseline; batchPreparation?: BatchPreparation }
export interface McpCallClient {
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope, read?: McpReadContext): Promise<unknown>;
  endReadContext?(turnId: string): Promise<void>;
  close(): Promise<void>;
}
const SAFE_ENVIRONMENT = ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PROCESSOR_ARCHITECTURE', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE', 'PROGRAMFILES', 'HOME', 'LANG', 'LC_ALL'];
// 只使用本地固定提示，不转发服务端任意正文，也不在传输层猜测是否已经提交。
const TOOL_ERROR_MESSAGES: Record<string, string> = {
  INCOMPLETE_COLLECTION: '目标条目的个人收藏快照不完整，无法核实状态或保留原值。',
  INVALID_RESPONSE: 'Bangumi 返回的数据结构或对象不符合预期。',
  MCP_INVALID_RESULT: '本地 MCP 返回不符合固定输出契约，请检查字段适配；不能将其解释为网站资源不存在。',
  BATCH_SCOPE_INVALID: '批量执行范围无效或与本次计划不一致，操作已停止。',
  BATCH_SCOPE_ACTIVE: '当前账户已有批量任务正在执行，请等待该任务结束。',
  BATCH_CONTEXT_EXPIRED: '本批账户上下文已失效，操作已停止；请先核实既有结果。',
  BGM_AUTH_REQUIRED: '请先运行 login 或在 chat 中使用 /login。',
  BGM_AUTH_EXPIRED: '当前登录已失效，请重新 /login。',
  BGM_TIMEOUT: 'Bangumi 请求超时，未取得完整结果；已提交写入须独立核实。',
  BGM_NETWORK: 'Bangumi 网络请求未完成，未取得完整结果；已提交写入须独立核实。',
  BGM_OUTPUT_LIMIT: 'Bangumi 响应超过读取上限，请缩小范围。',
  BGM_RATE_LIMIT_REJECTED: '上游在修改前明确拒绝了本次请求；请等待额度后按核实后的范围重新计划。',
  CANCELLED: '操作已取消；已提交写入须独立核实结果。',
  MCP_CLOSED: '本地读取连接已关闭，请重新发起查询。',
  NSFW_SCOPE_CHANGED: '读取期间 NSFW 权限改变，请重新查询。',
  NSFW_SCOPE_MISMATCH: '源数据超出当前账户的 NSFW 权限，未返回不一致结果。',
  NSFW_PERMISSION_UNKNOWN: '未能核实账户 NSFW 权限，不能确认完整可见范围。',
  SEARCH_CAPABILITY_UNSUPPORTED: '当前账户数据源不支持此筛选与可见范围的组合，请调整条件或范围。',
  BGM_HTTP_401: '网站拒绝了当前登录，请重新 /login。',
  ACCOUNT_CHANGED: '当前账户与请求绑定的账户不一致，操作已停止。',
  CONTENT_REF_INVALID: '社区正文或分页引用无效，请重新读取对应来源。',
  CONTENT_REF_EXPIRED: '社区正文或分页快照已过期，请重新读取对应来源，不能拼接新旧版本。',
  CONTENT_RANGE_INVALID: '正文偏移超过内容长度，请使用来源返回的nextOffset。',
  COMMUNITY_CACHE_LIMIT: '社区来源超过有界快照缓存，请缩小读取范围。',
  CONTEXT_LIMIT: '单次社区输出超过20000字符，请缩小limit或include范围。',
  FIELD_LIMIT: '返回字段超过固定上限，请缩小详情或分页范围。',
  INCOMPLETE_DATA: '来源分页、资源归属或完整性不一致，不能将其解释为空结果。',
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
  return { accountId, ...(value.subjectId === undefined ? {} : { subjectId: positiveId(value.subjectId) }), ...(value.expectedStatus === undefined ? {} : { expectedStatus: value.expectedStatus }), ...(value.prepared === undefined ? {} : { prepared: preparedBaseline(value.prepared) }), ...(value.batchPreparation === undefined ? {} : { batchPreparation: batchPreparation(value.batchPreparation) }) };
}
function interrupted(signal?: AbortSignal): void { if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消。'); }
async function awaitWithCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  interrupted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new AppError('CANCELLED', '操作已取消。'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => signal.aborted ? abort() : resolve(value), reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 一次连接、长期复用；任何请求均不自动重连或重发，取消只发送 MCP 单次请求取消。 */
export class LocalMcpClient implements McpCallClient {
  private readonly client = new Client({ name: 'MyBangumiAssistant', version: '0.1.0' }, { capabilities: {} });
  private readonly transport: StdioClientTransport;
  private initialization: Promise<void> | undefined;
  private closed = false;
  private broken = false;
  constructor(private readonly options: { authDir: string; proxy: ProxyOptions; timeoutMs: number; entry?: string; env?: NodeJS.ProcessEnv;
    onTrace?: (event: 'initializing' | 'initialized' | 'dispatch') => void }) {
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
  private diagnostic(event: 'initializing' | 'initialized' | 'dispatch'): void {
    try { this.options.onTrace?.(event); } catch { /* 日志不能改变 MCP 提交或触发重试。 */ }
  }
  private ready(): Promise<void> {
    this.usable();
    this.initialization ??= this.initialize();
    return this.initialization;
  }
  private async initialize(): Promise<void> {
    this.diagnostic('initializing');
    try {
      await this.client.connect(this.transport, { timeout: this.options.timeoutMs });
      this.usable();
      const expected = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
      const seen = new Set<string>(); const cursors = new Set<string>(); let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await this.client.listTools(cursor === undefined ? {} : { cursor }, { timeout: this.options.timeoutMs });
        for (const tool of result.tools) {
          const definition = expected.get(tool.name);
          if (!definition || seen.has(tool.name) || !isDeepStrictEqual(tool.inputSchema, definition.inputSchema)
            || !isDeepStrictEqual(tool.outputSchema, definition.outputSchema)) throw new AppError('MCP_CATALOG_MISMATCH', '本地 MCP 工具输入/输出目录与锁定定义不一致。');
          seen.add(tool.name);
        }
        if (!result.nextCursor) {
          if (seen.size !== TOOL_DEFINITIONS.length || expected.size !== TOOL_DEFINITIONS.length) throw new AppError('MCP_CATALOG_MISMATCH', '本地 MCP 未完整返回锁定的工具目录。');
          this.diagnostic('initialized');
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
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope, read?: McpReadContext): Promise<unknown> {
    // 客户端只记失败指纹（包括MCP总期限耗尽），不承担HTTP重试。
    // 独立命名空间避免嵌入式客户端/服务同进程测试混用任务记录。
    if (TOOL_DEFINITIONS.find(tool => tool.name === name)?.effect === 'read' && read !== undefined) {
      const context = readContext(read);
      const parameters = validateToolArguments(name, args);
      return executeReadRecovery(name, parameters, () => this.callOnce(name, parameters, signal, guard, batch, context),
        { turnId: `client:${context.turnId}`, ...(signal ? { signal } : {}), maxRetries: 0 });
    }
    return this.callOnce(name, args, signal, guard, batch, read);
  }
  private async callOnce(name: string, args: Record<string, unknown>, signal?: AbortSignal, guard?: McpWriteGuard, batch?: McpBatchScope, read?: McpReadContext): Promise<unknown> {
    interrupted(signal);
    const parameters = validateToolArguments(name, args);
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === name)!;
    if (definition.effect === 'write' && !guard) throw new AppError('AUTHORIZATION_REQUIRED', 'MCP 写入必须由宿主授权链路提交。');
    const metadata = guard === undefined ? undefined : guarded(guard);
    const scope = batch === undefined ? undefined : batchScope(batch);
    const reading = definition.effect === 'read' && read !== undefined ? readContext(read) : undefined;
    await awaitWithCancellation(this.ready(), signal); interrupted(signal); this.usable();
    let raw: unknown;
    try {
      this.diagnostic('dispatch');
      raw = await this.client.callTool({ name, arguments: parameters, ...(metadata || scope || reading ? { _meta: { ...(metadata ? { 'bangumi/guard': metadata } : {}), ...(scope ? { 'bangumi/batch': scope } : {}), ...(reading ? { 'bangumi/readContext': reading } : {}) } } : {}) }, undefined,
        // read允许两次HTTP预算及有界退避；多请求operation仍受此MCP总期限与取消约束。
        // write保持原等待期限，超时只报告提交未知，绝不自动重发。
        { timeout: definition.effect === 'read' ? 2 * this.options.timeoutMs + 1000 : this.options.timeoutMs,
          ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消；已提交写入须独立核实结果。');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === -32001) {
        const timeout = new AppError('BGM_TIMEOUT', 'MCP 请求超时；已提交写入须独立核实结果。');
        if (definition.effect === 'read') {
          diagnoseReadError(name, parameters, timeout);
          Object.defineProperty(timeout, 'diagnosis', { value: { ...timeout.diagnosis!, retryable: false }, configurable: true });
        }
        throw timeout;
      }
      if (typeof error === 'object' && error !== null && 'code' in error && [-32600, -32602].includes(Number(error.code))) throw new AppError('MCP_INVALID_RESULT', 'MCP返回缺失或不符合固定输出契约。');
      throw new AppError(this.broken ? 'MCP_TRANSPORT_ERROR' : 'MCP_PROTOCOL_ERROR', '本地 MCP 请求失败；未自动重连或重发，已提交写入须独立核实结果。');
    }
    const result = object(raw);
    if (!result.structuredContent || typeof result.structuredContent !== 'object' || Array.isArray(result.structuredContent)) throw new AppError('MCP_INVALID_RESULT', 'MCP 未返回结构化结果，不能解析展示文本。');
    const structured = object(result.structuredContent, 'MCP结构化结果');
    if (Buffer.byteLength(JSON.stringify(structured)) > 2_000_000) throw new AppError('MCP_OUTPUT_LIMIT', 'MCP 查询结果过大，请缩小范围。');
    if (definition.outputSchema) checkOutput(definition.outputSchema, structured);
    if (definition.outputSchema && (result.isError === true) !== Object.hasOwn(structured, 'error')) throw new AppError('MCP_INVALID_RESULT', 'MCP成功或错误标记与输出结构不一致。');
    if (result.isError === true) {
      const remote = object(structured.error, 'MCP错误');
      const code = typeof remote.code === 'string' && /^[A-Z][A-Z_0-9]{0,79}$/.test(remote.code) ? remote.code : 'MCP_TOOL_ERROR';
      if (remote.contractIssue !== undefined && (name !== 'browse_subjects' || code !== 'MCP_INVALID_RESULT' || !isContractIssue(remote.contractIssue)))
        throw new AppError('MCP_INVALID_RESULT', 'MCP契约诊断与工具、错误码或字段不一致。');
      if (remote.sourceTool !== undefined && remote.sourceTool !== name || remote.recovery !== undefined && code !== 'MCP_INVALID_RESULT') throw new AppError('MCP_INVALID_RESULT', 'MCP错误来源或恢复分类与本次工具不一致。');
      if (remote.rejection !== undefined && (definition.effect !== 'write' || code !== 'BGM_RATE_LIMIT_REJECTED' || !isSubmissionRejection(remote.rejection)
        || remote.networkAttempted === false)) throw new AppError('MCP_INVALID_RESULT', 'MCP明确拒绝与原写入工具、固定错误码或派发事实不一致。');
      if (code === 'INVALID_INPUT' && definition.effect === 'read' && remote.networkAttempted === false) {
        const feedback = remoteInputError(name, parameters, remote.issues);
        if (feedback) {
          if (remote.diagnosis !== undefined) checkReadDiagnosis(name, parameters, feedback, remote.diagnosis);
          throw diagnoseReadError(name, parameters, feedback);
        }
      }
      const message = isContractIssue(remote.contractIssue) ? contractIssueMessage(remote.contractIssue)
        : code === 'BGM_HTTP_404' ? '当前可见范围内未取得资源，可能受NSFW或权限限制；不能据此认定条目不存在。' : TOOL_ERROR_MESSAGES[code] ?? 'Bangumi MCP 操作未完成，请核对输入及网站状态。';
      if (definition.effect === 'write' && remote.submission !== undefined) {
        checkSubmission(name, remote.submission, parameters, guard!.accountId, guard?.subjectId, guard?.prepared);
        const error = new SubmissionError(code, message, remote.submission as SubmissionReceipt);
        if (error.rejection !== undefined && (code !== 'BGM_RATE_LIMIT_REJECTED' || remote.networkAttempted === false)
          || remote.rejection !== undefined && !isDeepStrictEqual(remote.rejection, error.rejection)) throw new AppError('MCP_INVALID_RESULT', 'MCP拒绝证据与逐项回执不一致。');
        if (remote.accessContext) Object.defineProperty(error, 'accessContext', { value: structuredClone(remote.accessContext) });
        if (remote.networkAttempted === false) Object.defineProperty(error, 'networkAttempted', { value: false });
        Object.defineProperty(error, 'sourceTool', { value: name });
        throw error;
      }
      const error = new AppError(code, message, remote.accessContext === undefined ? undefined : structuredClone(remote.accessContext) as AccessContext);
      if (remote.contractIssue !== undefined) Object.defineProperty(error, 'contractIssue', { value: structuredClone(remote.contractIssue) });
      if (remote.diagnosis !== undefined) checkReadDiagnosis(name, parameters, error, remote.diagnosis);
      if (remote.networkAttempted === false) Object.defineProperty(error, 'networkAttempted', { value: false });
      if (remote.recovery !== undefined) Object.defineProperty(error, 'recovery', { value: structuredClone(remote.recovery) });
      if (remote.rejection !== undefined) Object.defineProperty(error, 'rejection', { value: structuredClone(remote.rejection) });
      Object.defineProperty(error, 'sourceTool', { value: name }); throw error;
    }
    if (!Object.hasOwn(structured, 'value')) throw new AppError('MCP_INVALID_RESULT', 'MCP 返回缺少结构化 value，不能将展示文本作为业务结果。');
    checkAccessResponse(name, structured.value);
    checkSubjectResponse(name, structured.value, parameters);
    if (isCommunityTool(name)) checkCommunityResponse(name, structured.value, parameters);
    if (definition.effect === 'write') checkSubmission(name, structured.value, parameters, guard!.accountId, guard?.subjectId, guard?.prepared);
    else if (resourceOutputSchema(name)) checkResourceResponse(name, structured.value, parameters, definition.outputSchema!);
    return structured.value;
  }
  async endReadContext(turnId: string): Promise<void> {
    const context = readContext({ turnId });
    clearReadRecoveryScope(`client:${context.turnId}`);
    clearReadRecoveryScope(context.turnId);
    if (!this.initialization || this.closed || this.broken) return;
    try {
      await this.initialization;
      if (!this.closed && !this.broken) await this.client.notification({ method: 'bangumi/readContextEnded', params: { turnId: context.turnId } });
    } catch { /* 结束通知不初始化、不重连，也不改变已派发业务的结果。 */ }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // SDK stdio 关闭有界：stdin结束、2秒后TERM、再2秒后KILL。
    await this.client.close();
  }
}
