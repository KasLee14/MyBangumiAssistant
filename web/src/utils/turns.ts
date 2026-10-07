import type {
  ReasoningItemView, ToolItemView, TranscriptItemView, TurnItemView,
} from '../../../bangumi/src/web/protocol';

/**
 * 带纯文本的条目：`user` / `notice` / `error`。
 *
 * 助手条目**不在其中**——它的正文是内容块数组（`content: MessageBlock[]`），不再有 `text`；
 * 轮次里助手条目落在 `body`，只有 `user` 占 `user` 槽位。
 */
type TextItem = Extract<TranscriptItemView, { kind: 'user' | 'notice' | 'error' }>;

/** 过程项：思考行与工具行。 */
export type ProcessItem = ReasoningItemView | ToolItemView;

/**
 * 一个轮次（用户回合）：轮次条目 + 用户消息 + 过程 + 主体。
 *
 * `meta` 是宿主下发的轮次条目（边界与元数据：起止时间、状态、计数、用量）。它是**可选**的：
 * 会话开头的通知、扩展注入的内容不属于任何回合，宿主也不会为它们发轮次条目。
 */
export interface TurnGroup {
  /** React key：轮次条目存在时用它，否则用开启这一组的那条条目。 */
  id: number;
  turn: number;
  meta: TurnItemView | null;
  user: TextItem | null;
  process: ProcessItem[];
  body: TranscriptItemView[];
}

/** 条目自带的轮次号；不带轮次概念的条目返回 0。 */
function turnOf(item: TranscriptItemView): number {
  if (item.kind === 'assistant' || item.kind === 'reasoning' || item.kind === 'tool') return item.turn;
  if (item.kind === 'turn') return item.turn;
  return 0;
}

/**
 * 把宿主下发的平铺条目投影成轮次。
 *
 * **轮次边界来自宿主**：`kind === 'turn'` 的条目由宿主在 `agent_start` / `agent_end`（历史重建
 * 时按 user 消息推导）发出，浏览器直接照它切分——不再需要「按 user 条目猜轮次」这条规则。
 *
 * 回退规则只在一个情况下生效：条目带轮次号、但没有对应的轮次条目（宿主投影遗漏或协议外的
 * 形态漂移）。此时按「user 条目开新轮」兜底，使界面仍然可用，而不是把所有内容挤进一组。
 */
export function projectTurns(items: readonly TranscriptItemView[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  let current: TurnGroup | null = null;
  for (const item of items) {
    // 轮次条目本身开启一个组（它是边界标记，自带元数据）。
    if (item.kind === 'turn') {
      current = { id: item.id, turn: item.turn, meta: item, user: null, process: [], body: [] };
      turns.push(current);
      continue;
    }
    const turn = turnOf(item);
    const startsNew = current === null
      // 宿主下发的边界：轮次号变化即换组。
      || (current.turn !== 0 && turn !== 0 && turn !== current.turn)
      // 回退：没有轮次条目时，第二条 user 消息开启新的轮次。
      || (item.kind === 'user' && current.user !== null);
    if (startsNew) {
      current = { id: item.id, turn, meta: null, user: null, process: [], body: [] };
      turns.push(current);
    }
    if (current === null) continue;
    if (item.kind === 'user') current.user = item;
    else if (item.kind === 'reasoning' || item.kind === 'tool') current.process.push(item);
    else current.body.push(item);
  }
  return turns;
}
