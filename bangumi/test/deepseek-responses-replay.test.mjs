import assert from 'node:assert/strict';
import test from 'node:test';
import { orderDeepSeekRecoveryReasoning } from '../dist/src/output/deepseek-responses-replay.js';
import { withContentConstraint } from '../dist/src/output/provider-options.js';
import { CONTENT_OUTPUT_SYSTEM_MARKER } from '../dist/src/output/content-schema.js';

const reasoning = { type: 'reasoning', id: 'native-reasoning', content: [{ type: 'reasoning_text', text: '模型原生思考示例' }], summary: [] };
const prefix = { type: 'message', id: 'host-prefix', role: 'assistant', content: [{ type: 'output_text', text: '已完成正文' }] };
const call = { type: 'function_call', name: 'read_component_spec', call_id: 'native-call', arguments: '{"names":["SubjectCards"]}' };
const result = { type: 'function_call_output', call_id: 'native-call', output: '{}' };
const message = () => ({ role: 'assistant', api: 'openai-responses', provider: 'deepseek', model: 'deepseek-flash', content: [
  { type: 'text', text: '已完成正文', nextType: null }, { type: 'thinking', thinking: '模型原生思考示例', thinkingSignature: JSON.stringify(reasoning) },
  { type: 'toolCall', id: 'native-call', name: 'read_component_spec', arguments: { names: ['SubjectCards'] } },
], diagnostics: [{ type: 'application_recovery', details: { retainedParts: 1, status: 'running' } }] });

test('仅将有原生签名证据的恢复COT移至宿主前缀前，完整保留思考/summary/id和工具配对', () => {
  const user = { role: 'user', content: '恢复反馈' };
  const payload = { reasoning: { effort: 'high' }, input: [user, prefix, reasoning, call, result] };
  const before = structuredClone(payload);
  const normalized = orderDeepSeekRecoveryReasoning(payload, { messages: [message()] });
  assert.deepEqual(normalized.input, [user, reasoning, prefix, call, result]);
  assert.deepEqual(payload, before);
  assert.equal(normalized.input[1], reasoning);
  assert.equal(normalized.input[3].call_id, normalized.input[4].call_id);
  assert.deepEqual(normalized.input[1].content, reasoning.content);
  assert.deepEqual(normalized.input[1].summary, []);
  assert.equal(orderDeepSeekRecoveryReasoning(normalized, { messages: [message()] }), normalized);
});

test('普通消息、缺签名、签名与wire不一致或跨user边界不移动，绝不新增思考', () => {
  const original = message();
  for (const candidate of [{ ...original, diagnostics: [] }, { ...original, provider: 'openai' },
    { ...original, content: original.content.map(part => part.type === 'thinking' ? { ...part, thinkingSignature: undefined } : part) },
    { ...original, content: original.content.map(part => part.type === 'thinking' ? { ...part, thinkingSignature: JSON.stringify({ ...reasoning, summary: [{ text: '不同摘要' }] }) } : part) }]) {
    const payload = { input: [prefix, reasoning, call, result] };
    assert.equal(orderDeepSeekRecoveryReasoning(payload, { messages: [candidate] }), payload);
  }
  const payload = { input: [prefix, { role: 'user', content: '另一轮用户请求' }, reasoning, call, result] };
  assert.equal(orderDeepSeekRecoveryReasoning(payload, { messages: [original] }), payload);
  const missing = { input: [prefix, call, result] };
  assert.equal(orderDeepSeekRecoveryReasoning(missing, { messages: [original] }), missing);
});

test('官方DeepSeek请求回调重复约束仍幂等，其他提供方不应用恢复顺序适配', async () => {
  const context = { messages: [{ role: 'system', content: '应用规则', timestamp: 1,
    sections: { application: CONTENT_OUTPUT_SYSTEM_MARKER } }, message()] };
  const model = { api: 'openai-responses', provider: 'deepseek', id: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
  const source = { input: [prefix, reasoning, call, result], reasoning: { effort: 'high' } };
  const resultPayload = await withContentConstraint(model, context, {}).onPayload(source, model);
  assert.deepEqual(resultPayload.input, [reasoning, prefix, call, result]);
  assert.deepEqual(source.input, [prefix, reasoning, call, result]);
  const alternate = { ...model, provider: 'openai', id: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' };
  assert.deepEqual((await withContentConstraint(alternate, context, {}).onPayload(source, alternate)).input, source.input);
});
