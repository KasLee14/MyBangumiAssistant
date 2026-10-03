import { createHash } from 'node:crypto';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { AppError, safeError } from '../support/errors.js';
import { schemaArguments, type JsonSchema } from '../support/tool-schema.js';
import { TOOL_DEFINITIONS, validateToolArguments } from './catalog.js';
import { record, positive, type Data } from './resource-output.js';
import { advanceWriteView, submissionArguments, type Binding, type PlannedWrite, type WriteBoundary } from './write-boundary.js';
import { confirmationForPlan, type ConfirmationDecision } from './confirmation-policy.js';

export const BATCH_TOOL_NAME = 'execute_write_batch';
const stepId: JsonSchema = { type: 'integer', minimum: 1, maximum: 200 };
const branches: JsonSchema[] = [];
for (const definition of TOOL_DEFINITIONS.filter(d => d.effect === 'write')) {
  branches.push({ type: 'object', properties: { tool: { type: 'string', const: definition.name }, args: structuredClone(definition.inputSchema) }, required: ['tool', 'args'], additionalProperties: false });
  if (Object.hasOwn(definition.inputSchema.properties as object, 'index_id')) {
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
  return Object.fromEntries(['success', 'unchanged', 'failed', 'unknown', 'not_executed'].map(state => [state, items.filter(i => i.state === state).length]));
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

/** 一个Pi工具调用内完成计划与执行；不持久化授权、不增加MCP能力、不维护对话状态机。 */
export function createBatchWriteTool(boundary: WriteBoundary, onRecord: (value: Data) => void): ToolDefinition {
  let generation: number | undefined;
  const completed = new Map<string, AgentToolResult<unknown>>();
  return {
    name: BATCH_TOOL_NAME, label: '执行修改计划',
    description: '所有写入的完整计划入口：单项也提交一条operation，普通单项直接执行；发布或修改作品短评、所有类型的批量修改由宿主完整预览并一次确认，再串行执行及独立回读。每项tool只能是已登记写工具，args严格使用该工具原schema。支持混合收藏/评分/标签/章节/角色/人物/目录操作。新目录依赖用index_from引用本批前面的create_index序号（从1开始），该项args省略index_id。先解决全部对象歧义，简介/短评须提供最终正文；本轮开始提交后不能追加另一计划。失败、取消或未知停止后续；恢复不恢复授权，核对剩余范围后在新用户轮次生成完整计划。items中的verification和actual是宿主最终回读事实，嵌套submission.verification=pending不是尚未回读。',
    parameters: structuredClone(BATCH_INPUT_SCHEMA) as ToolDefinition['parameters'], executionMode: 'sequential',
    prepareArguments: validateBatchArguments,
    async execute(toolCallId, raw, signal, onUpdate, ctx) {
      let token: object | undefined; let fingerprint: string | undefined; let accountId: number | undefined; let started = false;
      let items: Data[] = [];
      let confirmation: ConfirmationDecision | undefined;
      try {
        const { operations } = validateBatchArguments(raw);
        const input = { ...boundary.getInput() };
        if (generation !== input.generation) { generation = input.generation; completed.clear(); }
        accountId = positive(record(await boundary.read('get_current_user', {}, signal)).id);
        fingerprint = createHash('sha256').update(JSON.stringify(stable({ accountId, operations }))).digest('hex');
        const cached = completed.get(fingerprint); if (cached) return cached;
        await boundary.assertReady(ctx, input, accountId, signal);
        items = operations.map((operation, i) => ({ step: i + 1, tool: operation.tool, state: 'not_executed', networkAttempted: false }));
        const previous = ctx.sessionManager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'bangumi/batch'
          && entry.data && typeof entry.data === 'object' && (entry.data as Data).fingerprint === fingerprint);
        if (previous.length) {
          const fact = record((previous.at(-1) as unknown as Data).data);
          return output({ state: 'failed', error: safeError(new AppError('BATCH_ALREADY_RECORDED', '此完整计划已有执行记录，不能恢复或重发；先核实现状，使用已创建的真实目录ID，仅对剩余操作生成新计划并确认。')), prior: fact, networkAttempted: false });
        }
        const view = new Map<string, unknown>(); const initial = new Map<string, unknown>(); const steps: PlannedWrite[] = [];
        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i]!;
          const args = { ...operation.args, ...(operation.index_from === undefined ? {} : { index_id: -operation.index_from }) };
          const binding: Binding = await boundary.prepare(operation.tool, args, accountId, signal, view);
          for (const [key, value] of binding.baseline ?? []) if (!initial.has(key) && !steps.some(s => s.createdIndex !== undefined && (key === `index:${s.createdIndex}` || key === `relations:${s.createdIndex}`))) initial.set(key, structuredClone(value));
          const step: PlannedWrite = { name: operation.tool, binding, ...(operation.tool === 'create_index' ? { createdIndex: -(i + 1) } : {}) };
          steps.push(step); advanceWriteView(view, step, accountId);
          items[i] = { ...items[i], target: visibleTarget(binding.target) };
        }
        const account = record(await boundary.read('get_current_user', {}, signal));
        if (account.id !== accountId) throw new AppError('ACCOUNT_CHANGED', '计划期间账户改变，未提交。');
        confirmation = confirmationForPlan(steps.map(step => ({ name: step.name, args: step.binding.args, before: step.binding.before, after: step.binding.after })));
        token = await boundary.authorize(steps, initial, input, account, ctx, signal);
        onRecord({ phase: 'started', fingerprint, accountId, count: steps.length, toolCallId }); started = true;
        let stopped = false;
        for (let i = 0; i < steps.length; i++) {
          if (signal?.aborted) { stopped = true; break; }
          const outcome = await boundary.executeApproved(token, signal, `${toolCallId}/${i + 1}`);
          const value = record(record(outcome.details).value);
          items[i] = { ...items[i], ...value, step: i + 1 };
          if (steps[i]!.name === 'create_index' && value.state === 'success') {
            const id = positive(record(value.submission).createdId);
            for (const item of items) {
              if (!item.target) continue;
              const target = record(item.target);
              if (target.indexFrom === i + 1) { delete target.indexFrom; target[target.kind === 'index' ? 'id' : 'indexId'] = id; }
            }
          }
          // 仅持久化执行事实；不存用户原文、guard或授权凭证。
          onRecord({ phase: 'progress', fingerprint, accountId, items: structuredClone(items) });
          onUpdate?.(output({ state: 'running', summary: summary(items), completedSteps: i + 1, totalSteps: steps.length }));
          if (!['success', 'unchanged'].includes(String(value.state))) { stopped = true; break; }
        }
        const counts = summary(items);
        const state = counts.unknown ? 'unknown' : stopped ? 'failed' : counts.success ? 'success' : 'unchanged';
        const value = { state, confirmation, partial: Boolean(stopped && counts.success), summary: counts, items, networkAttempted: items.some(item => item.networkAttempted === true),
          ...(signal?.aborted ? { error: safeError(new AppError('CANCELLED', '整批执行已取消，已提交步骤仍独立核查，后续未执行。')) } : {}) };
        onRecord({ phase: 'completed', fingerprint, accountId, ...value });
        const result = output(value); completed.set(fingerprint, result); return result;
      } catch (error) {
        const value = { state: items.some(item => item.state === 'unknown') ? 'unknown' : 'failed', ...(confirmation ? { confirmation } : {}), partial: items.some(item => item.state === 'success'),
          summary: summary(items), items, networkAttempted: items.some(item => item.networkAttempted === true), error: safeError(error) };
        if (started) { try { onRecord({ phase: 'completed', fingerprint, accountId, ...value }); } catch {} }
        const result = output(value); if (fingerprint) completed.set(fingerprint, result); return result;
      } finally { if (token) boundary.revoke(token); }
    },
  };
}
