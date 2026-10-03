import { useEffect, useState } from 'react';
import type { ChatScalarsView, TranscriptItemView } from '../../bangumi/src/web/protocol';
import { openStream } from './api';

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

export interface ViewState extends ChatScalarsView {
  items: TranscriptItemView[];
  connected: boolean;
}

/**
 * 按 id 合并增量帧。
 *
 * 宿主不只追加新条目：工具从「进行中」变为完成、确认卡给出结论时，会带同一个
 * id 与更高的版本号重发那一条。这里必须替换而不是再次追加，否则界面会同时留下
 * 旧状态，并且 React key 重复。
 */
function mergeItems(previous: TranscriptItemView[], incoming: TranscriptItemView[]): TranscriptItemView[] {
  const merged = [...previous];
  const positions = new Map(merged.map((item, index) => [item.id, index] as const));
  for (const item of incoming) {
    const at = positions.get(item.id);
    if (at === undefined) { positions.set(item.id, merged.length); merged.push(item); }
    else merged[at] = item;
  }
  return merged;
}

/** 订阅宿主事件流：标量每帧覆盖，条目按增量合并或整体替换。 */
export function useChatStream(): ViewState {
  const [state, setState] = useState<ViewState>({ ...INITIAL_SCALARS, items: [], connected: false });
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') {
        setState(previous => ({ ...previous, status: frame.message, connected: false }));
        return;
      }
      setState(previous => {
        // 会话 ID 变了就丢弃旧条目、只接住本帧下发的条目：宿主在新建与恢复
        // 会话时会重建条目列表，编号继续递增，因此这一帧总是整体替换。
        const switched = previous.sessionId !== '' && frame.state.sessionId !== previous.sessionId;
        const items = switched || frame.full ? frame.items : mergeItems(previous.items, frame.items);
        return { ...previous, ...frame.state, items, connected: true };
      });
    },
    onStatus: connected => setState(previous => (previous.connected === connected ? previous : { ...previous, connected })),
  }), []);
  return state;
}
