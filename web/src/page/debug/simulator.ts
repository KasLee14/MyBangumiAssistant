import {
  blocksFromContent,
  blocksFromMessage,
  customContentBlocks,
  hasRenderableBlock,
} from '../../../../bangumi/src/web/message-blocks';
import type { ChatScalarsView, MessageBlock, ServerEvent, TranscriptItemView } from '../../../../bangumi/src/web/protocol';

/**
 * 调试页的宿主模拟器。
 *
 * 作用：把一条 `AgentSessionEvent`（宿主 `WebSession.handleEvent` 的入参）映射成
 * 浏览器会收到的一帧 `StateFrame`（`store/stream.ts` 里 `onFrame` 的入参）。
 *
 * 这份代码是 `bangumi/src/web/session.ts` 的 `handleEvent` 在浏览器侧的复刻，
 * 只保留与该映射有关的语义：条目生成、标量改写、activity 的原地更新。**不含**
 * 宿主的派生计算（token 用量、上下文占用、登录与代理探测），那些字段按固定模拟值
 * 处理，界面上另有标注。
 *
 * 与真实宿主的两处刻意差异：
 * 1. notice 文案只保留与调试相关的少数几条；
 * 2. `redactText` 是简化实现——不经手真实凭据，只挡明显的密钥形状。
 */

/** 与 `server.ts` 发出的帧、`store/stream.ts` 的 StreamFrame 同形。 */
export type SimFrame = Extract<ServerEvent, { type: 'state' }>;

/** event 载荷：按 `handleEvent` 用到的字段声明，不引入 Pi 的完整类型。 */
export type SimEvent = Record<string, unknown> & { type: string };

/** `play: KEEP` 表示「不改动流式区当前内容」；空数组表示清空流式区。 */
export const KEEP = Symbol('keep-live-content');

/**
 * 引擎返回的一「步」。
 *
 * `play` 是这一帧**播放完之后**流式区应该显示的块数组：页面把最后一个文本块按字符演出来，
 * 其余块（含已出现的文本块与内容块）直接显示，再提交 `frame`。没有内容变化的事件传 `KEEP`。
 *
 * 为什么需要它：宿主把块投影在事件处理里、末尾才 `emit()`，而调试页一次只喂一个 event。
 * 要让「逐字出现」与「骨架先出现、参数到了才变真实数据」两件事都可观察，就得由页面把
 * 这一帧的目标块数组演一遍。
 */
export interface SimStep {
  frame: SimFrame;
  play: MessageBlock[] | typeof KEEP;
}

/* ============================================================
 * 辅助函数（对应 session.ts 的同名函数）
 * ============================================================ */

interface MessageLike {
  role?: string;
  content?: unknown;
  customType?: unknown;
  display?: unknown;
  details?: unknown;
  stopReason?: string;
  errorMessage?: string;
}

/** 取内容块里所有 text 块并拼接；其它块类型（工具调用、图片）一律丢弃。 */
function textParts(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter((part): part is { type: string; text: string } =>
      Boolean(part) && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string')
    .map(part => part.text)
    .join('');
}

/** 对应 session.ts 的 messageText。 */
export function messageText(message: MessageLike): string {
  if (message.role === 'user') {
    return typeof message.content === 'string' ? message.content : textParts(message.content);
  }
  if (message.role === 'assistant' || message.role === 'toolResult') {
    return textParts(message.content);
  }
  return '';
}

const DETAIL_LIMIT = 4000;

function truncate(text: string): string {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}\n…（已截断）` : text;
}

/** 对应 session.ts 的 resultDetail：只做保守的文本化。 */
export function resultDetail(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return truncate(result);
  if (typeof result === 'object') {
    const parts = (result as { content?: unknown }).content;
    const text = Array.isArray(parts)
      ? parts
          .map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : ''))
          .filter(Boolean)
          .join('\n')
      : '';
    if (text) return truncate(text);
    try {
      return truncate(JSON.stringify(result, null, 2));
    } catch {
      return '';
    }
  }
  return truncate(String(result));
}

/** 简化脱敏：真实宿主用凭据值表做替换，调试页没有凭据，只挡明显的密钥形状。 */
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***'],
];

export function redactText(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/** 对应宿主对 activity 状态的判定：isError 或写入结果为 failed/unknown 即 error。 */
function activityState(result: unknown, isError: boolean): 'ok' | 'error' {
  const value = (result as { details?: { value?: { state?: string } } } | undefined)?.details?.value;
  return isError || value?.state === 'failed' || value?.state === 'unknown' ? 'error' : 'ok';
}

/* ============================================================
 * 模拟状态：对应 WebSession 的私有字段
 * ============================================================ */

export interface SimulatorState {
  /** 条目编号：宿主是 nextItemId++，这里保持一致。 */
  nextItemId: number;
  items: TranscriptItemView[];
  /** 进行中的工具条目，按 toolCallId 索引（对应宿主的 activities Map）。 */
  activities: Map<string, number>;
  /** 本轮输入是否已经回显过，用于 message_start 的 user 去重。 */
  echoPending: boolean;
  busy: boolean;
  cancelling: boolean;
  startedAt: number;
  status: string;
  liveBlocks: MessageBlock[];
  liveThinking: string;
  sessionId: string;
  /** emit 计数，充当帧的 revision。 */
  revision: number;
}

/**
 * 首帧必须用非空 instanceId：`reducers/stream.ts` 的 `switched` 依赖它，
 * 否则首帧会被当成「同实例的增量」而不是整体替换。
 */
export const DEBUG_INSTANCE_ID = 'debug-instance';

/**
 * 建一份模拟器状态。
 *
 * `revision` 是帧编号的起点，默认 -1（`emit` 先自增，所以第一条帧编号是 0）。调试页
 * 重置时要把当前已提交的编号传进来：`store/reducers/stream.ts` 会丢弃「同一实例、
 * revision 更小」的帧，若重置后又从 0 起算，重置帧与之后的新帧都会被丢掉，界面停在
 * 上一个用例上。
 */
export function createSimulatorState(sessionId = 'debug-session', revision = -1): SimulatorState {
  return {
    nextItemId: 1,
    items: [],
    activities: new Map<string, number>(),
    echoPending: false,
    busy: false,
    cancelling: false,
    startedAt: 0,
    status: '',
    liveBlocks: [],
    liveThinking: '',
    sessionId,
    revision,
  };
}

/* ============================================================
 * 标量投影（对应 session.ts 的 scalars()）
 * ============================================================ */

/**
 * 模拟值：这些字段来自 Pi 的派生计算与宿主进程状态，调试页不复刻，
 * 给一组可读的固定值，便于确认顶栏与统计栏能读到数据。
 */
const SIMULATED = {
  modelLabel: 'debug/mock-model',
  sessionName: '调试预览',
  loginText: '未登录（调试页不访问账户）',
  loginState: 'signed-out' as const,
  proxyLabel: '直连',
  proxyMode: 'direct' as const,
};

function scalars(state: SimulatorState): ChatScalarsView {
  return {
    ready: true,
    busy: state.busy,
    cancelling: state.cancelling,
    startedAt: state.startedAt,
    status: state.status,
    modelLabel: SIMULATED.modelLabel,
    sessionId: state.sessionId,
    sessionName: SIMULATED.sessionName,
    thinking: { current: 'off', currentLabel: '关闭', available: [], supported: false },
    // 宿主在轮次结束时才算这两个值；调试页不复刻该计算，保持 null（界面不显示这两项）。
    tokenUsage: null,
    contextUsage: null,
    liveContent: state.liveBlocks,
    liveThinking: state.liveThinking,
    pending: null,
    loginText: SIMULATED.loginText,
    loginState: SIMULATED.loginState,
    loginUsername: '',
    proxyLabel: SIMULATED.proxyLabel,
    proxyMode: SIMULATED.proxyMode,
    proxyAddress: '',
    loginPrompt: null,
    loginBusy: false,
    loginStatus: '',
  };
}

/** 自增 revision 并压出一帧。`play` 为 `KEEP` 表示流式区不变。 */
function emit(state: SimulatorState, play: MessageBlock[] | typeof KEEP): SimStep {
  state.revision += 1;
  return {
    frame: {
      type: 'state',
      instanceId: DEBUG_INSTANCE_ID,
      revision: state.revision,
      // 调试页每帧都按整体替换处理：条目列表本就是完整快照，取全量最稳。
      full: true,
      items: state.items.map(item => ({ ...item })),
      state: scalars(state),
    },
    play,
  };
}

function pushItem(state: SimulatorState, item: TranscriptItemView): TranscriptItemView {
  state.items.push(item);
  return item;
}

function asMessage(event: SimEvent): MessageLike {
  const message = event['message'];
  return message && typeof message === 'object' ? message as MessageLike : {};
}

/* ============================================================
 * 事件映射（对应 session.ts 的 handleEvent）
 * ============================================================ */

/**
 * 处理一条 event，返回需要提交的步骤。
 *
 * 与宿主的一处结构性差异：宿主把块投影与 `emit()` 分开
 * （`message_update` 不单独下发），这里让每次投影也产出一帧，否则调试页看不到变化。
 */
export function applyEvent(state: SimulatorState, event: SimEvent): SimStep[] {
  switch (event.type) {
    case 'agent_start':
      state.busy = true;
      state.cancelling = false;
      state.startedAt = Date.now();
      state.status = '正在处理';
      return [emit(state, KEEP)];

    case 'message_start': {
      const message = asMessage(event);
      if (message.role === 'user') {
        // 对应宿主：本轮输入已经回显过；扩展命令不产生 user 消息，所以这里才需要去重。
        if (state.echoPending) {
          state.echoPending = false;
          return [emit(state, KEEP)];
        }
        const text = messageText(message);
        if (text.trim()) pushItem(state, { id: state.nextItemId++, version: 1, kind: 'user', text });
      }
      return [emit(state, KEEP)];
    }

    case 'message_update': {
      const update = event['assistantMessageEvent'];
      if (update && typeof update === 'object') {
        const { type, delta, partial } = update as {
          type?: string;
          delta?: string;
          partial?: { content?: unknown };
        };
        // 与宿主同构：不判别事件 type，只从 `partial.content` 重新投影——调的是同一份纯函数
        // （`message-blocks.ts`），所以「快照即唯一入口」与结构化共享在调试页同样生效。
        if (partial !== undefined && Array.isArray(partial.content))
          state.liveBlocks = blocksFromContent(partial.content, state.liveBlocks);
        if (type === 'thinking_delta' && typeof delta === 'string') state.liveThinking += delta;
      }
      // 播放整段块数组（而不是单个 delta），保证与这一帧的 liveBlocks 完全一致。
      return [emit(state, state.liveBlocks)];
    }

    case 'message_end': {
      const message = asMessage(event);
      // 对应宿主的 custom 分支：调的是同一份映射（message-blocks.ts），所以调试页演练的
      // 就是宿主真实走的逻辑，不是又抄一遍。play 传 KEEP：custom 消息与流式区无关。
      const custom = customContentBlocks(message);
      if (custom !== undefined) {
        pushItem(state, {
          id: state.nextItemId++, version: 1, kind: 'assistant', content: custom, origin: 'extension',
        });
        return [emit(state, KEEP)];
      }
      if (message.role !== 'assistant') return [emit(state, KEEP)];
      const blocks = blocksFromMessage(message);
      if (hasRenderableBlock(blocks))
        pushItem(state, { id: state.nextItemId++, version: 1, kind: 'assistant', content: blocks });
      state.liveBlocks = [];
      state.liveThinking = '';
      if (message.stopReason === 'error') {
        pushItem(state, {
          id: state.nextItemId++, version: 1, kind: 'error',
          text: redactText(message.errorMessage ?? '模型请求失败。'),
        });
      } else if (message.stopReason === 'aborted') {
        pushItem(state, {
          id: state.nextItemId++, version: 1, kind: 'notice',
          text: '本轮已停止；已发送的变更以回读结果及操作记录为准。',
        });
      }
      // 传空数组：提交这一帧时流式区被清空，而块已落成历史条目——
      // 「流式区消失、条目出现」的交接因此是可观察的。
      return [emit(state, [])];
    }

    case 'tool_execution_start': {
      const toolCallId = String(event['toolCallId'] ?? '');
      const item = pushItem(state, {
        id: state.nextItemId++, version: 1, kind: 'activity',
        label: String(event['toolName'] ?? '未命名工具'), state: 'running', detail: '',
      });
      if (item.kind === 'activity') state.activities.set(toolCallId, item.id);
      return [emit(state, KEEP)];
    }

    case 'tool_execution_end': {
      const toolCallId = String(event['toolCallId'] ?? '');
      const id = state.activities.get(toolCallId);
      if (id !== undefined) {
        const index = state.items.findIndex(item => item.id === id);
        const current = index < 0 ? undefined : state.items[index];
        if (current?.kind === 'activity') {
          // 对应宿主：原地更新同一条并递增版本，否则增量帧不会重发，界面停在「进行中」。
          state.items[index] = {
            ...current,
            version: current.version + 1,
            state: activityState(event['result'], event['isError'] === true),
            detail: redactText(resultDetail(event['result'])),
          };
        }
        state.activities.delete(toolCallId);
      }
      return [emit(state, KEEP)];
    }

    case 'agent_end':
      state.busy = false;
      state.status = '';
      return [emit(state, KEEP)];

    case 'agent_settled':
      state.busy = false;
      state.cancelling = false;
      state.startedAt = 0;
      state.status = '';
      return [emit(state, KEEP)];

    case 'compaction_start':
      pushItem(state, {
        id: state.nextItemId++, version: 1, kind: 'notice',
        text: event['reason'] === 'manual' ? '正在压缩会话上下文…' : '上下文接近上限，正在自动压缩…',
      });
      return [emit(state, KEEP)];

    case 'compaction_end':
      pushItem(state, {
        id: state.nextItemId++, version: 1,
        kind: event['errorMessage'] ? 'error' : 'notice',
        text: event['errorMessage']
          ? `会话压缩失败：${String(event['errorMessage'])}`
          : event['aborted'] ? '会话压缩已停止。' : '会话上下文已压缩。',
      });
      return [emit(state, KEEP)];

    case 'auto_retry_start':
      pushItem(state, {
        id: state.nextItemId++, version: 1, kind: 'notice',
        text: `请求失败，正在重试（第 ${String(event['attempt'] ?? '?')}/${String(event['maxAttempts'] ?? '?')} 次）…`,
      });
      return [emit(state, KEEP)];

    case 'auto_retry_end':
      pushItem(state, {
        id: state.nextItemId++, version: 1,
        kind: event['success'] ? 'notice' : 'error',
        text: event['success'] ? '重试成功。' : `重试失败：${String(event['finalError'] ?? '未提供原因')}`,
      });
      return [emit(state, KEEP)];

    case 'session_info_changed':
      return [emit(state, KEEP)];

    default:
      throw new Error(`未支持的事件类型「${event.type}」。`);
  }
}

/**
 * 处理一批 event：对应宿主 `server.ts` 的**一个 flush 窗口**。
 *
 * 宿主侧的真实链路是：`handleEvent` 每收到一条事件就改会话状态，`server.ts` 的 `schedule()`
 * 用 40ms 定时器把窗口内的全部改动合并成**一帧**（`flush()` → `flushClient()` → `writeEvent()`）
 * 经 SSE 下发。所以窗口里有多少条事件，浏览器都只看到一帧——这一批在调试页也应当只产一帧。
 *
 * 实现直接复用 `applyEvent`：状态是同一个 state，依次生效；只保留**最后一步**。每次 `emit`
 * 都基于 `state.items` 的全量快照，因此最后一帧天然包含整批变更，被丢弃的中间帧在真实链路上
 * 本来也会被后续帧覆盖。流式区同理：这一批播放的块由最后一步的 `play` 给出（若批末清空了
 * 流式区，`play` 就是空数组，与单条 `message_end` 的交接语义一致）。
 *
 * 单条 event 不走合并，仍原样返回 `applyEvent` 的每一步：一个事件可能刻意产出多帧（例如
 * `message_update` 也提交一帧，否则逐字过程看不见），那是调试页与真实链路的已知结构性差异，
 * 不属于 flush 语义。
 */
export function applyEvents(state: SimulatorState, events: readonly SimEvent[]): SimStep[] {
  if (events.length === 1) {
    const only = events[0];
    return only === undefined ? [] : applyEvent(state, only);
  }
  let last: SimStep | undefined;
  for (const event of events) {
    const steps = applyEvent(state, event);
    const step = steps[steps.length - 1];
    if (step !== undefined) last = step;
  }
  return last === undefined ? [] : [last];
}

/** 已知的事件类型，供调试页给出可读的错误提示。 */
export const SUPPORTED_EVENTS = [
  'agent_start', 'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_end',
  'agent_end', 'agent_settled',
  'compaction_start', 'compaction_end',
  'auto_retry_start', 'auto_retry_end', 'session_info_changed',
] as const;
