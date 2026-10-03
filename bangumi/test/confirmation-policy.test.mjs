import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmationForPlan } from '../dist/src/mcp/confirmation-policy.js';

const episode = { name: 'update_episode_collection', args: { subject_id: 101, episode_ids: [4, 5, 6, 7, 8], collection_type: 2 }, before: [0, 0, 0, 0, 0], after: [2, 2, 2, 2, 2] };
const rating = { name: 'update_subject_collection', args: { subject_id: 101, rating: 8 }, before: { rating: 6, comment: '' }, after: { rating: 8, comment: '' } };

test('章节状态的所有枚举、多集及多项计划均免审批', () => {
  for (const collection_type of [0, 1, 2, 3]) {
    const initial = collection_type === 2 ? 0 : 2;
    const multiple = { ...episode, args: { ...episode.args, collection_type }, before: episode.before.map(() => initial), after: episode.after.map(() => collection_type) };
    const single = { name: 'update_single_episode_collection', args: { episode_id: 7, collection_type }, before: { collection_type: initial }, after: { collection_type } };
    for (const plan of [[multiple], [single], [single, multiple]]) {
      assert.deepEqual(confirmationForPlan(plan), { required: false, reasons: [] });
    }
  }
});

test('官方看到的完整范围含多集时免审批，包括只有末集需要变更', () => {
  for (const doneCount of [3, 7]) {
    const before = { episodes: Array.from({ length: 8 }, (_, i) => ({ episode_id: i + 1, collection_type: i < doneCount ? 2 : 0 })) };
    const after = { episodes: before.episodes.map(e => ({ ...e, collection_type: 2 })) };
    assert.deepEqual(confirmationForPlan([{ name: 'update_single_episode_collection', args: { episode_id: 8, batch: true }, before, after }]), { required: false, reasons: [] });
  }
});

test('章节不计入非章节批量数量，其他批量修改仍需审批', () => {
  assert.deepEqual(confirmationForPlan([episode, rating]), { required: false, reasons: [] });
  const another = { ...rating, args: { ...rating.args, subject_id: 102 } };
  for (const plan of [[rating, another], [episode, rating, another]]) {
    assert.deepEqual(confirmationForPlan(plan), { required: true, reasons: ['批量修改完整范围'] });
  }
});

test('作品短评在混合章节计划中仍要求审批，空短评与无变更保持原政策', () => {
  const comment = { ...rating, args: { subject_id: 101, comment: '新的短评' }, after: { ...rating.before, comment: '新的短评' } };
  assert.deepEqual(confirmationForPlan([episode, comment]), { required: true, reasons: ['发布或修改作品短评'] });
  assert.deepEqual(confirmationForPlan([episode, comment, rating]), { required: true, reasons: ['批量修改完整范围', '发布或修改作品短评'] });
  const unchanged = { ...comment, before: comment.after };
  assert.deepEqual(confirmationForPlan([unchanged]), { required: false, reasons: [] });
  const clear = { ...comment, args: { subject_id: 101, comment: '' }, before: comment.after, after: comment.before };
  assert.deepEqual(confirmationForPlan([episode, clear]), { required: false, reasons: [] });
});
