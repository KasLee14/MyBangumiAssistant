import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { accessContextSchema, withAccessContext, type AccessContext } from './access-context.js';
import { candidateValueSchema, checkCandidateResponse, refineCandidateInputSchema, validateCandidateArguments,
  type CandidateQueryArgs, type CandidateResponse } from './candidate-contract.js';
import { relationInputSchema, relationValueSchema, checkRelationResponse, validateRelationArguments,
  type RelationQueryArgs, type RelationResponse } from './relation-contract.js';

const closed = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const ref = { type: 'string', minLength: 1, maxLength: 100 }, cursor = { type: 'string', minLength: 1, maxLength: 150 };
export interface ContinueSubjectQueryArgs {
  candidate_ref: string; cursor: string; response_view?: 'page' | 'reference'; limit?: number;
}
export type ContinuationDisplay = Pick<ContinueSubjectQueryArgs, 'response_view' | 'limit'>;
export type SubjectContinuationPlan = { tool: 'refine_subject_candidates'; request: CandidateQueryArgs }
  | { tool: 'expand_subject_relations'; request: RelationQueryArgs };
export type CandidateContinuationResponse = SubjectContinuationPlan & {
  schemaVersion: 1; kind: 'candidate_continuation'; result: CandidateResponse | RelationResponse;
  scope: ContinueSubjectQueryArgs; accessContext?: AccessContext;
};
export const continueSubjectQueryInputSchema: JsonSchema = closed({
  candidate_ref: { ...ref, description: '阶段返回的candidateRef或resultRef；宿主校正为对应工作引用，恢复原执行计划。' },
  cursor: { ...cursor, description: '原阶段page.nextCursor；须与该引用匹配，原条件和字段由宿主恢复。' },
  response_view: { enum: ['page', 'reference'], description: '仅本次展示方式；不改变范围、筛选、证据字段和收藏引用。' },
  limit: { type: 'integer', minimum: 1, maximum: 100, description: '仅本次窗口展示大小；不改变原筛选或来源范围。' },
}, ['candidate_ref', 'cursor']);
const scope = closed(structuredClone(continueSubjectQueryInputSchema.properties as Record<string, JsonSchema>), ['candidate_ref', 'cursor']);
export const candidateContinuationValueSchema: JsonSchema = { oneOf: [
  closed({ schemaVersion: { const: 1 }, kind: { const: 'candidate_continuation' }, tool: { const: 'refine_subject_candidates' },
    request: refineCandidateInputSchema, result: candidateValueSchema(refineCandidateInputSchema), scope, accessContext: accessContextSchema },
    ['schemaVersion', 'kind', 'tool', 'request', 'result', 'scope']),
  closed({ schemaVersion: { const: 1 }, kind: { const: 'candidate_continuation' }, tool: { const: 'expand_subject_relations' },
    request: relationInputSchema, result: relationValueSchema(), scope, accessContext: accessContextSchema },
    ['schemaVersion', 'kind', 'tool', 'request', 'result', 'scope']),
] };
export const continueSubjectQueryOutputSchema: JsonSchema = withAccessContext({ type: 'object', oneOf: [closed({ value: candidateContinuationValueSchema }),
  closed({ error: closed({ code: { type: 'string', minLength: 1, maxLength: 100 }, message: { type: 'string', maxLength: 20000 } }) })] });
export function validateContinueSubjectQueryArgs(input: unknown): asserts input is ContinueSubjectQueryArgs {
  if (!compileSchema(continueSubjectQueryInputSchema)(input)) throw new AppError('INVALID_INPUT', '续查只接受候选引用、原游标和展示窗口，不能重新指定原筛选条件。');
}
export function validateContinuationDisplay(input: ContinuationDisplay): void {
  if (Object.keys(input).some(key => !['response_view', 'limit'].includes(key))
    || input.response_view !== undefined && !['page', 'reference'].includes(input.response_view)
    || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))
    throw new AppError('INVALID_INPUT', '续查展示参数只能是已登记视图和1至100的窗口。');
}
export function checkCandidateContinuationResponse(value: unknown, input: Record<string, unknown>): void {
  const invalid = (): never => { throw new AppError('MCP_INVALID_RESULT', '续查返回的原工具、恢复计划、游标或结果范围不一致。'); };
  validateContinueSubjectQueryArgs(input); const args = input as ContinueSubjectQueryArgs, response = value as CandidateContinuationResponse;
  if (!compileSchema(candidateContinuationValueSchema)(value) || !isDeepStrictEqual(response.scope, args)
    || response.request.cursor !== args.cursor || typeof response.request.candidate_ref !== 'string'
    || response.request.subject_ids !== undefined || args.response_view !== undefined && response.request.response_view !== args.response_view
    || args.limit !== undefined && response.request.limit !== args.limit) invalid();
  if (response.tool === 'refine_subject_candidates') {
    validateCandidateArguments(response.request); checkCandidateResponse(response.result, response.request, refineCandidateInputSchema);
  } else { validateRelationArguments(response.request); checkRelationResponse(response.result, response.request); }
  if (response.accessContext && response.result.accessContext && !isDeepStrictEqual(response.accessContext, response.result.accessContext)) invalid();
}
