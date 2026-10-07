import test from 'node:test';
import assert from 'node:assert/strict';
import { projectBatchResult } from '../dist/src/mcp/batch-write.js';
import { SubmissionError } from '../dist/src/support/errors.js';

test('批量投影保留未知提交和回读状态，完整正文与基线不进入模型', () => {
  const value = { state: 'partial', partial: true, summary: { success: 1, unknown: 1 },
    items: [{ step: 1, tool: 'update_subject_collection', state: 'success', verification: 'verified',
      target: { kind: 'subject', id: 123, name: '后端名称', summary: '后端简介' },
      actual: { collectionStatus: 2, personalRating: 8, comment: '保留在宿主的长短评', tags: ['后端完整标签'] },
      baseline: { summary: '不能进入模型的基线' } },
    { step: 2, tool: 'collect_person', state: 'unknown', verification: 'unknown', target: { kind: 'person', id: 456 },
      writeNetworkAttempted: true, error: { code: 'BGM_TIMEOUT', message: '结果未知，独立核实', diagnostic: { raw: '不能进入模型' } } }],
    failures: [{ step: 2, tool: 'collect_person', error: { code: 'BGM_TIMEOUT', message: '结果未知' } }] };
  const projected = projectBatchResult(value);
  assert.deepEqual(projected.summary, value.summary);
  assert.equal(projected.items[1].state, 'unknown'); assert.equal(projected.items[1].verification, 'unknown');
  assert.equal(projected.items[1].writeNetworkAttempted, true); assert.equal(projected.items[1].error.code, 'BGM_TIMEOUT');
  assert.deepEqual(projected.items[0].actual, { collectionStatus: 2, personalRating: 8 });
  assert.equal(JSON.stringify(projected).includes('不能进入模型'), false);
  assert.equal(JSON.stringify(projected).includes('保留在宿主'), false);
  assert.equal(value.items[0].actual.comment, '保留在宿主的长短评');
});

test('章节逐阶段失败不被聚合状态遮掉，依赖的真实目标身份保留', () => {
  const projected = projectBatchResult({ state: 'failed', items: [{ step: 1, target: { kind: 'episode', id: 501, subjectId: 123 },
    state: 'failed', stageResults: [{ state: 'success', target: { kind: 'episode', id: 501, subjectId: 123 } },
      { state: 'failed', target: { kind: 'episode', id: 502, subjectId: 123 }, error: { code: 'READBACK_MISMATCH', message: '核实不一致' } }] }] });
  assert.equal(projected.items[0].stageResults[1].state, 'failed');
  assert.equal(projected.items[0].stageResults[1].error.code, 'READBACK_MISMATCH');
  assert.equal(projected.items[0].stageResults[1].target.subjectId, 123);
});

test('回读核实三项事实与差异字段保留，缓存引用不混进固定提交异常回执', () => {
  const verification = { state: 'failed', readbackCompleted: true, requestedStateMatched: false, protectedFieldsMatched: true, mismatchedFields: ['rating'] };
  assert.deepEqual(projectBatchResult({ items: [{ verification }] }).items[0].verification, verification);
  const receipt = { schemaVersion: 1, kind: 'submission', tool: 'create_index', items: [], createdId: 123,
    resourceRef: `rr_${'a'.repeat(32)}` };
  const error = new SubmissionError('BGM_NETWORK', '提交后连接中断', receipt);
  assert.equal(error.submission.resourceRef, undefined); assert.equal(error.submission.createdId, 123);
  assert.ok(receipt.resourceRef);
});
