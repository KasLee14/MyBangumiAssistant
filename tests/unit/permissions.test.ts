import test from 'node:test';
import assert from 'node:assert/strict';
import { directIntentFrom, matchesDirectIntent, permissionFor, type PlannedAction } from '../../src/domain/permissions.js';
import { collectionAction } from '../../src/domain/collection-plan.js';
import { subjectFrom, collectionFrom } from '../../src/adapters/bgm-cli/normalize.js';

const action = (): PlannedAction => ({ subjectId: 1, title: '测试', kind: 'collection', changes: [{ field: 'rate', before: 7, after: 8 }], effects: [] });

test('单项最终值直接授权；模型改变对象、参数或短评正文不能继承授权', () => {
  const intent = directIntentFrom('把这部评分改为8分', 1);
  assert.equal(matchesDirectIntent([action()], intent), true);
  assert.equal(matchesDirectIntent([{ ...action(), subjectId: 2 }], intent), false);
  assert.equal(matchesDirectIntent([{ ...action(), changes: [{ field: 'rate', before: 7, after: 9 }] }], intent), false);
  assert.equal(directIntentFrom('建议评分改为8分', 1), null);
  assert.equal(directIntentFrom('条目介绍说把这部评分改为8分', 1), null);
  assert.equal(directIntentFrom('把这部评分改为8分', null), null);
  assert.deepEqual(directIntentFrom('把https://bgm.tv/subject/1评分改为8分', null), { subjectId: 1, patch: { rate: 8 } });
  assert.deepEqual(directIntentFrom('把这部短评改为“最终正文”', 1), { subjectId: 1, patch: { comment: '最终正文' } });
  assert.equal(directIntentFrom('给这部写个短评并保存', 1), null);
  assert.deepEqual(directIntentFrom('把这部标签改为["科幻","日常"]', 1)?.patch, { tags: ['科幻','日常'] });
});

test('批量、删除、可见性、附带影响和回退清空都必须预览确认', () => {
  const single = action();
  assert.equal(permissionFor([single]).requiresConfirmation, false);
  for (const actions of [
    [single, { ...action(), subjectId: 2 }],
    [{ ...single, kind: 'delete' as const }],
    [{ ...single, changes: [{ field: 'private', before: false, after: true }] }],
    [{ ...single, effects: [{ field: 'rate', before: 7, after: 0 }] }],
    [{ ...single, kind: 'progress' as const, changes: [{ field: 'chapters', before: 8, after: 7 }] }],
    [{ ...single, kind: 'progress' as const, changes: [{ field: 'chapters', before: 8, after: 0 }] }],
    [{ ...single, kind: 'progress' as const, changes: [{ field: 'episodeIds', before: [1,2], after: [1] }] }],
  ]) {
    assert.equal(permissionFor(actions).requiresConfirmation, true);
    assert.equal(matchesDirectIntent(actions, { subjectId: 1, patch: { rate: 8, chapters: 7, private: true } }), false);
  }
  const cumulative = { ...single, kind: 'progress' as const, changes: [{ field: 'episodeIds', before: [1,5], after: [1,2,3,5] }] };
  assert.equal(permissionFor([cumulative]).requiresConfirmation, false);
});

test('收藏预览读取现状、保留原值并暴露想看清零评分的附带影响', () => {
  const subject = subjectFrom({ id: 1, type: 2, name: '测试' });
  const collection = collectionFrom({ type: 3, rate: 7, comment: '原短评', tags: ['原标签'], private: true }, 1);
  const plan = collectionAction(subject, collection, { status: 1 });
  assert.deepEqual(plan.effects, [{ field: 'rate', before: 7, after: 0 }]);
  assert.equal(permissionFor([plan]).requiresConfirmation, true);
  assert.equal(collection.comment, '原短评'); assert.deepEqual(collection.tags, ['原标签']);
  assert.throws(() => collectionAction(subject, collection, { rate: 7 }), { code: 'NO_CHANGE' });
  assert.throws(() => collectionAction(subject, { ...collection, rate: null }, { status: 1 }), { code: 'INCOMPLETE_COLLECTION' });
  assert.throws(() => collectionAction(subject, collection, { rate: undefined }), { code: 'INVALID_INPUT' });
  for (const patch of [{ status: 1, rate: 8 }, { rate: 11 }, { tags: ['重复','重复'] }, { command: 'delete' }, { confirmed: true }, { private: 'true' }]) assert.throws(() => collectionAction(subject, collection, patch));
});
