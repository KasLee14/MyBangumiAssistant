import type { BoundaryRecord } from '../domain/task-scope.js';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[]; boundary?: BoundaryRecord }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LanguageModel {
  complete(messages: readonly Message[], tools: readonly ToolSchema[], options: {
    signal: AbortSignal; onText?: (text: string) => void;
  }): Promise<Extract<Message, { role: 'assistant' }>>;
}
export interface ToolRegistry {
  schemas(): ToolSchema[];
  execute(name: string, args: unknown, options?: { signal: AbortSignal }): Promise<unknown>;
  beginTurn?(input: string, history: readonly Message[]): void;
  endTurn?(completed: boolean): void;
  context?(): string;
  /** 结构化追问已建立时结束本轮，等待真实用户回答。 */
  question?(): string | null;
}
