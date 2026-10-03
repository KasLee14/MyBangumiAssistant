import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { decodeProxyPolicy } from '../support/proxy.js';
import { object, positiveId } from '../support/bangumi.js';
import { AppError, safeError } from '../support/errors.js';
import { TOOL_DEFINITIONS, validateToolArguments } from './catalog.js';
import { BangumiMcpService } from './service.js';
import { createMcpTransport } from './transport.js';
import type { McpWriteGuard } from './client.js';
import { preparedBaseline } from './prepared.js';

function writeGuard(value: unknown): McpWriteGuard {
  if (value === undefined) throw new AppError('AUTHORIZATION_REQUIRED', 'MCP 写入必须由宿主授权链路提交。');
  const raw = object(value, '写入保护');
  if (Object.keys(raw).some(key => !['accountId', 'subjectId', 'expectedStatus', 'prepared'].includes(key))) throw new AppError('INVALID_INPUT', '写入保护元数据无效。');
  if (raw.expectedStatus !== undefined && (typeof raw.expectedStatus !== 'number' || ![0, 1, 2, 3].includes(raw.expectedStatus))) throw new AppError('INVALID_INPUT', '章节保护状态无效。');
  return { accountId: positiveId(raw.accountId), ...(raw.subjectId === undefined ? {} : { subjectId: positiveId(raw.subjectId) }),
    ...(raw.expectedStatus === undefined ? {} : { expectedStatus: raw.expectedStatus as number }), ...(raw.prepared === undefined ? {} : { prepared: preparedBaseline(raw.prepared) }) };
}
/** 单机固定目录服务；stdout 只输出 MCP JSON-RPC，不接受模型提供的URL或执行命令。 */
export function createBangumiMcpServer(service: BangumiMcpService): Server {
  const server = new Server({ name: 'MyBangumiAssistant-Bangumi', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async request => {
    const raw = request.params?.cursor;
    const offset = raw === undefined ? 0 : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= TOOL_DEFINITIONS.length && offset !== 0 || offset % 20 !== 0) throw new AppError('INVALID_INPUT', '工具分页游标无效。');
    const tools = TOOL_DEFINITIONS.slice(offset, offset + 20).map(tool => ({ name: tool.name, description: tool.description, inputSchema: structuredClone(tool.inputSchema),
      ...(tool.outputSchema ? { outputSchema: structuredClone(tool.outputSchema) } : {}) }));
    return { tools, ...(offset + tools.length < TOOL_DEFINITIONS.length ? { nextCursor: String(offset + tools.length) } : {}) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const name = request.params.name;
      const args = validateToolArguments(name, request.params.arguments ?? {});
      const definition = TOOL_DEFINITIONS.find(tool => tool.name === name)!;
      const guard = definition.effect === 'write' ? writeGuard(request.params._meta?.['bangumi/guard']) : undefined;
      const value = await service.call(name, args, extra.signal, guard);
      const structuredContent = { value: value === undefined ? null : value };
      if (Buffer.byteLength(JSON.stringify(structuredContent)) > 1_900_000) throw new AppError('MCP_OUTPUT_LIMIT', '结果过大，请缩小查询范围。');
      return { content: [], structuredContent };
    } catch (error) {
      return { isError: true, content: [], structuredContent: { error: safeError(error) } };
    }
  });
  return server;
}

async function main(): Promise<void> {
  const authDir = process.env.BANGUMI_AUTH_DIRECTORY;
  if (!authDir || !isAbsolute(authDir)) throw new AppError('INVALID_INPUT', 'MCP 认证目录必须显式指定为绝对路径。');
  const timeoutMs = Number(process.env.BANGUMI_REQUEST_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000 || !process.env.BANGUMI_PROXY_POLICY) throw new AppError('INVALID_INPUT', 'MCP 请求配置缺失或无效。');
  const service = new BangumiMcpService(createMcpTransport({ authDir, proxy: decodeProxyPolicy(process.env.BANGUMI_PROXY_POLICY), timeoutMs }));
  const server = createBangumiMcpServer(service);
  const transport = new StdioServerTransport();
  let stopping = false;
  const close = async () => {
    if (stopping) return; stopping = true;
    const timer = setTimeout(() => process.exit(0), 1500); timer.unref();
    try { await service.close(); await server.close(); } finally { clearTimeout(timer); }
  };
  server.onclose = () => { void close(); };
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  await server.connect(transport);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('MCP_START_FAILED: 本地 Bangumi MCP 服务无法启动。\n'); process.exitCode = 1; });
}
