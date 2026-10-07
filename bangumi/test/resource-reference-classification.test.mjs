import assert from 'node:assert/strict';
import test from 'node:test';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { withProviderFetch } from '../dist/src/pi-host.js';
import { ContentOutputError } from '../dist/src/output/content-schema.js';
import { bindResourceResolver } from '../dist/src/output/resource-content.js';
import { CONTENT_OUTPUT_INSTRUCTION } from '../dist/src/output/provider-content.js';
import { RecoveryController } from '../dist/src/output/recovery.js';
import { attachOutputCheckpoint, outputCheckpoint } from '../dist/src/output/recovery-checkpoint.js';
import { AppError, diagnosedError } from '../dist/src/support/errors.js';
import { assistantErrorDiagnostic, createErrorDiagnostic, withAssistantDiagnostic } from '../dist/src/support/error-diagnostic.js';

const completeCards = ids => ({ type: 'SubjectCards', pending: false, props: { layout: 'grid', items: ids.map(id => ({ id, name: `作品${id}`, kind: 'anime' })) } });
const message = (content, stopReason = 'stop') => ({ ...fauxAssistantMessage('', { stopReason }), content });
const diagnostic = (reason, code = 'CONTENT_SCHEMA_INVALID') => createErrorDiagnostic({ code, reason, origin: 'content', stage: 'validate', recovery: 'repair_component' });
const feedback = result => JSON.parse(result.entries.find(entry => entry.customType === 'bangumi/recovery-feedback').content);

test('ContentOutputError增加路径后仍保存原始cause、诊断和工具来源', () => {
  const cause = new AppError('CANDIDATE_STAGE_INCOMPLETE', '候选还有17条未处理');
  const source = createErrorDiagnostic({ code: cause.code, reason: 'stage_incomplete', origin: 'domain', stage: 'validate', operation: 'refine_subject_candidates' });
  const error = new ContentOutputError('引用读取失败', 'schema', [], [{ path: '/props/resourceRef', rule: 'resource_reference', message: '候选还有17条未处理' }],
    'resource_reference_stage_incomplete', { cause, diagnostic: source, sourceTool: 'refine_subject_candidates' });
  error.location = { offset: 20, line: 2, column: 4 };
  const moved = error.at('/content/1');
  assert.equal(moved.cause, cause); assert.equal(moved.diagnostic, source); assert.equal(moved.sourceTool, 'refine_subject_candidates');
  assert.equal(moved.issueDetails[0].path, '/content/1/props/resourceRef'); assert.deepEqual(moved.location, error.location);
});

for (const [code, reason] of [
  ['RESOURCE_EXPIRED', 'resource_reference_refresh_required'],
  ['RESOURCE_VERSION_CHANGED', 'resource_reference_refresh_required'],
  ['CANDIDATE_STAGE_INCOMPLETE', 'resource_reference_stage_incomplete'],
  ['CANDIDATE_REQUIRED_FACTS_MISSING', 'resource_reference_stage_incomplete'],
  ['ACCOUNT_CHANGED', 'resource_reference_access_denied'],
  ['NSFW_SCOPE_CHANGED', 'resource_reference_access_denied'],
  ['RESOURCE_SCOPE_MISMATCH', 'resource_reference_access_denied'],
  ['MCP_TRANSPORT_ERROR', 'resource_reference_unavailable'],
  ['INTERNAL_ERROR', 'resource_reference_unavailable'],
]) test(`真实provider流边界保留${code}并分类为${reason}`, async () => {
  const faux = fauxProvider({ api: 'openai-responses', provider: `reference-classify-${code}`, tokenSize: { min: 1, max: 2 } });
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ content: [{ type: 'text', text: '已完成部分' },
    { type: 'SubjectCards', props: { resourceRef: 'rr_classification', items: [{ id: 1 }] } }] }))]);
  const cause = diagnosedError(new AppError(code, '本地缓存读取未完成'), createErrorDiagnostic({ code, reason: 'cached_read_failed', origin: 'mcp', stage: 'execution',
    operation: 'refine_subject_candidates', evidence: { networkAttempted: false }, causes: [{ name: 'AppError', code }] }));
  Object.defineProperty(cause, 'sourceTool', { value: 'refine_subject_candidates' });
  const transcript = { messages: [{ role: 'system', content: CONTENT_OUTPUT_INSTRUCTION, timestamp: 1 }] };
  bindResourceResolver(transcript, async () => { throw cause; });
  let terminal;
  for await (const event of withProviderFetch(faux.provider).streamSimple(faux.getModel(), transcript, {})) terminal = event;
  assert.equal(terminal.type, 'error');
  const error = assistantErrorDiagnostic(terminal.error);
  assert.equal(error.reason, reason); assert.equal(error.operation, 'refine_subject_candidates');
  assert.match(terminal.error.errorMessage, /缓存引用未能展开/); assert.doesNotMatch(terminal.error.errorMessage, /模型输出字段不符合/);
  assert.ok(error.causes.some(item => item.code === code)); assert.equal(error.evidence.networkAttempted, false);
  assert.equal(error.issues[0].path, '/content/1/props/resourceRef');
  assert.deepEqual(outputCheckpoint(terminal.error).prefix.map(part => part.type), ['text']);
  assert.equal(terminal.error.content.some(part => part.type === 'SubjectCards' && part.pending === false), false);
});

function host() {
  const handlers = new Map(); let activeTools = ['get_subject_details', 'continue_subject_query', 'prepare_candidate_output', 'search_subjects'];
  let final = message([]);
  const session = {
    agent: { streamFunction: () => ({ async *[Symbol.asyncIterator]() { yield { type: 'done', reason: 'stop', message: final }; } }) },
    abort: async () => {}, abortRetry: () => {},
    getActiveToolNames: () => [...activeTools], setActiveToolsByName: names => { activeTools = [...names]; },
  };
  const controller = new RecoveryController(() => ({ enabled: true, maxRetries: 2, baseDelayMs: 1 }));
  controller.bind(session); controller.register({ on: (name, callback) => handlers.set(name, callback) });
  const end = (assistant, toolResults = []) => handlers.get('turn_end')({ message: assistant, toolResults, messageEntryId: 'assistant-error' });
  return {
    session, end, tools: () => activeTools,
    remember: (tool, args, value) => end(fauxAssistantMessage([fauxToolCall(tool, args, { id: 'source-call' })], { stopReason: 'toolUse' }),
      [{ toolName: tool, toolCallId: 'source-call', details: { value } }]),
    fail: (reason, draft, prefix = []) => end(attachOutputCheckpoint(withAssistantDiagnostic(message(prefix, 'error'), diagnostic(reason)),
      { prefix, ...(draft ? { draft } : {}), jsonComplete: true, failureScope: 'host' })),
    finish: async parts => {
      final = message(parts); let terminal;
      const model = fauxProvider({ api: 'openai-responses', provider: 'recovery-host-classification' }).getModel();
      for await (const event of session.agent.streamFunction(model, { messages: [] }, {})) terminal = event;
      return terminal;
    },
  };
}

test('候选阶段未完成报告原引用的17条剩余，保留完整性缺口且不开放查询工具', () => {
  const h = host();
  h.remember('continue_subject_query', { candidate_ref: 'candidate-original', cursor: 'cc_original' }, {
    resourceRef: 'rr_incomplete', kind: 'candidate_continuation', result: { kind: 'candidate_page', resultRef: 'result-original', candidateRef: 'candidate-original',
      data: [{ id: 1 }], scope: { filter: { tag: ['百合'], rating: { min: 8 }, exclude_collection_types: [2] } },
      coverage: { complete: false, remainingCount: 17, pendingCount: 0 } },
  });
  const result = feedback(h.fail('resource_reference_stage_incomplete', { type: 'SubjectCards', props: { resourceRef: 'rr_incomplete' } }));
  assert.equal(result.goal.strategy, 'report_failure'); assert.match(result.goal.instruction, /候选阶段尚未完成/);
  assert.match(result.goal.instruction, /不能.*完整结果或任务已完成/); assert.deepEqual(h.tools(), []);
  assert.equal(result.scope[0].resultRef, 'result-original'); assert.equal(result.scope[0].coverage.remainingCount, 17);
});

test('必要展示事实缺失准确报告字段缺口，不从字段缺失猜测仍有未处理候选', () => {
  const h = host();
  const error = createErrorDiagnostic({ code: 'CONTENT_SCHEMA_INVALID', reason: 'resource_reference_stage_incomplete', origin: 'content', stage: 'validate',
    causes: [{ name: 'AppError', code: 'CANDIDATE_REQUIRED_FACTS_MISSING' }] });
  const f = feedback(h.end(attachOutputCheckpoint(withAssistantDiagnostic(message([], 'error'), error), { prefix: [], jsonComplete: true, failureScope: 'host' })));
  assert.equal(f.goal.strategy, 'report_failure'); assert.match(f.goal.instruction, /必要展示事实尚未核实完整/);
  assert.match(f.goal.instruction, /不能根据展示字段缺失推断还有未处理候选/); assert.deepEqual(h.tools(), []);
});

test('账户绑定失败和一般传输故障分别准确报告，均停止工具操作', () => {
  const access = host(), unavailable = host();
  const a = feedback(access.fail('resource_reference_access_denied'));
  const b = feedback(unavailable.fail('resource_reference_unavailable'));
  assert.equal(a.goal.strategy, 'report_failure'); assert.match(a.goal.instruction, /绑定不匹配/);
  assert.equal(b.goal.strategy, 'report_failure'); assert.match(b.goal.instruction, /内部或传输故障/);
  assert.doesNotMatch(b.goal.instruction, /无法在当前账户或权限下读取/);
  assert.deepEqual(access.tools(), []); assert.deepEqual(unavailable.tools(), []);
});

test('续查wrapper的来源、成员和原条件被固定登记，失效恢复仅允许同工具同参数的一次读取', async () => {
  const h = host(), args = { candidate_ref: 'candidate-original', cursor: 'cc_original', limit: 2 };
  h.remember('continue_subject_query', args, {
    resourceRef: 'rr_continuation', kind: 'candidate_continuation', result: { kind: 'candidate_page', resultRef: 'result-original', candidateRef: 'candidate-original',
      data: [{ id: 42 }, { id: 24 }], scope: { filter: { tag: ['百合'], rating: { min: 8 } } }, coverage: { complete: true, remainingCount: 0, pendingCount: 0 } },
  });
  const f = feedback(h.fail('resource_reference_refresh_required', { type: 'SubjectCards', props: { resourceRef: 'rr_continuation' } }));
  assert.equal(f.goal.strategy, 'replan_read'); assert.deepEqual(f.referenceSource.memberIds, [42, 24]);
  assert.deepEqual(f.referenceSource.args, args); assert.deepEqual(h.tools(), ['continue_subject_query']);
  const changed = await h.session.agent.beforeToolCall({ toolCall: { name: 'continue_subject_query' }, args: { ...args, limit: 3 } });
  assert.equal(changed.block, true);
  assert.equal(await h.session.agent.beforeToolCall({ toolCall: { name: 'continue_subject_query' }, args }), undefined);
  const duplicate = await h.session.agent.beforeToolCall({ toolCall: { name: 'continue_subject_query' }, args });
  assert.equal(duplicate.block, true); assert.match(duplicate.reason, /不能重复请求/);
});

for (const kind of ['DataTable', 'InfoBox', 'TagCloud', 'LinkList', 'StatsCard', 'Timeline']) test(`${kind}缺少宿主可核验的成员顺序时拒绝定向重读，不能以同查询参数替换成员`, () => {
  const h = host();
  h.remember('search_subjects', { keyword: '百合', subject_type: 2, sort: 'rank', limit: 2 }, {
    resourceRef: 'rr_search_window', data: [{ id: 1 }, { id: 2 }],
  });
  const f = feedback(h.fail('resource_reference_refresh_required', { type: kind, props: { resourceRef: 'rr_search_window', items: [{ id: 1 }, { id: 2 }] } }));
  assert.equal(f.goal.strategy, 'report_failure'); assert.equal(f.referenceSource, undefined); assert.deepEqual(h.tools(), []);
  assert.match(f.goal.instruction, /不能由宿主可靠核验/);
});

for (const [reason, part] of [
  ['resource_reference_access_denied', completeCards([2])],
  ['resource_reference_unavailable', { type: 'Gallery', pending: false, props: { items: [{ id: 2, name: '替换作品' }] } }],
]) test(`${reason}报告不能夹带新inline ${part.type}偷换成员，已完成卡片仍由宿主保留`, async () => {
  const h = host(), prefix = [completeCards([1])];
  h.fail(reason, { type: 'SubjectCards', props: { resourceRef: 'rr_failed', items: [{ id: 2 }] } }, prefix);
  const terminal = await h.finish([part]);
  assert.equal(terminal.type, 'error'); assert.equal(assistantErrorDiagnostic(terminal.error).reason, 'recovery_result_invalid');
  assert.match(assistantErrorDiagnostic(terminal.error).issues[0].message, /仅允许text后缀/);
  assert.deepEqual(terminal.error.content, prefix); assert.deepEqual(outputCheckpoint(terminal.error).prefix, prefix);
});

test('失败报告text后缀能够保留已完成canonical卡片并说明未完成缺口', async () => {
  const h = host(), prefix = [completeCards([1])];
  h.fail('resource_reference_stage_incomplete', undefined, prefix);
  const terminal = await h.finish([{ type: 'text', nextType: null, text: '原范围尚有17条未处理，本次展示未完成。' }]);
  assert.equal(terminal.type, 'done'); assert.deepEqual(terminal.message.content[0], prefix[0]);
  assert.match(terminal.message.content[1].text, /未完成/);
});

test('模型投影只有准备计数和部分理由时不能猜全体成员或开放失效引用重读', () => {
  const h = host();
  h.remember('prepare_candidate_output', { candidate_ref: 'result-original', format: 'subject_cards', reasons: [{ subject_id: 1, reason: '理由' }] }, {
    resourceRef: 'rr_projected', kind: 'candidate_output', format: 'subject_cards', candidateRef: 'result-original',
    scope: { reasons: [{ subject_id: 1, reason: '理由' }] }, counts: { memberCount: 2, preparedCount: 2, remainingCount: 0 },
  });
  const f = feedback(h.fail('resource_reference_refresh_required', { type: 'SubjectCards', props: { resourceRef: 'rr_projected' } }));
  assert.equal(f.goal.strategy, 'report_failure'); assert.equal(f.referenceSource, undefined); assert.deepEqual(h.tools(), []);
});

test('已准备canonical快照的全体计数与成员身份一致时，恢复必须保留原顺序', async () => {
  const h = host();
  h.remember('prepare_candidate_output', { candidate_ref: 'result-original', format: 'subject_cards' }, {
    resourceRef: 'rr_prepared', kind: 'candidate_output', format: 'subject_cards', candidateRef: 'result-original',
    counts: { memberCount: 3, preparedCount: 3, remainingCount: 0 }, presentation: { content: [completeCards([30, 10, 20])] },
  });
  h.fail('schema_invalid');
  const wrong = await h.finish([completeCards([30, 20, 10])]);
  assert.equal(wrong.type, 'error'); assert.equal(assistantErrorDiagnostic(wrong.error).reason, 'recovery_result_invalid');
  assert.match(assistantErrorDiagnostic(wrong.error).issues[0].message, /集合或顺序/);
});

test('定向引用读取后的组件修复仍保留原成员锁，修复阶段没有工具权限', async () => {
  const h = host();
  h.remember('get_subject_details', { subject_id: 1 }, { resourceRef: 'rr_one', id: 1, entity: 'subject' });
  h.fail('resource_reference_refresh_required', { type: 'SubjectCards', props: { resourceRef: 'rr_one', items: [{ id: 1 }] } });
  await h.session.agent.beforeToolCall({ toolCall: { name: 'get_subject_details' }, args: { subject_id: 1 } });
  const invalid = await h.finish([completeCards([2])]);
  assert.equal(invalid.type, 'error');
  const repaired = feedback(h.end(invalid.error));
  assert.equal(repaired.goal.strategy, 'repair_component'); assert.deepEqual(repaired.referenceSource.memberIds, [1]); assert.deepEqual(h.tools(), []);
  const valid = await h.finish([completeCards([1])]);
  assert.equal(valid.type, 'done'); assert.deepEqual(valid.message.content[0].props.items.map(item => item.id), [1]);
});

test('定向恢复合法原卡片之后也不能附加其他inline组件扩大成员范围', async () => {
  const h = host();
  h.remember('get_subject_details', { subject_id: 1 }, { resourceRef: 'rr_one', id: 1, entity: 'subject' });
  h.fail('resource_reference_refresh_required', { type: 'SubjectCards', props: { resourceRef: 'rr_one', items: [{ id: 1 }] } });
  const terminal = await h.finish([completeCards([1]), { type: 'Gallery', pending: false, props: { items: [{ id: 2, name: '新增作品' }] } }]);
  assert.equal(terminal.type, 'error'); assert.match(assistantErrorDiagnostic(terminal.error).issues[0].message, /不能附加其他组件扩大成员范围/);
});
