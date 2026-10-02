import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatCompletionsModel, sseData } from '../../src/adapters/llm/chat-completions.js';
import { ReadAgent } from '../../src/core/agent.js';
import { SessionLog } from '../../src/storage/session.js';
import type { LanguageModel, Message, ToolRegistry } from '../../src/core/types.js';

async function local(server: Server): Promise<string> {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> { server.closeAllConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
const signal = (): AbortSignal => new AbortController().signal;

test('宿主边界元数据不作为模型协议字段发送', async t => {
  let request: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    request = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const baseUrl = await local(server); t.after(() => close(server));
  const model = new ChatCompletionsModel({ baseUrl, model: 'test', apiKeyEnv: 'TEST_API_KEY', thinking: 'disabled' }, 2000, null, { TEST_API_KEY: 'fake-secret' });
  t.after(() => model.close());
  await model.complete([{ role: 'assistant', content: '宿主已拒绝', boundary: { code: 'OUT_OF_SCOPE', modelInput: null } }], [], { signal: signal() });
  assert.deepEqual(request.messages, [{ role: 'assistant', content: '宿主已拒绝' }]);
});

test('SSE 支持跨块 UTF-8、CRLF、多行数据和结束事件', async () => {
  const bytes = new TextEncoder().encode('data: 中文\r\n\r\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const result: string[] = []; for await (const item of sseData(stream)) result.push(item);
  assert.deepEqual(result, ['中文','line1\nline2','[DONE]']);
});

test('模型流式合并工具参数并保留思考回传；未完整结束不执行工具', async t => {
  let request: Record<string, unknown> = {};
  const server = createServer(async (req,res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    request = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunks = [
      { delta: { reasoning_content: '测试推理', tool_calls: [{ index: 0, id: 'call1', type: 'function', function: { name: 'get_subject', arguments: '{"subject' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":1}' } }] }, finish_reason: 'tool_calls' },
    ];
    for (const chunk of chunks) res.write(`data: ${JSON.stringify({ choices: [chunk] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const baseUrl = await local(server); t.after(() => close(server));
  const model = new ChatCompletionsModel({ baseUrl, model: 'test', apiKeyEnv: 'TEST_API_KEY', thinking: 'enabled' }, 2000, null, { TEST_API_KEY: 'fake-secret' });
  t.after(() => model.close());
  const output = await model.complete([{ role: 'user', content: '测试' }], [], { signal: signal() });
  assert.equal(output.reasoning_content, '测试推理');
  assert.equal(output.tool_calls?.[0]?.function.arguments, '{"subjectId":1}');
  assert.equal(request.stream, true); assert.deepEqual(request.thinking, { type: 'enabled' });
});

test('模型 HTTP 错误不包含返回体中的凭据；截断流失败', async t => {
  let mode = 'error';
  const server = createServer((_req,res) => {
    if (mode === 'error') { res.writeHead(401); res.end('fake-secret'); }
    else { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n'); }
  });
  const baseUrl = await local(server); t.after(() => close(server));
  const model = new ChatCompletionsModel({ baseUrl, model: 'test', apiKeyEnv: 'TEST_API_KEY', thinking: 'disabled' }, 2000, null, { TEST_API_KEY: 'fake-secret' });
  t.after(() => model.close());
  await assert.rejects(model.complete([],[],{ signal: signal() }), error => error instanceof Error && !error.message.includes('fake-secret'));
  mode = 'truncated';
  await assert.rejects(model.complete([],[],{ signal: signal() }), { code: 'MODEL_INCOMPLETE' });
});

test('对话查询链路、工具错误和会话恢复不重放工具', async t => {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-agent-test-')); t.after(() => rm(directory,{ recursive: true, force: true }));
  const log = new SessionLog(directory); let requests = 0; let calls = 0;
  const model: LanguageModel = { async complete(messages) {
    requests++;
    if (requests === 1) return { role: 'assistant', content: null, reasoning_content: '推理元数据', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_subjects', arguments: '{"keyword":"测试"}' } }] };
    assert.equal(messages.at(-1)?.role, 'tool');
    assert.ok(JSON.stringify(messages).includes('推理元数据'));
    return { role: 'assistant', content: '找到作品：https://bgm.tv/subject/1' };
  } };
  const tools: ToolRegistry = { schemas: () => [], async execute(name) { calls++; assert.equal(name,'search_subjects'); return { id: 1 }; } };
  const messages = await new ReadAgent(model,tools,log,4).run('搜索测试',[],{ signal: signal() });
  assert.equal(calls,1); assert.equal(messages.length,4);
  assert.deepEqual(await new SessionLog(directory,log.id).messages(), messages);
  assert.equal(calls,1);
  await log.append('turn/start',{}); await log.append('message',{ role: 'user', content: '中断任务' });
  assert.deepEqual(await log.messages(), messages);
  assert.ok((await readFile(join(directory,`${log.id}.jsonl`),'utf8')).includes('turn/end'));
});

test('无效工具参数回传模型；步数和取消限制不重放失败轮次', async t => {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-agent-test-')); t.after(() => rm(directory,{ recursive: true, force: true }));
  const log = new SessionLog(directory); let executions = 0;
  const tools: ToolRegistry = { schemas: () => [], async execute() { executions++; return {}; } };
  const model: LanguageModel = { async complete() { return { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'search_subjects', arguments: '{bad' } }] }; } };
  await assert.rejects(new ReadAgent(model,tools,log,1).run('测试',[],{ signal: signal() }), { code: 'STEP_LIMIT' });
  assert.equal(executions,0); assert.deepEqual(await log.messages(),[]);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(new ReadAgent(model,tools,log,1).run('测试',[],{ signal: aborted.signal }));
  assert.equal(executions,0);
});
