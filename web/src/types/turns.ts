import type {
  ReasoningItemView, ToolItemView, TranscriptItemView, TurnItemView,
} from './protocol';

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
