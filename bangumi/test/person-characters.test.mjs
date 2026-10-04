import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { validateToolArguments, findToolDefinition, TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';
import { checkResourceResponse } from '../dist/src/mcp/resource-output.js';
import { AppError, safeError } from '../dist/src/support/errors.js';

const viewer = { id: 42, username: 'appearance_reader' };
const accountContext = (allowed = true) => ({ mode: 'account', account: { ...viewer },
  nsfw: { preference: true, allowed, state: allowed === null ? 'unknown' : allowed ? 'enabled' : 'disabled' },
  source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() });
const character = (id, type = 4) => ({ id, type, name: `角色${id}`, nameCN: `角色${id}` });
const person = (id, type = 2) => ({ id, type, name: `人物${id}`, nameCN: `人物${id}`, careers: ['seiyu'] });
const subject = (id, form = 'TV', extra = {}) => ({ id, type: 2, name: `作品${id}`, nameCN: `作品${id}`,
  summary: '', info: '', eps: 12, volumes: 0, redirect: 0, seriesEntry: 0, locked: false, nsfw: false, series: false,
  airtime: { date: '2026-04-01' }, collection: {}, platform: { id: 1, name: form, nameCN: form },
  rating: { total: 20, score: 7 }, infobox: [], metaTags: form ? [form] : [], tags: [], ...extra });
const interest = (type, extra = {}) => ({ type, rate: 8, tags: [], comment: '', private: true,
  epStatus: 12, volStatus: 0, updatedAt: 1700000000, ...extra });
const group = (id, relations) => ({ character: character(id), relations });
const relation = (id, type = 1, form = 'TV', extra = {}) => ({ subject: subject(id, form, extra), type });

function fixture({ groups = [], details = [], anonymous = false, reverse = [], rawPublic, fail, mutatePage } = {}) {
  let context = anonymous ? anonymousContext() : accountContext();
  const calls = []; const detailMap = new Map(details.map(row => [row.id, row]));
  const transport = {
    close: async () => {}, preflight: async () => structuredClone(context),
    currentUser: async () => { if (!context.account) throw new AppError('BGM_AUTH_REQUIRED', '未登录'); return { ...context.account }; },
    account: async (path, options = {}, signal) => {
      calls.push({ kind: 'account', path, options: structuredClone(options) });
      signal?.throwIfAborted(); assert.equal(options.expectedAccountId, context.account?.id);
      if (fail) { const error = fail(path, options, signal); if (error) throw error; }
      if (path === '/p1/persons/71/casts') {
        const query = options.query ?? {};
        const data = groups.map(row => ({ ...row, relations: row.relations.filter(edge =>
          (query.subjectType === undefined || edge.subject.type === query.subjectType)
          && (query.type === undefined || edge.type === query.type)) })).filter(row => row.relations.length);
        const page = { data: data.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)), total: data.length };
        return structuredClone(mutatePage?.(page, query) ?? page);
      }
      if (path === '/p1/characters/11/casts') {
        const query = options.query ?? {};
        return { data: structuredClone(reverse.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100))), total: reverse.length };
      }
      const id = /^\/p1\/subjects\/(\d+)$/.exec(path)?.[1];
      if (id) { assert.ok(detailMap.has(Number(id)), `未预期读取作品详情 ${id}`); return structuredClone(detailMap.get(Number(id))); }
      throw Error(`未预期账户路径 ${path}`);
    },
    public: async (path, options = {}, signal) => {
      calls.push({ kind: 'public', path, options: structuredClone(options) }); signal?.throwIfAborted();
      assert.equal(anonymous, true, '登录路径不得降级匿名');
      if (fail) { const error = fail(path, options, signal); if (error) throw error; }
      if (path === '/v0/persons/71/characters' || path === '/v0/characters/11/persons') return structuredClone(rawPublic ?? []);
      const id = /^\/v0\/subjects\/(\d+)$/.exec(path)?.[1];
      if (id) { assert.ok(detailMap.has(Number(id))); return structuredClone(detailMap.get(Number(id))); }
      throw Error(`未预期公开路径 ${path}`);
    },
  };
  return { service: new BangumiMcpService(transport), calls, setContext: value => { context = value; } };
}

test('扩充既有出演工具，严格参数保持默认调用兼容并拒绝无绑定续页', () => {
  assert.equal(TOOL_DEFINITIONS.some(tool => tool.name === 'query_person_appearances'), false);
  const defaults = validateToolArguments('get_person_characters', { person_id: 71 });
  assert.equal(defaults.limit, 20); assert.equal(defaults.offset, 0); assert.equal(Object.hasOwn(defaults, 'include'), false);
  for (const args of [{ person_id: '71' }, { person_id: 71, subject_type: 5 },
    { person_id: 71, appearance_role: 'protagonist' }, { person_id: 71, subject_form: 'tv' },
    { person_id: 71, subject_type: 1, subject_form: 'tv' }, { person_id: 71, include: ['summary'] },
    { person_id: 71, include: ['own_collection', 'own_collection'] },
    { person_id: 71, include: [], offset: 1 }, { person_id: 71, subject_type: 2, offset: 1 },
    { person_id: 71, snapshot_ref: 'invalid' }, { person_id: 71, include: [], arbitrary_url: 'https://example.test' }]) {
    assert.throws(() => validateToolArguments('get_person_characters', args), e => e.code === 'INVALID_INPUT');
  }
  const enhanced = validateToolArguments('get_person_characters', { person_id: 71, subject_type: 2,
    appearance_role: 'main', subject_form: 'tv', include: ['subject_facts', 'own_collection'] });
  assert.equal(enhanced.subject_form, 'tv');
  assert.equal(findToolDefinition('get_person_characters').effect, 'read');
  assert.equal(findToolDefinition('get_character_persons').effect, 'read');
});

test('真实 p1 嵌套关系与 v0 扁平关系保留实体类型，主角类型独立，两个方向一致', async () => {
  const p1 = fixture({ groups: [group(11, [relation(101, 1), relation(102, 2)])],
    reverse: [{ subject: subject(101), type: 1, casts: [{ person: person(71) }] }] });
  const value = await p1.service.call('get_person_characters', { person_id: 71 });
  assert.deepEqual(value.data.map(row => row.character.characterType), [4, 4]);
  assert.deepEqual(value.data.map(row => row.subject.id), [101, 102]);
  assert.deepEqual(value.data.map(row => row.appearanceRole.meaning), ['main', 'supporting']);
  assert.deepEqual(value.data.map(row => row.appearanceRole.code), [1, 2]);
  assert.deepEqual(value.data.map(row => row.sourceTypeCode), [1, 2]);
  assert.deepEqual(value.data.map(row => row.staff), ['主角', '配角']);
  const reverse = await p1.service.call('get_character_persons', { character_id: 11 });
  assert.equal(reverse.data[0].person.personType, 2); assert.equal(reverse.data[0].person.id, 71);
  assert.equal(reverse.data[0].subject.id, 101); assert.equal(reverse.data[0].appearanceRole.meaning, 'main');
  const v0 = fixture({ anonymous: true, rawPublic: [{ ...character(11), subject_id: 101, subject_type: 2,
    subject_name: '作品101', subject_name_cn: '作品101', staff: '主角' }] });
  const publicValue = await v0.service.call('get_person_characters', { person_id: 71 });
  assert.equal(publicValue.data[0].character.characterType, 4);
  assert.deepEqual(publicValue.data[0].appearanceRole, value.data[0].appearanceRole);
  assert.equal(publicValue.data[0].sourceTypeCode, 4, '源实体类型只作保留字段，不能当出演关系');
  const v0Reverse = fixture({ anonymous: true, rawPublic: [{ ...person(71), career: ['seiyu'],
    subject_id: 101, subject_type: 2, subject_name: '作品101', subject_name_cn: '作品101', staff: '主角' }] });
  const publicReverse = await v0Reverse.service.call('get_character_persons', { character_id: 11 });
  assert.equal(publicReverse.data[0].person.personType, 2);
  assert.deepEqual(publicReverse.data[0].appearanceRole, reverse.data[0].appearanceRole);
});

test('旧参数只读取关系源，多个作品展开后的总数正确，续页不重复全量扫描', async () => {
  const f = fixture({ groups: [group(11, [relation(101), relation(102)]), group(12, [relation(103)])] });
  const first = await f.service.call('get_person_characters', { person_id: 71, limit: 1 });
  const second = await f.service.call('get_person_characters', { person_id: 71, limit: 1, offset: 1 });
  assert.equal(first.page.total, 3); assert.equal(first.data[0].subject.id, 101); assert.equal(second.data[0].subject.id, 102);
  assert.equal(f.calls.length, 1);
  assert.equal(first.page.snapshotRef, undefined); assert.equal(first.coverage, undefined);
  assert.equal(first.data[0].subjectFacts, undefined); assert.equal(first.data[0].ownCollection, undefined);
});

test('动画/主角由 p1 源筛选，TV 筛选的分页按关系计数，同作品多角色详情与收藏复用', async () => {
  const f = fixture({ groups: [group(11, [relation(101), relation(102, 1, 'Movie'), relation(103, 2)]),
    group(12, [relation(101)]), group(13, [relation(105)])],
    details: [subject(101, 'TV', { interest: interest(1) }), subject(102, 'Movie'), subject(105)] });
  const args = { person_id: 71, subject_type: 2, appearance_role: 'main', subject_form: 'tv',
    include: ['subject_facts', 'own_collection'], limit: 1 };
  const first = await f.service.call('get_person_characters', args);
  const source = f.calls.find(call => call.path === '/p1/persons/71/casts');
  assert.equal(source.options.query.subjectType, 2); assert.equal(source.options.query.type, 1);
  assert.equal(first.page.total, 3); assert.equal(first.coverage.sourceUnit, 'character');
  assert.equal(first.coverage.sourceTotal, 3); assert.equal(first.coverage.relationTotal, 4);
  assert.equal(first.coverage.matchedRelationTotal, 3); assert.equal(first.coverage.matchedSubjectTotal, 2);
  assert.equal(first.coverage.complete, true); assert.equal(first.coverage.sourceComplete, true);
  assert.equal(first.data[0].subjectFacts.form, 'tv'); assert.equal(first.data[0].ownCollection.state, 'collected');
  assert.equal(first.data[0].ownCollection.collectionStatus, 1);
  assert.match(first.page.snapshotRef, /^[a-f0-9]{32}$/);
  const second = await f.service.call('get_person_characters', { ...args, offset: first.page.nextOffset, snapshot_ref: first.page.snapshotRef });
  const third = await f.service.call('get_person_characters', { ...args, offset: second.page.nextOffset, snapshot_ref: second.page.snapshotRef });
  assert.deepEqual([first, second, third].map(page => page.data[0].subject.id), [101, 101, 105]);
  assert.equal(third.data[0].ownCollection.state, 'not_collected');
  assert.equal(f.calls.filter(call => call.path === '/p1/persons/71/casts').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/p1/subjects/101').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/p1/subjects/105').length, 1);
  assert.equal(third.page.nextOffset, null);
  checkOutput(findToolDefinition('get_person_characters').outputSchema, { value: first });
});

test('只传形式条件也返回形式证据，未展开本人收藏时不读取详情与个人记录', async () => {
  const f = fixture({ groups: [group(11, [relation(101), relation(102, 1, 'Movie')])] });
  const value = await f.service.call('get_person_characters', { person_id: 71, subject_type: 2, subject_form: 'tv', include: [] });
  assert.deepEqual(value.data.map(row => row.subject.id), [101]);
  assert.equal(value.data[0].subjectFacts.form, 'tv'); assert.equal(value.data[0].ownCollection, undefined);
  assert.deepEqual(value.scope.include, []); assert.equal(value.visibility, 'public');
  assert.equal(f.calls.length, 1);
});

test('未知形式、未知出演关系、残缺收藏分别留覆盖缺口，不能据此宣称完整未看列表', async () => {
  const incomplete = subject(104); delete incomplete.summary;
  const f = fixture({ groups: [group(11, [relation(101), relation(102, 1, ''), relation(103, 99), relation(104)])],
    details: [subject(101, 'TV', { interest: interest(2) }), subject(102, ''), subject(103), incomplete] });
  const value = await f.service.call('get_person_characters', { person_id: 71, subject_type: 2,
    subject_form: 'tv', include: ['subject_facts', 'own_collection'] });
  assert.equal(value.coverage.sourceComplete, true); assert.equal(value.coverage.complete, false);
  assert.deepEqual(value.coverage.unknownSubjectFormIds, [102]);
  assert.deepEqual(value.coverage.unavailableCollectionSubjectIds, [104]);
  assert.equal(value.data.find(row => row.subject.id === 104).ownCollection.state, 'unavailable');
  assert.equal(value.data.find(row => row.subject.id === 104).ownCollection.collectionStatus, null);
  const unknown = value.data.find(row => row.subject.id === 103);
  assert.equal(unknown.appearanceRole.meaning, 'unknown'); assert.equal(unknown.appearanceRole.code, 99);
});

test('本人收藏必须登录；未登录、401、429、取消或超时不能降级匿名或当作未收藏', async () => {
  const anonymous = fixture({ anonymous: true, rawPublic: [] });
  await assert.rejects(anonymous.service.call('get_person_characters', { person_id: 71, include: ['own_collection'] }), e => e.code === 'BGM_AUTH_REQUIRED');
  assert.equal(anonymous.calls.length, 0);
  for (const code of ['BGM_HTTP_401', 'BGM_HTTP_429', 'CANCELLED', 'BGM_TIMEOUT']) {
    const f = fixture({ groups: [group(11, [relation(101)])], details: [subject(101)],
      fail: path => path === '/p1/subjects/101' ? new AppError(code, '离线读取失败') : undefined });
    await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include: ['own_collection'] }), e => e.code === code);
    assert.equal(f.calls.some(call => call.kind === 'public'), false);
    assert.equal(f.calls.filter(call => call.path === '/p1/subjects/101').length, 1);
  }
});

test('分页快照绑定人物、筛选、账户和 NSFW 范围，改变任一条件不得沿旧偏移继续', async () => {
  const f = fixture({ groups: [group(11, [relation(101), relation(102)])] });
  const args = { person_id: 71, subject_type: 2, include: [], limit: 1 };
  const first = await f.service.call('get_person_characters', args);
  const continuation = { ...args, offset: 1, snapshot_ref: first.page.snapshotRef };
  await assert.rejects(f.service.call('get_person_characters', { ...continuation, appearance_role: 'main' }), e => e.code === 'SNAPSHOT_SCOPE_MISMATCH');
  await assert.rejects(f.service.call('get_person_characters', { ...continuation, include: ['subject_facts'] }), e => e.code === 'SNAPSHOT_SCOPE_MISMATCH');
  f.setContext({ ...accountContext(), account: { id: 99, username: 'another_reader' } });
  await assert.rejects(f.service.call('get_person_characters', continuation), e => e.code === 'SNAPSHOT_SCOPE_MISMATCH');
  f.setContext(accountContext(false));
  await assert.rejects(f.service.call('get_person_characters', continuation), e => e.code === 'SNAPSHOT_SCOPE_MISMATCH');
  f.setContext(accountContext());
  await assert.rejects(f.service.call('get_person_characters', { ...continuation, snapshot_ref: '0'.repeat(32) }), e => e.code === 'SNAPSHOT_EXPIRED');
  assert.equal(f.calls.length, 1);
});

test('源分页总数漂移或残缺须失败，不能缓存部分关系；确定性结构错误报告不可重试', async () => {
  const many = Array.from({ length: 101 }, (_, i) => group(i + 1, [relation(i + 1000)]));
  const changing = fixture({ groups: many, mutatePage: (page, query) => query.offset ? { ...page, total: page.total + 1 } : page });
  await assert.rejects(changing.service.call('get_person_characters', { person_id: 71, include: [], limit: 1 }), e => e.code === 'INCOMPLETE_DATA');
  assert.equal(changing.calls.length, 2, '用户请求一条关系仍须核实真实的两页源范围');
  for (const mutatePage of [page => ({ ...page, data: [] }), page => ({ ...page, data: [{ character: character(11), relations: [{ subject: { id: 0 }, type: 1 }] }] })]) {
    const f = fixture({ groups: [group(11, [relation(101)])], mutatePage });
    await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include: [] }), e => ['INCOMPLETE_DATA', 'INVALID_RESPONSE'].includes(e.code));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture({ groups: [group(11, [relation(101)])], mutatePage: page => ({ ...page, data: [{ character: character(11), relations: [{ subject: null, type: 1 }] }] }) });
  await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include: [] }), error => {
    const safe = safeError(error);
    assert.equal(safe.code, 'INVALID_RESPONSE'); assert.equal(safe.sourceTool, 'get_person_characters');
    assert.equal(safe.recovery?.retryable, false); assert.equal(safe.recovery?.stage, 'response_contract');
    return true;
  });
  await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include: [], limit: 1 }), e => e.code === 'INVALID_RESPONSE');
  assert.equal(f.calls.length, 1, '确定性契约错误不能靠缩小页大小再发送相同业务请求');
});

test('已返回的出演输出仍受固定 schema 约束，收藏空状态与未知码不能被任意字段替换', async () => {
  const f = fixture({ groups: [group(11, [relation(101)])], details: [subject(101)] });
  const value = await f.service.call('get_person_characters', { person_id: 71, include: ['own_collection'] });
  const schema = findToolDefinition('get_person_characters').outputSchema;
  checkOutput(schema, { value });
  for (const mutate of [row => { row.character.characterType = 99; }, row => { row.appearanceRole.meaning = 'lead'; },
    row => { row.ownCollection.collectionStatus = 99; }, row => { row.unrequestedFullSubject = { summary: '正文' }; }]) {
    const copy = structuredClone(value); mutate(copy.data[0]);
    assert.throws(() => checkOutput(schema, { value: copy }), e => e.code === 'MCP_INVALID_RESULT');
  }
  const args = validateToolArguments('get_person_characters', { person_id: 71, include: ['own_collection'] });
  for (const mutate of [copy => { copy.data[0].ownCollection.collectionStatus = 1; },
    copy => { copy.coverage.matchedRelationTotal += 1; }, copy => { copy.account.id = 99; },
    copy => { copy.data[0].appearanceRole.meaning = 'supporting'; }]) {
    const copy = structuredClone(value); mutate(copy);
    assert.throws(() => checkResourceResponse('get_person_characters', copy, args, schema), e => e.code === 'MCP_INVALID_RESULT');
  }
});

test('同时含嵌套与扁平作品字段时拒绝身份、类型及名称冲突', async () => {
  for (const extra of [{ subject_id: 102 }, { subject_type: 1 }, { subject_name: '其他作品' }, { subject_name_cn: '另一个中文名' }]) {
    const f = fixture({ anonymous: true, rawPublic: [{ ...character(11), subject: subject(101),
      subject_id: 101, subject_type: 2, subject_name: '作品101', subject_name_cn: '作品101', staff: '主角', ...extra }] });
    await assert.rejects(f.service.call('get_person_characters', { person_id: 71 }), e => e.code === 'INVALID_RESPONSE');
  }
});

test('读取期间账户或 NSFW 变化不返回旧权限快照', async () => {
  for (const changed of [{ ...accountContext(), account: { id: 99, username: 'another_reader' } }, accountContext(false)]) {
    let f;
    f = fixture({ groups: [group(11, [relation(101)])], fail: path => { if (path === '/p1/persons/71/casts') f.setContext(changed); } });
    await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include: [] }), e => e.code === 'ACCOUNT_CHANGED');
    assert.equal(f.calls.length, 1);
  }
});

test('已授权写入尝试使本连接的本人状态快照失效，不能用旧快照续页', async () => {
  const f = fixture({ groups: [group(11, [relation(101)]), group(12, [relation(102)])] });
  const args = { person_id: 71, subject_type: 2, include: [], limit: 1 };
  const first = await f.service.call('get_person_characters', args);
  // 离线客户端拒绝所有写入业务路径；即使写入失败，旧私人状态快照也不能继续使用。
  await assert.rejects(f.service.call('collect_person', { person_id: 71 }, undefined, { accountId: viewer.id }));
  await assert.rejects(f.service.call('get_person_characters', { ...args, offset: 1, snapshot_ref: first.page.snapshotRef }),
    e => e.code === 'SNAPSHOT_EXPIRED');
});

test('NSFW 权限关闭时在投影丢弃原始字段前拒绝上游夹带，未知权限仍明确保留未知', async () => {
  const entityGroup = group(11, [relation(101)]); entityGroup.character.nsfw = true;
  const denied = fixture({ groups: [entityGroup] }); denied.setContext(accountContext(false));
  await assert.rejects(denied.service.call('get_person_characters', { person_id: 71 }), { code: 'NSFW_SCOPE_MISMATCH' });
  const allowed = fixture({ groups: [entityGroup] });
  assert.equal((await allowed.service.call('get_person_characters', { person_id: 71 })).data[0].character.nsfw, true);
  for (const include of [[], ['own_collection']]) {
    const f = fixture({ groups: [group(11, [relation(101, 1, 'TV', { nsfw: true })])], details: [subject(101, 'TV', { nsfw: true })] });
    f.setContext(accountContext(false));
    await assert.rejects(f.service.call('get_person_characters', { person_id: 71, include }), e => e.code === 'NSFW_SCOPE_MISMATCH');
  }
  const unknown = fixture({ groups: [group(11, [relation(101, 1, 'TV', { nsfw: true })])] });
  unknown.setContext(accountContext(null));
  const value = await unknown.service.call('get_person_characters', { person_id: 71, include: [] });
  assert.equal(value.accessContext.nsfw.state, 'unknown');
});
