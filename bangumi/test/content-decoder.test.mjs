import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';
import { ContentOutputError, MAX_CONTENT_BYTES, MAX_CONTENT_PARTS } from '../dist/src/output/content-schema.js';

const answer = { content: [
  { type: 'text', nextType: 'StatsCard', text: '评分：8.2\n“引号” \\ 😀 **说明**' },
  { type: 'StatsCard', pending: false, props: { mode: 'list', entries: [{ label: '平均分', value: '8.2' }] } },
  { type: 'text', nextType: null, text: '组件之后继续说明。' },
] };

function runChunks(chunks, mode = 'canonical') {
  const decoder = new ContentDecoder({ mode });
  const deltas = chunks.flatMap(chunk => decoder.feed(chunk));
  const final = decoder.finish();
  assert.deepEqual(decoder.snapshot(), final);
  const rebuilt = [];
  for (const delta of deltas) {
    if (delta.type === 'text') {
      assert.equal(rebuilt[delta.index]?.type, 'text');
      rebuilt[delta.index].text += delta.delta;
    } else rebuilt[delta.index] = structuredClone(delta.part);
  }
  assert.deepEqual({ content: rebuilt }, final);
  return { final, deltas };
}
const events = (value, type) => value.filter(event => event.type === type);

test('TagCloud 直接解码 props 数组，任意分片一致且不公开半份数组', () => {
  const wire = JSON.stringify({ content: [
    { type: 'text', nextType: 'TagCloud', text: '标签：' },
    { type: 'TagCloud', pending: false, props: [{ name: '日常', selected: false }] },
  ] });
  const expected = { content: [
    { type: 'text', nextType: 'TagCloud', text: '标签：' },
    { type: 'TagCloud', pending: false, props: [{ name: '日常', selected: false }] },
  ] };
  for (let split = 0; split <= wire.length; split++) assert.deepEqual(runChunks([wire.slice(0, split), wire.slice(split)], 'provider').final, expected);
  const decoder = new ContentDecoder();
  decoder.feed('{"content":[{"type":"TagCloud","pending":false,"props":[{"name":"日常"');
  assert.deepEqual(decoder.snapshot().content, [{ type: 'TagCloud', pending: true, props: [] }]);
  decoder.feed(',"selected":false}]');
  assert.deepEqual(decoder.snapshot().content, [{ type: 'TagCloud', pending: true, props: [{ name: '日常', selected: false }] }]);
  decoder.feed('}]}');
  assert.deepEqual(decoder.finish(), { content: [expected.content[1]] });
});

test('任意二分、逐字符和整段输入具有相同内容及 delta 重建结果', () => {
  const wire = JSON.stringify(answer);
  for (let split = 0; split <= wire.length; split++) {
    assert.deepEqual(runChunks([wire.slice(0, split), wire.slice(split)]).final, answer);
  }
  assert.deepEqual(runChunks(wire.split('')).final, answer);
  const all = runChunks([wire]);
  assert.deepEqual(events(all.deltas, 'text').map(delta => delta.delta), [answer.content[0].text, answer.content[2].text]);
  assert.equal(events(all.deltas, 'component').length, 1);
  assert.equal(events(all.deltas, 'text_end').length, 2);
});

test('文本生成前按 nextType 提前占位，完整组件更新同一槽位 true → false', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  const start = decoder.feed('{"content":[{"type":"text","nextType":"SubjectCards","text":"推荐');
  assert.deepEqual(events(start, 'text'), [{ type: 'text', index: 0, delta: '推荐' }]);
  assert.deepEqual(decoder.snapshot(), { content: [
    { type: 'text', nextType: 'SubjectCards', text: '推荐' }, { type: 'SubjectCards', pending: true, props: {} },
  ] });
  decoder.feed('作品。"},{"type":"SubjectCards","pending":false,"props":{"title":"相关条目","layout":"grid","items":[{"id":1');
  assert.deepEqual(decoder.snapshot().content[1], { type: 'SubjectCards', pending: true, props: { title: '相关条目', layout: 'grid' } });
  decoder.feed(',"name":"A","kind":"anime"}]');
  assert.deepEqual(decoder.snapshot().content[1], { type: 'SubjectCards', pending: true, props: {
    title: '相关条目', layout: 'grid', items: [{ id: 1, name: 'A', kind: 'anime' }],
  } });
  const end = decoder.feed('}}]}');
  assert.equal(events(end, 'component').length, 1);
  assert.equal(events(end, 'component')[0].index, 1);
  assert.equal(decoder.snapshot().content.length, 2);
  assert.equal(decoder.snapshot().content[1].pending, false);
  decoder.finish();
});

test('部分 props 只公开已闭合且有效的字段，headline 对象和 items 数组不拆开', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  decoder.feed('{"content":[{"type":"StatsCard","pending":false,"props":{"title":"评');
  assert.deepEqual(decoder.snapshot().content[0], { type: 'StatsCard', pending: true, props: {} });
  decoder.feed('分","headline":{"value":"8.2"');
  assert.deepEqual(decoder.snapshot().content[0].props, { title: '评分' });
  decoder.feed(',"label":"均分"},"mode":"list","entries":[{"label":"A"');
  assert.deepEqual(decoder.snapshot().content[0].props, { title: '评分', headline: { value: '8.2', label: '均分' }, mode: 'list' });
  decoder.feed(',"value":"1"}]}}]}');
  assert.equal(decoder.finish().content[0].pending, false);
});

test('text_end 只在完整 text 对象闭合后产生，后续文本保持独立生命周期', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  const first = decoder.feed('{"content":[{"type":"text","nextType":"text","text":"第一段"');
  assert.equal(events(first, 'text_end').length, 0);
  const second = decoder.feed('},{"type":"text","nextType":null,"text":"第二');
  assert.deepEqual(events(second, 'text_end').map(delta => delta.index), [0]);
  assert.equal(decoder.snapshot().content[1].text, '第二');
  const third = decoder.feed('段"}]}');
  assert.deepEqual(events(third, 'text_end').map(delta => delta.index), [1]);
  assert.equal(decoder.finish().content.length, 2);
});

test('type 晚于 text/props 时缓冲，nextType 晚到也能创建同一位置占位', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  assert.deepEqual(decoder.feed('{"content":[{"text":"先缓冲😀","nextType":"StatsCard","type":'), []);
  assert.deepEqual(decoder.snapshot(), { content: [] });
  const deltas = decoder.feed('"text"},{"props":{"mode":"list","entries":[]},"pending":false,"type":"StatsCard"}]}');
  assert.deepEqual(events(deltas, 'text').map(delta => delta.delta), ['先缓冲😀']);
  assert.deepEqual(decoder.finish(), { content: [
    { type: 'text', nextType: 'StatsCard', text: '先缓冲😀' }, { type: 'StatsCard', pending: false, props: { mode: 'list', entries: [] } },
  ] });
});

test('跨 chunk 转义和 Unicode 代理对不产生半个字符', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  decoder.feed('{"content":[{"type":"text","nextType":null,"text":"');
  assert.deepEqual(decoder.feed('\\uD83D'), []);
  assert.deepEqual(decoder.feed('\\uDE00'), [{ type: 'text', index: 0, delta: '😀' }]);
  assert.deepEqual(decoder.feed('\\'), []);
  assert.deepEqual(decoder.feed('n\\"'), [{ type: 'text', index: 0, delta: '\n"' }]);
  decoder.feed('"}]}');
  assert.deepEqual(decoder.finish(), { content: [{ type: 'text', nextType: null, text: '😀\n"' }] });
});

test('provider 保留 pending 和表格对象行，任意二分保持一致', () => {
  const wire = JSON.stringify({ content: [
    { type: 'text', nextType: 'DataTable', text: '表格：' },
    { type: 'DataTable', pending: false, props: { columns: [{ key: 'name', label: '名称' }], rows: [{ name: '动画' }] } },
  ] });
  const expected = { content: [
    { type: 'text', nextType: 'DataTable', text: '表格：' },
    { type: 'DataTable', pending: false, props: { columns: [{ key: 'name', label: '名称' }], rows: [{ name: '动画' }] } },
  ] };
  for (let split = 0; split <= wire.length; split++) assert.deepEqual(runChunks([wire.slice(0, split), wire.slice(split)], 'provider').final, expected);
});

test('provider 表格字段乱序：完整对象行可先于 columns 发布，仍保持生成状态', () => {
  const decoder = new ContentDecoder();
  decoder.feed('{"content":[{"type":"DataTable","pending":false,"props":{"rows":[{"name":"动画"}]');
  assert.deepEqual(decoder.snapshot(), { content: [{ type: 'DataTable', pending: true, props: { rows: [{ name: '动画' }] } }] });
  decoder.feed(',"columns":[{"key":"name","label":"名称"}]');
  assert.deepEqual(decoder.snapshot().content[0].props.rows, [{ name: '动画' }]);
  decoder.feed('}}]}');
  assert.equal(decoder.finish().content[0].pending, false);
});

test('独立解码器不会串流，snapshot/delta 外部修改不污染内部状态', () => {
  const first = new ContentDecoder({ mode: 'canonical' });
  const second = new ContentDecoder({ mode: 'canonical' });
  const deltas = first.feed('{"content":[{"type":"text","nextType":"StatsCard","text":"甲');
  second.feed('{"content":[{"type":"text","nextType":null,"text":"乙');
  const copy = first.snapshot();
  copy.content[0].text = '污染';
  copy.content[1].props.mode = 'invalid';
  deltas.find(delta => delta.type === 'update' && delta.index === 1).part.props.mode = 'invalid';
  first.feed('"},{"type":"StatsCard","pending":false,"props":{"mode":"list","entries":[]}}]}');
  second.feed('"}]}');
  assert.equal(first.finish().content[0].text, '甲');
  assert.equal(second.finish().content[0].text, '乙');
});

test('未知/无效组件不标记完成，错误状态不能继续 feed', () => {
  for (const part of [
    { type: 'rend', props: {} },
    { type: 'StatsCard', pending: false, props: { mode: 'invalid', entries: [] } },
    { type: 'StatsCard', pending: false, props: { mode: 'list', entries: [], extra: true } },
    { type: 'StatsCard', pending: false, props: null },
    { type: 'StatsCard', pending: true, props: { mode: 'list', entries: [] } },
  ]) {
    const decoder = new ContentDecoder({ mode: 'canonical' });
    decoder.feed('{"content":[');
    assert.throws(() => decoder.feed(JSON.stringify(part)), ContentOutputError);
    assert.ok(decoder.snapshot().content.every(part => part.type === 'text' || part.pending === true));
    assert.throws(() => decoder.feed(']}'), ContentOutputError);
  }
});

test('nextType 与实际下一类型不同、末项缺失声明组件均拒绝且保留占位', () => {
  const mismatch = new ContentDecoder({ mode: 'canonical' });
  mismatch.feed('{"content":[{"type":"text","nextType":"SubjectCards","text":"候选"},');
  assert.throws(() => mismatch.feed('{"type":"StatsCard"'), /声明|不一致/);
  assert.deepEqual(mismatch.snapshot().content[1], { type: 'SubjectCards', pending: true, props: {} });
  const missing = new ContentDecoder({ mode: 'canonical' });
  missing.feed('{"content":[{"type":"text","nextType":"SubjectCards","text":"候选"}]}');
  assert.throws(() => missing.finish(), /nextType/);
  assert.equal(missing.snapshot().content[1].pending, true);
});

test('重复字段、尾逗号、非法转义、额外正文、数值及原型键均拒绝', () => {
  const invalid = [
    '{"content":[],"content":[]}',
    '{"content":[{"type":"text","nextType":null,"text":"a","text":"b"}]}',
    '{"content":[{"type":"StatsCard","pending":false,"props":{"mode":"list","mode":"bars","entries":[]}}]}',
    '{"content":[],}', '{"content":[,]}', '{"content":[]} trailing',
    '{"content":[{"type":"text","nextType":null,"text":"\\q"}]}',
    '{"content":[{"type":"ProgressView","pending":false,"props":{"current":01}}]}',
    '{"content":[{"type":"ProgressView","pending":false,"props":{"current":1e999}}]}',
    '{"content":[{"type":"StatsCard","pending":false,"props":{"__proto__":{"polluted":true}}}]}',
  ];
  for (const wire of invalid) assert.throws(() => new ContentDecoder({ mode: 'canonical' }).feed(wire), ContentOutputError, wire);
});

test('截断响应保留可见文字/占位及部分 props，永远不产生假完成', () => {
  const decoder = new ContentDecoder({ mode: 'canonical' });
  decoder.feed('{"content":[{"type":"text","nextType":"SubjectCards","text":"尚未完成');
  assert.throws(() => decoder.finish(), error => error instanceof ContentOutputError && error.code === 'truncated');
  assert.equal(decoder.snapshot().content[0].text, '尚未完成');
  assert.equal(decoder.snapshot().content[1].pending, true);
  const component = new ContentDecoder({ mode: 'canonical' });
  component.feed('{"content":[{"type":"SubjectCards","pending":false,"props":{"title":"候选","layout":"grid","items":[');
  assert.throws(() => component.finish(), error => error.code === 'truncated');
  assert.deepEqual(component.snapshot().content[0], { type: 'SubjectCards', pending: true, props: { title: '候选', layout: 'grid' } });
});

test('字节、数量、提前占位和嵌套上限在流中生效', () => {
  assert.throws(() => new ContentDecoder().feed(' '.repeat(MAX_CONTENT_BYTES + 1)), error => error.code === 'size');
  const parts = Array.from({ length: MAX_CONTENT_PARTS + 1 }, () => ({ type: 'text', nextType: 'text', text: 'a' }));
  assert.throws(() => new ContentDecoder().feed(JSON.stringify({ content: parts })), error => error.code === 'size');
  const placeholders = Array.from({ length: MAX_CONTENT_PARTS }, (_, index) => ({ type: 'text', nextType: index === MAX_CONTENT_PARTS - 1 ? 'StatsCard' : 'text', text: 'a' }));
  assert.throws(() => new ContentDecoder({ mode: 'canonical' }).feed(JSON.stringify({ content: placeholders })), error => error.code === 'size');
  const provider = new ContentDecoder(); provider.feed(JSON.stringify({ content: placeholders }));
  assert.equal(provider.finish().content.length, MAX_CONTENT_PARTS);
  assert.throws(() => new ContentDecoder().feed('['.repeat(65)), error => error.code === 'size');
});

test('UTF-8 字节上限不会重复计算跨分片代理对', () => {
  const prefix = '{"content":[{"type":"text","nextType":null,"text":"';
  const suffix = '"}]}';
  const text = 'a'.repeat(MAX_CONTENT_BYTES - Buffer.byteLength(prefix + suffix) - 4) + '😀';
  const wire = prefix + text + suffix;
  assert.equal(Buffer.byteLength(wire), MAX_CONTENT_BYTES);
  const split = wire.indexOf('😀') + 1;
  const decoder = new ContentDecoder({ mode: 'canonical' });
  decoder.feed(wire.slice(0, split));
  decoder.feed(wire.slice(split));
  assert.equal(decoder.finish().content[0].text, text);
});

test('空文本仍有独立槽位、空 delta 和 text_end，后续组件不重复', () => {
  const result = runChunks(['{"content":[{"type":"text","nextType":"StatsCard","text":""},{"type":"StatsCard","pending":false,"props":{"mode":"list","entries":[]}}]}']);
  assert.equal(result.final.content.length, 2);
  assert.deepEqual(events(result.deltas, 'text')[0], { type: 'text', index: 0, delta: '' });
  assert.equal(events(result.deltas, 'text_end').length, 1);
  assert.equal(events(result.deltas, 'component').length, 1);
});
