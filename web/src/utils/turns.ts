import type { TranscriptItemView } from '../../../bangumi/src/web/protocol';

/**
 * 带纯文本的条目：`user` / `notice` / `error`。
 *
 * 助手条目**不在其中**——它的正文是内容块数组（`content: MessageBlock[]`），不再有 `text`；
 * 轮次里助手条目落在 `body`，只有 `user` 占 `user` 槽位。
 */
type TextItem = Extract<TranscriptItemView, { kind: 'user' | 'notice' | 'error' }>;

/** 一个轮次：用户消息 + 该轮的过程（工具活动）与主体（回答、结果、确认卡）。 */
export interface TurnGroup {
  id: number;
  user: TextItem | null;
  body: TranscriptItemView[];
  process: TranscriptItemView[];
}

/**
 * 把宿主下发的平铺条目投影成轮次。
 *
 * 宿主不提供轮次边界，这里按"user 条目开启新轮次"投影；工具活动归入过程折叠块，
 * 其余内容按原顺序进入主体。这是纯展示分组，不改变宿主语义，也不参与确认判定。
 */
export function projectTurns(items: readonly TranscriptItemView[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  let current: TurnGroup | null = null;
  const open = (id: number): TurnGroup => {
    if (!current) {
      current = { id, user: null, body: [], process: [] };
      turns.push(current);
    }
    return current;
  };
  for (const item of items) {
    if (item.kind === 'user') {
      current = { id: item.id, user: item, body: [], process: [] };
      turns.push(current);
      continue;
    }
    const turn = open(item.id);
    if (item.kind === 'activity') turn.process.push(item);
    else turn.body.push(item);
  }
  return turns;
}
