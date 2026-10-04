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
function summary(items: Data[]): Data {
  return Object.fromEntries(['success', 'submitted', 'unchanged', 'failed', 'unknown', 'not_executed'].map(state => [state, items.filter(i => i.state === state).length]));
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
    description: '所有写入的完整计划入口：单项也提交一条operation；章节操作不计入批量审批数量，发布或修改作品短评及多个非章节操作由宿主一次确认。整批开始统一核实账户、NSFW及完整对象基线，再按冻结计划顺序提交，结束时统一独立回读完整最终状态；中间submitted只是已提交，verification=pending不能称为成功。支持混合收藏/评分/标签/章节/角色/人物/目录操作。每项tool及args使用原固定契约。新目录依赖用index_from引用本批前面的create_index序号（从1开始），该项省略index_id。先解决对象歧义并收齐最终正文，提交后不能追加另一个计划。失败、取消或未知停止后续，对已提交部分仍统一回读，不重发或恢复授权。最终items.verification及actual是整批最终状态事实，连续修改同一对象按最后目标核实；嵌套submission.verification=pending仅是回执。failure报告阶段、步骤、来源工具；networkAttempted/writeNetworkAttempted只表示写入尝试。按accessContext报告NSFW权限。',
    parameters: structuredClone(BATCH_INPUT_SCHEMA) as ToolDefinition['parameters'], executionMode: 'sequential',
    prepareArguments: validateBatchArguments,
    async execute(toolCallId, raw, signal, onUpdate, ctx) {
      let token: object | undefined; let fingerprint: string | undefined; let accountId: number | undefined; let started = false;
      let items: Data[] = [];
      let confirmation: ConfirmationDecision | undefined;
      let accessContext: AccessContext | undefined;
      let originalRequestId: string | undefined;
      let phase = 'validation';
      let active: Data | undefined;
      let settled = false;
      const settle = async () => {
        if (!token || settled) return;
        const results = await boundary.finishApproved(token);
        settled = true;
        results.forEach((value, i) => { items[i] = { ...items[i], ...value, step: i + 1 }; });
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
        items = operations.map((operation, i) => ({ step: i + 1, tool: operation.tool, state: 'not_executed', networkAttempted: false }));
        const hints = operations.map(operation => Number(operation.args.index_id)).filter(id => Number.isSafeInteger(id) && id > 0);
        await boundary.assertReady(ctx, input, accountId, signal, [...new Set(hints)], operations);
        const recoveredTargets = boundary.recoveryTargets();
        if (recoveredTargets.some(target => operations.some(operation => operation.tool === 'create_index' && isDeepStrictEqual(operation.args, target.args)))) {
          return output({ state: 'failed', items, summary: summary(items), networkAttempted: false, writeNetworkAttempted: false,
            recovery: { createdTargets: recoveredTargets, action: 'replan_remaining' },
            error: safeError(new AppError('RECOVERED_CREATE_REPLAN_REQUIRED', '宿主已核实原目录创建成功；请使用recovery.createdTargets中的真实ID重新规划剩余操作，本次未重复创建。')) });
        }
        const previous = boundary.recordedRequest(ctx, input);
        if (previous) {
          return output({ state: 'failed', error: safeError(new AppError('BATCH_ALREADY_RECORDED', '此真实用户请求已有提交事实，不能重放或恢复旧授权；新的用户请求会重新核实基线并形成新计划。')),
            prior: { phase: previous.phase, state: previous.state, requestId: previous.requestId, batchId: previous.batchId, accountId: previous.accountId }, networkAttempted: false, writeNetworkAttempted: false });
        }
        const view = new Map<string, unknown>(); const initial = new Map<string, unknown>(); const steps: PlannedWrite[] = [];
        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i]!;
          active = { step: i + 1, tool: operation.tool,
            ...(operation.args.subject_id === undefined ? {} : { subjectId: operation.args.subject_id }),
            ...(operation.args.episode_id === undefined ? {} : { episodeId: operation.args.episode_id }),
            ...(operation.args.index_id === undefined ? {} : { indexId: operation.args.index_id }) };
          const args = { ...operation.args, ...(operation.index_from === undefined ? {} : { index_id: -operation.index_from }) };
          const binding: Binding = await boundary.prepare(operation.tool, args, accountId, signal, view);
          for (const [key, value] of binding.baseline ?? []) if (!initial.has(key) && !steps.some(s => s.createdIndex !== undefined && (key === `index:${s.createdIndex}` || key === `relations:${s.createdIndex}`))) initial.set(key, structuredClone(value));
          const step: PlannedWrite = { name: operation.tool, binding, ...(operation.tool === 'create_index' ? { createdIndex: -(i + 1) } : {}) };
          steps.push(step); advanceWriteView(view, step, accountId);
          items[i] = { ...items[i], target: visibleTarget(binding.target) };
        }
        const account = viewer;
        accessContext = account.accessContext as AccessContext | undefined ?? accessContext;
        if (account.id !== accountId) throw new AppError('ACCOUNT_CHANGED', '计划期间账户改变，未提交。');
        confirmation = confirmationForPlan(steps.map(step => ({ name: step.name, args: step.binding.args, before: step.binding.before, after: step.binding.after })));
        phase = 'authorization'; active = undefined;
        token = await boundary.authorize(steps, initial, input, account, ctx, signal);
        const identity = boundary.planRecord(token);
        onRecord({ phase: 'started', fingerprint, accountId, ...identity, toolCallId }); started = true;
        let stopped = false;
        let failure: Data | undefined; phase = 'execute';
        for (let i = 0; i < steps.length; i++) {
          if (signal?.aborted) { stopped = true; break; }
          const executeStep = () => boundary.executeApproved(token!, signal, `${toolCallId}/${i + 1}`, event => {
            onUpdate?.(output({ state: 'running', phase: 'rate_limit_wait', waiting: event, summary: summary(items), totalSteps: steps.length }));
          });
          const outcome = await (trace ? trace.operation('batch.step', executeStep, { step: i + 1, tool_name: steps[i]!.name, tool_call_id: `${toolCallId}/${i + 1}` }) : executeStep());
          const value = record(record(outcome.details).value);
          items[i] = { ...items[i], ...value, step: i + 1 };
          if (steps[i]!.name === 'create_index' && value.submission !== undefined && record(value.submission).createdId) {
            const id = positive(record(value.submission).createdId);
            for (const item of items) {
              if (!item.target) continue;
              const target = record(item.target);
              if (target.indexFrom === i + 1) { delete target.indexFrom; target[target.kind === 'index' ? 'id' : 'indexId'] = id; }
            }
          }
          // 仅持久化执行事实；不存用户原文、guard或授权凭证。
          onRecord({ phase: 'progress', fingerprint, accountId, requestId: identity.requestId, batchId: identity.batchId, toolCallId, items: structuredClone(items) });
          onUpdate?.(output({ state: 'running', summary: summary(items), completedSteps: i + 1, totalSteps: steps.length }));
          if (!['submitted', 'unchanged'].includes(String(value.state))) { stopped = true; failure = { phase: value.submission !== undefined && record(value.submission).submissionState === 'not_attempted' ? 'preflight' : phase, step: i + 1, tool: steps[i]!.name, target: items[i]!.target }; break; }
        }
        phase = 'verification';
        onUpdate?.(output({ state: 'running', phase, summary: summary(items), totalSteps: steps.length }));
        await settle();
        const counts = summary(items);
        const state = counts.unknown ? 'unknown' : stopped || counts.failed ? 'failed' : counts.success ? 'success' : 'unchanged';
        if (!failure && (counts.failed || counts.unknown)) failure = { phase, ...items.find(item => item.state === 'failed' || item.state === 'unknown') };
        const value = { state, confirmation, partial: Boolean(stopped && counts.success), summary: counts, items, networkAttempted: items.some(item => item.networkAttempted === true),
          writeNetworkAttempted: writesAttempted(items), ...(failure ? { failure } : {}), ...(accessContext ? { accessContext } : {}),
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
          failure: { phase, ...active, ...(diagnostic.sourceTool ? { sourceTool: diagnostic.sourceTool } : {}) },
          ...(accessContext ? { accessContext } : {}), ...(boundary.recoveryIssues().length ? { recovery: { blockers: boundary.recoveryIssues(), action: 'independent_readback' } } : {}), error: diagnostic };
        if (started) { try { onRecord({ phase: 'completed', fingerprint, accountId, requestId: originalRequestId, toolCallId, ...value }); } catch {} }
        const result = output(value); if (fingerprint) completed.set(fingerprint, result); return result;
      } finally { if (token) boundary.revoke(token); await boundary.endBatch(); }
    },
  };
}
