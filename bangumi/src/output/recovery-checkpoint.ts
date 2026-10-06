import type { AssistantMessage, JsonObject } from '@earendil-works/pi-ai';
import { validateMixedPart, type MixedPart } from './content-schema.js';
import { credentialValues, redact } from '../support/errors.js';

export interface OutputCheckpoint { prefix: MixedPart[]; draft?: unknown; jsonComplete: boolean }
export function attachOutputCheckpoint(message: AssistantMessage, checkpoint: OutputCheckpoint): AssistantMessage {
  // 只保存已验证块及待修复的对象数据，不复制思考、签名、原始JSON线路或凭据。
  const safe = JSON.parse(redact(JSON.stringify(checkpoint), credentialValues())) as JsonObject;
  return { ...message, diagnostics: [...(message.diagnostics ?? []), { type: 'bangumi_output_checkpoint', timestamp: Date.now(), details: safe }] };
}
export function outputCheckpoint(message: AssistantMessage): OutputCheckpoint {
  const data = message.diagnostics?.findLast(item => item.type === 'bangumi_output_checkpoint')?.details;
  if (!data || !Array.isArray(data.prefix)) return { prefix: [], jsonComplete: false };
  try {
    return { prefix: data.prefix.map(validateMixedPart), jsonComplete: data.jsonComplete === true,
      ...(data.draft === undefined ? {} : { draft: data.draft }) };
  } catch { return { prefix: [], jsonComplete: false }; }
}
