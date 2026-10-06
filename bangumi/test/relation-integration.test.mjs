import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';

const account = { id: 42, username: 'fixture_user' };
const subject = (id, form = 'TV') => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`,
  platform: form, meta_tags: [form], nsfw: false, date: '2026-04-01',
  rating: { score: 8, total: 100 }, tags: [], eps: 12 });
function fixture(parentCount = 917, relationCount = 231) {
  const parents = Array.from({ length: parentCount }, (_, i) => subject(i + 1, i % 2 ? 'OVA' : 'TV'));
  const calls = [];
  const context = { mode: 'account', account, source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString(),
    nsfw: { state: 'not_checked', allowed: null, preference: null } };
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => structuredClone(context), currentUser: async () => account,
    account: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/p1/collections/subjects') {
        const { offset, limit } = options.query;
        return { data: parents.slice(offset, offset + limit).map(row => ({ ...row,
          interest: { type: 2, rate: 8, tags: [], private: false, epStatus: 12 } })), total: parents.length, offset, limit };
      }
      throw Error(`不应读取私有单项 ${path}`);
    },
    public: async (path, options = {}) => {
      calls.push({ path, options });
      const relation = /^\/v0\/subjects\/(\d+)\/subjects$/.exec(path);
      if (relation) return Array.from({ length: relationCount }, (_, i) => ({ ...subject(1000 + i, 'OVA'), relation: '番外篇' }));
      throw Error(`不应补读详情 ${path}`);
    },
  });
  const invoke = async (name, args) => {
    const result = await service.call(name, args, undefined, undefined, undefined, { turnId: 'relation-integration' });
    checkAccessResponse(name, result); return result;
  };
  return { service, calls, invoke };
}

test('真实服务全917父筛选不止首100；关联在宿主去重并复用完整看过范围排除', async t => {
  const f = fixture(917, 3); t.after(() => f.service.close());
  const recalled = await f.invoke('query_user_collections', { username: '-', subject_type: 2, collection_type: 2,
    result_mode: 'candidates', source_limit: 10000, response_view: 'reference', fields: ['id'] });
  assert.equal(recalled.stage.inputCount, 917); assert.equal(recalled.stage.processedCount, 917);
  assert.equal(recalled.coverage.complete, true); assert.deepEqual(recalled.data, []);
  const expanded = await f.invoke('expand_subject_relations', { candidate_ref: recalled.resultRef,
    parent_filter: { subject_form: ['tv'] }, filter: { subject_type: 2, exclude_collection_types: [2] },
    collection_ref: recalled.collectionRef, response_view: 'reference', fields: ['id'], source_limit: 10000 });
  assert.equal(expanded.relationStage.parentInputCount, 917);
  assert.equal(expanded.relationStage.parentMatchedCount, 459);
  assert.equal(expanded.relationStage.relationParentsProcessedCount, 459);
  assert.equal(expanded.relationStage.relationScannedCount, 1377);
  assert.equal(expanded.relationStage.childCount, 3);
  assert.equal(expanded.stage.matchedCount, 3); assert.equal(expanded.coverage.complete, true);
  assert.deepEqual(expanded.data, []); assert.deepEqual(expanded.lineage, []);
  assert.equal(f.calls.filter(row => row.path.endsWith('/subjects') && row.path.startsWith('/v0/subjects/')).length, 459);
  assert.ok(!Object.hasOwn(expanded.coverage, 'sources'));
  assert.ok(JSON.stringify(expanded.coverage).length < 1600);
  const lineage = await f.invoke('get_candidate_lineage', { candidate_ref: expanded.resultRef, subject_ids: [1000] });
  assert.equal(lineage.data[0].parentCount, 459);
  assert.equal(lineage.data[0].parents.at(-1).parentId, 917);
  assert.equal(lineage.data[0].parents[0].name, '作品1');
});

test('关系来源窗口续页不重复HTTP，reference完成后resultRef分页取得全部231子项', async t => {
  const f = fixture(1, 231); t.after(() => f.service.close());
  const recalled = await f.invoke('query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const args = { candidate_ref: recalled.resultRef, filter: { subject_type: 2 }, fields: ['id'],
    response_view: 'reference', source_limit: 60 };
  let result = await f.invoke('expand_subject_relations', args), calls = 1;
  while (result.page.nextCursor) {
    result = await f.invoke('expand_subject_relations', { ...args, candidate_ref: result.candidateRef, cursor: result.page.nextCursor });
    calls++; assert.ok(calls < 10);
  }
  assert.equal(result.stage.matchedCount, 231); assert.equal(result.coverage.complete, true);
  assert.equal(f.calls.filter(row => row.path === '/v0/subjects/1/subjects').length, 1);
  let page = await f.invoke('refine_subject_candidates', { candidate_ref: result.resultRef, fields: ['id'], limit: 100 });
  const all = [...page.data];
  while (page.page.nextCursor) {
    page = await f.invoke('refine_subject_candidates', { candidate_ref: page.candidateRef,
      cursor: page.page.nextCursor, fields: ['id'], limit: 100 }); all.push(...page.data);
  }
  assert.deepEqual(all.map(row => row.id), Array.from({ length: 231 }, (_, i) => 1000 + i));
  const detail = await f.invoke('get_candidate_coverage', { coverage_ref: result.coverage.coverageRef, limit: 100 });
  assert.ok(detail.sources.some(row => row.tool === 'get_subject_relations' && row.scannedCount === 231 && row.complete));
  await f.service.endReadContext('relation-integration');
  await assert.rejects(f.invoke('get_candidate_lineage', { candidate_ref: result.resultRef }), error => error.code === 'CANDIDATE_REF_EXPIRED');
});

function permissionFixture({ allowed = true, protectedParent = false, emptyWishScope = false, relationFailure = false } = {}) {
  let permissionAllowed = allowed, permissionChecks = 0;
  const calls = [], children = [subject(100, 'OVA'), { ...subject(101, 'OVA'), nsfw: true }, subject(102, 'OVA')];
  const identity = () => ({ mode: 'account', account, source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString(),
    nsfw: { state: 'not_checked', allowed: null, preference: null } });
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => account,
    ensureNsfw: async context => {
      permissionChecks++; return { ...context, nsfw: { state: permissionAllowed ? 'enabled' : 'disabled', allowed: permissionAllowed, preference: permissionAllowed },
        nsfwApplied: permissionAllowed };
    },
    account: async (path, options = {}) => {
      calls.push({ path, options }); assert.equal(options.expectedAccountId, account.id);
      if (path === '/p1/collections/subjects') {
        const wish = options.query.type === 1;
        return { data: wish && emptyWishScope ? [] : [{ ...subject(1), nsfw: protectedParent,
          interest: { type: wish ? 1 : 2, rate: 8, tags: [], private: false, epStatus: 12 } }], total: wish && emptyWishScope ? 0 : 1 };
      }
      if (path === '/p1/subjects/1/relations') {
        if (relationFailure) {
          const { AppError } = await import('../dist/src/support/errors.js');
          throw new AppError(typeof relationFailure === 'string' ? relationFailure : 'BGM_HTTP_503', 'fixture p1关系失败');
        }
        return { data: children.map((value, index) => ({ id: index + 1, subject: value, relation: { cn: '番外篇' } })), total: children.length };
      }
      throw Error(`不应补读其他账户数据 ${path}`);
    },
    public: async path => {
      calls.push({ path }); if (path === '/v0/subjects/1/subjects') return protectedParent ? [children[0], children[2]] : children;
      throw Error(`不应补读其他公共数据 ${path}`);
    },
  });
  const invoke = async (name, args) => {
    const result = await service.call(name, args, undefined, undefined, undefined, { turnId: 'relation-permission-integration' });
    checkAccessResponse(name, result); return result;
  };
  return { service, invoke, calls, get permissionChecks() { return permissionChecks; }, disable: () => { permissionAllowed = false; } };
}

for (const allowed of [true, false]) test(`完整raw统一权限后source_limit1跨NSFW中间页，${allowed ? '允许' : '不允许'}NSFW均保留两侧SFW`, async t => {
  const f = permissionFixture({ allowed }); t.after(() => f.service.close());
  const parents = await f.invoke('query_user_collections', { username: '-', subject_type: 2, collection_type: 2,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const args = { candidate_ref: parents.resultRef, filter: { nsfw: 'account' }, fields: ['id'], response_view: 'reference', source_limit: 1 };
  let result = await f.invoke('expand_subject_relations', args), requests = 1;
  while (result.page.nextCursor) {
    assert.deepEqual(result.account, account); assert.equal(result.accessContext.account.id, account.id);
    result = await f.invoke('expand_subject_relations', { ...args, candidate_ref: result.candidateRef, cursor: result.page.nextCursor });
    requests++; assert.ok(requests <= 4, '每个原始关系窗口只能前进一次，不能原地重复读取');
  }
  assert.equal(requests, 3); assert.equal(result.relationStage.relationScannedCount, 3);
  assert.equal(result.relationStage.failedParentCount, 0); assert.equal(result.stage.matchedCount, allowed ? 3 : 2);
  assert.equal(result.relationStage.relationSourceComplete, allowed); assert.equal(result.coverage.complete, allowed);
  const shown = await f.invoke('refine_subject_candidates', { candidate_ref: result.resultRef, fields: ['id', 'name'], limit: 100 });
  assert.deepEqual(shown.data.map(row => row.id), allowed ? [100, 101, 102] : [100, 102]);
  if (!allowed) assert.ok(!JSON.stringify(shown).includes('作品101'));
  assert.equal(f.calls.filter(call => call.path === '/v0/subjects/1/subjects').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/p1/subjects/1/relations').length, allowed ? 1 : 0);
  const lineage = await f.invoke('get_candidate_lineage', { candidate_ref: result.resultRef, subject_ids: [102] });
  assert.deepEqual(lineage.data[0].parents.map(parent => parent.parentId), [1]);
});

test('关系子结果再关联SFW收藏引用仍继承保护父权限，关闭权限不能借joined读取coverage或lineage', async t => {
  const f = permissionFixture({ allowed: true, protectedParent: true, emptyWishScope: true }); t.after(() => f.service.close());
  const parents = await f.invoke('query_user_collections', { username: '-', subject_type: 2, collection_type: 2,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const wishes = await f.invoke('query_user_collections', { username: '-', subject_type: 2, collection_type: 1,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const children = await f.invoke('expand_subject_relations', { candidate_ref: parents.resultRef, fields: ['id'], response_view: 'reference' });
  assert.equal(children.set.resultCount, 2);
  const joined = await f.invoke('refine_subject_candidates', { candidate_ref: children.resultRef, collection_ref: wishes.collectionRef,
    fields: ['id'], response_view: 'reference' });
  assert.equal(joined.set.resultCount, 2); f.disable();
  await assert.rejects(f.invoke('get_candidate_coverage', { coverage_ref: joined.coverage.coverageRef }),
    error => ['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE'].includes(error.code));
  await assert.rejects(f.invoke('get_candidate_lineage', { candidate_ref: joined.resultRef }),
    error => ['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE'].includes(error.code));
  const before = f.permissionChecks;
  await assert.rejects(f.invoke('refine_subject_candidates', { candidate_ref: children.resultRef, collection_ref: wishes.collectionRef,
    fields: ['id'], response_view: 'reference' }), error => ['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE'].includes(error.code));
  assert.ok(f.permissionChecks > before);
});

test('匿名public父关联中间NSFW页不加载机器账户，source_limit1保留两侧公开SFW', async t => {
  let publicReads = 0, accountReads = 0;
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { accountReads++; throw Error('匿名关联不得加载身份'); },
    currentUser: async () => { accountReads++; throw Error('匿名关联不得读取当前账户'); },
    ensureNsfw: async () => { accountReads++; throw Error('匿名关联不得读取账户偏好'); },
    account: async () => { accountReads++; throw Error('匿名关联不得升级账户来源'); },
    public: async path => {
      assert.equal(path, '/v0/subjects/1/subjects'); publicReads++;
      return [subject(100, 'OVA'), { ...subject(101, 'OVA'), nsfw: true }, subject(102, 'OVA')];
    },
  });
  t.after(() => service.close());
  const invoke = async (name, args) => {
    const result = await service.call(name, args, undefined, undefined, undefined, { turnId: 'anonymous-relation-integration' });
    checkAccessResponse(name, result); return result;
  };
  const parent = await invoke('refine_subject_candidates', { subject_ids: [1], fields: ['id'], response_view: 'reference' });
  const args = { candidate_ref: parent.resultRef, filter: { subject_type: 2, nsfw: 'exclude' },
    fields: ['id'], response_view: 'reference', source_limit: 1 };
  let result = await invoke('expand_subject_relations', args), requests = 1;
  while (result.page.nextCursor) {
    assert.equal(result.accessContext.mode, 'anonymous');
    result = await invoke('expand_subject_relations', { ...args, candidate_ref: result.candidateRef, cursor: result.page.nextCursor });
    requests++; assert.ok(requests <= 4);
  }
  assert.equal(requests, 3); assert.equal(result.stage.matchedCount, 2); assert.equal(result.relationStage.relationScannedCount, 3);
  assert.equal(result.relationStage.failedParentCount, 0); assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.dependencyUnknownCount, 1);
  const shown = await invoke('refine_subject_candidates', { candidate_ref: result.resultRef, fields: ['id', 'name'], limit: 100 });
  assert.deepEqual(shown.data.map(row => row.id), [100, 102]); assert.ok(!JSON.stringify(shown).includes('作品101'));
  assert.equal(shown.coverage.complete, false); assert.equal(shown.coverage.dependencyUnknownCount, 1);
  assert.equal(accountReads, 0); assert.equal(publicReads, 1);
});

test('第三方父收藏范围不能被当成本人子收藏；错owner引用和隐式本人字段在展开前拒绝', async t => {
  const calls = [];
  const identity = { mode: 'account', account, source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString(),
    nsfw: { state: 'not_checked', allowed: null, preference: null } };
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(identity), currentUser: async () => account,
    public: async path => {
      calls.push(path); assert.equal(path, '/v0/users/alice/collections');
      return { data: [{ subject: subject(1), subject_id: 1, type: 2, rate: 9, tags: [], comment: 'Alice公开评价', private: false }], total: 1 };
    },
    account: async (path, options) => {
      calls.push(path); assert.equal(path, '/p1/collections/subjects'); assert.equal(options.expectedAccountId, account.id);
      return { data: [{ ...subject(100), interest: { type: 1, rate: 4, tags: [], comment: '本人评价', private: false, epStatus: 0 } }], total: 1 };
    },
  });
  t.after(() => service.close());
  const invoke = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'relation-owner-integration' });
  const parents = await invoke('query_user_collections', { username: 'alice', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const ownCollections = await invoke('query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const input = { candidate_ref: parents.resultRef, fields: ['id'], response_view: 'reference' };
  for (const extra of [
    { fields: ['id', 'collectionStatus'] },
    { collection_ref: ownCollections.collectionRef, filter: { exclude_collection_types: [2] } },
  ]) await assert.rejects(invoke('expand_subject_relations', { ...input, ...extra }), error => error.code === 'CANDIDATE_SCOPE_MISMATCH');
  assert.deepEqual(calls, ['/v0/users/alice/collections', '/p1/collections/subjects']);
});

test('账户关联fallback失败不把v0数组标成p1成功；保留SFW并报告原v0范围不完整', async t => {
  const f = permissionFixture({ allowed: true, relationFailure: true }); t.after(() => f.service.close());
  const parent = await f.invoke('query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const args = { candidate_ref: parent.resultRef, fields: ['id'], response_view: 'reference', source_limit: 1 };
  let result = await f.invoke('expand_subject_relations', args), requests = 1;
  while (result.page.nextCursor) {
    result = await f.invoke('expand_subject_relations', { ...args, candidate_ref: result.candidateRef, cursor: result.page.nextCursor });
    requests++; assert.ok(requests <= 4);
  }
  assert.equal(result.stage.matchedCount, 2); assert.equal(result.coverage.complete, false); assert.equal(result.relationStage.failedParentCount, 0);
  const shown = await f.invoke('refine_subject_candidates', { candidate_ref: result.resultRef, fields: ['id', 'name'] });
  assert.deepEqual(shown.data.map(row => row.id), [100, 102]); assert.ok(!JSON.stringify(shown).includes('作品101'));
  const detail = await f.invoke('get_candidate_coverage', { coverage_ref: result.coverage.coverageRef });
  const relations = detail.sources.filter(source => source.tool === 'get_subject_relations');
  assert.equal(relations.length, 1); assert.equal(relations[0].source, 'v0'); assert.equal(relations[0].privateRecords, 'not_applicable');
  assert.equal(relations[0].complete, false); assert.equal(relations[0].scannedCount, 3);
  assert.equal(f.calls.filter(call => call.path === '/v0/subjects/1/subjects').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/p1/subjects/1/relations').length, 1);
});

test('语义选定子ID后cached展示不补详情，显式补证据仍保留真实lineage接口回溯', async t => {
  const calls = [];
  const context = { mode: 'account', account, source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString(),
    nsfw: { state: 'not_checked', allowed: null, preference: null } };
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(context), currentUser: async () => account,
    account: async (path, options) => {
      calls.push(path); assert.equal(path, '/p1/collections/subjects'); assert.equal(options.expectedAccountId, account.id);
      return { data: [{ ...subject(1), interest: { type: 2, rate: 8, tags: [], private: false, epStatus: 12 } }], total: 1 };
    },
    public: async path => {
      calls.push(path);
      if (path === '/v0/subjects/1/subjects') return [100, 101, 102].map(id => ({ ...subject(id, 'OVA'), relation: '番外篇' }));
      assert.equal(path, '/v0/subjects/100'); return { ...subject(100, 'OVA'), summary: '已补取的公共简介' };
    },
  });
  t.after(() => service.close());
  const invoke = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'selected-lineage-integration' });
  const parent = await invoke('query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', fields: ['id'], response_view: 'reference' });
  const children = await invoke('expand_subject_relations', { candidate_ref: parent.resultRef, fields: ['id'], response_view: 'reference' });
  const selected = await invoke('refine_subject_candidates', { candidate_ref: children.resultRef, filter: { subject_ids: [100] },
    fields: ['id'] });
  assert.deepEqual(selected.data.map(row => row.id), [100]); assert.equal(selected.data[0].summary, undefined); assert.equal(calls.includes('/v0/subjects/100'), false);
  const proof = await invoke('refine_subject_candidates', { candidate_ref: selected.resultRef, fields: ['id', 'summary'] });
  assert.equal(proof.data[0].summary, '已补取的公共简介');
  const lineage = await invoke('get_candidate_lineage', { candidate_ref: proof.resultRef, subject_ids: [100] });
  assert.deepEqual(lineage.data[0].parents.map(parent => [parent.parentId, parent.relation, parent.name]), [[1, '番外篇', '作品1']]);
  assert.equal(calls.filter(path => path === '/v0/subjects/100').length, 1);
  const beforePresentation = calls.length;
  const { createReadTools } = await import('../dist/src/mcp/pi-tools.js');
  const tableTool = createReadTools({ call: (name, args) => invoke(name, args) }).find(tool => tool.name === 'prepare_candidate_output');
  const displayed = await tableTool.execute('prepared-table-fixture', { candidate_ref: proof.resultRef, format: 'table', completion_scope: 'selected', lineage: 'witness', lineage_format: 'full' }, undefined, () => {}, {});
  assert.notEqual(displayed.isError, true); const table = displayed.details.value;
  const rows = table.presentation.content.find(part => part.type === 'DataTable').props.rows;
  assert.equal(table.counts.preparedCount, 1);
  assert.equal(rows[0].displayName, '作品100'); assert.equal(rows[0].url, 'https://bgm.tv/subject/100');
  assert.match(rows[0].lineage, /作品1.*https:\/\/bgm\.tv\/subject\/1.*番外篇/);
  assert.equal(rows[0].parentCount, '1'); assert.equal(calls.length, beforePresentation);
});

for (const boundary of ['service', 'bridge']) test(`已绑定本人父范围遇账户关系401转换的认证失效，${boundary}保留真实错误且整阶段拒绝`, async t => {
  const f = permissionFixture({ allowed: true, relationFailure: 'BGM_AUTH_EXPIRED' }); t.after(() => f.service.close());
  const parent = await f.invoke('query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', response_view: 'reference', fields: ['id'] });
  const args = { candidate_ref: parent.resultRef, fields: ['id'], response_view: 'reference', source_limit: 1 };
  if (boundary === 'service') {
    await assert.rejects(f.invoke('expand_subject_relations', args), error => error.code === 'BGM_AUTH_EXPIRED'
      && error.sourceTool === 'expand_subject_relations');
  } else {
    const { createReadTools } = await import('../dist/src/mcp/pi-tools.js');
    const tool = createReadTools({ call: (name, args) => f.invoke(name, args) }).find(tool => tool.name === 'expand_subject_relations');
    const output = await tool.execute('relation-auth-fixture', args, undefined, () => {}, {});
    assert.equal(output.isError, true); assert.equal(output.details.error.code, 'BGM_AUTH_EXPIRED');
    assert.equal(output.details.error.sourceTool, 'expand_subject_relations');
    assert.equal(Object.hasOwn(output.details, 'value'), false);
  }
  assert.equal(f.calls.filter(call => call.path === '/v0/subjects/1/subjects').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/p1/subjects/1/relations').length, 1);
});

test('同阶段多次cursor关联同collection_ref不冻结旧remaining；旧快照及真正父pending仍保留', async t => {
  const context = { mode: 'account', account, source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString(),
    nsfw: { state: 'not_checked', allowed: null, preference: null } };
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(context), currentUser: async () => account,
    account: async (path, options) => {
      assert.equal(path, '/p1/collections/subjects'); assert.equal(options.expectedAccountId, account.id);
      return { data: [subject(1), { ...subject(2), platform: null, meta_tags: [] }].map(row => ({ ...row,
        interest: { type: 2, rate: 8, tags: [], private: false, epStatus: 12 } })), total: 2 };
    },
    public: async path => {
      if (path === '/v0/subjects/1/subjects') return Array.from({ length: 8 }, (_, i) => ({ ...subject(i + 100, 'OVA'), relation: '番外篇' }));
      assert.equal(path, '/v0/subjects/2'); return { ...subject(2), platform: null, meta_tags: [] };
    },
  });
  t.after(() => service.close());
  const invoke = (name, args) => service.call(name, args, undefined, undefined, undefined, { turnId: 'joined-cursor-scope-integration' });
  const collected = await invoke('query_user_collections', { username: '-', subject_type: 2, result_mode: 'candidates',
    source_limit: 10000, response_view: 'reference', fields: ['id'] });
  const parents = await invoke('refine_subject_candidates', { candidate_ref: collected.resultRef, filter: { subject_form: ['tv'] },
    fields: ['id'], response_view: 'reference' });
  assert.equal(parents.stage.pendingCount, 1);
  const children = await invoke('expand_subject_relations', { candidate_ref: parents.resultRef, filter: { subject_type: 2 },
    fields: ['id'], response_view: 'reference' });
  assert.equal(children.stage.matchedCount, 8); assert.equal(children.coverage.dependencyPendingCount, 1);
  const args = { candidate_ref: children.resultRef, collection_ref: collected.collectionRef, filter: { exclude_collection_types: [2, 3, 4, 5] },
    fields: ['id'], limit: 3 };
  const first = await invoke('refine_subject_candidates', args); assert.equal(first.stage.remainingCount, 5);
  const second = (await invoke('continue_subject_query', { candidate_ref: first.resultRef, cursor: first.page.nextCursor })).result;
  assert.equal(second.stage.remainingCount, 2);
  const last = (await invoke('continue_subject_query', { candidate_ref: second.resultRef, cursor: second.page.nextCursor })).result;
  assert.equal(last.stage.remainingCount, 0); assert.equal(last.stage.matchedCount, 8);
  assert.equal(last.coverage.dependencyRemainingCount, 0); assert.equal(last.coverage.dependencyPendingCount, 1);
  const oldFirst = await invoke('get_candidate_coverage', { coverage_ref: first.coverage.coverageRef });
  const oldSecond = await invoke('get_candidate_coverage', { coverage_ref: second.coverage.coverageRef });
  assert.equal(oldFirst.stage.remainingCount, 5); assert.equal(oldSecond.stage.remainingCount, 2);
  const selected = await invoke('refine_subject_candidates', { candidate_ref: last.resultRef, filter: { subject_ids: [100] }, fields: ['id'] });
  assert.equal(selected.set.resultCount, 1); assert.equal(selected.coverage.complete, false);
  assert.equal(selected.coverage.dependencyPendingCount, 1);
});
