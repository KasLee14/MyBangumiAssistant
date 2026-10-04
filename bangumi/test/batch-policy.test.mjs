import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, SchemaInputError } from '../dist/src/support/errors.js';
import { isBatchFatal, batchEffectKeys, batchDependencyKeys } from '../dist/src/mcp/batch-policy.js';
import { confirmationForPlan } from '../dist/src/mcp/confirmation-policy.js';
import { formatWritePreview } from '../dist/src/mcp/write-preview.js';
import { formatBatchFeedback } from '../dist/src/mcp/batch-display.js';

test('预检局部404可跳过，认证/权限范围和契约错误始终撤销整批', () => {
  assert.equal(isBatchFatal(new AppError('BGM_HTTP_404', '当前不可见'), 'preflight'), false);
  assert.equal(isBatchFatal(new AppError('BGM_NETWORK', '未取得预检'), 'preflight'), true);
  for (const code of ['CANCELLED', 'ACCOUNT_CHANGED', 'BGM_HTTP_401', 'NSFW_SCOPE_CHANGED', 'MCP_INVALID_RESULT', 'WRITE_JOURNAL_INVALID']) {
    for (const phase of ['preflight', 'execute', 'verification']) assert.equal(isBatchFatal(new AppError(code, code), phase), true);
  }
  assert.equal(isBatchFatal(new SchemaInputError([]), 'preflight'), true);
  assert.equal(isBatchFatal(new DOMException('已取消', 'AbortError'), 'execute'), true);
  assert.equal(isBatchFatal('异常值', 'execute'), true);
});

test('终端反馈说明复合子项部分完成与缺口，不把提交阶段当成功', () => {
  const feedback = formatBatchFeedback({ state: 'partial', summary: { failed: 1 }, items: [{ step: 4, state: 'failed', stageResults: [
    { stage: 1, state: 'success', target: { id: 501 } }, { stage: 2, state: 'skipped', target: { id: 502 }, reason: '当前权限不可见' },
  ] }] });
  assert.match(feedback, /子项：已核实 1，跳过 1/); assert.match(feedback, /第 4 步 子项 2.*502.*当前权限不可见/);
  assert.match(formatBatchFeedback({ state: 'running', summary: { submitted: 3 } }), /已提交待核实 3 项/);
});

test('不同目录关系的修改域独立，目录和父收藏保护仍参与依赖', () => {
  const target = { kind: 'indexSubject', indexId: 500, subjectId: 101 };
  assert.deepEqual(batchEffectKeys('add_subject_to_index', { index_id: 500, subject_id: 101 }, target), ['relation:500:101']);
  assert.deepEqual(batchDependencyKeys('add_subject_to_index', { index_id: 500, subject_id: 101 }, target), ['relation:500:101', 'index:500']);
  assert.deepEqual(batchDependencyKeys('update_episode_collection', { subject_id: 101, episode_ids: [1, 2] }, { subjectId: 101 }), ['episode:1', 'episode:2', 'subject:101']);
});

test('过滤错误项不降级原批量确认，预览保留原步骤和跳过原因', () => {
  const create = { name: 'create_index', stepId: 3, target: { kind: 'newIndex' }, before: null, after: { title: '季度', description: '', private: false }, args: { title: '季度' }, effects: [] };
  assert.deepEqual(confirmationForPlan([create], ['collect_person', 'create_index']), { required: true, reasons: ['批量修改完整范围'] });
  const add = { name: 'add_subject_to_index', stepId: 5, target: { kind: 'indexSubject', indexId: -3, subjectId: 101, name: '正常作品', title: '季度' }, before: null, after: { subject_id: 101, order: 1, comment: '' }, effects: [] };
  const preview = formatWritePreview({ username: 'test' }, [create, add], [{ step: 4, tool: 'add_subject_to_index', target: { subjectId: 404 }, reason: '当前权限不可见' }]);
  assert.match(preview, /新目录《季度》/); assert.match(preview, /第 4 步.*作品 #404.*当前权限不可见/);
  assert.match(preview, /未知结果不重发/); assert.doesNotMatch(preview, /新目录undefined/);
});
