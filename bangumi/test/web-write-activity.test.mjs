import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { projectWriteActivity } from '../dist/src/web/write-activity.js';
import { fixture, eventually } from './web-fixture.mjs';

const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ value }) }], details: { value } });
const mixed = () => result({ state: 'partial', partial: true,
  summary: { success: 2, skipped: 1, failed: 0, unknown: 0, blocked: 1, not_executed: 0 }, items: [
    { step: 1, state: 'success', actual: { title: '不展示完整原值' } },
    { step: 2, state: 'skipped', target: { subjectId: 404, name: '不可见作品' }, reason: '当前可见范围未取得资源' },
    { step: 4, state: 'blocked', target: { indexId: 500 }, blockedBy: [3], reason: '前序依赖未完成' },
  ] });

test('批次部分完成以公开计数和原步骤缺口展示，不暴露完整JSON或保护快照', () => {
  const projected = projectWriteActivity(mixed(), true);
  assert.equal(projected.state, 'partial');
  assert.equal(projected.showDetail, true);
  assert.match(projected.detail, /已核实 2 项，已跳过 1 项，依赖阻塞 1 项/u);
  assert.match(projected.detail, /第 2 步 《不可见作品》：已跳过/u);
  assert.match(projected.detail, /第 4 步 对象 ID 500：依赖阻塞（依赖第 3 步）/u);
  assert.doesNotMatch(projected.detail, /actual|summary|不展示完整原值|\{"/u);
});

test('提交进度仍待核实，额度等待展示恢复时间与停止提示，未知独立展示', () => {
  const progress = projectWriteActivity(result({ state: 'running', summary: { submitted: 3 } }));
  assert.equal(progress.state, 'running'); assert.match(progress.detail, /已提交待核实 3 项/u);
  const waiting = projectWriteActivity(result({ state: 'running', phase: 'rate_limit_wait',
    summary: { submitted: 15 }, waiting: { action: 'IndexEdit', nextAllowedAt: Date.parse('2026-10-04T12:05:00Z') } }));
  assert.equal(waiting.state, 'waiting'); assert.match(waiting.detail, /目录编辑额度等待.*20:05:00.*香港时间/u);
  assert.match(waiting.detail, /可按 Esc 停止/u);
  const unknown = projectWriteActivity(result({ state: 'unknown', summary: { success: 1, unknown: 1 },
    items: [{ step: 2, state: 'unknown', target: { id: 42 }, verificationError: { code: 'BGM_NETWORK', message: '读取失败' } }] }), true);
  assert.equal(unknown.state, 'unknown'); assert.match(unknown.detail, /已核实 1 项.*结果待核实 1 项/u);
  assert.match(unknown.detail, /第 2 步.*读取失败/u);
});

test('复合子项及旧数据缺字段安全投影，零写入失败不显示完成', () => {
  const stage = projectWriteActivity(result({ state: 'partial', summary: { failed: 1 }, items: [{ step: 5, state: 'failed',
    stageResults: [{ stage: 1, state: 'success', target: { subjectId: 201, episodeIds: [501] } },
      { stage: 2, state: 'failed', target: { id: 502 }, submissionError: { message: '本集明确拒绝' } }] }] }), true);
  assert.equal(stage.state, 'partial'); assert.match(stage.detail, /子项：已核实 1 项，失败 1 项/u);
  assert.match(stage.detail, /子项 1：第 5 步 章节 ID 501：已核实/u);
  assert.match(stage.detail, /子项 2：第 5 步 对象 ID 502.*本集明确拒绝/u);
  const failure = projectWriteActivity(result({ state: 'failed', error: { message: '账户预检失败' } }), true);
  assert.equal(failure.state, 'error'); assert.match(failure.detail, /账户预检失败/u);
  assert.equal(projectWriteActivity({ content: [{ type: 'text', text: '普通结果' }] }, true), undefined);
  assert.equal(projectWriteActivity(result({ state: 'success', summary: { success: 2 } }), true).state, 'ok');
});

test('真实Pi工具更新经Web增量帧显示额度等待与最终部分完成，恢复历史保留结果', async t => {
  const f = await fixture(t, { toolName: 'execute_write_batch' });
  const stream = await f.stream('batch-tab');
  const sessionId = (await f.state('batch-tab')).sessionId;
  const gate = await f.begin('batch-tab', sessionId, '离线批反馈');
  gate.update(result({ state: 'running', phase: 'rate_limit_wait', summary: { submitted: 1 },
    waiting: { action: 'Subject', nextAllowedAt: Date.parse('2026-10-04T12:05:00Z') } }));
  await eventually(() => stream.frames.some(frame => frame.type === 'state' && frame.items.some(item => item.kind === 'tool' && item.state === 'waiting')));
  const waiting = (await f.state('batch-tab')).items.find(item => item.kind === 'tool');
  assert.match(waiting.result.text, /作品收藏额度等待/u);
  assert.ok(waiting.version > 1);
  gate.result = mixed(); gate.release.resolve();
  await f.initial.session.waitForIdle();
  const completed = (await f.state('batch-tab')).items.find(item => item.kind === 'tool');
  assert.equal(completed.state, 'partial'); assert.ok(completed.version > waiting.version);
  assert.match(completed.result.text, /第 2 步 《不可见作品》/u);
  const history = SessionManager.create(f.root, f.sessionDir);
  for (const entry of f.initial.session.sessionManager.buildContextEntries()) {
    if (entry.type === 'message') history.appendMessage(entry.message);
  }
  await f.manager.select('restored-batch', 'resume', { path: history.getSessionFile() });
  assert.equal(f.manager.selected('restored-batch').snapshot().items.find(item => item.kind === 'tool').state, 'partial');
});
