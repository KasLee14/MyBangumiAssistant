import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { AppError, safeError } from '../support/errors.js';
import { schemaArguments, type JsonSchema } from '../support/tool-schema.js';
import { TOOL_DEFINITIONS, validateToolArguments } from './catalog.js';
import { record, positive, type Data } from './resource-output.js';
import { advanceWriteView, submissionArguments, type Binding, type PlannedWrite, type WriteBoundary } from './write-boundary.js';
import { confirmationForPlan, type ConfirmationDecision } from './confirmation-policy.js';
import type { TraceHost } from '../tracing/schema.js';
import type { AccessContext } from './access-context.js';
import { Text } from '@earendil-works/pi-tui';
import { formatBatchFeedback } from './batch-display.js';
import { isBatchFatal } from './batch-policy.js';
import { operationTarget, planDependencies, rememberPlanEffects } from './batch-plan.js';

export const BATCH_TOOL_NAME = 'execute_write_batch';
const stepId: JsonSchema = { type: 'integer', minimum: 1, maximum: 200 };
const branches: JsonSchema[] = [];
for (const definition of TOOL_DEFINITIONS.filter(d => d.effect === 'write')) {
  branches.push({ type: 'object', properties: { tool: { type: 'string', const: definition.name }, args: structuredClone(definition.inputSchema) }, required: ['tool', 'args'], additionalProperties: false });
  if (Object.hasOwn(definition.inputSchema.properties as object ?? {}, 'index_id')) {
    const input = structuredClone(definition.inputSchema);
    delete (input.properties as Data).index_id;
    input.required = (input.required as string[]).filter(k => k !== 'index_id');
    branches.push({ type: 'object', properties: { tool: { type: 'string', const: definition.name }, args: input, index_from: stepId }, required: ['tool', 'args', 'index_from'], additionalProperties: false });
  }
}
export const BATCH_INPUT_SCHEMA: JsonSchema = {
  type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 200, items: { oneOf: branches } } }, required: ['operations'], additionalProperties: false,
};
export interface BatchOperation { tool: string; args: Data; index_from?: number }
/** 原始参数先校验封闭联合，再逐项使用原MCP契约校验；占位ID只用于已验证依赖。 */
export function validateBatchArguments(raw: unknown): { operations: BatchOperation[] } {
  const args = schemaArguments(BATCH_INPUT_SCHEMA, raw);
  const operations = (args.operations as BatchOperation[]).map(operation => {
    if (operation.index_from !== undefined) {
      const validated = submissionArguments(operation.tool, validateToolArguments(operation.tool, { ...operation.args, index_id: 1 }));
      delete validated.index_id;
      return { tool: operation.tool, args: validated, index_from: operation.index_from };
    }
    return { tool: operation.tool, args: submissionArguments(operation.tool, validateToolArguments(operation.tool, operation.args)) };
  });
  operations.forEach((operation, i) => {
    if (operation.index_from !== undefined && (operation.index_from > i || operations[operation.index_from - 1]?.tool !== 'create_index')) throw new AppError('INVALID_INPUT', 'index_from必须引用本批前面某个create_index操作的序号（从1开始）。');
  });
  return { operations };
}
function output(value: Data): AgentToolResult<unknown> { return { content: [{ type: 'text', text: JSON.stringify({ value }) }], details: { value } }; }
function visibleTarget(target: Data): Data {
  const value = structuredClone(target);
  const key = value.kind === 'index' ? 'id' : 'indexId';
  if (typeof value[key] === 'number' && Number(value[key]) < 0) { value.indexFrom = -Number(value[key]); delete value[key]; }
  return value;
}
function visibleOutcome(value: Data): Data {
  return { ...value, ...(value.target ? { target: visibleTarget(record(value.target)) } : {}),
    ...(Array.isArray(value.stageResults) ? { stageResults: value.stageResults.map(raw => visibleOutcome(record(raw))) } : {}) };
}
function summary(items: Data[]): Data {
  return Object.fromEntries(['success', 'submitted', 'unchanged', 'skipped', 'failed', 'unknown', 'blocked', 'not_executed'].map(state => [state, items.filter(i => i.state === state).length]));
}
function writesAttempted(items: Data[]): boolean {
  return items.some(item => item.writeNetworkAttempted === true || item.writeNetworkAttempted === undefined && item.networkAttempted === true);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

/** 一个Pi工具调用内完成计划与执行；不持久化授权、不增加MCP能力、不维护对话状态机。 */
export function createBatchWriteTool(boundary: WriteBoundary, onRecord: (value: Data) => void, trace?: TraceHost): ToolDefinition {
  let generation: number | undefined;
  const completed = new Map<string, AgentToolResult<unknown>>();
  return {
    name: BATCH_TOOL_NAME, label: '执行修改计划',
    description: '所有写入的完整计划入口：单项也提交一条operation；章节操作不计入批量审批数量，发布或修改作品短评及多个非章节操作由宿主一次确认。整批统一核实账户、NSFW及对象基线，完整预览可执行与跳过范围后一次授权，按冻结计划提交并独立回读最终状态。局部预检错误记skipped，前置失败记blocked，其余安全项继续；写入404等普通错误保留unknown，不认定未生效、不重发。目录不同作品经保护核查可继续，同对象依赖及未核实冲突范围阻断；取消、账户/权限/授权失效或通道/账本故障停止整批。支持混合收藏/评分/标签/章节/角色/人物/目录操作，每项tool及args使用原固定契约。新目录依赖用index_from引用本批前面的create_index原序号（从1开始），跳过不改变编号；该项省略index_id。先解决歧义并收齐最终正文，提交后不能追加计划。仅按items.verification/actual与stageResults报告实际成功、跳过、阻断、失败及未知，不把submitted或底层submission.verification=pending当成功。failures列全部缺口，failure兼容第一项；networkAttempted/writeNetworkAttempted只表示写入尝试。按accessContext报告NSFW权限。',
    parameters: structuredClone(BATCH_INPUT_SCHEMA) as ToolDefinition['parameters'], executionMode: 'sequential',
    prepareArguments: validateBatchArguments,
    renderCall: args => { const operations = args && typeof args === 'object' ? (args as Data).operations : undefined;
      return new Text(`执行修改计划：${Array.isArray(operations) ? operations.length : 0} 项`, 0, 0); },
    renderResult: result => new Text(formatBatchFeedback(record(result.details ?? {}).value), 0, 0),
    async execute(toolCallId, raw, signal, onUpdate, ctx) {
      let token: object | undefined; let fingerprint: string | undefined; let accountId: number | undefined; let started = false;
      let items: Data[] = [];
      let confirmation: ConfirmationDecision | undefined;
      let accessContext: AccessContext | undefined;
      let originalRequestId: string | undefined;
      let phase = 'validation';
      let active: Data | undefined;
      let settled = false;
      let steps: PlannedWrite[] = [];
      const failures: Data[] = [];
      const addFailure = (item: Data, stage: string) => {
        const error = item.error ?? item.submissionError ?? item.verificationError;
        const diagnostic = error && typeof error === 'object' ? error as Data : {};
        failures.push({ phase: stage, step: item.step, tool: item.tool, target: item.target,
          ...(diagnostic.sourceTool ? { sourceTool: diagnostic.sourceTool } : {}), ...(error ? { error } : {}) });
      };
      const settle = async () => {
        if (!token || settled) return;
        const results = await boundary.finishApproved(token);
        settled = true;
        results.forEach((value, i) => {
          const step = Number(value.step ?? steps[i]?.stepId ?? i + 1);
          if (items[step - 1]) items[step - 1] = { ...items[step - 1], ...visibleOutcome(value), step };
        });
        accessContext = results.find(value => value.accessContext)?.accessContext as AccessContext | undefined ?? accessContext;
      };
      try {
        const { operations } = validateBatchArguments(raw);
        const input = { ...boundary.getInput() };
        originalRequestId = input.requestId;
        if (generation !== input.generation) { generation = input.generation; completed.clear(); }
        phase = 'preflight';
        const viewer = await boundary.beginBatch(signal);
        accountId = positive(viewer.id); accessContext = viewer.accessContext as AccessContext | undefined;
        fingerprint = createHash('sha256').update(JSON.stringify(stable({ accountId, operations }))).digest('hex');
        const cached = completed.get(fingerprint); if (cached) return cached;
        items = operations.map((operation, i) => ({ step: i + 1, tool: operation.tool, target: operationTarget(operation.tool, operation.args, operation.index_from),
          state: 'not_executed', networkAttempted: false, writeNetworkAttempted: false }));
        const hints = operations.map(operation => Number(operation.args.index_id)).filter(id => Number.isSafeInteger(id) && id > 0);
        await boundary.assertReady(ctx, input, accountId, signal, [...new Set(hints)], operations.map((op, i) => ({ ...op, stepId: i + 1 })));
        const recoveryBlocked = new Set(boundary.recoveryBlockedSteps());
        const recoveredTargets = boundary.recoveryTargets();
        const recoveredCreates = new Set(operations.flatMap((operation, i) => operation.tool === 'create_index' && recoveredTargets.some(target => isDeepStrictEqual(operation.args, target.args)) ? [i + 1] : []));
        const previous = boundary.recordedRequest(ctx, input);
        if (previous) {
          return output({ state: 'failed', error: safeError(new AppError('BATCH_ALREADY_RECORDED', '此真实用户请求已有提交事实，不能重放或恢复旧授权；新的用户请求会重新核实基线并形成新计划。')),
            prior: { phase: previous.phase, state: previous.state, requestId: previous.requestId, batchId: previous.batchId, accountId: previous.accountId }, networkAttempted: false, writeNetworkAttempted: false });
        }
        const view = new Map<string, unknown>(); const initial = new Map<string, unknown>();
        const previousEffects = new Map<string, number>();
        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i]!;
          active = { step: i + 1, tool: operation.tool,
            ...(operation.args.subject_id === undefined ? {} : { subjectId: operation.args.subject_id }),
            ...(operation.args.episode_id === undefined ? {} : { episodeId: operation.args.episode_id }),
            ...(operation.args.index_id === undefined ? {} : { indexId: operation.args.index_id }) };
          const args = { ...operation.args, ...(operation.index_from === undefined ? {} : { index_id: -operation.index_from }) };
          const rawTarget = operationTarget(operation.tool, args);
          const blockedBy = operation.index_from && ['skipped', 'blocked'].includes(String(items[operation.index_from - 1]?.state)) ? [operation.index_from] : [];
          if (recoveryBlocked.has(i + 1) || recoveredCreates.has(i + 1) || blockedBy.length) {
            const code = recoveredCreates.has(i + 1) ? 'RECOVERED_CREATE_REPLAN_REQUIRED' : recoveryBlocked.has(i + 1) ? 'PREVIOUS_WRITE_UNKNOWN' : 'DEPENDENCY_BLOCKED';
            const reason = recoveredCreates.has(i + 1) ? '原目录已创建，请用恢复结果中的真实目录ID规划剩余项，本次不重复创建。'
              : recoveryBlocked.has(i + 1) ? '该对象有尚未核实的旧修改，已阻断关联步骤。' : '所依赖的新目录创建不可执行。';
            items[i] = { ...items[i], state: 'blocked', reason, blockedBy, error: safeError(new AppError(code, reason)) }; addFailure(items[i]!, phase); continue;
          }
          try {
            const candidate = structuredClone(view);
            const binding: Binding = await boundary.prepare(operation.tool, args, accountId, signal, candidate);
            if (binding.preflightSkipped?.length) {
              items[i] = { ...items[i], preflightSkipped: structuredClone(binding.preflightSkipped) };
              for (const child of binding.preflightSkipped) addFailure({ ...items[i], target: child.target, error: child.error }, phase);
              if (operation.tool === 'update_episode_collection' && !(binding.args.episode_ids as number[]).length) {
                items[i] = { ...items[i], state: 'skipped', reason: '所有指定章节预检失败，本次未尝试章节写入。', stageResults: binding.preflightSkipped };
                rememberPlanEffects(operation.tool, args, rawTarget, i + 1, previousEffects); continue;
              }
            }
            const step: PlannedWrite = { name: operation.tool, binding, stepId: i + 1, ...(operation.tool === 'create_index' ? { createdIndex: -(i + 1) } : {}) };
            step.dependsOn = planDependencies(step, previousEffects);
            const unavailable = step.dependsOn.filter(id => ['skipped', 'blocked'].includes(String(items[id - 1]?.state)));
            if (unavailable.length) {
              items[i] = { ...items[i], state: 'blocked', blockedBy: unavailable, reason: '前置操作预检失败，后续不能使用其预测状态。' }; addFailure(items[i]!, phase); continue;
            }
            for (const [key, value] of binding.baseline ?? []) if (!initial.has(key) && !steps.some(s => s.createdIndex !== undefined && (key === `index:${s.createdIndex}` || key === `relations:${s.createdIndex}`))) initial.set(key, structuredClone(value));
            advanceWriteView(candidate, step, accountId);
            view.clear(); for (const [key, value] of candidate) view.set(key, value);
            steps.push(step); rememberPlanEffects(operation.tool, args, binding.target, i + 1, previousEffects);
            items[i] = { ...items[i], target: visibleTarget(binding.target) };
          } catch (error) {
            if (isBatchFatal(error, 'preflight')) throw error;
            const diagnostic = safeError(error); accessContext = diagnostic.accessContext ?? accessContext;
            items[i] = { ...items[i], state: 'skipped', reason: diagnostic.message, error: diagnostic };
            rememberPlanEffects(operation.tool, args, rawTarget, i + 1, previousEffects); addFailure(items[i]!, phase);
          }
          onUpdate?.(output({ state: 'running', phase: 'preflight', summary: summary(items), completedSteps: i + 1, totalSteps: operations.length }));
        }
        // 用户请求创建并加入作品，但全部添加项不可执行时，不产生无用空目录。
        const emptyCreates = new Set(steps.filter(step => step.name === 'create_index' && operations.some(op => op.tool === 'add_subject_to_index' && op.index_from === step.stepId)
          && !steps.some(child => child.name === 'add_subject_to_index' && Number(child.binding.args.index_id) === -step.stepId!)).map(step => step.stepId!));
        steps = steps.filter(step => {
          const empty = emptyCreates.has(step.stepId!) || (step.dependsOn ?? []).some(id => emptyCreates.has(id));
          if (empty) { const i = step.stepId! - 1;
            const blockedBy = emptyCreates.has(step.stepId!) ? operations.flatMap((op, at) => op.tool === 'add_subject_to_index' && op.index_from === step.stepId ? [at + 1] : [])
              : (step.dependsOn ?? []).filter(id => emptyCreates.has(id));
            items[i] = { ...items[i], state: 'blocked', reason: '没有可加入的作品，本次不创建空目录。', blockedBy }; addFailure(items[i]!, phase); }
          return !empty;
        });
        if (!steps.length) return output({ state: 'failed', partial: false, summary: summary(items), items, failures,
          ...(failures[0] ? { failure: failures[0] } : {}), ...(accessContext ? { accessContext } : {}), networkAttempted: false, writeNetworkAttempted: false,
          ...(recoveredTargets.length || boundary.recoveryIssues().length ? { recovery: { createdTargets: recoveredTargets, blockers: boundary.recoveryIssues(), action: 'replan_remaining' },
            ...(recoveredCreates.size ? { error: safeError(new AppError('RECOVERED_CREATE_REPLAN_REQUIRED', '已恢复真实目录，未重复创建。')) } : recoveryBlocked.size ? { error: safeError(new AppError('PREVIOUS_WRITE_UNKNOWN', '关联对象的旧修改尚未核实，本次未提交。')) } : {}) } : {}) });
        // R18对象的惰性检查可能已升级本批权限；冻结时取得实际使用的上下文。
        const account = record(await boundary.read('get_current_user', {}, signal));
        accessContext = account.accessContext as AccessContext | undefined ?? accessContext;
        if (account.id !== accountId) throw new AppError('ACCOUNT_CHANGED', '计划期间账户改变，未提交。');
        confirmation = confirmationForPlan(steps.map(step => ({ name: step.name, args: step.binding.args, before: step.binding.before, after: step.binding.after })), operations.map(op => op.tool));
        phase = 'authorization'; active = undefined;
        const exclusions = items.flatMap(item => [
          ...(['skipped', 'blocked'].includes(String(item.state)) ? [item] : []),
          ...(!['skipped', 'blocked'].includes(String(item.state)) && Array.isArray(item.preflightSkipped) ? item.preflightSkipped.map(raw => {
            const child = record(raw), diagnostic = record(child.error ?? {});
            return { ...child, step: item.step, tool: item.tool, reason: child.reason ?? diagnostic.message };
          }) : []),
        ]);
        token = await boundary.authorize(steps, initial, input, account, ctx, signal, { confirmation, skipped: exclusions });
        const identity = boundary.planRecord(token);
        onRecord({ phase: 'started', fingerprint, accountId, ...identity, toolCallId }); started = true;
        let stopped = false;
        phase = 'execute';
        for (let i = 0; i < steps.length; i++) {
          if (signal?.aborted) { stopped = true; break; }
          const originalStep = steps[i]!.stepId!;
          const executeStep = () => boundary.executeApproved(token!, signal, `${toolCallId}/${originalStep}`, event => {
            onUpdate?.(output({ state: 'running', phase: 'rate_limit_wait', waiting: event, summary: summary(items), totalSteps: operations.length }));
          });
          const outcome = await (trace ? trace.operation('batch.step', executeStep, { step: i + 1, tool_name: steps[i]!.name, tool_call_id: `${toolCallId}/${i + 1}` }) : executeStep());
          const value = visibleOutcome(record(record(outcome.details).value));
          items[originalStep - 1] = { ...items[originalStep - 1], ...value, step: originalStep };
          if (steps[i]!.name === 'create_index' && value.submission !== undefined && record(value.submission).createdId) {
            const id = positive(record(value.submission).createdId);
            for (const item of items) {
              if (!item.target) continue;
              const target = record(item.target);
              if (target.indexFrom === originalStep) { delete target.indexFrom; target[target.kind === 'index' ? 'id' : 'indexId'] = id; }
            }
          }
          // 仅持久化执行事实；不存用户原文、guard或授权凭证。
          onRecord({ phase: 'progress', fingerprint, accountId, requestId: identity.requestId, batchId: identity.batchId, toolCallId, items: structuredClone(items) });
          onUpdate?.(output({ state: 'running', phase, summary: summary(items), completedSteps: i + 1, totalSteps: operations.length }));
          if (!['submitted', 'unchanged'].includes(String(value.state))) addFailure(items[originalStep - 1]!, phase);
          if (value.stopBatch === true) { stopped = true; break; }
        }
        phase = 'verification';
        onUpdate?.(output({ state: 'running', phase, summary: summary(items), totalSteps: steps.length }));
        await settle();
        const counts = summary(items);
        // 历史响应错误已由独立回读核实完成时，不再作为最终缺口报告；回执仍保留在本项。
        for (let i = failures.length - 1; i >= 0; i--) {
          const item = items[Number(failures[i]!.step) - 1];
          if (item && ['success', 'unchanged'].includes(String(item.state))) failures.splice(i, 1);
        }
        for (const item of items) if (['failed', 'unknown'].includes(String(item.state)) && !failures.some(f => f.step === item.step)) addFailure(item, phase);
        const omissions = Number(counts.failed) + Number(counts.skipped) + Number(counts.blocked) + Number(counts.not_executed);
        const done = Number(counts.success) + Number(counts.unchanged) + items.filter(item => Array.isArray(item.stageResults)
          && item.stageResults.some(raw => ['success', 'unchanged'].includes(String(record(raw).state)))).length;
        const state = counts.unknown ? 'unknown' : stopped ? 'failed' : omissions ? done ? 'partial' : 'failed' : counts.success ? 'success' : 'unchanged';
        const value = { state, confirmation, partial: Boolean(done && (stopped || omissions || counts.unknown)), summary: counts, items, failures,
          networkAttempted: items.some(item => item.networkAttempted === true),
          writeNetworkAttempted: writesAttempted(items), ...(failures[0] ? { failure: failures[0] } : {}), ...(accessContext ? { accessContext } : {}),
          ...(boundary.recoveryIssues().length || recoveredTargets.length ? { recovery: { blockers: boundary.recoveryIssues(), createdTargets: recoveredTargets, action: 'replan_remaining' } } : {}),
          ...(signal?.aborted ? { error: safeError(new AppError('CANCELLED', '整批执行已取消，已提交步骤仍独立核查，后续未执行。')) } : {}) };
        onRecord({ phase: 'completed', fingerprint, accountId, requestId: identity.requestId, batchId: identity.batchId, toolCallId, ...value });
        const result = output(value); completed.set(fingerprint, result); return result;
      } catch (error) {
        if (started && token && !settled) { try { await settle(); } catch { /* 未完成回读的提交保留未知，禁止重发。 */ } }
        for (const item of items) if (item.state === 'submitted') item.state = 'unknown';
        const diagnostic = safeError(error);
        accessContext = diagnostic.accessContext ?? accessContext;
        const value = { state: items.some(item => item.state === 'unknown') ? 'unknown' : 'failed', ...(confirmation ? { confirmation } : {}), partial: items.some(item => item.state === 'success'),
          summary: summary(items), items, networkAttempted: items.some(item => item.networkAttempted === true), writeNetworkAttempted: writesAttempted(items),
          failures: [...failures, { phase, ...active, ...(diagnostic.sourceTool ? { sourceTool: diagnostic.sourceTool } : {}), error: diagnostic }],
          failure: { phase, ...active, ...(diagnostic.sourceTool ? { sourceTool: diagnostic.sourceTool } : {}) },
          ...(accessContext ? { accessContext } : {}), ...(boundary.recoveryIssues().length ? { recovery: { blockers: boundary.recoveryIssues(), action: 'independent_readback' } } : {}), error: diagnostic };
        if (started) { try { onRecord({ phase: 'completed', fingerprint, accountId, requestId: originalRequestId, toolCallId, ...value }); } catch {} }
        const result = output(value); if (fingerprint) completed.set(fingerprint, result); return result;
      } finally { if (token) boundary.revoke(token); await boundary.endBatch(); }
    },
  };
}
