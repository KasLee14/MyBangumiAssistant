import type { ChatScalarsView, MessageBlock, ServerEvent, TranscriptItemView } from '../../../../bangumi/src/web/protocol';
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
  liveContent: [],
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
  /**
   * 屏幕上的流式正文：`pacedTarget` 的**显示投影**。
   *
   * 上游的正文以突发批次到达（实测一批 10~90 字符、间隔 20~190ms），直接渲染就是
   * 「一顿一顿、一次冒十几个字」。本字段保存已经摊平显示的那一份，由 `store/pacing.ts`
   * 每帧推进。
   */
  displayedContent: MessageBlock[];
  /**
   * 摊平正在追赶的目标。
   *
   * 流式期就等于 `liveContent`（权威值）；**流式结束那一帧后者会被清空**，此时把它冻住，
   * 让 `displayedContent` 把剩下的字播完——否则最后一段会直接跳出来（实测显示到 475/545）。
   * 播完由 `stream/pacedDone` 收尾，屏幕交回历史条目。
   */
  pacedTarget: MessageBlock[];
  /**
   * 前端本地状态：正在应答中的确认 id，null 表示没有应答在途。
   *
   * 它**不能**用宿主标量 `busy` 代替：写入确认必然出现在工具执行期间，此时
   * `busy` 恒为真，拿它禁用按钮会让确认卡永远点不动。这里只表示「本条确认的
   * 应答请求已经发出、还没落地」，因此存 id 而不是布尔值——旧确认的应答不会
   * 误禁用到新确认卡上。
   */
  answering: string | null;
}

export const INITIAL_STREAM_STATE: StreamState = {
  ...INITIAL_SCALARS,
  instanceId: '',
  revision: -1,
  items: [],
  connected: false,
  pendingEcho: null,
  displayedContent: [],
  pacedTarget: [],
  answering: null,
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

/**
 * 流式增量帧；与 `ServerEvent` 的 `stream` 分支同形。
 *
 * 它只携带正文与思考的**追加**部分。宿主保证「接不上的情况一律改发全量 `state` 帧」，
 * 所以这里不做增量回退：接不上就丢弃这一帧，等随后的全量帧纠正。
 */
export type StreamDeltaFrame = Extract<ServerEvent, { type: 'stream' }>;

export type StreamAction =
  | { type: 'stream/frame'; frame: StreamFrame }
  | { type: 'stream/delta'; frame: StreamDeltaFrame }
  /** 摊平显示推进一格；`content` 是新的显示用块数组（由 `store/pacing.ts` 计算）。 */
  | { type: 'stream/paced'; content: MessageBlock[] }
  /** 摊平播完（目标已追上且流式已结束）：清空显示区，屏幕交回历史条目。 */
  | { type: 'stream/pacedDone' }
  | { type: 'stream/fatal'; message: string }
  | { type: 'stream/connected'; connected: boolean }
  | { type: 'stream/pendingEchoSet'; echo: PendingEcho }
  | { type: 'stream/pendingEchoClear' }
  | { type: 'stream/answerStarted'; id: string }
  | { type: 'stream/answerSettled'; id: string };

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
      // 应答在途：宿主已经给出结论（本帧的 pending 不再是那一条）或整体换了会话时
      // 撤下。宿主下发结论比应答请求的 promise 落地更权威，因此这里清一次，避免
      // 请求悬挂时按钮一直停在禁用态。
      const answering = state.answering !== null
        && (switched || frame.state.pending?.id !== state.answering)
        ? null
        : state.answering;
      const live = frame.state.liveContent;
      /**
       * 收尾播放：流式结束那一帧会把权威正文清空，此时把摊平目标**冻住**，让剩下的字
       * 接着播完——否则最后一段会直接跳出来（实测显示到 475/545 就消失）。
       *
       * 两种情况下不让位：换会话（整体重建）、新一轮的用户消息已经落条目（旧回答的尾巴
       * 若继续播，会挂在新问题下面）。
       */
      const nextRound = frame.items.some(item => item.kind === 'user');
      const tail = !switched && !nextRound
        && live.length === 0 && state.pacedTarget.length > 0 && state.displayedContent.length > 0;
      return {
        ...state, ...frame.state,
        instanceId: frame.instanceId, revision: frame.revision, items, connected: true, pendingEcho, answering,
        pacedTarget: tail ? state.pacedTarget : live,
        displayedContent: tail ? state.displayedContent : live,
      };
    }
    case 'stream/delta': {
      const { frame } = action;
      // 增量是相对上一帧的差分：实例不同、编号没有前进、或会话换了都接不上，直接丢弃，
      // 由随后必然到来的全量 `state` 帧纠正（宿主侧的 flushClient 负责这个保证）。
      if (frame.instanceId !== state.instanceId || frame.revision <= state.revision) return state;
      if (frame.delta.scalars.sessionId !== state.sessionId) return state;
      let liveContent = state.liveContent;
      const append = frame.delta.text;
      if (append !== null) {
        const previous = state.liveContent[append.index];
        // 下标越界或那一格不是文本块时不猜——结构变化本身就意味着宿主会改发全量帧。
        if (previous !== undefined && previous.type === 'text') {
          const next = [...state.liveContent];
          next[append.index] = { type: 'text', text: previous.text + append.delta };
          liveContent = next;
        }
      }
      return {
        ...state,
        ...frame.delta.scalars,
        liveContent,
        // 流式期的摊平目标就是权威值；一旦真的开始输出，任何冻住的旧尾巴都让位。
        pacedTarget: liveContent,
        liveThinking: state.liveThinking + frame.delta.thinking,
        revision: frame.revision,
        connected: true,
      };
    }
    case 'stream/paced':
      // 同引用即无变化：推进到「已经是目标值」时不该引起一次渲染。
      return state.displayedContent === action.content ? state : { ...state, displayedContent: action.content };
    case 'stream/pacedDone':
      return state.displayedContent.length === 0 && state.pacedTarget.length === 0
        ? state
        : { ...state, displayedContent: [], pacedTarget: [] };
    case 'stream/fatal':
      return { ...state, status: action.message, connected: false, answering: null };
    case 'stream/connected':
      return state.connected === action.connected ? state : { ...state, connected: action.connected };
    case 'stream/pendingEchoSet':
      return { ...state, pendingEcho: action.echo };
    case 'stream/pendingEchoClear':
      return state.pendingEcho === null ? state : { ...state, pendingEcho: null };
    case 'stream/answerStarted':
      return state.answering === action.id ? state : { ...state, answering: action.id };
    case 'stream/answerSettled':
      // 只清掉自己那一条：应答期间换到新确认卡时，旧应答的落地不该解禁新卡。
      return state.answering === action.id ? { ...state, answering: null } : state;
    default:
      return state;
  }
}
