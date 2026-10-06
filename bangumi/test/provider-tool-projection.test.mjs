import test from 'node:test';
import assert from 'node:assert/strict';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { convertMessages } from '@earendil-works/pi-ai/api/openai-completions';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';

const commonModel = { id: 'projection-model', name: 'projection-model', provider: 'openai', baseUrl: 'https://example.invalid/v1',
  reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

for (const api of ['openai-responses', 'openai-completions']) test(`${api}实际消息转换只发送候选content，完整结构与UI元数据不进入模型请求`, async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async () => ({ id: 1, type: 2, name: '可见作品', name_cn: '可见作品',
    nsfw: false, platform: 'TV', date: '2026-10-01', rating: { score: 8, total: 100, rank: 20 }, tags: [], meta_tags: ['TV'],
    summary: '缓存正文', infobox: [] }) });
  t.after(() => service.close());
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'provider-projection-test' });
  const tool = createReadTools({ call }).find(tool => tool.name === 'refine_subject_candidates');
  const args = { subject_ids: [1], fields: ['id', 'name'] };
  const reply = await tool.execute('call_1', args, undefined, undefined, {});
  assert.notEqual(reply.isError, true);
  const full = structuredClone(reply.structuredContent), sentinel = 'FULL_STRUCTURED_METADATA_MUST_STAY_LOCAL';
  full.value.readAt = sentinel;
  assert.ok(full.value.scope); assert.equal(JSON.parse(reply.content[0].text).value.scope, undefined);
  const model = { ...commonModel, api }, context = { messages: [
    { role: 'assistant', api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'toolUse', usage,
      content: [{ type: 'toolCall', id: 'call_1', name: tool.name, arguments: args }] },
    { role: 'toolResult', toolCallId: 'call_1', toolName: tool.name, timestamp: 2, isError: false,
      content: reply.content, structuredContent: full, details: full },
  ] };
  const input = api === 'openai-responses' ? convertResponsesMessages(model, context, new Set(['openai']))
    : convertMessages(model, context, { supportsStrictMode: true, supportsMidConvoSystemMessages: true });
  const toolMessage = input.find(message => message.type === 'function_call_output' || message.role === 'tool');
  assert.ok(toolMessage); assert.equal(toolMessage.output ?? toolMessage.content, reply.content[0].text);
  assert.equal(JSON.stringify(input).includes(sentinel), false);
  assert.equal(JSON.stringify(input).includes('缓存正文'), false);
  assert.ok(JSON.stringify(input).includes('可见作品'));
});
