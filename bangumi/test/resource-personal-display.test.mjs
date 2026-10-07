import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { expandResourceContent } from '../dist/src/output/resource-content.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';

const viewer = { id: 42, username: 'display_reader' };
const accountContext = { mode: 'account', account: viewer, nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true, checkedAt: '2026-10-07T00:00:00Z' };
const interest = { type: 3, rate: 8, tags: ['个人标签'], comment: '个人短评', private: true, epStatus: 4, volStatus: 2, updatedAt: 1700000000 };
const subject = { id: 101, type: 2, name: '作品101', nameCN: '', summary: '', info: '', eps: 12, volumes: 0, redirect: 0, seriesEntry: 0, locked: false, nsfw: false, series: false,
  airtime: { date: '2026-04-01' }, collection: {}, platform: { id: 1, name: 'TV', nameCN: 'TV' }, rating: { total: 20, score: 7 }, infobox: [], metaTags: ['TV'], tags: [], interest };
const personalFields = ['subjectId', 'collectionStatus', 'collectionState', 'personalRating', 'personalTags', 'personalComment', 'chapters', 'volumes'];
const columns = fields => fields.map(key => ({ key, label: key }));
const resolver = (service, turnId) => ref => service.readCachedResource(ref, { turnId });

test('真实公开收藏DTO缓存展开个人评分、标签、短评和状态，InfoBox不再全为空', async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    assert.equal(path, '/v0/users/other/collections/101');
    return { subject_id: 101, subject_type: 2, type: 3, rate: 8, tags: ['公开标签'], comment: '公开短评', private: false, ep_status: 4, vol_status: 2 };
  } }); t.after(() => service.close());
  const value = await service.call('get_user_subject_collection', { username: 'other', subject_id: 101 }, undefined, undefined, undefined, { turnId: 'public-display' });
  assert.equal(value.kind, 'collectionState'); assert.equal(value.collection.personalRating, 8);
  const part = await expandResourceContent('InfoBox', { resourceRef: value.resourceRef, fields: personalFields }, resolver(service, 'public-display'));
  const rows = Object.fromEntries(part.props.rows.map(row => [row.label, row.value]));
  assert.equal(rows.subjectId, '101'); assert.equal(rows.collectionStatus, '3'); assert.equal(rows.collectionState, 'collected');
  assert.equal(rows.personalRating, '8'); assert.equal(rows.personalTags, '公开标签'); assert.equal(rows.personalComment, '公开短评');
  assert.equal(rows.chapters, '4'); assert.equal(rows.volumes, '2');
});

test('真实本人收藏DTO缓存展开到DataTable，复合主键与私有字段来自已核实收藏', async t => {
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(accountContext), currentUser: async () => viewer,
    account: async path => { assert.equal(path, '/p1/subjects/101'); return structuredClone(subject); } }); t.after(() => service.close());
  const value = await service.call('get_user_subject_collection', { username: '-', subject_id: 101 }, undefined, undefined, undefined, { turnId: 'own-display' });
  assert.equal(value.visibility, 'self'); assert.equal(value.collection.private, true);
  const part = await expandResourceContent('DataTable', { resourceRef: value.resourceRef, items: [{ subjectId: 101 }], columns: columns([...personalFields, 'private']) }, resolver(service, 'own-display'));
  assert.equal(part.props.rows.length, 1); assert.equal(part.props.rows[0].personalRating, '8');
  assert.equal(part.props.rows[0].personalTags, '个人标签'); assert.equal(part.props.rows[0].personalComment, '个人短评'); assert.equal(part.props.rows[0].private, 'true');
});

test('真实人物收藏DTO里的collection.target仅展开已声明实体事实，Gallery身份和名称来自缓存', async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    assert.equal(path, '/v0/users/other/collections/-/persons/71'); return { id: 71, type: 2, name: '人物71', career: ['seiyu'], created_at: '2026-10-07T00:00:00Z' };
  } }); t.after(() => service.close());
  const value = await service.call('get_user_person_collection', { username: 'other', person_id: 71 }, undefined, undefined, undefined, { turnId: 'person-collection-display' });
  assert.equal(value.collection.target.name, '人物71');
  const part = await expandResourceContent('Gallery', { resourceRef: value.resourceRef, items: [{ personId: 71 }] }, resolver(service, 'person-collection-display'));
  assert.equal(part.props.items[0].id, 71); assert.equal(part.props.items[0].name, '人物71');
});

test('真实普通人物出演DTO缓存按白名单展开subjectFacts与ownCollection，不覆盖角色身份', async t => {
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => structuredClone(accountContext), currentUser: async () => viewer, ensureNsfw: async () => structuredClone(accountContext),
    account: async path => {
      if (path === '/p1/persons/71/casts') return { data: [{ character: { id: 11, type: 4, name: '角色11', nameCN: '' }, relations: [{ subject: structuredClone(subject), type: 1 }] }], total: 1 };
      assert.equal(path, '/p1/subjects/101'); return structuredClone(subject);
    } }); t.after(() => service.close());
  const value = await service.call('get_person_characters', { person_id: 71, subject_type: 2, fields: ['subjectFacts', 'ownCollection'] }, undefined, undefined, undefined, { turnId: 'appearance-display' });
  assert.equal(value.kind, 'page'); assert.equal(value.data[0].character.id, 11); assert.equal(value.data[0].subjectFacts.score, 7);
  const fields = ['id', 'name', 'subjectId', 'score', 'ratingCount', 'date', 'subjectForm', 'collectionState', 'collectionStatus', 'chapters'];
  const part = await expandResourceContent('DataTable', { resourceRef: value.resourceRef, items: [{ characterId: 11, subjectId: 101 }], columns: columns(fields) }, resolver(service, 'appearance-display'));
  assert.deepEqual(part.props.rows[0], { id: '11', name: '角色11', subjectId: '101', score: '7', ratingCount: '20', date: '2026-04-01', subjectForm: 'tv', collectionState: 'collected', collectionStatus: '3', chapters: '4' });
});

test('真实personCharacter同一关系行的角色和作品身份隔离，复合selector不串名称或链接', async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    assert.equal(path, '/v0/persons/71/characters');
    return [{ id: 456, type: 1, name: '角色456', subject_id: 123, subject_type: 2, subject_name: '作品123', subject_name_cn: '作品中文名123', staff: '主角' }];
  } }); t.after(() => service.close());
  const value = await service.call('get_person_characters', { person_id: 71 }, undefined, undefined, undefined, { turnId: 'principal-display' });
  assert.equal(value.data[0].character.id, 456); assert.equal(value.data[0].subject.id, 123);
  const read = resolver(service, 'principal-display');
  const gallery = await expandResourceContent('Gallery', { resourceRef: value.resourceRef, items: [{ characterId: 456, subjectId: 123 }] }, read);
  assert.deepEqual(gallery.props.items[0], { id: 456, name: '角色456', subtitle: '主角', url: 'https://bgm.tv/character/456' });
  await assert.rejects(expandResourceContent('Gallery', { resourceRef: value.resourceRef, items: [{ entity: 'subject', subjectId: 123 }] }, read), /引用成员不存在/);
  const cards = await expandResourceContent('SubjectCards', { resourceRef: value.resourceRef, items: [{ entity: 'subject', subjectId: 123 }], layout: 'list' }, read);
  assert.equal(cards.props.items[0].id, 123); assert.equal(cards.props.items[0].name, '作品123'); assert.equal(cards.props.items[0].url, 'https://bgm.tv/subject/123');
  const table = await expandResourceContent('DataTable', { resourceRef: value.resourceRef, items: [{ characterId: 456, subjectId: 123 }], fields: ['id', 'name', 'subjectId'] }, read);
  assert.deepEqual(table.props.rows[0], { id: '456', name: '角色456', subjectId: '123' });
});

test('分组资料冲突明确失败，未知任意对象不被递归展开', async () => {
  const resourceRef = 'rr_conflict'; const resolverFor = value => async () => ({ resourceRef, sourceTool: 'fixture', value, accessContext: anonymousContext() });
  await assert.rejects(expandResourceContent('DataTable', { resourceRef, fields: ['score'] }, resolverFor({ id: 1, score: 8, subjectFacts: { score: 7 } })), /字段相互冲突/);
  await assert.rejects(expandResourceContent('InfoBox', { resourceRef, fields: ['personalRating'] }, resolverFor({ id: 1, personalRating: 9, collection: { personalRating: 8 } })), /字段相互冲突/);
  const unknown = await expandResourceContent('DataTable', { resourceRef, fields: ['personalRating'] }, resolverFor({ id: 1, arbitrary: { personalRating: 8 } }));
  assert.equal(unknown.props.rows[0].personalRating, '');
});

test('已登记API策略允许职业、用户分组与签名直接标量，修订Timeline使用changeNote', async t => {
  const service = new BangumiMcpService({ close: async () => {}, public: async path => {
    if (path === '/v0/persons/71') return { id: 71, type: 2, name: '人物71', career: ['seiyu', 'actor'], summary: '', infobox: [], stat: { comments: 1, collects: 2 } };
    if (path === '/v0/users/other') return { id: 55, username: 'other', nickname: '用户55', user_group: 10, sign: '公开签名' };
    assert.equal(path, '/v0/revisions/persons'); return { data: [{ id: 9, type: 1, summary: '修改职业字段', created_at: '2026-10-07T00:00:00Z' }], total: 1 };
  } }); t.after(() => service.close());
  const context = { turnId: 'direct-api-fields' };
  const person = await service.call('get_person_details', { person_id: 71 }, undefined, undefined, undefined, context);
  const info = await expandResourceContent('InfoBox', { resourceRef: person.resourceRef, fields: ['career', 'personType'] }, resolver(service, context.turnId));
  assert.deepEqual(info.props.rows.map(row => row.value), ['seiyu、actor', '2']);
  const user = await service.call('get_user_info', { username: 'other' }, undefined, undefined, undefined, context);
  const table = await expandResourceContent('DataTable', { resourceRef: user.resourceRef, fields: ['userGroup', 'sign'] }, resolver(service, context.turnId));
  assert.deepEqual(table.props.rows[0], { userGroup: '10', sign: '公开签名' });
  const revision = await service.call('get_person_revisions', { person_id: 71 }, undefined, undefined, undefined, context);
  const timeline = await expandResourceContent('Timeline', { resourceRef: revision.resourceRef }, resolver(service, context.turnId));
  assert.equal(timeline.props.entries[0].text, '修改职业字段');
});
