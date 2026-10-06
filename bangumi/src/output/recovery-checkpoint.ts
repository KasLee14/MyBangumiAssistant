import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai';
import { validateMixedPart, type MixedPart } from './content-schema.js';
import { credentialValues, redact } from '../support/errors.js';

export type FailureScope = 'envelope' | 'part' | 'json' | 'transport' | 'capacity' | 'host';
export interface OutputCheckpoint { schemaVersion?: 2; prefix: MixedPart[]; draft?: unknown; jsonComplete: boolean; resumeAt?: number; failureScope?: FailureScope; failedPartIndex?: number }
export function attachOutputCheckpoint(message: AssistantMessage, checkpoint: OutputCheckpoint): AssistantMessage {
  // 只保存已验证块及待修复的对象数据，不复制思考、签名、原始JSON线路或凭据。
  const safe = JSON.parse(redact(JSON.stringify({ ...checkpoint, schemaVersion: 2, resumeAt: checkpoint.prefix.length }), credentialValues())) as JsonObject;
  return { ...message, diagnostics: [...(message.diagnostics ?? []), { type: 'bangumi_output_checkpoint', timestamp: Date.now(), details: safe }] };
}
export function outputCheckpoint(message: AssistantMessage): OutputCheckpoint {
  const data = message.diagnostics?.findLast(item => item.type === 'bangumi_output_checkpoint')?.details;
  if (!data || !Array.isArray(data.prefix)) return { prefix: [], jsonComplete: false };
  try {
    const prefix = data.prefix.map(validateMixedPart);
    const scopes: FailureScope[] = ['envelope', 'part', 'json', 'transport', 'capacity', 'host'];
    return { prefix, ...(data.schemaVersion === 2 ? { schemaVersion: 2 as const } : {}), resumeAt: prefix.length, jsonComplete: data.jsonComplete === true,
      ...(typeof data.failureScope === 'string' && scopes.includes(data.failureScope as FailureScope) ? { failureScope: data.failureScope as FailureScope } : {}),
      ...(typeof data.failedPartIndex === 'number' && Number.isSafeInteger(data.failedPartIndex) && data.failedPartIndex >= 0 ? { failedPartIndex: data.failedPartIndex } : {}),
      ...(data.draft === undefined ? {} : { draft: data.draft }) };
  } catch { return { prefix: [], jsonComplete: false }; }
}
