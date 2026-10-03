import type { ChatScalarsView, ServerEvent, TranscriptItemView } from '../../../../bangumi/src/web/protocol';
import type { AppAction } from './index';

/** 首帧到达前的占位状态；文案与终端启动提示保持一致。 */
export const INITIAL_SCALARS: ChatScalarsView = {
  ready: false,
  busy: false,
  cancelling: false,
  startedAt: 0,
  status: '正在准备会话',
  modelLabel: '',
  sessionId: '',
  sessionName: '',
  thinking: { current: '', currentLabel: '', available: [], supported: false },
  tokenUsage: null,
  contextUsage: null,
  loginText: '正在检查 Bangumi 登录状态',
  loginState: 'signed-out',
  loginUsername: '',
  proxyLabel: '正在检查网络线路',
  proxyMode: 'auto',
  proxyAddress: '',
  liveText: '',
  liveThinking: '',
  pending: null,
  loginPrompt: null,
  loginBusy: false,
  loginStatus: '',
};

/**
 * 乐观回显的本地条目：形状与用户气泡一致，但没有宿主 id（宿主确认后即撤下）。
 */
export interface PendingEcho {
  text: string;
  /** 发出这条消息时的会话 id，用于判断失败回滚是否还属于同一次会话。 */
  sessionId: string;
}

/** 会话流状态：宿主下发的全部标量，加上条目、连接标记与本地乐观回显。 */
export interface StreamState extends ChatScalarsView {
  instanceId: string;
  revision: number;
  items: TranscriptItemView[];
  connected: boolean;
  pendingEcho: PendingEcho | null;
}

export const INITIAL_STREAM_STATE: StreamState = {
  ...INITIAL_SCALARS,
  instanceId: '',
  revision: -1,
  items: [],
  connected: false,
  pendingEcho: null,
};

/**
 * 按 id 合并增量帧。
 *
 * 宿主不只追加新条目：工具从「进行中」变为完成、确认卡给出结论时，会带同一个
 * id 与更高的版本号重发那一条。这里必须替换而不是再次追加，否则界面会同时留下
 * 旧状态，并且 React key 重复。
 */
export function mergeItems(previous: TranscriptItemView[], incoming: TranscriptItemView[]): TranscriptItemView[] {
  const merged = [...previous];
  const positions = new Map(merged.map((item, index) => [item.id, index] as const));
  for (const item of incoming) {
    const at = positions.get(item.id);
    if (at === undefined) { positions.set(item.id, merged.length); merged.push(item); }
    else merged[at] = item;
  }
  return merged;
}

/** 流式状态帧；与 `ServerEvent` 的 `state` 分支同形。 */
export type StreamFrame = Extract<ServerEvent, { type: 'state' }>;

export type StreamAction =
  | { type: 'stream/frame'; frame: StreamFrame }
  | { type: 'stream/fatal'; message: string }
  | { type: 'stream/connected'; connected: boolean }
  | { type: 'stream/pendingEchoSet'; echo: PendingEcho }
  | { type: 'stream/pendingEchoClear' };

/**
 * 会话流 reducer。
 *
 * 帧处理保留原先 `useChatStream` 的三条语义：标量每帧覆盖、条目按增量合并或整体
 * 替换、会话 ID 变化时整表替换并撤下乐观回显。
 */
export function streamReducer(state: StreamState = INITIAL_STREAM_STATE, action: AppAction): StreamState {
  switch (action.type) {
    case 'stream/frame': {
      const { frame } = action;
      // HTTP 切换回执和 SSE 分属连接，旧帧可能迟到；只接收最新宿主状态。
      if (frame.instanceId === state.instanceId && frame.revision < state.revision) return state;
      // 各会话独立编号；换会话或重启宿主时必须整体替换。
      const switched = frame.instanceId !== state.instanceId || frame.state.sessionId !== state.sessionId;
      const items = switched || frame.full ? frame.items : mergeItems(state.items, frame.items);
      // 乐观回显：宿主确认（真实 user 条目出现）或换到别的会话后撤下。
      const echo = state.pendingEcho;
      const settledByHost = echo !== null
        && items.some(item => item.kind === 'user' && item.text === echo.text);
      const otherSession = echo !== null && frame.state.sessionId !== echo.sessionId;
      const pendingEcho = echo === null || settledByHost || otherSession ? null : echo;
      return { ...state, ...frame.state, instanceId: frame.instanceId, revision: frame.revision, items, connected: true, pendingEcho };
    }
    case 'stream/fatal':
      return { ...state, status: action.message, connected: false };
    case 'stream/connected':
      return state.connected === action.connected ? state : { ...state, connected: action.connected };
    case 'stream/pendingEchoSet':
      return { ...state, pendingEcho: action.echo };
    case 'stream/pendingEchoClear':
      return state.pendingEcho === null ? state : { ...state, pendingEcho: null };
    default:
      return state;
  }
}
