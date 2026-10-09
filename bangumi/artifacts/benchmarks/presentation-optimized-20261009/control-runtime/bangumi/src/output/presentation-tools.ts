import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { schemaArguments, type JsonSchema } from '../support/tool-schema.js';
import { safeError, AppError, SchemaInputError, diagnosedError, sanitizeErrorDiagnostic, type SafeError } from '../support/errors.js';
import { createErrorDiagnostic, errorCauses } from '../support/error-diagnostic.js';
import { ContentOutputError, COMPONENT_PAYLOAD_SCHEMAS } from './content-schema.js';
import { type ComponentCatalogState } from './component-catalog.js';
import { PREPARE_COMPONENT_SCHEMA, PRESENT_COMPONENT_SCHEMA, PRESENT_TEXT_SCHEMA, presentationPrepareSchema } from './presentation-contract.js';
import { normalizeStrictOptionalNulls, toolConstraintState, type ToolProviderModel } from '../support/provider-tool-arguments.js';
import { preparePresentationArguments, type PresentationArgumentAudit } from './presentation-arguments.js';
import { PresentationStore } from './presentation-store.js';
import { ReplyAssembler, PRESENTATION_MESSAGE_MARKER } from './reply-assembler.js';
import { isComponentKind, type ComponentKind } from './content-types.js';

const safePathNames = new Set(['content', 'props', 'component', 'resourceRef', 'subjectIds', 'members', 'blockIndex']);
function collectPathNames(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if ('properties' in value && value.properties && typeof value.properties === 'object') Object.keys(value.properties).forEach(key => safePathNames.add(key));
  Object.values(value).forEach(collectPathNames);
}
Object.values(COMPONENT_PAYLOAD_SCHEMAS).forEach(collectPathNames);
function safeContentPath(path: string): string {
  return path.split('/').map(token => !token || /^\d{1,10}$/u.test(token) || safePathNames.has(token) ? token : '<field>').join('/').slice(0, 300);
}
/** 内容契约错误不伪装成内部异常；原缓存权限/业务诊断和cause优先。 */
export function presentationToolError(error: unknown, toolName: string, args: unknown): SafeError {
  if (!(error instanceof ContentOutputError)) return safeError(error);
  if (error.diagnostic) {
    const projected = diagnosedError(new AppError(error.diagnostic.code, error.message), sanitizeErrorDiagnostic(error.diagnostic), error);
    if (error.sourceTool) Object.defineProperty(projected, 'sourceTool', { value: error.sourceTool });
    return { ...(error.cause instanceof AppError ? safeError(error.cause) : {}), ...safeError(projected) };
  }
  if (error.cause !== undefined) return safeError(error.cause);
  const raw = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const kind = isComponentKind(raw.component) ? raw.component : undefined;
  const membership = error.issueDetails.some(issue => ['resource_membership', 'resource_member_duplicate'].includes(issue.rule));
  const exclusive = error.issueDetails.some(issue => issue.rule === 'mutually_exclusive');
  if (membership || exclusive) {
    const paths = membership ? [Array.isArray(raw.subjectIds) ? '/subjectIds' : '/members'] : ['/fields', '/columns'];
    const hint = membership
      ? '成员ID必须来自此resourceRef的当前成员，单详情不能选择其他对象；改变layout不能修复成员错配。保留用户完整范围，分别使用已经取得的各自有效引用准备/发布，或先取得包含所需成员的集合引用；不能自动删ID或扩大查询。'
      : 'fields与columns只能选择一种：fields使用直接字段名，columns使用带标签的列定义；保留所需事实列，不同时提交。';
    const projected = new SchemaInputError(paths.map(path => ({ path, rule: membership ? 'resource_membership' : 'mutually_exclusive', hint })));
    diagnosedError(projected, createErrorDiagnostic({ code: projected.code, origin: 'content', stage: 'validate', reason: error.reason,
      recovery: 'correct_parameters', operation: toolName, evidence: { networkAttempted: false }, causes: errorCauses(error),
      issues: paths.map(path => ({ path, rule: membership ? 'resource_membership' : 'mutually_exclusive', message: hint.slice(0, 300) })) }), error);
    return safeError(projected);
  }
  const code = error.code === 'size' ? 'CONTENT_LIMIT_EXCEEDED' : 'CONTENT_SCHEMA_INVALID';
  const hint = error.code === 'size'
    ? '展示超过固定字节或块容量。保留完整请求范围，按已有来源分块准备/发布；单块仍超限时说明缺口，不能省略成员冒充完整。'
    : `${kind ?? '所选组件'}不符合严格展示契约。对照read_component_spec的prepare参数，只使用本引用已取得的事实；缓存缺少必要字段时补读原对象，不猜值、不传任意props。`;
  const issues = error.issueDetails.slice(0, 8).map(issue => ({ path: safeContentPath(issue.path), rule: issue.rule,
    message: `此字段未满足严格组件契约（${issue.rule}）。${hint}`.slice(0, 300),
    ...(issue.actualType ? { actualType: issue.actualType } : {}), ...(issue.expected ? { expected: issue.expected } : {}) }));
  if (!issues.length) issues.push({ path: toolName === 'present_text' || kind === 'QuoteBlock' || kind === 'Callout' ? '/text' : '/resourceRef', rule: error.reason, message: hint });
  return safeError(diagnosedError(new AppError(code, hint), createErrorDiagnostic({ code, origin: 'content', stage: 'validate', reason: error.reason,
    recovery: 'correct_parameters', operation: toolName, issues, causes: errorCauses(error), evidence: { networkAttempted: false } }), error));
}

export function createPresentationTools(store: PresentationStore, assembler: ReplyAssembler, catalog: ComponentCatalogState,
  onAudit?: (audit: PresentationArgumentAudit, context?: Parameters<typeof preparePresentationArguments>[3]) => void,
  model?: () => ToolProviderModel | undefined): ToolDefinition[] {
  const preparedOwners = new Map<string, string>();
  const definitions: { name: string; description: string; parameters: JsonSchema; execute: (args: Record<string, unknown>, id: string, signal?: AbortSignal) => unknown | Promise<unknown> }[] = [
    { name: 'prepare_component', description: '按已读组件准备契约选择缓存成员和布局。宿主展开事实并冻结完整组件，返回resourceRef和blocks；此工具不发布正文。禁止提供props或实体事实。作品明确subjectIds，其他实体用members。', parameters: PREPARE_COMPONENT_SCHEMA,
      execute: (args, _id, signal) => {
        if (!catalog.currentAudit().loaded.includes(args.component as ComponentKind)) throw new AppError('COMPONENT_SPEC_REQUIRED', '准备组件前先读取所选组件的最简prepare契约。');
        return store.prepare(args, signal);
      } },
    { name: 'present_component', description: '将准备快照中的一个完整组件发布到当前回答。blockIndex是整个snapshot的绝对下标，直接复用candidate_output准备快照时也一样。相同快照块重试不会重复追加。', parameters: PRESENT_COMPONENT_SCHEMA,
      execute: async (args, id, signal) => {
        const part = await store.block(args.resourceRef as string, args.blockIndex as number, signal);
        if (!catalog.currentAudit().loaded.includes(part.type)) throw new AppError('COMPONENT_SPEC_REQUIRED', '发布组件前先读取所选组件的prepare契约。');
        return assembler.append(part, id, `component:${args.resourceRef}:${args.blockIndex}`, signal);
      } },
    { name: 'present_text', description: '按调用顺序发布说明文字；需要精确文字→组件→文字交错时使用。普通解释也可直接输出原生文字。同一段已完成文字重试不重复追加。', parameters: PRESENT_TEXT_SCHEMA,
      execute: (args, id, signal) => assembler.append({ type: 'text', text: args.text as string, nextType: null }, id, undefined, signal) },
  ];
  return definitions.map(definition => ({ name: definition.name, label: definition.name, description: definition.description,
    parameters: definition.parameters as ToolDefinition['parameters'], executionMode: 'sequential',
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    prepareArguments: (args, context) => {
      const currentOwner = assembler.snapshot()?.turnId;
      const sourceOwner = context?.assistantMessage.diagnostics?.findLast(value => value.type === PRESENTATION_MESSAGE_MARKER)?.details?.turnId;
      if (!assembler.active || typeof sourceOwner === 'string' && sourceOwner !== currentOwner) throw new AppError('RESOURCE_SCOPE_MISMATCH', '展示工具调用不属于当前用户回合。');
      const result = preparePresentationArguments(definition.name, definition.parameters, args, context, {
        onAudit: audit => onAudit?.(audit, context),
        schemaForValue: value => definition.name === 'prepare_component' && value && typeof value === 'object' && 'component' in value && isComponentKind(value.component)
          ? presentationPrepareSchema(value.component) : definition.parameters,
        normalize: (schema, value) => normalizeStrictOptionalNulls(schema, value, toolConstraintState(definition.parameters, model?.()).provider === 'enabled'),
      });
      if (context && currentOwner) preparedOwners.set(context.toolCall.id, currentOwner);
      return result;
    },
    async execute(id, raw, signal) {
      try {
        const owner = preparedOwners.get(id);
        if (owner && owner !== assembler.snapshot()?.turnId) throw new AppError('RESOURCE_SCOPE_MISMATCH', '准备参数后用户回合已改变，旧展示操作已停止。');
        const result = await definition.execute(schemaArguments(definition.parameters, raw), id, signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const result = { error: presentationToolError(error, definition.name, raw) };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, isError: true };
      } finally {
        preparedOwners.delete(id);
      }
    },
  }));
}
