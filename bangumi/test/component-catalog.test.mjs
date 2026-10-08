import test from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { componentIndex, createComponentCatalogState, bindComponentCatalog, componentCatalogFor, validateLoadedComponents,
  providerSchemaForComponents, strictProviderSchema, COMPONENT_CATALOG_VERSION } from '../dist/src/output/component-catalog.js';
import { createComponentReadTools } from '../dist/src/output/component-tools.js';
import { COMPONENT_KINDS, COMPONENT_PAYLOAD_SCHEMAS, CONTENT_OUTPUT_SYSTEM_MARKER, validateMixedPart } from '../dist/src/output/content-schema.js';
import { resourceReferenceSchema } from '../dist/src/output/resource-content.js';
import { CONTENT_OUTPUT_INSTRUCTION, normalizeProviderContent } from '../dist/src/output/provider-content.js';
import { withContentConstraint, supportsStrictContentSchema } from '../dist/src/output/provider-options.js';
const readResult = (toolName, value) => ({ role: 'toolResult', toolName, content: [{ type: 'text', text: JSON.stringify(value) }] });

test('组件索引支持中文用途及分类，分页完整遍历且不返回字段', () => {
  assert.deepEqual(componentIndex({ query: '评分' }).entries.map(entry => entry.name), ['StatsCard']);
  assert.ok(componentIndex({ query: '作品推荐' }).entries.some(entry => entry.name === 'SubjectCards'));
  assert.ok(componentIndex({ query: '评分高了吗' }).entries.some(entry => entry.name === 'StatsCard'));
  assert.deepEqual(componentIndex({ category: '作品' }).entries.map(entry => entry.name), ['SubjectCards']);
  const names = []; let offset = 0;
  do { const page = componentIndex({ offset, limit: 3 }); names.push(...page.entries.map(entry => entry.name)); offset = page.nextOffset;
    assert.ok(page.entries.every(entry => !Object.hasOwn(entry, 'props') && !Object.hasOwn(entry, 'required'))); } while (offset !== null);
  assert.deepEqual(names, COMPONENT_KINDS);
  assert.throws(() => componentIndex({ limit: 13 }), /limit/);
});

test('首次必须按已读目录读取契约，失败原子化，轮次重置不伪装契约新读取', () => {
  const state = createComponentCatalogState();
  assert.throws(() => state.readSpecs(['SubjectCards']), error => error.code === 'COMPONENT_INDEX_REQUIRED');
  state.readIndex({ category: '作品' });
  assert.throws(() => state.readSpecs(['SubjectCards', 'StatsCard']), error => error.code === 'COMPONENT_NOT_DISCOVERED');
  assert.deepEqual(state.currentAudit().loaded, []);
  state.readSpecs(['SubjectCards']);
  assert.equal(validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { layout: 'grid', items: [] } }] }, state).content.length, 1);
  assert.throws(() => validateLoadedComponents({ content: [{ type: 'StatsCard' }] }, state), error => error.reason === 'component_spec_required');
  state.reset();
  assert.equal(state.currentAudit().turn, 1);
  assert.deepEqual(state.currentAudit().loaded, ['SubjectCards']);
  assert.equal(state.currentAudit().indexReads, 0);
  assert.equal(state.currentAudit().specReads, 0);
  assert.deepEqual(state.currentAudit().contracts.SubjectCards, { selectionId: 1, sourceTurn: 0, reused: true });
  state.reconcile({ messages: [] });
  assert.deepEqual(state.currentAudit().loaded, []);
  assert.throws(() => state.readSpecs(['SubjectCards']), error => error.code === 'COMPONENT_INDEX_REQUIRED');
  assert.doesNotThrow(() => validateLoadedComponents({ content: [{ type: 'text' }] }, state));
});

test('字段和引用契约直接来自实际Schema，返回值不共享源对象并支持批读', () => {
  const state = createComponentCatalogState(); state.readIndex({ limit: 12 });
  const result = state.readSpecs(['SubjectCards', 'TagCloud', 'DataTable']);
  assert.equal(result.version, COMPONENT_CATALOG_VERSION);
  assert.deepEqual(result.audit.loaded, ['SubjectCards', 'TagCloud', 'DataTable']);
  for (const spec of result.specs) {
    assert.deepEqual(spec.props, COMPONENT_PAYLOAD_SCHEMAS[spec.name]);
    assert.equal(spec.representation, 'inline');
    assert.equal(spec.referenceProps, undefined);
    assert.deepEqual(spec.required, COMPONENT_PAYLOAD_SCHEMAS[spec.name].required ?? []);
    assert.ok(Array.isArray(spec.envelopeExample.content));
  }
  result.specs[0].props.required.push('wrong');
  assert.equal(COMPONENT_PAYLOAD_SCHEMAS.SubjectCards.required.includes('wrong'), false);
});

test('系统规则不携带全量字段且明确禁止裸组件根及空白正文', () => {
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes('read_component_index'));
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes('read_component_spec'));
  assert.equal(CONTENT_OUTPUT_INSTRUCTION.includes(JSON.stringify(COMPONENT_PAYLOAD_SCHEMAS.SubjectCards)), false);
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes('不要用裸组件对象'));
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes('全空白'));
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.length < 3000);
});

test('工具读取按顺序登记状态，失败返回内部错误而不填正文组件', async () => {
  const state = createComponentCatalogState(); const [index, spec] = createComponentReadTools(state);
  const failed = await spec.execute('1', { names: ['SubjectCards'] });
  assert.equal(failed.isError, true);
  assert.equal(failed.details.error.code, 'COMPONENT_INDEX_REQUIRED');
  const page = await index.execute('2', { query: '作品' });
  assert.equal(page.details.entries[0].name, 'SubjectCards');
  const fields = await spec.execute('3', { names: ['SubjectCards'] });
  assert.deepEqual(fields.details.audit.loaded, ['SubjectCards']);
  assert.throws(() => index.prepareArguments({ unknown: 1 }));
});

test('按需生成契约只包含text及所选组件，严格转换对动态行保守回退', () => {
  const schema = providerSchemaForComponents(['SubjectCards']);
  const ajv = new Ajv({ strict: true }); const check = ajv.compile(schema);
  assert.equal(check({ content: [{ type: 'text', text: '说明' }] }), true);
  assert.equal(check({ content: [{ type: 'SubjectCards', props: { layout: 'grid', items: [] } }] }), true);
  assert.equal(check({ content: [{ type: 'StatsCard', props: { mode: 'list', entries: [] } }] }), false);
  assert.equal(check({ type: 'SubjectCards', props: { layout: 'grid', items: [] } }), false);
  assert.equal(check({ content: [], wrong: true }), false);
  const strict = strictProviderSchema(schema);
  assert.ok(strict);
  const props = strict.properties.content.items.anyOf[1].properties.props;
  assert.deepEqual(props.required, Object.keys(props.properties));
  assert.deepEqual(props.properties.title.anyOf.at(-1), { type: 'null' });
  assert.equal(strictProviderSchema(providerSchemaForComponents(['DataTable'])), undefined);
});

test('压缩后遗失字段失效，旧版本或被精简的字段结果不冒充可读契约', () => {
  const state = createComponentCatalogState();
  const index = state.readIndex({ limit: 12 }); const fields = state.readSpecs(['SubjectCards']);
  const context = { messages: [readResult('read_component_index', index), readResult('read_component_spec', fields)] };
  bindComponentCatalog(context, state); assert.deepEqual(state.currentAudit().loaded, ['SubjectCards']);
  state.reconcile({ messages: [context.messages[0]] });
  assert.deepEqual(state.currentAudit().loaded, []);
  const reread = state.readSpecs(['SubjectCards']);
  // 重新读取后旧selectionId已被替代，恢复可见状态必须含最新完整工具结果。
  state.reconcile(context); assert.deepEqual(state.currentAudit().loaded, []);
  context.messages.push(readResult('read_component_spec', reread));
  state.reconcile({ messages: [] });
  assert.deepEqual(state.currentAudit().discovered, []);
  assert.throws(() => state.readSpecs(['SubjectCards']), error => error.code === 'COMPONENT_INDEX_REQUIRED');
  state.reconcile(context); assert.deepEqual(state.currentAudit().loaded, ['SubjectCards']);
  const trimmed = structuredClone(reread); delete trimmed.specs[0].props.properties.layout;
  state.reconcile({ messages: [readResult('read_component_spec', trimmed)] }); assert.deepEqual(state.currentAudit().loaded, []);
  const oldVersion = structuredClone(reread); oldVersion.version = 'old_version';
  state.reconcile({ messages: [readResult('read_component_spec', oldVersion)] }); assert.deepEqual(state.currentAudit().loaded, []);
  state.reset(); state.reconcile(context); assert.deepEqual(state.currentAudit().loaded, ['SubjectCards']);
});

test('同版本完整契约跨用户轮复用但旧事实引用拒绝，显式样式切换使用单调选择序号', () => {
  const state = createComponentCatalogState(), current = new Set(['rr_old']);
  state.setReferenceValidator(ref => current.has(ref));
  const index = state.readIndex({ limit: 12 }), original = state.readSpecs(['SubjectCards'], 'reference');
  const context = { messages: [{ role: 'user', content: '首次查作品' }, readResult('read_component_index', index), readResult('read_component_spec', original)] };
  bindComponentCatalog(context, state);
  state.observeResource({ entity: 'subject', resourceRef: 'rr_old' }, 'get_subject_details');
  assert.doesNotThrow(() => validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { resourceRef: 'rr_old' } }] }, state));
  state.reset(); current.clear(); current.add('rr_new'); context.messages.push({ role: 'user', content: '只保留其中一部' });
  bindComponentCatalog(context, state);
  assert.deepEqual(state.currentAudit().loaded, ['SubjectCards']);
  assert.deepEqual(state.currentAudit().contracts.SubjectCards, { selectionId: original.specs[0].selectionId, sourceTurn: 0, reused: true });
  assert.equal(state.currentAudit().indexReads, 0); assert.equal(state.currentAudit().specReads, 0);
  assert.doesNotThrow(() => validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { resourceRef: 'rr_new' } }] }, state));
  assert.throws(() => validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { resourceRef: 'rr_old' } }] }, state), error => error.reason === 'resource_reference_refresh_required');
  // 未重新读索引也可用可见目录明确切换；选择ID不能在新轮退回1。
  const changed = state.readSpecs(['SubjectCards'], 'inline');
  assert.ok(changed.specs[0].selectionId > original.specs[0].selectionId);
  context.messages.push(readResult('read_component_spec', changed)); bindComponentCatalog(context, state);
  assert.equal(state.currentAudit().representations.SubjectCards, 'inline');
  assert.equal(state.currentAudit().contracts.SubjectCards.reused, false);
  assert.throws(() => validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { resourceRef: 'rr_new' } }] }, state), error => error.reason === 'component_representation_invalid');
  state.reconcile({ messages: context.messages.slice(0, 3) }); assert.deepEqual(state.currentAudit().loaded, []);
  const freshSession = createComponentCatalogState(); bindComponentCatalog(context, freshSession);
  assert.deepEqual(freshSession.currentAudit().loaded, []);
  assert.throws(() => freshSession.readSpecs(['SubjectCards']), error => error.code === 'COMPONENT_INDEX_REQUIRED');
});

test('auto按适用缓存来源为各组件选择唯一props，创作文字保持inline，旧轮事实不用于选择', () => {
  const state = createComponentCatalogState();
  const context = { messages: [{ role: 'user', content: '查询作品' },
    readResult('get_subject_details', { value: { entity: 'subject', id: 1, resourceRef: 'rr_current', availableFields: ['name', 'ratingDistribution'] } }),
    readResult('read_component_index', state.readIndex({ limit: 12 }))] };
  bindComponentCatalog(context, state);
  const result = state.readSpecs(['SubjectCards', 'StatsCard', 'Callout', 'QuoteBlock']);
  assert.deepEqual(result.specs.map(spec => spec.representation), ['reference', 'reference', 'inline', 'inline']);
  for (const spec of result.specs) {
    assert.deepEqual(spec.props, spec.representation === 'reference' ? resourceReferenceSchema(spec.name) : COMPONENT_PAYLOAD_SCHEMAS[spec.name]);
    assert.equal(spec.props.anyOf, undefined);
    assert.equal(spec.referenceProps, undefined);
    assert.equal(spec.canonicalContract.includes('不是本次生成props字段'), true);
  }
  const newer = { messages: [...context.messages, { role: 'user', content: '新的任务' }] };
  state.reset();
  newer.messages.push(readResult('read_component_index', state.readIndex({ limit: 12 })));
  state.reconcile(newer);
  assert.equal(state.readSpecs(['SubjectCards']).specs[0].representation, 'inline');
});

test('同批成功只读结果可在字段读取前登记适用引用，未知或无引用不伪造引用能力', () => {
  const state = createComponentCatalogState(); state.readIndex({ limit: 12 });
  state.observeResource({ entity: 'subject', id: 1 }, 'get_subject_details');
  assert.equal(state.readSpecs(['SubjectCards']).specs[0].representation, 'inline');
  const current = new Set(['rr_valid', 'rr_prepared']); state.setReferenceValidator(ref => current.has(ref));
  state.observeResource({ value: { entity: 'subject', id: 1, resourceRef: 'rr_valid' } }, 'get_subject_details');
  assert.equal(state.readSpecs(['SubjectCards']).specs[0].representation, 'reference');
  state.observeResource({ resourceRef: 'rr_prepared', format: 'table' }, 'prepare_candidate_output');
  assert.equal(state.readSpecs(['DataTable']).specs[0].representation, 'reference');
  assert.equal(state.readSpecs(['Callout']).specs[0].representation, 'inline');
  // 当前引用仍有效，即使同批结果尚未进入context，bind不会丢失已验证引用种类。
  state.reconcile({ messages: [readResult('read_component_index', state.readIndex({ limit: 12 }))] });
  assert.equal(state.readSpecs(['SubjectCards']).specs[0].representation, 'reference');
  current.clear(); state.reconcile({ messages: [readResult('read_component_index', state.readIndex({ limit: 12 }))] });
  assert.equal(state.readSpecs(['SubjectCards']).specs[0].representation, 'inline');
});

test('引用形式严格拒绝混填inline字段，显式切换后新契约取代旧说明而不改变内部Schema', () => {
  const state = createComponentCatalogState(); const index = state.readIndex({ limit: 12 });
  const ref = state.readSpecs(['SubjectCards'], 'reference');
  const context = { messages: [readResult('read_component_index', index), readResult('read_component_spec', ref)] };
  bindComponentCatalog(context, state);
  const reference = { type: 'SubjectCards', props: { resourceRef: 'rr_actual', items: [{ id: 1 }], title: '作品', layout: 'grid' } };
  assert.doesNotThrow(() => validateLoadedComponents({ content: [reference] }, state));
  for (const extra of [{ total: 1 }, { hint: '全12集' }, { items: [{ id: 1, name: '作品' }] }]) {
    assert.throws(() => validateLoadedComponents({ content: [{ ...reference, props: { ...reference.props, ...extra } }] }, state), error => error.reason === 'component_representation_invalid');
  }
  const check = new Ajv({ strict: true }).compile(providerSchemaForComponents(['SubjectCards'], state.currentAudit().representations));
  assert.equal(check({ content: [reference] }), true);
  assert.equal(check({ content: [{ ...reference, props: { ...reference.props, total: 1 } }] }), false);
  assert.equal(check({ content: [{ type: 'SubjectCards', props: { layout: 'grid', items: [] } }] }), false);
  const inline = state.readSpecs(['SubjectCards'], 'inline');
  context.messages.push(readResult('read_component_spec', inline)); bindComponentCatalog(context, state);
  assert.equal(state.currentAudit().representations.SubjectCards, 'inline');
  assert.doesNotThrow(() => validateLoadedComponents({ content: [{ type: 'SubjectCards', props: { layout: 'grid', items: [], total: 1, hint: '说明' } }] }, state));
  assert.throws(() => validateLoadedComponents({ content: [reference] }, state), error => error.reason === 'component_representation_invalid');
  state.reconcile({ messages: context.messages.slice(0, 2) });
  assert.deepEqual(state.currentAudit().loaded, []);
  assert.equal(COMPONENT_PAYLOAD_SCHEMAS.SubjectCards.properties.total.type, 'number');
  assert.equal(resourceReferenceSchema('SubjectCards').properties.total, undefined);
});

test('引用表格可转严格生成Schema，inline动态对象行仍保守回退；未支持事实通过正文交付', () => {
  assert.ok(strictProviderSchema(providerSchemaForComponents(['DataTable'], { DataTable: 'reference' })));
  assert.equal(strictProviderSchema(providerSchemaForComponents(['DataTable'], { DataTable: 'inline' })), undefined);
  const state = createComponentCatalogState(); state.readIndex({ limit: 12 });
  const spec = state.readSpecs(['SubjectCards'], 'reference').specs[0];
  assert.ok(spec.requestedFacts.includes('总集数'));
  assert.ok(spec.requestedFacts.includes('text'));
  assert.ok(CONTENT_OUTPUT_INSTRUCTION.includes('保留尚未交付的用户事实要求'));
  assert.equal(spec.props.properties.total, undefined);
  assert.equal(spec.props.properties.hint, undefined);
  assert.throws(() => state.readSpecs(['SubjectCards'], 'unknown'), error => error.code === 'INVALID_INPUT');
});

test('严格正文生成的可选null只在provider边界投影，内部契约仍拒绝非法字段', () => {
  const answer = normalizeProviderContent({ content: [{ type: 'SubjectCards', props: { layout: 'grid', title: null,
    items: [{ id: 1, name: '作品', kind: 'anime', score: null }] } }] });
  assert.deepEqual(answer.content[0].props, { layout: 'grid', items: [{ id: 1, name: '作品', kind: 'anime' }] });
  assert.throws(() => normalizeProviderContent({ content: [{ type: 'SubjectCards', props: { items: [], layout: null } }] }));
  assert.throws(() => normalizeProviderContent({ content: [{ type: 'SubjectCards', props: { items: [], layout: 'grid', secret: null } }] }));
  assert.throws(() => validateMixedPart({ type: 'SubjectCards', pending: false, props: { items: [], layout: 'grid', title: null } }));
});

test('已知官方提供方按轮生成strict正文Schema，兼容端点不被假定支持', async () => {
  const model = { api: 'openai-responses', provider: 'openai', id: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' };
  const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_SYSTEM_MARKER, timestamp: 1 }] };
  const state = createComponentCatalogState(); bindComponentCatalog(context, state);
  assert.equal(componentCatalogFor({ messages: context.messages }), state);
  let payload = await withContentConstraint(model, context, {}).onPayload({}, model);
  assert.equal(payload.text.format.type, 'json_schema');
  assert.deepEqual(payload.text.format.schema.properties.content.items.anyOf.map(branch => branch.properties.type.enum[0]), ['text']);
  const index = state.readIndex({ query: '作品' }), fields = state.readSpecs(['SubjectCards']);
  context.messages.push(readResult('read_component_index', index), readResult('read_component_spec', fields)); bindComponentCatalog(context, state);
  payload = await withContentConstraint(model, context, {}).onPayload({}, model);
  assert.deepEqual(payload.text.format.schema.properties.content.items.anyOf.map(branch => branch.properties.type.enum[0]), ['text', 'SubjectCards']);
  for (const alternate of [{ ...model, provider: 'deepseek' }, { ...model, baseUrl: 'https://compat.example/v1' }, { ...model, id: 'gpt-4o-2024-05-13' }]) {
    assert.equal(supportsStrictContentSchema(alternate), false);
    const result = await withContentConstraint(alternate, context, {}).onPayload({}, alternate);
    assert.deepEqual(result.text.format, { type: 'json_object' });
  }
  context.messages.push(readResult('read_component_index', state.readIndex({ query: '按列' })), readResult('read_component_spec', state.readSpecs(['DataTable']))); bindComponentCatalog(context, state);
  assert.deepEqual((await withContentConstraint(model, context, {}).onPayload({}, model)).text.format, { type: 'json_object' });
});

test('Chat strict正文和回调替换均保留按需约束且隔离副本', async () => {
  const model = { api: 'openai-completions', provider: 'openai', id: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };
  const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_SYSTEM_MARKER, timestamp: 1 }] };
  const state = createComponentCatalogState();
  context.messages.push(readResult('read_component_index', state.readIndex({ query: '评分' })), readResult('read_component_spec', state.readSpecs(['StatsCard']))); bindComponentCatalog(context, state);
  const source = { tools: [{ name: 'read' }], reasoning_effort: 'high' };
  const options = withContentConstraint(model, context, { onPayload: value => ({ ...value, response_format: { type: 'text' } }) });
  const result = await options.onPayload(source, model);
  assert.equal(result.response_format.type, 'json_schema');
  assert.equal(result.response_format.json_schema.strict, true);
  assert.deepEqual(result.tools, source.tools);
  assert.equal(result.reasoning_effort, 'high');
  assert.equal(source.response_format, undefined);
});

test('DeepSeek仅官方Responses已声明模型启用按需json_schema，Chat及兼容域名仍回退', async () => {
  const context = { messages: [{ role: 'system', content: CONTENT_OUTPUT_SYSTEM_MARKER, timestamp: 1 }] };
  const state = createComponentCatalogState();
  context.messages.push(readResult('read_component_index', state.readIndex({ query: '评分' })), readResult('read_component_spec', state.readSpecs(['StatsCard'])));
  bindComponentCatalog(context, state);
  const base = { api: 'openai-responses', provider: 'deepseek', id: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
  for (const id of ['deepseek-flash', 'deepseek-v4-pro']) {
    const model = { ...base, id };
    const result = await withContentConstraint(model, context, {}).onPayload({ tools: [{ name: 'read' }], reasoning: { effort: 'high' },
      input: [{ role: 'developer', content: '宿主规则' }, { role: 'user', content: '用户请求' }, { type: 'function_call', call_id: 'c1', name: 'read', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: '工具数据' }] }, model);
    assert.equal(result.text.format.type, 'json_schema');
    assert.equal(result.text.format.strict, undefined);
    assert.deepEqual(result.text.format.schema.properties.content.items.anyOf.map(branch => branch.properties.type.enum[0]), ['text', 'StatsCard']);
    assert.deepEqual(result.reasoning, { effort: 'high' });
    assert.deepEqual(result.tools, [{ name: 'read' }]);
    assert.deepEqual(result.input.map(item => item.role ?? item.type), ['system', 'user', 'function_call', 'function_call_output']);
    assert.equal(result.input[2].call_id, result.input[3].call_id);
  }
  for (const alternate of [{ ...base, api: 'openai-completions' }, { ...base, baseUrl: 'https://api.deepseek.com/beta' },
    { ...base, baseUrl: 'https://compat.example/v1' }, { ...base, id: 'deepseek-chat' }]) {
    assert.equal(supportsStrictContentSchema(alternate), false);
    const result = await withContentConstraint(alternate, context, {}).onPayload({}, alternate);
    assert.deepEqual(alternate.api === 'openai-completions' ? result.response_format : result.text.format, { type: 'json_object' });
  }
  context.messages.push(readResult('read_component_index', state.readIndex({ query: '按列' })), readResult('read_component_spec', state.readSpecs(['DataTable'])));
  bindComponentCatalog(context, state);
  assert.deepEqual((await withContentConstraint(base, context, {}).onPayload({}, base)).text.format, { type: 'json_object' });
});
