import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  CONTENT_OUTPUT_SCHEMA, PROVIDER_CONTENT_SCHEMA, CONTENT_OUTPUT_INSTRUCTION,
  MAX_CONTENT_BYTES, MAX_CONTENT_PARTS, ContentOutputError, COMPONENT_KINDS,
  validateMixedContent, validateMixedPart, normalizeProviderContent, normalizeProviderPart,
  normalizePartialComponentProps,
} from '../dist/src/output/content-schema.js';
import { COMPONENT_VIEW_TYPES, contentView } from '../dist/src/output/content-view.js';

const root = new URL('../../', import.meta.url);
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022,
} }).outputText;
const registrySource = await readFile(new URL('web/src/components/content/registry.tsx', root), 'utf8');
const registry = Object.fromEntries([...registrySource.matchAll(/  (\w+): \{(?:\s*limit: \{ field: '(\w+)', max: (\d+) \},)?/g)]
  .map(([, kind, limitField, max]) => [kind, { ...(max ? { limit: { field: limitField, max: Number(max) } } : {}) }]));
const sectionsModule = await import(dataModule(transpile(await readFile(new URL('web/src/page/library/samples.ts', root), 'utf8'))));
const frontendRegistryModule = dataModule(`export const CONTENT_RENDERERS=${JSON.stringify(registry)};
export function isContentKind(kind){return Object.hasOwn(CONTENT_RENDERERS,kind)}
export function isBaseTranscriptKind(kind){return ['header','user','assistant','notice','error','activity','confirmation'].includes(kind)}`);
const frontendValidatorCode = transpile(await readFile(new URL('web/src/components/content/validate.ts', root), 'utf8'))
  .replace(/from ['"]\.\/registry['"]/, `from '${frontendRegistryModule}'`);
const { validateMessageBlock } = await import(dataModule(frontendValidatorCode));

function branchFor(type, schema = CONTENT_OUTPUT_SCHEMA) {
  return schema.properties.content.items.anyOf.find(branch => branch.properties.type.enum[0] === type);
}
function toProvider(value, schema) {
  if (schema.anyOf) {
    const branch = schema.anyOf.find(branch => branch.properties?.type?.enum.includes(value?.type))
      ?? schema.anyOf.find(branch => branch.type === (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value));
    return toProvider(value, branch);
  }
  if (schema.items) return value.map(item => toProvider(item, schema.items));
  if (!schema.properties) return value;
  return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key,
    value[key] === undefined ? null : toProvider(value[key], child)]));
}
function providerPart(part) {
  const source = structuredClone(part);
  delete source.pending;
  if (part.type === 'table') source.props.rows = part.props.rows.map(row => part.props.columns.map(column => row[column.key] ?? ''));
  return toProvider(source, branchFor(part.type, PROVIDER_CONTENT_SCHEMA));
}
test('12 种展示库主/空示例原样作为 props，tags 包装且 infobox 不再多套一层', () => {
  assert.equal(sectionsModule.LIBRARY_SECTIONS.length, 12);
  assert.deepEqual(COMPONENT_KINDS.map(kind => COMPONENT_VIEW_TYPES[kind]), Object.keys(registry));
  for (const section of sectionsModule.LIBRARY_SECTIONS) {
    const spec = registry[section.kind];
    const kind = COMPONENT_KINDS.find(kind => COMPONENT_VIEW_TYPES[kind] === section.kind);
    const branch = branchFor(kind);
    assert.deepEqual(Object.keys(branch.properties), ['type', 'pending', 'props']);
    if (spec.limit) assert.equal(branch.properties.props.properties[spec.limit.field].maxItems, spec.limit.max);
    for (const payload of [section.payload, section.empty]) {
      const props = kind === 'tags' ? { tags: payload } : payload;
      const part = { type: kind, pending: false, props };
      assert.deepEqual(validateMixedPart(part), part);
      assert.equal(part.pending, false);
      const pendingView = contentView({ type: kind, pending: true, props: {} });
      assert.equal(pendingView.type, section.kind);
      assert.equal(pendingView.pending, true);
      assert.equal(contentView(part).pending, false);
      assert.equal(validateMessageBlock(contentView(part)).status, 'ok');
      const normalized = normalizeProviderPart(providerPart(part));
      assert.equal(validateMessageBlock(contentView(normalized)).status, 'ok');
      const expected = part.type === 'table' ? { ...part, props: { ...part.props,
        rows: part.props.rows.map(row => Object.fromEntries(part.props.columns.map(column => [column.key, row[column.key] ?? '']))),
      } } : part;
      assert.deepEqual(normalized, expected);
    }
  }
});

test('strict provider schema 是13个分支，全部闭合且没有模型 pending 字段', () => {
  const branches = PROVIDER_CONTENT_SCHEMA.properties.content.items.anyOf;
  assert.equal(branches.length, 13);
  assert.deepEqual(branches.map(branch => branch.properties.type.enum[0]), ['text', ...COMPONENT_KINDS]);
  assert.deepEqual(Object.keys(branches[0].properties), ['type', 'nextType', 'text']);
  for (const branch of branches.slice(1)) assert.deepEqual(Object.keys(branch.properties), ['type', 'props']);
  const visit = schema => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    }
    for (const child of Object.values(schema.properties ?? {})) visit(child);
    for (const child of schema.anyOf ?? []) visit(child);
    if (schema.items) visit(schema.items);
  };
  visit(PROVIDER_CONTENT_SCHEMA);
  assert.equal(branchFor('table', PROVIDER_CONTENT_SCHEMA).properties.props.properties.rows.items.type, 'array');
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes(JSON.stringify(PROVIDER_CONTENT_SCHEMA)));
});

test('只移除 optional null，不接受旧载荷包装、模型 pending、缺失必填或转换类型', () => {
  assert.deepEqual(normalizeProviderPart({ type: 'quote', props: { title: null, text: '引文', mono: false } }),
    { type: 'quote', pending: false, props: { text: '引文', mono: false } });
  for (const value of [
    { type: 'quote', props: { title: null, text: null, mono: false } },
    { type: 'quote', props: { text: '引文', mono: false } },
    { type: 'quote', props: { title: null, text: '引文', mono: 'false' } },
    { type: 'quote', props: { title: null, text: '引文', mono: false, arbitrary: true } },
    { type: 'quote', quote: { title: null, text: '引文', mono: false } },
    { type: 'quote', pending: true, props: { title: null, text: '引文', mono: false } },
  ]) assert.throws(() => normalizeProviderPart(value), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'text', nextType: null, text: 'hello', id: 1 }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'rend', props: {} }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'quote', pending: true, props: { text: 'x', mono: false } }), ContentOutputError);
  assert.throws(() => validateMixedPart({ type: 'quote', props: { text: 'x', mono: false } }), ContentOutputError);
});

test('table 矩阵按列映射，部分 rows 晚于 columns 发布且不丢单元格', () => {
  const value = { type: 'table', props: { title: null, note: null,
    columns: [{ key: 'quarter', label: '季度', align: null }, { key: 'count', label: '数量', align: 'right' }],
    rows: [['2025 Q1', '10 部'], ['2025 Q2', '']],
  } };
  assert.deepEqual(normalizeProviderPart(value), { type: 'table', pending: false, props: {
    columns: [{ key: 'quarter', label: '季度' }, { key: 'count', label: '数量', align: 'right' }],
    rows: [{ quarter: '2025 Q1', count: '10 部' }, { quarter: '2025 Q2', count: '' }],
  } });
  assert.deepEqual(normalizePartialComponentProps('table', { rows: value.props.rows }), {});
  assert.deepEqual(normalizePartialComponentProps('table', { rows: value.props.rows, columns: value.props.columns }).rows,
    [{ quarter: '2025 Q1', count: '10 部' }, { quarter: '2025 Q2', count: '' }]);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, rows: [['only one']] } }), /数量必须/);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, columns: [value.props.columns[0], value.props.columns[0]] } }), /不允许重复/);
  assert.throws(() => normalizeProviderPart({ ...value, props: { ...value.props, rows: [['Q1', 10]] } }), ContentOutputError);
  assert.throws(() => normalizePartialComponentProps('table', { rows: [['a']], columns: null }), ContentOutputError);
});

test('nextType 必须与紧邻下一项一致，末项文本为 null', () => {
  const content = [
    { type: 'text', nextType: 'tags', text: '前文' },
    { type: 'tags', pending: false, props: { tags: [{ name: '日常' }] } },
    { type: 'text', nextType: null, text: '后文' },
  ];
  assert.deepEqual(normalizeProviderContent({ content: content.map(providerPart) }), { content });
  assert.throws(() => validateMixedContent({ content: [{ ...content[0], nextType: 'stats' }, ...content.slice(1)] }), /nextType/);
  assert.throws(() => validateMixedContent({ content: [content[0]] }), /nextType/);
  assert.doesNotThrow(() => validateMixedContent({ content: [
    { type: 'text', nextType: 'text', text: '第一段' }, { type: 'text', nextType: null, text: '第二段' },
  ] }));
});

test('规模、URL 和已闭合部分字段校验保留组件库语义', () => {
  const text = { type: 'text', nextType: null, text: 'a' };
  assert.throws(() => validateMixedContent({ content: Array(MAX_CONTENT_PARTS + 1).fill(text) }), ContentOutputError);
  assert.throws(() => validateMixedPart({ ...text, text: '中'.repeat(Math.ceil(MAX_CONTENT_BYTES / 3)) }), error => error.code === 'size');
  assert.throws(() => validateMixedPart({ type: 'infobox', pending: false, props: { rows: Array(101).fill({ label: 'a', value: 'b' }) } }), ContentOutputError);
  assert.doesNotThrow(() => validateMixedPart({ type: 'tags', pending: false, props: { tags: Array(101).fill({ name: 'a' }) } }));
  assert.doesNotThrow(() => validateMixedPart({ type: 'stats', pending: false, props: { mode: 'bars', entries: [{ label: 'a', value: '1', ratio: -2 }] } }));
  assert.throws(() => validateMixedPart({ type: 'links', pending: false, props: { links: [{ label: '站内', url: '/subject/1' }] } }), ContentOutputError);
  assert.deepEqual(normalizePartialComponentProps('stats', { title: '评分', headline: { value: '8', label: '均分' } }),
    { title: '评分', headline: { value: '8', label: '均分' } });
  assert.throws(() => normalizePartialComponentProps('stats', { headline: { value: '8' } }), ContentOutputError);
  assert.throws(() => normalizePartialComponentProps('stats', JSON.parse('{"__proto__":{"polluted":true}}')), ContentOutputError);
});
