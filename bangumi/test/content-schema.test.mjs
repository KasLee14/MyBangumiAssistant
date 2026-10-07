import { PROVIDER_CONTENT_SCHEMA, CONTENT_OUTPUT_INSTRUCTION, normalizeProviderContent, normalizeProviderPart } from '../dist/src/output/provider-content.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENT_OUTPUT_SCHEMA,
  MAX_CONTENT_BYTES, MAX_CONTENT_PARTS, ContentOutputError, COMPONENT_KINDS,
  validateMixedContent, validateMixedPart,
  normalizePartialComponentProps,
} from '../dist/src/output/content-schema.js';
import { registry, sectionsModule, validateMessageBlock, providerPart } from './frontend-content-fixture.mjs';
import { contentView } from '../dist/src/output/content-view.js';
import { resourceReferenceSchema } from '../dist/src/output/resource-content.js';

test('12 种展示库主/空示例原样作为 props，TagCloud 直接使用数组且 InfoBox 不再多套一层', () => {
  assert.equal(sectionsModule.LIBRARY_SECTIONS.length, 12);
  assert.deepEqual(COMPONENT_KINDS, Object.keys(registry));
  for (const section of sectionsModule.LIBRARY_SECTIONS) {
    const spec = registry[section.kind];
    const kind = section.kind;
    const branch = CONTENT_OUTPUT_SCHEMA.properties.content.items.anyOf.find(branch => branch.properties.type.enum[0] === kind);
    assert.deepEqual(Object.keys(branch.properties), ['type', 'pending', 'props']);
    if (spec.limit) assert.equal(branch.properties.props.properties[spec.limit.field].maxItems, spec.limit.max);
    for (const payload of [section.payload, section.empty]) {
      const props = payload;
      const part = { type: kind, pending: false, props };
      assert.deepEqual(validateMixedPart(part), part);
      assert.equal(part.pending, false);
      const pendingView = contentView({ type: kind, pending: true, props: kind === 'TagCloud' ? [] : {} });
      assert.equal(pendingView.type, section.kind);
      assert.equal(pendingView.pending, true);
      assert.equal(contentView(part).pending, false);
      assert.equal(validateMessageBlock(part).status, 'ok');
      const normalized = normalizeProviderPart(providerPart(part));
      assert.equal(validateMessageBlock(normalized).status, 'ok');
      assert.deepEqual(normalized, part);
    }
  }
});

test('生成与内部契约分离，13分支复用严格载荷，状态由宿主生成', () => {
  assert.notEqual(PROVIDER_CONTENT_SCHEMA, CONTENT_OUTPUT_SCHEMA);
  assert.deepEqual(PROVIDER_CONTENT_SCHEMA.properties.content.items.anyOf[0].required, ['type', 'text']);
  const branches = PROVIDER_CONTENT_SCHEMA.properties.content.items.anyOf;
  assert.equal(branches.length, 13);
  assert.deepEqual(branches.map(branch => branch.properties.type.enum[0]), ['text', ...COMPONENT_KINDS]);
  assert.deepEqual(Object.keys(branches[0].properties), ['type', 'nextType', 'text']);
  for (const branch of branches.slice(1)) {
    assert.deepEqual(Object.keys(branch.properties), ['type', 'props']);
    assert.deepEqual(branch.required, ['type', 'props']);
    assert.deepEqual(branch.properties.props.anyOf[0], CONTENT_OUTPUT_SCHEMA.properties.content.items.anyOf.find(item => item.properties.type.enum[0] === branch.properties.type.enum[0]).properties.props);
    assert.deepEqual(branch.properties.props.anyOf[1], resourceReferenceSchema(branch.properties.type.enum[0]));
  }
  const visit = schema => {
    if (schema.type === 'object') {
      if (schema.properties) assert.equal(schema.additionalProperties, false);
      else assert.deepEqual(schema.additionalProperties, { type: 'string' });
    }
    for (const child of Object.values(schema.properties ?? {})) visit(child);
    for (const child of schema.anyOf ?? []) visit(child);
    if (schema.items) visit(schema.items);
  };
  visit(PROVIDER_CONTENT_SCHEMA);
  assert.equal(branches.find(branch => branch.properties.type.enum[0] === 'DataTable').properties.props.anyOf[0].properties.rows.items.type, 'object');
  assert.equal(resourceReferenceSchema('Gallery').properties.layout, undefined);
  assert.equal(resourceReferenceSchema('Gallery').properties.items.maxItems, 50);
  assert.equal(resourceReferenceSchema('SubjectCards').properties.items.maxItems, 50);
  assert.equal(resourceReferenceSchema('DataTable').properties.items.maxItems, 200);
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes(JSON.stringify(PROVIDER_CONTENT_SCHEMA)));
});

test('内部组件必须完成，模型状态字段不控制完成，载荷不转换类型', () => {
  for (const type of ['subjects', 'stats', 'progress', 'infobox', 'table', 'timeline', 'tags', 'gallery', 'compare', 'quote', 'callout', 'links']) {
    assert.throws(() => normalizeProviderPart({ type, props: {} }), ContentOutputError);
  }
  assert.throws(() => normalizeProviderPart({ type: 'TagCloud', pending: false, props: { tags: [] } }), ContentOutputError);
  assert.deepEqual(normalizeProviderPart({ type: 'QuoteBlock', pending: false, props: { text: '引文', mono: false } }),
    { type: 'QuoteBlock', pending: false, props: { text: '引文', mono: false } });
  for (const value of [
    { type: 'QuoteBlock', pending: false, props: { text: null, mono: false } },
    { type: 'QuoteBlock', pending: false, props: { text: '引文', mono: 'false' } },
    { type: 'QuoteBlock', pending: false, props: { text: '引文', mono: false, arbitrary: true } },
    { type: 'QuoteBlock', pending: false, props: { title: null, text: '引文', mono: false } },
    { type: 'QuoteBlock', pending: false, quote: { text: '引文', mono: false } },
  ]) assert.throws(() => normalizeProviderPart(value), ContentOutputError);
  for (const pending of [undefined, true, false, 'false']) assert.deepEqual(normalizeProviderPart({ type: 'QuoteBlock', ...(pending === undefined ? {} : { pending }), props: { text: '引文', mono: false } }), { type: 'QuoteBlock', pending: false, props: { text: '引文', mono: false } });
  assert.throws(() => validateMixedPart({ type: 'text', nextType: null, text: 'hello', id: 1 }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'rend', props: {} }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'QuoteBlock', pending: true, props: { text: 'x', mono: false } }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'QuoteBlock', props: { text: 'x', mono: false } }), ContentOutputError);
});

test('table 保留 convertToLlm 的对象行，部分字段不依赖生成顺序', () => {
  const value = { type: 'DataTable', pending: false, props: {
    columns: [{ key: 'quarter', label: '季度' }, { key: 'count', label: '数量', align: 'right' }],
    rows: [{ quarter: '2025 Q1', count: '10 部' }, { quarter: '2025 Q2', count: '' }],
  } };
  assert.deepEqual(normalizeProviderPart(value), { type: 'DataTable', pending: false, props: {
    columns: [{ key: 'quarter', label: '季度' }, { key: 'count', label: '数量', align: 'right' }],
    rows: [{ quarter: '2025 Q1', count: '10 部' }, { quarter: '2025 Q2', count: '' }],
  } });
  assert.deepEqual(normalizePartialComponentProps('DataTable', { rows: value.props.rows }), { rows: value.props.rows });
  assert.deepEqual(normalizePartialComponentProps('DataTable', { rows: value.props.rows, columns: value.props.columns }).rows,
    [{ quarter: '2025 Q1', count: '10 部' }, { quarter: '2025 Q2', count: '' }]);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, rows: [['Q1', '10']] } }), ContentOutputError);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, columns: [value.props.columns[0], value.props.columns[0]] } }), /不允许重复/);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, rows: [{ quarter: 'Q1', count: 10 }] } }), ContentOutputError);
  assert.throws(() => normalizePartialComponentProps('DataTable', { rows: [['a']], columns: null }), ContentOutputError);
});

test('nextType 必须与紧邻下一项一致，末项文本为 null', () => {
  const content = [
    { type: 'text', nextType: 'TagCloud', text: '前文' },
    { type: 'TagCloud', pending: false, props: [{ name: '日常' }] },
    { type: 'text', nextType: null, text: '后文' },
  ];
  assert.deepEqual(normalizeProviderContent({ content: content.map(providerPart) }), { content });
  assert.throws(() => validateMixedContent({ content: [{ ...content[0], nextType: 'StatsCard' }, ...content.slice(1)] }), /nextType/);
  assert.throws(() => validateMixedContent({ content: [content[0]] }), /nextType/);
  assert.doesNotThrow(() => validateMixedContent({ content: [
    { type: 'text', nextType: 'text', text: '第一段' }, { type: 'text', nextType: null, text: '第二段' },
  ] }));
});

test('规模、URL 和已闭合部分字段校验保留组件库语义', () => {
  const text = { type: 'text', nextType: null, text: 'a' };
  assert.throws(() => validateMixedContent({ content: Array(MAX_CONTENT_PARTS + 1).fill(text) }), ContentOutputError);
  assert.throws(() => validateMixedPart({ ...text, text: '中'.repeat(Math.ceil(MAX_CONTENT_BYTES / 3)) }), error => error.code === 'size');
  assert.throws(() => validateMixedPart({ type: 'InfoBox', pending: false, props: { rows: Array(101).fill({ label: 'a', value: 'b' }) } }), ContentOutputError);
  assert.doesNotThrow(() => validateMixedPart({ type: 'TagCloud', pending: false, props: Array(101).fill({ name: 'a' }) }));
  assert.doesNotThrow(() => validateMixedPart({ type: 'StatsCard', pending: false, props: { mode: 'bars', entries: [{ label: 'a', value: '1', ratio: -2 }] } }));
  assert.throws(() => validateMixedPart({ type: 'LinkList', pending: false, props: { links: [{ label: '站内', url: '/subject/1' }] } }), ContentOutputError);
  assert.deepEqual(normalizePartialComponentProps('StatsCard', { title: '评分', headline: { value: '8', label: '均分' } }),
    { title: '评分', headline: { value: '8', label: '均分' } });
  assert.throws(() => normalizePartialComponentProps('StatsCard', { headline: { value: '8' } }), ContentOutputError);
  assert.throws(() => normalizePartialComponentProps('StatsCard', JSON.parse('{"__proto__":{"polluted":true}}')), ContentOutputError);
});
