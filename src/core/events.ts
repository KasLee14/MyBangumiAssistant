/** 展示事件只报告真实执行阶段；不包含凭据、模型推理或原始响应体。 */
export type AgentEvent =
  | { type: 'model/start'; stage: 'scope' | 'answer' }
  | { type: 'tool/start'; id: string; name: string }
  | { type: 'tool/end'; id: string; name: string; ok: boolean; error?: { code: string; message: string } };
export interface TurnObserver {
  onText?: (text: string) => void;
  onTool?: (name: string) => void;
  onEvent?: (event: AgentEvent) => void;
}
