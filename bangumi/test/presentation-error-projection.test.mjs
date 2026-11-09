import assert from 'node:assert/strict';
import test from 'node:test';
import { PresentationStore } from '../dist/src/output/presentation-store.js';
import { createPresentationTools, presentationToolError } from '../dist/src/output/presentation-tools.js';
import { ReplyAssembler } from '../dist/src/output/reply-assembler.js';
import { ComponentCatalogState } from '../dist/src/output/component-catalog.js';
import { ContentOutputError, MAX_CONTENT_BYTES } from '../dist/src/output/content-schema.js';
import { expandResourceContent } from '../dist/src/output/resource-content.js';
import { AppError, diagnosedError } from '../dist/src/support/errors.js';
import { createErrorDiagnostic } from '../dist/src/support/error-diagnostic.js';

const row = id => ({ entity: 'subject', id, name: `作品${id}`, subjectType: 2 });
function fixture(resolver) {
  const assembler = new ReplyAssembler(() => {}); assembler.begin('typed-errors');
  const store = new PresentationStore(resolver); store.begin();
  const catalog = new ComponentCatalogState(); catalog.readIndex({ limit: 12 }); catalog.readPrepareSpecs(['SubjectCards', 'DataTable', 'Gallery', 'QuoteBlock']);
  const tools = Object.fromEntries(createPresentationTools(store, assembler, catalog).map(tool => [tool.name, tool]));
  return { assembler, store, catalog, tools };
}

test('单详情ref不能跨成员，布局变化仍拒绝；分别用各自ref纠正后完整交付且不静默删ID', async () => {
  const sources = { rr_one: row(1), rr_two: row(2) };
  const f = fixture(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value: sources[resourceRef] }));
  for (const layout of ['grid', 'list']) {
    const bad = await f.tools.prepare_component.execute(`bad-${layout}`, { component: 'SubjectCards', resourceRef: 'rr_one', subjectIds: [1, 2], layout });
    assert.equal(bad.isError, true); assert.equal(bad.details.error.code, 'INVALID_INPUT');
    assert.equal(bad.details.error.issues[0].path, '/subjectIds'); assert.equal(bad.details.error.issues[0].rule, 'resource_membership');
    assert.match(bad.details.error.message, /改变layout不能修复/); assert.match(bad.details.error.message, /保留用户完整范围/);
    assert.equal(bad.details.error.diagnostic.reason, 'resource_reference_invalid');
    assert.deepEqual(f.assembler.snapshot().content, []);
  }
  for (const [id, resourceRef] of [[1, 'rr_one'], [2, 'rr_two']]) {
    const prepared = await f.tools.prepare_component.execute(`prepare-${id}`, { component: 'SubjectCards', resourceRef, subjectIds: [id] });
    assert.equal(prepared.isError, undefined);
    const published = await f.tools.present_component.execute(`present-${id}`, { resourceRef: prepared.details.resourceRef, blockIndex: 0 });
    assert.equal(published.isError, undefined);
  }
  assert.deepEqual(f.assembler.snapshot().content.flatMap(part => part.props.items.map(item => item.id)), [1, 2]);
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: 'rr_one', items: [{ subjectId: 2 }] }, async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value: row(1) })), error =>
    error.reason === 'resource_reference_invalid' && error.issueDetails[0].rule === 'resource_membership');
  const gallery = fixture(async resourceRef => ({ resourceRef, sourceTool: 'get_person_details', value: { entity: 'person', id: 1, name: '人物' } }));
  const wrongMember = await gallery.tools.prepare_component.execute('wrong-member', { component: 'Gallery', resourceRef: 'rr_person', members: [{ personId: 2 }] });
  assert.equal(wrongMember.details.error.code, 'INVALID_INPUT'); assert.equal(wrongMember.details.error.issues[0].path, '/members');
});

test('fields/columns互斥在缓存前明确拒绝，任一方式合法且旧renderer reason保留', async () => {
  let reads = 0;
  const resolver = async resourceRef => { reads++; return { resourceRef, sourceTool: 'get_subject_details', value: row(1) }; };
  const f = fixture(resolver), base = { component: 'DataTable', resourceRef: 'rr_one', subjectIds: [1] };
  const columns = [{ key: 'name', label: '作品名' }];
  const bad = await f.tools.prepare_component.execute('both', { ...base, fields: ['name'], columns });
  assert.equal(bad.isError, true); assert.equal(bad.details.error.code, 'INVALID_INPUT');
  assert.deepEqual(bad.details.error.issues.map(issue => issue.path), ['/fields', '/columns']); assert.equal(reads, 0);
  assert.match(f.catalog.readPrepareSpecs(['DataTable']).specs[0].constraints.join(' '), /fields与columns只能选择一种/);
  for (const options of [{ fields: ['name'] }, { columns }]) {
    const prepared = await f.tools.prepare_component.execute('single-' + reads, { ...base, ...options });
    assert.equal(prepared.isError, undefined); assert.equal((await f.store.block(prepared.details.resourceRef, 0)).props.rows[0].name, '作品1');
  }
  await assert.rejects(expandResourceContent('DataTable', { resourceRef: 'rr_one', fields: ['name'], columns }, resolver), error =>
    error.reason === 'resource_reference_invalid' && error.issueDetails.some(issue => issue.rule === 'mutually_exclusive' && issue.path === '/props/fields'));
});

test('Schema/字节错误保持严格拒绝及准确分类，未知字段路径不回显用户键', async () => {
  const f = fixture(async resourceRef => ({ resourceRef, sourceTool: 'get_subject_details', value: { ...row(1), name: 1 } }));
  const missingFacts = await f.tools.prepare_component.execute('missing-facts', { component: 'SubjectCards', resourceRef: 'rr_one', subjectIds: [1] });
  assert.equal(missingFacts.isError, true); assert.equal(missingFacts.details.error.code, 'CANDIDATE_REQUIRED_FACTS_MISSING');
  const invalidSnapshot = fixture(async resourceRef => ({ resourceRef, sourceTool: 'prepare_candidate_output', value: { presentation: { content: [
    { type: 'SubjectCards', pending: false, props: { layout: 'grid', items: [{ id: 1, name: 1, kind: 'anime' }] } },
  ] } } }));
  const bad = await invalidSnapshot.tools.present_component.execute('bad-schema', { resourceRef: 'rr_invalid_snapshot', blockIndex: 0 });
  assert.equal(bad.isError, true); assert.equal(bad.details.error.code, 'CONTENT_SCHEMA_INVALID');
  assert.ok(bad.details.error.diagnostic.issues.some(issue => issue.path === '/props/items/0/name'));
  assert.match(bad.details.error.message, /严格展示契约/); assert.deepEqual(f.assembler.snapshot().content, []);
  const oversized = await f.tools.prepare_component.execute('oversized', { component: 'QuoteBlock', text: '大'.repeat(MAX_CONTENT_BYTES), mono: false });
  assert.equal(oversized.isError, true); assert.equal(oversized.details.error.code, 'CONTENT_LIMIT_EXCEEDED');
  assert.match(oversized.details.error.message, /固定字节或块容量/); assert.deepEqual(f.assembler.snapshot().content, []);
  const hidden = presentationToolError(new ContentOutputError('不能显示未知字段和值', 'schema', [], [{ path: '/props/items/0/private-user-key', rule: 'additionalProperties', message: 'private-user-value' }]), 'prepare_component', { component: 'SubjectCards' });
  assert.equal(hidden.diagnostic.issues[0].path, '/props/items/0/<field>'); assert.equal(JSON.stringify(hidden).includes('private-user-key'), false); assert.equal(JSON.stringify(hidden).includes('private-user-value'), false);
});

test('缓存权限/业务diagnostic及cause优先原分类，不转为可纠正成员参数', async () => {
  const diagnostic = createErrorDiagnostic({ code: 'PERMISSION_DENIED', origin: 'domain', stage: 'access', recovery: 'inspect_permissions' });
  const denied = diagnosedError(new AppError('PERMISSION_DENIED', '缓存访问被拒绝'), diagnostic);
  const f = fixture(async () => { throw denied; });
  const blocked = await f.tools.prepare_component.execute('blocked', { component: 'SubjectCards', resourceRef: 'rr_one', subjectIds: [1] });
  assert.equal(blocked.isError, true); assert.equal(blocked.details.error.code, 'PERMISSION_DENIED'); assert.equal(blocked.details.error.diagnostic.recovery, 'inspect_permissions');
  for (const wrapped of [
    new ContentOutputError('缓存访问失败', 'schema', [], [{ path: '/props/items', rule: 'resource_membership', message: '不得覆盖权限原因' }], 'resource_reference_access_denied', { diagnostic, cause: denied }),
    new ContentOutputError('来源业务错误', 'schema', [], [], 'resource_reference_invalid', { cause: new AppError('CANDIDATE_STAGE_INCOMPLETE', '阶段未完成') }),
  ]) {
    const projected = presentationToolError(wrapped, 'prepare_component', { component: 'SubjectCards', subjectIds: [1] });
    assert.equal(projected.code, wrapped.diagnostic?.code ?? wrapped.cause.code); assert.notEqual(projected.code, 'INVALID_INPUT');
  }
  assert.deepEqual(f.assembler.snapshot().content, []);
});
