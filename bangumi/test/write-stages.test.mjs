import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitWriteStages, mergeStageSubmission } from '../dist/src/mcp/write-stages.js';
import { SubmissionTracker, checkSubmission } from '../dist/src/mcp/submission.js';
import { AppError } from '../dist/src/support/errors.js';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { WRITE_RECOVERY_KINDS, pendingWriteFact, submittedWriteTarget } from '../dist/src/mcp/write-recovery.js';
import { WRITE_RATE_RULES, writeRateRequests } from '../dist/src/mcp/write-rate-limit.js';
import { checkOutput } from '../dist/src/mcp/subject-output.js';
import { resourceOutputSchema } from '../dist/src/mcp/resource-schemas.js';
import { verifyWrittenState } from '../dist/src/mcp/write-verification.js';

const parent = { collection_type: 3, rating: 8, comment: '保留正文', tags: ['保留标签'], private: false, ep_status: 1, vol_status: 0 };
const prepared = type => ({ type, collection: { subjectId: 201, status: 3, rate: 8, comment: '保留正文', tags: ['保留标签'], private: false, chapters: 1, volumes: 0 } });
function episodeBinding(count = 25) {
  const ids = Array.from({ length: count }, (_, index) => 501 + index);
  const episodes = ids.map(episode_id => ({ episode_id, subject_id: 201, episode_type: 0, collection_type: 0 }));
  const before = { episodes, parentCollection: structuredClone(parent), protectedEpisodes: [{ episode_id: 999, subject_id: 201, episode_type: 1, collection_type: 1 }] };
  const after = { ...structuredClone(before), episodes: episodes.map(row => ({ ...row, collection_type: 2 })) };
  return { target: { kind: 'episodes', subjectId: 201, name: '离线动画', episodeIds: ids }, before, after,
    guard: { accountId: 42, subjectId: 201, prepared: { ...prepared('anime'), episodes: ids.map(id => ({ id, type: 0, status: 0 })) } },
    args: { subject_id: 201, episode_ids: ids, collection_type: 2 }, effects: ['保护父收藏'], baseline: new Map([['collection:201', parent]]), readback: async () => structuredClone(after) };
}
function subjectBinding() {
  const before = structuredClone(parent), after = { ...structuredClone(parent), rating: 9, comment: '新正文', ep_status: 7, vol_status: 2 };
  return { target: { kind: 'subject', id: 201, subjectType: 1 }, before, after, guard: { accountId: 42, subjectId: 201, prepared: prepared('book') },
    args: { subject_id: 201, rating: 9, comment: '新正文', ep_status: 7, vol_status: 2 }, effects: ['保护其他字段'], readback: async () => structuredClone(after) };
}
const limited = () => {
  const error = new AppError('BGM_RATE_LIMIT_REJECTED', '离线固定拒绝');
  Object.defineProperty(error, 'rejection', { value: { kind: 'rate_limit', httpStatus: 429, upstreamCode: 'RATE_LIMIT_EXCEEDED', retryAfterMs: null } });
  return error;
};
async function stageReceipt(name, args, stage, outcome = 'acknowledged') {
  const tracker = new SubmissionTracker(name, args, 42, name.includes('episode_collection') ? 201 : undefined);
  const path = name.includes('episode_collection') ? `/p1/collections/episodes/${args.episode_ids?.[0] ?? args.episode_id}`
    : name === 'create_index' ? '/p1/indexes' : `/p1/collections/subjects/${args.subject_id}`;
  const method = stage === 'book_progress' || name.includes('episode_collection') ? 'PATCH' : name === 'create_index' ? 'POST' : 'PUT';
  if (outcome === 'not_attempted') return tracker.failed();
  if (outcome === 'rejected' || outcome === 'unknown') {
    await assert.rejects(tracker.submit(path, method, async () => { throw outcome === 'rejected' ? limited() : new AppError('BGM_NETWORK', '离线投递未知'); }));
    return tracker.failed();
  }
  await tracker.submit(path, method, async () => ({}));
  return tracker.finish(name === 'create_index' ? { id: 104345 } : {});
}

test('全部14个写工具强制登记恢复类型及实际网络额度规则，未知工具禁止启用', () => {
  const args = {
    update_subject_collection: { subject_id: 201, rating: 8 }, update_episode_collection: { subject_id: 201, episode_ids: [501], collection_type: 2 },
    update_single_episode_collection: { episode_id: 501, collection_type: 2 }, collect_character: { character_id: 701 }, uncollect_character: { character_id: 701 },
    collect_person: { person_id: 801 }, uncollect_person: { person_id: 801 }, create_index: { title: '离线目录' }, update_index: { index_id: 901, title: '新标题' },
    add_subject_to_index: { index_id: 901, subject_id: 201 }, update_index_subject: { index_id: 901, subject_id: 201, comment: '正文' },
    remove_subject_from_index: { index_id: 901, subject_id: 201 }, collect_index: { index_id: 901 }, uncollect_index: { index_id: 901 },
  };
  const tools = TOOL_DEFINITIONS.filter(tool => tool.effect === 'write'); assert.equal(tools.length, 14);
  assert.deepEqual(Object.keys(WRITE_RECOVERY_KINDS).sort(), tools.map(tool => tool.name).sort());
  assert.deepEqual(Object.keys(args).sort(), tools.map(tool => tool.name).sort());
  for (const tool of tools) {
    assert.ok(WRITE_RECOVERY_KINDS[tool.name]);
    const requests = writeRateRequests(tool.name, args[tool.name]); assert.equal(requests.length, 1);
    assert.equal(requests[0].count, 1); assert.ok(WRITE_RATE_RULES[requests[0].action]);
  }
  assert.throws(() => splitWriteStages('future_undocumented_write', subjectBinding()), { code: 'UNKNOWN_TOOL' });
  assert.throws(() => writeRateRequests('future_undocumented_write', {}), { code: 'UNKNOWN_TOOL' });
});

test('25集操作按真实请求拆单集，保留父收藏保护范围且不修改原授权计划', async () => {
  const binding = episodeBinding(); const snapshot = structuredClone({ before: binding.before, after: binding.after, args: binding.args, guard: binding.guard, target: binding.target });
  const stages = splitWriteStages('update_episode_collection', binding); assert.equal(stages.length, 25);
  for (const [index, stage] of stages.entries()) {
    const id = binding.args.episode_ids[index];
    assert.deepEqual(stage.args, { subject_id: 201, episode_ids: [id], collection_type: 2 });
    assert.deepEqual(stage.target.episodeIds, [id]); assert.equal(stage.guard.subjectId, 201);
    assert.deepEqual(stage.before.episodes, [binding.before.episodes[index]]); assert.deepEqual(stage.after.episodes, [binding.after.episodes[index]]);
    assert.deepEqual(stage.before.parentCollection, parent); assert.deepEqual(stage.after.parentCollection, parent);
    assert.deepEqual(stage.before.protectedEpisodes, binding.before.protectedEpisodes); assert.deepEqual(stage.after.protectedEpisodes, binding.after.protectedEpisodes);
    assert.deepEqual(stage.guard.prepared.episodes, [{ id, type: 0, status: 0 }]);
    assert.deepEqual(await stage.readback(undefined, new AbortController().signal), stage.after);
    assert.equal(writeRateRequests('update_episode_collection', stage.args)[0].count, 1);
  }
  stages[0].before.parentCollection.tags.push('不能污染原范围'); stages[0].guard.prepared.episodes[0].status = 2;
  assert.deepEqual({ before: binding.before, after: binding.after, args: binding.args, guard: binding.guard, target: binding.target }, snapshot);
});

test('字段与书籍进度拆两个顺序阶段，第二阶段基线纳入第一阶段已生效字段', () => {
  const binding = subjectBinding(); const stages = splitWriteStages('update_subject_collection', binding); assert.equal(stages.length, 2);
  assert.deepEqual(stages[0].args, { subject_id: 201, rating: 9, comment: '新正文' });
  assert.deepEqual(stages[0].before, binding.before); assert.deepEqual(stages[0].after, { ...parent, rating: 9, comment: '新正文' });
  assert.deepEqual(stages[1].args, { subject_id: 201, ep_status: 7, vol_status: 2 });
  assert.deepEqual(stages[1].before, stages[0].after); assert.deepEqual(stages[1].after, binding.after);
  assert.equal(stages[1].guard.subjectId, 201); assert.equal(stages[1].guard.prepared.collection.rate, 9);
  assert.equal(stages[1].guard.prepared.collection.chapters, 1); assert.equal(binding.guard.prepared.collection.rate, 8);
  assert.deepEqual(stages.map(stage => writeRateRequests('update_subject_collection', stage.args)[0].count), [1, 1]);
  for (const args of [{ subject_id: 201, rating: 9 }, { subject_id: 201, ep_status: 7 }]) {
    assert.equal(splitWriteStages('update_subject_collection', { ...binding, args }).length, 1);
  }
  const single = splitWriteStages('update_single_episode_collection', { ...episodeBinding(1), args: { episode_id: 501, collection_type: 2, batch: true } });
  assert.equal(single.length, 1); assert.equal(single[0].args.batch, true);
});

test('阶段回执按原章节顺序聚合，完整成功仍绑定全部原对象范围', async () => {
  const binding = episodeBinding(); const stages = splitWriteStages('update_episode_collection', binding);
  const initial = new SubmissionTracker('update_episode_collection', binding.args, 42, 201).failed(); let merged = initial;
  for (const [offset, stage] of stages.entries()) {
    const receipt = await stageReceipt('update_episode_collection', stage.args, 'episode_collection');
    checkSubmission('update_episode_collection', receipt, stage.args, 42, 201, stage.guard.prepared);
    merged = mergeStageSubmission(merged, receipt, offset);
    checkSubmission('update_episode_collection', merged, binding.args, 42, 201, binding.guard.prepared);
    assert.equal(merged.submissionState, offset === stages.length - 1 ? 'acknowledged' : 'partial');
  }
  assert.deepEqual(initial.items.map(item => item.submissionState), Array(25).fill('not_attempted'));
  assert.deepEqual(merged.items.map(item => item.target.id), binding.args.episode_ids);
  checkOutput(resourceOutputSchema('update_episode_collection'), { error: { code: 'OFFLINE_TEST', message: '仅检查回执闭合契约', submission: merged } });
});

test('阶段中断保留partial、rejected或unknown并停止后续，不丢失拒绝证据', async () => {
  for (const outcome of ['rejected', 'unknown', 'not_attempted']) {
    const binding = episodeBinding(3); const stages = splitWriteStages('update_episode_collection', binding);
    const initial = new SubmissionTracker('update_episode_collection', binding.args, 42, 201).failed();
    const first = await stageReceipt('update_episode_collection', stages[0].args, 'episode_collection');
    let merged = mergeStageSubmission(initial, first, 0);
    const next = await stageReceipt('update_episode_collection', stages[1].args, 'episode_collection', outcome);
    merged = mergeStageSubmission(merged, next, 1); assert.equal(merged.submissionState, 'partial');
    assert.deepEqual(merged.items.map(item => item.submissionState), ['acknowledged', outcome, 'not_attempted']);
    checkSubmission('update_episode_collection', merged, binding.args, 42, 201, binding.guard.prepared);
    const later = await stageReceipt('update_episode_collection', stages[2].args, 'episode_collection');
    assert.throws(() => mergeStageSubmission(merged, later, 2), { code: 'MCP_INVALID_RESULT' });
    if (outcome === 'rejected') assert.deepEqual(merged.items[1].rejection, next.items[0].rejection);
    const halted = mergeStageSubmission(initial, await stageReceipt('update_episode_collection', stages[0].args, 'episode_collection', outcome), 0);
    assert.equal(halted.submissionState, outcome); checkSubmission('update_episode_collection', halted, binding.args, 42, 201, binding.guard.prepared);
  }
});

test('两个收藏阶段聚合保留完整requestedFields，创建与关系ID同步到原回执', async () => {
  const binding = subjectBinding(); const stages = splitWriteStages('update_subject_collection', binding);
  let merged = new SubmissionTracker('update_subject_collection', binding.args, 42, 201).failed();
  for (const [offset, stage] of stages.entries()) merged = mergeStageSubmission(merged, await stageReceipt('update_subject_collection', stage.args, offset === 0 ? 'subject_collection' : 'book_progress'), offset);
  checkSubmission('update_subject_collection', merged, binding.args, 42, 201); assert.equal(merged.submissionState, 'acknowledged');
  assert.deepEqual(merged.requestedFields, ['rating', 'comment', 'ep_status', 'vol_status']);
  const createArgs = { title: '离线目录' }, create = new SubmissionTracker('create_index', createArgs, 42).failed();
  const created = mergeStageSubmission(create, await stageReceipt('create_index', createArgs, 'index_create'), 0);
  assert.equal(created.createdId, 104345); assert.deepEqual(created.target, { kind: 'index', id: 104345 }); checkSubmission('create_index', created, createArgs, 42);
  const relationArgs = { index_id: 104345, subject_id: 201 }, tracker = new SubmissionTracker('add_subject_to_index', relationArgs, 42);
  await tracker.submit('/p1/indexes/104345/related', 'PUT', async () => ({}));
  const added = mergeStageSubmission(new SubmissionTracker('add_subject_to_index', relationArgs, 42).failed(), tracker.finish({ id: 901 }), 0);
  assert.equal(added.relatedId, 901); assert.equal(added.target.relationId, 901); assert.equal(added.items[0].target.relationId, 901);
  checkSubmission('add_subject_to_index', added, relationArgs, 42);
});

test('聚合拒绝错账户、错章节、重复回执和乱序，官方看到此集保留完整影响范围', async () => {
  const binding = episodeBinding(2), stages = splitWriteStages('update_episode_collection', binding);
  const initial = new SubmissionTracker('update_episode_collection', binding.args, 42, 201).failed();
  const first = await stageReceipt('update_episode_collection', stages[0].args, 'episode_collection');
  assert.throws(() => mergeStageSubmission(initial, { ...first, expectedAccountId: 43 }, 0), { code: 'MCP_INVALID_RESULT' });
  assert.throws(() => mergeStageSubmission(initial, first, 1), { code: 'MCP_INVALID_RESULT' });
  const merged = mergeStageSubmission(initial, first, 0);
  assert.throws(() => mergeStageSubmission(merged, first, 0), { code: 'MCP_INVALID_RESULT' });
  const wrong = structuredClone(first); wrong.items[0].target.id = 999;
  assert.throws(() => mergeStageSubmission(initial, wrong, 0), { code: 'MCP_INVALID_RESULT' });
  const args = { episode_id: 502, collection_type: 2, batch: true }, tracker = new SubmissionTracker('update_single_episode_collection', args, 42, 201);
  tracker.episodeScope([501, 502]); await tracker.submit('/p1/collections/episodes/502', 'PATCH', async () => ({}));
  const until = mergeStageSubmission(new SubmissionTracker('update_single_episode_collection', args, 42, 201).failed(), tracker.finish({}), 0);
  assert.deepEqual(until.affectedEpisodeIds, [501, 502]); checkSubmission('update_single_episode_collection', until, args, 42, 201);
});

test('硬中断前序ack加当前unknown不能沿用旧notattempted投影并误判部分结案', async () => {
  for (const name of ['update_episode_collection', 'update_subject_collection']) {
    const binding = name === 'update_episode_collection' ? episodeBinding(3) : subjectBinding();
    const stages = splitWriteStages(name, binding);
    let submission = new SubmissionTracker(name, binding.args, 42, 201).failed();
    submission = mergeStageSubmission(submission, await stageReceipt(name, stages[0].args, name === 'update_episode_collection' ? 'episode_collection' : 'subject_collection'), 0);
    const current = new SubmissionTracker(name, stages[1].args, 42, 201).failed();
    current.items[0].submissionState = 'unknown'; current.submissionState = 'unknown';
    submission = mergeStageSubmission(submission, current, 1);
    const fact = { tool: name, phase: 'started', state: 'unknown', target: binding.target, before: binding.before, after: binding.after, submission };
    assert.equal(pendingWriteFact(fact), true);
    const projected = submittedWriteTarget(name, fact);
    const actual = name === 'update_episode_collection'
      ? { ...structuredClone(binding.before), episodes: [binding.after.episodes[0], ...structuredClone(binding.before.episodes.slice(1))] }
      : structuredClone(stages[0].after);
    const verification = verifyWrittenState(name, binding.before, projected, actual, binding.target);
    assert.equal(verification.requestedStateMatched, false, 'fresh read仅看到前序成功，不能证明当前未知请求未生效');
    if (name === 'update_episode_collection') {
      assert.deepEqual(projected.episodes.map(row => row.collection_type), [2, 2, 0], '当前未知阶段必须保留目标，只有确实未派发的后续阶段回退原值');
    } else assert.deepEqual(projected, binding.after, '当前书籍PATCH未知不能恢复成第一阶段后的中间值');
  }
});
