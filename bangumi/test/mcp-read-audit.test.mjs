import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceResult, checkResourceResponse, entitySummary, readTime, episodeCollectionStatus } from '../dist/src/mcp/resource-output.js';
import { resourceOutputSchema } from '../dist/src/mcp/resource-schemas.js';
import { collectionRecord, entityCollected, episodeData, episodeStateData, indexRecord, pageRecord } from '../dist/src/mcp/resource-decode.js';
import { normalizeInfobox } from '../dist/src/mcp/infobox-output.js';
import { CommunityReader } from '../dist/src/mcp/community-service.js';
import { anonymousContext } from '../dist/src/mcp/access-context.js';
import { validateToolArguments } from '../dist/src/mcp/catalog.js';

const account = { id: 42, username: 'read_auditor' };
const argsFor = (name, value) => validateToolArguments(name, value);
const checked = (name, value, args) => {
  const result = resourceResult(name, value, args);
  checkResourceResponse(name, result, args, resourceOutputSchema(name));
  return result;
};
const episode = extra => ({ id: 7, subjectID: 101, type: 0, sort: 1, disc: 0, name: '第一集', nameCN: '',
  duration: '', airdate: '', desc: '', comment: 0, ...extra });

test('可空实体字段缺失保留未知，提供非法值必须失败且NSFW证据保留', () => {
  assert.equal(entitySummary({ id: 1, name: '角色', type: 1 }, 'character').nsfw, null);
  assert.equal(entitySummary({ id: 1, name: '角色', role: 1, nsfw: true }, 'character').nsfw, true);
  for (const patch of [{ type: '1' }, { type: 9 }, { type: 1, role: 2 }, { nsfw: 'true' }, { career: [1] }]) {
    assert.throws(() => entitySummary({ id: 1, name: '实体', type: 1, ...patch }, patch.career ? 'person' : 'character'), { code: 'INVALID_RESPONSE' });
  }
  const args = argsFor('get_person_details', { person_id: 1, include: ['summary', 'stats', 'bio'] });
  for (const patch of [{ summary: 1 }, { stat: { comments: '2' } }, { birth_mon: 13 }, { birth_day: 32 },
    { blood_type: 5 }, { birth_year: 2026, birth_mon: 2, birth_day: 29 }]) {
    assert.throws(() => resourceResult('get_person_details', { id: 1, name: '人物', type: 1, summary: '', ...patch }, args), { code: 'INVALID_RESPONSE' });
  }
  const value = checked('get_person_details', { id: 1, name: '人物', type: 1, summary: '', comment: 0, collects: 4, birth_mon: 2, birth_day: 29 }, args);
  assert.deepEqual(value.stats, { comments: 0, collects: 4 });
  assert.equal(value.bio.birthYear, null);
});

test('时间明确区分Unix秒与ISO格式，拒绝单位猜测和日历溢出', () => {
  assert.equal(readTime(1_700_000_000, true), '2023-11-14T22:13:20.000Z');
  assert.equal(readTime('2026-10-04T08:00:00+08:00'), '2026-10-04T00:00:00.000Z');
  for (const value of [1_700_000_000, '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01', false]) {
    assert.throws(() => readTime(value), { code: 'INVALID_RESPONSE' });
  }
  assert.throws(() => readTime(1_700_000_000_000, true), { code: 'INVALID_RESPONSE' });
});

test('个人章节省略标记只有完整IEpisode才能证明未标记，空对象和矛盾别名拒绝', () => {
  assert.equal(episodeCollectionStatus(episode()), 0);
  assert.equal(episodeCollectionStatus(episode({ collection: { status: 2 } })), 2);
  assert.throws(() => episodeCollectionStatus({ id: 7, subjectID: 101, type: 0, name: '缺字段' }), { code: 'INCOMPLETE_COLLECTION' });
  for (const collection of [{}, { status: '2' }, { status: 2, type: 3 }]) {
    assert.throws(() => episodeCollectionStatus(episode({ collection })), { code: 'INVALID_RESPONSE' });
  }
  const value = checked('get_single_episode_collection', { ...episode(), account }, argsFor('get_single_episode_collection', { episode_id: 7 }));
  value.data.statusMeaning = '看过';
  assert.throws(() => checkResourceResponse('get_single_episode_collection', value, argsFor('get_single_episode_collection', { episode_id: 7 }), resourceOutputSchema('get_single_episode_collection')), { code: 'MCP_INVALID_RESULT' });
});

test('目录两端保留desc和作者，p1秒时间/统计映射且作品总数不包含其他资源', () => {
  const args = argsFor('get_index', { index_id: 9, include: ['description', 'stats'] });
  const p1 = checked('get_index', { id: 9, uid: 42, title: '目录', desc: '正文', private: false,
    createdAt: 1_700_000_000, updatedAt: 1_700_000_001, total: 20, replies: 3, collects: 5,
    stats: { subject: { anime: 2, book: 1 }, person: 17 } }, args);
  assert.equal(p1.description, '正文'); assert.equal(p1.ownerId, 42); assert.equal(p1.totalSubjects, 3);
  assert.equal(p1.createdAt, '2023-11-14T22:13:20.000Z'); assert.deepEqual(p1.stats, { comments: 3, collects: 5 });
  const v0 = checked('get_index', { id: 9, title: '目录', desc: 'v0正文', creator: { id: 42, username: account.username }, total: 2,
    stat: { comments: 0, collects: 1 }, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }, args);
  assert.equal(v0.description, 'v0正文'); assert.equal(v0.ownerId, 42); assert.equal(v0.totalSubjects, 2);
  assert.throws(() => resourceResult('get_index', { id: 9, uid: 42, title: '无范围证据', desc: '' }, args), { code: 'PRIVATE_SCOPE' });
});

test('公开作品收藏需要明确private=false，404不可推断未收藏且保留书籍单位', () => {
  const args = argsFor('get_user_subject_collection', { username: 'public_reader', subject_id: 101 });
  const row = { subject_id: 101, subject_type: 1, type: 2, rate: 0, tags: [], comment: '', ep_status: 12, vol_status: 2 };
  for (const privacy of [undefined, null, true, 'false']) assert.throws(() => resourceResult('get_user_subject_collection', { ...row, private: privacy }, args));
  const collected = checked('get_user_subject_collection', { ...row, private: false }, args);
  assert.equal(collected.collection.progressMeaning, '已读章数');
  assert.equal(checked('get_user_subject_collection', null, args).state, 'unavailable');
});

test('SubjectRevision直接对象得到可分页版本，EpisodeRevision父作品ID不冒充章节目标', () => {
  const raw = { id: 3, type: 1, summary: '', created_at: '2026-10-04T00:00:00Z', data: {
    name: '作品', name_cn: '', field_summary: '', field_infobox: '', field_eps: 12,
    vote_field: '', subject_id: 101, type: 2, type_id: 1, platform: 1,
  } };
  const subject = checked('get_subject_revision', raw, argsFor('get_subject_revision', { revision_id: 3, include: ['content'] }));
  assert.equal(subject.contentState, 'available'); assert.equal(subject.targetId, 101);
  assert.equal(subject.versions.length, 1); assert.equal(subject.versionsPage.complete, true);
  const episodeRevision = checked('get_episode_revision', { ...raw, data: { before: {
    name: '章节', name_cn: '', desc: '', airdate: '', duration: '', subject_id: 101, type: 0, sort: 1,
  } } }, argsFor('get_episode_revision', { revision_id: 3, include: ['content'] }));
  assert.equal(episodeRevision.contentState, 'available'); assert.equal(episodeRevision.targetId, null);
  assert.equal(episodeRevision.versions[0].content.subjectId, 101);
});

test('同一信息栏的两个合法别名不能携带互相矛盾的来源', () => {
  assert.deepEqual(normalizeInfobox([{ key: '别名', value: [{ v: '同名' }], values: [{ v: '同名' }] }]), [{ key: '别名', value: [{ v: '同名' }] }]);
  assert.throws(() => normalizeInfobox([{ key: '别名', value: 'A', values: [{ v: 'B' }] }]), { code: 'INVALID_RESPONSE' });
});

test('稳定现状解码拒绝错误版本、错目标、残缺字段以及公开/本人状态互换', () => {
  const args = argsFor('get_user_subject_collection', { username: '-', subject_id: 101 });
  const base = checked('get_user_subject_collection', { account, _record: { subject_id: 101, type: 2, rate: 8, tags: [], comment: '', private: true, ep_status: 12, vol_status: 0 } }, args);
  assert.equal(collectionRecord(base, 101, 42).rate, 8);
  const changed = structuredClone(base); changed.collection.subjectId = 102;
  assert.throws(() => collectionRecord(changed, 101, 42), { code: 'INCOMPLETE_COLLECTION' });
  delete changed.collection.private;
  assert.throws(() => collectionRecord(changed, 101, 42));
  assert.throws(() => episodeData({ schemaVersion: 2, entity: 'episode' }), { code: 'INVALID_RESPONSE' });
  assert.throws(() => episodeStateData({ ...base, kind: 'wrong' }, 42), { code: 'INCOMPLETE_COLLECTION' });
  assert.throws(() => indexRecord({ schemaVersion: 1, visibility: 'self', account, kind: 'indexState', complete: true }, 42), { code: 'INCOMPLETE_RESPONSE' });
  assert.throws(() => entityCollected({ schemaVersion: 1, visibility: 'self', account, kind: 'collectionState', target: { kind: 'person', id: 1 },
    state: 'collected', collection: { collected: true, target: { id: 1, entity: 'character' } } }, 'person', 1, 42), { code: 'INVALID_RESPONSE' });
  assert.throws(() => pageRecord({ schemaVersion: 1, kind: 'page', visibility: 'self', account, data: [], page: { total: 1, limit: 1, offset: 0, returnedCount: 0 } }, 42), { code: 'INCOMPLETE_DATA' });
});

test('博客评论首次读取先核实公开博客，快照续页不重新联网', async () => {
  for (const publicValue of [false, undefined, true]) {
    const calls = [];
    const reader = new CommunityReader({ community: async path => {
      calls.push(path);
      if (path === '/p1/blogs/9') return { id: 9, public: publicValue };
      assert.equal(path, '/p1/blogs/9/comments');
      return [{ id: 1, mainID: 9, relatedID: 0, creatorID: 1, createdAt: 1_700_000_000, content: '评论', state: 0,
        replies: [{ id: 2, mainID: 9, relatedID: 1, creatorID: 1, createdAt: 1_700_000_001, content: '回复', state: 0 }] }];
    } });
    const args = argsFor('get_blog_comments', { blog_id: 9, limit: 1 });
    if (publicValue !== true) {
      await assert.rejects(reader.call('get_blog_comments', args, undefined, anonymousContext()), { code: 'PRIVATE_SCOPE' });
      assert.deepEqual(calls, ['/p1/blogs/9']);
    } else {
      const first = await reader.call('get_blog_comments', args, undefined, anonymousContext());
      await reader.call('get_blog_comments', argsFor('get_blog_comments', { blog_id: 9, limit: 1, offset: 1, snapshot_ref: first.page.snapshotRef }), undefined, anonymousContext());
      assert.deepEqual(calls, ['/p1/blogs/9', '/p1/blogs/9/comments']);
    }
  }
});

test('社区非法可空评分、计数或楼层状态不被变成未知值或正常可见正文', async () => {
  for (const patch of [{ rate: '8' }, { rate: 11 }, { type: '2' }, { type: 0 }]) {
    const reader = new CommunityReader({ community: async () => ({ total: 1, data: [{ id: 1, rate: 8, type: 2, comment: '', ...patch }] }) });
    await assert.rejects(reader.call('get_subject_comments', argsFor('get_subject_comments', { subject_id: 101 })), { code: 'INVALID_RESPONSE' });
  }
  const reader = new CommunityReader({ community: async path => path === '/p1/blogs/9' ? { id: 9, public: true } : [
    { id: 1, mainID: 9, relatedID: 0, creatorID: 1, createdAt: 1_700_000_000, content: '不可猜测', state: '0', replies: [] },
  ] });
  await assert.rejects(reader.call('get_blog_comments', argsFor('get_blog_comments', { blog_id: 9 })), { code: 'INVALID_RESPONSE' });
});
