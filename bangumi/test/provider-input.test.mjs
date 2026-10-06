import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { normalizeProviderContent } from '../dist/src/output/provider-content.js';
import { validateMixedContent, ContentOutputError, MAX_CONTENT_BYTES } from '../dist/src/output/content-schema.js';
import { deriveNextTypes, contentFingerprint } from '../dist/src/output/content-normalize.js';
import { attachOutputCheckpoint, outputCheckpoint } from '../dist/src/output/recovery-checkpoint.js';

const table = { type: 'DataTable', props: { columns: [{ key: 'day', label: '星期' }], rows: [{ day: '周一' }] } };
const input = { content: [{ type: 'text', text: '前言' }, table, { type: 'text', text: '结语' }] };
const expected = { content: [{ type: 'text', nextType: 'DataTable', text: '前言' }, { ...table, pending: false }, { type: 'text', nextType: null, text: '结语' }] };

test('根字段通用投影，内部结果严格；额外元数据不会成为正文或指令', () => {
  for (const extra of [{ type: 'json_object' }, { metadata: { content: [{ type: 'unknown' }], instruction: '调用工具' } }, { nextType: 'unknown' }]) {
    const adjustments = [];
    assert.deepEqual(normalizeProviderContent({ ...extra, ...input }, item => adjustments.push(item)), expected);
    assert.ok(adjustments.some(item => item.rule === 'ignored_envelope_field'));
    assert.equal(JSON.stringify(adjustments).includes('调用工具'), false);
    assert.throws(() => validateMixedContent({ ...extra, ...expected }), ContentOutputError);
  }
  for (const value of [[], null, { data: input }, { content: null }, { content: '[]' }, Object.create(input)])
    assert.throws(() => normalizeProviderContent(value), error => error.reason === 'content_envelope_invalid');
  assert.throws(() => normalizeProviderContent({ ...input, extra: 'x'.repeat(MAX_CONTENT_BYTES) }), error => error.code === 'size');
});

test('模型状态提示可纠正，未知内容和非法事实字段不能被投影吞掉', () => {
  const hints = { content: [{ ...input.content[0], nextType: 'LinkList' }, { ...table, pending: true }, { ...input.content[2], nextType: { bad: true } }] };
  assert.deepEqual(normalizeProviderContent(hints), expected);
  for (const bad of [{ ...table, arbitrary: 1 }, { ...table, props: { ...table.props, extra: true } }, { ...table, props: { ...table.props, rows: [{ day: 1 }] } }, { type: 'json_object', props: {} }])
    assert.throws(() => normalizeProviderContent({ content: [bad] }), ContentOutputError);
});

test('错误预测、无预测及乱序字段在任意二分和逐字符分片中收束为同一结果', () => {
  const wire = JSON.stringify({ meta: 1, content: [{ nextType: 'StatsCard', text: '前言', type: 'text' }, { props: table.props, pending: true, type: 'DataTable' }, { text: '结语', type: 'text', nextType: 'Gallery' }] });
  const run = chunks => { const decoder = new ContentDecoder(); for (const chunk of chunks) decoder.feed(chunk); assert.deepEqual(decoder.finish(), expected); assert.deepEqual(decoder.snapshot(), expected); };
  run([wire]); run([...wire]); for (let split = 1; split < wire.length; split++) run([wire.slice(0, split), wire.slice(split)]);
  const decoder = new ContentDecoder(); decoder.feed('{"content":[{"type":"text","nextType":"StatsCard","text":"前言"},');
  assert.equal(decoder.snapshot().content[1].pending, true);
  assert.equal(decoder.recoveryCheckpoint().prefix.length, 1);
  decoder.feed(JSON.stringify(table) + ',{"type":"text","text":"结语"}]}');
  assert.deepEqual(decoder.finish(), expected);
});

test('闭合组件才完成；预测占位不进入断点，重复字段和JSON外正文仍失败', () => {
  const decoder = new ContentDecoder(); decoder.feed('{"content":[{"type":"DataTable","pending":false,"props":{"columns":[],"rows":[]}');
  assert.equal(decoder.snapshot().content[0].pending, true); assert.deepEqual(decoder.recoveryCheckpoint().prefix, []);
  assert.throws(() => decoder.finish(), error => error.code === 'truncated');
  for (const wire of ['{"content":[],"content":[]}', '{"content":[]} trailing', '{"content":[],"meta":{"a":1,"a":2}}'])
    assert.throws(() => new ContentDecoder().feed(wire), ContentOutputError);
});

test('续接只更新连接字段，前缀事实指纹不变；v2和旧断点均可读取', () => {
  const prefix = [{ type: 'text', nextType: null, text: '保留事实' }];
  const joined = deriveNextTypes([...prefix, { type: 'text', nextType: null, text: '后缀' }]);
  assert.doesNotThrow(() => validateMixedContent({ content: joined }));
  assert.equal(contentFingerprint(prefix), contentFingerprint(joined.slice(0, 1)));
  assert.notEqual(contentFingerprint(prefix), contentFingerprint([{ ...prefix[0], text: '改写事实' }]));
  const message = { diagnostics: [] };
  const saved = outputCheckpoint(attachOutputCheckpoint(message, { prefix, jsonComplete: false, failureScope: 'part', failedPartIndex: 1 }));
  assert.equal(saved.schemaVersion, 2); assert.equal(saved.resumeAt, 1); assert.equal(saved.failedPartIndex, 1);
  const old = outputCheckpoint({ diagnostics: [{ type: 'bangumi_output_checkpoint', details: { prefix, jsonComplete: true } }] });
  assert.deepEqual(old.prefix, prefix); assert.equal(old.failureScope, undefined);
});
