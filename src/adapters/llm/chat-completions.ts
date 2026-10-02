import { fetch } from 'undici';
import { ProxyDispatchers } from '../proxy-dispatcher.js';
import type { ProxyOptions } from '../../config/proxy.js';
import type { ModelConfig } from '../../config/config.js';
import type { LanguageModel, Message, ToolCall, ToolSchema } from '../../core/types.js';
import { AppError, redact, StreamingRedactor } from '../../domain/errors.js';
import { object } from '../../domain/bangumi.js';

export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 1_000_000) throw new AppError('MODEL_PROTOCOL', '模型事件过大。');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending)) !== null) {
        const block = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
        const lines = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
        if (lines.length) yield lines.join('\n');
      }
      if (done) {
        const lines = pending.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
        if (lines.length) yield lines.join('\n');
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class ChatCompletionsModel implements LanguageModel {
  private readonly dispatcher: import('undici').Dispatcher;
  private readonly dispatchers: ProxyDispatchers;
  constructor(private readonly config: ModelConfig, private readonly timeoutMs: number,
    proxy: ProxyOptions, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.dispatchers = new ProxyDispatchers(proxy);
    this.dispatcher = this.dispatchers.forUrl(config.baseUrl);
  }
  async close(): Promise<void> { await this.dispatchers.close(); }

  async complete(messages: readonly Message[], tools: readonly ToolSchema[], options: {
    signal: AbortSignal; onText?: (text: string) => void;
  }): Promise<Extract<Message, { role: 'assistant' }>> {
    const apiKey = this.env[this.config.apiKeyEnv];
    if (!apiKey) throw new AppError('MISSING_CREDENTIAL', `环境变量 ${this.config.apiKeyEnv} 未设置。`);
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([options.signal, deadline]);
    const outputRedactor = new StreamingRedactor([apiKey]);
    let content = ''; let reasoning = ''; let totalSize = 0; let finish: string | null = null;
    const calls = new Map<number, ToolCall>();
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages: messages.map(message => {
          if (message.role !== 'assistant') return message;
          const { boundary: _boundary, ...providerMessage } = message;
          return providerMessage;
        }), tools, stream: true,
          max_tokens: 4096, thinking: { type: this.config.thinking } }),
        signal, dispatcher: this.dispatcher,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError('MODEL_HTTP', `模型请求失败（HTTP ${response.status}），请检查凭据、模型名和服务状态。`);
      }
      if (!response.body) throw new AppError('MODEL_PROTOCOL', '模型返回空响应。');
      for await (const data of sseData(response.body as ReadableStream<Uint8Array>)) {
        if (data === '[DONE]') break;
        totalSize += data.length;
        if (totalSize > 2_000_000) throw new AppError('MODEL_PROTOCOL', '模型响应超过大小限制。');
        let event: Record<string, unknown>;
        try { event = object(JSON.parse(data)); } catch { throw new AppError('MODEL_PROTOCOL', '模型返回无效流式 JSON。'); }
        if ('error' in event) throw new AppError('MODEL_PROTOCOL', '模型事件包含错误。');
        if (!Array.isArray(event.choices) || event.choices.length === 0) continue;
        const choice = object(event.choices[0]); const delta = object(choice.delta ?? {});
        if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
        if (typeof delta.content === 'string') {
          content += delta.content;
          // 密钥只通过 HTTP header 发送。输出仍经过脱敏，不直接显示 provider 元数据。
          const text = outputRedactor.push(delta.content);
          if (text) options.onText?.(text);
        }
        if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        if (Array.isArray(delta.tool_calls)) {
          for (const item of delta.tool_calls) {
            const part = object(item); const index = part.index;
            if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 8) throw new AppError('MODEL_PROTOCOL', '工具调用序号无效。');
            const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (typeof part.id === 'string') call.id += part.id;
            if (part.type !== undefined && part.type !== 'function') throw new AppError('MODEL_PROTOCOL', '工具调用类型无效。');
            if (part.function !== undefined) {
              const fn = object(part.function);
              if (typeof fn.name === 'string') call.function.name += fn.name;
              if (typeof fn.arguments === 'string') call.function.arguments += fn.arguments;
            }
            calls.set(index, call);
          }
        }
      }
      if (finish !== 'stop' && finish !== 'tool_calls') throw new AppError('MODEL_INCOMPLETE', '模型响应未完整结束，未执行本次工具调用。');
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([,call]) => call);
      const ids = new Set<string>();
      for (const call of toolCalls) {
        if (!call.id || call.id.length > 200 || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(call.function.name) || ids.has(call.id)) throw new AppError('MODEL_PROTOCOL', '工具调用标识或名称无效。');
        ids.add(call.id);
      }
      const tail = outputRedactor.finish();
      if (tail) options.onText?.(tail);
      return { role: 'assistant', content: redact(content, [apiKey]) || null,
        ...(reasoning ? { reasoning_content: redact(reasoning, [apiKey]) } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    } catch (error) {
      if (options.signal.aborted) throw new AppError('CANCELLED', '操作已取消。');
      if (deadline.aborted) throw new AppError('MODEL_TIMEOUT', '模型请求超时。');
      if (error instanceof AppError) throw error;
      throw new AppError('MODEL_NETWORK', '模型连接失败，请检查接口地址与代理。');
    }
  }
}
